# Case study VPS extraction toolkit

Read-only dump of an entire JHT VPS run for offline analysis. Used to build
`docs/about/RESULTS.md` and `/case-studies` page from raw evidence.

## What gets extracted (per VPS)

| Source | What | Why |
|---|---|---|
| Host `/root/.jht/jobs.db` | SQLite DB (raw + JSON per table) | Pipeline truth |
| Host `/root/.jht/logs/` | All `.jsonl`, `.log`, `*.png` | Bridge/sentinel timeline |
| Host `/root/.jht/profile/` | `candidate_profile.yml` (anonymized) | Profile context |
| Host `/root/.jht/handoff-*.txt` | Agent handoff snapshots at run end | Per-agent state |
| Host `/root/.jht/state/` `data/` `runtime/` | Misc state files | Completeness |
| Host `/root/.jht/jht.config.json` | Config (with secrets redacted) | Setup context |
| Host `/root/.jht/rate_budget*.png` | Bridge rate budget charts | Pre-rendered viz |
| Host `/root/Documents/Job Hunter Team/` | CV, critiche, allegati, output | Deliverables |
| Container `/jht_home/.codex/sessions/` or `.kimi/sessions/` | `wire.jsonl` / `rollout-*.jsonl` | Token-level telemetry |
| Container `docker ps`, `df`, `free` | Runtime context | Snapshot metadata |

## Constraints

- **Strictly read-only** on the VPS. No `team start`, no agent spawn, no DB writes.
- The `cloud.json` file is **never** extracted (contains live sync token).
- `candidate_profile.yml` is **anonymized** locally before being written to disk
  (name, email, LinkedIn URL fields redacted).
- The host `agents/` directory (workspaces + python venvs, ~400-600MB) is **excluded**
  — useful for debug, useless for case-study analysis.

## Cutoff semantics

If a `--cutoff ISO_TIMESTAMP` is provided, all timestamped records (DB tables,
JSONL log lines, session files by mtime, deliverables by mtime) are filtered to
keep only rows where `timestamp < cutoff`. This is critical for the Kimi VPS
which auto-restarted the team after the run ended and accumulated noise data —
the cutoff cuts the snapshot at the natural run-end.

## Scripts

| Script | Purpose |
|---|---|
| `dump_db_tables.py` | DB tables → JSON per table + raw `.db` copy |
| `dump_host_files.py` | Host filesystem dump (logs, handoffs, profile, config, charts, deliverables) |
| `dump_container_sessions.py` | Session logs from inside the container |
| `anonymize_profile.py` | Redact PII from `candidate_profile.yml` |
| `build_manifest.py` | Write `manifest.json` with extraction metadata |
| `pack_zip.py` | Zip all per-VPS dirs into a single archive |
| `extract_all.sh` | Orchestrator — runs everything for both VPSes |

Run individual scripts with `--help` for args. Default orchestrator:

```sh
./tools/case-study-extract/extract_all.sh
```

Output lands in `~/jht-case-study-data/full-snapshot-YYYYMMDD/` plus a final
`.zip` archive alongside it.
