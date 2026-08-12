-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 075 — pairing browser realmente one-shot                      ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║ device-poll leggeva approved_token prima di un UPDATE "CAS-like", ma   ║
-- ║ non verificava se l'UPDATE avesse modificato una riga. Due poll potevano ║
-- ║ quindi leggere e restituire lo stesso bearer. Inoltre il bearer nasceva  ║
-- ║ senza scadenza: una sessione mai riscattata sopravviveva alla propria TTL║
-- ║ finché un cron opzionale non la ripuliva.                                ║
-- ║                                                                          ║
-- ║ La RPC sotto prende il row lock, consegna il plaintext soltanto al       ║
-- ║ consumer che consuma esattamente quella riga e rende permanente il token ║
-- ║ solo nello stesso commit. Su expiry revoca il bearer e azzera il         ║
-- ║ plaintext. Il cleanup mantiene la stessa semantica, ma non è più         ║
-- ║ necessario per la correttezza.                                           ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- Sessioni già approvate: fino al riscatto il bearer non può vivere più
-- della sessione. È una sanatoria conservativa, non estende mai una scadenza.
UPDATE public.cloud_sync_tokens AS token
SET expires_at = pairing.expires_at
FROM public.cloud_sync_pairing_sessions AS pairing
WHERE pairing.approved_token_id = token.id
  AND pairing.status = 'approved'
  AND pairing.expires_at > now()
  AND token.revoked_at IS NULL
  AND (token.expires_at IS NULL OR token.expires_at > pairing.expires_at);

-- Le approvazioni già scadute diventano inutilizzabili immediatamente.
UPDATE public.cloud_sync_tokens AS token
SET revoked_at = COALESCE(token.revoked_at, now())
FROM public.cloud_sync_pairing_sessions AS pairing
WHERE pairing.approved_token_id = token.id
  AND pairing.status IN ('pending', 'approved', 'expired')
  AND pairing.expires_at <= now();

UPDATE public.cloud_sync_pairing_sessions
SET status = 'expired',
    approved_token = NULL
WHERE status IN ('pending', 'approved', 'expired')
  AND expires_at <= now()
  AND (status <> 'expired' OR approved_token IS NOT NULL);

CREATE OR REPLACE FUNCTION public.redeem_cloud_sync_pairing(p_device_code text)
RETURNS TABLE(
  status text,
  approved_token text,
  user_id uuid,
  approved_token_id uuid,
  token_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pairing public.cloud_sync_pairing_sessions%ROWTYPE;
  token_value text;
  token_label text;
  changed integer;
BEGIN
  -- Il lock dura fino al commit della RPC. Il secondo poll osserva quindi lo
  -- stato consumed/expired, mai il plaintext letto dal primo.
  SELECT * INTO pairing
  FROM public.cloud_sync_pairing_sessions
  WHERE device_code = p_device_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::text, NULL::text, NULL::uuid,
      NULL::uuid, NULL::text;
    RETURN;
  END IF;

  IF pairing.expires_at <= now()
      AND pairing.status IN ('pending', 'approved', 'expired') THEN
    IF pairing.approved_token_id IS NOT NULL THEN
      UPDATE public.cloud_sync_tokens
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE id = pairing.approved_token_id;
    END IF;
    UPDATE public.cloud_sync_pairing_sessions
    SET status = 'expired', approved_token = NULL
    WHERE device_code = pairing.device_code;
    RETURN QUERY SELECT 'expired'::text, NULL::text, pairing.user_id,
      pairing.approved_token_id, NULL::text;
    RETURN;
  END IF;

  IF pairing.status = 'approved' THEN
    IF pairing.approved_token IS NULL
        OR pairing.approved_token_id IS NULL
        OR pairing.user_id IS NULL THEN
      RETURN QUERY SELECT 'invalid'::text, NULL::text, pairing.user_id,
        pairing.approved_token_id, NULL::text;
      RETURN;
    END IF;

    -- Il bearer diventa headless/no-expiry solo per il vincitore. Se il token
    -- è stato revocato o è già scaduto non viene consegnato.
    UPDATE public.cloud_sync_tokens
    SET expires_at = NULL
    WHERE id = pairing.approved_token_id
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    RETURNING name INTO token_label;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN
      -- Anche un token già scaduto viene revocato esplicitamente: l'expiry
      -- nega già l'uso, la revoca rende durevole e osservabile la chiusura.
      UPDATE public.cloud_sync_tokens
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE id = pairing.approved_token_id;
      UPDATE public.cloud_sync_pairing_sessions
      SET status = 'expired', approved_token = NULL
      WHERE device_code = pairing.device_code;
      RETURN QUERY SELECT 'expired'::text, NULL::text, pairing.user_id,
        pairing.approved_token_id, NULL::text;
      RETURN;
    END IF;

    token_value := pairing.approved_token;
    UPDATE public.cloud_sync_pairing_sessions AS session
    SET status = 'consumed',
        approved_token = NULL,
        consumed_at = now()
    WHERE session.device_code = pairing.device_code
      AND session.status = 'approved';
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN
      RAISE EXCEPTION 'pairing redemption changed % rows', changed;
    END IF;

    RETURN QUERY SELECT 'approved'::text, token_value, pairing.user_id,
      pairing.approved_token_id, token_label;
    RETURN;
  END IF;

  RETURN QUERY SELECT pairing.status, NULL::text, pairing.user_id,
    pairing.approved_token_id, NULL::text;
END;
$$;

-- Cleanup amministrativo: stessa revoca/wipe della corsia lazy. Il FOR UPDATE
-- usa lo stesso ordine di lock della redemption (sessione, poi token).
CREATE OR REPLACE FUNCTION public.cleanup_pairing_sessions()
RETURNS TABLE(expired_count int, deleted_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  pairing record;
  expired integer := 0;
  deleted integer := 0;
BEGIN
  FOR pairing IN
    SELECT device_code, approved_token_id
    FROM public.cloud_sync_pairing_sessions
    WHERE status IN ('pending', 'approved', 'expired')
      AND expires_at <= now()
      AND (status <> 'expired' OR approved_token IS NOT NULL)
    FOR UPDATE
  LOOP
    IF pairing.approved_token_id IS NOT NULL THEN
      UPDATE public.cloud_sync_tokens
      SET revoked_at = COALESCE(revoked_at, now())
      WHERE id = pairing.approved_token_id;
    END IF;
    UPDATE public.cloud_sync_pairing_sessions
    SET status = 'expired', approved_token = NULL
    WHERE device_code = pairing.device_code;
    expired := expired + 1;
  END LOOP;

  DELETE FROM public.cloud_sync_pairing_sessions
  WHERE (status = 'consumed' AND consumed_at < now() - interval '1 hour')
     OR (status = 'expired' AND expires_at < now() - interval '1 day');
  GET DIAGNOSTICS deleted = ROW_COUNT;

  RETURN QUERY SELECT expired, deleted;
END;
$$;

-- Le route server usano service_role. Nessun browser/utente può chiamare
-- direttamente funzioni SECURITY DEFINER che leggono plaintext o revocano.
REVOKE EXECUTE ON FUNCTION public.redeem_cloud_sync_pairing(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_cloud_sync_pairing(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.redeem_cloud_sync_pairing(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_cloud_sync_pairing(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cleanup_pairing_sessions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_pairing_sessions() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_pairing_sessions() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_pairing_sessions() TO service_role;
