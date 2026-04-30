# 🧭 Job Hunter — Team Architecture

---

## 🧠 How agents are tiered

JHT pins each role to one of **four tiers**, listed from highest to lowest. The tier captures the model + reasoning effort the launcher passes to the active provider's CLI.

| Tier | Agents | Claude | Codex | Kimi | What it does |
|---|---|---|---|---|---|
| 🥇 **very smart** | 👨‍✈️ Captain | `opus-4-7` · effort `high` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Critical, irreversible decisions — full reasoning depth |
| 🥈 **expert** | 👨‍🏫 Writer · 👨‍⚖️ Critic · 🧙‍♂️ Mentor | `opus-4-7` · effort `medium` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Pattern-matching against well-known templates (CV, blind review, gap analysis) |
| 🥉 **smart** | 🕵️‍♂️ Scout · 👨‍🔬 Analyst · 👨‍💻 Scorer · 👨‍💼 Assistant | `sonnet-4-6` · effort `high` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Research, scraping, scoring, user chat |
| 🎖️ **medium** | 💂 Sentinel | `sonnet-4-6` · effort `medium` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Light watchdog — if-then rules, no deep thinking |

**Available effort levels (for reference):**

- **Claude** — `low · medium · high · xhigh · max` (Opus 4.7, Apr 2026). `xhigh`/`max` unused for now — cost trade-off.
- **Codex** — `minimal · low · medium · high · xhigh` (GPT-5.5). Default `medium`.
- **Kimi** — CLI doesn't expose effort levels yet, so all tiers collapse onto a single call.

---

## 🗺️ Pipeline at a glance

```
   👤 User
     │
     ▼
   👨‍✈️ Captain ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──────► Phase 5 ──► 👤 User
                  🕵️‍♂️ Discover  👨‍🔬 Verify  👨‍💻 Score   👨‍🏫 👨‍⚖️ Write+Review   📲 Notify
```

Each phase below is one specialized agent role. The Captain decides **how many instances** to spin up per role at any given time — agent count is dynamic, not baked into the architecture.

---

## 1️⃣ Phase 1 — Discovery 🔍 🕵️‍♂️

```
        👤 candidate_profile.yml ──┐
                                    │ circles, filters, work_mode
                                    ▼
        ┌──────────────────────────────────────┐
        │ 🕵️‍♂️ Scout pool                       │
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

**What Scouts do.** Pull job postings from job boards and ATSs, deduplicate against `jobs.db`, and write fresh positions with `status = new`. Stop when the Captain says so.

### 🤝 Multi-scout coordination

Multiple Scouts run in parallel without ever fetching the same posting twice:

- 🗺️ **Partition at boot** — peers discover each other via `tmux list-sessions`, then negotiate territory through `scout_coord.py` (which **circles** and **sources** each owns).
- 🎯 **Circles** — concentric scopes, exhausted inside-out: ① primary preference → ② geo neighbors → ③ targeted relocation → ④ satellite → ⑤ frontier (adjacent roles).
- 📚 **Source tiers** — drained in order: LinkedIn → ATS aggregators (Greenhouse/Lever/Indeed/Wellfound) → niche boards (PyJobs, RemoteOK, regional) → WebSearch + career pages.
- ⚖️ **Anti-bias** — if more than 30% of a batch's positions come from the same employer, the Scout switches source/query for the next batch. Without this, one scaleup that dumps 12 roles on a single board would flood the pool, crowding out diversity.
- 🛡️ **Anti-collision** — dedup check on `positions.url` before every `INSERT` ([`anti-collision.md`](../_manual/anti-collision.md)).

### 🔁 Listening to feedback

Scouts ingest `[FEEDBACK]` messages from Analysts (and indirectly from Scorers via the Captain) tagged with `[SENIORITY] · [STACK] · [GEO] · [LINGUA]`, and adjust queries/sources for the next batch. Systemic bias gets escalated to the Captain.

### 🛠️ Skills

Available under `/app/shared/skills/`:

- **`scout_coord.py`** — boot-time territory partition (which Scout owns which circle/source); used to negotiate ownership and verify the assignment.
- **`db_query.py check-url`** — dedup gate. Run before every insert; returns `TROVATA` (skip) or `NON TROVATA` (proceed).
- **`db_insert.py position`** — write a verified posting into `positions`. Required fields: title, company, URL, location, JD text, requirements.
- **`db_update.py position`** — used to mark already-inserted records as `excluded` when a duplicate slips through. Never DELETE.
- **`linkedin_check.py`** — authenticated LinkedIn enrichment (job IDs → full posting metadata) without tripping `fetch` MCP's robots block.

### 🌐 MCP tools

- **`jobspy`** — multi-source job board scraper (LinkedIn, Indeed, ZipRecruiter, Glassdoor) wrapped as MCP. Fast bulk discovery, normalized output.
- **`linkedin`** — dedicated LinkedIn MCP for search + posting fetch.
- **`fetch`** — general HTTP fetch for ATS aggregator pages (Greenhouse, Lever, Wellfound). ⚠️ Blocked by LinkedIn robots.txt — Scouts fall back to `curl` with browser user-agent there.
- **`playwright`** — headless browser for JS-heavy career pages where simple `fetch` doesn't render the DOM.
- **`WebSearch`** *(built-in)* — Tier-4 fallback when ATS/niche boards are exhausted.

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
                        🕵️‍♂️ Scout pool
```

**What Analysts do.** Pull `status = new` positions, fetch the live JD, validate the link, parse 5 structured fields (`ESPERIENZA_RICHIESTA · ESPERIENZA_TIPO · LAUREA · LINGUA_RICHIESTA · SENIORITY_JD`), and either promote to `checked` or mark `excluded`. Real years are computed from dated entries in the profile, not from the rounded `experience_years` field. The candidate is treated as **adaptable** — adjacent stacks aren't excluded, the Scorer applies a proportional gap penalty downstream.

### 🚫 Exclusion tags

Excluded notes start with `ESCLUSA: [TAG]` — `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` (`req > real+3` or senior/lead JD) · `[STACK]` (out-of-domain). When uncertain → `checked`: false negatives cost more than false positives.

### 🤝 Multi-analyst coordination

- 🕒 **`last_checked` watermark** — Analysts skip records recently updated by a peer.
- 🛡️ **Anti-collision contract** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Feedback to Scouts

When 3 consecutive exclusions hit the same source with the same tag, or a Scout's batch exceeds 60% rejection rate, the Analyst sends a `[FEEDBACK]` back to that Scout — specific (source + tag + IDs), actionable (suggested alternative), idempotent (one per pattern).

### 🛠️ Skills

- **`db_query.py next-for-analista`** — pulls next `status=new` position respecting the `last_checked` watermark.
- **`db_query.py position <ID>`** — fetches full JD + metadata for analysis.
- **`db_update.py position <ID>`** — writes new status (`checked` or `excluded`) + structured notes.
- **`linkedin_check.py`** — authenticated LinkedIn check (alive / expired / company info).

### 🌐 MCP tools

- **`fetch`** — GET the live JD with `-L` + browser UA; detects "expired / closed-job" markers.
- **`playwright`** — fallback for JS-heavy ATS pages `fetch` can't render (Workable/Lever/Ashby).
- **`linkedin`** — bypassed: LinkedIn checks go through `linkedin_check.py` (authenticated).

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
                        🕵️‍♂️ Scout pool  (via 👨‍✈️ Captain)
```

**What Scorers do.** Run a **pre-check** (years of experience, location, mandatory degree without "or equivalent") to filter out unscorable positions, then assign a 0-100 score against the candidate profile. `< 40` → `excluded`. `40-49` → `scored` (parking, Captain decides later). `≥ 50` → `scored` + notify Writers.

### 🧮 Scoring formula (0-100)

| Component | Weight | DB column | What it measures |
|---|---|---|---|
| Stack match | 35 | `stack_match` | Required skills vs candidate's stack |
| Seniority fit | 25 | `experience_fit` | Years required vs candidate's real years |
| Remote / location | 20 | `remote_fit` | Fit with profile location preferences |
| Salary fit | 10 | `salary_fit` | Offered range vs target |
| Stack bonus | 10 | `strategic_fit` | Tech bonus (AI · cybersec · fintech, if strong areas for the candidate) |

Penalties applied on top: `−10` mandatory degree without "or equivalent" · `−15` mandatory language not spoken · `−5` vague JD with no concrete requirements.

### 🤝 Multi-scorer coordination

- 🕒 **`last_checked` claim** — Scorer stamps the timestamp before scoring; peers skip records claimed in the last 5 minutes.
- 🛡️ **DB write boundary** — Scorer writes `scores` (INSERT) and `positions.status` only. Never touches `applications`, `companies`, or `positions.notes` (Analyst's territory).
- 🛡️ **Anti-collision contract** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Feedback to Scouts (via Captain)

The Scorer's live score distribution (by source / role / geo / stack) is read by the Captain and fed back to Scouts so the next batches focus on the candidate's high-score zones.

### 🛠️ Skills

- **`db_query.py next-for-scorer`** — pulls next `status=checked` position respecting `last_checked`.
- **`db_query.py position <ID>`** — full record + Analyst's structured notes (the inputs to the formula).
- **`db_insert.py score`** — writes the breakdown (5 components + total).
- **`db_update.py position <ID>`** — sets `status = scored | excluded`.

### 🌐 MCP tools

- **`fetch`** — re-validates the link before scoring (postings die fast — Phase 2 may have been a while ago).

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

**What Writers do.** Pull `status = scored` positions in score-descending order (≥70 first, then 50-69), claim by setting `status = writing`, generate a tailored CV (Cover Letter only if the JD asks for one), then run **3 obligatory rounds** with the Critic. Between rounds the Writer corrects the CV and regenerates the PDF. Final gate: `critic_score ≥ 5` → `ready`, else `excluded`. **Zero invenzioni** — every claim in the CV must trace back to `candidate_profile.yml`.

**What the Critic does.** Spawned fresh for each round (`CRITICO-S<N>`), receives the PDF path + JD URL, performs a **blind review** (no profile access — only the page in front of it), returns a structured verdict: voto X/10 + structure/relevance/impact analysis + required-vs-CV table + prioritized actions. Killed after every review — never reused. Uses the full 1-10 scale; no courtesy votes.

The Writer ↔ Critic loop is the most token-heavy phase. Both sit on the **expert** tier (top model + medium effort) — the task is well-defined, no exploratory thinking required.

### 🤝 Multi-writer coordination

- 🛡️ **`status = writing` claim** — Writers flip status before writing; peers skip records already claimed.
- 🚫 **Anti-rewriting** — if `critic_verdict` is already set, **skip absolute** (verdict is final, no re-review).
- 📡 **DB write boundary** — Writer touches `positions.status` and `applications` only; never `scores`, `companies`, `positions.notes`.

### 🛑 Captain freeze

When the Sentinel flags rate-limit saturation, the Captain sends `[URG] FREEZE` to Writers. They complete the current round if mid-loop (never abandoning a Critic mid-review), then sleep until the throttle returns to T0/T1.

### 🛠️ Skills

- **`db_query.py next-for-scrittore`** — pulls next position in score-descending order.
- **`db_update.py position`** — flips `status = writing | ready | excluded`.
- **`db_insert.py application`** — registers the application + CV/PDF paths.
- **`db_update.py application`** — saves `critic_score · critic_verdict · critic_round · critic_notes` per round.
- **`pandoc`** — converts the CV markdown to PDF via Typst engine.

### 🌐 MCP tools

- **`fetch`** — re-validates the JD link before writing; the Critic uses the same MCP to read the live JD.
- **`WebFetch`** / **`WebSearch`** — fallback when `fetch` can't reach the JD (LinkedIn / robots.txt blocks).

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

**What happens.** When a Writer closes Phase 4 with `verdict = PASS` and `status = ready`, the Captain receives a `[RES]` message with the PDF and verdict. A Telegram message goes to the user with the position title, company, the generated CV PDF, and the job's link.

**Why the apply step is fully manual.** The user reads the CV, judges fit themselves, sends feedback to the Captain (`tone is off` · `missing this experience` · `good — I'll apply` · …), and **only then decides whether to apply** — using the link they already have. This human checkpoint is intentional: it keeps JHT a coach for the worker, not a slop cannon spraying low-effort applications at recruiters. Volume on the recruiter side is meaningful only if the worker chose it.

**Status update.** When the user applies, the position is flagged `status = applied` manually (Telegram reply or the web dashboard's "I applied" button), with `applied_via = telegram | web | manual`. Optional `response` lifecycle (interview · rejection · ghosted) is user-tracked too.

### 🛠️ Skills / tools

- **`shared/telegram/`** — TypeScript bot + bridge for outbound notifications and inbound user feedback / status updates.
- **`positions.applied`** — DB flag flipped by the user (never automatically by the team).

---

## 🎮 Pipeline orchestration

The pipeline is not a static N-instances-per-role configuration: it's a **feedback-driven loop** the Captain runs dynamically based on flow rate, queue depth, and the user's budget. Numbers below are illustrative, not normative.

### 🥾 Cold start — fill the funnel

When the pipeline starts from zero, priority is feeding the downstream queues fast:

```
   T=0       →  3× 🕵️‍♂️ Scout                                    (flood the funnel)
   T+ a bit  →  2× 🕵️‍♂️ Scout · 1× 👨‍🔬 Analyst                    (first offers to verify)
   T+ more   →  2× 🕵️‍♂️ Scout · 1× 👨‍🔬 Analyst · 1× 👨‍💻 Scorer    (first verified ready to score)
```

If the Analyst falls behind the Scouts, the Captain rebalances on the fly: `+1 Analyst · −1 Scout`. Same logic flows downstream.

### 🔁 Feedback loop — self-tuning search

The first batch processed by each downstream role is **golden** — it's the data the downstream agent uses to coach the upstream one:

- **👨‍🔬 Analyst → 🕵️‍♂️ Scout** — after a meaningful first batch, the Analyst flags rejection patterns (companies that close postings fast, scam boards, JD shapes that always fail verification). Scouts skip those upstream.
- **👨‍💻 Scorer → 🕵️‍♂️ Scout** — once the Scorer has seen a sample, it knows which roles/stacks/geographies score high. It feeds the distribution back so Scouts search closer to the high-score zones.

Result: every cycle, Scouts find better offers, Analysts reject fewer good ones, Scorers see higher score distributions. The team becomes a **self-tuning system**.

### 🎯 Writer activation gate

Writer + Critic loops are the most expensive part of the pipeline (top-tier model, iterative review). They **alternate** — the Writer waits while the Critic reviews and vice versa — so one Writer + Critic pair costs roughly **one continuous agent**, not two.

To avoid spending those tokens on mediocre offers, the Captain gates Writer activation by queue depth at high score:

1. Sort queued positions by score descending.
2. Wait until enough high-score offers have accumulated (e.g. **10+ offers with score ≥ 75**).
3. Spawn Writers — they always start from the highest-scoring queued position.

### 💰 Budget-aware throttling

All instance counts and gate thresholds adapt to the user's monthly budget and the live usage signal from the [📡 Bridge → 💂 Sentinel](#-side-channel--usage-monitoring) side-channel. Aggressive bootstrap on a tight budget gets throttled before quality writing starts — better to skip a few offers than to burn the budget on Discovery and have nothing left for Writing.

---

## 📡 Side-channel — Usage monitoring

Out of the pipeline. Runs continuously alongside it.

```
   ┌────────────┐  every tick  ┌────────────┐  notify on edge  ┌────────────┐
   │ 📡 Bridge  │ ───────────► │ 💂 Sentinel│ ───────────────► │ 👨‍✈️ Captain│
   │ (process,  │ usage + proj │ tier:      │  only on real    │            │
   │  not Claude│              │  medium    │  state changes   │            │
   │  agent)    │              │ event-     │                  │            │
   └────────────┘              │ driven     │                  └────────────┘
                               └────────────┘
```

**Bridge.** A non-AI process that polls each agent CLI for current usage and projected exhaustion. Pushes a tick to the Sentinel.
**Sentinel.** Edge-triggered: ingests every tick but talks to the Captain *only* when something actually changes (usage spike, projection breach, agent crash).
**Captain.** Reacts — throttles, freezes the team, kills offending sessions — based on the Sentinel's signal.

---

## 🤝 Side-channel — User-facing helpers

```
                        👤 User
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
       👨‍💼 Assistant  👨‍✈️ Captain   🧙‍♂️ Mentor
       platform      team commander  career coach
       copilot                       (planned)
```

- **👨‍💼 Assistant** — `tier: smart`. Translates non-technical user requests into orders for the Captain. Hides implementation details from the user-facing chat.
- **🧙‍♂️ Mentor** — `tier: expert`, planned. Future career coach: analyzes profile/results gap, produces an action plan. Folder: `agents/maestro/`.

---

## 💬 Communication

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

Inter-agent messages use a tagged envelope (`[@scout-1 -> @capitano] [REQ] ...`). Full protocol: [`agents/_manual/communication-rules.md`](../_manual/communication-rules.md).

---

## 🔗 Related

- 📋 [`agents/_manual/`](../_manual/) — operational reference docs consumed at runtime (DB schema, comm protocol, anti-collision contract)
- 📜 [`docs/adr/`](../../docs/adr/) — architectural decisions (supported CLIs, single-writer, subscription-only)
