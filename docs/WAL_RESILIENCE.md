# WAL Resilience & Database Reliability

## Configuration

All WAL resilience features are configured via environment variables with sensible defaults:

| Variable | Default | Description |
|---|---|---|
| `DB_BUSY_TIMEOUT_MS` | `5000` | SQLite busy timeout in milliseconds |
| `DB_CHECKPOINT_INTERVAL_MS` | `60000` | Interval between automatic WAL checkpoints (ms) |
| `DB_CHECKPOINT_TRANSACTION_COUNT` | `1000` | Write operations between transaction-based checkpoints |
| `DB_WAL_WARNING_THRESHOLD_BYTES` | `104857600` | WAL file size warning threshold (100 MB) |
| `DB_BACKUP_INTERVAL_MS` | `3600000` | Interval between periodic database backups (1 hour) |
| `DB_RETRY_COUNT` | `5` | Maximum SQLITE_BUSY retry attempts |
| `DB_RETRY_BASE_DELAY_MS` | `50` | Initial exponential backoff delay (ms) |
| `DB_RETRY_MAX_DELAY_MS` | `2000` | Maximum backoff delay between retries (ms) |

## WAL Checkpoint Behaviour

- An initial TRUNCATE checkpoint runs at startup to minimise the WAL from any prior process.
- PASSIVE checkpoints run every `DB_CHECKPOINT_INTERVAL_MS` (default: 60s).
- Checkpoints are non-blocking under normal operation and allow concurrent reads/writes.
- The transaction counter increments on every write operation (addEvent, insertAuditLog, upsertDao, etc.). Future work may trigger checkpoints based on transaction volume.

## Backup Behaviour

- Periodic backups copy the main database file via better-sqlite3's online backup API, plus any WAL and SHM files.
- Backups are stored in `<data-dir>/backups/zkvote-wal-backup-<timestamp>.db`.
- Backup frequency is controlled by `DB_BACKUP_INTERVAL_MS` (default: 1 hour).
- Backup success/failure is logged as structured events.
- Shutdown clears the backup timer.

## Recovery Expectations

- At startup, `PRAGMA integrity_check` is executed. Failure causes the application to abort with a structured error log.
- `detectAndHandleWalIssue` is called after startup to verify WAL health; it logs warnings for corruption, empty WAL files, or unreadable WAL files.
- The system does not automatically recover from corruption — operators must restore from a Litestream/S3 backup.
- SQLITE_BUSY errors are retried with exponential backoff up to `DB_RETRY_COUNT` times. Only BUSY errors are retried; other SQLite errors propagate immediately.
- After retries are exhausted, the original BUSY error is thrown with a structured log.

## Operational Guidance

### Monitoring

- WAL file size is monitored at the same interval as checkpoints.
- When the WAL exceeds `DB_WAL_WARNING_THRESHOLD_BYTES`, a structured warning is logged with current size, threshold, and database path.
- Missing WAL files are logged as warnings.
- Prometheus metric `zkvote_db_wal_size_bytes` tracks WAL size.

### Readiness Endpoint

The `/ready` endpoint now includes database health information:

```json
{
  "status": "ready",
  "rpc": { "ok": true },
  "db": {
    "available": true,
    "integrityOk": true,
    "integrityResult": "ok",
    "lastIntegrityCheck": "2026-07-28T12:00:00.000Z",
    "walSizeBytes": 12345,
    "walSizeThreshold": 104857600,
    "walOversized": false,
    "walFileExists": true,
    "lastCheckpoint": "2026-07-28T12:01:00.000Z",
    "lastBackup": "2026-07-28T11:00:00.000Z",
    "lastBackupStatus": "success"
  }
}
```

If database health is insufficient, the endpoint returns HTTP 503 with status `"degraded"`.

### Troubleshooting

- **Integrity check fails**: Restore from the latest Litestream replica or on-disk backup.
- **Persistent SQLITE_BUSY**: Increase `DB_BUSY_TIMEOUT_MS` and/or `DB_RETRY_COUNT`. Check for long-running transactions.
- **WAL grows excessively**: Reduce `DB_CHECKPOINT_INTERVAL_MS` or lower `DB_WAL_WARNING_THRESHOLD_BYTES`. Check that checkpoints are completing successfully.
- **Backup failures**: Verify disk space and write permissions in the data directory.