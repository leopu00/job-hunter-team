<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: check-usage-tui
description: Verifica o uso do provedor via TUI worker (~30s, consome tokens CLI). FALLBACK quando `check-usage-http` retorna RATE_LIMIT ou falha. Cria uma sessao tmux efemera, executa `/usage` (ou `/status` para Codex), analisa o modal, encerra a sessao.
allowed-tools: Bash(tmux *), Bash(python3 *)
---

# Skill — Verificar uso via TUI worker (robusto, ~30s, custoso em tokens)

## QUANDO USAR

**Apenas como L2** apos L1 (HTTP) ter falhado. E robusta porque contorna o rate-limit da Anthropic (le do CLI local), mas tem custo:
- ~30s de tempo (spawn worker + boot CLI + render modal)
- alguns tokens Claude (abertura de sessao + /usage)
- risco de TUI em estado anomalo (Loading, expirado, etc.)

Ordem de fallback: **HTTP → TUI → FATAL**.

## Workflow

### Step 1 — Provedor ativo

```bash
python3 -c "import json; print(json.load(open('/jht_home/jht.config.json'))['active_provider'])"
```

### Step 2 — Spawn de sessao tmux EFEMERA

Nome unico com timestamp (sem colisao):

```bash
SESS="SENTINELLA-WORKER-$(date +%s)"
tmux new-session -d -x 220 -y 50 -s "$SESS" -c /jht_home
tmux send-keys -t "$SESS" "export HOME='/jht_home'" C-m
tmux send-keys -t "$SESS" "export PATH='/app/agents/_tools:/jht_home/.npm-global/bin:\$PATH'" C-m
tmux send-keys -t "$SESS" "export KIMI_CLI_NO_AUTO_UPDATE=1" C-m
```

### Step 3 — Iniciar o CLI do provedor

| Provider | Comando |
|---|---|
| `claude` / `anthropic` | `claude --dangerously-skip-permissions` |
| `kimi` / `moonshot` | `kimi --yolo` |
| `codex` / `openai` | `codex --yolo` |

```bash
tmux send-keys -t "$SESS" "<comando>" C-m
sleep 18   # boot + eventual trust dialog auto-accept
```

### Step 4 — Slash command

| Provider | Slash command |
|---|---|
| `claude` / `anthropic` | `/usage` |
| `kimi` / `moonshot` | `/usage` |
| `codex` / `openai` | `/status` (NAO `/usage`!) |

```bash
tmux send-keys -t "$SESS" "<slash>" Enter
sleep 4   # render modal
```

⚠️ **NENHUM Esc preventivo** antes do slash command: quebra o Kimi (interpreta /usage como texto) e para os outros e inutil em sessao nova.

### Step 5 — Capture pane

```bash
tmux capture-pane -t "$SESS" -p -S -100
```

Le o pane com **seus olhos LLM**, extraia `usage`, `reset`, `weekly`.

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
→ reset_at: hora_UTC + 3h 27m → calcule HH:MM UTC

#### Format Codex

```
5h limit:    [████░░] 35% left (resets 18:10)
Weekly limit: [██░░░░] 88% left (resets 14:00 on 02 May)
```
→ usage=`100-35=65`, weekly=`100-88=12`, reset=`18:10`

⚠️ Codex mostra **"% left"**, nao `% used`: subtraia de 100.

### Step 6 — KILL sessao IMEDIATAMENTE

```bash
tmux kill-session -t "$SESS"
```

⚠️ **Encerre SEMPRE** mesmo se o parse falhar. Nada de sessoes persistentes.

### Step 7 — Escreva o sample no JSONL

```bash
python3 /app/shared/skills/usage_record.py --manual \
    --usage <X> --reset-at <HH:MM> --weekly <W> \
    --provider <claude|kimi|openai> --source sentinella-worker
```

### Step 8 — Prossiga com a decisao

Agora voce tem o sample fresco com proj/status calculados pelo compute_metrics. Atualize a memoria (veja skill `memory-state`) e decida a ordem ao Capitano (veja skill `order-formats`).

## Troubleshooting

### Pane vazio / nenhum modal
- CLI ainda nao pronto → aguarde mais 8s e recapture.
- Trust dialog ainda aberto → envie `Enter` (NAO `Escape`: cancela e te joga no bash).

### `Loading usage data…` infinito (Claude)
TUI travado. Kill+respawn da sessao e tente novamente; se persistir, caia para L3 (FATAL).

### `Unrecognized command` (codex)
Voce enviou `/usage` no codex. Envie `/status` e pronto.

### CLI morto / pane no bash
Encerre a sessao e faca respawn.
