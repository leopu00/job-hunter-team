---
name: spawn-agent
description: Spawn a JHT team agent (Scout, Analista, Scorer, Scrittore, Critico, Assistente, Capitano-2) via the launcher, then deliver the kick-off message that actually starts its main loop. Captain-only — the Captain is the single owner of team scaling. ALWAYS use this skill: bypassing `start-agent.sh` with `tmux new-session` + raw `send-keys "kimi ..."` produces sessions where the CLI never boots (`command not found`), the Captain sees a "live" session that is actually dead, and the team silently underperforms.
allowed-tools: Bash(bash /app/.launcher/start-agent.sh *), Bash(tmux *), Bash(jht-tmux-send *), Bash(sleep *)
---

# spawn-agent — bring an agent online

Two-phase contract: **launch** the CLI, then **kick-off** its loop. Skipping the kick-off leaves the agent at an empty prompt — the Captain thinks it is working, it is not.

## Phase 1 — launch via `start-agent.sh`

```bash
bash /app/.launcher/start-agent.sh <role> [instance_number]
```

Examples:
```bash
bash /app/.launcher/start-agent.sh scout 2       # SCOUT-2
bash /app/.launcher/start-agent.sh analista 1    # ANALISTA-1
bash /app/.launcher/start-agent.sh critico       # CRITICO (singleton, no number)
```

The launcher does, atomically:
- creates the tmux session with the canonical name (`SCOUT-2`, `ANALISTA-1`, …)
- sets `cwd` to `$JHT_HOME/agents/<role>[-N]/`
- exports `JHT_HOME · JHT_DB · JHT_AGENT_DIR · PATH · JHT_USER_DIR · JHT_CONFIG`
- detects the active provider from `jht.config.json` (claude / kimi / codex)
- copies `agents/<role>/<role>.md` into the workspace as `CLAUDE.md` / `AGENTS.md`
- starts the CLI with the right flags for that provider + tier

> ⚠️ **NEVER** spawn with `tmux new-session ... ; tmux send-keys "kimi ..."`. The CLI is not on `PATH` outside the launcher's environment → `command not found` → the session is just bash. The Captain's `jht-tmux-send` returns `exit 0` writing to that empty bash, the message is silently lost, and the team underperforms with no visible cause.

## Phase 2 — kick-off (mandatory)

The launcher boots the CLI but **does not send any first message**. Without a kick-off the agent waits at an empty prompt forever.

Standard sequence:
```bash
bash /app/.launcher/start-agent.sh scout 1
sleep 12   # CLI boot 8-15s — never less than 10
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [MSG] <kick-off body>"
```

### Kick-off body per role

| Role        | Kick-off body                                                                                                |
|-------------|--------------------------------------------------------------------------------------------------------------|
| `scout`     | "Start the main loop. Read your prompt, the candidate profile (`$JHT_HOME/profile/candidate_profile.yml`), and begin from CIRCLE 1 (primary preference). Notify Analysts after batches of 3-5 positions." |
| `analista`  | "Start the main loop. Queue: `db_query.py next-for-analista`. For each position, fill the 5 mandatory fields and promote to `checked` or `excluded`." |
| `scorer`    | "Start the main loop. Queue: `db_query.py next-for-scorer`. PRE-CHECK first, then 0-100 score. Gates: <40 excluded, 40-49 parking, ≥50 notify Writers." |
| `scrittore` | "Start the main loop. Queue: `db_query.py next-for-scrittore`. Max effort, 3 mandatory rounds with the Critic. PDF goes under `$JHT_USER_DIR/cv/`." |
| `critico`   | "You will be called by your parent Writer with PDF + JD. One blind review per call, then stop." |
| `assistente`| "Start the main loop. Wait for `[@utente -> @assistente] [CHAT]` from the web UI." |

If the position-resume context is non-trivial (the agent had work in progress before a crash), append it to the kick-off so it picks up where it left off — never just say "resume", say *what* and *where*:

```bash
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [MSG] Resume: position #281 (Qargo TMS), round 2 with the Critic was about to start. Pick up from there, do NOT restart from scratch."
```

## Phase 3 — verify the boot succeeded

About 5 seconds after the kick-off:
```bash
tmux capture-pane -t <SESSION> -p | tail -10
```

Read the output:
- ✅ CLI banner + spinner + the kick-off body visible in the input area → boot OK
- 🟡 `context: 0.0%` and an empty input area → kick-off didn't land, retry once
- 🔴 shell prompt `jht@host:~/agents/<role>$` (no CLI) → launcher failure, see fallback below

> Note: ongoing health checks (zombie detection, silent agents > 10 min) are NOT this skill's job — they belong to the **Dottore** via the `liveness-check` skill. This skill ends once Phase 3 confirms the boot.

## Fallback — launcher failure

If Phase 3 shows a bare shell prompt (no CLI started), check first:

```bash
tmux capture-pane -t <SESSION> -p -S -50 | grep -iE "command not found|permission denied|no such file"
```

Likely causes:
1. Provider CLI not in `PATH` for the launcher's environment → check `jht.config.json` provider matches the installed CLI
2. The role template `agents/<role>/<role>.md` is missing → the launcher copies an empty file → CLI starts but has no instructions
3. `$JHT_HOME` is unset / not exported in the parent → escalate to user, do NOT try to set it manually

Kill the broken session before retrying:
```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
```

## Anti-patterns

- ❌ Spawning multiple agents in a tight loop without 1-tick pacing — see `pipeline-triage` for scaling rules (1 spawn per Sentinel tick, ~5 min apart).
- ❌ Re-spawning blindly after a crash without reading `db_query.py` to recover the last task state — the new agent starts from scratch and duplicates work.
- ❌ Using this skill to "restart" a working agent because it looks slow. Slow ≠ dead. Long turns with visible token output are not a spawn case — they are a `liveness-check` case (Dottore).
- ❌ Spawning a Critic. The Writer spawns its own `CRITICO-S<N>` autonomously — the Captain never touches the Critic directly.

## See also

- `liveness-check` (Dottore) — when an existing agent looks dead.
- `pipeline-triage` (Captain) — *which* role to spawn based on backlog.
- `tmux-send` — message envelope conventions.
- `agents/_team/team-rules.md` T01 — never kill another agent's session.
