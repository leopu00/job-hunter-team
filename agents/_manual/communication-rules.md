# 💬 Inter-Agent Communication Rules

JHT agents coordinate primarily through the **database**, not through tmux. The DB carries the steady-state pipeline; tmux is reserved for **real-time signals** that can't wait for the next polling cycle.

## 🗄️ DB-driven coordination (the default)

Pipeline handoffs flow naturally through the DB — no tmux notification needed:

| Handoff | Mechanism |
|---|---|
| 🕵️‍♂️ Scout → 👨‍🔬 Analyst | Analyst polls `next-for-analista` continuously; sees fresh `status = new` rows immediately |
| 👨‍🔬 Analyst → 👨‍💻 Scorer | Scorer polls `next-for-scorer`; picks `status = checked` rows |
| 👨‍💻 Scorer → 👨‍🏫 Writer | Writer polls `next-for-scrittore` ordered by `score DESC`; picks `status = scored` rows ≥ 50 |
| 👨‍🏫 Writer → 👤 User | Position lands at `status = ready` + `applications.critic_verdict = PASS`; Captain dashboard surfaces it |

**Rule of thumb**: if the next agent in the pipeline can see the new state by running its standard `next-for-X` query, **do not send a tmux message**. tmux on every batch creates noise and risks lost messages on busy panes.

## 📡 tmux is for real-time signals only

Send a tmux message only when the receiver needs to act *now* and can't wait for the next DB poll:

| Type | When to use | Real-time required because… |
|---|---|---|
| `URG` | Captain → workers (FREEZE / throttle / kill) on Sentinel signal | Rate-limit overshoot is imminent — DB polling is too slow |
| `URG` | Sentinel → Captain on real state change (spike, breach, crash) | Same |
| `FEEDBACK` | Analyst → Scout on rejection patterns (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`) | Scout must adapt the **next** query, not after a polling cycle |
| `REQ` / `RES` | Interactive request between agents (rare) | Synchronous answer expected |
| `ACK` | Reply confirming an `URG` was received and applied | Captain needs to know throttle/freeze took effect |

## 📨 Message envelope

Every inter-agent message uses a tagged single-line envelope:

```
[@from -> @to] [TYPE] payload
```

`TYPE` is one of `URG · FEEDBACK · REQ · RES · ACK · INFO · REPORT` — but in V5 only the first 5 are routinely used (see table above).

## 🛠️ Sending: `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **Never use raw `tmux send-keys` for inter-agent messages.** Codex and Kimi TUIs lose the Enter character if it arrives in the same `send-keys` call as the text body, causing silent deadlocks. The wrapper handles text + Enter atomically with a render pause. Skill at `agents/_tools/jht-tmux-send`.

## ⏰ Per-role required signals

What each role MUST send via tmux (anything else is DB-driven):

### 🕵️‍♂️ Scout
- Receives `FEEDBACK` from Analysts → adapt queries; reply `ACK`

### 👨‍🔬 Analyst
- Sends `FEEDBACK` to a Scout when:
  - 3 consecutive exclusions from the same source with the same tag, OR
  - >60% exclusion rate in a single Scout's batch

### 👨‍💻 Scorer
- *(no tmux — pipeline handoffs are DB-driven; score distribution insights surface on the Captain's dashboard)*

### 👨‍🏫 Writer
- Receives `URG FREEZE` from Captain → finish current Critic round (never abandon mid-review), then `ACK` and sleep until throttle returns to T0/T1

### 💂 Sentinel
- Edge-triggered: only speaks when state actually changes (usage spike, projection breach, agent crash). Sends `URG` to the Captain with the proposed action (throttle / freeze / kill). Never broadcasts to workers directly — Captain is the gateway.

### 👨‍✈️ Captain
- Sends `URG` orders to workers (FREEZE, throttle level, kill) on Sentinel signal
- Sends `REQ` for interactive coordination (rare)
- Forwards user feedback from Phase 5 to the relevant role
- Reads pipeline state from the DB, not from worker panes — never second-guesses an agent by attaching to its tmux

## 📥 Reading peer messages

You don't need to scan tmux before *every* action — most coordination flows through the DB. Instead:

- **Between work units** (after finishing a position, before claiming the next), do a quick `tmux capture-pane -p -S -20` on your own session.
- **Prioritize `URG` and `FEEDBACK`**: act on them before picking up new work.
- An incoming message arriving while you're mid-task will already be in your context (the wrapper writes it to your pane); you don't need to poll, just notice it before starting the next iteration.

## 🔗 Related

- 🛡️ [`anti-collision.md`](anti-collision.md) — lock mechanisms (claim before work)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — pipeline overview (who feeds whom)
