-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 023 — Security hardening sui trigger team_state (mig 019/022) ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ Address 2 advisor WARN introdotti dalle mig 019 e 022:                  ║
-- ║                                                                          ║
-- ║ 1. function_search_path_mutable su team_state_touch_updated_at          ║
-- ║    → aggiungo SET search_path = public                                  ║
-- ║                                                                          ║
-- ║ 2. anon|authenticated_security_definer_function_executable              ║
-- ║    su team_state_audit_trigger                                          ║
-- ║    → REVOKE EXECUTE da anon/authenticated (la funzione è solo per       ║
-- ║      trigger interno, non deve essere callable via /rest/v1/rpc/)       ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

CREATE OR REPLACE FUNCTION team_state_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION team_state_audit_trigger() FROM anon, authenticated;
