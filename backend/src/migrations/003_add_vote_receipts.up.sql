-- ============================================
-- Migration 003: Add vote_receipts table
-- Created: 2026-08-26
-- ============================================

-- Store vote confirmation receipts for user verification
CREATE TABLE IF NOT EXISTS vote_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nullifier TEXT NOT NULL UNIQUE,
  tx_hash TEXT NOT NULL,
  proposal_id INTEGER NOT NULL,
  dao_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'pending', 'failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  FOREIGN KEY (dao_id) REFERENCES daos(id)
);

-- Index for efficient receipt lookups
CREATE INDEX IF NOT EXISTS idx_vote_receipts_nullifier ON vote_receipts(nullifier);
CREATE INDEX IF NOT EXISTS idx_vote_receipts_dao_created ON vote_receipts(dao_id, created_at);
CREATE INDEX IF NOT EXISTS idx_vote_receipts_proposal ON vote_receipts(proposal_id);
