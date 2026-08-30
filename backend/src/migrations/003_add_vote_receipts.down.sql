-- ============================================
-- Migration 003: Rollback vote_receipts table
-- Created: 2026-08-26
-- ============================================

DROP INDEX IF EXISTS idx_vote_receipts_proposal;
DROP INDEX IF EXISTS idx_vote_receipts_dao_created;
DROP INDEX IF EXISTS idx_vote_receipts_nullifier;
DROP TABLE IF EXISTS vote_receipts;
