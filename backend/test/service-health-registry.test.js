/**
 * Coverage for the service-health registry (issue #367): the per-component
 * health map, overall-status aggregation, and last-known-good (LKG) cache in
 * src/services/service-health.ts. The existing graceful-degradation suites
 * exercise the write-queue half of this module; the registry/LKG half
 * (markHealthy/markDegraded/markUnavailable, getServiceHealth,
 * getOverallHealth, getDegradedServiceNames, setLkg/getLkg) had no direct
 * unit tests.
 */

import test from "node:test";
import assert from "node:assert/strict";

process.env.RELAYER_TEST_MODE = "true";
process.env.VOTING_CONTRACT_ID = "C".padEnd(56, "A");
process.env.TREE_CONTRACT_ID = "C".padEnd(56, "B");
process.env.COMMENTS_CONTRACT_ID = "C".padEnd(56, "D");
process.env.SOROBAN_RPC_URL = "http://localhost";
process.env.NETWORK_PASSPHRASE = "Test";

const {
  markHealthy,
  markDegraded,
  markUnavailable,
  getServiceHealth,
  getOverallHealth,
  getDegradedServiceNames,
  resetServiceHealth,
  setLkg,
  getLkg,
  commentsLkgKey,
  ipfsLkgKey,
} = await import("../src/services/service-health.js");

test.afterEach(() => {
  resetServiceHealth();
});

test("every registered service starts healthy", () => {
  const overall = getOverallHealth();

  assert.equal(overall.status, "ok");
  assert.deepEqual(overall.degraded, []);
  assert.deepEqual(overall.unavailable, []);
  assert.ok(overall.services.length >= 7);
  assert.ok(overall.services.every((s) => s.state === "healthy"));
});

test("getServiceHealth returns a single entry by name or the full list", () => {
  const single = getServiceHealth("sqlite");
  assert.equal(single.name, "sqlite");
  assert.equal(single.tier, "important");
  assert.equal(single.state, "healthy");

  const all = getServiceHealth();
  assert.ok(Array.isArray(all));
  assert.ok(all.some((s) => s.name === "sqlite"));
});

test("markDegraded flips overall status and records the error", () => {
  markDegraded("ipfs", "pinata timeout");

  const entry = getServiceHealth("ipfs");
  assert.equal(entry.state, "degraded");
  assert.equal(entry.lastError, "pinata timeout");

  const overall = getOverallHealth();
  assert.equal(overall.status, "degraded");
  assert.deepEqual(overall.degraded, ["ipfs"]);
  assert.deepEqual(overall.unavailable, []);
  assert.deepEqual(getDegradedServiceNames(), ["ipfs"]);
});

test("markUnavailable flips overall status and is distinguished from degraded", () => {
  markUnavailable("soroban_rpc", "connection refused");

  const entry = getServiceHealth("soroban_rpc");
  assert.equal(entry.state, "unavailable");
  assert.equal(entry.lastError, "connection refused");

  const overall = getOverallHealth();
  assert.equal(overall.status, "degraded");
  assert.deepEqual(overall.degraded, []);
  assert.deepEqual(overall.unavailable, ["soroban_rpc"]);
  assert.deepEqual(getDegradedServiceNames(), ["soroban_rpc"]);
});

test("markHealthy recovers a degraded or unavailable service and clears its error", () => {
  markUnavailable("indexer", "poll failed");
  assert.equal(getServiceHealth("indexer").state, "unavailable");

  markHealthy("indexer");

  const entry = getServiceHealth("indexer");
  assert.equal(entry.state, "healthy");
  assert.equal(entry.lastError, null);
  assert.equal(getOverallHealth().status, "ok");
});

test("markDegraded without an error message keeps the previous error", () => {
  markDegraded("comments", "first failure");
  markDegraded("comments");

  assert.equal(getServiceHealth("comments").lastError, "first failure");
});

test("multiple degraded/unavailable services are all reported", () => {
  markDegraded("dao_sync", "sync stalled");
  markUnavailable("ttl_renewal", "rpc down");

  const overall = getOverallHealth();
  assert.equal(overall.status, "degraded");
  assert.deepEqual(overall.degraded, ["dao_sync"]);
  assert.deepEqual(overall.unavailable, ["ttl_renewal"]);
  assert.deepEqual(getDegradedServiceNames().sort(), [
    "dao_sync",
    "ttl_renewal",
  ]);
});

test("resetServiceHealth restores every service to healthy", () => {
  markDegraded("ipfs", "x");
  markUnavailable("soroban_rpc", "y");

  resetServiceHealth();

  const overall = getOverallHealth();
  assert.equal(overall.status, "ok");
  assert.ok(overall.services.every((s) => s.state === "healthy"));
  assert.ok(overall.services.every((s) => s.lastError === null));
});

test("LKG cache stores and returns a value within its TTL", () => {
  setLkg("k1", { hello: "world" }, 1000);

  assert.deepEqual(getLkg("k1"), { hello: "world" });
});

test("LKG cache expires entries past their TTL", async () => {
  setLkg("k2", "stale-soon", 1);

  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(getLkg("k2"), null);
});

test("LKG cache returns null for a key that was never set", () => {
  assert.equal(getLkg("never-set"), null);
});

test("comments and IPFS LKG key helpers are stable and distinct", () => {
  assert.equal(commentsLkgKey(1, 2), "comments:1:2");
  assert.equal(commentsLkgKey(1, 3), "comments:1:3");
  assert.notEqual(commentsLkgKey(1, 2), ipfsLkgKey("bafybeigdyrzt"));
  assert.equal(ipfsLkgKey("bafybeigdyrzt"), "ipfs:bafybeigdyrzt");
});
