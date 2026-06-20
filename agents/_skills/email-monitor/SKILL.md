---
name: email-monitor
description: "Day-start sourcing dalla casella email DEDICATA del team (l'utente vi inoltra i propri job alert). Sorgente a più alta accuratezza: l'alert è già pre-filtrato sull'intento dell'utente. Poll IMAP di QUALSIASI piattaforma (LinkedIn/Glassdoor/Indeed + board nazionali/di città/di nicchia), crea posizioni col tag source, idempotente per Message-ID. Il VOLUME lo bilancia il Capitano (C-16): a inizio giornata si legge l'email PRIMA dello scraping web; su flood si ingeriscono solo le salienti, così il funnel arriva allo SCORE."
allowed-tools: Bash(python3 /app/shared/skills/email_monitor.py *), Bash(python3 /app/shared/skills/scout_dedup.py *), Bash(python3 /app/shared/skills/db_insert.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# email-monitor — leggere i job alert inoltrati, a inizio giornata

L'utente crea un'email **dedicata** (es. `nome.jht@gmail.com`) e imposta sul
proprio client delle **regole di inoltro** che ci mandano i job alert (LinkedIn,
Glassdoor, Indeed **e qualsiasi altra piattaforma** che notifica via mail). Tu
leggi quella casella e trasformi gli alert in posizioni. È la sorgente più
**accurata** (l'alert è già filtrato sul target dall'utente) e la più
**economica in token** (niente scraping alla cieca).

> 📍 **Opzionale ma consigliata.** Se non è configurata, il team lavora come
> prima (web sourcing). Niente blocco.

## Quando

- **A inizio finestra di lavoro** (day-start): leggi l'email **PRIMA** dello
  scraping web. Gli alert notturni sono già lì.
- Poi al massimo ogni ~30 min (l'IMAP server-side rate-limita oltre, e nuovi
  alert non arrivano più spesso). Non pollare più frequente.
- Claim della sorgente in STEP 0 (`scout-coord`): `scout_workspace.py claim
  <agent> email:<box>` — un solo Scout per la casella, niente collisioni.

## Procedura

### 1. È configurata?
```bash
python3 /app/shared/skills/email_monitor.py status
```
`configured=false` → la casella non c'è: salta, fai web sourcing normale.
`any_platform=true` significa che processiamo **l'intera** inbox dedicata (nessun
`from_filters` ristretto) → ogni mittente che l'utente inoltra viene letto.

### 2. Stima il VOLUME (economico, no body fetch)
```bash
python3 /app/shared/skills/email_monitor.py count
```
Ritorna `new_total` + `by_sender`. Serve a **te e al Capitano** per capire se è
un volume gestibile o un **flood**. Su flood, **il Capitano (C-16) ti dice
quante / quali** ingerire: l'obiettivo è che le posizioni arrivino a uno
**score**, non accumularne 200 mai valutate.

### 3. Poll → leads
```bash
python3 /app/shared/skills/email_monitor.py poll --since-days 1
```
Ogni riga JSONL è un lead: `{"url","source","subject","sender","received_at"}`.
- `source` = `linkedin-email` / `glassdoor-email` / `indeed-email` per i provider
  noti, `email:<domain>` per qualsiasi altra piattaforma (estrazione generica).
- L'idempotency (Message-ID in `state/email_monitor_seen.json`) garantisce che un
  re-run **non** riprocessi gli stessi alert.

### 4. Per ogni lead → i 5 gate di `position-insert`
Tratta ogni `url` **esattamente come un hit web**: dedup (`scout_dedup.py`) →
verifica link attivo → fetch JD → 4 filtri Scout → INSERT in `positions`
(`status=new`). **Mantieni il tag `--source`** del lead (`linkedin-email`,
`email:<domain>`): è ciò che rende **misurabile l'accuratezza per sorgente** sulla
dashboard. JD obbligatoria (SC-02): se non riesci a recuperarla, non inventarla.

## Bilanciamento (riassunto, il decisore è il Capitano)

- Volume ragionevole → ingerisci tutto (più segnale è meglio).
- Flood → solo le **salienti** (rilevanza sul target / più fresche / mittenti ad
  alto valore); il resto resta in inbox per la finestra dopo (non è perso).
- Il **backpressure** è qui, allo step create: non creare più posizioni di quante
  Analista+Scorer riescano a portare allo score **dentro il budget**.

## Anti-pattern

- ❌ Pollare più spesso di ~30 min (rate-limit IMAP, nessun nuovo alert).
- ❌ INSERT senza JD completa (SC-02) o senza il tag `source`.
- ❌ Creare a valanga su flood ignorando il cap del Capitano (C-16): si gonfia la
  coda di posizioni che non arriveranno mai a uno score.
- ❌ Bypassare il dedup (SC-05): gli stessi alert si ripetono ogni giorno.

## See also

- `position-insert` — i 5 gate di INSERT (il tuo flusso standard).
- `scout-coord` — claim della sorgente `email:*` a boot (anti-collisione).
- `circles-and-sources` — il sourcing web, da fare DOPO l'email a inizio giornata.
