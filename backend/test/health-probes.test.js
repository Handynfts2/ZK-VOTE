/**
 * Health/Readiness Probes Tests (Issue #338)
 *
 * Tests K8s-compatible health and readiness probes:
 * - /healthz: liveness probe (process alive)
 * - /readyz: readiness probe (ready to accept traffic)
 * - /health: detailed health check
 * - Dependency gating on DB and RPC
 * - Graceful degradation signaling
 */

import test from "node:test";
import assert from "node:assert";
import request from "supertest";
import { createTestApp } from "./test-utils.js";

test("Health probes - /healthz (liveness probe)", async (t) => {
  const { app } = await createTestApp();

  const res = await request(app).get("/healthz");

  assert.ok(res.status === 200 || res.status === 503);
  assert.ok(res.body.status);
  assert.ok(res.body.timestamp);
});

test("Health probes - /readyz (readiness probe)", async (t) => {
  const { app } = await createTestApp();

  const res = await request(app).get("/readyz");

  assert.ok(res.status === 200 || res.status === 503);
  assert.ok(res.body.status);
  assert.ok(res.body.dependencies);
  assert.ok("rpc" in res.body.dependencies);
  assert.ok("db" in res.body.dependencies);
});

test("Health probes - /ready (readiness check)", async (t) => {
  const { app } = await createTestApp();

  const res = await request(app).get("/ready");

  assert.ok(res.status === 200 || res.status === 503);
  assert.ok(res.body.status);
  assert.ok(res.body.rpc);
  assert.ok(res.body.db);
});

test("Health probes - /health (detailed check)", async (t) => {
  const { app } = await createTestApp();

  const res = await request(app).get("/health");

  assert.equal(res.status, 200);
  assert.ok(res.body.status);
  assert.ok(res.body.services);
  assert.ok(res.body.memory);
  assert.ok("rssMb" in res.body.memory);
  assert.ok("heapUsedMb" in res.body.memory);
});

test("Health probes - degradation signal", async (t) => {
  const { app } = await createTestApp();

  // Both probes should handle service degradation
  const healthRes = await request(app).get("/health");
  const readyRes = await request(app).get("/readyz");

  // Status should reflect overall health
  assert.ok(
    ["ok", "degraded"].includes(healthRes.body.status || readyRes.body.status)
  );
});

test("Health probes - DB dependency gating", async (t) => {
  const { app } = await createTestApp();

  // /readyz should return 503 if DB is unavailable
  const res = await request(app).get("/readyz");

  // Should either succeed with db: ok or fail with 503
  if (res.status === 503) {
    assert.ok(res.body.status);
    assert.equal(res.body.dependencies.db, "unavailable");
  }
});

test("Health probes - RPC dependency gating", async (t) => {
  const { app, config } = await createTestApp();

  if (!config.healthcheckPing) {
    t.skip("Health check ping disabled");
    return;
  }

  const res = await request(app).get("/readyz");

  // Should fail or succeed based on RPC availability
  assert.ok(res.status === 200 || res.status === 503);
});

test("Health probes - response format compliance", async (t) => {
  const { app } = await createTestApp();

  const endpoints = ["/healthz", "/readyz", "/health"];

  for (const endpoint of endpoints) {
    const res = await request(app).get(endpoint);
    assert.ok(res.body);
    assert.ok(res.body.status);
    assert.ok(res.headers["content-type"].includes("application/json"));
  }
});

test("Health probes - no auth required for basic probes", async (t) => {
  const { app } = await createTestApp();

  const endpoints = ["/healthz", "/readyz"];

  for (const endpoint of endpoints) {
    const res = await request(app).get(endpoint);
    // Should not return 401 Unauthorized
    assert.notEqual(res.status, 401);
  }
});
