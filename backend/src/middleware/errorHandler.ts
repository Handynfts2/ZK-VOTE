/**
 * Global Error Handler Middleware
 *
 * Catches unhandled errors and returns standardized error responses.
 */

import type {
  Request,
  Response,
  NextFunction,
  ErrorRequestHandler,
} from "express";
import { log } from "../services/logger.js";
import { ErrorCode, type StructuredError } from "../types/index.js";
import { ApiError } from "../utils/errors.js";
import { config } from "../config.js";

/**
 * Global error handler middleware (must be last)
 */
export const errorHandler: ErrorRequestHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  log("error", "unhandled_error", {
    ctx: req.ctx,
    traceId: req.traceId,
    path: req.path,
    message: err.message,
    stack: err.stack,
  });

  const requestId = req.ctx || "unknown";
  const traceId = req.traceId;
  const timestamp = new Date().toISOString();

  if (err instanceof ApiError) {
    const errorResponse: StructuredError = {
      code: err.code,
      message: err.message,
      requestId,
      traceId,
      timestamp,
    };

    if (!config.genericErrors && err.details) {
      errorResponse.details = err.details;
    }

    res.status(err.statusCode).json({ error: errorResponse });
    return;
  }

  // Handle generic errors
  const errorResponse: StructuredError = {
    code: ErrorCode.INTERNAL_ERROR,
    message: "Internal server error",
    requestId,
    traceId,
    timestamp,
  };

  res.status(500).json({ error: errorResponse });
};
