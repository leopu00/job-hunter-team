# Monitoring stack

JHT runs on subscription LLMs, which means the single most important engineering problem is: **how close to 100% of the subscription window can we run, without ever crossing it?**

This page documents the monitoring stack (Bridge + Sentinel) and the test data we have so far.

## Architecture

Two cooperating components:

- **🌉 Bridge** — runs on a fixed clock, fetches usage samples from the provider, and projects when the team will hit 100% of the current window
- **🛡️ Sentinel** — event-driven, intervenes on the Captain only when the Bridge sees the projection drifting too high

This separation (clock-only Bridge + event-driven Sentinel) is the result of multiple iterations — earlier versions had the Sentinel polling continuously, which itself burned too many tokens.

## Test results so far

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

**Why less precise**: the usage signal we read from Kimi is more variable, and response sizes have a wider distribution. The current mitigation is the 85% target — wasteful but safe.

If Kimi €40 holds at >90% target with <10% oscillation for a full month under real load, **the mass-market threshold is reached** — see [`PROVIDERS.md`](PROVIDERS.md).

### 🟣 Claude Pro €20 — not viable

A single agent working at modest pace burns through this tier well before the window resets. Not enough headroom for an 8-agent team. Re-test deferred until Sentinel token consumption drops.

## Known issues

1. **🪟 5h window vs weekly cap** — current calibration optimizes for the 5h reset, but Anthropic's real cap is weekly. Two days of intensive use can exhaust the weekly allowance even when every 5h window stayed under 95%. **Real incident observed** on 2026-05-21 (see `docs/internal/2026-05-21-halt-weekly-incident.md`). **Next milestone**: weekly-window calibration.

2. **🛡️ Sentinel itself consumes tokens** — the Sentinel intervenes too often today, and each intervention costs LLM calls. This is *the* reason the €20 base tier is currently unusable. Reducing Sentinel intervention frequency is the highest-leverage optimization left.

3. ~~**⏰ No work-hours scheduling yet**~~ — **shipped 2026-05-26**. Users now define when the team works (CLI / desktop wizard / web UI). The Bridge distributes the weekly budget only across active hours and computes the per-window target dynamically. See **🗓️ Work hours** below.

## 🗓️ Work hours — team as employee

The team can be configured to **only work during specific hours**, like a human employee. Outside those hours: no new spawns, no promotions, no new writing assignments; in-flight work finishes and the team idles. Mentor & Assistente bots keep replying to the user (only pipeline production stops).

The biggest reason this matters: with weekly-capped providers (Codex Pro, Claude Max), the team would otherwise burn the whole weekly budget in 2-4 days running 24/7, and sit idle for the rest of the week. Concentrating the same budget on the user's working hours = more output per €, and output that lands during the user's day, not at 3am.

### Configure your hours — 3 ways

```
CLI         jht working-hours set office              # 5 preset alias
            jht wh set-custom mon-fri 09:00-18:00     # custom range
            jht wh show                               # view current
            jht wh simulate                           # current target from container

Desktop     wizard step "When should the team work?" at setup
            (5 preset + "configure later in dashboard")

Web         dashboard → /team → "📅 Working hours" section
            heatmap 7×24 click-to-toggle + bar chart + sweet-spot meter
```

All three write to the same `~/.jht/jht.config.json` under `team.working_hours`. The pacing-bridge picks it up live — no restart needed.

### How the target gets calculated

Given the user's hours and the provider's `window_cap_pct_of_weekly` (how much of the weekly budget a 5h window fills when used at 100%), the bridge computes:

```
budget_per_hour       = 100% weekly / active_hours_per_week
target_window_weekly  = budget_per_hour × active_hours_in_current_5h_window
target_pct_of_5h_cap  = target_window_weekly / window_cap_pct_of_weekly × 100
```

Example — Codex Pro (`ratio=14.7%`) + office hours (Mon-Fri 9-18 = 45h/week):

| Window | Active h | % of weekly | Target at 5h reset |
|---|---|---|---|
| W1 09:00→14:00 | 5h | 11.1% | **76%** *(vs. 92% historical 24/7 default)* |
| W2 14:00→19:00 | 4h | 8.9%  | **60%** |
| W3 19:00→00:00 | 0h | —     | **idle (OFF)** |
| W4 00:00→05:00 | 0h | —     | **idle (OFF)** |
| W5 05:00→10:00 | 1h | 2.2%  | **15%** |
| **Σ daily** | **9h** | **20%** | = 100% / 5 days |

### Sweet spot per provider (don't waste, don't dilute)

| Provider | Min hours/week | Max hours/week | Sweet spot |
|---|---|---|---|
| Codex Pro / Codex Plus | 37h | 136h | **37-136h** |
| Claude Max x20 / x5    | 40h | 133h | **40-133h** |
| Kimi K2 Plan           | — | — | **no budget constraint** *(weekly-unlimited)* |

**Why min?** Below `min` you can't saturate the weekly cap even at full speed → you're paying for budget you'll never use. The web UI shows a red warning with the exact wasted % (e.g. weekend-only 18h on Codex Pro → "~51% wasted").

**Why max?** Above `max` the per-window target falls below 25% of the 5h cap → coordination overhead dominates real work. The UI shows a yellow warning ("riduci di ~Xh, sweet spot Y-Zh").

### Auto-calibration

The provider seed values (14.7% Codex Pro, 15% Claude Max) come from the case study and provider docs — accurate for Codex Pro, estimated for the others. A background daemon (`window_ratio_meter.py`) observes the team's actual `Δweekly/Δ5h` ratio and converges via EMA (half-life 7 days). After 3-4 days of real usage `provider_capacity.py` blends the observed value in with weight `min(1, days/4)`, so the sweet spot and target self-correct without user intervention.

→ Detailed design in [`docs/internal/2026-05-25-work-hours-design.md`](../internal/2026-05-25-work-hours-design.md).

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
- `docs/internal/context-watchdog-spec.md` — periodic agent restart pattern (long-lived threads burning context cause silent throughput collapse; restart restores 5× pipeline velocity)
