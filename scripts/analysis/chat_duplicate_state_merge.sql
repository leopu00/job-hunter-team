-- [CHAT-DUPLICATES-BORN-INSIDE-THE-BOX] — travaso dello STATO sulla riga che
-- sopravvive. Niente cancellazioni.
--
-- ⛔ NULLA DI QUESTO FILE È STATO ESEGUITO. Le mutazioni sono commentate: le
-- scommenta l'operatore, dopo aver letto il passo 1. Sono righe di persone
-- vere.
--
-- ── Cosa fa, e cosa NON fa ──────────────────────────────────────────────
-- FA: porta sulla riga che sopravvive lo stato che vive solo sulla gemella
-- (consegna, lettura, risposta dell'utente, vista dell'agente), senza mai
-- sovrascrivere un valore già presente. Idempotente: rieseguirlo non cambia
-- niente.
--
-- NON FA: cancellare. E non perché sia prudenza generica — perché **oggi la
-- cancellazione non è sicura**, per due motivi che vanno risolti prima, e
-- che sono il risultato più importante di questo file:
--
--   TRAPPOLA 1 — il full-push resuscita una cancellazione fatta sul cloud.
--   `handlePush` rilegge `pending_user_messages` INTERA a ogni «Sync now»
--   (nessun cursore, vedi il commento in cloud.js: «Pushiamo TUTTE le righe
--   ad ogni tick»). Cancellare la gemella su Supabase e lasciarla nella
--   SQLite del box significa riaverla al primo push. Quindi l'ordine è
--   obbligato: **prima il box, poi il cloud** — mai il contrario.
--
--   TRAPPOLA 2 — la riga cancellata sul box può rinascere da `chat.jsonl`.
--   Ogni gemella ha la propria riga nel file che legge il videogioco, con il
--   proprio `ts`. La dedup dell'ingest chiede alla tabella quali `ts` della
--   coda del file esistono già: tolta la riga dalla tabella, quel `ts` torna
--   sconosciuto e la riga viene reimportata al primo giro in cui il file si
--   muove. La coda letta è di 96 KB (`TAIL_BYTES`), quindi:
--     · gemella VECCHIA, la cui riga è già uscita dalla coda → cancellarla
--       è sicuro, il file non la ripropone;
--     · gemella RECENTE, ancora dentro i 96 KB → NON cancellare senza
--       togliere anche la sua riga da `<agente>/chat.jsonl`, altrimenti
--       ricompare identica.
--   Decidere se e come toccare `chat.jsonl` è una scelta di Leone: quel file
--   è la conversazione che l'utente vede nel gioco.
--
-- Il travaso qui sotto invece è sicuro in ogni caso, e va fatto comunque:
-- rende le due copie interscambiabili, così la cancellazione — quando e se
-- si farà — non potrà più perdere niente.

-- ════════════════════════════════════════════════════════════════════════
-- PASSO 1 — GUARDARE. Su Supabase. Da leggere prima di qualsiasi altra cosa.
-- ════════════════════════════════════════════════════════════════════════
-- Accoppia per corpo, come `o16_duplicate_review.sql`, ma con due filtri che
-- il file precedente non aveva e che servono a togliere il rumore:
--   · `legacy_id > 0` su entrambe: le coppie native-del-cloud sono l'altra
--     famiglia, già trattata in o16;
--   · distanza < 5 secondi: le coppie osservate a 34 s, 257 s e giorni NON
--     sono doppioni, sono lo stesso messaggio mandato di nuovo. Il join su
--     md5(body) le pesca, e includerle significherebbe fondere due turni
--     veri in uno.
WITH locali AS (
  SELECT * FROM pending_user_messages WHERE legacy_id > 0 AND chat_ts IS NOT NULL
)
SELECT
  a.user_id,
  a.agent,
  a.author,
  left(a.body, 50)                                       AS body_head,
  a.legacy_id                                            AS id_a,
  b.legacy_id                                            AS id_b,
  round((a.chat_ts - b.chat_ts)::numeric * 1000)         AS distanza_ms,
  -- La firma: chi porta il marchio del mirror viene da `jht-notify-user`.
  round((a.chat_ts - floor(a.chat_ts))::numeric, 3)
    = round(((a.legacy_id % 1000))::numeric / 1000, 3)   AS a_e_del_mirror,
  round((b.chat_ts - floor(b.chat_ts))::numeric, 3)
    = round(((b.legacy_id % 1000))::numeric / 1000, 3)   AS b_e_del_mirror,
  (b.chat_ts = floor(b.chat_ts))                         AS b_e_troncata,
  -- Lo stato, che è ciò su cui si decide: se sta solo su una delle due,
  -- cancellare quella senza travasare la perde.
  a.kind, b.kind                                         AS kind_b,
  a.delivered_via, b.delivered_via                       AS via_b,
  a.related_position_id, b.related_position_id           AS pos_b,
  a.delivered_at, b.delivered_at                         AS consegna_b,
  a.acknowledged_at, b.acknowledged_at                   AS letta_b,
  a.user_reply, b.user_reply                             AS risposta_b,
  a.agent_seen_reply_at, b.agent_seen_reply_at           AS vista_b
FROM locali a
JOIN locali b
  ON  b.user_id = a.user_id AND b.agent = a.agent AND b.author = a.author
  AND md5(b.body) = md5(a.body)
  AND b.legacy_id <> a.legacy_id
  AND abs(a.chat_ts - b.chat_ts) < 5
ORDER BY a.user_id, a.chat_ts, a.legacy_id;

-- ── Chi sopravvive, e perché ────────────────────────────────────────────
--
-- FIRMA A — due bocche (38/114): sopravvive **la riga del mirror**, cioè
-- quella scritta con `jht-notify-user` (`a_e_del_mirror` = true). È l'unica
-- che può portare `related_position_id`, un `kind` diverso da
-- 'notification' e `delivered_via='telegram'`, ed è quella che il flusso
-- delle risposte indirizza: il browser scrive `user_reply` su un id
-- preciso e `jht-check-user-replies` legge da lì. La gemella scritta con
-- `jht-send` è una bolla senza stato indirizzabile.
--
-- FIRMA B — troncamento (291/292): sopravvive **l'originale**, cioè quella
-- con la frazione NON tonda (`b_e_troncata` = false). Il suo `chat_ts`
-- corrisponde alla riga vera in `chat.jsonl`, quindi è quella che il gioco
-- e la dedup indicano; la gemella a frazione .000 è un artefatto del
-- ripescaggio e non corrisponde a nessuna riga del file.

-- ════════════════════════════════════════════════════════════════════════
-- PASSO 2 — TRAVASO SUL BOX (SQLite, `$JHT_HOME/jobs.db`). PRIMA di tutto.
-- ════════════════════════════════════════════════════════════════════════
-- Va fatto per primo perché il box è la sorgente del push: qualunque cosa si
-- faccia sul cloud, il prossimo «Sync now» ci rimanda quello che c'è qui.
-- `<SOPRAVVIVE>` e `<GEMELLA>` sono gli id LOCALI (= i `legacy_id` visti nel
-- passo 1). Idempotente: COALESCE tiene il primo non nullo.
--
-- UPDATE pending_user_messages AS s
--    SET delivered_at        = COALESCE(s.delivered_at,        g.delivered_at),
--        acknowledged_at     = COALESCE(s.acknowledged_at,     g.acknowledged_at),
--        user_reply          = COALESCE(s.user_reply,          g.user_reply),
--        user_reply_at       = COALESCE(s.user_reply_at,       g.user_reply_at),
--        agent_seen_reply_at = COALESCE(s.agent_seen_reply_at, g.agent_seen_reply_at),
--        related_position_id = COALESCE(s.related_position_id, g.related_position_id)
--   FROM pending_user_messages AS g
--  WHERE s.id = <SOPRAVVIVE> AND g.id = <GEMELLA>;
--
-- NB: `delivered_via` e `kind` NON si travasano. Non sono stato accumulato,
-- sono il modo in cui quella riga è stata prodotta: mescolarli racconterebbe
-- una consegna che non è avvenuta.

-- ════════════════════════════════════════════════════════════════════════
-- PASSO 3 — TRAVASO SUL CLOUD (Supabase). DOPO il passo 2.
-- ════════════════════════════════════════════════════════════════════════
-- Serve anche qui, e non è una ripetizione: il cloud possiede stato che il
-- box NON HA e non avrà mai. `acknowledged_at`, `user_reply` e
-- `user_reply_at` li scrive il browser, e il push è write-only local→cloud
-- (mig 060 li tiene cloud-first proprio per questo). Quindi la lettura e la
-- risposta dell'utente possono esistere solo sulla gemella cloud.
--
-- UPDATE pending_user_messages s
--    SET delivered_at        = COALESCE(s.delivered_at,        g.delivered_at),
--        acknowledged_at     = COALESCE(s.acknowledged_at,     g.acknowledged_at),
--        user_reply          = COALESCE(s.user_reply,          g.user_reply),
--        user_reply_at       = COALESCE(s.user_reply_at,       g.user_reply_at),
--        agent_seen_reply_at = COALESCE(s.agent_seen_reply_at, g.agent_seen_reply_at),
--        related_position_id = COALESCE(s.related_position_id, g.related_position_id)
--   FROM pending_user_messages g
--  WHERE s.user_id = g.user_id
--    AND s.legacy_id = <SOPRAVVIVE> AND g.legacy_id = <GEMELLA>;

-- ════════════════════════════════════════════════════════════════════════
-- PASSO 4 — LA CANCELLAZIONE: NON ANCORA, E NON DA QUI.
-- ════════════════════════════════════════════════════════════════════════
-- Dopo i passi 2 e 3 le due copie sono interscambiabili e nessuno stato può
-- più andare perso. La cancellazione resta comunque bloccata dalle due
-- trappole in testa a questo file:
--   · va fatta PRIMA sul box e POI sul cloud (trappola 1);
--   · e sul box non basta la riga: se il suo `ts` è ancora dentro gli ultimi
--     96 KB di `<agente>/chat.jsonl`, l'ingest la reimporta al primo giro
--     (trappola 2).
-- Per questo qui non c'è nessuna DELETE, nemmeno commentata: scriverla
-- inviterebbe a eseguirla, e oggi eseguirla rimetterebbe in piedi il
-- doppione facendo sembrare che la pulizia non funzioni.
--
-- Il passo mancante — decidere se e come togliere la riga gemella da
-- `chat.jsonl`, che è la conversazione che l'utente vede nel gioco — è una
-- scelta di prodotto, non di manutenzione.
