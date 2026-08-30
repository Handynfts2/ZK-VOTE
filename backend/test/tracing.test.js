/**
 * W3C Trace Context Tests (#141)
 *
 * Verifies traceparent parsing and the requestLogger's trace propagation:
 * inbound trace IDs are continued, malformed/missing headers start a new
 * trace, and every response carries an outbound traceparent header.
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import express from "express";
import request from "supertest";

import { requestLogger, parseIncomingTraceId } from "../src/middleware/logging.js";

const VALID_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const VALID_TRACEPARENT = `00-${VALID_TRACE_ID}-00f067aa0ba902b7-01`;

describe("parseIncomingTraceId", () => {
  it("extracts the trace ID from a well-formed traceparent header", () => {
    assert.strictEqual(parseIncomingTraceId(VALID_TRACEPARENT), VALID_TRACE_ID);
  });

  it("returns undefined for a missing header", () => {
    assert.strictEqual(parseIncomingTraceId(undefined), undefined);
  });

  it("returns undefined for a malformed header", () => {
    assert.strictEqual(parseIncomingTraceId("not-a-traceparent"), undefined);
  });

  it("returns undefined for an all-zero trace ID", () => {
    assert.strictEqual(
      parseIncomingTraceId(`00-${"0".repeat(32)}-00f067aa0ba902b7-01`),
      undefined,
    );
  });
});

function buildApp() {
  const app = express();
  app.use(requestLogger);
  app.get("/ping", (req, res) => {
    res.json({ ctx: req.ctx, traceId: req.traceId });
  });
  return app;
}

describe("requestLogger trace propagation", () => {
  it("continues an inbound trace ID and echoes it in the traceparent response header", async () => {
    const res = await request(buildApp())
      .get("/ping")
      .set("traceparent", VALID_TRACEPARENT);

    assert.strictEqual(res.body.traceId, VALID_TRACE_ID);
    assert.ok(res.headers.traceparent.startsWith(`00-${VALID_TRACE_ID}-`));
  });

  it("starts a new trace when no traceparent header is present", async () => {
    const res = await request(buildApp()).get("/ping");

    assert.match(res.body.traceId, /^[0-9a-f]{32}$/);
    assert.match(res.headers.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
});
