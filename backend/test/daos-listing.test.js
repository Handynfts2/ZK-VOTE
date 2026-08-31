/**
 * Regression coverage for GET /daos (issue #366).
 *
 * A bad merge left the handler with two divergent response shapes: the
 * no-`user` path returned the pre-pagination `{ daos, total }` body while the
 * `?user=` path returned the documented `{ data, pagination }` body. These
 * tests pin the single documented shape for both paths, the role annotation,
 * cursor/offset paging, and the 400 boundary.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zkvote-daos-listing-"));
const dbPath = path.join(tempDir, "daos.db");

process.env.RELAYER_TEST_MODE = "true";
process.env.RELAYER_SECRET_KEY =
  "SCVZXEUXJLRZKPCUXGXN53BJTD3RAZPRSSXHXDGSZQH5EOGEUTWINUXF";
process.env.RELAYER_AUTH_TOKEN = "daos-listing-token";
process.env.AUTH_MASTER_KEY = "daos-listing-master-key";
process.env.VOTING_CONTRACT_ID = "C".padEnd(56, "A");
process.env.TREE_CONTRACT_ID = "C".padEnd(56, "B");
process.env.COMMENTS_CONTRACT_ID = "C".padEnd(56, "D");
process.env.SOROBAN_RPC_URL = "http://localhost";
process.env.NETWORK_PASSPHRASE = "Test";
process.env.CORS_ORIGIN = "http://localhost";
process.env.IPFS_ENABLED = "false";

const { app } = await import("../src/index.ts");
const { initDb, closeDb, upsertDaos } = await import("../src/services/db.js");
const { daoAdminsCache, daoMembersCache } =
  await import("../src/services/sync.js");
const { daosListResponseSchema } = await import("../src/openapi.ts");

const admin = StellarSdk.Keypair.random().publicKey();
const member = StellarSdk.Keypair.random().publicKey();
const outsider = StellarSdk.Keypair.random().publicKey();

const DAO_COUNT = 5;

initDb(dbPath);

upsertDaos(
  Array.from({ length: DAO_COUNT }, (_, i) => ({
    id: i,
    name: `DAO ${i}`,
    creator: admin,
    membership_open: true,
    members_can_propose: true,
    metadata_cid: null,
    member_count: 1,
  })),
);

// DAO 0 is administered by `admin`; DAO 1 has `member` as a plain member.
daoAdminsCache.set(0, admin);
daoMembersCache.set(1, new Set([member]));

test.after(() => {
  closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("GET /daos returns the documented paginated shape without a user", async () => {
  const res = await request(app).get("/daos");

  assert.equal(res.statusCode, 200);
  assert.doesNotThrow(() => daosListResponseSchema.parse(res.body));
  assert.equal(res.body.data.length, DAO_COUNT);
  assert.equal(res.body.pagination.total, DAO_COUNT);
  assert.equal(res.body.pagination.hasMore, false);
  assert.equal(res.body.cached, true);
  // The pre-fix body leaked a top-level `daos` array instead of `data`.
  assert.equal(res.body.daos, undefined);
});

test("GET /daos keeps the same shape when a user is supplied", async () => {
  const res = await request(app).get("/daos").query({ user: outsider });

  assert.equal(res.statusCode, 200);
  assert.doesNotThrow(() => daosListResponseSchema.parse(res.body));
  assert.equal(res.body.data.length, DAO_COUNT);
  assert.equal(res.body.daos, undefined);
});

test("?user= annotates admin, member and non-member roles", async () => {
  const asAdmin = await request(app).get("/daos").query({ user: admin });
  assert.equal(asAdmin.statusCode, 200);
  assert.equal(asAdmin.body.data[0].role, "admin");

  const asMember = await request(app).get("/daos").query({ user: member });
  assert.equal(asMember.statusCode, 200);
  assert.equal(asMember.body.data[1].role, "member");
  assert.equal(asMember.body.data[0].role, null);

  const asOutsider = await request(app).get("/daos").query({ user: outsider });
  assert.equal(asOutsider.statusCode, 200);
  assert.ok(asOutsider.body.data.every((dao) => dao.role === null));
});

test("limit/offset paginate and expose a forward cursor", async () => {
  const first = await request(app).get("/daos").query({ limit: 2 });

  assert.equal(first.statusCode, 200);
  assert.equal(first.body.data.length, 2);
  assert.equal(first.body.pagination.total, DAO_COUNT);
  assert.equal(first.body.pagination.hasMore, true);
  assert.equal(first.body.pagination.cursor, "2");

  const second = await request(app)
    .get("/daos")
    .query({ limit: 2, offset: first.body.pagination.cursor });

  assert.equal(second.statusCode, 200);
  assert.deepEqual(
    second.body.data.map((dao) => dao.id),
    [2, 3],
  );
});

test("the advertised cursor is accepted as an offset alias", async () => {
  // The frontend echoes pagination.cursor back as ?cursor=; if that were
  // ignored, auto-pagination would re-request page one forever.
  const page = await request(app).get("/daos").query({ limit: 2, cursor: "4" });

  assert.equal(page.statusCode, 200);
  assert.deepEqual(
    page.body.data.map((dao) => dao.id),
    [4],
  );
  assert.equal(page.body.pagination.hasMore, false);
  assert.equal(page.body.pagination.cursor, undefined);
});

test("an offset past the end returns an empty page, not an error", async () => {
  const res = await request(app).get("/daos").query({ offset: 999 });

  assert.equal(res.statusCode, 200);
  assert.doesNotThrow(() => daosListResponseSchema.parse(res.body));
  assert.deepEqual(res.body.data, []);
  assert.equal(res.body.pagination.total, DAO_COUNT);
  assert.equal(res.body.pagination.hasMore, false);
});

test("invalid query parameters are rejected with 400", async () => {
  const cases = [
    { user: "not-a-stellar-address" },
    { user: "C".padEnd(56, "A") }, // contract IDs are not member addresses
    { limit: 0 },
    { limit: 501 },
    { limit: "abc" },
    { offset: -1 },
    { cursor: "not-a-number" },
  ];

  for (const query of cases) {
    const res = await request(app).get("/daos").query(query);
    assert.equal(
      res.statusCode,
      400,
      `expected 400 for ${JSON.stringify(query)}`,
    );
    assert.equal(res.body.error, "Invalid query parameters");
  }
});
