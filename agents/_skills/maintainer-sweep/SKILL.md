---
name: maintainer-sweep
description: "The Mantenitore's INFRA maintenance sweep 👷‍♂️ (twin of the Dottore, scoped to infrastructure rather than agents). One daily one-shot pass: liveness canary of the container's life-support processes (bridge/daemon/watchdog) via process_health.py, smoke-test of the mission-critical tools (browser/LinkedIn) via tool_health.py, audit/consolidation of off-standard deps, GC of orphaned scripts and tmp files, de-dup of recurring scripts, dep freshness, disk/RAM trend. Single-writer: the Mantenitore is the ONLY one who repairs the infra; DESTRUCTIVE actions (delete/archive) it PROPOSES, the Capitano decides. Outcome appended to mantenitore-logbook.jsonl."
allowed-tools: Bash(python3 /app/shared/skills/process_health.py *), Bash(python3 /app/shared/skills/tool_health.py *), Bash(python3 /app/shared/skills/sync_health.py *), Bash(python3 /app/shared/skills/host_vitals.py *), Bash(python3 /app/shared/skills/log_archive.py *), Bash(bash /app/.launcher/start-agent.sh *), Bash(df *), Bash(du *), Bash(free *), Bash(tmux ls *), Bash(jht-install *), Bash(ls *), Bash(stat *), Bash(jht-tmux-send *)
---

# maintainer-sweep — keeping the INFRA healthy, quietly and regression-proof

The Mantenitore is the twin of the Dottore: **Dottore = health of the AGENTS** (sessions, tokens, context-refresh); **Mantenitore = health of the INFRA** (tools, deps, disk, scripts). One-shot per day: boot → sweep → logbook → STANDBY (stay idle, no self-terminate; the next spawn replaces you, kill-then-create). Budget ~10 min. Sharp boundary, zero overlap with the Dottore.

> **Why it exists:** the `libatk` bug (browser dead, LinkedIn unverifiable) stayed invisible for hours because *nobody smoke-tested the tools and nobody looked after the infra*. The sweep makes that vigilance STRUCTURAL.

## Golden rule — single-writer + propose-not-delete
The Mantenitore **repairs** the infra (installs missing deps, consolidates, fixes). But every **DESTRUCTIVE** action (deleting/archiving files, disk cleanup) it **PROPOSES** to the Capitano with the exact command; **the Capitano decides** (as in the usage-monitoring redesign). Never delete on your own initiative.

## The sweep (the steps, in order)

### 0. 🫀 Liveness canary of the life-support processes (the safety net)
**FIRST step, before anything else.** The bridges/daemons that keep the container alive (sentinel-bridge, pacing-bridge, heartbeat-bridge, window-ratio-meter, codex-auth-healer + tg-bridge) are launched `setsid` detached → **outside pid1's respawn-on-crash**. The `agent-watchdog` (`maybe_respawn_bridges`) rewatches them every 30s, BUT if that were to fail too (bug, flap-cap reached, watchdog itself degraded) you are **the last net**: on the first sweep of the day you detect and repair. Without this canary a dead daemon stays invisible for hours (that is exactly what happened to the sentinel-bridge on betaC on 2026-06-27 → 8h blind on usage).
```bash
python3 /app/shared/skills/process_health.py summary
```
It prints OK/DEAD for each expected process (bridge-suite, pid1-child, daemon, tg-bridge). For the DEAD ones:
- **`bridge-suite` group** (detached, repairable by you) → **REPAIR** immediately, it is a non-destructive respawn:
  ```bash
  bash /app/.launcher/start-agent.sh bridge      # respawns the whole suite (idempotent)
  ```
  then **re-run the canary** to confirm they are alive again. Log `processes_respawned`.
- **tg-bridge** missing (and Telegram bots configured) → `bash /app/.launcher/start-agent.sh tg-bridge`.
- **`pid1-child` / `daemon` / `core` group** (agent-watchdog, doctor-watchdog, auto-report-loop, cloud-daemon, pid1) → these are pid1's job to respawn: if they are dead the problem runs deeper → **ESCALATE to the Capitano** via `jht-tmux-send` (do NOT try to respawn them by hand: you would orphan them). Never leave it silent.

If everything is alive → log `processes_health: all_ok` and move on. This is the twin-for-PROCESSES of step 1's smoke-test-for-TOOLS.

### 0.5 ☁️ CLOUD-SYNC canary (pull + push)
Right after the process canary. The local↔cloud sync has jammed twice
(pull churn: frozen cursor → it rewrote ~500 positions/tick; push 413:
monolithic payload too large → cursor never advanced → cloud dashboard stuck
for ~14h). The code bugs are fixed, but the vigilance has to be made STRUCTURAL.
```bash
python3 /app/shared/skills/sync_health.py summary        # or --json
```
It reads the cursors read-only (`.cloud-sync-cursor.json`, `.cloud-pull-cursor.json`),
the max `positions.updated_at` in the DB and the tail of `logs/daemon.log`. It returns
`problems[]` with severity. Outcome:
- **no problem** → log `sync_health: ok` and move on.
- **push_behind / push_errors (HIGH)** → the push is not reaching the cloud. It is NOT
  safely repairable by you by hand (single-writer on the DB = the team). **ESCALATE
  to the Capitano** via `jht-tmux-send` with the check details (lag + 413 count).
  If the check suggests the emergency drain (`JHT_PUSH_POS_CHUNK=40`), pass the
  proposal to the Capitano, do not act on your own.
- **pull_churn (MEDIUM)** → report to the Capitano that the pull is re-applying
  too many rows (symptom of a non-converging cursor / fix not deployed).
- **cursor_stale (MEDIUM)** → secondary evidence; include it in the escalation only
  if it accompanies a HIGH signal.
Log the outcome under `sync_health` in the logbook entry (see below). The golden rule
is unchanged: **detect + report, never log-and-forget** (it is the same mistake as the
libatk bug and the sentinel-bridge, here on the sync CURSORS).

### 1. 🩺 Smoke-test of the mission-critical tools (the heart)
```bash
python3 /app/shared/skills/tool_health.py --json
```
It returns `tools_health` with `{status: OK|BROKEN|UNKNOWN, evidence}` for each tool (browser/Playwright, linkedin_check, …) + `broken[]`.
- **BROKEN** → **REPAIR** immediately: `jht-install <dep>` (e.g. the Chromium `.so` files) then re-run the check. If repaired → log `repaired`.
- **BROKEN and not repairable** → **ESCALATE to the Capitano** with the EXACT fix via `jht-tmux-send` (e.g. "browser down: `sudo playwright install-deps`; until it is fixed LinkedIn = OPEN_UNVERIFIED"). Never leave it silent.
- This is the SAME `tool_health.py` that feeds the build-time gate (dev1) and the `tools_health` field in the tick: a single source of truth on tool status.

### 2. 📦 Audit off-standard deps → consolidate
Deps installed outside the standard prefixes (`/opt/jht-deps`, `PLAYWRIGHT_BROWSERS_PATH`, npm prefix, venv) → reinstall them into the standard one via `jht-install`, so they are not scattered around. Log which ones you consolidated.

### 3. 🧹 GC of orphaned scripts/tmp files
Temporary scripts left behind by **killed** agents (session no longer in `tmux ls`) and expired tmp files (> N hours). List the candidates → **PROPOSE** the deletion to the Capitano (destructive action), do not delete directly.

### 4. 🔁 De-dup of recurring scripts
Near-identical scripts repeated by several agents → **propose** a single canonical skill (do not rewrite it on the fly). Log the proposal.

### 5. 📅 Dep freshness
Deprecated libraries/tools or broken versions / crucial tools unreachable → report to the Capitano (no risky auto-upgrade).

### 6. 💾 Disk / RAM + trend + VITALS cross-check
`du` on the big paths, `free` for RAM. For **`disk.used_pct` ALWAYS use `df`** — canonical command:
```bash
df -P /jht_home | awk 'NR==2 {gsub("%","",$5); print $5}'   # e.g. 30  (percentage as df reports it)
```
**NEVER** derive it from `statvfs`/`os.statvfs` (`f_bavail`/`f_blocks`): reserved blocks inflate it ~3× → false alarms (e.g. 88% reported against a real 30%). Compare it with the **trend from the last logbook**: if it is growing towards a threshold → discuss with the Capitano what to archive/delete (he decides). Log the numbers + the delta.
**Then CROSS-CHECK the vitals time-series** (the bridge samples the container's RAM+CPU every few minutes into `vitals.jsonl`):
```bash
python3 /app/shared/skills/host_vitals.py summary --hours 24
```
It gives you **peak/average RAM+CPU + the TIME of the peak** for the last 24h. **Correlate the peaks with the *when*** (e.g. RAM 92% at 03:00 with 3 analysts active; CPU maxed out during a heavy script): that is the data that sharpens the diagnosis far more than an instantaneous snapshot alone. If a peak looks anomalous → report it to the Capitano. Log `vitals_24h` (RAM/CPU peak + time) in the entry. NB the Sentinella only receives the alarm if RAM/CPU is >95% live; reading the history and correlating it is **YOUR job**.

### 6.5 🗜️ Archiving of monitoring histories (Leone's order 19/07 — CODE, not discretion)
The append-only histories (`sentinel-data.jsonl`, `token-meter.csv`,
`throttle-events.jsonl`, `agent-vitals.jsonl`, `vitals.jsonl`) grow forever:
they feed the game's usage charts, so they must never be deleted
by hand — they must be **archived with the deterministic flow**:
```bash
python3 /app/shared/skills/log_archive.py status          # depth and sizes
python3 /app/shared/skills/log_archive.py run             # cut >30d → weekly zips
```
What `run` does (all in code, you just read the JSON summary): the weeks older
than 30 days leave the live files and enter
`logs/archive/logs-<YYYY>-Www.zip` (the week's zip grows on every
pass); the cut is atomic and a row enters the zip BEFORE it disappears from the
live file. If space runs out (archive >500MB or <1GB free) it deletes the
OLDEST zips by itself and lists them for you under `pruned`.
- Frequency: 1×/week is enough (Sunday); on weekdays only `status`
  if the disk at step 6 is growing abnormally.
- `pruned` NOT empty → report it EXPLICITLY in the logbook and warn the Capitano
  (it is the only data loss in the flow, authorized by Leone only under
  space pressure).
- DELIBERATE exception to the golden rule: this flow is pre-authorized by
  Leone (19/07) — you do not need the Capitano's OK for `run`; for any
  other deletion outside the flow, the single-writer rule stands.
- Log in the entry: `log_archive: {archived_rows, weeks, pruned, free_gb}`.

## Logbook (append-only)
Every sweep writes ONE dense entry to `/jht_home/logs/mantenitore-logbook.jsonl` (twin of the Dottore's logbook), so the next Mantenitore can see the trend:
```json
{"ts":"ISO-UTC","slot":"maintainer-daily","processes_health":{"all_ok":true,"dead":[]},
 "processes_respawned":[...],"sync_health":{"healthy":true,"problems":[]},
 "tools_health":{...},"repaired":[...],
 "escalated":[...],"deps_consolidated":[...],"gc_proposed":[...],"dedup_proposed":[...],
 "disk":{"used_pct":N,"delta_vs_last":N},"ram":{...},"duration_sec":N,"capitano_ack":"..."}
```
Append with `>>`, never overwrite. Dense summary (like the Dottore's/Capitano's travel notes): what I found, what I repaired, what I proposed.

## Anti-patterns
- ❌ Deleting/archiving without the Capitano's OK (single-writer: propose). ONLY exception: the `log_archive.py` flow of step 6.5, pre-authorized by Leone.
- ❌ Auto-upgrading libraries to new versions (breakage risk) — report, do not upgrade on your own.
- ❌ Leaving a BROKEN tool without repairing NOR escalating (that is exactly the silent libatk bug).
- ❌ Leaving a bridge/daemon DEAD without repairing NOR escalating (the same mistake, on the PROCESSES: it is the sentinel-bridge crash on betaC 2026-06-27).
- ❌ Straying into the health of the AGENTS (sessions/tokens/context) — that is the Dottore's.

## See also
- `shared/skills/process_health.py` — the liveness canary of the life-support processes used at step 0 (daily safety net; the twin-for-processes of tool_health).
- `shared/skills/sync_health.py` — the cloud-sync canary used at step 0.5 (pull churn / push 413 / stale cursors); read-only, the twin-for-SYNC of process_health/tool_health.
- `shared/skills/tool_health.py` — the smoke-test reused at step 1 (also build-time gate + tick).
- `shared/skills/log_archive.py` — the deterministic archiver of step 6.5 (cuts weeks >30d → zip, prunes under space pressure).
- `.launcher/agent-watchdog.sh` — the FAST recovery (every 30s, `maybe_respawn_bridges`) for which step 0 is the daily safety net; lesson of 27/06: the bridges start `setsid` detached, so neither pid1's respawn nor `agent-watchdog` (which respawns tmux sessions, not Python processes) covers them — if they crash they stay down until the container restarts.
- `agents/mantenitore/mantenitore.md` — the Mantenitore's persona/lifecycle (dev3).
- `agents/_skills/resilience/SKILL.md` — the anti-silence ladder for agents (dev3); its "classify" step reuses `tool_health.py`.
- `agents/_skills/liveness-check/SKILL.md` — the twin on the Dottore side (agent health), for structure.
