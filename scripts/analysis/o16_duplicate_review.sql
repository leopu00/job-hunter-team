-- O-16 — dedup dei messaggi duplicati da IDENTITÀ NON CONDIVISA.
--
-- ⛔ NON ESEGUIRE senza autorizzazione dell'operatore: sono dati veri di una
-- persona vera su Supabase di produzione. Questo file è la PROPOSTA da far
-- vedere prima, non uno script da lanciare.
--
-- Cosa sono questi duplicati: lo stesso messaggio scritto dal web esiste due
-- volte, una volta con la sua identità nativa (`legacy_id` negativo, che è
-- -(chat_ts in millisecondi)) e una volta ripubblicato dal box sotto un
-- `legacy_id` positivo, cioè l'id locale che il box gli aveva assegnato
-- all'import. Il fix (06e60506e) impedisce che ne nascano altri; queste sono
-- le righe già create prima.
--
-- ⚠️ Il tempo NON è una chiave: il box tronca `created_at` ai secondi, il web
-- tiene i millisecondi. Una selezione per `(user_id, agent, author,
-- created_at)` fa cadere le gemelle in gruppi diversi, ne trova 2 su 5 e
-- sembra risolto. Qui si accoppia per CORPO + autore, che è l'unica cosa che
-- le due copie condividono davvero, e si verifica a mano.

-- ── 1. I candidati, da guardare PRIMA di decidere qualsiasi cosa ─────────
-- Nessuna cancellazione: elenca le coppie e affianca lo stato di ciascuna,
-- che è il dato su cui si decide quale sopravvive.
WITH web_born AS (
  SELECT * FROM pending_user_messages WHERE legacy_id < 0
),
box_echo AS (
  SELECT * FROM pending_user_messages WHERE legacy_id > 0
)
SELECT
  w.user_id,
  w.legacy_id           AS web_legacy_id,
  b.legacy_id           AS box_legacy_id,
  w.agent,
  w.author,
  left(w.body, 60)      AS body_head,
  length(w.body)        AS body_len,
  w.created_at          AS web_created_at,
  b.created_at          AS box_created_at,
  -- Lo stato: è QUI che le due copie possono non essere uguali.
  w.delivered_at        AS web_delivered_at,
  b.delivered_at        AS box_delivered_at,
  w.acknowledged_at     AS web_acknowledged_at,
  b.acknowledged_at     AS box_acknowledged_at,
  w.user_reply          AS web_user_reply,
  b.user_reply          AS box_user_reply,
  w.agent_seen_reply_at AS web_agent_seen_reply_at,
  b.agent_seen_reply_at AS box_agent_seen_reply_at
FROM web_born w
JOIN box_echo b
  ON  b.user_id = w.user_id
  AND b.author  = w.author
  AND b.agent   = w.agent
  AND md5(b.body) = md5(w.body)
ORDER BY w.created_at;

-- Attesi: 5 righe, tutte dello stesso user_id e tutte author='user'
-- (legacy_id 47, 48, 49, 50 del 30/07 e 232 del 10/08).
-- Se ne escono 2, la selezione ha usato il tempo da qualche parte.
-- Se ne escono 6, la sesta NON è di questa famiglia: 38/114 sono lo stesso
-- messaggio scritto DUE VOLTE dentro il box (doppia scrittura in chat.jsonl,
-- 286 ms di distanza, due id LOCALI entrambi positivi) e non compaiono qui
-- proprio perché nessuna delle due ha `legacy_id` negativo. Ticket separato.

-- ── 2. Quale delle due sopravvive, e cosa si perde ───────────────────────
-- Proposta: SOPRAVVIVE LA NATIVA DEL WEB (legacy_id negativo).
--
-- Perché: è l'identità che il fix rende canonica. Da 06e60506e in poi il box
-- pusha i turni nati sul web sotto il `legacy_id` negativo, quindi ogni
-- aggiornamento futuro di quel messaggio (consegna, risposta, lettura) andrà
-- a finire sulla riga negativa. Tenere la positiva significherebbe conservare
-- la riga che da oggi nessuno aggiorna più.
--
-- ⚠️ COSA SI PERDE, che è la domanda giusta: "sono uguali" vale per il CORPO,
-- non per lo STATO. Le colonne delivered_at / acknowledged_at / user_reply /
-- user_reply_at / agent_seen_reply_at possono essere valorizzate su UNA sola
-- delle due — plausibilmente sulla positiva, perché è quella che il box ha
-- continuato a pushare finora. Cancellare la positiva senza guardare
-- butterebbe via la prova che quel messaggio era stato consegnato o che
-- l'utente aveva risposto: il messaggio resta, la sua storia no.
--
-- Per questo la query 1 affianca le colonne di stato. Tre esiti possibili:
--   a) lo stato è vuoto su entrambe  → cancellare la positiva non perde nulla;
--   b) lo stato è solo sulla negativa → idem, la positiva è un guscio;
--   c) lo stato è solo sulla positiva → NON cancellare prima di aver
--      RIPORTATO quei campi sulla negativa, altrimenti si perde davvero.
-- Il caso (c) è quello che mi aspetto per almeno alcune delle 4 righe del
-- 30/07, ed è il motivo per cui questo file non contiene nessuna DELETE.

-- ── 3. Il passo di travaso, da eseguire SOLO se ricorre il caso (c) ──────
-- Riporta sulla nativa lo stato che vive solo sull'eco, senza mai
-- sovrascrivere un valore già presente sulla nativa (COALESCE tiene il primo
-- non nullo). Idempotente: rieseguirlo non cambia nulla.
--
-- UPDATE pending_user_messages w
--    SET delivered_at        = COALESCE(w.delivered_at,        b.delivered_at),
--        acknowledged_at     = COALESCE(w.acknowledged_at,     b.acknowledged_at),
--        user_reply          = COALESCE(w.user_reply,          b.user_reply),
--        user_reply_at       = COALESCE(w.user_reply_at,       b.user_reply_at),
--        agent_seen_reply_at = COALESCE(w.agent_seen_reply_at, b.agent_seen_reply_at)
--   FROM pending_user_messages b
--  WHERE w.legacy_id < 0 AND b.legacy_id > 0
--    AND b.user_id = w.user_id AND b.author = w.author AND b.agent = w.agent
--    AND md5(b.body) = md5(w.body);

-- ── 4. La cancellazione, ultima e solo dopo il punto 3 ──────────────────
-- Elenca prima gli id esatti da cancellare (mai una DELETE su una JOIN vista
-- solo in astratto), poi si cancella per chiave primaria quella lista.
--
-- SELECT b.id FROM pending_user_messages b
--   JOIN pending_user_messages w
--     ON w.user_id = b.user_id AND w.author = b.author AND w.agent = b.agent
--    AND md5(w.body) = md5(b.body) AND w.legacy_id < 0
--  WHERE b.legacy_id > 0;
--
-- DELETE FROM pending_user_messages WHERE id IN (<la lista di sopra>);
