# 💬 Inter-Agent Communication Rules — lean, pull-default

JHT agents coordinate **pull-first**. The default is *discover* the state you need, not *ask* for it.
A tmux message is the **exception**, reserved for things a peer genuinely cannot find on its own.

> **Why lean.** A push-heavy protocol (status broadcasts, routine ACKs, "are you alive?" pings) burns
> tokens on both sides — the sender writes a turn, the receiver wakes a turn to reply — and distracts
> agents from real work. Most of that traffic carries no action. Cut it.

## 🪜 The coordination hierarchy — DB → capture-pane → message

Always reach for the **cheapest tier that answers your question**. Go up a tier only when the one
below genuinely can't.

| Tier | Tool | Use it for | Cost |
|---|---|---|---|
| **1. DB** | `db_query.py` (`next-for-*`, status, `last_checked`, flags) | **shared state** — what's queued, what's claimed, what's done, scores, lifecycle | cheapest, deterministic, not racy |
| **2. capture-pane** | `tmux capture-pane -p -S -N` on the peer's session | **"what is X doing right now?"** — is it working, blocked on a fetch, idle, stuck | cheap (no turn on the peer), but a **racy snapshot** — never trust it as durable state |
| **3. tmux message** | `jht-tmux-send` | **action the peer can't discover** + **safety events** (see bar below) | expensive — a turn on both sides; the exception |

**Rule of thumb:** if the answer is in the DB, query the DB. If you need to know what a colleague is
*doing this moment*, look at its pane — **don't message to ask**. Only message when neither works.

## 🚧 The bar for a tmux message (push)

Send a message **only** when one of these is true:

1. **Real hand-off** — the peer must *do* something it cannot discover from its own `next-for-X`
   loop or the DB. Examples: Writer → Critic to start the CV review loop; Captain → worker to
   spawn / throttle / kill; Analyst → Scout `FEEDBACK` that must shape the *next* query.
2. **Safety event** — `LOCKED` / `403`, halt, kill, crash, an imminent rate breach that DB polling
   is too slow to catch. Sentinel → Captain only.
3. **User-facing** — a request from / reply to the human (separate channel; see role manuals).

### ✂️ What is CUT (do NOT send)

- **No-op ACKs** — "received, context updated", "OK, holding". If the message required no action and
  the sender doesn't *need* confirmation to proceed, **say nothing**. (See ACK below for the rare case.)
- **Status broadcasts** — "@all check 10:14, queues empty, all standby". This is observable: the DB
  has the queues, the panes have the activity. Don't narrate it to everyone. (For human-readable
  observability, write to the structured event-log, not to peers' panes.)
- **"Are you alive? / where are you at?"** — use capture-pane (Tier 2). Never burn a peer's turn to
  ask for a status it would have to stop and write.
- **Re-confirmations / repeated orders** — if you already sent an order, don't re-send it every tick.
  The bridge / mailbox delivers once.

## 🗄️ Tier 1 — DB-driven coordination (the default)

Pipeline hand-offs flow through the DB — **no tmux needed**:

| Handoff | Mechanism |
|---|---|
| 🕵️ Scout → 👨‍🔬 Analyst | Analyst polls `next-for-analista`; sees fresh `status = new` rows |
| 👨‍🔬 Analyst → 👨‍💻 Scorer | Scorer polls `next-for-scorer`; picks `status = checked` rows |
| 👨‍💻 Scorer → 👨‍🏫 Writer | Writer polls `next-for-scrittore` (`score DESC`); picks `status = scored` ≥ 50 |
| 👨‍🏫 Writer → 👤 User | Position → `status = ready` + `applications.critic_verdict = PASS`; surfaces on dashboard |

**Claiming a record without messaging** — peers avoid the same row via the locks in
[`anti-collision.md`](anti-collision.md): Scout pre-INSERT dedup + circles/sources partition;
Analyst/Scorer `last_checked` watermark; Writer `status = writing` flip. **First write wins.** You do
not announce "I'm taking ID 42" — the claim *is* the lock; a peer reads it from the DB.

## 👀 Tier 2 — capture-pane (observe, don't ask)

To understand what a colleague is doing **without disturbing it**:

```bash
tmux capture-pane -t <PEER_SESSION> -p -S -40
```

Look for: the spinner / `esc to interrupt` (alive, mid-turn), a bare shell prompt (idle / possibly
stuck), a blocked fetch. This replaces "are you alive? / what's your status?" messages entirely.

⚠️ **It is a snapshot, not state.** You may catch a turn mid-render. Use it for *liveness / activity*,
**never** as the source of truth for shared state — that is always the DB (Tier 1). Verdicts on a
*possibly-dead* peer belong to the Doctor (`liveness-check`), not to a reflex read.

## 📨 Tier 3 — message envelope & types

Tagged single-line envelope:

```
[@from -> @to] [TYPE] payload
```

Reduced type set (use the narrowest that fits):

| Type | When |
|---|---|
| `URG` | Safety / act-now: Captain → worker (throttle / freeze / kill); Sentinel → Captain (breach, crash, LOCKED) |
| `FEEDBACK` | Analyst → Scout rejection patterns (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`) that must shape the next query |
| `REQ` / `RES` | A genuine synchronous request expecting an answer (rare) — a real hand-off, not a status ask |

`ACK` — **only** when the sender explicitly needs to know the action took effect to proceed safely
(e.g. Captain must confirm a `FREEZE` was applied before scaling). It is **not** a routine reply. If
an order needs no confirmation to be safe, the receiver applies it silently. `INFO` / `REPORT` are
deprecated for peer traffic — route narration to the event-log, not to panes.

## 🛠️ Sending: `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **Never raw `tmux send-keys` for inter-agent messages.** Codex/Kimi TUIs lose the Enter character
when it arrives with the body, causing silent deadlocks. The wrapper handles text + Enter atomically.
It is **busy-aware**: it waits for the peer's turn to finish then delivers (`exit 0`); `exit 4` = peer
alive but still busy past the budget → **retry later, do not spawn / do not re-reason**; `exit 3` =
possibly-dead → Doctor verdict, not a reflex. Skill: `agents/_skills/tmux-send/jht-tmux-send`.

**On a failed / busy send:** queue it (the bridge `bridge_mailbox` the Captain drains), do **not**
open a fresh reasoning turn to "think about" the failure. Retry is mechanical, not cognitive.

## ⏰ Per-role required signals (everything else is pull)

### 🕵️ Scout
- Receives `FEEDBACK` from Analysts → adapt the next query. **No ACK** unless the Analyst asked a `REQ`.

### 👨‍🔬 Analyst
- Sends `FEEDBACK` to a Scout only on a real pattern: 3 consecutive same-tag exclusions from one
  source, OR > 60 % exclusion rate in one Scout's batch. Otherwise silent (DB carries the hand-off).

### 👨‍💻 Scorer
- No tmux. Pipeline is DB-driven; score insights surface on the dashboard / event-log.

### 👨‍🏫 Writer
- On `URG FREEZE` from Captain: finish the current Critic round (never abandon mid-review), then
  throttle. ACK only — it's the rare confirm-to-proceed case.

### 💂 Sentinel
- Edge-triggered, **inside working hours only**. Speaks **only** on a real state change (spike,
  breach, crash, `LOCKED`). One message per edge — never re-emit. Never broadcasts to workers
  (Captain is the gateway). Steady state → silent.

### 👨‍✈️ Captain
- `URG` to workers (throttle / freeze / kill / spawn) on Sentinel signal or observed pipeline need.
- Reads pipeline state from the **DB**, agent activity from **capture-pane** — never narrates status
  to peers, never re-sends standing orders.

## 📥 Reading peer messages

You don't scan tmux before every action — most coordination is in the DB.
- **Between work units** (after a position, before claiming the next): a quick
  `tmux capture-pane -p -S -20` on **your own** session to notice an incoming `URG` / `FEEDBACK`.
- Prioritize `URG` / `FEEDBACK`; act before picking up new work.
- A message arriving mid-task is already in your context (the wrapper wrote it to your pane) — just
  notice it before the next iteration.

## ⏸️ Throttle: tracked pauses

To slow your loop (cooldown, post-`URG`, wait-for-upstream), use the `throttle` skill, **never plain
`sleep`**:

```bash
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

Every call logs to `$JHT_HOME/logs/throttle-events.jsonl` so the Captain and dashboard see who pauses
and for how long. Plain `sleep` only for ≤ 5 s retry gaps. Captain: name the skill explicitly in the
order (`[URG] jht-throttle 180 --agent scout-1 --reason "rate budget"`), never "sleep 3 minutes".

See: [`../_skills/throttle/SKILL.md`](../_skills/throttle/SKILL.md).

## 🔗 Related

- 🛡️ [`anti-collision.md`](anti-collision.md) — claim-before-work locks (how to coordinate via the DB)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — pipeline overview (who feeds whom)
