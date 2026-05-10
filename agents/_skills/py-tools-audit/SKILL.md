---
name: py-tools-audit
description: Coordinated, team-wide cleanup of Python packages installed under `$JHT_HOME/.local` via `uv pip install --user` (T13 magazzino). Owned by the Dottore. The audit is NOT unilateral — only the Writer / Critic agents know whether a library they imported dynamically still serves them, so the flow is broadcast → 1h consent window → uninstall the silent set → re-audit. Because the Dottore is one-shot (~10 min per round, ~30 min apart), the 1h consent window spans 2 Dottore rounds: round N starts the audit + broadcast, round N+1 collects answers + uninstalls.
allowed-tools: Bash(python3 /app/shared/skills/py_tools_audit.py *), Bash(uv pip uninstall *), Bash(jht-tmux-send *), Bash(tmux *), Bash(du *), Bash(xargs *)
---

# py-tools-audit — clean the shared Python magazzino

`$JHT_HOME/.local/lib/python3.x/site-packages/` is the **single shared user-base** every agent reads from (T13). Any agent can `uv pip install --user <pkg>` when it needs a library, but agents *don't* uninstall when they later switch approach — packages pile up. Roughly weekly the magazzino crosses 800 MB and needs a coordinated audit.

The audit is coordinated because a static `import` grep can miss libraries loaded dynamically at runtime (e.g. a `tools/` script the Writer calls only when a JD asks for a specific format). Hence: ask before removing.

## Trigger

- ⏰ ~weekly (every 7 days of continuous run), at the start of an idle operational day
- 📈 on-demand when `du -sh /jht_home/.local` > 800 MB
- 🚀 before a major release / handoff to the user

## Two-round flow (because the Dottore is one-shot)

```
Round N:    audit → broadcast candidates → leave state file
…30 min…
Round N+1:  collect answers → compute keep_set → uninstall → re-audit → report
```

Each round logs its phase in `$JHT_HOME/logs/py-audit-state.json`:

```json
{"phase": "broadcast_sent", "round_id": "...", "ts": "ISO-UTC",
 "candidates": ["pymupdf", "pdfminer.six", "reportlab", "..."],
 "broadcast_at": "ISO-UTC"}
```

When you wake up, **check this file first**:
- file missing or `phase=done` → fresh round, go to "Round N" below
- `phase=broadcast_sent` and `now - broadcast_at >= 1h` → "Round N+1" below
- `phase=broadcast_sent` and `now - broadcast_at < 1h` → consent window not yet closed, skip the audit this round

## Round N — start the audit

### 1. Threshold check

```bash
python3 /app/shared/skills/py_tools_audit.py --threshold-mb 800
```

- Exit `0` → nothing urgent. Stop here, do not broadcast.
- Exit `2` → it's worth cleaning. The script also prints the *candidates table* — packages with no active import, excluding the whitelist (transitive deps + pinned binary CLIs).

### 2. Broadcast to every agent

Send one `[PY-AUDIT]` message to each live agent session via `jht-tmux-send`:

```
[@dottore -> @<role>] [PY-AUDIT] candidates uninstall: pymupdf,
pdfminer_six, reportlab, weasyprint, pypdf, ...
If you USE one of these, reply within 1h with [KEEP <pkg>].
Silence = consent to uninstall.
```

The 1h window is enforced by the **next round's** start, not by a `sleep` in this round (the Dottore is one-shot). Persist the broadcast time in `py-audit-state.json`.

### 3. Persist state and exit the round

```json
{"phase": "broadcast_sent", "round_id": "...",
 "candidates": ["..."], "broadcast_at": "ISO-UTC"}
```

End of Round N. Self-destruct as usual; the next Dottore (~30 min later) will pick this up.

## Round N+1 — collect, uninstall, report

Triggered when `py-audit-state.json` shows `phase=broadcast_sent` and ≥1h has passed.

### 1. Harvest replies

For each broadcasted agent, run `tmux capture-pane -t <SESSION> -p -S -200 | grep '\[KEEP '` to find any `[KEEP <pkg>]` replies. Build the `keep_set`:

```
keep_set = (default whitelist) ∪ (every <pkg> in any [KEEP] reply)
```

Silence on a candidate = consent to uninstall.

### 2. Uninstall the silent set

```bash
python3 /app/shared/skills/py_tools_audit.py --candidates-only --keep <keep_set...> \
  | xargs -r uv pip uninstall --user -y
```

`xargs -r` skips the call when nothing to uninstall (empty stdin).

### 3. Re-audit + report

```bash
python3 /app/shared/skills/py_tools_audit.py
du -sh /jht_home/.local
```

Compute `freed_mb = before - after` and notify the user via the Captain:

```bash
jht-tmux-send CAPITANO "[@dottore -> @capitano] [REPORT] py-audit done: <N> packages removed, <freed_mb> MB freed. Magazzino now <after_mb> MB."
```

### 4. Reset state

```json
{"phase": "done", "round_id": "...", "completed_at": "ISO-UTC",
 "removed": ["..."], "freed_mb": 142}
```

A fresh `py-audit-state.json` with `phase=done` lets the next round restart from scratch.

## Hard rules

- **Never uninstall without the broadcast + 1h window.** Some packages are loaded dynamically and won't surface in a static grep — the broadcast is the only way to catch them.
- **Never touch `ALWAYS_KEEP`.** Transitive notes (numpy, pillow, packaging, ecc.) live there for good reason; the audit script already excludes them.
- **If a Writer protests after an uninstall**, reinstall immediately and add the package to `ALWAYS_KEEP`. Treat this as a process bug (broadcast missed the agent), not as the Writer's fault.
- **Never sudo-uninstall.** Stay inside `uv pip uninstall --user`. T13 forbids `sudo pip` for the same reason it forbids `sudo pip install`.

## Anti-patterns

- ❌ Running both rounds in a single Dottore wake-up by `sleep 3600` — that exceeds the 10-min round budget and breaks the watchdog cadence.
- ❌ Inferring keep set from your own `import` grep without broadcasting — silent failures on dynamic loads.
- ❌ Uninstalling packages > 100 in a single round — too noisy, hard to roll back. Cap at the audit's natural batch (whatever the threshold script returns).
- ❌ Running this skill in reaction to a Sentinel `[ORDINE]` — orders demand pacing/scaling, not housekeeping. py-audit waits for an idle window.

## See also

- `cache-prune` — sister maintenance skill (uv wheel cache, ~24h cadence). Run that one first; it sometimes drops the magazzino size below 800 MB and makes the audit unnecessary.
- `agents/_team/team-rules.md` T13 — installation rule (`uv pip install --user`) that justifies this audit.
- `agents/dottore/dottore.md` — Dottore lifecycle; this skill spans 2 lifecycle rounds via the state file.
