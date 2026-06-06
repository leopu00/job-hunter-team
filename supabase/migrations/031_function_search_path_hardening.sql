-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 031 — search_path hardening su 3 funzioni residue              ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ Chiude l'advisor WARN `function_search_path_mutable` sulle funzioni     ║
-- ║ ancora prive di `SET search_path` (la mig 023 aveva già coperto i       ║
-- ║ trigger di team_state):                                                 ║
-- ║                                                                          ║
-- ║   - update_updated_at                  (trigger, SECURITY INVOKER)      ║
-- ║   - encrypted_user_blobs_set_updated_at (trigger, SECURITY INVOKER)     ║
-- ║   - cleanup_pairing_sessions            (RPC utility, SECURITY DEFINER) ║
-- ║                                                                          ║
-- ║ Difesa in profondità: fissare il search_path impedisce il dirottamento ║
-- ║ di oggetti non qualificati. Nessun cambio di comportamento — i corpi   ║
-- ║ sono identici alle definizioni originali (mig 001 / 009 / 008).        ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- update_updated_at — touch generico updated_at (def. originale: mig 001)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- encrypted_user_blobs_set_updated_at — touch updated_at (def. originale: mig 009)
CREATE OR REPLACE FUNCTION encrypted_user_blobs_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

-- cleanup_pairing_sessions — utility di retention sessioni pairing
-- (def. originale: mig 008). Resta SECURITY DEFINER: la REVOKE EXECUTE
-- ai ruoli client è gestita separatamente nella mig 032.
CREATE OR REPLACE FUNCTION cleanup_pairing_sessions()
RETURNS TABLE(expired_count INT, deleted_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    expired INT;
    deleted INT;
BEGIN
    UPDATE cloud_sync_pairing_sessions
    SET status = 'expired'
    WHERE status IN ('pending', 'approved')
      AND expires_at < now();
    GET DIAGNOSTICS expired = ROW_COUNT;

    DELETE FROM cloud_sync_pairing_sessions
    WHERE (status = 'consumed' AND consumed_at < now() - interval '1 hour')
       OR (status = 'expired' AND expires_at < now() - interval '1 day');
    GET DIAGNOSTICS deleted = ROW_COUNT;

    RETURN QUERY SELECT expired, deleted;
END;
$$;
