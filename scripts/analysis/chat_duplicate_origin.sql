-- [CHAT-DUPLICATES-BORN-INSIDE-THE-BOX] — da QUALE bocca è entrata ciascuna
-- delle due copie.
--
-- ⛔ SOLA LETTURA. Nessuna DELETE, nessuna UPDATE, nemmeno commentata: le
-- righe sono di una persona vera e la domanda di questo file non è "quale
-- tengo" ma "chi le ha scritte". Va fatta vedere prima di eseguirla.
--
-- ── Perché serve ────────────────────────────────────────────────────────
-- I tre difetti chiusi l'11/08 (finestra di dedup dell'ingest, mirror che
-- riscrive dopo un giro morto, dedup fuori dalla scrittura) producono tutti
-- gemelli con `chat_ts` IDENTICO: sono lo stesso turno importato due volte.
-- La coppia osservata — legacy_id 38 e 114, vedi o16_duplicate_review.sql —
-- ha invece DUE valori distinti, a 286 ms. Quindi non è nessuno dei tre, ed
-- è la ragione per cui il ticket resta aperto.
--
-- ── Le bocche, e la firma che ciascuna lascia ───────────────────────────
-- Nella corsia unificata (mig 060) una riga può nascere in quattro modi, e
-- ognuno scrive `chat_ts` a modo suo:
--
--   A. INGEST da chat.jsonl (`jht-send`, `jht-reply-options`, il gioco)
--      → `chat_ts` è il `time.time()` di chi ha scritto la riga nel file:
--        frazione "qualunque", a precisione di microsecondo.
--        `kind` è SEMPRE 'notification' e `related_position_id` SEMPRE NULL:
--        l'INSERT dell'ingest li ha cablati, non li può ricevere.
--
--   B. MIRROR di una riga nata in SQLite (`jht-notify-user`, o la route
--      locale del web) → `chat_ts` = il secondo di `created_at` PIÙ l'id
--      locale nei millesimi. Cioè: la frazione di `chat_ts` è ESATTAMENTE
--      `legacy_id % 1000 / 1000`. È una firma, e non può nascere per caso.
--
--   C. IMPORT dal cloud (turno scritto dal browser) → `chat_ts` =
--      |legacy_id negativo| / 1000. Qui non c'entra: la coppia ha due id
--      locali POSITIVI.
--
-- ── Cosa decide la query ────────────────────────────────────────────────
-- Verificato eseguendo il codice vero (`mirrorDbTurnsToJsonl` su due righe
-- con id 38 e 114 nello stesso secondo): i due `chat_ts` distano
-- ESATTAMENTE 76 ms. Non 286, e nessun'altra distanza è possibile a parità
-- di secondo — la frazione la decidono gli id. Quindi:
--
--   · le due righe NON possono venire entrambe dal mirror. Almeno una è
--     entrata da chat.jsonl;
--   · se UNA delle due porta la firma del mirror (colonna `firma_mirror`
--     = true) allora la coppia è «una scritta con jht-send, l'altra
--     notificata con jht-notify-user»: la quarta via è DIMOSTRATA, la
--     correzione sta nelle skill e nei prompt, e i 286 ms sono un artefatto
--     della frazione derivata — non l'intervallo fra due chiamate;
--   · se NESSUNA delle due la porta, vengono entrambe da chat.jsonl e i
--     286 ms sono un intervallo VERO. Che è velocità di due processi nella
--     stessa riga di shell (`jht-send 'X'; jht-reply-options --prompt 'X'`),
--     non di due decisioni di un LLM: un giro di modello non torna in 286 ms.
--     In quel caso la quarta via è ESCLUSA e si guarda lì.
--
-- Le prime tre colonne del blocco «firme» decidono da sole, senza aritmetica:
-- `kind` diverso da 'notification', `delivered_via` = 'telegram' o
-- `related_position_id` valorizzato possono venire SOLO da jht-notify-user.

WITH coppia AS (
  SELECT *
    FROM pending_user_messages
   WHERE legacy_id > 0
     AND chat_ts IS NOT NULL
)
SELECT
  a.user_id,
  a.legacy_id                                   AS legacy_id,
  a.agent,
  a.author,
  left(a.body, 60)                              AS body_head,
  a.created_at,
  a.chat_ts,

  -- ── Le firme ──────────────────────────────────────────────────────────
  -- Ognuna di queste, da sola, dice "questa riga viene da jht-notify-user".
  a.kind                                        AS kind_dice_notify,
  a.delivered_via                               AS via_dice_notify,
  a.related_position_id                         AS posizione_dice_notify,

  -- La firma aritmetica del mirror: la frazione di chat_ts è l'id locale
  -- nei millesimi. `round(...,3)` perché a questa grandezza un double non
  -- rappresenta 0.038 esatto — l'errore è di ~1e-7, ben dentro il millesimo.
  round((a.chat_ts - floor(a.chat_ts))::numeric, 3)          AS frazione_osservata,
  round(((a.legacy_id % 1000))::numeric / 1000, 3)           AS frazione_attesa_se_mirror,
  round((a.chat_ts - floor(a.chat_ts))::numeric, 3)
    = round(((a.legacy_id % 1000))::numeric / 1000, 3)       AS firma_mirror,

  -- La distanza dalla gemella, per ritrovare i 286 ms nel dato.
  round((a.chat_ts - b.chat_ts)::numeric * 1000)             AS distanza_ms
FROM coppia a
JOIN coppia b
  ON  b.user_id = a.user_id
  AND b.agent   = a.agent
  AND b.author  = a.author
  AND md5(b.body) = md5(a.body)
  AND b.legacy_id <> a.legacy_id
ORDER BY a.user_id, a.created_at, a.legacy_id;

-- Attesa per la coppia del ticket: due righe, legacy_id 38 e 114, stesso
-- corpo, `distanza_ms` = ±286. Guardare `firma_mirror`:
--   · una true e una false  → quarta via DIMOSTRATA (skill/prompt);
--   · tutte e due false     → quarta via ESCLUSA, doppia scrittura diretta
--                             in chat.jsonl (due processi, una riga di shell);
--   · tutte e due true      → impossibile a 286 ms: rileggere la selezione,
--                             sta accoppiando righe che non sono gemelle.
