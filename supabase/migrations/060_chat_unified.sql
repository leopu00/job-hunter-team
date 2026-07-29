-- 060_chat_unified.sql
--
-- [JHT-CHAT-UNIFY] Una sola conversazione utente ↔ agente, condivisa fra
-- videogioco e web (2026-07-29).
--
-- ── Il problema ─────────────────────────────────────────────────────────
-- Fino a qui esistevano DUE storie separate della stessa chat:
--   · gioco  → `/jht_home/agents/<ruolo>/chat.jsonl` sul box, mai sul cloud;
--   · web    → `pending_user_messages`, che sa rappresentare SOLO messaggi
--              AGENTE→UTENTE con un unico campo `user_reply` appeso.
-- Conseguenze osservate: quello che l'utente scriveva nel gioco non appariva
-- mai sul web; sul web l'utente poteva scrivere solo "rispondendo" a un
-- messaggio dell'agente ancora senza risposta — finiti quelli, il composer
-- si spegneva con "Nessun messaggio in attesa di risposta".
--
-- ── La forma nuova ──────────────────────────────────────────────────────
-- `pending_user_messages` diventa il MIRROR CLOUD della conversazione, non
-- più solo la coda di notifiche. Ogni riga è UN turno, con un autore:
--   · `author='agent'` — l'agente parla (jht-notify-user o jht-send);
--   · `author='user'`  — l'utente parla (web o gioco), turno a sé stante.
-- `user_reply` resta dov'è e continua a funzionare: le conversazioni già
-- salvate non si riscrivono e i client vecchi non si accorgono di nulla.
--
-- ── legacy_id negativo = riga NATIVA DEL CLOUD ──────────────────────────
-- Un messaggio scritto dal web non esiste nella SQLite del box, quindi non
-- ha un id locale da mettere in `legacy_id` (NOT NULL, UNIQUE con user_id).
-- Convenzione: il web usa `-epoch_ms`. Lo spazio negativo è irraggiungibile
-- da SQLite (AUTOINCREMENT parte da 1), quindi non collide MAI col push del
-- box e il full-push non può sovrascrivere queste righe: semplicemente non
-- le manda. Il box le legge, le consegna all'agente e ne timbra
-- `delivered_at` — non le reimporta.
--
-- ── chat_ts = chiave di dedup col chat.jsonl ────────────────────────────
-- Il box specchia `chat.jsonl` ⇄ questa tabella. `chat_ts` è il `ts` unix
-- della riga JSONL: presente ⇒ il turno è già nel file dell'agente (e quindi
-- già visibile nel gioco). È la guardia anti-loop del mirror: senza, ogni
-- giro riscriverebbe nel file quello che ne ha appena letto.
--
-- ── Il risveglio del box ────────────────────────────────────────────────
-- `team_state.chat_requested_at` è il gemello di `sync_requested_at` (mig
-- 045): il web lo timbra quando l'utente manda un messaggio, il daemon lo
-- vede nel giro veloce (~5s) — che quella riga la legge GIÀ — e va a
-- prendersi i turni non consegnati. Zero letture Supabase in più a riposo,
-- zero polling del browser.
--
-- Additiva e retro-compatibile: default `author='agent'` ⇒ tutto lo storico
-- resta esattamente com'era.

-- ── 1. Turni della conversazione ────────────────────────────────────────

ALTER TABLE pending_user_messages
    ADD COLUMN IF NOT EXISTS author TEXT NOT NULL DEFAULT 'agent',
    ADD COLUMN IF NOT EXISTS chat_ts DOUBLE PRECISION;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pending_user_messages_author_check'
    ) THEN
        ALTER TABLE pending_user_messages
            ADD CONSTRAINT pending_user_messages_author_check
            CHECK (author IN ('agent', 'user'));
    END IF;
END $$;

-- Il box cerca "i turni dell'utente che non ho ancora consegnato all'agente".
-- Parziale: a regime la coda è vuota o quasi, l'indice resta minuscolo.
CREATE INDEX IF NOT EXISTS idx_pending_user_messages_undelivered_user
    ON pending_user_messages(user_id, created_at)
    WHERE author = 'user' AND delivered_at IS NULL;

-- ── 2. Il browser può inserire i PROPRI turni ───────────────────────────
-- Unica eccezione al web read-only ([JHT-WEB-READONLY]): la chat. Stretta
-- il più possibile — solo righe proprie, solo `author='user'`, solo nello
-- spazio legacy_id negativo (nessuna sovrascrittura di righe del box).
-- Restano vietati UPDATE su campi dell'agente e qualunque DELETE.
DROP POLICY IF EXISTS "Users can insert own chat turns" ON pending_user_messages;
CREATE POLICY "Users can insert own chat turns"
    ON pending_user_messages FOR INSERT
    TO authenticated
    WITH CHECK (
        (SELECT auth.uid()) = user_id
        AND author = 'user'
        AND legacy_id < 0
    );

-- ── 3. Rendezvous chat (gemello di sync_requested_at, mig 045) ──────────

ALTER TABLE team_state
    ADD COLUMN IF NOT EXISTS chat_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS chat_delivered_at TIMESTAMPTZ;

-- ── 4. Merge-upsert del push: porta su anche i campi nuovi ──────────────
-- Stessa logica di mig 057 (campi agente → vince il push; campi utente →
-- COALESCE cloud-first; anti no-op per non generare eventi Realtime
-- spurii), con due aggiunte:
--   · `author`  — proprietà del box (è lui a sapere chi ha scritto la riga
--     nella SQLite), ma con COALESCE su 'agent' per i client vecchi che non
--     mandano il campo: un push vecchio NON deve declassare a 'agent' un
--     turno che sul cloud è 'user'.
--   · `chat_ts` — locale autoritativo come `agent_seen_reply_at`: lo scrive
--     il mirror sul box quando la riga entra/esce da chat.jsonl.
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
      CASE WHEN r->>'author' = 'user' THEN 'user' ELSE 'agent' END AS author,
      NULLIF(r->>'chat_ts', '')::double precision            AS chat_ts,
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
      -- Guardia sullo spazio nativo del cloud: una riga con legacy_id
      -- negativo NON può arrivare da SQLite. Se ci arriva è un bug del
      -- client o un payload manomesso → si scarta, non si sovrascrive
      -- il turno che l'utente ha scritto dal browser.
      AND (r->>'legacy_id')::bigint > 0
  ), upserted AS (
    INSERT INTO pending_user_messages (
      user_id, legacy_id, agent, body, kind, author, chat_ts, related_position_id,
      delivered_via, delivered_at, acknowledged_at,
      user_reply, user_reply_at, agent_seen_reply_at, created_at
    )
    SELECT user_id, legacy_id, agent, body, kind, author, chat_ts, related_position_id,
           delivered_via, delivered_at, acknowledged_at,
           user_reply, user_reply_at, agent_seen_reply_at, created_at
    FROM incoming
    ON CONFLICT (user_id, legacy_id) DO UPDATE SET
      agent               = EXCLUDED.agent,
      body                = EXCLUDED.body,
      kind                = EXCLUDED.kind,
      -- author: il push vince SOLO se dice davvero qualcosa ('user'); un
      -- client vecchio manda sempre 'agent' per default e non deve
      -- riscrivere un turno utente già classificato sul cloud.
      author              = CASE
                              WHEN EXCLUDED.author = 'user' THEN 'user'
                              ELSE pending_user_messages.author
                            END,
      chat_ts             = COALESCE(EXCLUDED.chat_ts, pending_user_messages.chat_ts),
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
       OR (EXCLUDED.author = 'user' AND pending_user_messages.author IS DISTINCT FROM 'user')
       OR (EXCLUDED.chat_ts IS NOT NULL
           AND pending_user_messages.chat_ts IS DISTINCT FROM EXCLUDED.chat_ts)
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
