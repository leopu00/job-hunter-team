---
name: agent-unblock
description: "Doctor-only. UNBLOCK phase, runs BEFORE the refresh in every Doctor round. Detects the four block shapes that stop a whole team — pending text in a coordinator's pane, an agent retry-looping at a mute peer, every operative sitting at an empty prompt with quota to spend, a coordinator silent past the threshold — and CLEARS them. Never sends nor deletes text the user typed: it routes around it (question to the Assistente, `proceed meanwhile` to the coordinator through the mailbox, direct kick-off of the workers). A block that survives the round makes the round FAILED, not complete."
allowed-tools: Bash(python3 /app/shared/skills/agent_unblock.py *), Bash(python3 /app/shared/skills/doctor_analytics.py *), Bash(tmux *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# agent-unblock — you do not report a block, you dissolve it

> **The principle, above everything else in this skill.** The Doctor **does not report a
> block: it dissolves it.** If an action needs a human decision, forward it to the
> Assistente **and put the team back in motion meanwhile**, carrying the information that
> the decision is pending. **A block that survives the Doctor's round is a failed round.**

A team with plenty of quota (weekly 19%, under-pace) and an idle machine (load 0.12) once
sat still for **eleven hours**. One line, typed into the Capitano's pane and never
submitted, made that pane unreceptive; `jht-tmux-send` read it as busy; the coordinator
went mute; nobody assigned work; every agent finished its turn and parked at an empty
prompt. A Scorer had been retry-looping for hours ("tenth attempt, busy"). The Doctor of
that night inspected nine sessions in 416s, wrote a flawless diagnosis in its journal —
and stayed in standby. The team stayed down another six hours.

The diagnosis was never the problem. This skill is the mandate.

---

## Two states that look identical and need opposite cures

Both show a prompt with some text in it and no activity.

| state | symptom | cure |
|---|---|---|
| **pending text** | a bare `Enter` is ignored, but `Space` **then** `Enter` works | unblock through the input |
| **frozen TUI** | accepts **nothing**: not `Enter`, not `C-m`, not a send to the `%pane_id` | kill + recreate only |

**The detail that makes the unblock implementable**: a "cold" `Enter` is not processed by
an Ink TUI (Codex, Kimi, Claude Code) — the submit has to arrive *after* the text has been
rendered. So you send a character (`Space`) first, then `Enter`. Skip this and an
implementation that tries `Enter` alone **fails in silence** and concludes the pane is
unrecoverable.

With it, one probe separates the two: **`Space`+`Enter`, once**. Pane reacts → it was
pending text, unblocked. Nothing moves at all → frozen TUI → recreate. (A coordinator that
was frozen this way had a live process at 2.8% CPU and a 15.3-hour session; `Enter`, `C-m`
and a direct send to `%pane_id` all did nothing. Recreating it was the only way out — which
is also why the 12h session TTL is not optional: it is the only systematic defence against
this second state.)

---

## 🚫 The one thing you must never do

**Never send, and never delete, text typed by the user.** You cannot know whether that
line is complete or intended. The probe above **submits the composer**, so it is allowed
**only** when the composer content is attributable to an agent — an envelope
`[@x -> @y] …` or `[BRIDGE …]` / `[SENTINELLA …]` that was already meant to be sent.

`agent_unblock.py probe` enforces this for you: on unattributable text it refuses with
`verdict=refused`, exit 3, having first copied the line to `logs/pending-input.jsonl` so
it cannot be lost later. **Do not work around the refusal.** Route around the block
instead (§ pending user input).

---

## Step 0 — scan (deterministic, zero LLM, ~2s)

```bash
python3 /app/shared/skills/agent_unblock.py scan > /tmp/unblock_scan.json
cat /tmp/unblock_scan.json
```

Returns `blocks_found` plus one entry per block, each with its `cure`:

| `kind` | meaning |
|---|---|
| `pending_user_input` | a coordinator's composer holds text you must not touch |
| `pending_agent_input` | an agent envelope stuck in a composer, never submitted |
| `bare_shell` | the CLI died, the pane fell back to a shell |
| `retry_loop` | N attempts from X to Y in the window, zero replies from Y |
| `all_operatives_idle` | every operative at an empty prompt |
| `mute_coordinator` | no message from the Capitano past the threshold |

**Record `blocks_found` now.** You will need it at the end of the round.

> Why `retry_loop` is trustworthy: `messages.jsonl` records the *attempt*
> (`jht-tmux-send` logs before it types), so a Scorer hammering a mute Capitano shows up
> even though nothing was ever delivered. This is also the objective signal that separates
> **"parked because there is no work"** from **"stuck because coordination is broken"**:
> *an agent retrying at the Capitano with no answer is not parked, it is blocked.* Do not
> apply the PARKED rule to it.

## Step 1 — clear them, one per kind

### `pending_agent_input` · `bare_shell` — the probe

```bash
python3 /app/shared/skills/agent_unblock.py probe <SESSION>   # exit 0 unblocked · 2 frozen · 3 refused · 4 busy
```
- `unblocked` → cleared, count it.
- `frozen` → **do not retry the probe.** Escalate to recreate: capture the pane first
  (`session-refresh` Step 2 — the pane is the agent's memory), then
  `tmux kill-session` → `bash /app/.launcher/start-agent.sh <role> <SAME-N>` → `[RESUME]`.
- `busy` → the agent is alive, mid-turn. Not a block. Leave it.

### `pending_user_input` — route around it, never through it

Three actions, all mandatory, none of which touches the line:

1. **Ask the user, via the Assistente** — the Assistente is the role that talks to the
   user. Send it the coordinator's question so it forwards it on the in-app channel:
   ```bash
   jht-tmux-send ASSISTENTE "[@dottore -> @assistente] [UNBLOCK] Il CAPITANO ha una domanda in sospeso all'utente e il suo pane è fermo su una riga digitata e mai inviata: «<domanda>». Giragliela sul canale in-app e riporta la risposta al Capitano. La riga è salva in logs/pending-input.jsonl — NON è stata inviata né cancellata."
   ```
2. **Unblock the coordinator anyway** — tell it the question is forwarded and it must
   proceed. Typing into that pane would concatenate with the user's line and submitting
   would send it, so use the channel that needs no pane at all: the mailbox the Capitano
   drains at the top of every turn (`bridge-mailbox`).
   ```bash
   python3 /app/shared/skills/agent_unblock.py relay CAPITANO "[@dottore -> @capitano] [UNBLOCK] La tua domanda all'utente è stata inoltrata all'Assistente ed è in elaborazione. NON restare fermo ad aspettarla: procedi intanto con il resto del lavoro e riassegna le code. Nel tuo composer c'è una riga dell'utente non inviata: non la tocco e non la toccare finché non è lui a decidere."
   ```
   `relay` writes to `bridge-mailbox.jsonl` **and** to `messages.jsonl`, so the message is
   both deliverable and auditable. A coordinator must never sit waiting for a human answer.
3. **Restart the workers without waiting for the coordinator** — see below. This is what
   actually gets the eleven hours back.

### `retry_loop` — unblock the addressee, or release the sender

Clear the target first (probe / recreate). If the target cannot be cleared this round,
**the sender must not keep waiting**: reassign it or tell it to proceed.
```bash
jht-tmux-send SCORER-5 "[@dottore -> @scorer-5] [UNBLOCK] Il CAPITANO non è raggiungibile e la tua richiesta è stata inoltrata per altra via. SMETTI di ritentare: prendi la prossima dalla tua coda (db_query.py next-for-<ruolo>) e procedi in autonomia."
```
A retry-loop counts as cleared only when the sender has been told to stop retrying.

### `all_operatives_idle` · `mute_coordinator` — kick off without the coordinator

Quota available and everyone parked is not a pause, it is a stall. **Kick off the
operative roles directly, do not wait for the Capitano**, and escalate the coordinator's
silence to the Assistente. Then send each idle operative its own queue:
```bash
jht-tmux-send SCOUT-1 "[@dottore -> @scout-1] [UNBLOCK] Il coordinamento è fermo e c'è quota disponibile. Riparti dal loop principale senza attendere il Capitano: CIRCLE 1 del profilo, notifica gli Analisti a lotti di 3-5."
jht-tmux-send ANALISTA-1 "[@dottore -> @analista-1] [UNBLOCK] Riparti dal loop principale senza attendere il Capitano: coda da db_query.py next-for-analista."
```
(Same shape for `scorer` / `scrittore` with their own `next-for-*` queue.)

## Step 2 — close the round honestly

```bash
python3 /app/shared/skills/agent_unblock.py record-round \
  --round-id "$ROUND_ID" --found <blocks_found> --cleared <blocks_cleared>
```
It appends to `/jht_home/logs/dottore-actions.jsonl` with `blocks_found`,
`blocks_cleared`, `blocks_open`, and picks the event for you: `round_complete` only when
`cleared >= found`, otherwise **`round_failed`** (exit 1). Do not paper over a survivor:
a round that leaves a block alive is a failed round, and the log has to say so — the next
Doctor reads that log.

---

## Rules

- **Unblock BEFORE refreshing.** A refresh on a paralysed team just recreates the paralysis
  with a clean context window.
- **One probe per pane, ever.** Two probes cannot tell you more than one, and the second is
  how you talk yourself into submitting a user's line.
- **`busy` is not a block.** `esc to interrupt` means alive and mid-turn. Never send keys
  into a running turn, never spawn a replacement for a busy agent.
- **PARKED does not apply to a blocked agent.** "age ≥ 40min AND produced == 0 AND no
  recent captain message" describes a paralysed team exactly as well as a deliberately
  parked one. If the agent appears in a `retry_loop`, or every operative is idle with quota
  to spend, it is blocked — act.
- **Never guess the user's intent.** No sending, no deleting, no editing, no "just a space
  to wake it up" on user text. The line stays where it is; the copy in
  `logs/pending-input.jsonl` is the safety net.

## Anti-patterns

- ❌ Writing the block in the journal and moving on. That is the eleven-hour failure.
- ❌ Trying `Enter` alone, seeing nothing happen, and declaring the pane dead.
- ❌ Typing your message into a composer that already holds the user's line — it
  concatenates, and the submit sends the user's text.
- ❌ Recreating a coordinator just to clear a *pending* (not frozen) pane. Probe first.
- ❌ Logging `round_complete` with `blocks_cleared < blocks_found`.

## See also

- `session-refresh` — the refresh round that runs *after* this phase, plus the 12h session TTL.
- `tmux-send` — envelope conventions and what the exit codes mean (4 = busy = alive).
- `liveness-check` — on-demand verdict on a single suspected-dead agent.
