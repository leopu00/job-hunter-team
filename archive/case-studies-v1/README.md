# case-studies v1 — archivio

Prima versione della pagina pubblica `/case-studies`. **Non più in uso**, ma
conservata perché il modo in cui elaborava i dati è valido e riutilizzabile.

## Perché è stata archiviata

La v1 dipendeva da un **seed SQLite locale** (`data/case-studies.db`) ricostruito
a mano con `data/init.sh` da file `*.sql` versionati. Il `.db` non esiste su
host nuovi né su Vercel → la pagina andava in `API 500` finché qualcuno non
lanciava lo script. Non era quindi davvero pubblica.

La v2 (in `web/app/case-studies/page.tsx`) legge invece uno **snapshot anonimo
committato** dell'event-log (`web/data/case-studies/betaC-codex-run.json`) e
riusa i grafici di `/team/attivita` — niente DB, niente script, niente PII.

## Cosa c'è qui (pezzi riutilizzabili)

- `_components/` — componenti grafici ricchi della v1, fra cui:
  - `PipelineFunnel.tsx` — funnel di conversione (analizzate → escluse → score → pronte)
  - `FiveHourWindowChart.tsx` / `FiveHourBreakdown.tsx` / `WindowsSection.tsx` — analisi a finestre di 5h
  - `TokenStackBar.tsx` / `FullRunUsageChart.tsx` / `CostPerCvBar.tsx` — consumo token e costo
  - `CoverageMatrix.tsx`, `KpiHero.tsx`, `CaseStudyCard.tsx`, `ContributeCta.tsx`, `ZoomableChart.tsx`
  - `chart-theme.tsx`, `types.ts`
- `api-case-studies/route.ts` — API read-only con scrub PII (URL/email) e shape stabile
  `{ caseStudies, coverage }`; usava `@/lib/five-hour-windows` (ancora in `web/lib/`).
- `data/` — `schema.sql` + `seed*.sql` + `init.sh` (modello dati delle metriche/finestre/token).
- `page.v1.tsx` — pagina v1 (tabs Risultati / Messaggi / Finestre 5h / Token).
  Rinominata da `page.tsx` per non finire come route Next; vive fuori da `web/`,
  quindi non viene compilata.

## Come riprendere un pezzo

I componenti importano `@/...` relativo a `web/`: copiali sotto `web/app/...`,
reinstalla gli import e ricollega la fonte dati (oggi: snapshot JSON anziché
l'API SQLite). Il funnel e le finestre 5h sono i candidati più probabili da
reintegrare nella v2.
