# Cloud sync — architecture & status

> **Living doc.** Source of truth per la strategia cloud sync JHT. Unifica:
> incident RobertHalf 2026-05-19, decisione macro-events 2026-05-20, stato
> implementazione a oggi. Aggiornare a ogni shift architetturale.

## 🧭 TL;DR oggi (2026-05-22)

- **Modello scelto**: cloud Supabase = mirror **macro-event** del SQLite locale, non telemetria live. Container è source-of-truth.
- **Direzione flusso**: push-only locked dal 2026-05-13 ([project_cloud_sync_direction]). Confermato.
- **Granularità**: dal 2026-05-20 decisa la **decimazione** — niente più `sentinel_ticks` né `team_commands` in cloud; solo transizioni di status user-visible.
- **Local PC mode**: web bypassa Supabase, legge `jobs.db` direttamente via `web/lib/local-queries.ts`.
- **VPS live theater** (org-chart animato, popover Sentinella): canale dedicato app↔VPS — NON Supabase. PHASE 3 — `[JHT-CLOUD-06]`.

## 📐 Architecture

```
┌──────────────────────┐    push delta-only      ┌─────────────────┐
│  Container (SQLite)  │ ──────────────────────► │  Supabase mirror│
│  source-of-truth     │   only macro-events     │  read-only side │
└──────────────────────┘                          └─────────────────┘
         │                                                │
         │  local web dashboard                           │  cloud web
         │  (Local PC mode bypass)                        │  dashboard
         ▼                                                ▼
   web/lib/local-queries.ts                     web/lib/queries.ts
```

### Cosa va in cloud

| Tabella | Cadenza | Note |
|---|---|---|
| `positions` | ✅ event-driven su `status` transition | discovered → scored → ready → applied → rejected |
| `scores`, `applications`, `position_highlights` | ✅ event-coalesced con positions | push insieme alla transizione |
| `companies` | ✅ event-driven | nuova company o metadata user-visible cambiato |
| `candidate_profiles`, `user_onboarding_state`, `encrypted_user_blobs` | ✅ event-driven naturale | invariati |
| `pending_user_messages` (mig 010) | ✅ canale fallback notifiche | flow Telegram → DB → prompt injection |
| `sentinel_ticks` (mig 013) | ⛔ **da rimuovere** | ~720 row/h/utente, solo container ne ha bisogno (Bridge/Sentinella) |
| `team_commands` (mig 012) | ⛔ **da rimuovere** | chat inter-agente, non user-visible |

**Ordine di grandezza atteso post-decimazione**: write rate –90% circa.

## 📜 Incident history — RobertHalf redux (2026-05-19)

**Root cause**: row corrotta su VPS2 (`positions.id=101`, `location` di 4394 char di HTML scout-malparsed) ha innescato `HTTP 400 constraint violation` su ogni batch push. Daemon batch-or-nothing → retry loop → connection pool Supabase saturo (Nano tier) → middleware Next.js timeout → 504 GATEWAY_TIMEOUT user-facing per ~1h.

**Fix immediato applicato**:
- Truncate row VPS2 a placeholder (`UPDATE positions SET location='London (corrupted...)' WHERE id=101`)
- VPS2 sync disabilitato (conservato per analisi), VPS1 riabilitato
- Supabase Nano → Micro (incluso nel Pro plan, no extra cost): RAM 0.5GB→1GB, CPU dedicato

**Findings post-upgrade (`supabase__get_advisors`)**: 40+ raccomandazioni perf mai applicate. Dettaglio in `2026-05-20-supabase-perf-backlog.md`. Highlight:
- `auth_rls_initplan` × 24 — `auth.uid()` per row invece di `(select auth.uid())` una volta per query → amplificatore primario del 504-storm
- `unindexed_foreign_keys` × 9 — penalty su JOIN/cascade
- `unused_index` × 7 — write overhead inutile

**Decisione conseguente**: la frequenza+granularità del sync era il vero problema. → macro-events only.

## 🎯 Decisione strategica (2026-05-20)

Vedi sopra "Cosa va in cloud". Trade-off accettati:

| Cosa perdiamo | Mitigazione |
|---|---|
| Tick sentinella in tempo reale lato dashboard cloud | "Ultimo macro-event + heartbeat". Live theater su VPS+tunnel (PHASE 3) |
| Analytics storiche su tick/messaggi inter-agente | Restano sul container, pullabili on-demand per debug interno |
| `team_commands` non più replicate | Fallback notifiche resta via `pending_user_messages` (mig 010) |
| Local PC users senza dashboard cloud-side | Erano già `not recommended for daily-use` ([project_deployment_modes]). Privacy-first è feature, non bug |

## 🛠️ Stato implementazione

### ✅ Done

| Item | Commit | Data |
|---|---|---|
| Cap `positions.location` ≤ 200 char (PG CHECK) | `4dcc712f` mig 015 | 2026-05-19 |
| Push delta-only via `updated_at` cursor + halt-flag guard | `690534e0` | 2026-05-22 |
| Web fallback quando manca SQLite locale | `cc52acca` | 2026-05-22 |
| Supabase compute Nano → Micro | dashboard | 2026-05-19 |

### ⬜ Pending (in ordine di priorità)

1. **P0 — Rimuovere `sentinel_ticks` + `team_commands` dal push** in `shared/skills/db_to_supabase.py` e `cli/src/commands/cloud.js` (riferimenti riga ~582). **Decisione di sequencing ancora aperta**:
   - **A** PoC subito → misura immediata risparmio, ma rompe UX cloud-dashboard temporaneamente
   - **B** Aspettare fix RLS init plan + 1 settimana misurata → meno urgenza se RLS basta
2. **P0 — SQLite locale: replicare CHECK constraint di Postgres** (`location ≤ 200`, `title ≤ 500`, `company ≤ 300`). Migration `cli/migrations/006_positions_check_constraints.sql`. Lo scout vedrà errore subito, non a valle. *Origin: incident root cause.*
3. **P0 — RLS init plan fix** (24 policy con `auth.uid()` per row). Migration dedicata (non 017 che è geocoding). Ortogonale alla decimazione: senza, anche cloud "leggero" paga `O(N×K)` sotto carico.
4. **P1 — Daemon push alert quando ≥3 fail consecutivi**: log `legacy_id` sospetto + notifica Telegram + auto-shutdown se >5 fail. Evita loop silenzioso saturante.
5. **P1 — `JHT-LOCAL-NO-API`**: `web/lib/queries.ts` switcha su `local-queries.ts` quando `cloud.json.enabled=false`. Verificare `MainChrome.tsx` + `dashboard/page.tsx`.
6. **P2 — Scout RobertHalf parser fix**: con P0bis in place, il bug emerge alla prima esecuzione (field swap title↔location).
7. **P2 — Canary endpoint** per distinguere "Supabase saturo" da "Vercel slow".
8. **PHASE 3 — VPS live theater channel** (`[JHT-CLOUD-06]`): WebSocket over SSH tunnel o `team-commands-bus` (vedi `team-commands-bus.md`). Non passa per Supabase.

## 🔗 Riferimenti

- [project_cloud_sync_direction] (memory) — push-only lockato 2026-05-13
- [project_team_location_exclusive] (memory) — un solo writer alla volta
- [project_fallback_via_cloud_sync] (memory) — notifiche via `pending_user_messages`
- `docs/internal/2026-05-20-supabase-perf-backlog.md` — 40+ findings advisor
- `docs/internal/2026-05-22-vercel-quota-exhaustion.md` — incident parallelo (push troppo aggressivo + dashboard polling)
- `BACKLOG.md` — entry `[JHT-CLOUDSYNC-01]`, `[JHT-CLOUD-06]`, `[JHT-LOCAL-NO-API]` (da creare)

## 📂 Storia / superseded by

Questo doc consolida e sostituisce:
- `2026-05-19-sync-incident-roberthalf-redux.md` (incident post-mortem completo)
- `2026-05-20-sync-macro-events-decision.md` (decision record granularità)

Per il dettaglio completo dell'incident (timeline minuto-per-minuto, diagnostic queries SQL, full advisor findings) consultare la git history di questi 2 file prima del commit di consolidamento.
