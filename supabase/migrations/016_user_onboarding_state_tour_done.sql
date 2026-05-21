-- ============================================================
-- Job Hunter Team — Dashboard tour persistence
-- Migration 016: aggiunge tour_done_at su user_onboarding_state
--
-- Contesto: il wizard di benvenuto in dashboard
-- (web/app/components/OnboardingWizard.tsx) salvava il flag
-- "tour_done" su `~/.jht/preferences.json` via /api/preferences.
-- Su Vercel il filesystem Lambda e' ephemeral: il PATCH non
-- persiste tra deploy/cold-start, quindi il tour si riapre
-- ogni volta che il beta tester carica /dashboard.
--
-- Soluzione: il flag vive sul DB, scoped per user_id. Riusiamo
-- user_onboarding_state perche' e' gia' la tabella canonica
-- dello stato di onboarding utente. Read e' via RLS user-scoped
-- gia' esistente; write avviene server-side via service role
-- (route /api/preferences PATCH), coerente con il pattern degli
-- altri stati su questa tabella.
-- ============================================================

ALTER TABLE user_onboarding_state
    ADD COLUMN IF NOT EXISTS tour_done_at TIMESTAMPTZ;

COMMENT ON COLUMN user_onboarding_state.tour_done_at IS
    'Timestamp prima volta che l''utente ha chiuso/completato il dashboard tour wizard. Settato server-side da /api/preferences PATCH quando body.ui_state.tour_done=true. NULL = tour mai visto/completato.';
