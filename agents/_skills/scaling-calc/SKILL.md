---
name: scaling-calc
description: Gradual calibration of the roster — measure the burn of 1 worker, compute how many workers and which throttle it takes to hit the target speed, and spawn in stages (never in 6th gear).
---

# 🎚️ scaling-calc — change gear one step at a time, not straight into 6th

When the team opens the work window (or you need to consume more), do **NOT** set
off in 6th gear ("plenty of budget → spawn 5 scouts / throttle to 0"): you do not
yet know how much a worker really consumes in THIS cycle. You calibrate by steps.

## Procedure

**1. Start with 1 SINGLE worker** at the floor (5min, the minimum for workers).

**2. Observe for ~30 min** to measure the real burn. Read the worker's burn:
```
python3 /app/shared/skills/rate_budget.py            # sustainable target speed (S)
# per-agent burn: from the table the Sentinella forwards you, or:
python3 /app/shared/skills/agent-speed-table.py
```
Take: **S** = sustainable speed (e.g. `sustainable_burn` %weekly/h) and **b** = the
worker's measured burn (same unit).

**3. Compute** roster + throttle:
```
python3 /app/agents/_skills/scaling-calc/scaling_calc.py --target <S> --measured <b>
# if you observed N workers at throttle T:
python3 .../scaling_calc.py --target <S> --measured <b_total> --workers <N> --throttle <T>
```
It gives you: **how many workers**, **which throttle**, and a **staged plan**.

**4. Spawn IN STAGES** following the plan: **one at a time**, **re-measuring** before the
next one (~10 min is enough to see the newcomer's burn). NEVER spawn the whole block
in one go.

> Those 10 minutes are an **observation window**, not a phase offset: the phase distance
> between two workers on the same step is `T/N` (the period divided by the number of
> workers sharing it) and the launcher applies it by itself at spawn time. It is not a
> number to decide here, and it is not a constant: on a 5-minute step, three workers want
> to be 100s apart from each other.

## The two levers
- **Worker under target** (1 worker burns less than the target) → the lever is the **number
  of workers** (parallelism), all **at the floor**. Add them in stages.
- **Worker over target** (1 worker already burns more than the target) → the lever is the
  **throttle**: keep 1 worker and **raise** its throttle (the tool gives you the exact
  value). NEVER zero the throttle out (workers have a 5min floor anyway).

## What NOT to do
- ❌ "Team ON, plenty of budget → SPEED EVERYTHING UP" — that is the frenzy that burns a
  budget window in 25 min for zero output. **SPEEDING UP = go up ONE step** (one more
  worker, or one throttle step less **down to the floor**), then re-measure.
- ❌ Spawning 2-3 workers together. Always **staggered**.
- ❌ Throttle at 0 on a worker (impossible: 5min floor; and it is what marathons are made of anyway).

## Example
1 scout at the floor (5min) burned **1.4%/h**, sustainable target **0.7%/h**:
```
scaling_calc.py --target 0.7 --measured 1.4
→ 1 worker @ 600s (10min) → burn ≈ 0.7/h   (just raise the throttle, no spawn)
```
If instead 1 scout burns only **0.3%/h** with a target of 0.7:
```
→ 2 workers @ 300s (floor), staged: spawn #1, observe 10min, re-measure, then #2.
```
