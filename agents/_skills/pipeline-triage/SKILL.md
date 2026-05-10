---
name: pipeline-triage
description: Decide WHICH role to spawn / pause / kill based on backlog state, not gut feel. Open this skill EVERY TIME a scaling decision is needed — `SCALA UP`, `PIPELINE VUOTA + UNDERSHOOT`, `MARGINE` from bridge-pacing, cold start, idle queues, or whenever you are tempted to "just spawn another Scout". Spawning at the head of the pipeline when the bottleneck is downstream wastes budget and worsens projections. The whole point: read 4 numbers, pick the one role that breaks the bottleneck, hand off to `spawn-agent`.
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(tmux *)
---

# pipeline-triage — data-driven scaling

The pipeline is a dynamic system. Each role consumes very differently per task — adding a 2nd Writer costs much more than adding a 2nd Scout. Scaling at the head when the bottleneck is at the tail produces *more* backlog, not more output. Always start from the data.

## Step 1 — read the backlog (always, before any spawn)

```bash
python3 /app/shared/skills/db_query.py stats
```

From `positions` (P), `scores` (S), `applications` (A), compute:

| Metric              | Formula                                                       | What it means                                       |
|---------------------|---------------------------------------------------------------|-----------------------------------------------------|
| **UNSCORED**        | P − S                                                         | positions the Scorer still has to evaluate          |
| **DRAFT_BLOCKED**   | applications with `status = draft`                            | Writer ↔ Critic loop stalled                        |
| **SCRITTORE_QUEUE** | positions with `score ≥ 50` AND no application                | Writer queue (real demand for new CVs)              |
| **PROMOTABLE_40_49**| positions with `score 40-49` AND no application                | parking band — promotable on demand                 |

Also useful: `python3 /app/shared/skills/db_query.py dashboard` for at-a-glance status + per-role active instances.

## Step 2 — pick priority (bottleneck first, never new work)

Apply the table top-down. Stop at the first matching condition.

| Condition                                                  | Action (in this order)                                                                                                              |
|-----------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `DRAFT_BLOCKED ≥ 50`                                      | **First**: unblock the Critic loop. Spawn `CRITICO-S2/S3/S4` if not alive (3 parallel). Each `CRITICO-S` processes 1 draft at a time. |
| `UNSCORED ≥ 20`                                           | **Then**: spawn `SCORER-2` (and `SCORER-3` if `UNSCORED ≥ 50`). One Scorer is insufficient with 20+ in queue.                       |
| `SCRITTORE_QUEUE ≥ 5`                                     | spawn 1 `SCRITTORE-N` if you don't already have 3 alive (max).                                                                       |
| `PROMOTABLE_40_49 ≥ 5`                                    | promote the best 5 by raising the score (`db_query.py` + direct `UPDATE`), then treat as `SCRITTORE_QUEUE`.                         |
| `SCRITTORE_QUEUE < 5 AND PROMOTABLE_40_49 < 5`            | **Only now** spawn 1 `SCOUT-N` for new positions.                                                                                    |

Once you have picked the role, hand off to `spawn-agent` for the actual launch + kick-off.

## Step 3 — anti-patterns to avoid

- ❌ Spawning a Scout as the first action when `UNSCORED > 20` — produces more backlog with no extra output.
- ❌ Resetting throttle globally (`throttle-config.py reset`) when scaling — apply throttle only to the role you spawned.
- ❌ Spawning multiple roles in the same tick "to be safe" — wait for the next Sentinel tick (~5 min) and re-read the numbers.
- ❌ Killing idle agents to "tidy up" — idle costs almost zero. Kill only if explicitly requested by the user, or if an agent is burning tokens in a confused loop.

## Empirical rationale (why this order, not a different one)

Observed in windows W3-W6 (median peak proj 57-61%): Scouts produce ~3 positions/h consistently, but Scorer/Critic do NOT drain the backlog → 88 unscored and 217 drafts piled up = 12+ rate-budget points unused. **The cure is downstream, not upstream.** Whenever proj is below target with non-empty backlog, the cause is almost always Scorer or Critic, never Scout.

## Per-role consumption — choose with cost in mind

| Role          | Per-task consumption     | Notes                                                                                                  |
|---------------|--------------------------|--------------------------------------------------------------------------------------------------------|
| **Scout**     | low-medium, long+cumulative | scraping + filtering on multiple sources; 2 scouts at full pace can saturate by themselves          |
| **Analyst**   | medium, short bursts     | 1 task = read 1 JD + write evaluation. Refreshes ~every 2 min when there is a queue                    |
| **Scorer**    | low, short bursts        | matching score on profile, near-deterministic. The cheapest role.                                      |
| **Writer**    | **HIGH**                 | inner loop with Critic 3-4 rounds, every round writes a full CV/cover. One active Writer can outweigh everyone else combined. |
| **Critic**    | medium                   | activates only on Writer call; cost adds to the Writer's.                                              |
| **Assistant** | low, on-demand           | talks to user; not in the data pipeline.                                                               |

**Corollary**: the marginal cost of the 2nd Writer is much higher than the 2nd Scout. Scaling head-down (`more work → more of everything`) overshoots.

## Bottleneck → action (qualitative, fallback when stats are ambiguous)

| Pipeline state                                          | Bottleneck                  | Action                                                                                       |
|---------------------------------------------------------|-----------------------------|----------------------------------------------------------------------------------------------|
| `0 new, 0 checked, 0 scored` (empty)                    | head: no material           | start **Scouts only**, even 2 in parallel. No Analyst/Scorer/Writer (no input).              |
| many `new`, few `checked`                               | Analyst undersized          | spawn `analista 2`. Do **not** add Scouts (already material; slow them down if needed).      |
| many `checked`, few `scored`                            | Scorer slow                 | spawn `scorer 1` if missing; one is usually enough (Scorer is light)                         |
| many `scored ≥ 50`                                      | needs writing capacity      | Writer. Caveat: 1 active Writer + Critic can saturate the budget alone. Spawn 1, observe 2-3 ticks, then decide. |
| Writers saturated, queue `score ≥ 50` not draining      | plan capacity limit         | DO NOT spawn extra Writers — risk of instant `RALLENTA`. Slow Scouts instead to stop feeding the queue. |
| low `scored` queue BUT many `writing` in progress       | Writers busy & producing    | do nothing. Wait `writing → ready`.                                                          |

**Guiding principle**: turn agents on **upstream** when input is missing, **downstream** when output is missing. Never "at all levels" without thinking.

## Scaling gates (pacing rules)

- **1 spawn per Sentinel tick (~5 min).** Spawn → kick-off → wait next `[BRIDGE TICK]` → next decision. Never 5 in a row.
- **Max per role**: 2 Scout, 2 Analyst, 1 Scorer, 3 Writer, 1 Critic (the Critic is spawned by the Writer, you do not touch it).
- **Pre-spawn check**: `tmux has-session -t <SESSION> 2>/dev/null && echo ATTIVO` — never blind-spawn over an existing session.
- **Boot order**: Scouts + Analyst *first*, Scorer + Writers *after*. Never in parallel.

## Pre-spawn checklist (run mentally before each spawn)

1. `db_query.py stats` — where is the backlog?
2. `db_query.py dashboard` — how many instances per role already alive?
3. The role you are about to spawn — does it dissolve the **real** bottleneck, or are you "filling out the team"? If the second: **do not spawn** (unused budget beats overshoot).

## Pre-existing sessions triage

Before any `start-agent.sh`, list what is already there:

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}'
tmux capture-pane -t <SESSION> -p -S -40 2>/dev/null | tail -20
```

| State in capture-pane                                                        | Action                                          |
|------------------------------------------------------------------------------|-------------------------------------------------|
| 🟢 CLI active, context < 40%, recent loop                                    | keep, do not respawn                            |
| 🟡 CLI active, context > 80% or idle > 10 min                                | judge: precious work → leave; confused loop → kill + respawn |
| 🔴 `command not found` / bare shell / pane empty > 5 min                     | `tmux kill-session` + respawn (use `spawn-agent`) |

For deeper liveness diagnosis (zombie procedures, sintomi morte CLI), that is the **Dottore's** job via the `liveness-check` skill — do not duplicate it here.

## See also

- `spawn-agent` — actual launch + kick-off after the role decision.
- `sentinel-orders` — what triggered this triage (`SCALA UP`, `PIPELINE VUOTA + UNDERSHOOT`).
- `bridge-pacing` — when MARGINE means "spawn one more at the bottleneck".
- `liveness-check` (Dottore) — deeper agent-health diagnostics.
- `agents/_team/architettura.md` — full pipeline diagram and per-phase coordination notes.
