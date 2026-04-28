---
name: tmux-send
description: Deliver a message to another agent's tmux session atomically. ALWAYS use this to communicate with SCOUT/ANALISTA/SCORER/SCRITTORE/CRITICO/SENTINELLA/CAPITANO. NEVER call `tmux send-keys` by hand — Ink-based TUIs (Codex, Kimi) lose the Enter character.
allowed-tools: Bash(jht-tmux-send *)
---

# tmux-send — inter-agent messaging

Shell wrapper at `/app/agents/_tools/jht-tmux-send` (also on `PATH` via `/usr/local/bin` symlink).

## Why it exists

Ink-based TUIs (Codex, Kimi Code) **drop the Enter** if it arrives in the same `tmux send-keys` call as the text body. Text is sent character-by-character; Ink must finish rendering before accepting another keystroke. If you call `tmux send-keys "msg" Enter`, the message stays in the peer's input buffer without being submitted → silent inter-agent deadlock.

The wrapper handles it atomically: `text → sleep 0.3 → Enter → sleep 0.5 → Enter` (the second Enter is idempotent for robustness).

## Usage

```bash
jht-tmux-send <SESSION> "<message>"
```

## Examples (V5)

```bash
# Captain → Scout (INFO, generic operational message)
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [INFO] Start the main loop. Begin from CIRCLE 1 (Remote EU); ping after each batch of 3-5 positions."

# Captain → Writer (URG, real-time order)
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [URG] FREEZE — finish the current Critic round, then sleep until throttle returns to T0/T1."

# Analyst → Scout (FEEDBACK, rejection-pattern coaching)
jht-tmux-send SCOUT-2 "[@analista-1 -> @scout-2] [FEEDBACK] [SENIORITY] 4 of last 5 inserts from greenhouse.io require senior+ — switch source or query for the next batch."

# Sentinel → Captain (URG, state change)
jht-tmux-send CAPITANO "[@sentinella -> @capitano] [URG] Usage 94%, projection 102% — recommend throttle T2 + freeze Writers."

# Writer → Captain (REPORT, final result)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [REPORT] Position 42 — verdict PASS, score 7.5/10. PDF: /jht_user/.../CV.pdf"

# Worker → Captain (ACK, confirming URG)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [ACK] freeze applied, sleeping."
```

## Message envelope

Always keep the structured prefix:

```
[@<from> -> @<to>] [<TYPE>] <text>
```

Standard types (see `agents/_manual/communication-rules.md` for full taxonomy and per-role expectations):

- `INFO` — status update / generic operational message (no reply expected)
- `URG` — real-time order requiring immediate action (FREEZE, throttle, kill)
- `FEEDBACK` — coaching upstream with a rejection tag (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`)
- `REQ` / `RES` — synchronous request/response between agents
- `ACK` — acknowledge an `URG` or `REQ` you can't service yet
- `REPORT` — final outcome of a unit of work

> 💬 `[CHAT]` is reserved for **user → agent** messages from the web UI (see Captain's prompt protocol). Don't use it for inter-agent traffic.

## Exit codes

- `0` — message delivered
- `1` — missing arguments
- `2` — target session does not exist (check the name with `tmux ls`)

## Rules

- **NEVER** use `tmux send-keys` directly to communicate with another agent. Always go through `jht-tmux-send`.
- **NEVER** kill another agent's tmux session (Captain rule #0).
- If `tmux ls` shows the target session doesn't exist, **do not create it** — ask the Captain (or use `start-agent.sh` if you *are* the Captain).
- Default to **DB-driven coordination** for pipeline handoffs (Scout→Analyst→Scorer→Writer); use this skill only for the real-time signals listed above. See `agents/_manual/communication-rules.md`.
