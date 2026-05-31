-- 2026-05-31 — Migration 024: FK indexes
--
-- Copre i 9 unindexed_foreign_keys finding emersi dall'audit Supabase
-- del 2026-05-20 (docs/internal/2026-05-20-supabase-perf-backlog.md).
--
-- FK senza index causano seq-scan su JOIN e su ON DELETE/UPDATE
-- CASCADE. Al volume attuale (positions ~50 row) l'impatto è basso,
-- ma cresce O(N) col carico. Va applicato prima del lancio pubblico.
--
-- Tutti gli IDX usano `IF NOT EXISTS` per essere idempotenti.
-- Niente `CONCURRENTLY` (le tabelle figlie sono ancora piccole; il
-- lock è negligibile e CONCURRENTLY non gira dentro una transazione
-- gestita da apply_migration).

CREATE INDEX IF NOT EXISTS idx_applications_user_id
  ON public.applications(user_id);

CREATE INDEX IF NOT EXISTS idx_cloud_sync_pairing_sessions_approved_token_id
  ON public.cloud_sync_pairing_sessions(approved_token_id);

CREATE INDEX IF NOT EXISTS idx_cloud_sync_pairing_sessions_user_id
  ON public.cloud_sync_pairing_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_companies_user_id
  ON public.companies(user_id);

CREATE INDEX IF NOT EXISTS idx_pending_user_messages_related_position_id
  ON public.pending_user_messages(related_position_id);

CREATE INDEX IF NOT EXISTS idx_position_highlights_position_id
  ON public.position_highlights(position_id);

CREATE INDEX IF NOT EXISTS idx_position_highlights_user_id
  ON public.position_highlights(user_id);

CREATE INDEX IF NOT EXISTS idx_positions_company_id
  ON public.positions(company_id);

CREATE INDEX IF NOT EXISTS idx_scores_user_id
  ON public.scores(user_id);
