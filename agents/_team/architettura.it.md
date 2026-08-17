<!-- @translation: it, ai-translated 2026-06-06 -->
# 🧭 Job Hunter — Architettura del team

---

## 🧠 Come sono suddivisi gli agenti per livello

JHT assegna ogni ruolo a uno di **quattro livelli**, elencati dal piu alto al piu basso. Il livello indica il modello + lo sforzo di ragionamento che il launcher passa alla CLI del provider attivo.

| Livello | Agenti | Claude | Codex | Kimi | Cosa fa |
|---|---|---|---|---|---|
| 🥇 **very smart** | 👨‍✈️ Captain | `opus-4-7` · effort `high` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Decisioni critiche e irreversibili — massima profondita di ragionamento |
| 🥈 **expert** | 👨‍🏫 Writer · 👨‍⚖️ Critic · 🧙‍♂️ Mentor | `opus-4-7` · effort `medium` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Pattern-matching su template consolidati (CV, revisione cieca, analisi gap) |
| 🥉 **smart** | 🕵️ Scout · 👨‍🔬 Analyst · 👨‍💻 Scorer · 👩‍💼 Assistant | `sonnet-4-6` · effort `high` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Ricerca, scraping, scoring, chat con l'utente |
| 🎖️ **medium** | 💂 Sentinel | `sonnet-4-6` · effort `medium` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Watchdog leggero — regole if-then, nessun ragionamento profondo |

**Livelli di effort disponibili (per riferimento):**

- **Claude** — `low · medium · high · xhigh · max` (Opus 4.7, Apr 2026). `xhigh`/`max` non utilizzati per ora — compromesso sui costi.
- **Codex** — `minimal · low · medium · high · xhigh` (GPT-5.5). Default `medium`.
- **Kimi** — la CLI non espone ancora livelli di effort, quindi tutti i livelli convergono su una singola chiamata.

---

## 🗺️ Pipeline a colpo d'occhio

```
   👤 User
     │
     ▼
   👨‍✈️ Captain ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──────► Phase 5 ──► 👤 User
                  🕵️ Discover  👨‍🔬 Verify  👨‍💻 Score   👨‍🏫 👨‍⚖️ Write+Review   📲 Notify
```

Ogni fase qui sotto corrisponde a un ruolo agente specializzato. Il Captain decide **quante istanze** attivare per ogni ruolo in qualsiasi momento — il numero di agenti e dinamico, non fissato nell'architettura.

---

## 1️⃣ Phase 1 — Discovery 🔍 🕵️

```
        👤 candidate_profile.yml ──┐
                                    │ circles, filters, work_mode
                                    ▼
        ┌──────────────────────────────────────┐
        │ 🕵️ Scout pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (no overlap on       │
        │ circles / sources / URLs)             │
        └────────────────────┬─────────────────┘
                             │ INSERT positions  (status = new)
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │ ──► Phase 2
                       └──────────────┘
                             ▲
                             │ [FEEDBACK]
                             │ (rejection patterns:
                             │  SENIORITY · STACK · GEO · LINGUA)
                             └── from 👨‍🔬 Analyst / 👨‍💻 Scorer
```

**Cosa fanno gli Scout.** Estraggono annunci di lavoro da job board e ATS, deduplicano rispetto a `jobs.db` e inseriscono le posizioni nuove con `status = new`. Si fermano quando il Captain lo ordina.

### 🤝 Coordinamento multi-scout

Piu Scout girano in parallelo senza mai recuperare lo stesso annuncio due volte:

- 🗺️ **Partizione al boot** — i peer si scoprono a vicenda tramite `tmux list-sessions`, poi negoziano il territorio attraverso `scout_coord.py` (quali **circle** e **source** possiede ciascuno).
- 🎯 **Circles** — ambiti concentrici, esauriti dall'interno verso l'esterno: ① preferenza primaria → ② vicini geografici → ③ ricollocazione mirata → ④ satellite → ⑤ frontiera (ruoli adiacenti).
- 📚 **Source tiers** — drenati in ordine: LinkedIn → aggregatori ATS (Greenhouse/Lever/Indeed/Wellfound) → board di nicchia (PyJobs, RemoteOK, regionali) → WebSearch + pagine carriere.
- ⚖️ **Anti-bias** — se piu del 30% delle posizioni di un batch proviene dallo stesso datore di lavoro, lo Scout cambia source/query per il batch successivo. Senza questo meccanismo, una scaleup che pubblica 12 ruoli su un'unica board inonderebbe il pool, soffocando la diversita.
- 🛡️ **Anti-collision** — check di deduplicazione su `positions.url` prima di ogni `INSERT` ([`anti-collision.md`](../_manual/anti-collision.md)).

### 🔁 Ascolto del feedback

Gli Scout ricevono messaggi `[FEEDBACK]` dagli Analyst (e indirettamente dagli Scorer tramite il Captain) taggati con `[SENIORITY] · [STACK] · [GEO] · [LINGUA]`, e adattano query/source per il batch successivo. I bias sistemici vengono escalati al Captain.

### 🛠️ Skills

Disponibili sotto `/app/shared/skills/`:

- **`scout_coord.py`** — partizione del territorio al boot (quale Scout possiede quali circle/source); usato per negoziare l'ownership e verificare l'assegnazione.
- **`db_query.py check-url`** — gate di deduplicazione. Eseguito prima di ogni insert; restituisce `TROVATA` (skip) o `NON TROVATA` (procedi).
- **`db_insert.py position`** — scrive un annuncio verificato in `positions`. Campi obbligatori: title, company, URL, location, testo JD, requisiti.
- **`db_update.py position`** — usato per marcare record gia inseriti come `excluded` quando un duplicato sfugge. Mai DELETE.
- **`linkedin_check.py`** — arricchimento autenticato su LinkedIn (job ID → metadati completi dell'annuncio) senza far scattare il blocco robots di `fetch` MCP.

### 🌐 MCP tools

- **`jobspy`** — scraper multi-source per job board (LinkedIn, Indeed, ZipRecruiter, Glassdoor) wrappato come MCP. Discovery rapida in bulk, output normalizzato.
- **`linkedin`** — MCP dedicato a LinkedIn per ricerca + recupero annunci.
- **`fetch`** — fetch HTTP generico per pagine di aggregatori ATS (Greenhouse, Lever, Wellfound). ⚠️ Bloccato dal robots.txt di LinkedIn — gli Scout ripiegano su `curl` con user-agent da browser.
- **`playwright`** — browser headless per pagine carriere JS-heavy dove il semplice `fetch` non renderizza il DOM.
- **`WebSearch`** *(built-in)* — fallback di livello 4 quando ATS/board di nicchia sono esauriti.

---

## 2️⃣ Phase 2 — Verification ✅ 👨‍🔬

```
                       📦 jobs.db
                       (status = new)
                              │
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍🔬 Analyst pool                      │
        │ N instances · Captain-managed         │
        │ peer-coordinated (last_checked        │
        │ timestamp prevents double-work)       │
        └────────────────────┬─────────────────┘
                             │ UPDATE positions
                             │   status = checked   → Phase 3
                             │   status = excluded  → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
                             │
                             │ [FEEDBACK]
                             │ (rejection patterns:
                             │  SENIORITY · STACK · GEO · LINGUA …)
                             ▼
                        🕵️ Scout pool
```

**Cosa fanno gli Analyst.** Prendono le posizioni con `status = new`, recuperano la JD live, validano il link, analizzano 5 campi strutturati (`ESPERIENZA_RICHIESTA · ESPERIENZA_TIPO · LAUREA · LINGUA_RICHIESTA · SENIORITY_JD`), e le promuovono a `checked` oppure le marcano come `excluded`. Gli anni reali sono calcolati dalle voci datate nel profilo, non dal campo arrotondato `experience_years`. Il candidato e trattato come **adattabile** — stack adiacenti non vengono esclusi, lo Scorer applica una penalita proporzionale di gap a valle.

### 🚫 Tag di esclusione

Le note di esclusione iniziano con `ESCLUSA: [TAG]` — `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` (`req > real+3` o JD senior/lead) · `[STACK]` (fuori dominio). Quando c'e incertezza → `checked`: i falsi negativi costano piu dei falsi positivi.

### 🤝 Coordinamento multi-analyst

- 🕒 **Watermark `last_checked`** — gli Analyst saltano record aggiornati di recente da un peer.
- 🛡️ **Contratto anti-collision** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Feedback agli Scout

Quando 3 esclusioni consecutive colpiscono la stessa source con lo stesso tag, oppure un batch di uno Scout supera il 60% di tasso di rifiuto, l'Analyst manda un `[FEEDBACK]` a quello Scout — specifico (source + tag + ID), azionabile (alternativa suggerita), idempotente (uno per pattern).

### 🛠️ Skills

- **`db_query.py next-for-analista`** — prende la prossima posizione `status=new` rispettando il watermark `last_checked`.
- **`db_query.py position <ID>`** — recupera JD completa + metadati per l'analisi.
- **`db_update.py position <ID>`** — scrive il nuovo status (`checked` o `excluded`) + note strutturate.
- **`linkedin_check.py`** — check autenticato su LinkedIn (attivo / scaduto / info azienda).

### 🌐 MCP tools

- **`fetch`** — GET della JD live con `-L` + browser UA; rileva marker "expired / closed-job".
- **`playwright`** — fallback per pagine ATS JS-heavy che `fetch` non riesce a renderizzare (Workable/Lever/Ashby).
- **`linkedin`** — bypassato: i check su LinkedIn passano per `linkedin_check.py` (autenticato).

---

## 3️⃣ Phase 3 — Scoring 🎯 👨‍💻

```
                       📦 jobs.db
                       (status = checked)
                              │
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍💻 Scorer pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (last_checked < 5min │
        │ = peer claimed → skip)                │
        └────────────────────┬─────────────────┘
                             │ INSERT scores · UPDATE positions
                             │   score ≥ 50  → status = scored   → Phase 4
                             │   score 40-49 → status = scored   (parking)
                             │   score < 40  → status = excluded → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
                             │
                             │ score distribution
                             │ (high-score zones → Scout queries)
                             ▼
                        🕵️ Scout pool  (via 👨‍✈️ Captain)
```

**Cosa fanno gli Scorer.** Eseguono un **pre-check** (anni di esperienza, localita, laurea obbligatoria senza "o equivalente") per filtrare le posizioni non valutabili, poi assegnano un punteggio 0-100 rispetto al profilo del candidato. `< 40` → `excluded`. `40-49` → `scored` (parking, il Captain decide dopo). `≥ 50` → `scored` + notifica ai Writer.

### 🧮 Formula di scoring (0-100)

| Componente | Peso | Colonna DB | Cosa misura |
|---|---|---|---|
| Stack match | 35 | `stack_match` | Skill richieste vs stack del candidato |
| Seniority fit | 25 | `experience_fit` | Anni richiesti vs anni reali del candidato |
| Remote / location | 20 | `remote_fit` | Compatibilita con le preferenze di localita del profilo |
| Salary fit | 10 | `salary_fit` | Range offerto vs target |
| Stack bonus | 10 | `strategic_fit` | Bonus tecnologico (AI · cybersec · fintech, se aree forti del candidato) |

Penalita applicate in aggiunta: `−10` laurea obbligatoria senza "o equivalente" · `−15` lingua obbligatoria non parlata · `−5` JD vaga senza requisiti concreti.

### 🤝 Coordinamento multi-scorer

- 🕒 **Claim `last_checked`** — lo Scorer segna il timestamp prima di valutare; i peer saltano record reclamati negli ultimi 5 minuti.
- 🛡️ **Confine di scrittura DB** — lo Scorer scrive `scores` (INSERT) e solo `positions.status`. Non tocca mai `applications`, `companies`, o `positions.notes` (territorio dell'Analyst).
- 🛡️ **Contratto anti-collision** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Feedback agli Scout (via Captain)

La distribuzione live dei punteggi dello Scorer (per source / ruolo / geo / stack) viene letta dal Captain e ritrasmessa agli Scout, cosi i batch successivi si concentrano sulle zone ad alto punteggio del candidato.

### 🛠️ Skills

- **`db_query.py next-for-scorer`** — prende la prossima posizione `status=checked` rispettando `last_checked`.
- **`db_query.py position <ID>`** — record completo + note strutturate dell'Analyst (gli input della formula).
- **`db_insert.py score`** — scrive il dettaglio (5 componenti + totale).
- **`db_update.py position <ID>`** — imposta `status = scored | excluded`.

### 🌐 MCP tools

- **`fetch`** — ri-valida il link prima dello scoring (gli annunci muoiono in fretta — la Phase 2 potrebbe risalire a un po' di tempo fa).

---

## 4️⃣ Phase 4 — Writing + Review ✍️ 👨‍🏫 👨‍⚖️

```
                       📦 jobs.db
                       (status = scored, score ≥ 50)
                              │  selection: ≥70 first, then 50-69 desc
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍🏫 Writer pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (status=writing      │
        │ claim prevents double-work)           │
        └────────────────────┬─────────────────┘
                             │ for each position:
                             │   3× rounds with a fresh Critic
                             ▼
        ┌──────────────────────────────────────┐
        │ 👨‍⚖️ Critic (CRITICO-S<N>)            │
        │ spawned fresh per round, killed after │
        │ blind review — no profile access      │
        └────────────────────┬─────────────────┘
                             │ critic_score 1-10
                             │ after round 3:
                             │   score ≥ 5 → status = ready    → Phase 5
                             │   score < 5 → status = excluded → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
```

**Cosa fanno i Writer.** Prendono le posizioni `status = scored` in ordine decrescente di punteggio (prima le ≥70, poi le 50-69), le reclamano impostando `status = writing`, generano un CV su misura (Cover Letter solo se la JD la richiede), poi eseguono **3 round obbligatori** con il Critic. Tra un round e l'altro il Writer corregge il CV e rigenera il PDF. Gate finale: `critic_score ≥ 5` → `ready`, altrimenti `excluded`. **Zero invenzioni** — ogni affermazione nel CV deve essere riconducibile a `candidate_profile.yml`.

**Cosa fa il Critic.** Creato da zero per ogni round (`CRITICO-S<N>`), riceve il percorso del PDF + URL della JD, esegue una **revisione cieca** (senza accesso al profilo — solo la pagina che ha davanti), restituisce un verdetto strutturato: voto X/10 + analisi struttura/rilevanza/impatto + tabella requisiti-vs-CV + azioni prioritizzate. Eliminato dopo ogni revisione — mai riutilizzato. Usa l'intera scala 1-10; niente voti di cortesia.

Il loop Writer ↔ Critic e la fase con il maggior consumo di token. Entrambi sono sul livello **expert** (modello top + effort medio) — il compito e ben definito, non serve ragionamento esplorativo.

### 🤝 Coordinamento multi-writer

- 🛡️ **Claim `status = writing`** — i Writer cambiano lo status prima di scrivere; i peer saltano record gia reclamati.
- 🚫 **Anti-rewriting** — se `critic_verdict` e gia impostato, **skip assoluto** (il verdetto e finale, nessuna ri-revisione).
- 📡 **Confine di scrittura DB** — il Writer tocca solo `positions.status` e `applications`; mai `scores`, `companies`, `positions.notes`.

### 🛑 Captain freeze

Quando il Sentinel segnala saturazione dei rate-limit, il Captain invia `[URG] FREEZE` ai Writer. Completano il round corrente se sono a meta del loop (non abbandonano mai un Critic a meta revisione), poi dormono fino a che il throttle non torna a T0/T1.

### 🛠️ Skills

- **`db_query.py next-for-scrittore`** — prende la prossima posizione in ordine decrescente di punteggio.
- **`db_update.py position`** — cambia `status = writing | ready | excluded`.
- **`db_insert.py application`** — registra la candidatura + percorsi CV/PDF.
- **`db_update.py application`** — salva `critic_score · critic_verdict · critic_round · critic_notes` per ogni round.
- **`pandoc`** — converte il CV markdown in PDF tramite motore Typst.

### 🌐 MCP tools

- **`fetch`** — ri-valida il link della JD prima di scrivere; il Critic usa lo stesso MCP per leggere la JD live.
- **`WebFetch`** / **`WebSearch`** — fallback quando `fetch` non riesce a raggiungere la JD (blocchi LinkedIn / robots.txt).

---

## 5️⃣ Phase 5 — Notify 📲

```
                       📦 jobs.db
                       (status = ready)
                              │
                              ▼
                    👨‍✈️ Captain receives [RES]
                    from Writer (PDF + verdict)
                              │
                              ▼
                       📲 Telegram bot
                    (position · CV PDF · job link)
                              │
                              ▼
                         👤 User
                          ① reads the CV
                          ② sends feedback to 👨‍✈️ Captain
                          ③ applies manually using the link
                              │
                              ▼
                       📦 jobs.db
                       (status = applied — set by user)
```

**Cosa succede.** Quando un Writer chiude la Phase 4 con `verdict = PASS` e `status = ready`, il Captain riceve un messaggio `[RES]` con il PDF e il verdetto. Un messaggio Telegram viene inviato all'utente con il titolo della posizione, l'azienda, il CV PDF generato e il link all'annuncio.

**Perche il passo di candidatura e completamente manuale.** L'utente legge il CV, valuta la compatibilita personalmente, invia feedback al Captain (`il tono non va` · `manca questa esperienza` · `bene — mi candido` · ...), e **solo allora decide se candidarsi** — usando il link che ha gia. Questo checkpoint umano e intenzionale: mantiene JHT un coach per il lavoratore, non un cannone che spara candidature a basso sforzo verso i recruiter. Il volume lato recruiter ha senso solo se il lavoratore l'ha scelto.

**Aggiornamento status.** Quando l'utente si candida, la posizione viene flaggata `status = applied` manualmente (risposta Telegram o pulsante "Mi sono candidato" nella web dashboard), con `applied_via = telegram | web | manual`. Il ciclo opzionale `response` (`interview` · `rejected` · `ghosted`) e anch'esso tracciato dall'utente.

### 🛠️ Skills / tools

- **`.launcher/tg-bridge.py`** — bridge Telegram (Python): notifiche in uscita e feedback / aggiornamenti di stato dell'utente in ingresso, un bot per ruolo user-facing.
- **`positions.applied`** — flag DB cambiato dall'utente (mai automaticamente dal team).

---

## 🎮 Orchestrazione della pipeline

La pipeline non e una configurazione statica con N istanze per ruolo: e un **loop guidato dal feedback** che il Captain gestisce dinamicamente in base al flusso, alla profondita delle code e al budget dell'utente. I numeri qui sotto sono illustrativi, non normativi.

### 🥾 Cold start — riempire l'imbuto

Quando la pipeline parte da zero, la priorita e alimentare le code a valle rapidamente:

```
   T=0       →  3× 🕵️ Scout                                    (flood the funnel)
   T+ a bit  →  2× 🕵️ Scout · 1× 👨‍🔬 Analyst                    (first offers to verify)
   T+ more   →  2× 🕵️ Scout · 1× 👨‍🔬 Analyst · 1× 👨‍💻 Scorer    (first verified ready to score)
```

Se l'Analyst resta indietro rispetto agli Scout, il Captain ribilancia al volo: `+1 Analyst · −1 Scout`. La stessa logica scorre a valle.

### 🔁 Feedback loop — ricerca auto-tarata

Il primo batch elaborato da ogni ruolo a valle e **d'oro** — sono i dati che l'agente a valle usa per istruire quello a monte:

- **👨‍🔬 Analyst → 🕵️ Scout** — dopo un primo batch significativo, l'Analyst segnala pattern di rifiuto (aziende che chiudono gli annunci in fretta, board truffa, forme di JD che falliscono sempre la verifica). Gli Scout li saltano a monte.
- **👨‍💻 Scorer → 🕵️ Scout** — una volta che lo Scorer ha visto un campione, sa quali ruoli/stack/geografie ottengono punteggi alti. Ritrasmette la distribuzione cosi gli Scout cercano piu vicino alle zone ad alto punteggio.

Risultato: ad ogni ciclo, gli Scout trovano offerte migliori, gli Analyst rifiutano meno offerte buone, gli Scorer vedono distribuzioni di punteggio piu alte. Il team diventa un **sistema auto-tarato**.

### 🎯 Gate di attivazione del Writer

I loop Writer + Critic sono la parte piu costosa della pipeline (modello top-tier, revisione iterativa). Si **alternano** — il Writer aspetta mentre il Critic revisiona e viceversa — quindi una coppia Writer + Critic costa circa **un agente continuo**, non due.

Per evitare di spendere quei token su offerte mediocri, il Captain condiziona l'attivazione dei Writer alla profondita della coda ad alto punteggio:

1. Ordina le posizioni in coda per punteggio decrescente.
2. Aspetta che si siano accumulate abbastanza offerte ad alto punteggio (es. **10+ offerte con score ≥ 75**).
3. Avvia i Writer — partono sempre dalla posizione con il punteggio piu alto in coda.

### 💰 Throttling budget-aware

Tutti i conteggi di istanze e le soglie dei gate si adattano al budget mensile dell'utente e al segnale di utilizzo live dal side-channel [📡 Bridge → 💂 Sentinel](#-side-channel--usage-monitoring). Un bootstrap aggressivo con un budget ristretto viene rallentato prima che inizi la scrittura di qualita — meglio saltare qualche offerta che bruciare il budget sulla Discovery e non avere piu nulla per la Writing.

---

## 📡 Side-channel — Monitoraggio dell'utilizzo

Fuori dalla pipeline. Gira in continuazione parallelamente ad essa.

```
   ┌────────────┐  every tick  ┌────────────┐  notify on edge  ┌────────────┐
   │ 📡 Bridge  │ ───────────► │ 💂 Sentinel│ ───────────────► │ 👨‍✈️ Captain│
   │ (process,  │ usage + proj │ tier:      │  only on real    │            │
   │  not Claude│              │  medium    │  state changes   │            │
   │  agent)    │              │ event-     │                  │            │
   └────────────┘              │ driven     │                  └────────────┘
                               └────────────┘
```

**Bridge.** Un processo non-AI che interroga la CLI di ogni agente per l'utilizzo corrente e l'esaurimento proiettato. Invia un tick al Sentinel.
**Sentinel.** Edge-triggered: ingerisce ogni tick ma parla al Captain *solo* quando qualcosa cambia davvero (picco di utilizzo, violazione della proiezione, crash di un agente).
**Captain.** Reagisce — rallenta, congela il team, termina le sessioni problematiche — in base al segnale del Sentinel.

---

## 🤝 Side-channel — Helper rivolti all'utente

```
                        👤 User
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
       👩‍💼 Assistant  👨‍✈️ Captain   🧙‍♂️ Mentor
       platform      team commander  career coach
       copilot                       (always-on)
```

- **👩‍💼 Assistant** — `tier: smart`. Traduce le richieste non tecniche dell'utente in ordini per il Captain. Nasconde i dettagli implementativi dalla chat rivolta all'utente.
- **🧙‍♂️ Mentor** — `tier: expert`, **attivo** (basi implementate, ottimizzazione in corso). Career coach: analizza il gap profilo/risultati, produce un piano d'azione, check-in strategici. User-facing always-on, spawnato al boot. Cartella: `agents/mentor/`.

---

## 🩺 Side-channel — Salute & manutenzione

Fuori dalla pipeline. Agenti **one-shot schedulati**: il watchdog ne crea uno per ogni slot giornaliero; eseguono una sweep, riportano al Captain, poi si auto-distruggono.

```
   ┌────────────┐  daily slot  ┌──────────────┐  report  ┌────────────┐
   │ watchdog   │ ───────────► │ 🩺 Dottore   │ ───────► │ 👨‍✈️ Captain│
   │ (scheduler)│              │ 👷‍♂️ Mantenitore│  findings │            │
   └────────────┘              └──────────────┘          └────────────┘
                                  one-shot → self-destruct
```

- **🩺 Dottore** — **salute degli agenti**. Refresh periodico del contesto + retrospettiva: rileva sessioni di agenti bloccate/zombie e le riavvia con contesto fresco (thread di lunga durata che bruciano contesto causano un collasso silenzioso del throughput). Cartella: `agents/dottore/`.
- **👷‍♂️ Mantenitore** — **salute dell'infrastruttura**. Sweep di manutenzione giornaliera sul container/VPS: smoke-test dei tool mission-critical (canary browser/Playwright), standardizzazione delle dipendenze (`jht-install`), trend disco/RAM, GC degli orfani. Un tool cruciale rotto è un P1. Cartella: `agents/mantenitore/`.

---

## 💬 Comunicazione

```
   ┌──────────┐   tmux send-keys    ┌──────────┐
   │ Captain  │ ◄─────────────────► │ Agents   │
   │          │   [@from -> @to]     │ (one     │
   │          │   MSG / REQ / RES /  │  tmux    │
   │          │   URG                │  session │
   └────┬─────┘                      │  each)   │
        │                            └──────────┘
        │  Telegram bot
        ▼
    📲 User
```

I messaggi inter-agente usano una busta taggata (`[@scout-1 -> @capitano] [REQ] ...`). Protocollo completo: [`agents/_manual/communication-rules.md`](../_manual/communication-rules.md).

---

## 🔗 Correlati

- 📋 [`agents/_manual/`](../_manual/) — documenti di riferimento operativo consumati a runtime (schema DB, protocollo di comunicazione, contratto anti-collision)
- 📜 [`docs/adr/`](../../docs/adr/) — decisioni architetturali (CLI supportate, single-writer, subscription-only)
