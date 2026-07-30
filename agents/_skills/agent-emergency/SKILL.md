---
name: agent-emergency
description: Capitano — handles an agent suspected of being STUCK IN AN ACTIVE LOOP (alive and generating turns, but repeating the same cycle without producing anything: ACK ping-loop with a peer, same action/query going nowhere). Covers the crack between C-08 (dead/silent → Dottore) and C-12 (burning at cadence 0.00/min → kill). Graduated ladder, Dottore-FIRST → kill+clean-respawn only if it persists or burns budget. Deterministic detection (capture-pane diff + 0 DB progress), escalation decision left to the LLM.
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(/app/.launcher/spawn-doctor.sh *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *)
---

# agent-emergency — agent stuck in an active loop

## Why it exists (the crack between C-08 and C-12)

The existing signals cover two cases:
- **C-08** — a **dead / silent** agent (pane = bash, no turns) → **Dottore** diagnosis.
- **C-12** — an agent **burning with `cadenza 0.00/min`, zero checkpoints** → kill candidate.

The third one is missing: **an agent that is ALIVE and ACTIVE and REPEATS the same cycle without
producing anything**. It generates turns (so it is NOT "dead" and does NOT have `cadenza 0.00`), but
it makes no progress. Real examples:
- two sessions bouncing **ACK** off each other forever (coordination ping-loop);
- a worker repeating the **same query / same action** to no effect;
- an agent re-processing the same undelivered message.

It used to be invisible → the Capitano never stepped in. This skill makes it detectable and
manageable.

## When to use it

**On SUSPICION**, not across the board and not on every tick. Start this procedure when you notice
one of these hints (usually while doing something else): an agent that has been "working" for a
while but whose queue is not shrinking / no new position changes state; or you see the same exchange
repeating in the chat/pane.

## 1. DETERMINISTIC detection (no eyeballing)

Confirm the loop with two cheap checks — **no message to the agent** (do not disturb it, this is
Tier-2 pull):

```bash
# (a) REPETITION — does the pane show the same exchange/output N times?
#     Two captures spaced apart: if the "new" content is identical → it is repeating.
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_1.txt
sleep 20
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_2.txt
diff /tmp/ae_1.txt /tmp/ae_2.txt        # little/no "real work" difference = suspected loop

# (b) 0 DB PROGRESS — is the agent "active" but moving nothing in the DB?
#     If available, the by-agent observability helper (it reuses
#     position_state_transitions): 0 recent transitions for this agent = no output.
python3 /app/shared/skills/db_query.py recent-activity   # by_agent: 0 for the session = no output
#     Generic fallback: the queue upstream of the agent does NOT shrink between two checks
#     (e.g. next-for-analista unchanged while ANALISTA-N is "working").
```

**LOOP verdict** = (a) repetition **AND** (b) 0 progress, over ≥ 2-3 observations. If instead the
pane shows `Working… / esc to interrupt` with content that keeps changing, it is a **long task that
is ALIVE** (C-08 bis): that is NOT a loop, leave it alone.

## 2. Graduated ladder — Dottore-FIRST

### Rung 1 — extraordinary Dottore round (FIRST intervention)

A context refresh often breaks the loop **without losing state**. Use the `spawn-doctor` skill:

```bash
bash /app/.launcher/spawn-doctor.sh
sleep 10
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Targeted round: <SESSION> looks stuck in an active LOOP (it repeats <what>, 0 DB progress over N ticks). Diagnose it and, if confirmed, refresh/repair the session. Report back with [RES]."
# Wait for the Dottore's [RES] — no polling.
```

### Rung 2 — Kill (+ respawn) — ONLY if needed

Kill **only if**: the loop **persists after the Dottore**, *or* it is **burning budget seriously**
(high rate + 0 output for ≥ N ticks and there is no time for a diagnosis).

⚠️ **SAFEGUARD against double-spawn with the watchdog.** `agent-watchdog.sh` automatically respawns
(≤30s) **only the 3 core agents**: `ASSISTENTE`, `CAPITANO`, `MENTOR`. It does NOT cover the workers.
So the respawn depends on the target:

- **Target = CORE agent (ASSISTENTE / MENTOR)** → **kill ONLY**. The watchdog detects it and
  **respawns it clean on its own** (`jht team start <role>`, idempotent, fresh state). Do **NOT** run
  `start-agent.sh` yourself as well → that would be a double-spawn (the race that was reported). The
  "backoff" is effectively the watchdog interval (~30s). (The CAPITANO is you: it is never the target
  — you do not kill yourself.)
  ```bash
  tmux kill-session -t <SESSION>     # STOP here: the watchdog respawns clean within 30s
  ```
- **Target = WORKER (Scout / Analista / Scorer / Scrittore / Critico)** → the watchdog does NOT cover
  them, so **you kill + backoff + respawn** (no race):
  ```bash
  tmux kill-session -t <SESSION>
  sleep 5                                                 # backoff: do not fall straight back into the loop
  bash /app/.launcher/start-agent.sh <role> <N>          # CLEAN respawn (fresh state)
  ```

The backoff + the fresh-state respawn keep it from restarting in exactly the same cycle; not
respawning the core agents avoids the race with the watchdog.

## Rules

- **Dottore FIRST, kill AFTER.** Never kill on the first suspicion: a legitimate long task looks
  "stuck" but is alive (C-08 bis). The kill is the last resort.
- **Detection and kill are deterministic; the escalation is your call (LLM).** Do not sit staring at
  the panes on every tick: apply this procedure when a suspicion matures.
- **Do not disturb the peer to investigate.** The checks are pull (capture-pane + DB), no message to
  the suspected agent (which would just add another turn to the loop).
- **Never kill service `*-WORKER-*` sessions** if you do not know what they are — check the role
  first.
