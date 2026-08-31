/**
 * OpenAPI 3.1 Specification Builder
 *
 * Builds the API's OpenAPI document from the same Zod schemas used to
 * validate requests at runtime (all centralized in validation/schemas.ts),
 * plus a compact per-endpoint metadata table below.
 * That table is also the source `scripts/generate-openapi.ts` uses to check
 * API.md doesn't drift from the implemented routes — see that script for how
 * the two stay in sync.
 */

import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
  type ResponseConfig,
} from "@asteasolutions/zod-to-openapi";
import { z, type ZodTypeAny } from "zod";
import {
  voteSchema,
  anonymousCommentSchema,
  editCommentSchema,
  deleteCommentSchema,
  flagCommentSchema,
  manualEventSchema,
  notifyEventSchema,
  bridgeVoteSchema,
  circuitParamsSchema,
} from "./validation/schemas.js";

extendZodWithOpenApi(z);

// ============================================
// SHARED RESPONSE / PARAM SCHEMAS
// ============================================

export const errorResponseSchema = z
  .object({ error: z.string().openapi({ example: "Unauthorized" }) })
  .openapi("ErrorResponse");

export const successResponseSchema = z
  .object({
    success: z.boolean().openapi({ example: true }),
    txHash: z.string().optional().openapi({ example: "a1b2c3...64hex" }),
  })
  .openapi("SuccessResponse");

/**
 * A handful of read-endpoint response shapes, reused both to build the spec
 * and (in test/openapi-validation.test.js) to validate live responses
 * against it — the same pattern the issue's `zod-to-openapi` suggestion is
 * about, applied to responses instead of just requests.
 */
export const healthResponseSchema = z
  .object({
    status: z.string().openapi({ example: "ok" }),
    rpc: z.object({ ok: z.boolean() }).passthrough(),
  })
  .passthrough()
  .openapi("HealthResponse");

export const readyResponseSchema = z
  .object({ status: z.string().openapi({ example: "ready" }) })
  .passthrough()
  .openapi("ReadyResponse");

export const configResponseSchema = z
  .object({
    networkPassphrase: z.string(),
    rpcUrl: z.string(),
    ipfsEnabled: z.boolean(),
  })
  .passthrough()
  .openapi("ConfigResponse");

export const paginatedResponseSchema = z
  .object({
    data: z.array(z.record(z.unknown())),
    pagination: z.object({
      cursor: z.string().nullable().optional(),
      hasMore: z.boolean(),
      total: z.number(),
    }),
  })
  .openapi("PaginatedResponse");

export const daosListResponseSchema = z
  .object({
    data: z.array(z.record(z.unknown())),
    pagination: z.object({
      cursor: z.string().nullable().optional(),
      hasMore: z.boolean(),
      total: z.number(),
    }),
    lastSync: z.string().nullable(),
    cached: z.boolean(),
  })
  .openapi("DaosListResponse");

/** Path params are always strings on the wire, regardless of server-side coercion. */
function idParam(example: string, description: string) {
  return z.string().openapi({ example, description });
}

// ============================================
// ENDPOINT METADATA
//
// This is the single source of truth for the generated OpenAPI spec
// (openapi.json / GET /api-docs) AND for the API.md sync check in
// scripts/generate-openapi.ts. Every route in src/routes/*.ts should have
// exactly one entry here.
// ============================================

export interface EndpointDef {
  method: "get" | "post";
  path: string; // Express-style, e.g. /dao/:daoId
  tag: string;
  summary: string;
  auth: boolean;
  rateLimit: string | null;
  params?: Record<string, ZodTypeAny>;
  query?: Record<string, ZodTypeAny>;
  body?: ZodTypeAny;
  responseExample: unknown;
  responseSchema?: ZodTypeAny;
  errorStatuses?: number[];
}

export const ENDPOINTS: EndpointDef[] = [
  // ---- Health ----
  {
    method: "get",
    path: "/health",
    tag: "Health",
    summary: "Basic health check and RPC pool status",
    auth: false,
    rateLimit: null,
    responseExample: {
      status: "ok",
      rpc: { ok: true, pool: {} },
      db: { totalEvents: 0, daoCount: 0, lastLedger: 0 },
    },
    responseSchema: healthResponseSchema,
  },
  {
    method: "get",
    path: "/ready",
    tag: "Health",
    summary: "Readiness check (verifies RPC connectivity)",
    auth: false,
    rateLimit: null,
    responseExample: { status: "ready" },
    responseSchema: readyResponseSchema,
    errorStatuses: [503],
  },
  {
    method: "get",
    path: "/config",
    tag: "Health",
    summary: "Public configuration for frontend clients",
    auth: false,
    rateLimit: null,
    responseExample: {
      votingContract: "C...",
      networkPassphrase: "Test SDF Network ; September 2015",
      ipfsEnabled: true,
    },
    responseSchema: configResponseSchema,
  },
  {
    method: "get",
    path: "/db/stats",
    tag: "Health",
    summary: "Database diagnostics (full detail requires auth)",
    auth: true,
    rateLimit: null,
    responseExample: { queries: {}, tables: [], cache: {} },
  },
  // ---- Voting ----
  {
    method: "post",
    path: "/vote",
    tag: "Voting",
    summary: "Submit an anonymous vote with a ZK proof",
    auth: true,
    rateLimit: "voteLimiter",
    body: voteSchema,
    responseExample: {
      success: true,
      txHash: "a1b2c3...64hex",
      status: "SUCCESS",
    },
    responseSchema: successResponseSchema,
    errorStatuses: [400, 401, 429, 500, 503, 504],
  },
  {
    method: "get",
    path: "/proposal/:daoId/:proposalId",
    tag: "Voting",
    summary: "Get proposal vote tallies",
    auth: false,
    rateLimit: "queryLimiter",
    params: {
      daoId: idParam("0", "DAO identifier"),
      proposalId: idParam("1", "Proposal identifier"),
    },
    responseExample: { daoId: 0, proposalId: 1, yesVotes: 12, noVotes: 3 },
  },
  {
    method: "get",
    path: "/root/:daoId",
    tag: "Voting",
    summary: "Get the current membership merkle root for a DAO",
    auth: false,
    rateLimit: "queryLimiter",
    params: { daoId: idParam("0", "DAO identifier") },
    responseExample: { daoId: 0, root: "0x..." },
  },
  // ---- Comments ----
  {
    method: "post",
    path: "/comment/anonymous",
    tag: "Comments",
    summary: "Submit an anonymous comment with a ZK proof",
    auth: true,
    rateLimit: "commentLimiter",
    body: anonymousCommentSchema,
    responseExample: { success: true, commentId: 42, txHash: "a1b2c3...64hex" },
    responseSchema: successResponseSchema,
    errorStatuses: [400, 401, 429, 500, 503, 504],
  },
  {
    method: "get",
    path: "/comment/challenge/:commitment",
    tag: "Comments",
    summary: "Get a proof-of-work challenge for a commitment (anti-spam)",
    auth: false,
    rateLimit: "queryLimiter",
    params: { commitment: idParam("0x1234...64hex", "Commitment hash") },
    responseExample: {
      serverId: "abc123",
      difficulty: 20,
      expiresAt: 1785200000000,
    },
  },
  {
    method: "get",
    path: "/comments/:daoId/:proposalId/nonce",
    tag: "Comments",
    summary: "Get the next comment nonce for a commitment",
    auth: false,
    rateLimit: "queryLimiter",
    params: {
      daoId: idParam("0", "DAO identifier"),
      proposalId: idParam("1", "Proposal identifier"),
    },
    responseExample: { nonce: 0 },
  },
  {
    method: "get",
    path: "/comments/:daoId/:proposalId",
    tag: "Comments",
    summary: "List comments for a proposal (paginated)",
    auth: false,
    rateLimit: "queryLimiter",
    params: {
      daoId: idParam("0", "DAO identifier"),
      proposalId: idParam("1", "Proposal identifier"),
    },
    query: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .openapi({ example: 100 }),
      cursor: z.string().optional().openapi({ example: "eyJpIjoxMjN9" }),
    },
    responseExample: {
      data: [],
      pagination: { cursor: undefined, hasMore: false, total: 0 },
    },
  },
  paths: {
    "/vote": {
      post: {
        summary: "Submit anonymous vote (audited)",
        security: [{ relayerAuth: [] }],
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/VoteRequest" } } } },
        responses: { "200": { description: "Vote submitted" }, "401": { description: "Unauthorized" } },
        "x-audited": true,
        "x-redacted-fields": ["nullifier", "root", "proof"],
      },
    },
    "/comment/anonymous": {
      post: {
        summary: "Anonymous comment (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
        "x-redacted-fields": ["nullifier", "root", "proof"],
      },
    },
    "/comment/edit": {
      post: {
        summary: "Edit comment (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/comment/delete": {
      post: {
        summary: "Delete comment (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/bridge/vote": {
      post: {
        summary: "Bridge vote (audited)",
        "x-audited": true,
        "x-redacted-fields": ["nullifier", "voteRoot", "sbtRoot", "proof"],
      },
    },
    "/bridge/relay": {
      post: {
        summary: "Manual relay (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/ipfs/image": {
      post: {
        summary: "Upload image (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/ipfs/metadata": {
      post: {
        summary: "Upload metadata (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/daos/sync": {
      post: {
        summary: "Sync DAOs (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/events": {
      post: {
        summary: "Manual event (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/events/notify": {
      post: {
        summary: "Notify event (audited)",
        security: [{ relayerAuth: [] }],
        "x-audited": true,
      },
    },
    "/remediation/action": {
      post: {
        summary: "Structured remediation action (append-only, authz, replay-safe)",
        security: [{ relayerAuth: [] }],
        requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/RemediationAction" } } } },
        responses: { "201": { description: "Recorded" }, "409": { description: "Duplicate idempotencyKey" }, "401": { description: "Unauthorized" } },
        "x-audited": true,
        "x-append-only": true,
        "x-replay-safe": true,
      },
    },
    "/remediation/log": {
      get: {
        summary: "Query remediation log",
        security: [{ relayerAuth: [] }],
        parameters: [{ name: "action", in: "query", schema: { type: "string" } }, { name: "target", in: "query", schema: { type: "string" } }, { name: "limit", in: "query", schema: { type: "integer" } }, { name: "offset", in: "query", schema: { type: "integer" } }],
        responses: { "200": { description: "Log entries" } },
      },
    },
    "/audit/logs": {
      get: {
        summary: "Query audit logs (redacted, authz)",
        security: [{ relayerAuth: [] }],
        parameters: [{ name: "action", in: "query", schema: { type: "string" } }, { name: "actor", in: "query", schema: { type: "string" } }, { name: "method", in: "query", schema: { type: "string" } }, { name: "from", in: "query", schema: { type: "string", format: "date-time" } }, { name: "to", in: "query", schema: { type: "string", format: "date-time" } }, { name: "limit", in: "query", schema: { type: "integer" } }, { name: "offset", in: "query", schema: { type: "integer" } }],
        responses: { "200": { description: "Audit entries" } },
        "x-redacted": true,
      },
    },
    "/audit/export": {
      get: {
        summary: "Export audit logs (json/csv)",
        security: [{ relayerAuth: [] }],
        parameters: [{ name: "format", in: "query", schema: { type: "string", enum: ["json", "csv"] } }],
        responses: { "200": { description: "Exported logs" } },
      },
    },
    "/audit/stats": {
      get: {
        summary: "Audit statistics",
        security: [{ relayerAuth: [] }],
        responses: { "200": { description: "Stats" } },
      },
    },
  },
  "x-audit": {
    description: "All mutating routes are audited with PII redaction. 100% coverage via global auditMiddleware.",
    mutatingRoutes: [
      "POST /vote",
      "POST /comment/anonymous",
      "POST /comment/edit",
      "POST /comment/delete",
      "POST /bridge/vote",
      "POST /bridge/relay",
      "POST /ipfs/image",
      "POST /ipfs/metadata",
      "POST /daos/sync",
      "POST /events",
      "POST /events/notify",
      "POST /remediation/action",
    ],
    redaction: "proof, nullifier, root, commitment, secret, token, password, jwt always redacted",
    immutable: "audit logs and remediation logs are append-only, no update/delete APIs",
    replaySafe: "remediation uses idempotencyKey; duplicates return 409",
  },
} as const;

export default openApiSpec;
