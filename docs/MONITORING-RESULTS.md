# Monitoring — Test Results

JHT runs on subscription LLMs, which means the single most important engineering problem is: **how close to 100% of the subscription window can we run, without ever crossing it?**

This page documents what we measured.

## The setup

The monitoring stack has two cooperating components:

- **🌉 Bridge** — runs on a fixed clock, fetches usage samples from the provider, and projects when the team will hit 100% of the current window
- **🛡️ Sentinel** — event-driven, intervenes only when the Bridge sees the projection drifting too high

This separation (clock-only Bridge + event-driven Sentinel) is the result of multiple iterations — see commits tagged `refactor(monitoring): V3/V4/V5`.

## Test results

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

**Why less precise**: the usage signal we read from Kimi is more variable, and response sizes have a wider distribution. The current mitigation is the 85% target — wasteful but safe.

If Kimi €40 holds at >90% target with <10% oscillation for a full month under real load, **the mass-market threshold is reached** — see [`PROVIDERS.md`](PROVIDERS.md).

### 🟣 Claude Pro €20 — not viable

A single agent working at modest pace burns through this tier well before the window resets. Not enough headroom for a 7-agent team. Re-test deferred until Sentinel token consumption drops.

## Known issues

1. **🪟 5h window vs weekly cap** — current calibration optimizes for the 5h reset, but Anthropic's real cap is weekly. Two days of intensive use can exhaust the weekly allowance even when every 5h window stayed under 95%. **Next milestone**: weekly-window calibration.

2. **🛡️ Sentinel itself consumes tokens** — the Sentinel intervenes too often today, and each intervention costs LLM calls. This is *the* reason the €20 base tier is currently unusable. Reducing Sentinel intervention frequency is the highest-leverage optimization left.

3. **⏰ No work-hours scheduling yet** — the team works whenever it's started. Next milestone: user-defined work slots so the team behaves like a real employee, idle outside work hours.

## What we want to publish

- 📈 **Time-series graphs** of token usage during real test sessions (Claude Max x20 + Kimi)
- 📊 **Oscillation distribution** plots showing how tightly the projection tracks reality
- 🎯 **Per-window summary**: target vs achieved, for ~20 consecutive sessions

These graphs are interesting on their own and will be added to this page (and likely posted publicly) once the Kimi calibration converges.

## Related

- [`docs/PROVIDERS.md`](PROVIDERS.md) — which subscription to pick
- [ADR-0004](adr/0004-subscription-only-no-api-keys.md) — why subscription-only
- `agents/sentinella/sentinella.md` — the Sentinel's prompt and behavior
- `shared/skills/` — the monitoring skills (`bridge_health`, `sentinel_health`, `usage_record`, `compute_metrics`, `rate_budget`)
