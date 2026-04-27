# Beta Tester Program

JHT is in active beta. We're looking for a small group of real job-seekers who are willing to run the team against their actual job search and tell us what breaks.

## Why your test matters

Every claim about JHT today (Claude ±5% precision, Kimi ±10–15%, ~200 offers / 5 interviews in 2 weeks) is **anecdotal** — it comes from a single profile (the maintainer's, full-stack developer) running on a single provider tier (Claude Max x20).

Public users will ask: *"does it work for my role? on my provider? at my cost?"* We don't have those answers yet. **You testing JHT on your real job hunt is how we find out.**

## Who we're looking for

- 🔍 You're **actively looking for a job** (or about to start) — JHT is not interesting if you don't have a real pipeline to feed it
- 💳 You can afford **at least one supported subscription** — see [`PROVIDERS.md`](PROVIDERS.md). The Kimi €40 tier is our target for beta testers.
- 💬 You're willing to **report back honestly** — what worked, what didn't, what was confusing

**No technical background required.** JHT runs from a desktop app — installation is one click, and the team's Assistant walks you through anything you don't understand. If you can install a regular app and follow on-screen instructions, you can run JHT.

## What you get

- ✅ Direct support from the maintainer
- ✅ Early access to features before they ship
- ✅ Your case study added to [`RESULTS.md`](RESULTS.md) (anonymized if you prefer)
- ✅ Influence on what gets built next

## What we ask in return

- 📝 Use JHT for your real job search for **at least 2 weeks**
- 📊 Share your **numbers** at the end (offers analyzed, CVs sent, interviews — see the [`RESULTS.md`](RESULTS.md) template)
- 🐛 File **issues** for everything that confused, broke, or surprised you — the workflow is in [`docs/feedback-ticketing.md`](feedback-ticketing.md)
- 🗣️ Be available for a **30-minute call** at the end of the test period
- 🧪 **No cherry-picking** — report failures and rate-limit incidents too. Bad cells matter as much as good ones.

## Coverage we still need

We're tracking a coverage matrix of (provider × persona). Cell #1 is the maintainer's anecdotal data; the other 9 are what we need beta testers for. **Kimi €40 cells are highest priority** (mass-market target). Pre-launch goal: **at least 8/10 cells filled**.

| # | Persona | Provider tier | Status |
|---|---|---|---|
| 1 | Full-stack dev | 🟠 Claude Max x20 | ✅ done (anecdotal — see [`STORY.md`](STORY.md)) |
| 2 | Full-stack dev | 🌙 Kimi Pro €40 | ⬜ open |
| 3 | Data engineer | 🟠 Claude Max x20 | ⬜ open |
| 4 | Data engineer | 🌙 Kimi Pro €40 | ⬜ open |
| 5 | Marketing mgr | 🌙 Kimi Pro €40 | ⬜ open |
| 6 | Junior PM | 🌙 Kimi Pro €40 | ⬜ open |
| 7 | Senior backend | 🔵 Codex Pro €100 | ⬜ open |
| 8 | Senior backend | 🌙 Kimi Pro €40 | ⬜ open |
| 9 | Full-stack dev | 🟠 Claude Pro €20 (re-test) | ⬜ open |
| 10 | Marketing mgr | 🔵 Codex Plus €20 | ⬜ open |

If you match one of the open cells, mention the number in your application. Otherwise we'll try to slot you in based on your profile.

## How to apply

Open an issue on GitHub with the title **"Beta tester application — [your handle]"** and answer:

1. What role / industry are you searching in?
2. Where are you based (country / remote)?
3. Which subscription do you have or plan to get?
4. How much time per week can you commit?
5. (Optional) Which cell number from the coverage matrix do you fit?
6. Anything else we should know

We will reply within a few days.

## What's stable enough today

Before signing up, set expectations:

- ✅ The 8-agent team runs end-to-end (pipeline + Assistant)
- ✅ Web dashboard, CLI, Telegram, Desktop launcher all work
- ✅ Claude Max x20 is rock-solid
- ✅ macOS installer is signed + notarized (no Gatekeeper warning)
- 🟡 Kimi €40 works but token monitoring still has rough edges (see [`MONITORING.md`](MONITORING.md))
- 🟠 Onboarding wizard still has rough edges — expect to ask for help once or twice
- 🔴 Windows / Linux installers are **not signed yet** — your OS will show a "publisher unknown" warning at first launch

If "rough edges" doesn't scare you, you're the kind of beta tester we need.

## Related

- [`STORY.md`](STORY.md) — why this project exists
- [`RESULTS.md`](RESULTS.md) — case study template + published results
- [`MONITORING.md`](MONITORING.md) — Bridge/Sentinel monitoring stack (architecture + test data)
- [`docs/feedback-ticketing.md`](feedback-ticketing.md) — how to file useful feedback
