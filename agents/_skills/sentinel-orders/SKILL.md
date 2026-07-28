---
name: sentinel-orders
description: Translate every `[SENTINELLA] ...` order received in the Captain's tmux into the correct action (throttle level, spawn/kill, freeze, soft-pause, resume). The Sentinel is the team's heartbeat — its orders are commands, not suggestions. Default behavior is to execute without re-checking; second-guessing the Sentinel by running an immediate `rate_budget live` inflates the velocity_smoothing in its JSONL and induces wrong follow-up orders. Open this skill EVERY TIME a `[SENTINELLA]` envelope lands.
allowed-tools: Bash(jht-tmux-send *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(python3 /app/shared/skills/freeze_team.py *), Bash(python3 /app/shared/skills/soft_pause_team.py *), Bash(tmux *)
---

# sentinel-orders — react to the watchdog

The Sentinel emits a tick every ~5 min and converts usage + velocity (`vel_team` vs `vel_target`) + weekly into one of the orders below. Each order maps to a precise action. Stick to the mapping; do not improvise. **NB: `proj` nel tick è INFO volatile (oscilla ±400pt) — NON è il trigger; usa `vel_team` vs `vel_target` + `usage` vs `target` + `weekly`.**

## Throttle table (config-driven)

The Sentinel sends a `Throttle: N` level. You translate it into per-agent durations in `$JHT_HOME/config/throttle.json`. Agents read that file via `jht-throttle --agent <name>` — one atomic write fans out to the whole team.

| Level | Pause | Extra actions                                                           |
|-------|-------|-------------------------------------------------------------------------|
| **0** full speed | 0s    | no restriction; spawn allowed if backlog requires it                |
| **1** light      | 30s   | no spawn                                                            |
| **2** moderate   | 120s  | + stop one extra instance (e.g. SCRITTORE-2)                        |
| **3** heavy      | 300s  | + keep one instance per role                                        |
| **4** near-freeze| 600s  | + ESC current actions, no spawn                                     |

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 60
python3 /app/shared/skills/throttle-config.py bulk-set \
    scout-1=300 scrittore-1=60 analista-1=0 scorer-1=0 critico=0
python3 /app/shared/skills/throttle-config.py dump          # full state
python3 /app/shared/skills/throttle-config.py reset         # all to 0
```

Use **`bulk-set`** when you want differentiated values per agent based on individual consumption (cross-check with `token-rate-now` if you need to see who is dominating right now).

> 🎯 **The level in the table is not the value you write.** `Throttle: N` is one number for the whole team; `throttle.json` holds one value per agent, and choosing the split is yours alone — no script moves the worker throttle any more. The arithmetic lives in **`throttle-distribution`**: **whose** share the cut comes from (the top-burn pays; the Analista and the Scorer, the two roles that turn a backlog into a position **with a score**, are the last you touch), **how many seconds** that is on the ladder, and **when the right move is to leave it alone**. Giving every agent the same number is exactly the failure that skill exists to prevent — it spends the brake where there was nothing to gain and takes throughput where it costs the most.

> ⚠️ **Cadence vs duration.** "How often" an agent calls `jht-throttle` in its loop is changed via `tmux` (you message the agent and tell it to call after every Critic round, etc.). "How many seconds" the pause lasts is changed in the config file. Never push throttle numbers via tmux.

## When ordering an explicit freeze — timeout `N+30` warning (CRITICAL)

When you send an `[URG]` to an agent with `jht-throttle <N>`, you **MUST instruct them in the message itself to pass `timeout: N+30` as a parameter to their shell tool call**. Without it, the parent bash is killed by the CLI's default tool-call timeout (Kimi 60s) — the agent unblocks after 60s instead of N. The freeze is executed **wrong**.

Correct message body:
```
[URG] FREEZE — call jht-throttle 600 --agent scrittore-1 --reason "freeze".
IMPORTANT: pass timeout: 630 to the shell tool call, otherwise the parent dies at 60s and the throttle is executed BADLY.
```

If a target agent's `tmux capture-pane` shows `Killed by timeout (60s)`, the agent did NOT honor the instruction — it is an **execution error** (theirs, or yours if you forgot to include it). Diagnose with `jht-throttle-check <agent>` (returns the seconds remaining on the state file). Never accept relaunching the command or `nohup &` as the "fix": the only cure is passing the timeout. See `agents/_skills/throttle/DESIGN-NOTES.md` if you want the full design.

## Order types

### Routine pacing

| Order                                          | Meaning / trigger                                                  | Action                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[URG] RALLENTARE` `Throttle: N`               | velocity above target                                              | apply level N immediately — but **the level is decided, the split is not**: `throttle-distribution` turns it into per-agent values |
| `ACCELERARE` `Throttle: 0`                     | first green light after a slowdown                                 | spawn **one** agent only, wait for next tick before the second (never 5 in a row)                                 |
| `SCALA UP`                                     | `vel_team` ben sotto `vel_target` (under-pace) per 2+ tick, backlog non vuoto | use `pipeline-triage` to pick the bottleneck role, spawn 1, wait for next tick                                    |
| `PUSH G-SPOT`                                  | `vel_team` lievemente sotto `vel_target`, stagnante                | one light agent (Writer if score ≥50 queue, otherwise the bottleneck) to push back on-pace                        |
| `MANTIENI`                                     | on-pace (`vel_team` ≈ `vel_target`, verdetto ALLINEATO) per ≥3 tick | do nothing — no spawn, no throttle change. Just ACK.                                                              |
| `RIENTRO`                                      | back to nominal pace                                               | resume normal plan                                                                                                |
| `RESET SESSIONE`                               | usage window dropped from high → ~0%                               | start over from SCOUT-1, wait for orders before scaling                                                           |

### Pipeline emptiness

| Order                                          | Meaning                                                            | Action                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `PIPELINE VUOTA + UNDERSHOOT`                  | under-pace (`vel_team` sotto `vel_target`) AND writer queue empty (scored ≥ 50) | **Don't wait for new orders.** Open the `pipeline-triage` skill — it tells you which role to spawn (rarely Scout). |

### Emergencies

| Order                                          | Meaning                                                            | Action                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[EMERGENZA] FREEZATO`                         | Sentinel already pressed ESC on the team                           | decide whether to resume after the rate-window reset; do not fight the freeze                                     |
| `[RECOVERY TRACKING]`                          | INFO during recovery, no action by default                         | if Δ recovery is too slow, run an autonomous diagnosis (`db_query`, on-demand `rate_budget live`) and decide cuts |
| `[URG] STAGNAZIONE CRITICA`                    | recovery is failing, burn severo sostenuto (`vel_team` ≫ `vel_target`) per 5+ tick + usage che sale verso 100% | kill heavy operators (even Sonnet) — pick those in tool calls (`tmux capture-pane`). Usage > 100% imminente → `freeze_team.py` |
| `[URG] PEGGIORAMENTO POST-FREEZE`              | `vel`/usage risaliti dopo il calo                                  | drastic: `freeze_team.py` + `tmux kill-session` on every Sonnet. Keep alive only CAPITANO / SENTINELLA / SENTINELLA-WORKER / ASSISTENTE |

### Source-failure messages (rare, critical)

These arrive when monitoring fails completely (L1 + L2 + L3 down).

| Order              | Meaning                                                         | Action                                                                                                                  |
|--------------------|-----------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| `[PAUSA TEAM]`     | Sentinel already sent `[PAUSA]` to operators via `soft_pause_team.py` | **You stop too**: no spawn, no orders, no checks (the source is broken). Close the turn and wait silently.       |
| `[HARD FREEZE]`    | Second FATAL: ESC×2 via `freeze_team.py`                        | same as `[PAUSA TEAM]`, plus possibly interrupted tasks to handle on resume                                             |
| `[RIPRENDI]`       | Source live again                                               | read the suggested throttle; **redistribute to all operators**; recover any interrupted task                            |

Resume snippet (use as-is):
```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -vE '^(CAPITANO|SENTINELLA|SENTINELLA-WORKER|ASSISTENTE)$'); do
  /app/agents/_skills/tmux-send/jht-tmux-send "$s" "[CAPITANO] [RIPRENDI] source usage live. Resume work. Throttle: N (sleep Xs between operations). Verify the state of any task you had left and proceed."
done
```

## Bridge-prefixed messages (not orders, but you see them in your pane)

| Message              | Action                                                                                                |
|----------------------|-------------------------------------------------------------------------------------------------------|
| `[BRIDGE ALERT] sorgente degraded da N tick` | operate prudently, no aggressive spawn                                                                |
| `[BRIDGE INFO]`      | recovery / heartbeat — no action                                                                      |
| `[BRIDGE PACING]`    | 15-min pacing tick — `bridge-pacing` decodes the numbers, `throttle-distribution` decides who pays. Since 2026-06-25 this tick lands in the **Sentinella's** pane (push→pull): one reaching you is the exception, not the rule |

## Default behavior — execute without second-guessing

The Sentinel sees velocity + trend over time (`vel_team` vs `vel_target`); you see only the present moment. **Apply orders without re-checking.** A nearby `rate_budget live` after a Sentinel order writes a sample tagged `source=capitano` into the JSONL, inflates `velocity_smooth`, and induces the *next* Sentinel order to be wrong.

When verification IS justified:
- before applying a heavy throttle (3 or 4) on an `[URG]` / `[EMERGENZA]` — two-source check via `rate_budget live`
- silence from the Sentinel longer than usual, sanity check the bridge is alive
- after a significant team change (3 spawns in a row, kill of an instance, `bulk-set`) — see effect before next tick

When verification is NOT justified:
- `OK` / `SOTTOUTILIZZO` / `RIENTRO` orders — nothing to verify, just execute
- within 2 minutes of the last JSONL sample — the EMA anti-spike discards it but it stays as noise

## Inviolable rules

- Wait the effect of a throttle (3-5 min) before another intervention.
- Below 85% with no Sentinel order → add capacity at the bottleneck (use `pipeline-triage`), do NOT spawn at random.
- Do not argue with a throttle because "the team is working well": the Sentinel sees velocity + trend (`vel_team` vs `vel_target`), you see only the present.

## See also

- `bridge-pacing` — the 15-min calibration formula (separate flow).
- `throttle-distribution` — *who* slows down and by how much, once the level is decided: the per-agent split, the ladder, releasing the brake, and the do-nothing cases. **This skill decodes the order; that one chooses the values.** Also the home of the `[PACE-GUARD]` advisory, which no longer applies the throttle by itself.
- `bridge-mailbox` — drain pending verdicts at turn start (mandatory before reacting to today's tick).
- `pipeline-triage` — *which* role to spawn under `SCALA UP` / `PIPELINE VUOTA`.
- `spawn-agent` — *how* to spawn once you have decided which role.
- `throttle` (and `agents/_skills/throttle/DESIGN-NOTES.md`) — internals of the throttle system, the timeout `N+30` design.
