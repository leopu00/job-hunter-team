# 💳 Providers & Pricing

JHT runs on AI subscriptions, **not pay-per-token**. This is a deliberate design choice — see [ADR-0004](../adr/0004-subscription-only-no-api-keys.md) for the full reasoning. Short version: a team of agents working in parallel burns through pay-per-use credits in hours; subscriptions cost ~5x less per token.

This page tells you which subscription to pick.

## ⚡ TL;DR

| Profile | Pick |
|---|---|
| 💼 You can spend €200/month for the best result | 🟠 **Claude Max x20** |
| 🎯 Best €/result balance, proven over a full month | 🔵 **Codex Plus / Pro €100** *(proven — 1-month autonomous run)* |
| 🧪 The cheapest tier that can work | 🌙 **Kimi €40** *(beta — under observation)* |

## 💳 Supported subscriptions

| Provider | Plan | Cost / month | ~Tokens / month | JHT verdict | Status |
|---|---|---|---|---|---|
| 🟠 **Claude** | Max x20 | ~€200 | ~400M | ✅ **Best in class** — usage projection oscillates within ±5% of target. Captain + Sentinel land the 92% per-window target with surgical precision. | Tested, production-ready |
| 🔵 **Codex / OpenAI** | Plus / Pro | ~€100 | varies | ✅ **Proven over a full month** — 28-day autonomous run: 649 positions found, 513 scored, weekly budget closed at 99–100% every week with zero overshoot ([Case Study #4](RESULTS.md#-case-study-4--the-finance-profile--codex-pro-one-month-autonomous-run)). Pacing tuned at 92% target. | Tested, production-ready |
| 🌙 **Kimi** | Pro | ~€40 | ~320M | 🧪 **Mass-market tier (beta)** — usage projection oscillates ±10–15% (mitigated by 88% target). 75h run: 251 pos, 55 ready (Case Study #3). 10-day beta: 557 pos, 264 scored *(case study in preparation)*. Two multi-week teams live (Jul 2026) to validate month-scale autonomy. | Beta — under observation |
| 🟠 **Claude** | Pro | ~€20 | ~50M | ❌ Insufficient — burns out before a single agent finishes a meaningful work session. | Tested, not viable |

> **Note**: token counts are approximate and depend on the provider's current allowance. Always check the provider's pricing page before subscribing.

## 🎯 How JHT keeps you within the window

Two components prevent runaway spending:

1. **🛡️ Sentinel** — monitors token usage in real time and intervenes if the team is going too fast.
2. **🌉 Bridge** — fetches usage samples on a fixed clock and projects when the team will hit 100% of the window.

The two together aim to land each window *on* its per-provider target — **92% for Claude/Codex, 88% for Kimi** — without ever crossing 100% (which would trigger a rate-limit and freeze the team).

For the actual numbers we measured during testing, see [`MONITORING.md`](MONITORING.md).

## 🔧 What we're working on

- ✅ ~~Weekly window calibration~~ — **Done**. Weekly-aware pacing (`schedule+ratio+weekly`) distributes budget across working hours, not just 5h windows.
- ✅ ~~User-defined work hours~~ — **Done**. Config + gate in pacing-bridge, UI in CLI + web + wizard.
- ⚡ **Make the cheap tiers viable** — what keeps the €20–40 tiers in beta is **projection precision** (Kimi oscillates ±10–15% vs ±5% on Claude) and model behavior (scout rabbit-holes, thinking-mode fragility) — tuning work, not a token wall. Measured across the full history: Kimi's weekly budget is only ~2× smaller than Codex (~13M vs ~31M tokens/week), and the coordinators (Sentinel + Captain) cost ~20% of the budget on *both* providers — a real but secondary lever. Full analysis: [`docs/internal/architecture/kimi-vs-codex-economics.md`](../internal/architecture/kimi-vs-codex-economics.md).

## 💸 What about pay-per-use?

Not yet. Future possibility: you give the team a budget + a deadline, the team auto-coordinates within that envelope. But subscription tokens cost ~5x less, so the subscription model wins on every economic axis as long as we can monitor the window precisely.

If you're curious about the test data behind these numbers, jump to [`MONITORING.md`](MONITORING.md).
