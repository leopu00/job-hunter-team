---
name: tmux-send
description: Deliver a message to another agent's tmux session atomically. ALWAYS use this to communicate with SCOUT/ANALISTA/SCORER/SCRITTORE/CRITICO/SENTINELLA/CAPITANO. NEVER call `tmux send-keys` by hand — Ink-based TUIs (Codex, Kimi) lose the Enter character.
allowed-tools: Bash(jht-tmux-send *)
---

# tmux-send — inter-agent messaging

Shell wrapper colocated at `/app/agents/_skills/tmux-send/jht-tmux-send` (also on `PATH` via `/usr/local/bin` symlink, populated at image build).

## Why it exists

Ink-based TUIs (Codex, Kimi Code) **drop the Enter** if it arrives in the same `tmux send-keys` call as the text body. Text is sent character-by-character; Ink must finish rendering before accepting another keystroke. If you call `tmux send-keys "msg" Enter`, the message stays in the peer's input buffer without being submitted → silent inter-agent deadlock.

The wrapper handles it atomically: it types the text, **re-reads the pane to confirm the text landed**, sends Enter, then **re-reads the pane again to confirm the turn actually started**. Delivery is not "having typed" — it is "having seen the turn start".

> ⚠️ There is a second, nastier state: the TUI **accepts the text and ignores the Enter**, leaving the line hanging in the composer while the agent sits idle for hours. Seen 4 times in 3 days on one box, Captain included, when a message arrives while the peer is closing a long turn. The wrapper now retries the Enter and, if the turn still doesn't start, returns **`5`** instead of falsely reporting success.

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

- `BLOCKED` — worker → Captain: you have **STOPPED producing** and it leaves no trace in the DB (broken tool, `403`/`LOCKED`, dry sources, an item you can neither process nor skip). Since 2026-07-27 this is the ONLY thing that tells a stall apart from silent work
- `URG` — real-time order requiring immediate action (FREEZE, throttle, kill)
- `FEEDBACK` — coaching upstream with a rejection tag (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`)
- `REQ` / `RES` — synchronous request/response between agents
- `ACK` — acknowledge an `URG` or `REQ` you can't service yet
- ~~`INFO` / `REPORT`~~ — **retired for peer traffic** (2026-07-27): they were 8 of the 30 pure-status messages that woke the Captain in ~1.5h. Progress is pulled from `db_query.py recent-activity`, not narrated

> 💬 `[CHAT]` is reserved for **user → agent** messages from the web UI (see Captain's prompt protocol). Don't use it for inter-agent traffic.

## 🚧 The bar — send a message ONLY when it passes

A tmux message is a **push**: it burns the peer's turn. Send one ONLY if it passes the bar:

- **(a) real hand-off** the peer cannot discover from the DB — e.g. Analyst → Scout `[FEEDBACK]` shaping the next query; Captain → worker spawn / throttle / kill; Writer ↔ Critic CV loop.
- **(b) safety event** — lockout, halt, kill, user request.

Everything else is **pull**: DB (Tier 1) → `capture-pane` (Tier 2) → message (Tier 3). What is **CUT**:

- **No-op ACKs** ("received", "OK holding") — stay silent unless the sender needs confirm-to-proceed.
- **Status broadcasts** ("batch inserted", "@all queues empty") — observable via the DB / `recent-activity`.
- **"Are you alive? / where are you at?"** — use `tmux capture-pane`, never burn a peer's turn.

Pipeline hand-offs (Scout→Analyst→Scorer→Writer) are **status flips**, not messages. Full rules: [`agents/_manual/communication-rules.md`](../../_manual/communication-rules.md).

## Exit codes

- `0` — message delivered **and submitted** (verified: the turn started)
  - If the receiver uses the mailbox (`mail_receivers`), `0` means **queued**: the message is a durable file and the terminal only got a short nudge. Whether the agent *took* it is `jht-mail status <agent> <id>`; a message nobody takes in time is reported back to the sender. Once queued, the exit is `0` whatever happens to the nudge, except `3` (a terminal that does not respond); a session that disappears after queueing no longer answers `2`, the message waits in the box. The nudge is typed only when the terminal waits at its prompt; otherwise it is held (the exit is still `0`) and the watchdog repeats it.
- `1` — missing arguments
- `2` — target session does not exist (check the name with `tmux ls`)
- `3` — text never appeared and the pane is not busy → unreceptive TUI. **The only code that suggests dead/wedged.**
- `4` — legacy busy result (new sender queues immediately; callers should not drop messages).
- `6` — message queued while peer busy, delivery unverified; durable pending record exists. Never drop or duplicate on retry.
- `5` — text accepted but never submitted ("alive but mute") → **alive**. Retry later, never respawn.
- `7` — the text left the composer but nothing proves the CLI took it: **unknown**. Look at the pane before writing again; never respawn.
- `8` — another delivery to the same session was still running: nothing was typed. Try again.
- `130` — the composer is not free and the message is **NOT delivered**. What is in it is not provably ours (a person's draft, or a paste token nobody of ours explains): nothing was pasted or pressed, and your message is written in `logs/pending-input.jsonl` (`unsent`). Do not loop: tell the Captain (`[BLOCKED]`). A person waiting on the command (`JHT_TMUX_SEND_FROM=user-console`: `jht profile import`, `jht team chat send`) gets `JHT_TMUX_FOREIGN_WAIT` seconds first (default 45, 0 = none, at most 60): a text that goes away by itself (the message another sender of ours is about to submit, a suggestion Codex draws late) is waited for; the bridges and nudges keep the immediate 130. The same code **after** the paste means the composer stopped being only our text: no Enter, and the text is recorded there too (`draft`). The pane is alive: never respawn. The text there is cut at 64 KiB.
- A text that IS provably ours (left by an earlier delivery of ours: identical, or its paste token, `[Pasted Content N chars]` on Codex / `[Pasted text #1 +N lines]` on Claude, with our count) gets its Enter at the next delivery, whatever its age. `jht-tmux-send --flush-ours <SESSION>` does only that (0 = free or taken, 130 = not ours, 5 = Enter swallowed).

> Only `3` may lead to a liveness check and respawn. `4` and `5` both mean the peer is alive: treating them as death is how over-spawning starts.

## Rules

- **NEVER** use `tmux send-keys` directly to communicate with another agent. Always go through `jht-tmux-send`.
- **NEVER** kill another agent's tmux session (Captain rule #0).
- If `tmux ls` shows the target session doesn't exist, **do not create it** — ask the Captain (or use `start-agent.sh` if you *are* the Captain).
- Default to **DB-driven coordination** for pipeline handoffs (Scout→Analyst→Scorer→Writer); use this skill only for the real-time signals listed above. See `agents/_manual/communication-rules.md`.
