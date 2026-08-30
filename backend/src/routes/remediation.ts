/**
 * Remediation Debugging & History Endpoint
 */

import { Router, type Request, type Response } from "express";
import {
  getRemediationHistory,
  getMTTRStats,
} from "../services/remediation.js";
import { validateQuery } from "../middleware/index.js";
import { remediationHistoryQuerySchema } from "../validation/schemas.js";

const router = Router();

/**
 * GET /remediation/history
 * Returns remediation execution history and MTTR stats.
 */
router.get(
  "/remediation/history",
  validateQuery(remediationHistoryQuerySchema),
  (req: Request, res: Response) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { limit } = (req as any).validatedQuery;
    const history = getRemediationHistory(limit);
    const stats = getMTTRStats();

    res.json({
      status: "ok",
      historyCount: history.length,
      history,
      stats,
    });
  },
);

export default router;
