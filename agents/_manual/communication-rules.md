# 💬 Inter-Agent Communication Rules

How agents talk to each other through tmux. The protocol is shared by all roles — only the **when** and **what** differ per role.

## 📨 Message envelope

Every inter-agent message uses a tagged single-line envelope:

```
[@from -> @to] [TYPE] payload
```

| Type | When to use |
|---|---|
| `INFO` | Status update / batch handoff (no reply expected) |
| `REQ` | Ask the peer to do something |
| `RES` | Reply to a `REQ` |
| `REPORT` | Final outcome of a unit of work (e.g. CV finished) |
| `FEEDBACK` | Coaching upstream (Analyst → Scout, Scorer → Captain) with a tag like `[SENIORITY] · [STACK] · [GEO]` |
| `URG` | Captain order requiring immediate action (FREEZE, throttle, kill) |
| `ACK` | Acknowledge an `URG` or `REQ` you can't service yet |

## 📡 Sending: use `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [INFO] message body"
```

⚠️ **Never use raw `tmux send-keys` for inter-agent messages.** Codex and Kimi TUIs lose the Enter character if it arrives in the same `send-keys` call as the text body, causing silent deadlocks. The wrapper handles text + Enter atomically with a render pause. Skill at `agents/_tools/jht-tmux-send`.

## 🧭 Captain sessions

When sending to the Captain, try `CAPITANO` first, then fall back to `CAPITANO-2` if the primary doesn't respond. The Captain-2 is a backup for brainstorming/fix work.

## ⏰ When each role MUST communicate

### 🕵️‍♂️ Scout
- After every batch (3-5 inserts) → `INFO` to the Analyst pool: `"batch 5 IDs (X-Y) ready for verification"`
- End of search cycle → `REPORT` to the Captain
- Receives `FEEDBACK` from Analysts on rejection patterns → adjust queries; reply with `ACK`

### 👨‍🔬 Analyst
- Excluded position with rare/critical reason (SCAM, systemic source issue) → `INFO` to the Captain
- 3 consecutive exclusions same source × same tag, OR >60% exclusion rate in a Scout's batch → `FEEDBACK` to that Scout

### 👨‍💻 Scorer
- Score ≥ 50 → `INFO` to the Writer pool: `"new position ID X · score Y"`
- Pre-check failed (years/location/degree) → log to DB only, no tmux notification needed
- Score distribution drift signals → surface to the Captain (Captain then coaches Scouts)

### 👨‍🏫 Writer
- After 3 Critic rounds → `RES` (or `REPORT`) to the Captain with verdict + PDF path
- Receives `URG FREEZE` from the Captain → finish current Critic round (never abandon mid-review), then `ACK` and sleep until throttle returns to T0/T1

### 💂 Sentinel
- Event-driven, **edge-triggered** — only speaks when state actually changes (usage spike, projection breach, agent crash)
- Sends `URG` with the proposed action (throttle / freeze / kill) to the Captain
- Never broadcasts to pipeline agents directly; the Captain is the gateway

### 👨‍✈️ Captain
- Orders: `URG FREEZE` / `URG throttle=T0|T1|T2` to Writers (and other heavy agents) on Sentinel signal
- Coordination: `INFO` / `REQ` to spawn/stop instances, rebalance the pool
- User reply path: forwards user feedback from Phase 5 to the relevant role
- Never reads pipeline agents' tmux directly to second-guess them — uses DB state and `agent_messages`

## 📥 Reading peer messages

Before starting any new unit of work, scan your own pane for unread messages:

```bash
tmux capture-pane -t "$MY_SESSION" -p -S -20
```

If anything arrived since your last action, **read it first** and act on it (especially `URG` and `FEEDBACK`).

## 🔗 Related

- 🛡️ [`anti-collision.md`](anti-collision.md) — lock mechanisms (claim before work)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — pipeline overview (who feeds whom)
