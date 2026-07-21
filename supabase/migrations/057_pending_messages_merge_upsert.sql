-- 057_pending_messages_merge_upsert.sql
--
-- [JHT-MSG-BACKFLOW] Fix perdita reply/ack scritti dal web (2026-07-21).
--
-- Il full-push VPS→cloud di `pending_user_messages` (upsert su
-- user_id+legacy_id) sovrascriveva i campi DI PROPRIETÀ DELL'UTENTE
-- (`acknowledged_at`, `user_reply`, `user_reply_at`) con i NULL della
-- SQLite locale: una reply scritta dalla chat web spariva al tick di
-- sync successivo (~30-60s) e l'agente non la vedeva mai.
--
-- Questo RPC sposta l'upsert dentro Postgres con merge per-campo:
--   · campi AGENTE (body, kind, delivered_*) → vince il push (VPS autoritativa)
--   · campi UTENTE (ack/reply)               → si preservano se già valorizzati
--     sul cloud (COALESCE cloud-first); il push li porta SU solo quando il
--     locale li ha (es. ack fatto dal desktop/gioco).
--   · agent_seen_reply_at → locale autoritativo (lo scrive l'agente).
--
-- Chiamato SOLO dal service_role (route /api/cloud-sync/push). SECURITY
-- DEFINER + revoke: mai esposto ad anon/authenticated.

CREATE OR REPLACE FUNCTION public.upsert_pending_user_messages_merge(p_rows jsonb)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH incoming AS (
    SELECT
      (r->>'user_id')::uuid                                  AS user_id,
      (r->>'legacy_id')::bigint                              AS legacy_id,
      r->>'agent'                                            AS agent,
      r->>'body'                                             AS body,
      COALESCE(NULLIF(r->>'kind', ''), 'notification')       AS kind,
      NULLIF(r->>'related_position_id', '')::uuid            AS related_position_id,
      NULLIF(r->>'delivered_via', '')                        AS delivered_via,
      NULLIF(r->>'delivered_at', '')::timestamptz            AS delivered_at,
      NULLIF(r->>'acknowledged_at', '')::timestamptz         AS acknowledged_at,
      NULLIF(r->>'user_reply', '')                           AS user_reply,
      NULLIF(r->>'user_reply_at', '')::timestamptz           AS user_reply_at,
      NULLIF(r->>'agent_seen_reply_at', '')::timestamptz     AS agent_seen_reply_at,
      COALESCE(NULLIF(r->>'created_at', '')::timestamptz, now()) AS created_at
    FROM jsonb_array_elements(p_rows) AS r
    WHERE r->>'user_id' IS NOT NULL
      AND r->>'legacy_id' IS NOT NULL
      AND r->>'agent' IS NOT NULL
      AND r->>'body' IS NOT NULL
  ), upserted AS (
    INSERT INTO pending_user_messages (
      user_id, legacy_id, agent, body, kind, related_position_id,
      delivered_via, delivered_at, acknowledged_at,
      user_reply, user_reply_at, agent_seen_reply_at, created_at
    )
    SELECT user_id, legacy_id, agent, body, kind, related_position_id,
           delivered_via, delivered_at, acknowledged_at,
           user_reply, user_reply_at, agent_seen_reply_at, created_at
    FROM incoming
    ON CONFLICT (user_id, legacy_id) DO UPDATE SET
      agent               = EXCLUDED.agent,
      body                = EXCLUDED.body,
      kind                = EXCLUDED.kind,
      -- link posizione: il push lo manda NULL quando non sa risolvere il
      -- legacy_id → non degradare un link già presente sul cloud.
      related_position_id = COALESCE(EXCLUDED.related_position_id, pending_user_messages.related_position_id),
      delivered_via       = COALESCE(EXCLUDED.delivered_via, pending_user_messages.delivered_via),
      delivered_at        = COALESCE(EXCLUDED.delivered_at, pending_user_messages.delivered_at),
      -- campi utente: il cloud è autoritativo quando valorizzato.
      acknowledged_at     = COALESCE(pending_user_messages.acknowledged_at, EXCLUDED.acknowledged_at),
      user_reply          = COALESCE(pending_user_messages.user_reply, EXCLUDED.user_reply),
      user_reply_at       = COALESCE(pending_user_messages.user_reply_at, EXCLUDED.user_reply_at),
      -- agent_seen_reply_at: locale autoritativo (lo scrive l'agente sulla VPS).
      agent_seen_reply_at = COALESCE(EXCLUDED.agent_seen_reply_at, pending_user_messages.agent_seen_reply_at)
    -- Skip dei no-op: il full-push rimanda TUTTE le righe a ogni tick — senza
    -- questa WHERE ogni riga verrebbe riscritta identica (churn di updated_at,
    -- eventi Realtime spurii verso i browser sottoscritti, write amplification
    -- su Supabase). Si aggiorna solo se il merge cambierebbe davvero qualcosa.
    WHERE pending_user_messages.agent IS DISTINCT FROM EXCLUDED.agent
       OR pending_user_messages.body  IS DISTINCT FROM EXCLUDED.body
       OR pending_user_messages.kind  IS DISTINCT FROM EXCLUDED.kind
       OR (EXCLUDED.related_position_id IS NOT NULL
           AND pending_user_messages.related_position_id IS DISTINCT FROM EXCLUDED.related_position_id)
       OR (EXCLUDED.delivered_via IS NOT NULL
           AND pending_user_messages.delivered_via IS DISTINCT FROM EXCLUDED.delivered_via)
       OR (EXCLUDED.delivered_at IS NOT NULL
           AND pending_user_messages.delivered_at IS DISTINCT FROM EXCLUDED.delivered_at)
       OR (pending_user_messages.acknowledged_at IS NULL AND EXCLUDED.acknowledged_at IS NOT NULL)
       OR (pending_user_messages.user_reply IS NULL AND EXCLUDED.user_reply IS NOT NULL)
       OR (pending_user_messages.user_reply_at IS NULL AND EXCLUDED.user_reply_at IS NOT NULL)
       OR (EXCLUDED.agent_seen_reply_at IS NOT NULL
           AND pending_user_messages.agent_seen_reply_at IS DISTINCT FROM EXCLUDED.agent_seen_reply_at)
    RETURNING 1
  )
  SELECT COUNT(*)::integer FROM upserted;
$$;

REVOKE ALL ON FUNCTION public.upsert_pending_user_messages_merge(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_pending_user_messages_merge(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.upsert_pending_user_messages_merge(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_pending_user_messages_merge(jsonb) TO service_role;
