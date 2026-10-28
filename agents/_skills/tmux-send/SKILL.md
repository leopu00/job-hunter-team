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

## A `$` in the text: single quotes or stdin

Inside double quotes the shell reads `$1` and `$2` as its own arguments and replaces them with nothing **before the tool runs**: "Plus — $20/month; Pro — $200/month" reaches the user as "Plus — 0/month; Pro — 00/month", and nothing downstream can bring the digits back. Whenever the text has a `$` (prices, amounts), write it between single quotes, or pass it on stdin.

```bash
# Single quotes: the shell leaves the $ alone
jht-tmux-send SCOUT-2 '[@capitano -> @scout-2] [MSG] Budget: $120k, floor $5'

# Or from stdin: "-" reads the message, the quoted delimiter keeps every $
jht-tmux-send SCOUT-2 - <<'TXT'
[@capitano -> @scout-2] [MSG] Budget: $120k, floor $5
TXT
```

Write the closing `TXT` in the first column, alone on its line, with no spaces before it (copy the indentation and the heredoc never closes: a text that ends in a `TXT` line is refused, nothing is sent).

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
- A composer that holds ONLY signed text (one message or several, whoever left them unsent: an envelope `[@x -> @y]`, the person's words between their `⟦UTENTE·id⟧ … ⟦/UTENTE·id⟧` marks, or a paste token the record above explains: Codex's within any age, Claude's within `JHT_TMUX_TOKEN_WINDOW` seconds, 600) is a message waiting for its Enter, not somebody typing: your message is pasted behind it and one Enter takes both, so the agent may get the older one late. Text typed by hand, a mark that is not closed or a token nobody explains stay what they were (130). Anyone can type a valid envelope by hand: it is not an authentication, and the cost is the same as an older message arriving late. An envelope WITHOUT marks (a message between agents) has no end of its own, so a person could keep typing at its tail: it counts as signed only when the transport's record has the fingerprint of exactly that text (what it pasted itself and never saw taken); otherwise it is the person's text (130).

> Only `3` may lead to a liveness check and respawn. `4` and `5` both mean the peer is alive: treating them as death is how over-spawning starts.

## Rules

- **NEVER** use `tmux send-keys` directly to communicate with another agent. Always go through `jht-tmux-send`.
- **NEVER** kill another agent's tmux session (Captain rule #0).
- If `tmux ls` shows the target session doesn't exist, **do not create it** — ask the Captain (or use `start-agent.sh` if you *are* the Captain).
- Default to **DB-driven coordination** for pipeline handoffs (Scout→Analyst→Scorer→Writer); use this skill only for the real-time signals listed above. See `agents/_manual/communication-rules.md`.
