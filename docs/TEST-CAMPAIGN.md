# Test Campaign — Coverage Matrix & Status

> 🚧 **Living document** — this is the plan + status board for JHT's pre-launch test campaign. Cells get filled as beta testers complete their runs. Latest update: 2026-04-27.

## Why this exists

Every claim about JHT today (Claude ±5% precision, Kimi ±10–15%, ~200 offers / 5 interviews in 2 weeks) is **anecdotal**: it comes from a single profile (the maintainer's, full-stack developer) running on a single provider tier (Claude Max x20).

Public users will ask:
- *"Does it work for my role?"* (data engineer? marketing manager? PM?)
- *"Does it work on my provider?"* (Codex? Kimi €40?)
- *"What's the real cost-per-result for someone like me?"*

We don't have those answers. **This campaign is the highest-leverage doc to publish before the public launch.**

## The matrix

We run a coverage matrix of **(provider × tier × persona × job-category)** tuples. Each cell = one beta tester running JHT on their real job hunt for at least 2 weeks.

### Providers × tiers (4 main + re-test)

| | Provider | Tier | Cost/mo | Why test |
|---|---|---|---|---|
| 🟠 | **Claude** | Max x20 | ~€200 | Already tested by maintainer — re-test with different personas |
| 🟠 | **Claude** | Pro | ~€20 | Re-test after Sentinel optimization (was non-viable) |
| 🔵 | **Codex** | Plus | ~€20 | Cheapest viable Codex tier |
| 🔵 | **Codex** | Pro | ~€100 | Mid-tier, strong reasoning |
| 🌙 | **Kimi** | Pro | ~€40 | Mass-market target — most important to validate |

### Personas (5+ minimum)

Diverse profiles to ensure JHT generalizes beyond the maintainer's role:

| | Persona | Seniority | Industry / Role | Location |
|---|---|---|---|---|
| 1 | Full-stack developer | Mid | Tech / SaaS | EU remote |
| 2 | Data engineer | Senior | Tech / Finance | EU on-site |
| 3 | Marketing manager | Mid | Consumer / B2C | EU/US remote |
| 4 | Junior product manager | Junior | Tech / Startup | EU remote |
| 5 | Senior backend engineer | Senior | Tech / Enterprise | EU/US remote |

*(Add more personas as beta tester pool grows — UX designer, DevOps, sales, etc.)*

### Job categories

Each persona is matched with a realistic job-pool category:

- Full-stack → React/Node startups, scale-ups
- Data engineer → Data platforms, fintech, modern data stack
- Marketing manager → SaaS marketing, growth, brand
- Junior PM → Product analyst, associate PM, APM programs
- Senior backend → Distributed systems, platform engineering, infra

## Metrics per cell

For each (provider × tier × persona) tuple we collect:

- 📊 **Usage projection precision** — oscillation ±%, max overshoot, rate-limit incidents
- 💰 **Cost per result** — total LLM spend ÷ interview invites
- 🎯 **Conversion funnel** — offers analyzed → applications sent → interview invites → next-stage
- ⏱️ **Time to first interview** — calendar days from start
- 🛠️ **Setup time + friction** — hours from install to first run, blockers encountered
- 🗣️ **Anecdotes / quotes** — qualitative tester feedback
- 💸 **Real subscription receipts** — proof of cost (anonymized)

## Status board

| # | Persona | Provider tier | Tester | Status | Started | Results |
|---|---|---|---|---|---|---|
| 1 | Full-stack dev | 🟠 Claude Max x20 | maintainer | ✅ done (anecdotal) | early 2026 | [`STORY.md`](STORY.md) — 200/20/5 in 2 weeks |
| 2 | Full-stack dev | 🌙 Kimi Pro €40 | TBD | ⬜ open | — | — |
| 3 | Data engineer | 🟠 Claude Max x20 | TBD | ⬜ open | — | — |
| 4 | Data engineer | 🌙 Kimi Pro €40 | TBD | ⬜ open | — | — |
| 5 | Marketing mgr | 🌙 Kimi Pro €40 | TBD | ⬜ open | — | — |
| 6 | Junior PM | 🌙 Kimi Pro €40 | TBD | ⬜ open | — | — |
| 7 | Senior backend | 🔵 Codex Pro €100 | TBD | ⬜ open | — | — |
| 8 | Senior backend | 🌙 Kimi Pro €40 | TBD | ⬜ open | — | — |
| 9 | Full-stack dev | 🟠 Claude Pro €20 (re-test) | TBD | ⬜ open | — | — |
| 10 | Marketing mgr | 🔵 Codex Plus €20 | TBD | ⬜ open | — | — |

> Target: at least **8/10 cells filled** before public launch. Kimi €40 cells are the highest priority (mass-market target).

## How to participate

Beta testers self-assign to an open cell:

1. Read [`docs/BETA.md`](BETA.md) — beta tester program requirements
2. Open a GitHub issue titled **"Test campaign — cell #N"** (replace N with the cell number)
3. Mention which persona you match and your provider/tier
4. Run JHT for at least 2 weeks on your real job hunt
5. Submit your results PR updating this file's status board + adding a row to [`RESULTS.md`](RESULTS.md)

## Methodology notes

- **Honesty over hype**: report failures and rate-limit incidents, not just successes
- **Anonymization optional**: testers choose whether to publish under handle, name, or fully anonymous
- **No cherry-picking**: every cell that starts must be reported, even if results are bad — that's the whole point
- **Reproducibility**: each result row links to the tester's `candidate_profile.yml` template (anonymized) so others can compare apples-to-apples

## Aggregation & publication

Once cells start filling:

- 📈 **Aggregate graphs** → published in [`docs/MONITORING-RESULTS.md`](MONITORING-RESULTS.md) (oscillation distribution, cost-per-result by tier, etc.)
- 📚 **Per-cell case studies** → published in [`docs/RESULTS.md`](RESULTS.md) (one section per persona+tier, with the tester's narrative)
- 📊 **This file** → kept as the source of truth for matrix status

## Related

- [`docs/BETA.md`](BETA.md) — beta tester program
- [`docs/PROVIDERS.md`](PROVIDERS.md) — full provider matrix and pricing
- [`docs/MONITORING-RESULTS.md`](MONITORING-RESULTS.md) — technical monitoring data (will receive aggregate graphs)
- [`docs/RESULTS.md`](RESULTS.md) — case studies (will receive per-cell narratives)
