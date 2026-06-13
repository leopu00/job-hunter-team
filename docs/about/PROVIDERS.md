# 💳 Providers & Pricing

JHT runs on AI subscriptions, **not pay-per-token**. This is a deliberate design choice — see [ADR-0004](../adr/0004-subscription-only-no-api-keys.md) for the full reasoning. Short version: a team of 10 agents working in parallel burns through pay-per-use credits in hours; subscriptions cost ~5x less per token.

This page tells you which subscription to pick.

## ⚡ TL;DR

| Profile | Pick |
|---|---|
| 💼 You can spend €200/month for the best result | 🟠 **Claude Max x20** |
| 🎯 You want JHT to actually work without breaking the bank | 🌙 **Kimi €40** *(validated)* |
| 🧪 Mid-tier with strong reasoning | 🔵 **Codex Plus / Pro €100** *(tested)* |

## 💳 Supported subscriptions

| Provider | Plan | Cost / month | ~Tokens / month | JHT verdict | Status |
|---|---|---|---|---|---|
| 🟠 **Claude** | Max x20 | ~€200 | ~400M | ✅ **Best in class** — usage projection oscillates within ±5% of target. Captain + Sentinel hit ~95% of the 5h window with surgical precision. | Tested, production-ready |
| 🌙 **Kimi** | Pro | ~€40 | ~320M | ✅ **Mass-market tier validated** — usage projection oscillates ±10–15% (mitigated by 88% target). 75h run: 251 pos, 56 ready (Case Study #3). 10-day beta: 557 pos, 264 scored. JHT is affordable for everyone at this tier. | Tested, per-provider pacing tuned |
| 🟠 **Claude** | Pro | ~€20 | ~50M | ❌ Insufficient — burns out before a single agent finishes a meaningful work session. | Tested, not viable |
| 🔵 **Codex / OpenAI** | Plus / Pro | ~€100 | varies | ✅ **Tested** — 131 positions in 48h beta run on VPS. Pacing tuned at 92% target. | Tested, production-ready |

> **Note**: token counts are approximate and depend on the provider's current allowance. Always check the provider's pricing page before subscribing.

## 🎯 How JHT keeps you within the window

Two components prevent runaway spending:

1. **🛡️ Sentinel** — monitors token usage in real time and intervenes if the team is going too fast.
2. **🌉 Bridge** — fetches usage samples on a fixed clock and projects when the team will hit 100% of the window.

The two together aim for **~95% of the window** at every reset, without crossing 100% (which would trigger a rate-limit and freeze the team).

For the actual numbers we measured during testing, see [`MONITORING.md`](MONITORING.md).

## 🔧 What we're working on

- ✅ ~~Weekly window calibration~~ — **Done**. Weekly-aware pacing (`schedule+ratio+weekly`) distributes budget across working hours, not just 5h windows.
- ✅ ~~User-defined work hours~~ — **Done**. Config + gate in pacing-bridge, UI in CLI + web + wizard.
- ⚡ **Lower Sentinel token consumption** — the Sentinel itself eats too many tokens today; reducing this is the key to making the €20 base tier viable

## 💸 What about pay-per-use?

Not yet. Future possibility: you give the team a budget + a deadline, the team auto-coordinates within that envelope. But subscription tokens cost ~5x less, so the subscription model wins on every economic axis as long as we can monitor the window precisely.

If you're curious about the test data behind these numbers, jump to [`MONITORING.md`](MONITORING.md).
