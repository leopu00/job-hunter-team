-- 014_applications_status_ready.sql
-- Bug #21 (Opzione B): lo Scrittore promuove applications.status='ready'
-- dopo Critic PASS. Il CHECK originale di 001_schema.sql escludeva
-- 'ready' dai valori legali, quindi il push dal SQLite locale al
-- Supabase falliva silenziosamente / le righe restavano in 'draft'.
--
-- Aggiungiamo 'ready' al constraint mantenendo la stessa lista di stati
-- documentata in db-update SKILL.md:
--   new → checked → scored → writing → ready → applied → response

ALTER TABLE applications
    DROP CONSTRAINT IF EXISTS applications_status_check;

ALTER TABLE applications
    ADD CONSTRAINT applications_status_check
    CHECK (status IN (
        'draft', 'review', 'ready', 'approved', 'applied', 'response'
    ));
