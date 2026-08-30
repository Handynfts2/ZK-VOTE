/**
 * #205 — Read/write connection isolation tests
 *
 * Verifies dual better-sqlite3 connections (write + readonly), that API-style
 * reads do not create partitions, concurrent read/write workloads, write
 * failover reconnect, and a soft write-latency budget under concurrent reads.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = fs.mkdtempSync(path.join(tmpdir(), "zkvote-replica-"));

test.after(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

async function loadDb(dbPath) {
  const mod = await import("../src/services/db.ts");
  mod.closeDb();
  mod.initDb(dbPath);
  return mod;
}

test("opens write + readonly connections and rejects writes on read handle", async () => {
  const dbPath = path.join(TEST_DIR, "dual.db");
  const db = await loadDb(dbPath);

  const write = db.getWriteDb();
  const read = db.getReadDb();
  assert.notEqual(write, read);

  assert.equal(write.readonly, false);
  assert.equal(read.readonly, true);

  assert.throws(() => {
    read.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)").run("x", '"y"');
  });

  write.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)").run(
    "k",
    JSON.stringify("v"),
  );
  const row = read.prepare("SELECT value FROM metadata WHERE key = ?").get("k");
  assert.equal(JSON.parse(row.value), "v");

  const status = db.getDbStatus();
  assert.equal(status.connectionsActive, 2);
  assert.equal(status.writeHealthy, true);
  assert.equal(typeof status.readLagMs, "number");
  assert.equal(typeof status.walSizeBytes, "number");

  db.closeDb();
});

test("API reads do not create missing partitions (no DDL on read path)", async () => {
  const dbPath = path.join(TEST_DIR, "no-ddl.db");
  const db = await loadDb(dbPath);

  const result = db.getEventsForDao(42);
  assert.deepEqual(result.events, []);
  assert.equal(result.total, 0);
  assert.equal(db.getPendingEventsCountForDao(42), 0);

  const tables = db
    .getReadDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get("events_42");
  assert.equal(tables, undefined);

  // Writer creates partition; reader then sees data
  assert.equal(
    db.addEvent({
      daoId: 42,
      type: "dao_create",
      data: { name: "test" },
      ledger: 1,
      txHash: "abc",
      verified: true,
    }),
    true,
  );

  const after = db.getEventsForDao(42);
  assert.equal(after.total, 1);
  db.closeDb();
});

test("concurrent readers do not block writers (soft latency budget)", async () => {
  const dbPath = path.join(TEST_DIR, "concurrent.db");
  const db = await loadDb(dbPath);

  // Seed a partition so readers have something to scan
  for (let i = 0; i < 50; i++) {
    db.addEvent({
      daoId: 7,
      type: "dao_create",
      data: { i },
      ledger: i + 1,
      txHash: `seed-${i}`,
      verified: true,
    });
  }

  const writeLatencies = [];
  const readers = 8;
  const writes = 40;
  let stop = false;

  const readerJobs = Array.from({ length: readers }, async () => {
    while (!stop) {
      db.getEventsForDao(7, { limit: 25 });
      db.getDbStatus();
      await new Promise((r) => setImmediate(r));
    }
  });

  await new Promise((r) => setImmediate(r));

  for (let i = 0; i < writes; i++) {
    const t0 = performance.now();
    db.addEvent({
      daoId: 7,
      type: "proposal_created",
      data: { n: i },
      ledger: 1000 + i,
      txHash: `w-${i}`,
      verified: false,
    });
    writeLatencies.push(performance.now() - t0);
  }

  stop = true;
  await Promise.all(readerJobs);

  writeLatencies.sort((a, b) => a - b);
  const p95 = writeLatencies[Math.floor(writeLatencies.length * 0.95)];
  // Soft budget: under concurrent same-file readers, writes should stay snappy
  assert.ok(p95 < 50, `write p95 ${p95.toFixed(2)}ms exceeded 50ms budget`);

  const lag = db.getReadReplicaLagMs();
  assert.ok(lag >= 0);
  assert.equal(db.isWriteConnectionHealthy(), true);

  db.closeDb();
});

test("write failover reconnect restores healthy writer", async () => {
  const dbPath = path.join(TEST_DIR, "failover.db");
  const db = await loadDb(dbPath);

  db.addEvent({
    daoId: 1,
    type: "dao_create",
    data: {},
    ledger: 1,
    txHash: "f1",
    verified: true,
  });

  // Simulate write handle death
  db.getWriteDb().close();
  assert.equal(db.reconnectWriteDb(), true);
  assert.equal(db.isWriteConnectionHealthy(), true);

  assert.equal(
    db.addEvent({
      daoId: 1,
      type: "dao_create",
      data: {},
      ledger: 2,
      txHash: "f2",
      verified: true,
    }),
    true,
  );

  // Reads still work after write reconnect
  assert.ok(db.getEventsForDao(1).total >= 1);
  db.closeDb();
});

test("diagnostics expose read replica lag monitoring fields", async () => {
  const dbPath = path.join(TEST_DIR, "diag.db");
  const db = await loadDb(dbPath);
  const diag = db.getDbDiagnostics();
  assert.ok(diag.readReplica);
  assert.equal(typeof diag.readReplica.lagMs, "number");
  assert.equal(diag.readReplica.writeHealthy, true);
  assert.equal(diag.readReplica.connectionsActive, 2);
  db.closeDb();
});
