# 🗂️ Tassonomia role_family — fix a monte (drift impossibile) + gap di dominio

> ⚠️ **SUPERATO (2026-06-15, decisione utente).** L'approccio a **lista chiusa** (15 canoniche +
> RULES drift→canon + cluster finance fisso) descritto qui è stato **abbandonato**: l'utente ha
> imposto **ZERO categorie hardcoded** e una **tassonomia EMERGENTE** (registro vuoto per-utente,
> categorie che nascono dai dati per soglia). Il modello valido è in `agents/_team/role-taxonomy.md`
> (riscritto come MODELLO, zero nomi). Questo file resta come **record storico** del percorso
> (closed → upstream-fix → emergent). Il `normalize()` generico è l'unico pezzo sopravvissuto;
> CANONICAL/RULES rimossi.

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

## 4. 🪤 Legacy drift (righe già scritte) — SELF-HEALING nel codice, niente patch VPS

**Correzione approccio (feedback utente forte, 2026-06-15):** il fix NON deve essere una mappatura
cucita sui dati di una VPS né dipendere da essi. Deve essere un **fix GENERALE al comportamento del
team** che, nel container, tiene le categorie sotto controllo da solo per QUALUNQUE candidato. Azione
massima = aggiornare l'IMMAGINE, MAI i dati utente.

1. **Self-healing re-categorize (il pezzo generale):** oggi `next-for-categorize` prende solo
   `role_family IS NULL` → le righe legacy non-canoniche non si ripuliscono mai. Si **estende la coda
   categorize** a includere anche gli ESISTENTI **non-canonici** (drift), così col nuovo container
   l'Analista ri-normalizza da sé lo storico — nessun `UPDATE` nostro sul VPS. (Lane: db_query
   re-categorize + analista.md pointer = dev2.)
   - ⚠️ **DEVE escludere gli `Other` già revisionati** (regola Growth di `role-taxonomy.md`):
     `role_family NOT IN (<15+canonici>) AND role_family <> 'Other'`. Altrimenti gli `Other`
     legittimi (nessun canonico calza) verrebbero ri-accodati all'infinito = spreco di token.
   - Combinato con `normalize()` alla scrittura (§3) → going-forward 0 drift, e lo storico si pulisce
     da solo via recheck/categorize.
2. **~~Sync-normalizer JS~~ RITIRATO.** L'idea di normalizzare nel push del device come *leva sui
   dati* è stata ritirata: la fonte di verità resta il **comportamento del team** (normalize-at-write
   + self-healing re-categorize). Il sync porta semplicemente ciò che il team ha **già** reso
   canonico nel DB locale — nessuna logica di mapping nel layer di sync.

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

> **DECISIONE (2026-06-15): opzione A.** L'utente ha scelto di aggiungere un cluster finance. Le
> famiglie sono definite da **VERTICALI STANDARD di dominio** (NON ricavate leggendo i 63 valori di
> Andras — feedback utente: niente fitting sui dati di una VPS, il fix è generale per qualunque
> candidato). 6 famiglie proposte (dev2): `Investment Banking & Advisory`, `Private Markets & PE/VC`,
> `Credit & Risk`, `Asset & Investment Management`, `Quant & Trading`, `Corporate Finance & Treasury`.
> 6 + 15 esistenti = 21 canoniche; per un profilo finance danno ~8 distinte (sotto il tetto utente
> ~20/candidato); per un non-finance restano dormienti. Split: dev2 = regole ordinate; dev1 =
> appendice `role-taxonomy.md`; dse3 = RULES in `role_taxonomy.py`. **In attesa solo della conferma
> utente sulla granularità** (6 famiglie ok o più aggregato) prima di scrivere doc+codice.

## 🔁 Sequenza di rilascio (per memoria)

1. **Release master→production** (gate sync-web, azione utente — vedi
   `2026-06-15-sync-web-release-gate-finding.md`).
2. Deploy nuova immagine `:latest` (porta `normalize()` alla scrittura) + sync-normalizer JS (legacy
   canonico al cloud).
3. (Se decisione A) aggiungere il cluster finance → aggiornare ENTRAMBI `role-taxonomy.md` +
   `role_taxonomy.py` → deploy.
