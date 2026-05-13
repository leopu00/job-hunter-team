---
name: liveness-check
description: Diagnose whether a team agent's tmux session is alive, in a long turn, or silently dead — and respawn it preserving context if dead. Owned by the Dottore (the team's roving health-check agent), not by the Captain. The core failure mode this skill catches: `jht-tmux-send` returns `exit 0` even when the target CLI has crashed (the message is written into a bare bash, then lost). Without periodic liveness checks the team keeps "talking to a corpse" and the Captain counts on actions that will never happen.
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *)
---

# liveness-check — keep the team honest

A tmux session can survive its CLI. When the Codex / Kimi TUI crashes, tmux falls back to a bare bash prompt; messages keep being written into it (`exit 0` from `jht-tmux-send`), nobody reads them, the agent is a zombie. This skill detects the state and recovers.

## When to run a check

- 🩺 **Routine round** — every Dottore wake-up (~30 min) walks every team session in sequence (see `agents/dottore/dottore.md` for the full one-shot lifecycle).
- 🚨 **Captain handoff** — when the Captain reports an agent silent > 10 min while it should be working (no Scout REPORT, no Writer ACK to the Critic).
- 🔁 **Post-URG** — 10-30s after a Captain `[URG]` / `[MSG]` to confirm ACK + the CLI is still alive.
- ⚖️ **Pre-scaling** — before a spawn/kill that depends on an existing agent's state (do not spawn the Analyst if the Scout it relies on is dead).

## Step 1 — capture, don't trust

Always read the pane first; do not act blind:

```bash
tmux capture-pane -t <SESSION> -p -S -200
```

The 200-line scroll-back gives enough context to (a) judge state, (b) reconstruct what the agent was doing for the resume kick-off if it must be respawned.

## Step 2 — diagnosis table

Match the **last 20 lines** against:

| Pattern in `tmux capture-pane -t <SESSION> -p \| tail -20`           | Diagnosis           | Action              |
|----------------------------------------------------------------------|---------------------|---------------------|
| Concrete reply to a recent ping (e.g. "writing CV on #281")          | ✅ alive, working   | log `status=alive`, next agent |
| `Working...` for > 5 min on the same turn, but token output visible  | 🟡 long turn        | log `status=long_turn`, do NOT respawn |
| Pane unchanged since before the ping                                 | 🔴 stalled / inert  | RESPAWN (Step 3)    |
| `Whirlpooling...` spinner > 10 min, zero output                      | 🔴 silent stall     | RESPAWN             |
| Last line = `jht@<host>:~/agents/<role>$` (bare shell prompt)        | 💀 CLI exited       | RESPAWN             |
| `Permission denied: …/.kimi/sessions/.../context.jsonl`              | 💀 kimi crashed on context IO | RESPAWN  |
| `Run kimi export and send the exported data to support`              | 💀 kimi crash banner | RESPAWN            |
| `To resume this session: kimi -r <id>`                               | 💀 orphan session   | RESPAWN             |
| `Killed by timeout (60s)` (Kimi)                                     | 🟡 tool call killed, CLI alive | NOT a respawn case — the agent forgot to pass `timeout: N+30` to its shell tool call (see `agents/_skills/throttle/DESIGN-NOTES.md`). Diagnose with `jht-throttle-check <agent>`. |
| `command not found` for `kimi` / `claude` / `codex`                  | 💀 launcher bypassed | RESPAWN            |
| Pane still > 5 min, no spinner, no input                             | 🟡 ambiguous idle   | extended capture (`-S -100`) for full context |

If unsure: **do not respawn**. Log `status=ambiguous`. A false positive (unnecessary respawn) costs 1-2 min of reboot + lost context. A false negative (missed zombie) costs at most 30 min until the next Dottore round.

## Step 3 — respawn with context (only on 🔴 / 💀)

Atomic sequence:

a) **Use the pane already captured** at Step 1 as the agent's "memory". Extract:
   - last task in progress (e.g. "writing CV on position #281")
   - last Captain message (search for `[@capitano -> @<role>]` markers)
   - any recent error

b) **Identify role + workdir**.
   - Singletons (`capitano | critico | sentinella | assistente | mentor | dottore`) → `/jht_home/agents/<role>/`
   - Multi-instance (`scout | scrittore | scorer | analista`) → `/jht_home/agents/<role>-<N>/` where `<N>` is the trailing number in the tmux session (e.g. `SCRITTORE-2` → `/jht_home/agents/scrittore-2/`).

c) **Kill the broken session, respawn via launcher** (use `spawn-agent` skill semantics — never raw `tmux new-session` + `send-keys "kimi ..."`):

```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
sleep 12
```

d) **Inject resume context** as the kick-off body (do not just say "resume" — say *what* and *where*):

```bash
jht-tmux-send <SESSION> "[@dottore -> @<role>] [MSG] Resume: <task in progress before crash>. Last Captain order: <quoted from pane>. Pick up from there, do NOT restart from scratch. Acknowledge with [@<role> -> @capitano] [RESUME] <one-line description>."
```

If the pane shows the agent had a database row claimed (e.g. `status=writing` on a position), include that in the resume context so it does not duplicate work. **Never respawn blind**: read `db_query.py` first if needed.

## Hard "do not respawn" exceptions

NEVER respawn:
- A session with **token output activity in the last 60 seconds** — the agent is working, even if it looks slow.
- The `CAPITANO` during a Codex window-rotation (session_id changing in the sentinel) — wait for stabilisation.
- Long turns ( > 5 min) WITH visible token output (parsing, file edits) — long ≠ dead.
- Yourself (`DOTTORE*`) or `DOCTOR-WATCHDOG`.

## Idempotence

If the captured pane already shows a recent `[RESUME]` marker (within ~5 min), another Dottore round just respawned the agent. Log `status=alive` and move on — do not respawn it again.

## Logging

Every action lands in `/jht_home/logs/dottore-actions.jsonl` (append-only, one JSON per line):

```json
{"ts": "ISO-UTC", "round_id": "uuid-or-epoch", "session": "SCRITTORE-1",
 "role": "scrittore-1", "event": "diagnosis",
 "status": "alive|long_turn|stallo|cli_dead|ambiguous",
 "evidence": "last 1-2 pane lines"}
{"ts": "ISO-UTC", "round_id": "...", "session": "SCRITTORE-1", "role": "scrittore-1",
 "event": "respawn", "context_recovered": "...", "new_pid": null}
```

Generate `round_id` once per Dottore round (e.g. epoch seconds at round start). Append with `>>`, never overwrite.

## Anti-patterns

- ❌ Trusting `jht-tmux-send` exit code 0 as proof of delivery. Delivery ≠ execution. Always pair it with capture-pane on a critical message.
- ❌ Killing a session without a capture-pane first — it might be in a long tool call, not dead.
- ❌ Respawning blind (no resume context) — the new agent restarts from scratch, duplicates work, loses claimed DB rows.
- ❌ Walking sessions in parallel — sequential only, one ping at a time. Parallel pings overload tmux on big teams.
- ❌ Spending > 10 min total on a single round — if a round runs long, abbreviate; the next Dottore comes in ~30 min.

## See also

- `agents/dottore/dottore.md` — the Dottore's full one-shot lifecycle (boot → round → self-destruct).
- `spawn-agent` (Captain) — the launcher + kick-off contract this skill reuses for respawns.
- `agents/_skills/throttle/DESIGN-NOTES.md` — the `Killed by timeout (60s)` case (NOT a respawn).
- `agents/_team/team-rules.md` T01 — never kill another agent's session **except** in the explicit respawn flow above.
