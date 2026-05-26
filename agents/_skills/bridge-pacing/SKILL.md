---
name: bridge-pacing
description: Translate a `[BRIDGE PACING]` 15-min calibration tick into per-agent throttle adjustments. The bridge measures the team's actual rate of consumption and gives you a verdict (SFORO / MARGINE / ALLINEATO) plus the per-agent share + cadence needed to choose WHO to slow down and BY HOW MUCH. Open this skill ONLY when a `[BRIDGE PACING]` line lands; the routine `[SENTINELLA]` orders use a different flow (`sentinel-orders`).
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — data-driven throttle calibration

The bridge runs a measurement window every 15 min (aligned to :00/:15/:30/:45 UTC). At each window-close it writes one line into the Captain's pane that summarises the team's actual rate and tells you which way to bias the throttle. This is **not** a Sentinel order — it is a calibration signal you act on with `throttle-config.py`.

## Message shape

```
[BRIDGE PACING] HH:MM UTC window=15m (effettivi Xm) samples=N |
  usage=U% proj=P% reset_in=Rh reset_at=THH:MM UTC |
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

## Verdict → action

| Verdict                          | Meaning                                                       | Action                                                                                |
|----------------------------------|---------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `SFORO +X%/h → riduci Y%`        | `vel_team` exceeds target by X points/h. Cut Y% of the rate.  | **Increase** `throttle-config` for the agents with **high share** (top 1-2)           |
| `MARGINE −X%/h → puoi salire Y%` | `vel_team` below target. You have headroom.                   | **Zero or reduce** the throttle on throttled agents (priority: bottleneck role)       |
| `ALLINEATO Δ ±0.2%/h`            | inside tolerance.                                             | do nothing, wait for the next tick                                                    |

> 💡 `X%/h` vs `Y%` are the same thing in two units. `Y = X / vel_team × 100`.

## Calibration formula (the one new thing here)

To obtain a `f%` rate reduction on an agent with cadence `c` checkpoint/min, the duration to put into `throttle-config` is:

```
durata_sec = (f / 100) × 60 / c
```

The intuition: every `jht-throttle` call adds `durata_sec` of pause. Over 60s the agent calls it `c` times → adds `c · durata` seconds of pause per minute → fractional rate cut `= c · durata / 60`. Solve for `durata`.

### Worked example — concentrate the cut on one agent

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
```

Push almost the entire cut onto `analista-1`:
- fraction on analista-1 ≈ 19% / 47% ≈ 40%
- `durata_sec = 0.40 × 60 / 0.6 = 40s`
- → `throttle-config.py set analista-1 40`

### Worked example — spread the cut over two agents

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
scout-1:    share 26%, cadenza c_scout
```

Combined weight 47 + 26 = 73%. Spread the 19% proportionally:
- fraction per agent ≈ 19% / 73% ≈ 26%
- analista-1: `0.26 × 60 / 0.6 = 26s`
- scout-1:    `0.26 × 60 / c_scout`
- → one `bulk-set` write atomically:

```bash
python3 /app/shared/skills/throttle-config.py bulk-set \
    analista-1=26 scout-1=<derived from c_scout>
```

## When releasing throttle (MARGINE)

If the verdict is `MARGINE −X%/h → puoi salire Y%`:
1. Pick the role you want to accelerate (priority: the current bottleneck — `pipeline-triage` if unsure).
2. Reduce its current throttle by approximately `Y%` (or zero it if it was a small value).
3. **Do not** zero everyone at once — you would oscillate into a SFORO at the next tick.

## Cadence after a config change

- After any change, wait **2-3 ticks** (≈30-45 min) before intervening again.
- The pacing is already your synthesis — do **not** add extra `rate_budget live` calls in between (they inflate the Sentinel's `velocity_smooth`).
- If after 3 ticks the verdict is still SFORO, double the durations on the same agents (linear → geometric); if still MARGINE, halve.

## Anti-patterns

- ❌ Reading only `VERDETTO` and ignoring `share` / `cadenza`: you cut blindly across all agents and hit the cheap roles (Scorer, Analyst) before the expensive ones (Writer, Critic).
- ❌ Treating a single SFORO tick as a permanent state: 1 tick is noise, 2 consecutive ticks is signal.
- ❌ Mixing this flow with `sentinel-orders` ones: a `[BRIDGE PACING]` and an `[URG] RALLENTARE` can land within minutes of each other. The `[URG]` always wins — apply it first, the next pacing will re-measure.
- ❌ Pushing pacing-derived numbers via tmux to agents (`[INFO] sleep 40s`). Always go through `throttle-config.py` — agents read the file, do not parse your tmux body.

## See also

- `sentinel-orders` — routine ticks, throttle 0-4 levels, emergencies.
- `bridge-mailbox` — drain pacing verdicts you missed during a long turn (the bridge appends to a JSONL even if the live tmux send failed).
- `throttle` — the `throttle-config.py` CLI reference and the per-agent state file.
- `pipeline-triage` — when MARGINE means "spawn one more at the bottleneck" rather than just zeroing throttle.
