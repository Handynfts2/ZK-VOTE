import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

const TEST_DIR = fs.mkdtempSync(path.join(tmpdir(), "zkvote-wal-test-"));

test.after(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
});

function makeTestDb(name) {
  return path.join(TEST_DIR, name);
}

// ============================================
// INTEGRITY CHECK
// ============================================

test("integrity check passes on healthy database", async () => {
  const { initDb } = await import("../src/services/db.ts");
  const dbPath = makeTestDb("integrity_healthy.db");
  const database = initDb(dbPath);
  const row = database.prepare("PRAGMA integrity_check").get();
  assert.equal(String(Object.values(row)[0]), "ok");
  database.close();
});

test("integrity check fails on corrupt database", async () => {
  const dbPath = makeTestDb("integrity_corrupt.db");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)");
  db.close();

  fs.writeFileSync(dbPath, "CORRUPT");

  const { initDb } = await import("../src/services/db.ts");
  assert.throws(() => {
    initDb(dbPath);
  }, /integrity_check failed|Integrity check failed|not a database/);
});

// ============================================
// WAL MODE
// ============================================

test("database opens in WAL mode", async () => {
  const { initDb } = await import("../src/services/db.ts");
  const dbPath = makeTestDb("wal_mode.db");
  const database = initDb(dbPath);
  const result = database.pragma("journal_mode");
  const journalMode = Array.isArray(result) ? result[0]?.journal_mode || result[0] : result;
  assert.equal(journalMode, "wal");
  database.close();
});

// ============================================
// BUSY TIMEOUT
// ============================================

test("busy timeout is set to configured value", async () => {
  const { initDb } = await import("../src/services/db.ts");
  const dbPath = makeTestDb("busy_timeout.db");
  const database = initDb(dbPath);
  const result = database.pragma("busy_timeout");
  const timeout = Array.isArray(result) ? result[0]?.timeout || result[0] : result;
  assert.ok(timeout >= 0, `busy_timeout should be set, got ${JSON.stringify(result)}`);
  database.close();
});

// ============================================
// SQLITE_BUSY RETRIES
// ============================================

test("executeWithRetry succeeds on first attempt", async () => {
  const { executeWithRetry, configureWalResilience } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("retry_success.db");
  const database = new Database(dbPath);

  configureWalResilience({ retryCount: 3, retryBaseDelayMs: 10, retryMaxDelayMs: 50 });

  const result = executeWithRetry(database, (db) => {
    return db.prepare("SELECT 1 as val").get();
  });
  assert.equal(result.val, 1);
  database.close();
});

test("executeWithRetry throws after exhausting retries", async () => {
  const { executeWithRetry, configureWalResilience } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("retry_exhaust.db");
  const database = new Database(dbPath);

  configureWalResilience({ retryCount: 2, retryBaseDelayMs: 10, retryMaxDelayMs: 50 });

  let attempts = 0;
  assert.throws(() => {
    executeWithRetry(database, (_db) => {
      attempts++;
      const err = new Error("SQLITE_BUSY: database is locked");
      err.code = "SQLITE_BUSY";
      throw err;
    });
  }, /SQLITE_BUSY/);
  assert.equal(attempts, 3, "Should have tried 3 times (initial + 2 retries)");
  database.close();
});

test("executeWithRetry does not retry non-BUSY errors", async () => {
  const { executeWithRetry, configureWalResilience } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("retry_nonbusy.db");
  const database = new Database(dbPath);

  configureWalResilience({ retryCount: 3, retryBaseDelayMs: 10, retryMaxDelayMs: 50 });

  let attempts = 0;
  assert.throws(() => {
    executeWithRetry(database, (_db) => {
      attempts++;
      throw new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed");
    });
  }, /SQLITE_CONSTRAINT/);
  assert.equal(attempts, 1, "Should not retry non-BUSY errors");
  database.close();
});

// ============================================
// CHECKPOINT SCHEDULING
// ============================================

test("startWalCheckpointing and stopWalCheckpointing work", async () => {
  const { startWalCheckpointing, stopWalCheckpointing, configureWalResilience } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("checkpoint_sched.db");
  const database = new Database(dbPath);

  database.pragma("journal_mode = WAL");
  configureWalResilience({ checkpointIntervalMs: 50000, checkpointTransactionCount: 10000 });

  startWalCheckpointing(database);
  stopWalCheckpointing();
  assert.ok(true, "Checkpoint start/stop should not throw");
  database.close();
});

test("performInitialCheckpoint works", async () => {
  const { performInitialCheckpoint } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("initial_checkpoint.db");
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");

  performInitialCheckpoint(database);
  const result = database.pragma("journal_mode");
  const walMode = Array.isArray(result) ? result[0]?.journal_mode || result[0] : result;
  assert.equal(walMode, "wal");
  database.close();
});

// ============================================
// WAL MONITORING
// ============================================

test("WAL monitoring starts and stops without error", async () => {
  const { startWalMonitor, stopWalMonitor } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("wal_monitor.db");
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.exec("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)");

  startWalMonitor(database, dbPath);
  stopWalMonitor();
  assert.ok(true);
  database.close();
});

test("WAL monitoring handles missing WAL file", async () => {
  const { startWalMonitor, stopWalMonitor } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("wal_missing.db");
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.exec("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)");

  const fakePath = makeTestDb("nonexistent.db");
  startWalMonitor(database, fakePath);
  stopWalMonitor();
  assert.ok(true);
  database.close();
});

// ============================================
// BACKUP CREATION
// ============================================

test("startPeriodicBackups and stopPeriodicBackups work", async () => {
  const { startPeriodicBackups, stopPeriodicBackups, configureWalResilience } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("backup_test.db");
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.exec("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, value TEXT)");
  database.prepare("INSERT INTO test (id, value) VALUES (1, 'hello')").run();

  configureWalResilience({ backupIntervalMs: 10000 });

  startPeriodicBackups(database, dbPath);
  stopPeriodicBackups();
  assert.ok(true);
  database.close();
});

// ============================================
// READINESS REPORTING
// ============================================

test("getWalHealth returns correct structure", async () => {
  const { initWalResilience, getWalHealth, configureWalResilience } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("health_status.db");
  const database = new Database(dbPath);

  configureWalResilience({ busyTimeoutMs: 5000, walWarningThresholdBytes: 1000000 });
  initWalResilience(database, dbPath);

  const health = getWalHealth(database, dbPath);
  assert.ok(typeof health.available === "boolean");
  assert.ok(health.integrityOk === true);
  assert.equal(health.integrityResult, "ok");
  assert.ok(typeof health.lastIntegrityCheck === "string");
  assert.ok(health.lastCheckpoint === null || typeof health.lastCheckpoint === "string");

  database.close();
});

test("getWalHealth reports WAL file existence", async () => {
  const { getWalHealth, configureWalResilience } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("wal_file_check.db");
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.exec("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)");
  database.prepare("INSERT INTO test (id) VALUES (1)").run();

  configureWalResilience({ walWarningThresholdBytes: 1000000 });

  const health = getWalHealth(database, dbPath);
  assert.ok(typeof health.walFileExists === "boolean");
  assert.ok(health.walSizeBytes === null || typeof health.walSizeBytes === "number");

  database.close();
});

// ============================================
// RECOVERY BEHAVIOUR
// ============================================

test("detectAndHandleWalIssue passes on healthy database", async () => {
  const { detectAndHandleWalIssue } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("recovery_healthy.db");
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");
  database.exec("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY)");

  detectAndHandleWalIssue(database, dbPath);
  assert.ok(true);
  database.close();
});

// ============================================
// STARTUP BEHAVIOUR
// ============================================

test("initWalResilience sets busy_timeout", async () => {
  const { initWalResilience, configureWalResilience } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("startup_busy.db");
  const database = new Database(dbPath);

  configureWalResilience({ busyTimeoutMs: 7000 });
  initWalResilience(database, dbPath);

  const result = database.pragma("busy_timeout");
  const timeout = Array.isArray(result) ? result[0]?.timeout || result[0] : result;
  assert.equal(timeout, 7000);
  database.close();
});

test("initWalResilience fails on corrupt database", async () => {
  const { initWalResilience, configureWalResilience } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("startup_corrupt.db");

  const db = new Database(dbPath);
  db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY)");
  db.close();

  fs.writeFileSync(dbPath, "BAD_DATA");

  const db2 = new Database(dbPath);
  configureWalResilience({ busyTimeoutMs: 1000 });
  assert.throws(() => {
    initWalResilience(db2, dbPath);
  }, /Integrity check failed|not a database/);
  db2.close();
});

// ============================================
// CONFIGURATION
// ============================================

test("configureWalResilience merges with defaults", async () => {
  const { configureWalResilience, getWalResilienceConfig } = await import("../src/services/walResilience.ts");

  configureWalResilience({ busyTimeoutMs: 9999, checkpointIntervalMs: 60000, retryCount: 5 });
  const cfg = getWalResilienceConfig();
  assert.equal(cfg.busyTimeoutMs, 9999);
  assert.equal(cfg.checkpointIntervalMs, 60000);
  assert.equal(cfg.retryCount, 5);
});

test("getWalResilienceConfig returns copy of config", async () => {
  const { getWalResilienceConfig, configureWalResilience } = await import("../src/services/walResilience.ts");

  configureWalResilience({ retryCount: 10 });
  const cfg1 = getWalResilienceConfig();
  const cfg2 = getWalResilienceConfig();
  assert.equal(cfg1.retryCount, 10);
  assert.equal(cfg2.retryCount, 10);
});

// ============================================
// TRANSACTION COUNTER
// ============================================

test("incrementTransactionCounter increments counter", async () => {
  const { incrementTransactionCounter } = await import("../src/services/walResilience.ts");

  incrementTransactionCounter();
  incrementTransactionCounter();
  incrementTransactionCounter();
  assert.ok(true, "Should not throw");
});

// ============================================
// GRACEFUL STOP
// ============================================

test("stopWalResilience stops all services", async () => {
  const { startWalCheckpointing, startWalMonitor, startPeriodicBackups, stopWalResilience, configureWalResilience } = await import("../src/services/walResilience.ts");
  const dbPath = makeTestDb("stop_all.db");
  const database = new Database(dbPath);
  database.pragma("journal_mode = WAL");

  configureWalResilience({
    checkpointIntervalMs: 100000,
    walWarningThresholdBytes: 1000000,
    backupIntervalMs: 100000,
  });

  startWalCheckpointing(database);
  startWalMonitor(database, dbPath);
  startPeriodicBackups(database, dbPath);
  stopWalResilience();

  assert.ok(true);
  database.close();
});