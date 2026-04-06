-- ============================================================
-- Job Hunter Team — Feedback tickets pubblici
-- Migration 005: ticketing leggero per pagina /feedback
-- ============================================================

CREATE TABLE IF NOT EXISTS feedback_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('bug', 'feature', 'ux', 'other')),
    description TEXT NOT NULL CHECK (char_length(trim(description)) > 0),
    screenshot_url TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in-progress', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_tickets_created_at
    ON feedback_tickets(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_tickets_status
    ON feedback_tickets(status);

ALTER TABLE feedback_tickets ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON feedback_tickets TO anon, authenticated;

DROP POLICY IF EXISTS "Public can read feedback tickets" ON feedback_tickets;
CREATE POLICY "Public can read feedback tickets"
    ON feedback_tickets FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Public can insert feedback tickets" ON feedback_tickets;
CREATE POLICY "Public can insert feedback tickets"
    ON feedback_tickets FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        status = 'open'
        AND rating BETWEEN 1 AND 5
        AND category IN ('bug', 'feature', 'ux', 'other')
        AND char_length(trim(description)) > 0
    );
