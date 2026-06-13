# 🔬 Design-doc — Espansione ruolo ANALISTA

> **Stato:** DRAFT — schema da lockare PRIMA di codare (design-doc-first, ordine lead dev3).
> **Owner:** dev1 (DB/migration + agents/analista + agents/capitano) · dev2 (web/ + skills salary-estimate/office-geocoding lato consumo) · dev3 (lead, review).
> **Data apertura:** 2026-06-13. **Branch:** Analista-expansion (dev1+dev2, split per-file rigido).
> ⛔ Fuori scope qui: fix#4 weekly-pacing (lo implementa dev3 su compute_metrics/sentinel-bridge/pacing-bridge — file disgiunti, zero collisione).

## 🎯 Obiettivo (dal brainstorm utente)
L'Analista è diventato il ruolo centrale. Espanderlo con: scadenze candidature machine-readable + richeck giornaliero, coordinate ufficio di default, stima salario via web con cache, e un Capitano che coordina/sostituisce analisti con compiti differenziati. La dashboard deve mostrare "in scadenza" e un archivio "scadute".

## 🧱 Stato attuale (analisi indipendente dev2, file:line)
| Ambito | Esiste | % | Gap |
|---|---|---|---|
| Schema `positions` | `deadline` TEXT libero (003_align_legacy_schema.sql:20); `status` enum (001:57-60); office_lat/lon/address + office_geocoded/office_verified (017); salary_estimated_min/max/currency/source (001:70-72) | 60% | manca `expires_at` (machine-readable), `is_open`, `last_open_check` |
| agents/analista | RULE-03 link-check (analista.md:71-83) — 1 check all'analisi, NON periodico; RULE-04/08 | 85% | no richeck giornaliero; no office-geocoding; no salary ownership |
| skill office-geocoding | SKILL.md presente, Nominatim/Photon, skip remote | 70% | nessun agente la invoca; no backfill ~219 storiche |
| skill salary-estimate | L1/L2/L4 ok, cache salary_estimates.json TTL30g | 90% | L3 web = STUB; owner oggi = Scorer |
| web dashboard | Position type (lib/types.ts:13-54, ha `deadline`, NO office_lat/lon); dashboard pipeline; positions list+filtri; **JobsGlobe.tsx ESISTE** (web/app/components/) | 50% | no card in-scadenza, no sezione scadute/archivio, no filtro deadline, Position type non espone office coords |

## 📋 Contratto DB (LOCKARE — owner dev1) — confermato dev1
Nuove colonne `positions` (in **Postgres** `supabase/migrations/` **E** SQLite `jobs.db` del container — dual-schema, owner dev1):
- `expires_at TIMESTAMPTZ NULL` — null = sconosciuta/sempre-aperta. L'analista la PARSA da `deadline` (TEXT grezzo, resta) quando una data è presente.
- `is_open BOOLEAN DEFAULT true` — l'analista la setta `false` al richeck se link morto OPPURE `expires_at` passata.
- `last_open_check TIMESTAMPTZ NULL` — timestamp ultimo richeck (per il loop giornaliero).
- office: `office_lat REAL`, `office_lon REAL`, `office_address TEXT`, `office_geocoded`, `office_verified` — **già esistenti** (017). Skip geocoding su `remote_type`/`work_mode` remoti.
- salary: `salary_estimated_min/max/currency/source` — **già esistenti** (001). Ownership → **Analista** (scrive in fase analisi, pre-scoring); Scorer LEGGE per `salary_fit` (⚠️ dev1 verifica che il prompt Scorer non assuma di scriverli lui).

**Soglia "in scadenza"** = calcolata nel WEB da `expires_at` (es. ≤7gg), nessun campo/write extra.

## 🖥️ Sezione WEB (owner dev2)
1. **Position type** (`web/lib/types.ts`): aggiungere `expires_at`, `is_open`, `office_lat`, `office_lon`, `office_address`. (Backend `/api/positions` deve esporli.)
2. **Card dashboard "📅 In scadenza"**: posizioni con `is_open=true AND expires_at <= now+7gg`, ordinate per `expires_at` asc.
3. **Sezione/Archivio "Scadute"**: `is_open=false` → vista archivio (read-only, NON delete). Bucket "cancellabile" evidenziato = `is_open=false AND applied=false` (le applied-scadute restano). Delete vero = cleanup differito futuro, NON in questo scope.
4. **Filtro deadline** in `PositionsFilterSidebar.tsx`: daterange / preset "in scadenza" / "scadute".
5. **Mappa**: `JobsGlobe.tsx` esiste → estendere per leggere `office_lat/lon` (verificare cosa usa oggi).
6. **Skill salary-estimate L3** (`agents/_skills/salary-estimate`): implementare L3 web reale + cache TTL30g (riuso `(stack, seniority, country, mode)`).

## ⛓️ Sezioni owner dev1 (DA RIEMPIRE)
- **Migration** (dual-schema Postgres+SQLite): DDL esatto colonne nuove.
- **agents/analista**: RULE nuova "richeck giornaliero apertura" (criterio: `last_open_check < now-1g` → re-verifica link + `expires_at`); parsing `deadline`→`expires_at`; invocazione office-geocoding di default (non-remote); ownership salary-estimate.
- **agents/capitano**: coordina/sostituisce analisti (spawn se uno esce), compiti differenziati. ⚠️ include handoff **C-09** dal fix#4 (ATTENZIONE-WEEKLY → throttle-to-pace, NON freeze-spawn) — da dev3.
- **Backfill** ~219 posizioni storiche (office-geocoding + expires_at parsing): script una-tantum — owner da decidere.

## 🔀 Split per-file (anti-collisione — lezione pacing-bridge 2026-06-13)
- **dev1**: `supabase/migrations/*`, `jobs.db` schema, `agents/analista/*`, `agents/capitano/*`.
- **dev2**: `web/**`, `agents/_skills/salary-estimate/*`, `agents/_skills/office-geocoding/*` (solo se estensione lato consumo).
- Nessuno tocca i file dell'altro. Crossmerge `origin/master` frequente + commit piccoli.

## ✅ Aperti / da confermare
- [ ] dev1: DDL migration finale (numero migration: verificare `ls supabase/migrations/` per evitare collisioni).
- [ ] dev1: verifica RULE Scorer non rompe con ownership salary spostata.
- [ ] Backfill storiche: owner + se una-tantum o RULE analista che recupera l'arretrato.
- [ ] dev2: cosa legge oggi JobsGlobe (city-level? office coords?) prima di estenderla.
- [ ] dev3 (lead): sequenza vs fix#4 su capitano.md (fix#4 C-09 landa prima, poi dev1 ci basa sopra la parte capitano-analisti).
