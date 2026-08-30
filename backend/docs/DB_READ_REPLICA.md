# Database Read/Write Connection Isolation (#205)

## Purpose

Heavy API reads on the single SQLite connection can interfere with indexer/sync writers (WAL readers holding long transactions increase write latency). This change opens **two connections** to the same `zkvote.db` file:

| Connection | Mode | Used by |
|------------|------|---------|
| **Write** | default (WAL, `busy_timeout=5000`) | Indexer, DAO sync, TTL, audit mutations, partition DDL |
| **Read** | `{ readonly: true }` + `query_only=ON` | API query helpers (`getEventsForDao`, DAO cache reads, status, diagnostics) |

This is Option 3 from the issue (connection-level separation). It is not a second physical Litestream replica; same-file WAL already allows concurrent readers while isolating connection configuration and preventing accidental DDL/DML on the API path.

## API

```ts
initDb(dbPath?)      // opens write then read; returns write handle
getWriteDb()         // mutating path (+ reconnect if unhealthy)
getReadDb()          // API queries (falls back to write if read open failed)
getDb()              // alias of getWriteDb() for archival/backup
closeDb()            // closes both
reconnectWriteDb()   // failover reopen of the writer
isWriteConnectionHealthy()
getReadReplicaLagMs()
getWalSizeBytes()
```

### Routing rules

- **Reads never call `ensurePartitionTable`**. Missing partitions return empty results.
- **Writes** create partitions via `ensurePartitionTable` / `ensurePartition`.

## Lag monitoring

`PRAGMA data_version` is compared on write vs read handles:

- Matching versions → `readLagMs = 0`
- Mismatch → lag ≈ ms since last successful write stamp

Exposed on:

- `getDbStatus()` → `readLagMs`, `walSizeBytes`, `writeHealthy`, `connectionsActive`
- `getDbDiagnostics().readReplica`
- Prometheus: `zkvote_db_read_lag_ms`, `zkvote_db_wal_size_bytes`, `zkvote_db_connections_active`, `zkvote_db_write_healthy`, `zkvote_db_write_failover_total`

`/metrics` refreshes these gauges on each scrape.

## Write failover

If the write connection fails (closed / `SQLITE_BUSY` / IO errors):

1. `markWriteFailure` sets `writeHealthy=false` and increments failover metrics.
2. `reconnectWriteDb()` (also attempted from `getWriteDb()` / `addEvent`) reopens the writer.
3. The **read** connection stays open so GET APIs can continue in degraded mode.
4. Mutating routes / indexer should treat `WriteConnectionUnavailableError` as 503 / pause.

After restore or `wal_checkpoint(TRUNCATE)`, call `reopenReadDb()`.

## Benchmarks / tests

```bash
cd backend && npm test -- --test-name-pattern='replica|concurrent readers'
```

`test/db-replica.test.js` covers:

- Readonly rejects inserts
- Reads do not create partitions
- Concurrent readers + writers with write p95 soft budget (&lt; 50ms)
- Write reconnect failover
- Diagnostics lag fields

## Security notes

- Readonly + `query_only` prevent API paths from mutating or running DDL.
- DAO IDs / event types remain allowlisted; parameterized queries unchanged.
- Metrics labels do not include raw SQL or PII.
