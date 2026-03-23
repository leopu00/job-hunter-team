-- ============================================================
-- Migration 002: add interview_round to applications
-- Allinea schema PostgreSQL con SQLite V2 (PR #9)
-- ============================================================

ALTER TABLE applications
    ADD COLUMN interview_round INTEGER DEFAULT NULL;
