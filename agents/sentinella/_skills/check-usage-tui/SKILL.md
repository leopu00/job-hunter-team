---
name: check-usage-tui
description: Check provider usage via TUI worker (~30s, costs CLI tokens). FALLBACK when `check-usage-http` returns RATE_LIMIT or fails. Spawns an ephemeral tmux session, runs `/usage` (or `/status` for Codex), parses the modal, kills the session.
allowed-tools: Bash(tmux *), Bash(python3 *)
---

# Skill — Check usage via TUI worker (robusto, ~30s, costoso in token)

## QUANDO USARLA

**Solo come L2** dopo che L1 (HTTP) ha fallito. È robusta perché bypassa il rate-limit Anthropic (legge dal CLI locale), ma costa:
- ~30s di tempo (spawn worker + boot CLI + render modal)
- alcuni token Claude (apertura sessione + /usage)
- rischio di TUI in stato anomalo (Loading, scaduto, etc.)

Ordine di fallback: **HTTP → TUI → FATAL**.

## Workflow

### Step 1 — Provider attivo

```bash
python3 -c "import json; print(json.load(open('/jht_home/jht.config.json'))['active_provider'])"
```

### Step 2 — Spawn sessione tmux EFFIMERA

Nome unico col timestamp (no collisione):

```bash
SESS="SENTINELLA-WORKER-$(date +%s)"
tmux new-session -d -x 220 -y 50 -s "$SESS" -c /jht_home
tmux send-keys -t "$SESS" "export HOME='/jht_home'" C-m
tmux send-keys -t "$SESS" "export PATH='/app/agents/_tools:/jht_home/.npm-global/bin:\$PATH'" C-m
tmux send-keys -t "$SESS" "export KIMI_CLI_NO_AUTO_UPDATE=1" C-m
```

### Step 3 — Lancia il CLI provider

| Provider | Comando |
|---|---|
| `claude` / `anthropic` | `claude --dangerously-skip-permissions` |
| `kimi` / `moonshot` | `kimi --yolo` |
| `codex` / `openai` | `codex --yolo` |

```bash
tmux send-keys -t "$SESS" "<comando>" C-m
sleep 18   # boot + eventuale trust dialog auto-accept
```

### Step 4 — Slash command

| Provider | Slash command |
|---|---|
| `claude` / `anthropic` | `/usage` |
| `kimi` / `moonshot` | `/usage` |
| `codex` / `openai` | `/status` (NON `/usage`!) |

```bash
tmux send-keys -t "$SESS" "<slash>" Enter
sleep 4   # render modal
```

⚠️ **NIENTE Esc preventivo** prima del slash command: rompe Kimi (interpreta /usage come testo) e per gli altri è inutile in sessione fresh.

### Step 5 — Capture pane

```bash
tmux capture-pane -t "$SESS" -p -S -100
```

Leggi il pane coi **tuoi occhi LLM**, estrai `usage`, `reset`, `weekly`.

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
→ reset_at: ora_UTC + 3h 27m → calcola HH:MM UTC

#### Format Codex

```
5h limit:    [████░░] 35% left (resets 18:10)
Weekly limit: [██░░░░] 88% left (resets 14:00 on 02 May)
```
→ usage=`100-35=65`, weekly=`100-88=12`, reset=`18:10`

⚠️ Codex riporta **"% left"**, non `% used`: sottrai da 100.

### Step 6 — KILL sessione SUBITO

```bash
tmux kill-session -t "$SESS"
```

⚠️ **Killa SEMPRE** anche se il parse fallisce. Niente sessioni persistenti.

### Step 7 — Scrivi sample nel JSONL

```bash
python3 /app/shared/skills/usage_record.py --manual \
    --usage <X> --reset-at <HH:MM> --weekly <W> \
    --provider <claude|kimi|openai> --source sentinella-worker
```

### Step 8 — Procedi con la decisione

Hai ora il sample fresco con proj/status calcolati da compute_metrics. Aggiorna memoria (vedi skill `memory-state`) e decidi ordine al Capitano (vedi skill `order-formats`).

## Troubleshooting

### Pane vuoto / nessuna modal
- CLI non ancora ready → attendi altri 8s e ricaptura.
- Trust dialog ancora aperto → invia `Enter` (NON `Escape`: cancella e ti butta in bash).

### `Loading usage data…` infinito (Claude)
TUI bloccato. Kill+respawn la sessione e riprova; se persiste cadi su L3 (FATAL).

### `Unrecognized command` (codex)
Hai mandato `/usage` su codex. Manda `/status` e basta.

### CLI morto / pane in bash
Kill la sessione e respawna.
