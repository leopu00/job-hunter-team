<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: check-usage-tui
description: Comprueba el uso del proveedor mediante TUI worker (~30s, consume tokens CLI). FALLBACK cuando `check-usage-http` devuelve RATE_LIMIT o falla. Crea una sesion tmux efimera, ejecuta `/usage` (o `/status` para Codex), analiza el modal, cierra la sesion.
allowed-tools: Bash(tmux *), Bash(python3 *)
---

# Skill — Comprobar uso via TUI worker (robusto, ~30s, costoso en tokens)

## CUANDO USARLA

**Solo como L2** despues de que L1 (HTTP) haya fallado. Es robusta porque evita el rate-limit de Anthropic (lee desde el CLI local), pero tiene coste:
- ~30s de tiempo (spawn worker + boot CLI + render modal)
- algunos tokens Claude (apertura de sesion + /usage)
- riesgo de TUI en estado anomalo (Loading, expirado, etc.)

Orden de fallback: **HTTP → TUI → FATAL**.

## Workflow

### Step 1 — Proveedor activo

```bash
python3 -c "import json; print(json.load(open('/jht_home/jht.config.json'))['active_provider'])"
```

### Step 2 — Spawn de sesion tmux EFIMERA

Nombre unico con timestamp (sin colision):

```bash
SESS="SENTINELLA-WORKER-$(date +%s)"
tmux new-session -d -x 220 -y 50 -s "$SESS" -c /jht_home
tmux send-keys -t "$SESS" "export HOME='/jht_home'" C-m
tmux send-keys -t "$SESS" "export PATH='/app/agents/_tools:/jht_home/.npm-global/bin:\$PATH'" C-m
tmux send-keys -t "$SESS" "export KIMI_CLI_NO_AUTO_UPDATE=1" C-m
```

### Step 3 — Lanza el CLI del proveedor

| Provider | Comando |
|---|---|
| `claude` / `anthropic` | `claude --dangerously-skip-permissions` |
| `kimi` / `moonshot` | `kimi --yolo` |
| `codex` / `openai` | `codex --yolo` |

```bash
tmux send-keys -t "$SESS" "<comando>" C-m
sleep 18   # boot + posible trust dialog auto-accept
```

### Step 4 — Slash command

| Provider | Slash command |
|---|---|
| `claude` / `anthropic` | `/usage` |
| `kimi` / `moonshot` | `/usage` |
| `codex` / `openai` | `/status` (NO `/usage`!) |

```bash
tmux send-keys -t "$SESS" "<slash>" Enter
sleep 4   # render modal
```

⚠️ **NINGUN Esc preventivo** antes del slash command: rompe Kimi (interpreta /usage como texto) y para los demas es inutil en sesion nueva.

### Step 5 — Capture pane

```bash
tmux capture-pane -t "$SESS" -p -S -100
```

Lee el pane con **tus ojos LLM**, extrae `usage`, `reset`, `weekly`.

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
→ reset_at: hora_UTC + 3h 27m → calcula HH:MM UTC

#### Format Codex

```
5h limit:    [████░░] 35% left (resets 18:10)
Weekly limit: [██░░░░] 88% left (resets 14:00 on 02 May)
```
→ usage=`100-35=65`, weekly=`100-88=12`, reset=`18:10`

⚠️ Codex reporta **"% left"**, no `% used`: resta de 100.

### Step 6 — KILL sesion INMEDIATAMENTE

```bash
tmux kill-session -t "$SESS"
```

⚠️ **Cierra SIEMPRE** aunque el parse falle. Nada de sesiones persistentes.

### Step 7 — Escribe sample en el JSONL

```bash
python3 /app/shared/skills/usage_record.py --manual \
    --usage <X> --reset-at <HH:MM> --weekly <W> \
    --provider <claude|kimi|openai> --source sentinella-worker
```

### Step 8 — Procede con la decision

Ahora tienes el sample fresco con proj/status calculados por compute_metrics. Actualiza memoria (ver skill `memory-state`) y decide la orden al Capitano (ver skill `order-formats`).

## Troubleshooting

### Pane vacio / sin modal
- CLI aun no listo → espera otros 8s y recaptura.
- Trust dialog aun abierto → envia `Enter` (NO `Escape`: cancela y te lleva a bash).

### `Loading usage data…` infinito (Claude)
TUI bloqueado. Kill+respawn de la sesion y reintenta; si persiste cae a L3 (FATAL).

### `Unrecognized command` (codex)
Enviaste `/usage` en codex. Envia `/status` y ya.

### CLI muerto / pane en bash
Cierra la sesion y respawnea.
