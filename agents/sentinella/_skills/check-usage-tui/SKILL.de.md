<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: check-usage-tui
description: Prueft die Nutzung des Providers ueber TUI Worker (~30s, verbraucht CLI-Tokens). FALLBACK wenn `check-usage-http` RATE_LIMIT zurueckgibt oder fehlschlaegt. Startet eine kurzlebige tmux-Sitzung, fuehrt `/usage` (oder `/status` fuer Codex) aus, parst das Modal, beendet die Sitzung.
allowed-tools: Bash(tmux *), Bash(python3 *)
---

# Skill — Nutzung pruefen via TUI Worker (robust, ~30s, token-intensiv)

## WANN VERWENDEN

**Nur als L2** nachdem L1 (HTTP) fehlgeschlagen ist. Sie ist robust, weil sie das Anthropic-Rate-Limit umgeht (liest vom lokalen CLI), kostet aber:
- ~30s Zeit (Worker-Spawn + CLI-Boot + Modal-Render)
- einige Claude-Tokens (Sitzungsoeffnung + /usage)
- Risiko eines TUI in anomalem Zustand (Loading, abgelaufen, etc.)

Fallback-Reihenfolge: **HTTP → TUI → FATAL**.

## Workflow

### Step 1 — Aktiver Provider

```bash
python3 -c "import json; print(json.load(open('/jht_home/jht.config.json'))['active_provider'])"
```

### Step 2 — Spawn einer KURZLEBIGEN tmux-Sitzung

Eindeutiger Name mit Timestamp (keine Kollision):

```bash
SESS="SENTINELLA-WORKER-$(date +%s)"
tmux new-session -d -x 220 -y 50 -s "$SESS" -c /jht_home
tmux send-keys -t "$SESS" "export HOME='/jht_home'" C-m
tmux send-keys -t "$SESS" "export PATH='/app/agents/_tools:/jht_home/.npm-global/bin:\$PATH'" C-m
tmux send-keys -t "$SESS" "export KIMI_CLI_NO_AUTO_UPDATE=1" C-m
```

### Step 3 — CLI des Providers starten

| Provider | Comando |
|---|---|
| `claude` / `anthropic` | `claude --dangerously-skip-permissions` |
| `kimi` / `moonshot` | `kimi --yolo` |
| `codex` / `openai` | `codex --yolo` |

```bash
tmux send-keys -t "$SESS" "<comando>" C-m
sleep 18   # Boot + eventueller Trust-Dialog Auto-Accept
```

### Step 4 — Slash command

| Provider | Slash command |
|---|---|
| `claude` / `anthropic` | `/usage` |
| `kimi` / `moonshot` | `/usage` |
| `codex` / `openai` | `/status` (NICHT `/usage`!) |

```bash
tmux send-keys -t "$SESS" "<slash>" Enter
sleep 4   # Modal rendern
```

⚠️ **KEIN praeventives Esc** vor dem Slash-Command: bricht Kimi (interpretiert /usage als Text) und ist bei den anderen in einer frischen Sitzung unnoetig.

### Step 5 — Capture pane

```bash
tmux capture-pane -t "$SESS" -p -S -100
```

Lies den Pane mit **deinen LLM-Augen**, extrahiere `usage`, `reset`, `weekly`.

#### Format Claude

```
Current session
████████  45% used
Resets 8:10pm (UTC)

Current week (all models)
████  25% used
Resets Apr 27, 5am (UTC)
```
→ usage=`45`, reset=`20:10` UTC, weekly=`25`

#### Format Kimi

```
╭─── API Usage ──────────────────────────────────╮
│ Weekly limit  ━━ 60% left  (resets in 2d 27m) │
│ 5h limit      ━━ 100% left (resets in 3h 27m) │
╰────────────────────────────────────────────────╯
```
→ usage=`100-100=0`, weekly=`100-60=40`
→ reset_at: aktuelle_UTC + 3h 27m → berechne HH:MM UTC

#### Format Codex

```
5h limit:    [████░░] 35% left (resets 18:10)
Weekly limit: [██░░░░] 88% left (resets 14:00 on 02 May)
```
→ usage=`100-35=65`, weekly=`100-88=12`, reset=`18:10`

⚠️ Codex zeigt **"% left"**, nicht `% used`: von 100 subtrahieren.

### Step 6 — Sitzung SOFORT BEENDEN

```bash
tmux kill-session -t "$SESS"
```

⚠️ **IMMER beenden**, auch wenn das Parsen fehlschlaegt. Keine persistenten Sitzungen.

### Step 7 — Sample ins JSONL schreiben

```bash
python3 /app/shared/skills/usage_record.py --manual \
    --usage <X> --reset-at <HH:MM> --weekly <W> \
    --provider <claude|kimi|openai> --source sentinella-worker
```

### Step 8 — Weiter mit der Entscheidung

Du hast jetzt das frische Sample mit proj/status, berechnet von compute_metrics. Aktualisiere den Speicher (siehe Skill `memory-state`) und entscheide den Befehl an den Capitano (siehe Skill `order-formats`).

## Troubleshooting

### Leerer Pane / kein Modal
- CLI noch nicht bereit → warte weitere 8s und erfasse erneut.
- Trust-Dialog noch offen → sende `Enter` (NICHT `Escape`: bricht ab und wirft dich in die Bash).

### `Loading usage data…` endlos (Claude)
TUI blockiert. Kill+Respawn der Sitzung und erneut versuchen; wenn es bestehen bleibt, falle auf L3 (FATAL).

### `Unrecognized command` (codex)
Du hast `/usage` an Codex geschickt. Sende `/status` und fertig.

### CLI tot / Pane in Bash
Sitzung beenden und respawnen.
