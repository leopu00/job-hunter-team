# 2026-05-19 — Sync incident: RobertHalf redux (504 GATEWAY_TIMEOUT)

## TL;DR

Una **singola row corrotta** (`positions.id=101` su VPS2 `203.0.113.30`, location 4394 char di
HTML RobertHalf) ha bloccato il sync cloud globale per ~1h, causato 504
GATEWAY_TIMEOUT user-facing su `jobhunterteam.ai`, e impedito anche al VPS1
(test attivo, `203.0.113.20`) di pushare i propri dati.

È **lo stesso bug** documentato dalla migration
`015_positions_location_max_length.sql` (commit `4dcc712f`, mergiato in
v0.1.16 stamattina). La migration ha messo il guardrail giusto (CHECK
constraint), ma:

1. Non ha *rimosso* la row preesistente dal SQLite del VPS2 (che era già
   paired al cloud da prima del fix)
2. Il daemon push del VPS è batch-or-nothing: una row constraint-violation
   nel payload fa fallire tutte le 251 row del batch in un colpo
3. Carico di retry → Vercel middleware timeout → 504 per gli utenti

## Timeline (UTC, 2026-05-19)

| Ora | Evento |
|---|---|
| ~17:30 | Release v0.1.17 con migration 015 (cap 200 char su `positions.location`) deployed su Supabase |
| 19:52 | Pairing VPS1 (test fresh, user_id `22a8e78c…`) |
| 19:54-21:00 | VPS2 (`e36c8539…`, paired dal 2026-05-16, team fermo ma daemon push ancora attivo) inizia a ricevere `HTTP 400 constraint violation` su ogni push: contiene row id=101 con location di 4394 char raccolta dallo scout RobertHalf in una sessione precedente |
| 21:00-21:40 | Postgres logga `new row for relation "positions" violates check constraint "positions_location_max_length"` ~ogni 60s. Connection pool Vercel/Supabase saturo |
| 21:30+ | Utenti vedono `504 GATEWAY_TIMEOUT MIDDLEWARE_INVOCATION_TIMEOUT` su pagine protette di `jobhunterteam.ai` (middleware fa auth check Supabase → timeout) |
| 21:32 | Anche VPS1 inizia a ricevere `HTTP 504` sul proprio push (vittima collaterale del carico) |
| 21:40 | Diagnosi: trovata la row id=101 con `location` length 4394 sul SQLite di VPS2 |
| 21:45 | Disabilitato sync VPS1 temporaneamente per dare ossigeno a Supabase |
| 21:47 | Troncato `positions.location` di row id=101 su VPS2 da 4394 char a 61 char (testo placeholder) |
| 21:50 | Disabilitato sync VPS2 (`cloud.json: enabled: false`) — l'utente vuole conservarla per analisi |
| 21:51 | Riabilitato sync VPS1, daemon push ripartito |

## Diagnostica step-by-step (per replicabilità)

```bash
# 1. Vedere errori Postgres
# MCP: mcp__supabase__get_logs project=smittwvohsnwwwisqdrh service=postgres
#   → ripetizioni di "violates check constraint positions_location_max_length"

# 2. Sul VPS sospetto, trovare il colpevole
docker exec jht node -e "
  const {DatabaseSync} = require('node:sqlite');
  const db = new DatabaseSync('/jht_home/jobs.db', {readOnly: true});
  const rows = db.prepare(
    'SELECT id, title, company, LENGTH(location) len FROM positions WHERE LENGTH(location) > 200'
  ).all();
  console.log(rows);
"
# (node:sqlite è experimental in Node 22 ma funziona — no sqlite3 binario nel container)

# 3. Truncate manuale
docker exec jht node -e "
  const {DatabaseSync} = require('node:sqlite');
  const db = new DatabaseSync('/jht_home/jobs.db');
  db.prepare(\"UPDATE positions SET location='London (corrupted from scout RobertHalf, troncato YYYY-MM-DD)' WHERE id=101\").run();
  db.close();
"
```

## Fix immediato applicato

- VPS2 row 101: `location` troncato a 61 char (placeholder "London (corrupted from scout RobertHalf, troncato 2026-05-19)")
- VPS2 `cloud.json.enabled = false` (host file + dentro container) → daemon push e realtime subscriber spenti
- VPS1 `cloud.json.enabled = true` (riabilitato dopo il workaround) → daemon push ripartito su 28 positions / 24 scores / 5 applications

Backup `cloud.json.bak-20260519` salvato su entrambi i VPS prima delle modifiche.

## Mitigazioni infrastruttura applicate dopo il troncamento

Anche dopo aver troncato la row 101 e disabilitato il sync VPS2, il sito
`jobhunterteam.ai` continuava a restituire **504 GATEWAY_TIMEOUT** su pagine
protette e l'endpoint `/api/cloud-sync/push` falliva con HTTP 504/500.

Diagnosi: la dashboard Supabase mostrava il progetto in stato **Unhealthy**
con banner "Your project is currently exhausting multiple resources, and its
performance is affected":

| Metric | Valore al momento dell'incident |
|---|---|
| Compute tier | **Nano** (il tier più basso, 0.5 GB RAM, shared CPU) |
| Connection pool | **20/60 conns usati** (1/3 saturato dai retry del daemon push) |
| CPU usage | 26% |
| Disk usage | 4% |
| RAM usage | 44% |

Il banner laterale di Supabase suggeriva inoltre:
> "Company low on resources. Your Nano compute is approaching its limits.
>  Your Pro plan includes a free upgrade to Micro — double the memory at no extra cost."

Il piano Pro paga già il tier Micro: il progetto era rimasto su Nano per
inerzia dal momento del setup iniziale.

### Upgrade applicato

Cliccato "Upgrade for free" dalla dashboard Supabase → progetto resized
Nano → Micro, restart automatico del compute (~30-60s di downtime).

| | Prima (Nano) | Dopo (Micro) |
|---|---|---|
| RAM | 0.5 GB | **1 GB** (×2) |
| CPU | Shared | **2-core ARM dedicato** |
| Connection pool | ~60 | ~120 |
| Costo | $0.01344/h | $0.01344/h (incluso nel Pro) |

### Verifica post-upgrade

- `/api/cloud-sync/team-commands` → 401 in 247ms (era timeout)
- VPS1 daemon push: 2 `✓ Push completato` consecutivi nei minuti successivi
- MCP `execute_sql` rispondeva di nuovo a query semplici
- Dashboard Supabase: status tornato `ACTIVE_HEALTHY`

**Lezione**: Nano è un tier appropriato per progetti idle / demo, non per
produzione con un daemon che fa push continuo da una VPS. La promo "Micro
gratis per Pro plan" rendeva l'upgrade no-brainer e avrebbe evitato
l'incident anche con la row corrotta presente: con doppia RAM e CPU
dedicata, i retry del daemon avrebbero saturato meno aggressivamente
il middleware Vercel.

### Findings advisor post-upgrade

Dopo l'upgrade, ho fatto girare `mcp__supabase__get_advisors` (che durante
l'incident andava in timeout). Risultato: **40+ raccomandazioni performance
mai applicate**, di cui alcune probabilmente hanno aggravato il 504-storm.
Backlog dettagliato in [[2026-05-20-supabase-perf-backlog]].

Highlight delle più impattanti:

- **`auth_rls_initplan` × 24 WARN**: tutte le RLS policy su `positions`,
  `scores`, `applications`, `candidate_profiles`, `cloud_sync_tokens`, ecc.
  chiamano `auth.uid()` **per ogni row** invece che una sola volta per query.
  Sintassi corretta `(select auth.uid())`. Su tabelle grandi e sotto carico
  il costo si amplifica — quasi certamente uno dei moltiplicatori del 504-storm
  (il middleware Next.js fa query con RLS).
- **`unindexed_foreign_keys` × 9 INFO**: FK senza index covering su tabelle
  centrali (positions.company_id, scores.user_id, applications.user_id, ecc.).
  Penalty su JOIN e cascade ops.
- **`unused_index` × 7 INFO**: index mai usati che sprecano write overhead.
- **`auth_db_connections_absolute`**: Auth server fissato a 10 conn
  hardcoded → upgrade del tier compute non scala automaticamente l'Auth.

Vedi backlog per il dettaglio + priorità rollout.

## Cosa serve fixare lato codice (scalabile)

### P0 — preventing a monte: SQLite locale deve avere gli stessi constraint di Postgres

Idea minima ed efficace: replicare i CHECK constraint di Postgres dentro
SQLite. Lo scout RobertHalf ha potuto scrivere 4.4KB in `location` perché
SQLite *non* aveva il limite, mentre Postgres sì. Risultato: insert
"riuscito" sul VPS, fail "asincrono" al cloud, agente ignaro.

**Implementazione**:

```sql
-- in una nuova migration SQLite (es. cli/migrations/006_positions_check_constraints.sql)
CREATE TABLE positions_new ( ... LIKE positions ...,
  CHECK (location IS NULL OR LENGTH(location) <= 200),
  CHECK (LENGTH(title) <= 500),
  CHECK (LENGTH(company) <= 300)
);
INSERT INTO positions_new SELECT * FROM positions;
DROP TABLE positions; ALTER TABLE positions_new RENAME TO positions;
```

(SQLite non supporta `ALTER TABLE ADD CONSTRAINT` direttamente, bisogna
ricreare la tabella. Va fatto idempotente e con backup automatico.)

Quando lo scout fa `INSERT INTO positions (..., location, ...) VALUES (..., '<4KB di HTML>', ...)`,
SQLite ritorna **subito** `Error: CHECK constraint failed: positions`.
L'agente vede l'errore nella propria session tmux e corregge il parser.

### P0bis — tooling: agente deve verificare le proprie scritture

Regola da aggiungere ai prompt scout/assistente in `agents/scout/AGENTS.md`:

> Dopo ogni `INSERT INTO positions (...)`, esegui:
> ```sql
> SELECT id, LENGTH(location) AS loc_len, LENGTH(title) AS title_len,
>        LENGTH(company) AS company_len
> FROM positions WHERE id = last_insert_rowid();
> ```
> Se `loc_len > 200` o `title_len > 500` o `company_len > 300`, **ferma
> il sweep**, riparsa la pagina originale e correggi i field swap.
> Probabile: hai mappato JD intera in `location` o `company`.

Si può anche fornire uno strumento (skill) `jht-sql-validate-insert` che
fa il check automaticamente — l'agente lo chiama dopo ogni batch invece
di doversi ricordare le SQL di verifica.

### P0ter — alert visibile quando push fallisce

Quando il daemon push riceve fail consecutivi (≥3) sullo stesso payload
hash, deve:
1. Loggare il `legacy_id` della row più sospetta (es. quella con field
   più lungo del normale)
2. Inviare `[@daemon -> @utente] [TG] Push fallito 3x — possibile row
   corrotta id=X, location length=Y` via Telegram
3. Spegnersi se >5 fail e attendere intervento manuale (evita il loop
   silenzioso che satura Supabase)

### P1 — daemon push: batch-or-nothing → row-level retry

Fallback descritto sopra (server route fa upsert riga-per-riga su
constraint violation, ritorna `rejected: [...]`, client marca skip).
Resta utile come safety net, ma è meno urgente se P0/P0bis prevengono
le row corrotte alla sorgente.

### P2 — scout RobertHalf parsing fix

L'origine vera è il parser dello scout che ha messo i field swap (title
con "Company in...", company con la JD intera, location con 4394 char di
HTML). Vedere `agents/scout/`. Una volta che P0/P0bis sono in place,
questo bug emergerà visibilmente alla prossima esecuzione.

### P2 — alert su Supabase saturation

Quando il connection pool Supabase si satura, il middleware Next.js
(che chiama Supabase per validare la sessione utente) timeout → 504
visibili. Servirebbe un canary endpoint con timeout breve e log che
distingua "Supabase down" da "Vercel slow".

---

**Sintesi della direzione**: prevenire a monte (constraint SQLite locale +
regola di self-check per gli agenti + alert sul daemon) è più semplice
e più robusto del gestirla a valle (server route che fa retry riga-per-riga).
Le 3 P0 sono indipendenti e possono essere implementate separatamente.

## Cosa lasciare in piedi

- VPS2 (`203.0.113.30`) — team fermo, sync disabilitato, **conservare per analisi** della row 101 e dello scout che l'ha creata. Backup row originale `cloud.json.bak-20260519`. La row 101 nel SQLite è troncata ma `title`/`company` restano corrotti per analisi.
- Migration 015 (cap 200) — **lasciare in place**. È il guardrail giusto. Il fix è lato client + server retry, non rilassare il constraint.
- Migration 016 (relax a 1000) — **NON applicare**. Era una mia ipotesi prematura quando ancora non avevo identificato la singola row colpevole.

## Memory rilevante

- [[project_release_workflow]] — la release v0.1.16/17 di stamattina ha introdotto la migration 015
- [[feedback_dev_time_over_repair_time]] — l'utente vuole feature, non riparare tooling. Questo incident è di tooling (sync), però è bloccante per la feature principale (cloud dashboard)
