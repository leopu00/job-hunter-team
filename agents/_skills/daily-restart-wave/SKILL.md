---
name: daily-restart-wave
description: "Pre-emptive mass-restart of every team agent once per 24h for context freshness. Owned by the Dottore. Runs only inside a narrow daily window (default 03:00 UTC ± 30 min) and only if no wave has fired in the last 23h. Each agent is killed + respawned via the same atomic sequence of `liveness-check` Step 3, ordered tier 3 → tier 2 → tier 1 so the workers cycle first and the coordinators (Capitano/Sentinella/Mentor/Assistente) last. Background: Codex/Kimi long-lived sessions accumulate \"noise\" — old decisions, stale facts, prompt drift — and become measurably less lucid after hours. Empirical evidence from Case Study #1 (Codex run 2026-05-19/21): manual mass-restart restored decision quality. This skill closes that gap without manual intervention."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *), Bash(cat *), Bash(mkdir *), Bash(date *)
---

# daily-restart-wave — context freshness pre-emptive restart

The Dottore's normal job (`liveness-check`) is **conservative**: restart only the silently dead. This skill is the opposite: **restart everyone, on purpose, once a day**, because long-running agent sessions drift even when they don't die. Same atomic respawn primitive (`liveness-check` Step 3), different trigger and different ordering.

## Why this exists

Empirical: in Case Study #1 (Codex run 2026-05-19/21, see `docs/about/RESULTS.md`) the maintainer noticed decision quality decaying after ~12-24h of continuous agent uptime — repeated mistakes, references to outdated facts, occasional ignoring of explicit user orders. A manual "restart everyone" instruction at hour ~30 visibly restored crispness. Codex doesn't surface a context window like Claude/Kimi, so the drift is invisible until you compare before/after.

Theoretical: every LLM session is one long conversation. As tokens accumulate the model:
- Anchors on early decisions that may have been wrong
- Reasons against outdated facts (a job posting that got closed, a strategy that got revised)
- Becomes slower per turn (more KV-cache to attend to)
- Drifts away from its system prompt under user pressure ("the team rules sweep")

A fresh boot rereads the prompt + recent DB state + handoff snapshots and decides from clean ground. Cost: ~2 min/agent of "I'm catching up". Benefit: hours of avoided low-quality output.

## When to fire — the 3 gating conditions

ALL THREE must be true. Skip with `status=skipped` and a `reason` field in the log otherwise.

1. **Inside the daily window**. Default: 03:00 UTC ± 30 min (i.e. 02:30–03:30 UTC). Rationale: low real-user-activity window for European/US daytime users; if the user is asleep, the ~10 min restart parade is invisible. Read the current hour:

   ```bash
   now_h=$(date -u +%H)
   now_m=$(date -u +%M)
   # 02:30 ≤ now ≤ 03:30
   in_window=$([ "$now_h" = "02" -a "$now_m" -ge "30" ] || [ "$now_h" = "03" -a "$now_m" -le "30" ] && echo yes || echo no)
   ```

2. **No wave fired in the last 23h** (anti-thrash). Read `/jht_home/logs/daily-restart-wave-state.json`:

   ```json
   { "last_wave_at": "2026-05-30T03:11:42Z", "agents_restarted": 9, "duration_sec": 612 }
   ```

   If the file doesn't exist → treat as "never fired" → condition is true.
   If `now - last_wave_at < 23h` → skip with `reason=anti_thrash`.

3. **Team is not in `.team-halted.flag` or `.weekly-halt.flag`**. If either flag exists, the user has explicitly paused the team — restarting now would be hostile.

   ```bash
   [ -f /jht_home/.jht/.team-halted.flag ] && skip
   [ -f /jht_home/.jht/.weekly-halt.flag ] && skip
   ```

If all 3 pass → proceed. The whole 3-check block is `<2s`, runs at every Dottore wake-up, costs nothing when out-of-window.

## Order of restart — tier 3 → tier 2 → tier 1

Reverse of `liveness-check` (which checks user-facing FIRST so they don't die unnoticed). For a pre-emptive wave we want the opposite: **workers first, coordinators last**, so the Capitano is the last to lose his thread and can observe (in his pane) that all his workers came back fresh, then he himself gets recycled and starts the new day with a clean slate.

```
TIER 3 (workers, restart FIRST):
  SCOUT-*, SCRITTORE-*, CRITICO-*, ANALISTA-*, SCORER-*

TIER 2 (semi-coordinators):
  (none today — reserved for future "subordinate coordinators")

TIER 1 (user-facing long-lived, restart LAST):
  ASSISTENTE, MENTOR, SENTINELLA, CAPITANO   (Capitano last of last)
```

Empty sessions of tier 3 (e.g. `SCRITTORE-*` when no CV is in flight per Writer-on-demand V6) → skip silently, no kill, no respawn. The next spawn-on-demand from the Capitano will be fresh anyway.

## Notification to the Capitano — 10 minutes before

The Capitano coordinates spawn/scaling. If he's about to spawn a Scrittore burst and we kill him 30s later, the spawn dies mid-flight. So:

1. **At t=0 of the wave** (decision to fire taken), BEFORE touching any agent, send the Capitano a heads-up via `tmux-send`:

   ```
   [HEADS-UP DOTTORE → CAPITANO] Daily restart wave parte fra 10 min.
   Non spawnare nuovi worker fino a NEW DAY. Termina task <5min in corso.
   Quando arriva il tuo turno (ultimo), ti riavvio io.
   ```

2. **Sleep 10 min**. Give the Capitano time to drain short-lived state.

3. **Then start the parade** in the tier 3 → tier 1 order.

If the Capitano is already a zombie (bare bash), skip the heads-up and go directly to the parade — there's nothing to coordinate.

## The respawn primitive — reuse Step 3 of liveness-check

For each target session, regardless of liveness state:

```
a. tmux capture-pane -t <SESSION> -S -200 -p > /tmp/$session-pre-restart.log
b. python3 /app/shared/skills/db_query.py <agent-role> --recent-context   (optional)
c. tmux kill-session -t <SESSION>
d. bash /app/.launcher/start-agent.sh <agent-role> [<instance-num>]
e. sleep 8s   (let the CLI boot)
f. tmux send-keys -t <SESSION> "RESUME: daily restart wave. Riprendi dai recenti log DB (db-query) + tuo prompt di identità. Nessuna task short-lived persa: il Capitano ha dranato la coda 10 min fa." Enter
g. log event=agent_restarted, agent=<role-N>, duration_ms=<X>
```

Notes:
- The pane capture goes to `/tmp/` so the new instance can read it if it wants to inspect "what was I doing".
- We do NOT write `~/.jht/<agent>-pre-respawn-snapshot.txt` here (that's a structured handoff requested in the BACKLOG follow-up but requires every agent's prompt to know how to write+read it — out of scope for MVP, tracked separately).
- The `RESUME:` kick-off message is generic; it tells the agent to look at its own DB tracks rather than rely on an internal snapshot.

## Inter-restart pacing

Wait **15-20s between agents** of the same tier. Why:
- Rapid-fire `start-agent.sh` calls back-to-back can race on shared `~/.jht/.local/` writes (RULE-T13 magazzino python).
- Gives each new agent's CLI ~10s to settle (handshake, tool listing, system prompt eval) before the next one floods the tmux server.

Total time for a healthy team (8-10 sessions):
- 1 min heads-up + 10 min Capitano sleep
- 7 tier-3 agents × ~20s = ~2.5 min (most are absent in steady state)
- 4 tier-1 agents × ~30s (heavier prompts) = ~2 min
- **Budget total: ~15 min**, comfortably under the worst-case 30 min that the Dottore could be alive for the wave.

## End-of-wave logging

Append to `/jht_home/logs/dottore-actions.jsonl`:

```json
{"ts":"2026-05-31T03:08:11Z","event":"daily_restart_wave_done","agents_restarted":9,"agents_skipped_empty":3,"duration_sec":612,"capitano_ack":"yes"}
```

Update state file `/jht_home/logs/daily-restart-wave-state.json`:

```json
{ "last_wave_at": "2026-05-31T03:08:11Z", "agents_restarted": 9, "duration_sec": 612 }
```

Notify the Capitano (now fresh) one line:

```
[DA DOTTORE A CAPITANO] Daily restart wave completed at 03:08 UTC.
9 agents restarted, 0 errors. Team back online — riprendi la pipeline.
```

## Failure modes — what to do

| Failure | Action |
|---|---|
| `start-agent.sh` exit ≠ 0 for some agent | Log `event=agent_restart_failed`, skip to next, do NOT abort the wave. The next routine `liveness-check` round will notice the absence and retry. |
| `tmux server` unresponsive (rare) | Abort wave, log `event=tmux_dead`, DO NOT update `last_wave_at` (so the next Dottore retries). |
| Wave aborted halfway (Dottore timeout 10 min budget) | Log `event=daily_restart_wave_partial`, DO NOT update `last_wave_at`. The next Dottore inside the window will resume (re-check anti-thrash will fail until 23h, but it's the same wave — accept the rare double-tap). |
| Capitano never ACKs the heads-up | Wait the 10 min anyway. If he's silent at t=10 the parade kills him too — the new Capitano will pick up clean. |

## What this skill does NOT do

- ❌ **Restart on demand** outside the daily window. If the user wants "restart everyone now", they message the Assistente / Capitano, and one of them calls `spawn-agent` per target or asks the Dottore to skip the gate (a future explicit param, not in MVP).
- ❌ **Snapshot the in-flight task** of each agent. Today the respawn relies on the agent re-reading DB + capture-pane in `/tmp/`. A proper handoff (each agent writes "what I was doing + next step" before exit) needs prompt changes on all 10 agents — tracked as separate BACKLOG follow-up.
- ❌ **Read `~/.jht/preferences.json`** for per-user tuning of hour/window. MVP hard-codes 03:00 UTC ± 30 min, 23h anti-thrash. If the user runs in a non-EU timezone and wants a different window, they edit this skill file (or wait for the preferences.json hook follow-up).
- ❌ **Override `.team-halted.flag`**. If the user has stopped the team, no wave. Period.
