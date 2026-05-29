# Case studies page — sessione 2026-05-23 → 2026-05-25 handoff

Stato di `/case-studies` dopo ~3 giorni di lavoro intenso. Documento di
riferimento per chi (probabilmente la stessa persona, magari fra qualche
giorno) riprende la pagina.

## 🌐 Live

- URL dev: **http://localhost:3001/case-studies**
- Tmux session: `jht-cs-3001` (log in `/tmp/jht-cs-3001.log`)
- Source of truth narrativa: [`docs/about/RESULTS.md`](../about/RESULTS.md)
- Source of truth dati strutturati: SQLite locale `web/data/case-studies/case-studies.db`
  (rebuild: `./web/data/case-studies/init.sh`)
- Snapshot raw VPSes: `~/jht-case-study-data/full-snapshot-20260524/` (337 MB) +
  zip 89.7 MB. Riproducibile con `./tools/case-study-extract/extract_all.sh`.

## ✅ Cosa funziona

### Pagina pubblica
1. **Hero KPI** — 4 numeri aggregati (field tests, positions, ready, providers)
2. **Methodology disclaimer** — accordion con 7 caveat espliciti
3. **Cross-run comparison** — layout in 2 row:
   - Row 1 (full-width): `PipelineFunnel`
     - Funnel principale 5-stage cascade per ciascun case study (Codex + Kimi)
     - 2 mini-funnel Pre/Post LinkedIn (solo Kimi) side-by-side
     - By-source breakdown LinkedIn vs Other (solo Kimi)
   - Row 2 (3-col grid): `CostPerCvBar` + `TokenStackBar` + `VelocityBar`
4. **Individual case studies** — card per ciascuno con metadata + KPI strip
   + notes accordion (worked / didn't / tweak / caveat) + windows section
5. **Coverage matrix** — 12 celle, 2 done (Codex, Kimi)
6. **CTA** — 2 side-by-side: beta tester + self-host

### Convenzioni decise (dopo ~5 iterazioni di feedback)
- Funnel **cumulative-terminal cascade** (non raw entered counts) per garantire
  che blue+red riempiano la bar e bar di stage N = blue di stage N-1
- Conversion rate **sui terminali** (`ready / (ready + excluded)`), non naïve
  `ready / total_found`. Naïve mostrata come subtext per trasparenza
- "Held back" / in-flight **non mostrato come segmento** del funnel — riga di
  testo sotto chiarisce quante sono e perché escluse
- Profili anonimizzati come **"Beta tester 1/2"** (no iniziali) con descrizione
  generale (es. "senior multilingual technical documentation profile")
- Caso Claude legacy **escluso** dalla pagina pubblica (non aveva instrumentation)

### Schema DB
| Tabella | Scopo |
|---|---|
| `case_studies` | 1 row per case study (metadata, provider, costo, durata) |
| `case_study_metrics` | KPI keyed (categoria + display_order + highlighted) |
| `case_study_notes` | worked / didnt_work / tweak / caveat per case study |
| `case_study_windows` | weekly + phases nested (parent_window_id) |
| `coverage_matrix` | mirror di docs/guides/BETA.md (12 cells) |
| `schema_meta` | version stamp (v2 attuale) |

## 📋 TODO (in ordine di importanza)

### 🔴 Bloccante per "publish-ready"
- [ ] **Migrazione Supabase**: schema attuale è già SQL-compatible (sintassi
      standard SQLite/PostgreSQL salvo `AUTOINCREMENT`). Da:
      1. Convertire `INTEGER PRIMARY KEY AUTOINCREMENT` → `SERIAL` o `BIGSERIAL`
      2. Convertire `INTEGER DEFAULT 0` (per BOOLEAN) → `BOOLEAN DEFAULT FALSE`
      3. Aggiungere RLS policies (lettura pubblica, scrittura solo admin)
      4. Migrare API route `/api/case-studies` da `node:sqlite` a Supabase client
- [ ] **Link `/case-studies` nel nav principale del sito** (header + footer)
- [ ] **SEO meta + Open Graph image** (`metadata` export già minimale in `page.tsx`)
- [ ] **Mobile responsive check** — il `PipelineFunnel` full-width potrebbe
      essere stretto su mobile (375px). Test su devtools.

### 🟠 Coerenza dati (cleanup)
- [ ] **Hero KPI ricalcolare al cutoff**: attualmente
      `totalReady = 105 + 56 = 161`, ma dopo cutoff Kimi è 105 + 55 = **160**.
      Diff trascurabile ma per consistency va sistemato.
- [ ] **RESULTS.md vs DB seed drift**: i case study #2 e #3 in RESULTS.md
      potrebbero avere numeri vecchi (pre-cutoff). Da allineare con seed:
      - Kimi: cvs_ready 56 → 55, excluded 164 → 163, conversion text
- [ ] **Critic pass rate Kimi**: nel seed è 51.4% (55 PASS / 51 REJECT)
      ma con cvs_ready 55 al cutoff il numero PASS=55 e ready=55 matchano —
      questa è una coincidenza che vale la pena documentare nei caveat
- [ ] **Codex sessions extracted ma NON usate**: in
      `~/jht-case-study-data/full-snapshot-20260524/codex-vps1/sessions/` ci sono
      432 rollout-*.jsonl che non sono stati aggregati per token attribution.
      Potrebbe servire un parser equivalente al wire.jsonl per Kimi.

### 🟡 Feature opzionali
- [ ] **Secondo grafico "team efficiency"**: held-back / in-flight per stage
      (info attualmente sacrificata dal funnel cascade). Forse stacked bar
      "ready / excluded / in-flight" per ciascun stage di ciascun case study.
- [ ] **Burn curve sparkline anche per Kimi**: attualmente solo Codex ha
      `burn_curve_json` popolato. Per Kimi possiamo derivarlo da
      `sentinel-data.jsonl` (1304 ticks pre-cutoff) — sample ogni 3h.
- [ ] **Domain breakdown** per Codex (Woodworking 87.3, TechWriter 65.2 ecc.)
      attualmente solo menzionato nelle note ma non in viz.
- [ ] **Per-day timeline** found vs ready (Codex: 28→172→6, Kimi: 27→145→69→10)
      per dare senso del ritmo del run.
- [ ] **Critic score distribution** (histogram dei score 1-10 per ciascuna
      provider) — più informativo del singolo "avg 6.35 vs 5.05".

### 🟢 Operazionali
- [ ] **Shutdown VPS Hetzner**: 2 CPX22 ferme, costano €19.50/mo combinati.
      Avendo lo snapshot completo (89.7 MB), nessun motivo di tenerle accese.
      `hcloud server poweroff 131896232 131335454` oppure delete.
      ⚠️ Verificare prima che il container Kimi auto-restart non riprenda il
      team se solo `poweroff` (probabile sì).
- [ ] **Investigare auto-restart Kimi container**: durante questa sessione il
      container `jht` su VPS Kimi si è auto-restartato almeno 2 volte
      (osservato `Up 39 seconds` ad accessi successivi). Cause probabili:
      docker `--restart=unless-stopped` policy + cron interno o supervisor.
      Da capire se il team JHT viene auto-spawnato al boot o solo container.

### 🐛 Bug minori da fix in PipelineFunnel
- [ ] Labels phase troncati su viewport stretti — ora `w-16` per il label,
      potrebbe essere `w-20` o flex-1 con min-w
- [ ] La legend "passed to next stage / excluded at this stage" si ripete sia
      per Codex che Kimi — potrebbe essere mostrata 1 volta sola sopra il
      funnel container, non ripetuta per ciascun case
- [ ] Discrepancy minima nei numeri PRE-LinkedIn (84 untracked aggregati a
      ex_new): caveat è chiaro ma il funnel pre-LinkedIn è "distorto" — la
      bar Found ha l'84% di drop iniziale che visivamente fa rumore. Forse
      utile aggiungere uno split di colore per distinguere "tracked excluded"
      vs "pre-bug-#14-fix excluded" (es. red striato).

## 📦 File chiave modificati questa sessione

```
web/data/case-studies/
├── schema.sql                  # v2: aggiunte case_study_windows
├── seed.sql                    # 2 case study + 78 metrics + 5 windows + 12 cells
└── init.sh                     # rebuild from schema+seed (idempotent)

web/app/api/case-studies/
└── route.ts                    # GET endpoint, node:sqlite

web/app/case-studies/
├── page.tsx                    # layout: hero + disclaimer + cross-run + cards + matrix + cta
└── _components/
    ├── types.ts                # CaseStudy, Window, Metric, Note types + PALETTE helpers
    ├── KpiHero.tsx
    ├── CaseStudyCard.tsx       # metadata + KPI + notes + windows
    ├── WindowsSection.tsx      # weekly + phases nested + burn sparkline
    ├── PipelineFunnel.tsx      # 5-stage cascade + PhaseFunnels + SourceBreakdown
    ├── CostPerCvBar.tsx
    ├── TokenStackBar.tsx
    ├── VelocityBar.tsx
    ├── CoverageMatrix.tsx
    └── ContributeCta.tsx

tools/case-study-extract/       # toolkit estrazione VPS read-only
├── README.md
├── extract_all.sh              # orchestratore
├── dump_db_tables.py
├── dump_host_files.py
├── dump_container_sessions.py
├── anonymize_profile.py
├── build_manifest.py
└── pack_zip.py

docs/about/RESULTS.md           # 2 case study pubblicati (anonymized)
docs/guides/BETA.md             # matrix aggiornata 12 cells
BACKLOG.md                      # 3 nuove entry urgenti (writer-on-demand,
                                # token-monitor-writer-critic, cost-validation)
```

## 🔁 Workflow di iterazione

```sh
# Modifica seed
vim web/data/case-studies/seed.sql

# Rebuild local DB
./web/data/case-studies/init.sh

# Page hot-reload (Turbopack rileva file changes nel componente)
# se non rileva DB change → hard refresh browser

# Test layout via Playwright screenshot
python3 /tmp/funnel-check.py   # screenshot in /tmp/funnel-shot.png
```

## 💡 Lesson learned dalla sessione

1. **Convenzioni viz non sono ovvie**: il "funnel intuitivo" che ha senso per
   il maintainer non era quello che avevo implementato di default. Ha richiesto
   4-5 iterazioni di feedback per arrivare alla convenzione giusta (red dentro
   la bar che riempie con blue, cascade allineato).
2. **Honest math beats pretty viz**: la conversion "51%" mostrata inizialmente
   era *tecnicamente corretta* ma *concettualmente fuorviante* (includeva
   in-flight nel denominatore). Spostare a conversion "terminale" (62.5%) ha
   reso il funnel "vero" anche se più ottimista.
3. **Cache browser è il diavolo**: Turbopack hot-reload non sempre invalida
   il bundle client. Quando i numeri sembrano non aggiornati, hard refresh.
4. **Read-only è la postura giusta sulle VPS**: l'auto-restart involontario
   del container Kimi ha mostrato che ANCHE solo `docker exec` può triggerare
   side effects (probabilmente un healthcheck o supervisor). Lavorare via
   snapshot locale evita questo rischio.
5. **Anonimizzazione va fatta SUBITO**: aver mantenuto i nomi reali nei
   commit precedenti ha richiesto un history rewrite (force-push). Per i
   prossimi case study, anonimizzare in fase di estrazione.

## 🔜 Sessione successiva — proposta primo step

Riprendere da uno tra:
- **A**: migrazione Supabase + nav link (publish-ready path)
- **B**: domain breakdown + critic distribution (più dati nella pagina)
- **C**: shutdown VPS + investigare auto-restart (operazionale)

Ognuna ~2-3h. La (A) sblocca la pubblicazione. La (B) arricchisce. La (C) è cleanup.
