-- 044_position_transitions.sql
-- Log per-istanza delle transizioni di stato delle posizioni, sincronizzato dal
-- DB locale (jobs.db → position_state_transitions). Serve a mostrare CHI, nello
-- specifico (scout-1, analista-2, scorer-4…), ha fatto cosa e quando: le colonne
-- *_by su positions/scores sono "ultimo attore" e perdono l'attribuzione
-- intermedia (es. l'analista che ha analizzato prima che lo scorer scrivesse).
--
-- Chiave verso le posizioni = `position_legacy_id` (l'id intero locale, == a
-- positions.legacy_id) invece dell'uuid: così le righe sono portabili tra account
-- (l'uuid è per-account, il legacy_id è stabile) e la copia/mirror è banale.
-- Join lato app: position_transitions.position_legacy_id = positions.legacy_id
--                AND positions.user_id = auth.uid()  (dentro la RLS).

CREATE TABLE IF NOT EXISTS position_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    position_legacy_id INTEGER NOT NULL,
    from_state TEXT,
    to_state TEXT,
    ts TIMESTAMPTZ NOT NULL,
    by_agent TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    -- Idempotenza: un push ripetuto non duplica le righe.
    UNIQUE (user_id, position_legacy_id, ts, by_agent, to_state)
);

CREATE INDEX IF NOT EXISTS idx_position_transitions_user_id
    ON position_transitions(user_id);
CREATE INDEX IF NOT EXISTS idx_position_transitions_user_ts
    ON position_transitions(user_id, ts);
CREATE INDEX IF NOT EXISTS idx_position_transitions_user_pos
    ON position_transitions(user_id, position_legacy_id);

-- ── ROW LEVEL SECURITY ─────────────────────────────────────
ALTER TABLE position_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own position_transitions"
    ON position_transitions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own position_transitions"
    ON position_transitions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own position_transitions"
    ON position_transitions FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own position_transitions"
    ON position_transitions FOR DELETE
    USING (auth.uid() = user_id);
