---
name: rate-budget
description: Read the rate-limit budget snapshot for the active provider (usage %, time-to-reset, velocity, projection, recommended throttle) from the bridge. Use it at Captain startup to plan pace and decide how many agents to spawn, then periodically when you want a fresh snapshot without spending tokens calling the provider directly. Zero provider calls — reads the latest tick already written by the bridge.
allowed-tools: Bash(python3 *)
---

# rate-budget — rate-limit budget snapshot

The monitoring bridge (`.launcher/sentinel-bridge.py`) polls the active provider every 1–10 min (dynamic — more often under pressure) and writes each sample to `/jht_home/logs/sentinel-data.jsonl`. This skill reads only the **latest sample** that's already been written — no extra provider call.

## At Captain startup

Before spawning any agent, run:

```bash
python3 /app/shared/skills/rate_budget.py plan
```

Typical output:
```
=== Rate Budget — claude ===
  Usage:            53%
  Reset:            13:49 (in 2h 34m)
  Measured velocity:+0.39%/h (EMA)
  Target velocity:  11.38%/h (to close at 92% by reset)
  Reset projection: 56%
  Status:           OK
  Throttle:         T0 full speed
  Host:             cpu=4.7% ram=9.8% (OK)

  Recommended policy: Spawn freely in parallel — keep normal pace.
  Margin to 92% target: 39%
  Last tick:        2026-04-24T10:23:18.705062+00:00
```

**Captain interpretation:**
- `Throttle T0–T1` + `Projection < 80%` → full spawn (Scout + Analyst + Scorer + Writer + Critic)
- `Throttle T1–T2` + `Projection 80–100%` → reduced spawn (one instance per role)
- `Throttle T2+` or `Projection > 100%` → **no spawn**, wait for the bridge to clear the throttle
- `Margin to 92% target` tells you how much budget you can still consume before overshooting

**If output is `NO_DATA`:** the bridge hasn't polled yet. Wait 1–2 min and retry. Do not start the team without this signal — you risk saturating the rate-limit blind.

## One-liner version (scriptable)

```bash
python3 /app/shared/skills/rate_budget.py status
# → provider=claude usage=55% status=OK throttle=T0 reset=13:49 (in 2h 34m)
```

Useful for quick logs or mid-loop checks.

## When NOT to use it

- **Don't call it on every step.** Use it at *phase changes* of your plan (bootstrap, end of Scout batch, after a pause, etc.). The bridge updates at its own rate; calling more often doesn't return fresher data.
- **It does not replace the asynchronous `[BRIDGE ORDER]` flow:** the bridge notifies you *when* policy changes; you plan *while looking at* the budget. The two mechanisms are complementary.
