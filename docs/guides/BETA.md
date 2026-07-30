# 🧪 Beta Tester Program

JHT is in active beta. We're looking for a small group of real job-seekers who are willing to run the team against their actual job search and tell us what breaks.

## Why your test matters

JHT's claims are backed by four documented case studies — including a **one-month fully autonomous run on Codex** (658 positions found, 520 scored, weekly budget self-managed at 99–100% with zero human interventions — [case study #4](../about/RESULTS.md#-case-study-4--the-finance-profile--codex-pro-one-month-autonomous-run)). But that's still a handful of profiles across three provider tiers.

Public users will ask: *"does it work for my role? on my provider? at my cost?"* Every new profile × provider combination adds a real answer. **You testing JHT on your real job hunt is how we find out.**

## Who we're looking for

- 🔍 You're **actively looking for a job** (or about to start) — JHT is not interesting if you don't have a real pipeline to feed it
- 💳 You can afford **at least one supported subscription** — see [`PROVIDERS.md`](../about/PROVIDERS.md). The Kimi €40 tier is our target for beta testers.
- 💬 You're willing to **report back honestly** — what worked, what didn't, what was confusing

**No external terminal is required by the native app.** The Godot office embeds provider and maintenance consoles; advanced testers can still use the CLI one-liner or let an AI assistant drive setup (see [`AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md)).

## What you get

- ✅ Direct support from the maintainer
- ✅ Early access to features before they ship
- ✅ Your case study added to [`RESULTS.md`](../about/RESULTS.md) (anonymized if you prefer)
- ✅ Influence on what gets built next

## What we ask in return

- 📝 Use JHT for your real job search for **at least 2 weeks**
- 📊 Share your **numbers** at the end (offers analyzed, CVs sent, interviews — see the [`RESULTS.md`](../about/RESULTS.md) template)
- 🐛 File **issues** for everything that confused, broke, or surprised you — the workflow is in [`docs/guides/FEEDBACK-TICKETING.md`](FEEDBACK-TICKETING.md)
- 🗣️ Be available for a **30-minute call** at the end of the test period
- 🧪 **No cherry-picking** — report failures and rate-limit incidents too. Bad cells matter as much as good ones.

## Where we are with case studies

Our **pre-launch commitment** is not to fill a coverage matrix — it's to **document well what we have**. The plan is to publish solid case studies on the runs already completed, with a stable schema and visualization on `/case-studies`. Once that structure is in place, new beta testers can plug in their data with low overhead.

**Pre-launch (must-have):**

| # | Persona | Provider tier | Status |
|---|---|---|---|
| 1 | Full-stack dev (maintainer baseline) | 🟠 Claude Max x20 | ✅ documented — see [Case study #1](../about/RESULTS.md#-case-study-1--the-maintainer-legacy-team-early-2026) |
| 2 | Senior multilingual technical documentation profile (multi-country EU) | 🔵 Codex Pro €100 | ✅ documented — see [Case study #2](../about/RESULTS.md#-case-study-2--the-multilingual-senior-profile--codex-pro-35-hour-run) |
| 3 | Junior software developer (capital city, no degree) | 🌙 Kimi K2 Pro €40 | ✅ documented — see [Case study #3](../about/RESULTS.md#-case-study-3--the-junior-developer-profile--kimi-k2-pro-75-hour-run) |
| 4 | Maintainer baseline (weekly-distributed run) | 🌙 Kimi K2 Pro €40 | 🟡 data collected, **processing pending** |
| 5 | Maintainer baseline (re-test with better monitoring) | 🟠 Claude Max x20 | 🟡 previous run lacked instrumentation, **to be re-run + documented** |
| 6 | Early-career finance profile (EU financial hubs) | 🔵 Codex Pro €100 | ✅ documented — see [Case study #4](../about/RESULTS.md#-case-study-4--the-finance-profile--codex-pro-one-month-autonomous-run) — **one-month autonomous run** |
| 7 | Two external multi-week teams, different personas | 🌙 Kimi K2 Pro €40 | 🟡 **running, under observation** — these are the runs that decide whether the €40 tier leaves beta (mission M4). Not yet processed into case studies. |

**Post-launch (open invitation):**

We welcome beta testers from **any role and any industry** — not just IT/tech. Marketing, design, finance, ops, sales, healthcare, education, legal: JHT is profile-agnostic, the only variable that materially changes the experience is the **provider tier**. Pick whichever supported subscription you can afford and we'll help you publish your own case study, anonymized if you prefer.

> Why we dropped the "8/12 cells pre-launch" target: the persona × provider matrix was double-counting effort. The team behaves the same whether you're a junior PM or a senior backend — only `candidate_profile.yml` changes. What matters at launch is that the **3 tier signals** (€100 / €40 / €20) are honestly characterized; persona-specific lessons emerge from real post-launch use.

## How to apply

Open an issue on GitHub with the title **"Beta tester application — [your handle]"** and answer:

1. What role / industry are you searching in?
2. Where are you based (country / remote)?
3. Which subscription do you have or plan to get?
4. How much time per week can you commit?
5. (Optional) Anything specific about your profile/industry we should know — JHT is profile-agnostic but real-world feedback from outside IT/tech is especially welcome
6. Anything else we should know

We will reply within a few days.

## What's stable enough today

Before signing up, set expectations:

- ✅ The agent team runs end-to-end (pipeline + Assistant)
- ✅ Web dashboard, CLI and Telegram all work
- ✅ Claude Max x20 is rock-solid; Codex ~€100 is proven over a full autonomous month ([case study #4](../about/RESULTS.md#-case-study-4--the-finance-profile--codex-pro-one-month-autonomous-run))
- 🟡 Kimi €40 works but token monitoring still has rough edges (see [`MONITORING.md`](../about/MONITORING.md))
- 🟠 CLI onboarding wizard still has rough edges — expect to ask for help once or twice
- 🟠 The native Godot app now contains the complete setup and interaction cockpit; cross-platform onboarding QA is still active beta work

If "rough edges" doesn't scare you, you're the kind of beta tester we need.

## Related

- [`STORY.md`](../about/STORY.md) — why this project exists
- [`RESULTS.md`](../about/RESULTS.md) — case study template + published results
- [`MONITORING.md`](../about/MONITORING.md) — Bridge/Sentinel monitoring stack (architecture + test data)
- [`docs/guides/FEEDBACK-TICKETING.md`](FEEDBACK-TICKETING.md) — how to file useful feedback
