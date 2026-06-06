# 🧬 Candidate profile — cloud sync redesign

> **Design doc — da validare prima di implementare.** Sessione 2026-06-05 con Leone.
> Estende `cloud-sync-architecture.md` (solo il **profilo**: source-of-truth ≠ positions).
> Basato su **profili reali** ispezionati sulle VPS di produzione + Supabase prod.

---

## ⚡ TL;DR

Il profilo va su Supabase in modo **lossy** (≈ metà dei campi scartati) e **non torna mai
indietro** (nessun pull cloud→locale). Risultato: 🐛 bug dashboard attivo + 🔁 onboarding
daccapo su PC nuovo. Lo riprogettiamo: **Supabase = source-of-truth completa**, schema
**unico** enforced, hydration **lossless**.

| Decisione | Scelta |
|---|---|
| 🎚️ Modello dati | **3 livelli**: core frozen (normalizzato) + blocchi standard + blocchi custom (§3) |
| ⚙️ `filters`/`scoring_weights` | **Implementarli a runtime** |
| 🛡️ Enforcement | **Skill unica `profile-schema`** + validatore, con governance del formato |
| 🔐 PII | contatti **cifrati** + **reveal-on-click** |

---

## 📸 Evidenza dal campo (3 VPS prod)

```
VPS    profilo      cloud   YAML      note
─────  ───────────  ─────   ───────   ─────────────────────────────
A      finance      ✅ ON    ~11.5 KB  sync attivo
B      tech writer  ❌ OFF   ~9.1 KB   cloud disabilitato (quota Vercel)
C      —            —       —         chiave SSH non disponibile
```

Tutte e 3 sullo stesso progetto Supabase JHT · `JHT_HOME=/jht_home` ·
profilo in `/jht_home/profile/candidate_profile.yml` dentro il container `jht`.

---

## 🔥 Il problema in un'immagine (Utente A — finance, sync ON)

```
   candidate_profile.yml (container)          →  candidate_profiles (Supabase)
   ───────────────────────────────────           ──────────────────────────────
   name, target_role, location, skills ✅    →    ✅ presenti
   languages [{name, level}]            ✅    →    ✅ (ma chiave 'name' vs 'language'⚠️)
   ┌─ candidate.citizenship: Hungarian   ─┐  →    ❌ nationality = null
   │  preferences.work_authorization{eu… │  →    ❌ work_authorization = []
   │  preferences.geography[14 città]    │  →    ❌ location_preferences = []
   │  preferences.role_focus / avoid     │  →    ❌ scartato
   │  goals{transition, preferred_roles} │  →    ❌ scartato
   │  positioning{motivation, working_   │  →    ❌ scartato (resta solo industry/
   │   style, communication, interests,  │  →        experience/education)
   │   consulting}                       │  →    ❌ scartato
   │  contacts{phone, linkedin, address} │  →    ❌ scartato (solo email passa)
   └─────────────────────────────────────┘
   positioning_keys su Supabase = [industry, education, experience]  ← solo 3 su ~12 sezioni
```

➡️ **Su Supabase sopravvive ~il 50% del profilo.** Il resto (preferenze geo, work-auth,
obiettivi, posizionamento narrativo, contatti) **non viene proprio salvato**.

🐛 **Bug confermato:** `profile/page.tsx:65` legge `positioning.certifications/projects/
strengths` → per un profilo cloud-sync sono **vuoti** (`mapYamlToProfile` non li salva).

🕰️ **Utente B (sync OFF dal 22/05):** dato Supabase **fermo al 19/05** e già divergente
(a DB 4 lingue incl. German A1; nel file attuale 3). → cloud fermo = dato stale.

---

## 🧩 Lo schema reale (cosa scrivono DAVVERO gli agenti)

I profili veri **non** seguono lo schema "tech" che immaginavo: ❌ niente `filters`/
`scoring_weights` in nessuno dei due. Sono invece **ricchi e semi-narrativi**:

```yaml
name: …                          # ── scalari
target_role: …  location: …  experience_years: 2  has_degree: true
seniority_target: …  industry: …

skills: { primary: [...], secondary: [...] }     # ── liste strutturate
languages: [{name|language, level}]              # ⚠️ chiave incoerente tra utenti!
candidate:
  contacts: {email, phone, linkedin, address}
  experience: [{company, role, years, summary}]
  education:  [{institution, degree, year, details}]
  citizenship: [Hungarian (EU)]

preferences:                     # ── semi-libero / narrativo
  work_mode  relocation  salary_annual_eur
  geography: [Milan, Vienna, Zurich, …]
  role_focus: [...]  avoid: [...]  language_requirements: [...]
  work_authorization: {eu, ch, uk, us}           # ⚠️ qui dentro, non top-level

goals: {transition, impact_investing, preferred_roles, preferred_work}
positioning: {motivation, working_style, communication, interests, consulting}
sources: [CV_*.pdf, cover_letter_*.pdf]
```

### 🔀 Divergenze rilevate (perché serve UNO schema)

| Campo | Utente A | Utente B | Mapping push |
|---|---|---|---|
| lingua | `languages[].name` | `languages[].language` | salva as-is → DB incoerente |
| work-auth | `preferences.work_authorization{}` | assente | cerca top-level `[]` → **vuoto** |
| geografia | `preferences.geography[]` | `location` testo | cerca `location_preferences` → **vuoto** |
| narrativa | `goals` + `positioning{6 chiavi}` | `positioning{}` | salva solo 3 chiavi → **perso** |

---

## 🎚️ §3 — Modello a 3 livelli (core frozen + blocchi)

I dati reali mostrano che ~40% del profilo è **narrativo/semi-libero** e **diverso per ogni
persona** (`goals`, `positioning.*`, `interests`, `consulting`, città target). Forzarlo in
colonne SQL è sbagliato. Decisione: **congelare il core, dare carta bianca sul resto** via
un sistema di **blocchi tipizzati** — riuso del pattern `role_family`/donut di `/map`
(valore libero, rendering data-driven).

```
🧊 L1 CORE (frozen · normalizzato · query-able)
   name·target_role·experience·skills·languages·education·work_auth
   → matching, /map, filtri. Schema zod CONGELATO.

🧩 L2 BLOCCHI STANDARD (slot concordati = gli attuali summary .md)
   about · goals · preferences · strengths        kind: narrative
   → set raccomandato ma ESTENSIBILE (non più hardcoded a 4)

🎨 L3 BLOCCHI CUSTOM (carta bianca all'assistente, per QUESTO utente)
   { key, kind, title, content, ord }
   → il web ha 1 renderer per kind → blocco nuovo reso SUBITO, zero codice
```

### 🎨 Vocabolario `kind` (deciso — corto: 6 renderer)

| kind | usato per | reso come |
|---|---|---|
| `key_value` | info base, contatti, "consulting fit" | label → valore |
| `tag_list` | competenze, lingue, ruoli target, interessi, città | chip |
| `timeline` | **esperienza**, formazione | voci **datate, ordine cronologico** |
| `narrative` | about, obiettivi, aspirazioni | markdown 1ª persona |
| `key_points` | **preferenze, punti di forza** | titolo + testo (sezionato) |
| `distribution` | (opz.) città/categorie | donut, riuso `/map` |

> 🔑 **Il `kind` è il contratto** — l'equivalente della categoria `role_family`. L'assistente
> è libero su titolo/contenuto/numero di blocchi; dichiara solo un `kind` tra questi 6.
> `narrative` è il **fallback universale**. Estendere = aggiungere un renderer (raro), non
> una migrazione.

### 🖼️ La UI /profile esiste GIÀ (conferma dagli screenshot prod)

La pagina cloud `jobhunterteam.ai/profile` ha **già tutte le sezioni** L2 (Info base,
Contatti, Lingue, Competenze, Esperienza, Formazione, Progetti, Ruoli target, Preferenze,
Obiettivi, Aspirazioni, Punti di forza). Oggi molte sono **vuote** ("Nessun obiettivo
inserito", …) → **non perché il profilo è incompleto, ma perché il push le scarta** (sync
lossy, §🔥). Implica:
- ✅ **Fase 2 (push completo) le riempie senza lavoro frontend** — il rendering c'è già.
- 🔧 **Esperienza → `timeline`**: oggi è lista piatta senza date; va portata al renderer
  timeline (come Formazione) parsando `experience[].years` (es. "Sep 2021 - Feb 2023") e
  ordinando dal più recente.
- 🔧 **Preferenze / Punti di forza → `key_points`**: i `*.md` reali sono già a punti
  titolati ("**Credit analysis.** …") → renderer a titolo+testo, non blob.

Le sezioni esistenti = **slot L2 standard** (sempre presenti). I **blocchi L3** sono l'extra
per-persona che l'assistente aggiunge oltre questi.

### Esempio reale — Utente A (finance)

| L | Blocco | kind | Reso come |
|---|---|---|---|
| L1 | skills · experience (Morgan Stanley) · education (JIBS/St.Gallen) | — | card tipizzate |
| L2 | `about` / `goals` / `strengths` (i suoi .md) | `narrative` | markdown |
| L3 | "Consulting fit" (interesse/preoccupazione/punti compensativi) | `key_value` | label→valore |
| L3 | "Oltre il lavoro" (sport e hobby personali) | `tag_list` | chip |
| L3 | "Città prioritarie" (Milan, Vienna, Zurich… ×14) | `tag_list`/`distribution` | chip / donut |

### Storage

```
🟩 tabelle normalizzate   → L1: candidate_experiences · _education · _skills ·
                                 _languages · _work_authorization
🟦 candidate_blocks        → L2+L3: (user_id, key, kind, title, content JSONB, ord, source)
                                 source ∈ {assistant, web, import}
🔐 candidate_contacts      → PII cifrata, reveal-on-click (Q1)
```

I 4 summary `.md` diventano righe `candidate_blocks` con `kind=narrative` → **sincronizzati
su Supabase** (chiude il gap: oggi `/api/profile/summaries` dà 401 da remoto). Un blocco
custom nuovo = **una riga**, non una migrazione.

**Hardening (lezioni incident RobertHalf):** CHECK lunghezza `content` · RLS `(select
auth.uid())` · indice su ogni `user_id` · `kind` con CHECK sul vocabolario ammesso. Vedi
`cloud-sync-architecture.md §incident`.

---

## 🔄 §4 — Sync (chiudere il cerchio)

```
        push  (event-driven)                    pull-profile  (NUOVO)
 YAML ──────────────────────► Supabase ──────────────────────► YAML
 parse+validate (schema)      upsert + replace-all   ricostruisci YAML canonico
                              (transazione)          (yaml.dump)  → scrivi file
                                                     only-if-absent (local-first)
                                                     hook boot: team/start.js:110
```

- `GET /api/cloud-sync/pull-profile` (Bearer `jht_sync_`, come `pull-desired-state`)
- `jht cloud pull-profile` (`--force` per sovrascrivere) + hook boot best-effort 15s
- ✅ **round-trip test** YAML→DB→YAML come gate CI

---

## 🛡️ §5 — Enforcement: skill `profile-schema` (D3)

- 📐 Schema formale **zod** in `shared/` → `CandidateProfileSchema` (unico per tutti).
- ✅ `jht profile validate` = step obbligatorio dopo ogni write (sostituisce il solo
  `yaml.safe_load` di `profile-yaml/SKILL.md:35`).
- 🤝 **Governance** (il tuo "coordinarsi tra agenti", reso robusto): schema **congelato**
  nella skill; campo ignoto → va in `sector_details` + proposta al Capitano. Niente
  negoziazione runtime (non-deterministica, costosa).
- 🔁 Riconcilia le divergenze: `languages[].language`, work-auth top-level, geografia.

---

## ⚙️ §6 — filters / scoring runtime (D2, ultima fase)

Comportamentale → isolata. Scorer pesa con `scoring_weights`; Scout/Analista applicano
`filters` (exclude geo/seniority/lang, soglie). Fallback ai default attuali se assenti.
⚠️ Cambia l'output reale del team → dopo storage+test, mai prima.

---

## 🎚️ Completezza & gate del team (decisione 2026-06-06)

Distinta dal modello-schema L1/L2/L3 (struttura dati): qui è *"quali campi servono"*.
3 livelli, single source in `web/lib/profile-completion.ts`:

| Livello | Campi | Effetto |
|---|---|---|
| 🔴 REQUIRED | name · email · target_role · location · experience_years · seniority_target · ≥2 skill · ≥1 lingua | **sblocca il team** (minimo per cercare + valutare) |
| 🟡 RECOMMENDED | ≥1 esperienza · ≥1 titolo · industry · work-auth · località preferite | non bloccanti, migliorano ricerca mirata + CV su misura |
| 🟢 OPTIONAL | certificazioni · progetti · strengths · about/goals · narrativi · contatti extra · salary · sector_details | personalizzazione massima |

- **Gate** `isProfileComplete` = `isTeamUnlocked` (tutti i required soddisfatti).
- **`%` pesato**: required ×3, recommended ×2, optional ×1 (`weightedCompletion`).
- **UI** (`ProfileStats`): 3 barre + badge "team attivabile / N obbligatori mancanti".
- **Skill** `onboarding-flow` allineata (chiede prima i required).
- ⚖️ Esperienza/educazione/work-auth **NON più bloccanti** → raccomandati (il team
  parte; servono per CV su misura e posizioni lavorabili).

## 🗺️ Piano & stato (agg. 2026-06-06)

| Fase | Cosa | Stato | Commit |
|---|---|---|---|
| 0️⃣ | skill `profile-schema` + zod + validatore + `jht profile validate` | ✅ fatto | `e52d31b2` |
| 1️⃣ | tabelle + colonne + RLS + indici (**mig 033–035**, applicate a prod) | ✅ fatto | `0c665a69` |
| 2️⃣ | push completo (no scarto) → tabelle + blocks + contacts + 🐛 fix sezioni vuote | ✅ fatto, E2E | `76a150dc` |
| ➕ | quick win UI: esperienza cronologica + reveal-PII telefono | ✅ fatto | `617e7c60` |
| ➕ | `ProfileBlockRenderer` (6 kind) + sezione "Approfondimenti" (opzione A) | ✅ fatto | `734956b0` |
| 3️⃣ | **`pull-profile`** (hydration cloud→locale) + boot hook + round-trip | ✅ fatto, E2E | `cabee35f` |
| 4️⃣ | reistruire produttori (form web + skill agenti) + UI full data-driven | ⬜ da fare | — |
| 5️⃣ | `filters`/`scoring_weights` runtime (Scorer/Scout/Analista) | ⬜ da fare | — |

> Mig **031/032** = `dev2` (search_path/revoke). Profilo rinumerato a **033–035** per
> evitare collisione; prod↔repo allineati (vedi `list_migrations`).

## 🔮 Implementazioni future (dettaglio)

### 🥇 Priorità
- ✅ **Fase 3 — `pull-profile` (hydration cloud→locale)** — FATTO (`cabee35f`). Endpoint +
  `jht cloud pull-profile` (only-if-absent) + boot hook + round-trip verificato. Resta da
  promuovere il round-trip a **test CI** (oggi è verifica manuale su un profilo reale).
- **🔐 PII encryption a riposo**. `candidate_contacts` oggi è **in chiaro** (protetta solo
  da RLS select-own; UI reveal-on-click già fatta). Prima del go-live con utenti reali:
  cifrare (pgcrypto o riuso `encrypted_user_blobs`) — vedi `PII-sanitization-plan`.

### 🥈 Consolidamento
- **Fase 4a — produttori allo schema canonico**. Reistruire `profile-assistant/save`
  (form web) e la skill `profile-yaml` (agenti) a scrivere lo schema di `profile-schema`,
  con `jht profile validate` come gate. Reader retro-compat per i profili vecchi.
  Riconciliare `languages[].language` (non `name`), work-auth tipizzata, geografia.
- **Fase 4b — UI full data-driven (opzione B)**. Migrare le sezioni hardcoded di
  `profile/page.tsx` a `blocks` renderizzati via `ProfileBlockRenderer`, rimuovendo i
  doppioni (oggi convivono sezioni fisse + "Approfondimenti"). Consolidare la timeline
  esperienza/formazione in un solo renderer. Sostituire `as Record<string,string>` con
  tipi reali. Ordinamento sezioni via `ord`.
- **📄 Summary `.md` → blocchi sincronizzati**. Il CLI push manda oggi solo lo YAML; va
  esteso per includere `~/.jht/profile/summaries/{about,goals,preferences,strengths}.md`
  come blocchi `kind=narrative` (chiude il gap: `/api/profile/summaries` dà 401 da remoto).

### 🥉 Funzionalità & qualità
- **Fase 5 — `filters`/`scoring_weights` runtime**. Comportamentale: Scorer pesa con
  `scoring_weights`; Scout/Analista applicano `filters` (exclude geo/seniority/lang,
  soglie). Fallback ai default. ⚠️ cambia l'output del team → isolata, con test.
- **🎨 `distribution` → donut vero**. Oggi barre orizzontali; riuso del donut `/map`
  (`PositionTypesPie` / `colorForFamily`) per i blocchi `kind=distribution`.
- **🧪 cross-check CI `zod` ↔ `python`**. Test che verifica l'allineamento tra
  `shared/config/profile-schema.ts` e `shared/skills/validate_profile.py` (no drift).
- **▶️ `jht profile validate` runtime**. Eseguibile dopo `npm install` in `cli/`
  (il worktree `dev1` non ha le `node_modules` del CLI). Poi wirarlo come step
  obbligatorio nella skill `profile-yaml`.
- **🔎 reveal-on-click esteso**. Oggi solo telefono; valutare indirizzo/altri PII.

---

## ✅ Decisioni chiuse (2026-06-06)

- 🔐 **PII** → contatti **cifrati** + UI **reveal-on-click** (`candidate_contacts`).
- 🎚️ **Storage** → **ibrido a 3 livelli** (§3): L1 normalizzato, L2/L3 `candidate_blocks`.
- ♻️ **Backfill** → ok, si ripopola al 1° push post-deploy (push manda YAML intero).
- 📄 **Summary .md** → migrano a blocchi `kind=narrative`, sincronizzati su Supabase.
- 📐 **L1 frozen** → name, target_role, location, experience_years, has_degree,
  seniority_target, skills, languages, experience, education, work_authorization.
  *(si raffina nel tempo)*
- 🎨 **Vocabolario `kind`** → 6 renderer (§3): key_value · tag_list · timeline · narrative
  · key_points · distribution. `narrative` = fallback.
- 🧭 **Confine L2/L3** → sezioni esistenti della pagina = slot L2 standard; L3 = extra
  per-persona aggiunto dall'assistente.
- 🌍 **Riconciliazione chiavi** → congelare `languages[].language` (non `name`), work-auth
  lista tipizzata, geografia → `location_preferences` (reader retro-compat per i vecchi).
- 🕰️ **Esperienza → `timeline`** con date parse + ordine cronologico (oggi lista piatta).
- 🧱 **Preferenze/Punti di forza → `key_points`** (titolo+testo, non blob).

> 🎯 Design **chiuso**. Pronto per implementazione dalla Fase 0. Nessuna open question
> bloccante residua.

---

## 🔗 Riferimenti

- `docs/internal/cloud-sync-architecture.md` · `web/app/api/cloud-sync/push/route.ts:150`
- `web/app/api/profile-assistant/save/route.ts:108` · `agents/_skills/profile-yaml/SKILL.md`
- `supabase/migrations/001_schema.sql:8` · `web/lib/profile-reader.ts`
- Profili reali: VPS di produzione (A/B) · progetto Supabase JHT
- Vincolo PII: `PII-sanitization-plan-2026-06-04.md`, memoria `project_pii_scrub_2026_06_05`
