-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 020 — Enable RLS on location_geocode (shared geocoding cache)  ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ Address Supabase advisor `rls_disabled` (critical) su location_geocode:  ║
-- ║   tabella senza user_id (cache pubblica di geocoding) esposta via anon   ║
-- ║   key per write → cache poisoning possibile.                             ║
-- ║                                                                          ║
-- ║ Strategia:                                                                ║
-- ║   • SELECT pubblica (authenticated + anon): cache va letta da tutti       ║
-- ║   • INSERT/UPDATE/DELETE: solo service_role (API server-side, agenti)     ║
-- ║                                                                          ║
-- ║ Origin migrazione 017 (world-globe feature).                              ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE location_geocode ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone reads geocode cache"
    ON location_geocode FOR SELECT
    TO authenticated, anon
    USING (true);

-- Nessuna policy per INSERT/UPDATE/DELETE → solo service_role può scrivere
-- (RLS è bypassato da service_role per design).
