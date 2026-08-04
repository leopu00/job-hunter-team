# 📡 Monitoring stack

JHT runs on subscription LLMs, which means the single most important engineering problem is: **how close to 100% of the subscription window can we run, without ever crossing it?**

This page documents the monitoring stack (Bridge + Sentinel) and the test data we have so far.

## 🏗️ Architecture

Two cooperating components:

- **🌉 Bridge** — runs on a fixed clock, fetches usage samples from the provider, and projects when the team will hit 100% of the current window
- **🛡️ Sentinel** — event-driven, intervenes on the Captain only when the Bridge sees the projection drifting too high

This separation (clock-only Bridge + event-driven Sentinel) is the result of multiple iterations — earlier versions had the Sentinel polling continuously, which itself burned too many tokens.

## 🧪 Test results so far

> ⚠️ Numbers below come from real-world usage over several weeks, **not from a
> controlled test matrix**. They must not be read as universal provider
> benchmarks; broader matrix coverage remains future evidence work.

### 🟣 Claude Max x20 — production-ready

| Metric | Value |
|---|---|
| Window tested | 5 hours |
| Target usage | 92% of window *(per-provider tuning in pacing-bridge)* |
| Projection oscillation | ± **5%** |
| Frequency of crossing 100% | 0 |
| Captain idle time | minimal — the team stays productive end-to-end |
| Verdict | ✅ Surgical precision. Recommended for users who can afford it. |

**Why so precise**: Anthropic's usage API exposes accurate per-window numbers in near real time, and Claude's response sizes are predictable enough for the projection model.

### 🔵 Codex Pro €100 — weekly-aware, proven over a month

| Metric | Value |
|---|---|
| Window tested | weekly cap (Thu→Thu cycle) + 5h windows, over a full month |
| Target usage | 92% per window, weekly-aware distribution across work hours |
| Weekly budget landings | 99% (Jun 18) · **100% reached 10 minutes before the last spendable minute of the cycle** (Jun 24) |
| Frequency of crossing 100% | 0 over 4 consecutive weeks |
| Human interventions | 0 *(read-only observation for the whole run)* |
| Verdict | ✅ Weekly-aware pacing works at month scale. Full run: [RESULTS case study #4](RESULTS.md#-case-study-4--the-finance-profile--codex-pro-one-month-autonomous-run). |

**Why it matters**: Codex's real constraint is the weekly cap, not the 5h window. The bridge distributes the weekly budget across the user's working hours and auto-adapts the burn rate to the residual budget — as the cap approaches, the team coasts (throttle, no new spawns) and lands *on* the cap instead of crossing it.

### 🌙 Kimi €40 — works, optimization in progress

| Metric | Value |
|---|---|
| Window tested | 5 hours |
| Target usage | 88% of window *(12% safety buffer)* |
| Projection oscillation | ± **10–15%** |
| Frequency of crossing 100% | occasional |
| Captain idle time | low |
| Verdict | 🎯 Viable, **in beta**. Lowering oscillation is the active work; two multi-week beta teams are live (Jul 2026) to validate month-scale autonomy. |

**Why less precise**: the usage signal we read from Kimi is more variable, and response sizes have a wider distribution. The current mitigation is the 88% target (tuned per-provider in pacing-bridge).

**Validated**: 75h run (Case Study #3, 251 positions) + 10-day beta run (557 positions — *case study in preparation*) both completed within budget. Pacing-bridge per-provider tuning (Kimi 88%, Codex/Claude 92%) landed 2026-05-31. The mass-market threshold is functional — remaining work is oscillation reduction, not viability.

### 🟣 Claude Pro €20 — not viable

A single agent working at modest pace burns through this tier well before the window resets. Not enough headroom for the full team running in parallel. Re-test deferred until projection precision and coordinator overhead improve.

## ⚠️ Known issues

1. ~~**🪟 5h window vs weekly cap**~~ — **shipped**. Weekly-aware calibration (`schedule+ratio+weekly`) distributes the weekly cap across working hours, and held for a full month on Codex: 99–100% weekly landings, zero overshoot (see the Codex section above). The original problem: two days of intensive use could exhaust the weekly allowance even when every 5h window stayed under 95% — **real incident observed** on 2026-05-21 (see `docs/internal/postmortems/2026-05-21-halt-weekly-incident.md`).

2. **🛡️ Coordinator overhead** — the coordinators (Sentinel + Captain) cost ~20% of the budget, roughly equal on Kimi and Codex (full-history measurement, 2026-07-02) — a real but **secondary** lever. What actually keeps the cheap tiers in beta is **projection precision** (Kimi ±10–15% vs ±5% on Claude) and model behavior (scout rabbit-holes, thinking-mode fragility) — tuning work, not a token wall: Kimi's weekly budget is only ~2× smaller than Codex (~13M vs ~31M tokens/week). See [`docs/internal/architecture/kimi-vs-codex-economics.md`](../internal/architecture/kimi-vs-codex-economics.md).

3. ~~**⏰ No work-hours scheduling yet**~~ — **shipped 2026-05-26**. Users now define when the team works (CLI / desktop wizard / web UI). The Bridge distributes the weekly budget only across active hours and computes the per-window target dynamically. See **🗓️ Work hours** below.

## 🗓️ Work hours — team as employee

The team can be configured to **only work during specific hours**, like a human employee. Outside those hours: no new spawns, no promotions, no new writing assignments; in-flight work finishes and the team idles. Mentor & Assistant bots keep replying to the user (only pipeline production stops).

**Why it matters:** with weekly-capped providers (Codex Pro, Claude Max), an unpaced 24/7 team would burn the whole weekly budget in 2-4 days and then sit idle for the rest of the week. Concentrating the same budget on the user's working hours = more output per €, landing during the user's day, not at 3am.

Configure it three ways — `jht working-hours` (CLI), the desktop setup wizard, or the web dashboard (`/team` → Working hours, with a 7×24 heatmap and a sweet-spot meter). The pacing-bridge reads the schedule live and computes each 5h-window target dynamically from the provider's weekly cap, auto-calibrating on the team's real burn rate over the first few days — no restart, no manual tuning.

> 🔧 **The full mechanics** — target formula, per-provider sweet spots (min/max hours), the auto-calibration daemon, and the config file schemas — live in the design doc: [`docs/internal/architecture/2026-05-25-work-hours-design.md`](../internal/architecture/2026-05-25-work-hours-design.md). CLI commands: [`CLI-REFERENCE.md`](../guides/CLI-REFERENCE.md).

## 📈 What we want to publish

- 📈 **Time-series graphs** of token usage during real test sessions (Claude Max x20 + Kimi)
- 📊 **Oscillation distribution** plots showing how tightly the projection tracks reality
- 🎯 **Per-window summary**: target vs achieved, for ~20 consecutive sessions

These graphs are interesting on their own and will be added to this page (and likely posted publicly) once the Kimi calibration converges.

## 🔗 Related

- [`PROVIDERS.md`](PROVIDERS.md) — which subscription to pick
- [ADR-0004](../adr/0004-subscription-only-no-api-keys.md) — why subscription-only
- `agents/sentinella/sentinella.md` — the Sentinel's prompt and behavior
- `shared/skills/` — the monitoring skills (`bridge_health`, `sentinel_health`, `usage_record`, `compute_metrics`, `rate_budget`)
- `docs/internal/architecture/context-watchdog-spec.md` — periodic agent restart pattern (long-lived threads burning context cause silent throughput collapse; restart restores 5× pipeline velocity)
