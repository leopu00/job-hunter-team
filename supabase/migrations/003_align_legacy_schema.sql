-- ============================================================
-- Migration 003: allinea schema Supabase con legacy SQLite V2
-- Aggiunge campi mancanti + tabella position_highlights
-- ============================================================

-- ── COMPANIES: campi mancanti ─────────────────────────────────
ALTER TABLE companies ADD COLUMN IF NOT EXISTS sector TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS glassdoor_rating REAL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS red_flags TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS culture_notes TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS analyzed_by TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS analyzed_at TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS verdict TEXT;

-- ── POSITIONS: campi mancanti ─────────────────────────────────
ALTER TABLE positions ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
ALTER TABLE positions ADD COLUMN IF NOT EXISTS salary_declared_currency TEXT DEFAULT 'EUR';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS salary_estimated_currency TEXT DEFAULT 'EUR';
ALTER TABLE positions ADD COLUMN IF NOT EXISTS found_by TEXT;
ALTER TABLE positions ADD COLUMN IF NOT EXISTS deadline TEXT;

CREATE INDEX IF NOT EXISTS idx_positions_company_id ON positions(company_id);

-- ── SCORES: campi mancanti ────────────────────────────────────
ALTER TABLE scores ADD COLUMN IF NOT EXISTS stack_match INTEGER;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS remote_fit INTEGER;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS strategic_fit INTEGER;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS breakdown TEXT;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS scored_by TEXT;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS pros TEXT;
ALTER TABLE scores ADD COLUMN IF NOT EXISTS cons TEXT;

-- ── APPLICATIONS: campi mancanti ──────────────────────────────
ALTER TABLE applications ADD COLUMN IF NOT EXISTS cl_path TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS cl_pdf_path TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS critic_notes TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applied_via TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS written_by TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS critic_reviewed_at TIMESTAMPTZ;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS applied BOOLEAN DEFAULT FALSE;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS cv_drive_id TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS cl_drive_id TEXT;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS critic_round INTEGER DEFAULT 0;

-- ── POSITION_HIGHLIGHTS: tabella nuova ────────────────────────
CREATE TABLE IF NOT EXISTS position_highlights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    position_id UUID NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('pro', 'con')),
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_highlights_position_id ON position_highlights(position_id);
CREATE INDEX IF NOT EXISTS idx_highlights_user_id ON position_highlights(user_id);

-- ── RLS per position_highlights ───────────────────────────────
ALTER TABLE position_highlights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own highlights"
    ON position_highlights FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own highlights"
    ON position_highlights FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own highlights"
    ON position_highlights FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own highlights"
    ON position_highlights FOR DELETE
    USING (auth.uid() = user_id);
