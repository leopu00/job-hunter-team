---
name: bridge-pacing
description: Read a 15-min `[BRIDGE PACING]` calibration tick — the bridge's measurement of the team's actual rate, with a verdict (SFORO / MARGINE / ALLINEATO) plus the per-agent share and cadence. The tick is addressed to the SENTINELLA, not to you: open this skill when she forwards you those numbers, or when you go and read a tick yourself. Do not sit waiting for one to land in your pane — it will not. Turning the verdict into per-agent throttle values is `throttle-distribution`.
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — reading the 15-min calibration tick

The bridge runs a measurement window every 15 min (aligned to :00/:15/:30/:45 UTC). At each window-close it writes one line summarising the team's actual rate — **into the Sentinella's pane, not yours** (push→pull, 2026-06-25). You are deliberately not pinged every quarter of an hour: she reads the tick, and wakes you only when it is worth a turn of yours. So you use this format when **she forwards you the numbers**, or when you go and look at a tick on your own initiative — never as something to wait for.

## Message shape

```
[BRIDGE PACING] HH:MM UTC window=15m (effettivi Xm) samples=N |
  usage=U% reset_in=Rh reset_at=THH:MM UTC (proj=P% — INFO, secondario non-driver) |
  vel_team=V%/h | vel_target=T%/h (per chiudere a TGT% al reset) [schedule+ratio phase=ON] |
  ratio=K kT/% (team Σ kT / Δusage) |
  agenti: name=p%/h [kT/Xm → kT/h ÷ K = p%/h, share s%, cadenza c/min (n chk in Xm)] ; ... |
  VERDETTO: SFORO|MARGINE|ALLINEATO ...
```

`TGT` is the **dynamic target** chosen by the bridge:
- 24/7 config or no schedule → `TGT=92` (band center, historical default)
- work-hours config + provider with weekly cap (Codex/Claude) → `TGT` is the % needed at reset so the weekly budget is distributed exactly across the user's active hours. Example: office hours 9-18 on Codex Pro → `TGT≈76`.
- work-hours config + Kimi (no weekly cap) → `TGT=92` (band center fallback).

The `[schedule+ratio phase=ON]` tag in parentheses is the **source** of the target — `band_center` (no work-hours), `schedule+ratio` (full work-hours-aware), `schedule+band` (work-hours + Kimi fallback). Use it to debug unexpected targets.

## Fields you actually use

| Field             | What it tells you                                                                                          |
|-------------------|------------------------------------------------------------------------------------------------------------|
| **`vel_team`**    | measured team rate, in budget %-points per hour                                                            |
| **`vel_target`**  | rate that would land at `TGT%` at reset (centre of the ±10pt band around `TGT`)                            |
| **`share s%`**    | per-agent weight on the total rate (Σ shares ≈ 100%) — tells you **WHO** to slow down                      |
| **`cadenza c/min`** | per-agent `jht-throttle` calls per minute in the window — tells you **HOW MUCH** to add to the config    |
| **`VERDETTO`**    | actionable summary; map directly to the table below                                                        |

> ⚠️ **`proj` is INFO only — do NOT act on it.** It is a volatile extrapolation of
> short-window velocity (e.g. it printed `proj=-8.66%` while the team was merely a
> hair under target). The control loop is **`vel_team` vs `vel_target`** (both
> weekly-aware) + `weekly_remaining`. Ignore `proj` for throttle/spawn decisions.

## Verdict → action

| Verdict                          | Meaning                                                       | Action                                                                                |
|----------------------------------|---------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `SFORO +X%/h → riduci Y%`        | `vel_team` exceeds target by X points/h. Cut Y% of the rate.  | **Increase** `throttle-config` for the agents with **high share** (top 1-2)           |
| `MARGINE −X%/h → puoi salire Y%` | `vel_team` below target. You have headroom.                   | **Zero or reduce** the throttle on throttled agents (priority: bottleneck role)       |
| `ALLINEATO Δ ±0.2%/h`            | inside tolerance.                                             | do nothing, wait for the next tick                                                    |

> 💡 `X%/h` vs `Y%` are the same thing in two units. `Y = X / vel_team × 100`.

## What to do with it

The verdict tells you **whether** to move and roughly **how much**. Turning that into values in `throttle.json` — which agent slows down, by how many rungs, and when the right move is none — belongs to **`throttle-distribution`**. Open that one to act: it owns the arithmetic, the ladder, and the safety rules.

Two things to carry over when you go there:

- **`share` answers WHO.** The throttle only gives back budget in proportion to what an agent is actually spending, so a team-level "cut 19%" is never "everyone down 19%".
- **`cadenza` answers HOW MUCH.** It is the input to the duration formula: the same value in the config cuts very differently on an agent that reaches a checkpoint twice an hour and on one that reaches ten.

## Anti-patterns

- ❌ Reading only `VERDETTO` and ignoring `share` / `cadenza`: you cut blindly across all agents and hit the cheap roles (Scorer, Analyst) before the expensive ones (Writer, Critic).
- ❌ Treating a single SFORO tick as a permanent state: 1 tick is noise, 2 consecutive ticks is signal.
- ❌ Mixing this flow with `sentinel-orders` ones: a `[BRIDGE PACING]` and an `[URG] RALLENTARE` can land within minutes of each other. The `[URG]` always wins — apply it first, the next pacing will re-measure.
- ❌ Pushing pacing-derived numbers via tmux to agents (`[INFO] sleep 40s`). Always go through `throttle-config.py` — agents read the file, do not parse your tmux body.

## See also

- `throttle-distribution` — the actuation: who slows down, by how much, and when to do nothing.
- `sentinel-orders` — routine ticks, throttle 0-4 levels, emergencies.
- `bridge-mailbox` — drain pacing verdicts you missed during a long turn (the bridge appends to a JSONL even if the live tmux send failed).
- `throttle` — the `throttle-config.py` CLI reference and the per-agent state file.
- `pipeline-triage` — when MARGINE means "spawn one more at the bottleneck" rather than just zeroing throttle.
