# 🛡️ Anti-Collision Protocol

When multiple agents of the same role pull from the same queue, they MUST avoid working on the same record. The mechanism is **role-specific** — each phase uses the lock strategy that fits its work shape best.

## 🎯 Per-role lock mechanisms

### 🕵️‍♂️ Scout — pre-INSERT dedup

Scouts write *new* records, so they can't lock something that doesn't exist yet. The collision risk is two scouts inserting the same job posting from different sources. Mechanism:

```bash
# Before INSERT, check if the URL is already in the DB
python3 shared/skills/db_query.py check-url "<url>"
# Returns "TROVATA" (skip) or "NON TROVATA" (proceed with INSERT).
```

Boot-time partition: scouts also negotiate **circles** and **sources** via `scout_coord.py` so they don't overlap on the same source upfront. See `agents/scout/scout.md` for details.

### 👨‍🔬 Analyst · 👨‍💻 Scorer — `last_checked` watermark

Both pull from a queue (`status = new` for Analysts, `status = checked` for Scorers) and update existing records. The collision risk is two peers picking the same record at the same time. Mechanism:

1. **Read** `last_checked` for the candidate record.
2. **If recent** (a peer has stamped it within the last few minutes) → skip; pick the next one.
3. **Otherwise** stamp `last_checked = now()` to claim it, then work.

```bash
# Claim
python3 shared/skills/db_update.py position <ID> --last-checked now
```

The watermark is a soft lock: it only signals "recently touched", not "permanently locked". Stale-claim handling is left to the agent's judgement (see § Stale claims below).

### 👨‍🏫 Writer — `status = writing` flip

Writers pull from `status = scored`. The collision risk is two writers grabbing the same high-score position. Mechanism:

```bash
# Atomic claim by flipping status
python3 shared/skills/db_update.py position <ID> --status writing
```

Peers running `next-for-scrittore` won't see records already in `status = writing`, so the flip itself is the lock. Anti-rewrite rule on top: if `applications.critic_verdict` is already set, **skip absolute** (the verdict is final).

## 📡 Communication

When an agent needs to inform a peer (e.g. "I'm taking IDs 42-44") or notify downstream (e.g. Scout → Analyst with a fresh batch), use the atomic wrapper:

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [INFO] taking IDs 42-44"
```

⚠️ **Do not use raw `tmux send-keys`**: Codex/Kimi TUIs lose the Enter character if it arrives in the same `send-keys` call as the text body. The wrapper handles text + Enter atomically with a render pause. Skill: `agents/_tools/jht-tmux-send`.

## 🩺 Stale claims (rare in production)

Production agents run for months without dying — stale claims are mostly a test-environment artifact. When they do happen:

- **Don't blindly steal a stale claim.** A `last_checked` from 10 minutes ago might be a peer that's just slow on a single record, not a dead session.
- **Verify peer liveness first.** Check the peer's tmux session (`tmux has-session -t <peer>`); inspect the pane (`tmux capture-pane -p`) to see if it's still working, blocked on a fetch, or actually dead.
- **If the peer is alive but stuck**, escalate to the Captain rather than yanking the record.
- **If the peer is dead**, claim the record yourself and notify the Captain.

The intent: avoid silent record-stealing. Decisions about reclamation should be deliberate, not automatic.

## 📋 Common rules

- **Read before claim.** Always check the current state of the record before claiming it.
- **First write wins.** If two agents race on the same record, the first DB update wins; the loser skips and grabs the next one.
- **Never DELETE.** Use `--status excluded` with notes when a record turns out to be invalid; never destroy data.
- **Update final status when done.** After working: `checked` (Analyst), `scored` / `excluded` (Scorer), `ready` / `excluded` (Writer).

## 🛠️ Future unification (planned)

A `positions.claimed_by + claimed_at` pair is on the roadmap to enable **batch claims** (one atomic `UPDATE … LIMIT N` instead of N round-trips per record) and to power a real-time agent-activity view for the UI dashboard. The role-specific mechanisms above will keep working alongside it. See ROADMAP § *Database schema optimization*.
