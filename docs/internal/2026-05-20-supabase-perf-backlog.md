# 2026-05-20 — Supabase performance backlog (40+ advisor findings)

## Context

Durante l'analisi post-incident del 504-storm del 2026-05-19 ([[2026-05-19-sync-incident-roberthalf-redux]]),
ho fatto girare per la prima volta `mcp__supabase__get_advisors` con il
progetto `smittwvohsnwwwisqdrh` (`job-hunter-team`, region eu-central-1).

Sono emerse **40+ raccomandazioni performance mai applicate**. Alcune
sono molto probabilmente concause dell'incident: il middleware Next.js
sotto carico chiama Supabase con query RLS che — come scritte ora —
re-valuta `auth.uid()` per ogni row, moltiplicando il costo.

Status progetto al momento dell'audit: **ACTIVE_HEALTHY**, Postgres
17.6.1, compute **Micro** (post-upgrade da Nano del 2026-05-19), pool
salito a livelli normali, MCP risponde fast.

---

## P0 — `auth_rls_initplan` × 24 occorrenze (WARN)

### Problema

Le RLS policy su praticamente tutte le tabelle utente chiamano
`auth.uid()` o `auth.<funzione>()` **una volta per ogni row** restituita
dalla query, invece di una sola volta all'inizio. Postgres docs:

> Replace `auth.<function>()` with `(select auth.<function>())`. This
> hints to the planner to materialize the init plan once, not per-row.

Sintatticamente è un cambio di un parser-token (`auth.uid()` →
`(select auth.uid())`), ma il piano di esecuzione passa da
"re-evaluation per row" a "init plan eseguito una volta sola".

### Impatto plausibile sull'incident del 2026-05-19

Durante il 504-storm:
1. Daemon push VPS2 retry continuo
2. Vercel middleware riceve richiesta → fa query auth Supabase
3. Supabase Nano già stretto: ogni query con RLS richiamava `auth.uid()`
   N volte per row su tabelle (positions × 251 row, sentinel_ticks × 500 row, ...)
4. La saturazione del compute Nano si è amplificata in modo non-lineare

Su Micro l'effetto si attenua ma resta presente. Sotto crescita (utenti,
positions, ticks) il costo cresce O(N×K) invece di O(N) con K=numero di
funzioni auth nella policy.

### Tabelle interessate

| Tabella | Policy | Funzione re-evaluated |
|---|---|---|
| `companies` | `Users see own data` | `auth.uid()` |
| `positions` | `Users see own data` | `auth.uid()` |
| `scores` | `Users see own data` | `auth.uid()` |
| `applications` | `Users see own data` | `auth.uid()` |
| `position_highlights` | `Users see own data` | `auth.uid()` |
| `candidate_profiles` | `Users see own data` | `auth.uid()` |
| `cloud_sync_tokens` | view/insert/update/delete own (×4 policy) | `auth.uid()` |
| `cloud_sync_pairing_sessions` | view own approved | `auth.uid()` |
| `encrypted_user_blobs` | view/insert/update/delete own (×4) | `auth.uid()` |
| `user_onboarding_state` | read own | `auth.uid()` |
| `team_commands` | select/insert/update own (×3) | `auth.uid()` |
| `pending_user_messages` | view/update own (×2) | `auth.uid()` |
| `sentinel_ticks` | view own | `auth.uid()` |

### Fix proposto

Migration SQL idempotente che rigenera tutte le policy:

```sql
-- positions
DROP POLICY IF EXISTS "Users see own data" ON public.positions;
CREATE POLICY "Users see own data" ON public.positions
  FOR ALL TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- scores, applications, candidate_profiles, companies, position_highlights
-- (stesso pattern)

-- cloud_sync_tokens (4 policy)
DROP POLICY IF EXISTS "Users can view own cloud sync tokens"   ON public.cloud_sync_tokens;
DROP POLICY IF EXISTS "Users can insert own cloud sync tokens" ON public.cloud_sync_tokens;
DROP POLICY IF EXISTS "Users can update own cloud sync tokens" ON public.cloud_sync_tokens;
DROP POLICY IF EXISTS "Users can delete own cloud sync tokens" ON public.cloud_sync_tokens;
CREATE POLICY "Users can view own cloud sync tokens" ON public.cloud_sync_tokens
  FOR SELECT TO authenticated
  USING (user_id = (select auth.uid()));
-- (insert / update / delete analoghi)

-- ...resto delle policy
```

Va fatto in **una sola migration** (es. `017_rls_initplan_fix.sql`)
per evitare deploy parziali. Zero downtime (RLS policy replacement è
istantaneo sotto lock minimal).

### Documenti Supabase

- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
- https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan

---

## P1 — `unindexed_foreign_keys` × 9 occorrenze (INFO)

### Problema

FK senza index covering rallentano:
- JOIN con la tabella referenziata
- DELETE/UPDATE cascade (Postgres deve fare seq scan sulla tabella figlia)
- ON DELETE CASCADE su tabelle grandi può locktare a lungo

### FK senza index

| Tabella | FK | Colonna |
|---|---|---|
| `applications` | `applications_user_id_fkey` | user_id |
| `cloud_sync_pairing_sessions` | `..._approved_token_id_fkey` | approved_token_id |
| `cloud_sync_pairing_sessions` | `..._user_id_fkey` | user_id |
| `companies` | `companies_user_id_fkey` | user_id |
| `pending_user_messages` | `..._related_position_id_fkey` | related_position_id |
| `position_highlights` | `..._position_id_fkey` | position_id |
| `position_highlights` | `..._user_id_fkey` | user_id |
| `positions` | `positions_company_id_fkey` | company_id |
| `scores` | `scores_user_id_fkey` | user_id |

### Fix proposto

```sql
-- migration 018_fk_indexes.sql (idempotent via IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_applications_user_id
  ON public.applications(user_id);
CREATE INDEX IF NOT EXISTS idx_cloud_sync_pairing_sessions_approved_token_id
  ON public.cloud_sync_pairing_sessions(approved_token_id);
CREATE INDEX IF NOT EXISTS idx_cloud_sync_pairing_sessions_user_id
  ON public.cloud_sync_pairing_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_companies_user_id
  ON public.companies(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_user_messages_related_position_id
  ON public.pending_user_messages(related_position_id);
CREATE INDEX IF NOT EXISTS idx_position_highlights_position_id
  ON public.position_highlights(position_id);
CREATE INDEX IF NOT EXISTS idx_position_highlights_user_id
  ON public.position_highlights(user_id);
CREATE INDEX IF NOT EXISTS idx_positions_company_id
  ON public.positions(company_id);
CREATE INDEX IF NOT EXISTS idx_scores_user_id
  ON public.scores(user_id);
```

Usare `CREATE INDEX CONCURRENTLY` in produzione se le tabelle sono già
grandi (>10k row); su questo progetto positions ha ~50 row, ok blocking.

### Documenti Supabase

- https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys

---

## P2 — `unused_index` × 7 occorrenze (INFO)

### Problema

Index creati ma mai usati dal planner. Costano:
- Spazio disco
- Write overhead (ogni INSERT/UPDATE deve aggiornarli)
- Lavoro inutile in autovacuum/autoanalyze

### Index inutilizzati

| Tabella | Index |
|---|---|
| `cloud_sync_pairing_sessions` | `idx_pairing_sessions_expires_at` |
| `pending_user_messages` | `idx_pending_user_messages_user_pending` |
| `pending_user_messages` | `idx_pending_user_messages_user_replies` |
| `pending_user_messages` | `idx_pending_user_messages_legacy` |
| `sentinel_ticks` | `idx_sentinel_ticks_user_provider_ts` |
| `sentinel_ticks` | `idx_sentinel_ticks_user_source_ts` |
| `user_onboarding_state` | `idx_user_onboarding_state_vps_setup` |

### Fix proposto

⚠️ **Attenzione**: prima di droppare, verificare se gli index sono stati
aggiunti recentemente (potrebbero non aver ancora avuto traffico per
emergere). Query di sanity check:

```sql
SELECT schemaname, relname, indexrelname, idx_scan, idx_tup_read
FROM pg_stat_user_indexes
WHERE indexrelname IN (
  'idx_pairing_sessions_expires_at',
  'idx_pending_user_messages_user_pending',
  'idx_pending_user_messages_user_replies',
  'idx_pending_user_messages_legacy',
  'idx_sentinel_ticks_user_provider_ts',
  'idx_sentinel_ticks_user_source_ts',
  'idx_user_onboarding_state_vps_setup'
);
```

Se `idx_scan = 0` da ≥7 giorni e le tabelle hanno traffico nello stesso
periodo, drop sicuro:

```sql
-- 019_drop_unused_indexes.sql
DROP INDEX IF EXISTS public.idx_pairing_sessions_expires_at;
DROP INDEX IF EXISTS public.idx_pending_user_messages_user_pending;
DROP INDEX IF EXISTS public.idx_pending_user_messages_user_replies;
DROP INDEX IF EXISTS public.idx_pending_user_messages_legacy;
DROP INDEX IF EXISTS public.idx_sentinel_ticks_user_provider_ts;
DROP INDEX IF EXISTS public.idx_sentinel_ticks_user_source_ts;
DROP INDEX IF EXISTS public.idx_user_onboarding_state_vps_setup;
```

Da fare DOPO P0 e P1 — l'aggiunta dei FK index potrebbe rendere usati
alcuni di questi (poco probabile, ma vale la verifica).

### Documenti Supabase

- https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index

---

## P2 — `auth_db_connections_absolute` × 1 occorrenza (INFO)

### Problema

> Your project's Auth server is configured to use at most 10 connections.
> Increasing the instance size without manually adjusting this number will
> not improve the performance of the Auth server. Switch to a percentage
> based connection allocation strategy instead.

L'Auth server (GoTrue) ha un pool fisso a 10 conn indipendente dal tier
compute. Significa che l'upgrade Nano→Micro che ho fatto ieri NON ha
aumentato la capacità Auth.

### Impatto

Quando il middleware Next.js fa `verifyBearerToken()` (vedi
`web/lib/cloud-sync/auth.ts:27-85`), passa per l'Auth server.
Se le 10 conn sono tutte impegnate, le richieste vanno in coda → timeout.

Durante l'incident di ieri questo è stato probabilmente un secondo
moltiplicatore (insieme alle RLS init plan).

### Fix proposto

Modifica via Supabase dashboard:
1. Settings → Database → Connection pooling
2. Auth server connection strategy: switch da "Absolute" a "Percentage based"
3. Restart compute (alcuni secondi di downtime)

Oppure via API/CLI Supabase se disponibile (verificare in fase di
implementazione).

### Documenti Supabase

- https://supabase.com/docs/guides/deployment/going-into-prod

---

## Roadmap consigliata

| Step | Effort | Priority | Quando |
|---|---|---|---|
| 1. Migration `017_rls_initplan_fix.sql` (24 policy rigenerate) | 1-2h | P0 | Prossima release v0.1.18 |
| 2. Migration `018_fk_indexes.sql` (9 CREATE INDEX) | 30 min | P1 | Stessa release |
| 3. Verifica + Migration `019_drop_unused_indexes.sql` | 30 min | P2 | Release successiva (dopo che P0+P1 hanno avuto traffico) |
| 4. Auth pool: switch percentage-based via dashboard | 5 min | P2 | Quando comodo, no urgenza |

## Esecuzione & verifica

Per ogni migration applicata:
1. `mcp__supabase__apply_migration` (oppure `supabase db push` se locale → remote)
2. `mcp__supabase__get_advisors type=performance` per verificare che la
   finding sia sparita
3. Spot check con query rappresentative (timing prima/dopo)

## Memory rilevante

- [[2026-05-19-sync-incident-roberthalf-redux]] — incident che ha rivelato
  il bisogno di fare audit performance di Supabase
- [[project_release_workflow]] — le migration vanno applicate insieme al
  bump version (017_rls + 018_fk in v0.1.18 patch)
- [[project_session_2026_05_17_bugs_implementation]] — il fix Disk IO
  Budget di 2026-05-18 era un workaround sintomatico; gli advisor che
  ho appena raccolto sono fix root-cause più profondi
