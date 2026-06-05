-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 032 — REVOKE EXECUTE su funzioni non destinate a /rest/v1/rpc  ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ Chiude l'advisor WARN `*_security_definer_function_executable`:          ║
-- ║                                                                          ║
-- ║   - cleanup_pairing_sessions: utility di manutenzione (cron/admin),     ║
-- ║     NON chiamata da nessun client nel codice.                           ║
-- ║   - team_state_audit_trigger: funzione-trigger interna, non ha senso    ║
-- ║     come RPC.                                                            ║
-- ║                                                                          ║
-- ║ NOTA (gotcha che la mig 023 aveva mancato): in Postgres le funzioni     ║
-- ║ concedono EXECUTE a PUBLIC per default. anon/authenticated NON hanno    ║
-- ║ un grant diretto — lo ereditano da PUBLIC. Revocare dai singoli ruoli   ║
-- ║ (come faceva la 023) è quindi INEFFICACE: bisogna revocare da PUBLIC.   ║
-- ║                                                                          ║
-- ║ service_role ha un grant ESPLICITO (acl `service_role=X`), preservato   ║
-- ║ da questa revoke → cron job e API route interne continuano a funzionare.║
-- ║ I trigger scattano comunque (non dipendono dall'EXECUTE del chiamante). ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

REVOKE EXECUTE ON FUNCTION cleanup_pairing_sessions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION team_state_audit_trigger()  FROM PUBLIC;
