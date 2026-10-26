# 💳 Providers & Pricing

JHT runs on AI subscriptions **by default**, and that is the supported path. A team of agents working in parallel burns through pay-per-use credits in hours; subscriptions cost ~5x less per token — the estimate of [ADR-0004](../adr/0004-subscription-only-no-api-keys.md), which [ADR-0012](../adr/0012-desktop-setup-matrix.md) supersedes. ADR-0012 adds a headless path on metered API calls: the [API team](../guides/API-TEAM.md), in rehearsal, with hard spending caps.

This page tells you which subscription to pick.

> **Kimi is archived (0.4)**: it is no longer offered, on the site or in the app. A team already configured on Kimi keeps working. The Kimi runs below are kept as history.

## ⚡ TL;DR

| Profile | Pick |
|---|---|
| 🎯 **Recommended** — best €/result balance, proven over a full month | 🔵 **Codex Plus / Pro €100** *(proven — 1-month autonomous run)* |
| 💼 You can spend €200/month for the best result | 🟠 **Claude Max x20** |

## 💳 Supported subscriptions

| Provider | Plan | Cost / month | ~Tokens / month | JHT verdict | Status |
|---|---|---|---|---|---|
| 🔵 **Codex / OpenAI** | Plus / Pro | ~€100 | varies | ✅ **Proven over a full month** — 30-day autonomous run: 658 positions found, 520 scored, weekly budget closed at 99–100% every week with zero overshoot ([Case Study #4](RESULTS.md#-case-study-4--the-finance-profile--codex-pro-one-month-autonomous-run)). Pacing tuned at 92% target. | Tested, production-ready |
| 🟠 **Claude** | Max x20 | ~€200 | ~400M | ✅ **Best in class** — usage projection oscillates within ±5% of target. Captain + Sentinel land the 92% per-window target with surgical precision. | Tested, production-ready |
| 🟠 **Claude** | Pro | ~€20 | ~50M | ❌ Insufficient — burns out before a single agent finishes a meaningful work session. | Tested, not viable |

> **Note**: token counts are approximate and depend on the provider's current allowance. Always check the provider's pricing page before subscribing.

> ⚖️ **Terms of service** — JHT drives each provider through its **official CLI** (Claude Code, Codex CLI): the same tools your subscription licenses, running on your machine under your account. No scraping, no reverse-engineered endpoints. That said, providers' terms evolve and automation policies differ between plans — **review your provider's current ToS** before running a team around the clock, and prefer a subscription dedicated to JHT (also required for budget reasons, see below).

## 🎯 How JHT keeps you within the window

Two components prevent runaway spending:

1. **🛡️ Sentinel** — monitors token usage in real time and intervenes if the team is going too fast.
2. **🌉 Bridge** — fetches usage samples on a fixed clock and projects when the team will hit 100% of the window.

The two together aim to land each window *on* its per-provider target — **92% for Claude/Codex** — without ever crossing 100% (which would trigger a rate-limit and freeze the team).

For the actual numbers we measured during testing, see [`MONITORING.md`](MONITORING.md).

## 🔧 What we're working on

- ✅ ~~Weekly window calibration~~ — **Done**. Weekly-aware pacing (`schedule+ratio+weekly`) distributes budget across working hours, not just 5h windows.
- ✅ ~~User-defined work hours~~ — **Done**. Config + gate in pacing-bridge, UI in CLI + web + wizard.
- ⚡ **Make the cheap tiers viable** — what keeps the €20 tiers in beta is **projection precision** and model behavior (scout rabbit-holes, thinking-mode fragility) — tuning work, not a token wall. The coordinators (Sentinel + Captain) cost ~20% of the budget — a real but secondary lever.

## 💸 What about pay-per-use?

In rehearsal. Since [ADR-0012](../adr/0012-desktop-setup-matrix.md) an API key selects a headless team on metered calls: the [API team](../guides/API-TEAM.md), which runs on a test VPS with a hard dollar cap per run and per session, and is held to the subscription team's behaviour with parity rounds. The subscription team remains the default, supported path: its tokens cost ~5x less, so it wins on every economic axis as long as we can monitor the window precisely.

If you're curious about the test data behind these numbers, jump to [`MONITORING.md`](MONITORING.md).
