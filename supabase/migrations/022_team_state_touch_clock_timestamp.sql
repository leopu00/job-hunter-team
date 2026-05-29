-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 022 — Fix touch_updated_at trigger: clock_timestamp()          ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ `now()` (= transaction_timestamp) è fisso per tutta la transazione,      ║
-- ║ quindi 2 UPDATE nella stessa tx producono lo STESSO updated_at e UI      ║
-- ║ non sa distinguere. `clock_timestamp()` invece avanza ad ogni chiamata.  ║
-- ║                                                                          ║
-- ║ Discovered durante test funzionale post-019 (UPDATE consecutivi nella    ║
-- ║ stessa transazione non avanzavano updated_at).                            ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION team_state_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;
