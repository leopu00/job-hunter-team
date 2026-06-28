-- ============================================================
-- Job Hunter Team — File bridge on-demand
-- Migration 037.  Vedi docs/internal/file-bridge-on-demand-2026-06-07.md
--
-- Bridge effimero per i file (CV/cover letter/allegati) tra container VPS
-- e web pubblico. I binari NON stanno nel DB: qui creiamo SOLO
--   (a) candidate_files       — indice persistente dei file (no binari)
--   (b) file_bridge_requests  — coda effimera delle richieste on-demand
--   (c) bucket 'file-transit' — storage di transito, privato
--
-- Trasporto: pull on-demand. Il file sale nel bucket SOLO quando l'utente
-- lo chiede e viene purgato dopo un TTL corto. Tutte le mutazioni sullo
-- Storage le fa il web (service-role); la VPS carica via signed upload URL.
--
-- Additivo e idempotente: non tocca dati esistenti.
-- ============================================================

-- ── (a) candidate_files: indice dei file disponibili (no binari) ──────
-- Popolato dalla VPS (poller) via /api/cloud-sync/file-index, letto dal
-- web per la sezione "Anteprima CV" quando gira su cloud (no filesystem).
CREATE TABLE IF NOT EXISTS candidate_files (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    category        TEXT,                      -- cv | cover_letter | attachment | other
    sha256          TEXT,
    size            BIGINT,
    mime            TEXT,
    location_on_vps TEXT,                      -- path assoluto sul container (per il poller)
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS candidate_files_user_idx
    ON candidate_files (user_id);

ALTER TABLE candidate_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "candidate_files select own" ON candidate_files;
CREATE POLICY "candidate_files select own"
    ON candidate_files FOR SELECT
    USING ((select auth.uid()) = user_id);
-- Scrittura: solo service-role (poller VPS via endpoint web), bypassa RLS.

-- ── (b) file_bridge_requests: coda effimera on-demand ────────────────
-- Il browser INSERISCE (RLS own); la VPS legge/transiziona via service-role.
CREATE TABLE IF NOT EXISTS file_bridge_requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    file_name    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','uploading','ready','served','error','expired')),
    storage_path TEXT,
    error        TEXT,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS file_bridge_requests_user_status_idx
    ON file_bridge_requests (user_id, status);
CREATE INDEX IF NOT EXISTS file_bridge_requests_expires_idx
    ON file_bridge_requests (expires_at)
    WHERE expires_at IS NOT NULL;

ALTER TABLE file_bridge_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "file_bridge_requests select own" ON file_bridge_requests;
CREATE POLICY "file_bridge_requests select own"
    ON file_bridge_requests FOR SELECT
    USING ((select auth.uid()) = user_id);
DROP POLICY IF EXISTS "file_bridge_requests insert own" ON file_bridge_requests;
CREATE POLICY "file_bridge_requests insert own"
    ON file_bridge_requests FOR INSERT
    WITH CHECK ((select auth.uid()) = user_id);
-- UPDATE/DELETE: solo service-role (transizioni dalla VPS, purge dal web).

-- ── (c) bucket di transito (privato) ─────────────────────────────────
-- Gli oggetti sono raggiungibili SOLO via signed URL mintate dal
-- service-role: nessuna policy anon/authenticated su storage.objects, così
-- l'accesso diretto resta chiuso (RLS di storage.objects già attiva).
INSERT INTO storage.buckets (id, name, public)
VALUES ('file-transit', 'file-transit', false)
ON CONFLICT (id) DO NOTHING;
