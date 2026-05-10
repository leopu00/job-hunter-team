---
name: cache-prune
description: Reclaim disk on the shared JHT caches (`uv` wheel cache + `codex` SQLite log) every ~24h. Owned by the Dottore — single-instance, runs at the end of a routine round when the team is idle. Never run mid-emergency: the SQLite VACUUM blocks for ~30s on a 200 MB DB and would steal cycles from a Sentinel-driven recovery. Migrated from the Captain so the Captain stays focused on coordination, not housekeeping.
allowed-tools: Bash(node /app/cli/bin/jht.js cache *), Bash(du *), Bash(df *)
---

# cache-prune — reclaim shared caches

The shared `$JHT_HOME` accumulates two caches that grow monotonically until reclaimed:

| Path                                  | What it stores                          | Typical growth (sample 2026-05-02) |
|---------------------------------------|-----------------------------------------|------------------------------------|
| `$JHT_HOME/.cache/uv/`                | wheel cache for every `uv pip install`  | ~364 MB                            |
| `$JHT_HOME/.codex/logs_2.sqlite`      | Codex telemetry SQLite (71% TRACE rows) | ~223 MB                            |

Neither is needed on disk: uv re-downloads if it has to, Codex truncates TRACE rows safely. The numbers above came from a continuous run; on a fresh `$JHT_HOME` they start at 0 and reach hundreds of MB within a few days.

## The single safe command

```bash
node /app/cli/bin/jht.js cache prune
```

Idempotent and no-op when there's nothing to reclaim. Internally:
1. `uv cache prune` — drops stale wheels (keeps the active set referenced by current installs).
2. SQLite `VACUUM` on `logs_2.sqlite` after deleting old TRACE rows.
3. Cleanup of ephemeral Codex temp files.

Each step has a safety gate: `idle > 1h` on the operations that are destructive (VACUUM lock, TRACE delete) — if the team is actively burning tokens the step is skipped.

## When to run

- 🩺 **End of a routine Dottore round** (~24h of continuous run, or at the start of an idle operational day).
- 📉 **On demand** if `du -sh $JHT_HOME/.cache $JHT_HOME/.codex` shows growth > 800 MB total.
- 🚫 **NEVER** mid-budget-critical (proj > 95%) — the VACUUM 30s blocks the Codex SQLite the Sentinel reads through the bridge.
- 🚫 **NEVER** in reaction to a Sentinel `[ORDINE]` — orders demand pacing/scaling actions, not housekeeping.

## Safety: what NOT to touch

The team has *other* caches that look similar but are NOT in scope here:

| Path                                 | Why hands-off                                                     |
|--------------------------------------|-------------------------------------------------------------------|
| `.cache/ms-playwright/`              | browser binaries pinned by version — re-downloading is slow + flaky |
| `.cache/claude-cli-nodejs/`          | Anthropic CLI runtime cache, recreated lazily but bigger when warm |
| `$JHT_HOME/logs/`                    | Sentinel state lives here. Wiping it loses the EMA window and several minutes of monitoring history. |

The blast radius of `cache prune` is limited to the two paths in the table at the top.

> ⚠️ **`cache clear` is forbidden.** That command (a destructive cousin of `cache prune` exposed by `jht`) wipes `logs/` together with the caches, destroying Sentinel state. If you ever feel the urge to `cache clear`, escalate to the user instead.

## Anomalous growth — escalate

If `du -sh` shows a path *outside* the 2 targets above growing fast (e.g. `.cache/ms-playwright/` doubled, `.codex/sessions/` ballooning), do **NOT** prune it on your own. Capture:

```bash
du -sh $JHT_HOME/.cache/* $JHT_HOME/.codex/*
df -h $JHT_HOME
```

…log it to `dottore-actions.jsonl` with `event=disk_anomaly` + the `du` output, and surface it to the user via the Captain (`jht-tmux-send CAPITANO`). A new path growing might mean a new tool was added without budget for cleanup.

## Output to log

Append to `/jht_home/logs/dottore-actions.jsonl`:

```json
{"ts": "ISO-UTC", "round_id": "...", "event": "cache_prune",
 "uv_freed_mb": 142, "codex_freed_mb": 87, "total_freed_mb": 229,
 "duration_sec": 31}
```

If a step was skipped by the idle gate, set the corresponding `_freed_mb` to `null` and add `"skipped": ["vacuum"]`.

## Anti-patterns

- ❌ Running `cache prune` from the Captain — that responsibility was migrated here. The Captain coordinates, the Dottore maintains.
- ❌ Running it while a Writer is mid-CV (their loop touches the uv cache occasionally for pandoc/typst libs).
- ❌ Adding a cron-like loop in the Dottore prompt — the Dottore is one-shot ~30 min cadence, you fit cache-prune at end-of-round when it makes sense, not on a fixed schedule.
- ❌ Bypassing the `jht.js cache prune` wrapper to run `uv cache prune` / `sqlite vacuum` directly — you skip the idle gate and the unified logging.

## See also

- `agents/dottore/dottore.md` — when in the Dottore's lifecycle to slot this skill (end-of-round only).
- `py-tools-audit` — sister maintenance skill (Python packages, ~weekly cadence).
- `agents/_team/team-rules.md` T13 — uv-as-the-only-installer rule (why the uv cache exists in the first place).
