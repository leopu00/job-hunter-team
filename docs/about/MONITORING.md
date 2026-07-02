# 📡 Monitoring stack

JHT runs on subscription LLMs, which means the single most important engineering problem is: **how close to 100% of the subscription window can we run, without ever crossing it?**

This page documents the monitoring stack (Bridge + Sentinel) and the test data we have so far.

## 🏗️ Architecture

Two cooperating components:

- **🌉 Bridge** — runs on a fixed clock, fetches usage samples from the provider, and projects when the team will hit 100% of the current window
- **🛡️ Sentinel** — event-driven, intervenes on the Captain only when the Bridge sees the projection drifting too high

This separation (clock-only Bridge + event-driven Sentinel) is the result of multiple iterations — earlier versions had the Sentinel polling continuously, which itself burned too many tokens.

## 🧪 Test results so far

> ⚠️ Numbers below come from real-world usage by the project author over several weeks, **not from a controlled test matrix**. A formal `provider × tier × persona × job-category` matrix is in the pre-launch backlog.

### 🟣 Claude Max x20 — production-ready

| Metric | Value |
|---|---|
| Window tested | 5 hours |
| Target usage | 95% of window |
| Projection oscillation | ± **5%** |
| Frequency of crossing 100% | 0 |
| Captain idle time | minimal — the team stays productive end-to-end |
| Verdict | ✅ Surgical precision. Recommended for users who can afford it. |

**Why so precise**: Anthropic's usage API exposes accurate per-window numbers in near real time, and Claude's response sizes are predictable enough for the projection model.

### 🌙 Kimi €40 — works, optimization in progress

| Metric | Value |
|---|---|
| Window tested | 5 hours |
| Target usage | 85% of window *(15% safety buffer)* |
| Projection oscillation | ± **10–15%** |
| Frequency of crossing 100% | occasional |
| Captain idle time | low |
| Verdict | 🎯 Viable. Lowering oscillation is the active work. |

**Why less precise**: the usage signal we read from Kimi is more variable, and response sizes have a wider distribution. The current mitigation is the 88% target (tuned per-provider in pacing-bridge).

**Validated**: 75h run (Case Study #3, 251 positions) + 10-day beta run (557 positions) both completed within budget. Pacing-bridge per-provider tuning (Kimi 88%, Codex/Claude 92%) landed 2026-05-31. The mass-market threshold is functional — remaining work is oscillation reduction, not viability.

### 🟣 Claude Pro €20 — not viable

A single agent working at modest pace burns through this tier well before the window resets. Not enough headroom for the full team running in parallel. Re-test deferred until Sentinel token consumption drops.

## ⚠️ Known issues

1. **🪟 5h window vs weekly cap** — current calibration optimizes for the 5h reset, but Anthropic's real cap is weekly. Two days of intensive use can exhaust the weekly allowance even when every 5h window stayed under 95%. **Real incident observed** on 2026-05-21 (see `docs/internal/postmortems/2026-05-21-halt-weekly-incident.md`). **Next milestone**: weekly-window calibration.

2. **🛡️ Sentinel itself consumes tokens** — the Sentinel intervenes too often today, and each intervention costs LLM calls. This is *the* reason the €20 base tier is currently unusable. Reducing Sentinel intervention frequency is the highest-leverage optimization left.

   > ⚠️ **Note (2026-07-02, correction):** "*the* reason / highest-leverage" is superseded. A clean full-history measurement shows the coordinators at ~20% of the budget (Captain ~13.6%, **equal on Kimi and Codex**); the "70%" is a coast/idle artifact present on *both* models, not Kimi-specific. Reducing the Sentinel is a ~20% (secondary) lever. Budget size is **not** the structural blocker either: 3 independent methods put Kimi's weekly budget at only **~2× smaller than Codex (~13M vs ~31M tokens/week), not 17×** — same order of magnitude. The real limit is **projection precision** (Kimi ±10-15% vs ±5% on Claude) and behavior (scout rabbit-holes, thinking-mode fragility) — tuning, not a token wall. See [`docs/internal/architecture/kimi-vs-codex-economics.md`](../internal/architecture/kimi-vs-codex-economics.md).

3. ~~**⏰ No work-hours scheduling yet**~~ — **shipped 2026-05-26**. Users now define when the team works (CLI / desktop wizard / web UI). The Bridge distributes the weekly budget only across active hours and computes the per-window target dynamically. See **🗓️ Work hours** below.

## 🗓️ Work hours — team as employee

The team can be configured to **only work during specific hours**, like a human employee. Outside those hours: no new spawns, no promotions, no new writing assignments; in-flight work finishes and the team idles. Mentor & Assistente bots keep replying to the user (only pipeline production stops).

**Why it matters:** with weekly-capped providers (Codex Pro, Claude Max), a 24/7 team burns the whole weekly budget in 2-4 days and then sits idle for the rest of the week. Concentrating the same budget on the user's working hours = more output per €, landing during the user's day, not at 3am.

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
