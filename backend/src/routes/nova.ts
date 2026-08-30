/**
 * Nova Recursive Aggregation API Routes
 */

import { Router, Request, Response } from "express";
import {
  novaAggregatorService,
  VoteWitnessPayload,
} from "../services/nova-aggregator.js";
import { bodyLimit } from "../middleware/index.js";

const router = Router();

/**
 * POST /api/v1/nova/aggregate
 * Trigger off-chain Nova IVC vote proof aggregation for an election batch
 */
router.post(
  "/aggregate",
  bodyLimit("100kb"),
  async (req: Request, res: Response) => {
    try {
      const { daoId, proposalId, root, witnesses } = req.body;

      if (!daoId || !proposalId || !witnesses || !Array.isArray(witnesses)) {
        return res.status(400).json({
          error:
            "Invalid payload. daoId, proposalId, and witnesses array are required.",
        });
      }

      const payload = await novaAggregatorService.aggregateVotes(
        Number(daoId),
        Number(proposalId),
        root ||
          "0x0000000000000000000000000000000000000000000000000000000000000000",
        witnesses as VoteWitnessPayload[],
      );

      return res.status(200).json({
        success: true,
        message: `Successfully aggregated ${payload.num_votes} votes using Nova IVC`,
        data: payload,
      });
    } catch (error: any) {
      console.error("[NovaRoute Error]:", error);
      return res.status(500).json({
        error: error.message || "Internal Nova aggregation error",
      });
    }
  },
);

export default router;
