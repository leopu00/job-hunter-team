# 🗂️ Tassonomia role_family — fix a monte (drift impossibile) + gap di dominio

**Data:** 2026-06-15 · **Lane:** dev1 (tassonomia, owner lista) + dev3 (enforcement codice) + dev2
(sync normalizer). · **Doc sorgente:** `agents/_team/role-taxonomy.md`.

## 1. 🎯 Il problema: drift di `role_family`

`positions.role_family` è la categoria semantica che alimenta il grafico categoria + mappa. Il testo
libero **driftava**: su barto, 211 posizioni categorizzate → **48 valori distinti** (`Technical
Writing` vs `Technical Writing / Knowledge Management` vs `Technical Editing` … la stessa famiglia
scritta 5 modi → il grafico si frammenta in rumore).

## 2. ❌ Approccio bocciato: backfill sui dati VPS

Prima ipotesi: una UPDATE drift→canonico sul DB del VPS (backfill una-tantum). **Respinta
dall'utente**: il drift non si patcha sui dati VPS, il fix va **a monte, nel codice**. (Backfill
rimosso, era `shared/skills/backfill_role_family_canon.py`.)

## 3. ✅ Il fix: normalizzazione alla SCRITTURA (drift impossibile going-forward)

- **`shared/skills/role_taxonomy.py`** = unica fonte di verità in codice. 15 canonici + RULES di
  mapping + `normalize()` che ritorna **sempre** un canonico o `'Other'`, mai drift. È il mirror in
  codice di `agents/_team/role-taxonomy.md`.
- **`db_update.py` normalizza `--role-family` alla scrittura** (`role_taxonomy.normalize(v)`, wired a
  `db_update.py:156`) → il DB **non può** contenere drift, qualunque variante l'LLM produca; valore
  sconosciuto → `'Other'`. Testato e2e (drift in → canonico nel DB).
- → Drift **impossibile** going-forward, per sempre, senza toccare le VPS. Richiede **deploy** (nuova
  immagine `:latest`).

**Regola doc↔codice:** `role-taxonomy.md` (doc, owner dev1, lo legge l'Analista) ↔ `role_taxonomy.py`
(enforcement, dev3) restano allineati ai 15 canonici. La crescita deliberata (TAXONOMY-PROPOSAL →
review → add) aggiorna **ENTRAMBI** i file. Verificato programmaticamente: i 15 canonici nei due file
coincidono, 0 divergenza.

## 4. 🪤 Legacy drift (righe già scritte) — niente patch VPS

Le ~340 categorizzazioni PRE-Parte-B restano non-canoniche (barto: 47 distinct, ~98 righe da
rimappare). NON si toccano sul VPS. Due gestioni complementari:

1. **Naturale via recheck:** quando una riga legacy viene ri-scritta (recheck/ricategorizza), passa
   dal `normalize()` → si auto-canonicalizza. RULE-14: l'Analista ri-categorizza solo i `role_family
   IS NULL`/nuovi, NON ri-mappa di proposito l'esistente → la pulizia legacy è lenta/naturale.
2. **Sync-normalizer JS (lane dev2):** `normalize()` portato in JS nel push del device
   (`cli/cloud.js`), mirror di `role_taxonomy.py` → il **cloud riceve sempre canonico** anche se il
   VPS tiene ancora un valore legacy (deterministico, gratis, dato VPS intatto). Da finalizzare DOPO
   che il dev-domain (sotto) è stabile, per non creare un mirror divergente.

## 5. 🧩 Gap dev-domain — CHIUSO (commit 14c8ccef0)

Le RULES iniziali coprivano solo il dominio **tech-writer** (barto). Le varianti **dev** (Backend
Developer, Full Stack, DevOps, ML Engineer…) cadevano in `'Other'`. Chiuso aggiungendo, **dopo** le
regole esistenti e **prima** del catch-all `/ technical writing`:

- `backend/frontend/full-stack/software eng/embedded/firmware/mobile|ios|android develop` →
  **Software Engineering**
- `data engineer / data platform / etl / data pipeline / bi engineer` → **Data Engineering**
- `machine learning / ml engineer / ai engineer / ai/ml / data scien / mlops / computer vision / nlp`
  → **Data Science & AI** (+ `data analy` tenuto qui, è nello scope "data analysis")
- `devops / sre / site reliability / platform eng / cloud eng / release eng` →
  **DevOps / SRE / Platform**
- `ux/ui/product/graphic/visual design` → **Design**
- `project/program manage / product owner / scrum master / delivery manage` → **Product & Project Mgmt**

Testato: 12-14 varianti dev OK, **0 regressione** sui 47 valori barto. Clash verificati (Data/AI
Ops→Data Science, Localization/AI Enablement→Localization, UX Writing→Content&UX, UX Design→Design,
Backend Eng non matcha la regola production→va a Software Engineering).

> ⚠️ **Motivazione corretta:** queste regole servono al **candidato dev reale = user_id `e36c8539`**
> (557 posizioni, l'utente più grande), **NON** ad andras. (Vedi rettifica sotto: andras è finance.)

## 6. 🏦 Gap FINANCE — APERTO (il vero gap su andras) → decisione prodotto

**Rettifica 2026-06-15:** un primo dato attribuiva ad andras categorie dev — **falso** (era la
distribuzione cloud di un altro user_id). Verità (profilo + DB locale VPS):

- **andras = user_id `9996e20c…` = candidato FINANCE.** András Lukács, Credit Risk Analyst @ Morgan
  Stanley; target Investment / PE / Restructuring Analyst. EU (HU).
- DB locale andras: **0 righe dev-like**; 273 posizioni **tutte finance** — Investment Banking,
  Private Equity, Venture Capital, Corporate/Structured/Private Credit, Macro Trading, Real Assets,
  Hedge Fund Research… + 160 `Business & Operations` + 18 NULL.

**Il gap:** la tassonomia chiusa (15 famiglie) **non ha rappresentazione finance**. I ~95 valori
finance specifici → `'Other'` (nessuna regola; `Business & Operations` copre solo Finance/Controlling
in modo generico). → per un candidato finance il grafico categoria collassa a **`Business &
Operations` + `Other`** → **segnale finance perso**.

**Decisione (lane tassonomia dev1 + scelta prodotto utente)** — due opzioni:

- **(A) Aggiungere un cluster finance** alla lista canonica, es. `Investment Banking & Advisory`,
  `Investment Management & Markets` (asset/PE/VC/hedge), `Credit & Risk`, `Quant & Trading`. Dà
  segnale al grafico per il verticale finance (vertical importante).
- **(B) Accettare `Business & Operations` come catch-all** finance — zero lavoro, ma grafico povero
  per i candidati finance.

> NON implementato unilateralmente: l'allargamento della lista è **deliberato** (cresce solo dopo
> review/decisione, regola Growth in `role-taxonomy.md`). Raccomandazione dev1: **opzione A** con un
> cluster finance piccolo (3-4 famiglie) — finance è un verticale candidato primario e il
> catch-all B&O perde troppo segnale. In attesa della scelta dell'utente.

## 🔁 Sequenza di rilascio (per memoria)

1. **Release master→production** (gate sync-web, azione utente — vedi
   `2026-06-15-sync-web-release-gate-finding.md`).
2. Deploy nuova immagine `:latest` (porta `normalize()` alla scrittura) + sync-normalizer JS (legacy
   canonico al cloud).
3. (Se decisione A) aggiungere il cluster finance → aggiornare ENTRAMBI `role-taxonomy.md` +
   `role_taxonomy.py` → deploy.
