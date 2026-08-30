/**
 * DAO Routes
 *
 * Handles DAO listing, retrieval, and sync operations.
 */

import { Router, type Request, type Response } from "express";

import { log } from "../services/logger.js";
import * as dbService from "../services/db.js";
import {
  syncDaosFromContract,
  daoMembersCache,
  daoAdminsCache,
} from "../services/sync.js";
import {
  authGuard,
  auditLog,
  queryLimiter,
  validateParams,
  noteDegraded,
  validateQuery,
  bodyLimit,
} from "../middleware/index.js";
import {
  getServiceHealth,
  type ServiceHealthEntry,
} from "../services/service-health.js";
import { daoParamsSchema, daosQuerySchema } from "../validation/schemas.js";
import type { AsyncHandler } from "../types/index.js";

const router = Router();

/**
 * GET /daos - Get all DAOs with limit/offset pagination
 */
router.get("/daos", queryLimiter, validateQuery(daosQuerySchema), (async (
  req: Request,
  res: Response,
) => {
  const { limit, offset, user, search, membershipType } = (req as any).validatedQuery;

  try {
    // The DAO list is served from the sync cache whether or not a user was
    // supplied, so the degradation note applies to both cases.
    const syncHealth = getServiceHealth("dao_sync") as ServiceHealthEntry;
    if (syncHealth.state !== "healthy") {
      noteDegraded("dao_sync");
    }

    const allDaos = dbService.getAllCachedDaos();

    // `user` is already format-checked by daosQuerySchema, so an invalid
    // address never reaches this handler; it is only used to annotate roles.
    const annotatedDaos = user
      ? allDaos.map((dao) => {
          const adminAddr = daoAdminsCache.get(dao.id) || dao.creator;
          if (adminAddr === user) {
            return { ...dao, role: "admin" as const };
          }
          const members = daoMembersCache.get(dao.id);
          if (members && members.has(user)) {
            return { ...dao, role: "member" as const };
          }
          return { ...dao, role: null };
        })
      : allDaos;

    const total = annotatedDaos.length;
    const paginatedDaos = annotatedDaos.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    log("info", "get_daos_paginated", {
      user: user ? `${user.slice(0, 8)}...` : null,
      count: paginatedDaos.length,
      total,
      offset,
      limit,
      search: search ?? null,
      membershipType: membershipType ?? null,
    });

    res.json({
      data: paginatedDaos,
      pagination: {
        cursor: hasMore ? String(offset + limit) : undefined,
        hasMore,
        total,
      },
      lastSync: dbService.getDaosSyncTime(),
      cached: true,
    });
  } catch (err) {
    log("error", "get_daos_failed", { error: (err as Error).message });
    res.status(500).json({ error: "Failed to get DAOs" });
  }
}) as AsyncHandler);

/**
 * GET /dao/:daoId - Get specific DAO from cache
 */
router.get(
  "/dao/:daoId",
  queryLimiter,
  validateParams(daoParamsSchema),
  (req: Request, res: Response) => {
    const { daoId } = (req as any).validatedParams;
    try {
      const dao = dbService.getCachedDao(daoId);
      if (!dao) {
        return res.status(404).json({ error: "DAO not found in cache" });
      }
      res.json({ dao, cached: true });
    } catch (err) {
      log("error", "get_dao_failed", { daoId, error: (err as Error).message });
      res.status(500).json({ error: "Failed to get DAO" });
    }
  },
);

/**
 * POST /daos/sync - Trigger manual DAO sync (admin only)
 */
router.post(
  "/daos/sync",
  bodyLimit("1kb"),
  authGuard,
  auditLog("daos_sync"),
  (async (req: Request, res: Response) => {
    try {
      const synced = await syncDaosFromContract();
      res.json({ success: true, synced });
    } catch (err) {
      log("error", "dao_sync_failed", { error: (err as Error).message });
      res.status(500).json({ error: "Failed to sync DAOs" });
    }
  }) as AsyncHandler,
);

/**
 * GET /proposals/:daoId - Search and filter proposals for a DAO
 *
 * Retrieves proposal_created events from the event store and applies
 * optional status and free-text filters.
 *
 * Query params:
 *  - status        : "active" | "closed" | "all"  (default "all")
 *  - search        : free-text substring match on proposal title
 *  - limit / offset: pagination
 *
 * Authorization: public (queryLimiter rate-limited)
 */
router.get(
  "/proposals/:daoId",
  queryLimiter,
  validateParams(daoParamsSchema),
  validateQuery(proposalsQuerySchema),
  (async (req: Request, res: Response) => {
    const { daoId } = (req as any).validatedParams as { daoId: number };
    const { limit, offset, status, search } = (req as any)
      .validatedQuery as {
      limit: number;
      offset: number;
      status: "active" | "closed" | "all";
      search?: string;
    };

    try {
      // Pull proposal_created events from the per-DAO partition table
      const now = Date.now();
      const { events } = dbService.getEventsForDao(daoId, {
        types: ["proposal_created"],
        limit: 1000, // Fetch a broad window; we filter in memory
        offset: 0,
        orderBy: "timestamp",
        orderDirection: "DESC",
      });

      type ProposalEventData = {
        proposal_id?: number;
        title?: string;
        end_time?: number;
        closed?: boolean;
        [key: string]: unknown;
      };

      // Shape raw events into lightweight proposal summaries
      let proposals = events.map((evt) => {
        const data = (evt.data ?? {}) as ProposalEventData;
        const endTime = data.end_time ?? 0;
        const isClosed =
          !!data.closed || (endTime > 0 && endTime * 1000 < now);
        return {
          proposalId: data.proposal_id ?? null,
          title: data.title ?? "",
          endTime,
          closed: isClosed,
          txHash: evt.tx_hash ?? null,
          timestamp: evt.timestamp,
        };
      });

      // Apply status filter
      if (status === "active") {
        proposals = proposals.filter((p) => !p.closed);
      } else if (status === "closed") {
        proposals = proposals.filter((p) => p.closed);
      }

      // Apply free-text search on title
      if (search) {
        const lowerSearch = search.toLowerCase();
        proposals = proposals.filter((p) =>
          p.title.toLowerCase().includes(lowerSearch),
        );
      }

      const total = proposals.length;
      const paginated = proposals.slice(offset, offset + limit);
      const hasMore = offset + limit < total;

      log("info", "get_proposals_filtered", {
        daoId,
        status,
        search: search ?? null,
        total,
        offset,
        limit,
      });

      res.json({
        data: paginated,
        pagination: {
          cursor: hasMore ? String(offset + limit) : undefined,
          hasMore,
          total,
        },
        filters: { status, search: search ?? null },
      });
    } catch (err) {
      log("error", "get_proposals_failed", {
        daoId,
        error: (err as Error).message,
      });
      res.status(500).json({ error: "Failed to get proposals" });
    }
  }) as AsyncHandler,
);

export default router;
