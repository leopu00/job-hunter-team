---
name: bridge-mailbox
description: Drain pending bridge verdicts at the START of every Captain turn — MANDATORY first action before doing anything else. During a long turn, `jht-tmux-send` from the bridge can fail with rc=3 (text never appeared in the pane) and a `[BRIDGE PACING]` or `PIPELINE STALLED` verdict gets silently dropped. The bridge appends EVERY verdict to a JSONL mailbox so you can recover them. Skipping this drain means acting on stale measurements while a fresher verdict sits unread.
allowed-tools: Bash(python3 /app/shared/skills/bridge_mailbox.py *)
---

# bridge-mailbox — recover missed verdicts

The bridge talks to you over tmux, but tmux delivery can fail silently during a long turn (Codex / Kimi TUI render issues, you were inside a long tool call, etc.). To make sure no verdict is lost, the bridge **also** appends every tick to a JSONL mailbox at `$JHT_HOME/logs/bridge-mailbox.jsonl`. You drain it at the top of every turn.

## The mandatory first action

Before *anything else* — before reading messages, before deciding actions, before opening another skill — run:

```bash
python3 /app/shared/skills/bridge_mailbox.py drain
```

Possible outputs:
- `no pending verdicts` → mailbox empty, proceed with the turn normally.
- one or more lines formatted as live tmux ticks (`[BRIDGE PACING] ...`, `PIPELINE STALLED ...`, `[BRIDGE ALERT] ...`).

`drain` consumes the entries (they are marked read on success) — re-running it returns `no pending verdicts` until the bridge appends new ones.

## How to apply drained verdicts

Process ALL the lines, but **act only on the last one**. The earlier ones are already stale — the metrics have moved since. Two exceptions where an earlier line still matters:

1. **`PIPELINE STALLED` recent (< 30 min) and still pertinent** (proj is still low, team_kt is still low right now). Act on the playbook (re-light the pipeline upstream) even if a later valid `[BRIDGE PACING]` arrived after it. Stalls are state, not events — they need clearing, not just measuring.
2. **A `[PAUSA TEAM]` / `[HARD FREEZE]` you missed**. If one is in the queue and you have not yet sent `[RIPRENDI]`, the team is still frozen — handle it with `sentinel-orders` *before* the latest pacing.

For the routine case (one or more `[BRIDGE PACING]` lines):
- read each line to keep the temporal context (you can see how the trend evolved while you were busy)
- open the `bridge-pacing` skill once and apply only the **last** verdict's calibration

## Other commands (debug / inspection)

```bash
python3 /app/shared/skills/bridge_mailbox.py status   # how many pending vs total
python3 /app/shared/skills/bridge_mailbox.py peek     # read without consuming
```

Use `peek` when you suspect something fishy and want to look without committing — it does NOT mark entries as read.

## Anti-patterns

- ❌ Skipping the drain "because the turn looks short" — the rc=3 failures happen unpredictably; one missed tick during a long turn is the typical case.
- ❌ Acting on every drained line in sequence — you would replay outdated throttle changes, fight your own past calibrations, and oscillate the team.
- ❌ Running `drain` mid-turn just to "see what came in" — drain consumes; if you are not ready to act on the lines, use `peek` instead.
- ❌ Treating `peek` output as authoritative — `peek` shows pending entries, but the live tmux pane may already contain newer ones the JSONL has not yet caught up with. The drain at start-of-turn is what gives you the consistent picture.

## See also

- `sentinel-orders` — routes `[PAUSA TEAM]` / `[HARD FREEZE]` / `[RIPRENDI]` once drained.
- `bridge-pacing` — formula to apply on the last `[BRIDGE PACING]` line.
- `pipeline-triage` — playbook for `PIPELINE STALLED` (re-light pipeline upstream).
