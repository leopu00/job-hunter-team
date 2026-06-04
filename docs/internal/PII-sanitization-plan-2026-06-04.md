# Piano sanitizzazione dati personali (PII) — case-studies & docs

> Stato: **ANALISI + PIANO** (2026-06-04). Nessuna modifica ancora eseguita.
> Nota: questo file usa riferimenti **astratti** ai dati personali (nessun nome/email reale scritto) per non reintrodurre PII nel repo.
> Contesto: la PII della sessione VPS beta (IP/host/località) è già stata rimossa dalla storia di `master` (filter-repo + force-push). Questo piano copre la PII **pre-esistente** scoperta dopo.

---

## 🔴 Sintesi del problema
Dati personali reali (di un beta tester e dell'owner) sono finiti nei **case-studies pubblicati** e in vari doc. Parte di questi è **LIVE sul sito** (non solo nel repo): l'API `web/app/api/case-studies/route.ts` serve `case_study_agent_activity` + `burn_samples`, e i componenti (`AgentTracksChart`, `TeamActionsTab`, `AgentActivityHero`, `FiveHourWindowsTab`, `FullRunUsageChart`) mostrano il campo **`.reason`**, che contiene nome reale, aziende, URL annunci e località.

---

## 🗺️ Mappa PII (cosa / dove / quanto / esposizione)

| Categoria | File | Quantità | Esposizione |
|---|---|---|---|
| Nome completo candidato (Beta Tester 1) — nei path dei CV PDF e nel testo attività | `web/data/case-studies/seed_burn_samples.sql` | ~1082 occorrenze | 🔴 sito + repo + storia git |
| idem | sim reports `docs/internal/2026-05-2x-sim-*`, `web/scripts/seed-from-supabase.js`, `docs/sessions/*` | ~15 occorrenze | repo + storia |
| Email personale dell'owner | `docs/internal/2026-05-25-sim-5-…-report.md` (nome owner anche nel filename) | presente | repo + storia |
| Località specifica candidato (città natale + nazione + "native") | `seed_burn_samples.sql` | ~69 occorrenze | 🔴 sito + repo |
| Profilo professionale dettagliato (ruolo + skill + lingue) | `seed.sql` (`profile_summary`) + `.reason` | — | 🔴 sito (già semi-generico) |
| Job offer reali: URL annunci (jobboard/linkedin/…) + nomi azienda reali + indirizzi uffici | seed case-studies + sim reports | ~231 URL + 134 indirizzi geocodati | 🔴 sito + repo |

### ✅ Già pseudonimizzato
`tester_handle` = "Beta tester 1 / Beta tester 2" (identità di copertina ok). Il leak è nel **testo `.reason`** dell'attività agenti, non nell'handle.

### 🟢 NON toccare (contenuto legittimo, non PII)
- `web/public/data/countries.geojson` (Ungheria come paese)
- `shared/locales/hu.json` (esempio timezone `Europe/Vienna`)
- `web/app/components/JobsGlobe.tsx`

---

## 📋 Piano a fasi

### Fase 0 — ✅ RISOLTA (2026-06-04): il sito NON serve la PII
Verificato in live: `GET https://jobhunterteam.ai/api/case-studies` → **500 `case-studies.db not found`** (`expectedPath=/var/task/web/data/case-studies/case-studies.db`).
- Il `.db` è **gitignorato** (`.gitignore` `*.db`) e **NON viene rigenerato al build Vercel** (`web/vercel.json buildCommand = "npm run build" = next build`, nessuno step `init.sh`).
- Conseguenza: **la PII dei case-study NON è esposta sul sito live**. L'esposizione reale è **repo + storia git** (i file `web/data/case-studies/*.sql` sono tracciati), NON il sito.
- **Ricalibrazione urgenza**: le righe "🔴 sito + repo" nella mappa PII sopra vanno lette come **"repo + storia"** (il sito non serve nulla finché la db non viene buildata al deploy — oggi non lo è). Niente fuga live in corso.
- **Effetto collaterale separato (non-PII)**: la pagina `/case-studies` in prod è **rotta** (API 500). Decisione di prodotto: o si builda la db sanitizzata al deploy, o si lascia la pagina senza dati per la beta. NON è un blocker PII.

### Fase 1 — Mappa di sostituzione (da concordare)
- **Nome candidato** → pseudonimo (`Beta Tester 1` / `Candidate-1`); path CV → `CV_candidate1_<id>_<azienda>.pdf`.
- **Profilo** → versione **vaga/multi-opzione** (range di ruoli affini invece del ruolo puntuale).
- **Località candidato** (città natale/nazione/"native") → generica, preservando i riferimenti geografici legittimi.
- **Aziende reali + URL annunci** → anonimizzare (es. "Company A", URL rimossi/fittizi). *(Decisione aperta #1)*
- **Email owner** → rimossa.

### Fase 2 — Sanitizzazione file correnti (scriptata)
File principale: `seed_burn_samples.sql` (~2.3 MB; ~1082 nomi + ~231 URL). Più `seed.sql`, sim reports, `seed-from-supabase.js`, `docs/sessions/*`.

### Fase 3 — Re-seed DB case-studies + redeploy
Rigenerare la SQLite/DB dal seed sanitizzato e ridistribuire il sito, così il live non espone più PII.

### Fase 4 — Scrub storia git
`git filter-repo --replace-text` sui pattern PII (stesso metodo usato per la sessione VPS), perché il seed con PII è anche nella **storia**. Richiede force-push master (protetto → toggle protezione + ripristino) e coordinamento dev branch.

### Fase 5 — Docs e file con nome owner
- Rinominare il report con il nome dell'owner nel filename + scrub email/nome/indirizzi.
- Scrub dei `docs/internal/2026-05-2x-sim-*` (indirizzi geocodati) e dei chat log in `docs/sessions/*`.

---

## ❓ Decisioni aperte (servono prima della Fase 1)
1. **Aziende reali**: anonimizzare tutte o tenerne alcune note come "vetrina"?
2. **Quanto vago** il profilo professionale (versione "ruolo ampio / multi-opzione")?
3. **Storia git**: scrub completo della storia (come VPS) o solo file correnti + redeploy?

---

## 📌 Priorità consigliata
1. **(massima)** Fase 2+3 su `web/data/case-studies/` → toglie la PII dal **sito live**.
2. Fase 5 (report con email/nome owner).
3. Fase 4 (storia git) — dopo aver deciso lo scope.
