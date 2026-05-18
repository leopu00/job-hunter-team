# 🔥 Supabase Disk IO Budget — investigazione e piano fix

**Data**: 2026-05-18
**Trigger**: email Supabase Team `"Your project is depleting its Disk IO Budget"` (project ref `smittwvohsnwwwisqdrh`)
**Status**: indagine completata, decisione strategica presa (vedi § Decisione strategica), fix mirati pianificati.

---

## 📧 Contesto email

> Your project job-hunter-team is depleting its Disk IO Budget. This implies that your project is utilizing more Disk IO than what your compute add-on can effectively manage.
>
> When your project has consumed all of your Disk IO Budget,
> - Response times on requests can increase noticeably
> - CPU usage rises noticeably due to IO wait
> - Your instance may become unresponsive

Nessun crash al momento dell'investigazione (status `ACTIVE_HEALTHY`), ma se il pattern continua il budget si satura.

---

## 🔎 Indagine — finestra `pg_stat_statements`

| Voce | Valore |
|---|---|
| Window pg_stat | **15 giorni 18 ore** (dal 2026-05-02) |
| Token cloud sync attivi | **1** (`vps-pairing-2026-05-16`) |
| Token attività | `last_used_at = NOW - 5 secondi` (polling LIVE) |
| `ACTIVE_HEALTHY` | ✅ |
| Region | `eu-central-1` |
| Postgres | 17.6.1 |

### 📊 Top query consumatori IO (15g 18h window)

| Sorgente | Calls | Mean ms | WAL bytes | Rate |
|---|---|---|---|---|
| 🔴 **`UPDATE cloud_sync_tokens.last_used_at`** | **50,597** | 2.0 | **13 MB** | 134/h |
| 🔴 **`INSERT applications`** (push daemon) | **5,050** | 8.0 | **97 MB** ⚠️ | 13/h |
| 🟠 `SELECT cloud_sync_tokens` (auth) | 50,649 | 0.5 | 1 MB | 134/h |
| 🟠 `SELECT auth.users` (RLS chain) | 106,032 | 1.0 | 130 KB | 281/h |
| 🟠 `SELECT auth.sessions` (RLS chain) | 106,184 | 0.3 | 121 KB | 281/h |
| 🟠 `SELECT auth.identities` (RLS chain) | 105,408 | 0.2 | 0 | 279/h |
| 🟠 `SELECT auth.mfa_factors/amr_claims` | 211,592 | 0.1 | 9 KB | 559/h |
| 🟡 `SELECT team_commands` (poll fallback) | 45,481 | 0.4 | 8 KB | 120/h |
| 🟡 `set_config` (PostgREST setup) | 182,847 | 0.3 | — | 484/h |

**WAL totale generato**: ~111 MB / 16 giorni = ~7 MB/giorno. Non enorme di per sé, ma il
**page-write count** (heap + indici + WAL fsync) brucia il Disk IO Budget.

### 📈 Pattern emergente

```
┌─────────────────────────────────────────────────────────────────┐
│  Architettura cloud sync — chi fa cosa                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  VPS container (cloud daemon — cli/src/commands/cloud.js)       │
│    └─ "push ogni 30s" (pid1.js:507)                              │
│    └─ Realtime WS subscriber team_commands (pid1.js:526)        │
│    └─ Fallback poll team_commands se WS down                     │
│                                                                  │
│  Browser (utente desktop/web dashboard)                          │
│    └─ useTeamCommandPoller 1.5s SOLO post-click bottone          │
│       (max 60s, non continuo) — NON è il colpevole               │
│                                                                  │
│  jobhunterteam.ai (Vercel)                                       │
│    └─ ogni /api/cloud-sync/* request → verifyBearerToken         │
│        └─ SELECT cloud_sync_tokens (lookup)                      │
│        └─ UPDATE cloud_sync_tokens.last_used_at  ← KILLER        │
│        └─ (RLS chain auth.users/sessions/identities/mfa_*)       │
│                                                                  │
│  Supabase Postgres                                               │
│    └─ ogni UPDATE = WAL + heap + idx writes + RLS chain          │
└─────────────────────────────────────────────────────────────────┘
```

### 🎯 Root cause precisa

**File**: `web/lib/cloud-sync/auth.ts:69-72`

```typescript
// Aggiorna last_used_at fire-and-forget. Ritorna admin client per la route.
await admin
  .from('cloud_sync_tokens')
  .update({ last_used_at: new Date().toISOString() })
  .eq('id', data.id)
```

Il commento dichiara *"fire-and-forget"* ma il codice è `await`-ato. Chiamato
**SU OGNI request del cloud daemon** verso `/api/cloud-sync/*` endpoints
(push, team-commands polling, command status PATCH).

Cumulativo: 50,597 UPDATE × WAL + heap + RLS chain auth = costante consumo IO.

### 🔬 Anomalia secondaria — applications upsert

- Tabella `applications` ha **86 row totali** (`distinct_id = 86`)
- Ma `INSERT applications` count è **5,050** (in 16 giorni)
- Ratio 58:1 → ogni applicazione viene UPSERT-ata ~58 volte

Probabilmente il push daemon riesegue UPSERT su **tutte** le applications ad ogni
tick, indipendentemente da quali sono cambiate. WAL generato: **97 MB** (89% del
totale WAL del DB).

Da indagare in `web/app/api/cloud-sync/push/route.ts:428`.

---

## 🚨 Pg_stat_activity al momento dell'indagine

Vista live delle connessioni:
- `mgmt-api` (Anthropic MCP) — io che indago
- `postgrest` × 4 connessioni idle in COMMIT
- 8+ connessioni `127.0.0.1` con `application_name=""` che eseguono RLS chain
  (SELECT auth.users/sessions/identities/mfa_* in cascata)
- `postgres_exporter` — monitoring Supabase interno
- 1 connessione idle dal 2026-05-17 22:13 (`show archive_mode;`) — leak?

---

## 🎯 Decisione strategica (2026-05-18, Leone)

Il problema NON è "fare meno sync" — il prodotto JHT ha come **vincolo funzionale**
che la dashboard web mostri:

- ✅ Agenti che si muovono live (status tmux session, tick budget, pipeline)
- ✅ Pipeline aggiornata in tempo reale (positions/scores/applications)
- ✅ Notifiche istantanee quando il Capitano produce un evento
- ✅ Sentinella che pulsa il proprio heartbeat ogni N secondi

**Sync frequente = experience utente forte = REQUISITO PRODOTTO, non bug.**

### Approccio scelto: **limitare ora, scalare dopo**

| Fase | Strategia |
|---|---|
| 🟡 **Ora** (beta privato) | Throttle aggressivo dove l'impatto UX è zero (es. `last_used_at` non serve realtime), riduzione moderata altrove (`push interval 30s → 60s` accettabile sotto pochi beta tester) |
| 🟢 **Beta+1** (10+ utenti) | Valutare con dati reali: upgrade Supabase compute o switch self-hosted |
| 🔵 **Post-launch** | Migrazione architettura sync: dashboard web → VPS diretto via WS/SSE (skip relay DB centrale) |

### Opzioni "scala dopo" — pro/contro

#### Opzione A — Upgrade Supabase compute

Tier Supabase compute add-on (oltre al Pro plan $25/mo):
- **Micro** (default Pro): 1GB RAM, 2 vCPU — attuale
- **Small** ($10/mo): 2GB RAM, ~3x Disk IO Budget
- **Medium** ($60/mo): 4GB RAM, ~6x Disk IO Budget
- **Large** ($110/mo): 8GB RAM, ~10x Disk IO
- ... fino a **16XL** ($3,730/mo): 256GB RAM

**Pro**:
- Zero refactor codice
- DR/backup gestiti da Supabase
- Auth/RLS/Realtime già integrati
- 1 click upgrade

**Contro**:
- Costo cresce con utenti (centralizzato)
- Vendor lock-in
- Disk IO resta condiviso tra tutti gli utenti (multi-tenant)
- Limite hard sulla scalabilità (no shard nativo)

#### Opzione B — DB self-hosted (Postgres + custom auth)

**Architettura proposta**:
- Postgres su VPS Hetzner dedicato (€5-30/mo a seconda del carico)
- pgbouncer per connection pooling
- Backup S3/Hetzner Storage Box
- Auth: rolling our own (JWT + sessioni) o continuiamo Supabase auth + DB nostro

**Pro**:
- Costo lineare con carico, non con utenti
- Pieno controllo (no Disk IO Budget, no rate limit)
- Possibilità di shard per user/region (ogni VPS = suo Postgres locale + sync periodico al cloud)
- Indipendenza da vendor

**Contro**:
- Effort migrazione: 2-4 settimane (migrate schema, RLS → app-level checks, Realtime → ws server custom o pgnotify)
- Operations overhead: monitoring, backup, security patches, scaling manuale
- Re-implementa auth/multi-tenancy (oggi gratis con Supabase)

#### Opzione C — Architettura "ogni VPS è autonomo" (long-term)

**Idea**: ogni utente ha SOLO il suo Postgres sul SUO VPS. La dashboard web si
collega DIRETTAMENTE al VPS via WebSocket (tunnel auth via Cloudflare/Supabase).

**Pro**:
- Zero sync centrale, zero Supabase Disk IO
- Dati utente solo sul SUO VPS (privacy massima)
- Costo scala 1:1 con utenti (ognuno paga il SUO VPS)
- Supabase resta SOLO per: auth, account management, marketing site

**Contro**:
- Dashboard offline se VPS down (no fallback)
- Refactor maggiore: WS server in container + tunneling
- Multi-device sync più complesso (es. da telefono → quale VPS?)

### Tabella decisione

| | Opzione A (upgrade) | Opzione B (self-host) | Opzione C (per-VPS) |
|---|---|---|---|
| Effort | 1 click | 2-4 settimane | 4-8 settimane |
| Costo iniziale | +$10-60/mo | +€5-30/mo | €0 (paga utente) |
| Scalabilità utenti | Lineare-degradante | Buona | Eccellente |
| Privacy dati | Centralizzata | Centralizzata | Distribuita |
| Vendor lock-in | Alto | Basso | Bassissimo |
| Quando decidere | Beta+1 (5-10 utenti) | Pre-launch pubblico | Post-launch v2 |

### Pianificazione

```
2026-05-18 (oggi)
  └─ APPLY Fix #1 (throttle last_used_at 1h) + Fix #3 (push 30s → 60s)
  └─ Misurare IO 7 giorni post-deploy
  └─ Se IO budget rientra → procediamo con beta come pianificato

2026-06 (beta privato 1 tester)
  └─ Stabilizzare flow + raccogliere baseline IO per 1 utente

2026-06+ (beta espanso 3-5 tester)
  └─ Misurare baseline IO × N utenti
  └─ Se IO satura prima di 5 utenti → Opzione A (upgrade Small)
  └─ Decisione "self-host vs upgrade più alto" da rivedere con dati reali

2026-Q3 (pre-launch pubblico)
  └─ Decisione finale architettura: Opzione A (upgrade) vs Opzione B (self-host)
     o Opzione C (per-VPS) basata su:
     - costo proiettato per utente
     - target audience (tech vs non-tech)
     - vincoli privacy (es. GDPR — alcuni utenti vogliono dati solo SUL loro VPS)
```

---

## 🛠 Piano fix (priorità d'impatto — RIDOTTO per "limita ora")

### Fix che facciamo ORA (basso impatto UX, alto impatto IO)

| # | Fix | File | Effort | IO ↓ stimata | UX impact |
|---|---|---|---|---|---|
| 🔴 1 | **Throttle `last_used_at` a 1h** | `web/lib/cloud-sync/auth.ts` | 3 righe | **-99.9%** UPDATE | **zero** (era metadata) |
| 🟠 3 | **Push interval daemon 30s → 60s** | `cli/src/commands/cloud.js` | 1 riga | **-50%** push | minimo (+30s latency dashboard) |

### Fix che NON facciamo ora (impatto UX troppo alto)

| # | Fix | Perché skip |
|---|---|---|
| ❌ 2 | Diff-based push applications | Il push completo è già batched e relativamente raro (~13/h). Refactor non vale la candela ora — sarà gestito dall'upgrade Supabase o dal self-host. |
| ❌ Polling team_commands | Già via Realtime WS quando funziona. Toccarlo rischia di rompere la responsiveness della dashboard. |

### Fix che facciamo COMUNQUE (low-effort, no impact UX)

| # | Fix | File | Effort | IO ↓ |
|---|---|---|---|---|
| 🟡 4 | **Fix 22 RLS policies** `auth.uid()` → `(select auth.uid())` | migration SQL | medio | minor ma BEST PRACTICE pre-scale |
| 🟢 5 | **Add 9 covering indices** per FK | migration SQL | bassa | minor + protegge pre-crescita |
| ❌ 6 | Rimuovere 6 unused indices | NO — quando tabelle crescono potrebbero servire di nuovo. Riconsiderare post-launch. |

---

## 🎯 Fix #1 — codice esatto (BLOCKING)

### Stato attuale (`web/lib/cloud-sync/auth.ts:51-58`)

```typescript
const hash = hashSyncToken(match[1])
const { data, error } = await admin
  .from('cloud_sync_tokens')
  .select('id, user_id, name, revoked_at')   // ← manca last_used_at
  .eq('token_hash', hash)
  .maybeSingle()
```

### Stato attuale (`web/lib/cloud-sync/auth.ts:69-72`)

```typescript
await admin
  .from('cloud_sync_tokens')
  .update({ last_used_at: new Date().toISOString() })
  .eq('id', data.id)
```

### Fix proposto

```typescript
// 1) Aggiungere last_used_at al SELECT (serve per il throttle):
const { data, error } = await admin
  .from('cloud_sync_tokens')
  .select('id, user_id, name, revoked_at, last_used_at')
  .eq('token_hash', hash)
  .maybeSingle()

// 2) Sostituire il blocco UPDATE con throttle 1h:
const LAST_USED_THROTTLE_MS = 60 * 60 * 1000  // 1h

const shouldUpdate = !data.last_used_at ||
  Date.now() - new Date(data.last_used_at).getTime() > LAST_USED_THROTTLE_MS

if (shouldUpdate) {
  // Fire-and-forget davvero: NON await — la request non deve attendere
  void admin
    .from('cloud_sync_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
}
```

### Impatto stimato

- UPDATE su `cloud_sync_tokens`: da **50,597 / 16 giorni** → ~**16 / giorno** (1 per ora)
- WAL su `cloud_sync_tokens`: da **13 MB** → **<10 KB** in 16 giorni
- Side effect: dashboard "ultimo uso token" granularità 1h invece di realtime
- Tradeoff accettabile: il campo era usato solo come "ultima volta visto" indicativo

---

## 🎯 Fix #2 — applications diff-based push

### Sospetto pattern attuale

In `web/app/api/cloud-sync/push/route.ts:428` esegue:

```typescript
await admin
  .from('applications')
  .upsert(payload.applications, { onConflict: 'id' })
```

Probabilmente riceve TUTTE le applications dal VPS ad ogni push (non solo le
cambiate). PostgREST conta ogni row dell'array come 1 INSERT statement → 86 row × N
push = 5,050 INSERT.

### Fix proposto (alta priorità ma non blocking)

Aggiungere campo `content_hash` nella riga + check pre-upsert:

```typescript
// Hash content per dedup
function rowHash(row: any): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(row))).digest('hex').slice(0, 16)
}

// Lato VPS (cloud daemon): inviare solo righe con hash diverso dal precedente
// Lato API: rifiutare upsert su righe con hash invariato (no-op = no WAL)
```

Effort: medio (richiede aggiornare schema + protocol). Lasciare per beta+1 se
il Fix #1 risolve il problema immediato.

---

## 🎯 Fix #3 — interval daemon

In `cli/src/commands/pid1.js:507` il commento dice "push ogni 30s". Da verificare
il valore `intervalSec` corrente in `cli/src/commands/cloud.js`. Probabilmente
30s. Alzarlo a 60s riduce a metà le request senza impatto user-visible
significativo (la dashboard riceve dati con +30s di latenza, accettabile).

---

## 🎯 Fix #4 — RLS policies init plan (22 warning)

22 policies con pattern `auth.uid() = user_id` che ri-eseguono `auth.uid()` per
ogni riga letta. Fix da [Supabase docs](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select):

```sql
-- Da:
USING (auth.uid() = user_id)
-- A:
USING ((select auth.uid()) = user_id)
```

Lista tabelle interessate:
- `companies`, `positions`, `scores`, `applications`, `position_highlights`,
  `candidate_profiles`, `cloud_sync_tokens` (×4 policies),
  `cloud_sync_pairing_sessions`, `encrypted_user_blobs` (×4 policies),
  `user_onboarding_state`, `team_commands` (×3 policies),
  `pending_user_messages` (×2 policies), `sentinel_ticks`

Effort: 1 migration SQL con DROP + RECREATE policies. Su tabelle piccole l'impatto
è minore, ma è best practice e va fatto prima che le tabelle crescano.

---

## 🎯 Fix #5 e #6 — indici

### #5: 9 FK senza covering index

| Tabella | FK | Colonna |
|---|---|---|
| `applications` | `applications_user_id_fkey` | `user_id` |
| `cloud_sync_pairing_sessions` | `cloud_sync_pairing_sessions_approved_token_id_fkey` | `approved_token_id` |
| `cloud_sync_pairing_sessions` | `cloud_sync_pairing_sessions_user_id_fkey` | `user_id` |
| `companies` | `companies_user_id_fkey` | `user_id` |
| `pending_user_messages` | `pending_user_messages_related_position_id_fkey` | `related_position_id` |
| `position_highlights` | `position_highlights_position_id_fkey` | `position_id` |
| `position_highlights` | `position_highlights_user_id_fkey` | `user_id` |
| `positions` | `positions_company_id_fkey` | `company_id` |
| `scores` | `scores_user_id_fkey` | `user_id` |

### #6: 6 indici unused

- `idx_pairing_sessions_expires_at`
- `idx_pending_user_messages_user_pending`
- `idx_pending_user_messages_user_replies`
- `idx_pending_user_messages_legacy`
- `idx_sentinel_ticks_user_provider_ts`
- `idx_sentinel_ticks_user_source_ts`
- `idx_user_onboarding_state_vps_setup`

Trade-off: rimuovere indici riduce IO scrittura su quella tabella ma se la query
pattern cambia in futuro (es. nuovo report) potrebbero servire di nuovo. Su
tabelle piccole l'overhead è trascurabile — **lasciare per ora**, riconsiderare
post-beta launch.

---

## 📋 Checklist apply (sprint ora)

```
□ Fix #1 (CRITICO) — web/lib/cloud-sync/auth.ts
  □ aggiungere last_used_at al SELECT
  □ implementare throttle 1h
  □ rimuovere await sul UPDATE (true fire-and-forget)
  □ deploy via Vercel push
  □ verifica pg_stat_statements dopo 24h: calls UPDATE cloud_sync_tokens
    deve scendere a ~16-24/giorno

□ Fix #3 (MEDIUM) — cli/src/commands/cloud.js
  □ trovare costante intervalSec (probabilmente 30)
  □ portarla a 60 (o env var JHT_CLOUD_PUSH_INTERVAL_SEC con default 60)
  □ rebuild image :buster + deploy VPS

□ Fix #4 (RLS migration) — Supabase apply_migration
  □ migration SQL: 22 policies DROP + RECREATE con (select auth.uid())
  □ test su branch Supabase prima di mergeare su prod

□ Fix #5 (FK covering indices) — Supabase apply_migration
  □ migration SQL: CREATE INDEX su 9 FK
  □ test su branch Supabase prima di mergeare su prod

Monitoring post-deploy:
□ Re-run pg_stat_statements analisi dopo 7 giorni
□ Confronto IO Budget consumption pre/post fix
□ Se IO ancora vicino al limit → escalate a Opzione A (upgrade compute)
```

## 📋 Backlog (rivedere post-beta)

```
□ Fix #2 — applications diff-based push (skip se row hash invariato)
□ Fix #6 — rimuovere 6 unused indices (DEFER, monitorare uso post-launch)
□ Decisione architettura: Opzione A vs B vs C (vedi § Decisione strategica)
□ Sync remoto vs WS diretto VPS → web (Opzione C arch)
```

---

## ✅ Decisioni lockate (2026-05-18, Leone)

1. ✅ **Sync frequente = requisito prodotto**, non bug. Dashboard live = UX critica.
2. ✅ **Limitare ora dove zero impatto UX** (Fix #1 + #3 + #4 + #5), rimandare il refactor architetturale.
3. ✅ **Decisione finale architettura post-beta** con dati reali da 3-5 utenti
   (Opzione A upgrade vs B self-host vs C per-VPS).
4. ✅ **Throttle `last_used_at` 1h è accettabile** — il campo serve solo come
   "ultima volta visto", non ha consumatori realtime.
5. ✅ **Push interval 30s → 60s è accettabile** sotto beta limited; rivedere se
   utenti si lamentano della freshness della dashboard.

---

## 🔗 Riferimenti

- pg_stat_statements docs: https://www.postgresql.org/docs/17/pgstatstatements.html
- Supabase RLS performance: https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
- Supabase database linter: https://supabase.com/docs/guides/database/database-linter
- Loader log relevante: `cli/src/commands/pid1.js:507` (push ogni 30s)
- Polling fallback: `cli/src/commands/cloud.js:763`
- Auth bearer: `web/lib/cloud-sync/auth.ts:69-72` (root cause)
