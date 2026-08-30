import { Router, type Request, type Response } from "express";

import { log } from "../services/logger.js";
import {
  getCircuitInfo,
  getDaoMigration,
  getDaoCurrentCircuit,
} from "../services/circuit-registry.js";
import { queryLimiter, validateParams } from "../middleware/index.js";
import { circuitParamsSchema } from "../validation/schemas.js";
import type { AsyncHandler } from "../types/index.js";

const router = Router();

router.get(
  "/circuits/:dao/:type/status",
  queryLimiter,
  validateParams(circuitParamsSchema),
  (async (req: Request, res: Response) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { dao: daoId, type } = (req as any).validatedParams;

    const circuitType = type === "comment" ? "Comment" : "Vote";

    try {
      log("info", "circuit_status_request", { daoId, circuitType });

      const currentCircuit = await getDaoCurrentCircuit(daoId, circuitType);
      const migration = await getDaoMigration(daoId);

      const knownCircuitIds: string[] = ["vote_v1", "vote_v2"];
      const availableCircuits = [];
      for (const cid of knownCircuitIds) {
        const info = await getCircuitInfo(cid, circuitType);
        if (info) availableCircuits.push(info);
      }

      return res.json({
        daoId,
        circuitType,
        currentCircuit: currentCircuit ?? "vote_v1",
        availableCircuits,
        migration: migration ?? undefined,
      });
    } catch (error) {
      log("error", "circuit_status_error", {
        daoId,
        error: (error as Error).message,
      });
      return res.status(500).json({ error: "Failed to fetch circuit status" });
    }
  }) as AsyncHandler,
);

export default router;
