<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: check-usage-tui
description: Verifie l'utilisation du fournisseur via TUI worker (~30s, consomme des tokens CLI). FALLBACK lorsque `check-usage-http` renvoie RATE_LIMIT ou echoue. Lance une session tmux ephemere, execute `/usage` (ou `/status` pour Codex), analyse la modale, termine la session.
allowed-tools: Bash(tmux *), Bash(python3 *)
---

# Skill — Verification de l'utilisation via TUI worker (robuste, ~30s, couteux en tokens)

## QUAND L'UTILISER

**Uniquement en L2** apres l'echec de L1 (HTTP). Elle est robuste car elle contourne le rate-limit Anthropic (lecture depuis le CLI local), mais elle coute :
- ~30s de temps (spawn worker + boot CLI + render modal)
- quelques tokens Claude (ouverture de session + /usage)
- risque de TUI en etat anormal (Loading, expire, etc.)

Ordre de fallback : **HTTP → TUI → FATAL**.

## Workflow

### Step 1 — Fournisseur actif

```bash
python3 -c "import json; print(json.load(open('/jht_home/jht.config.json'))['active_provider'])"
```

### Step 2 — Spawn de session tmux EPHEMERE

Nom unique avec timestamp (pas de collision) :

```bash
SESS="SENTINELLA-WORKER-$(date +%s)"
tmux new-session -d -x 220 -y 50 -s "$SESS" -c /jht_home
tmux send-keys -t "$SESS" "export HOME='/jht_home'" C-m
tmux send-keys -t "$SESS" "export PATH='/app/agents/_tools:/jht_home/.npm-global/bin:\$PATH'" C-m
tmux send-keys -t "$SESS" "export KIMI_CLI_NO_AUTO_UPDATE=1" C-m
```

### Step 3 — Lancer le CLI du fournisseur

| Provider | Comando |
|---|---|
| `claude` / `anthropic` | `claude --dangerously-skip-permissions` |
| `kimi` / `moonshot` | `kimi --yolo` |
| `codex` / `openai` | `codex --yolo` |

```bash
tmux send-keys -t "$SESS" "<comando>" C-m
sleep 18   # boot + eventuel trust dialog auto-accept
```

### Step 4 — Slash command

| Provider | Slash command |
|---|---|
| `claude` / `anthropic` | `/usage` |
| `kimi` / `moonshot` | `/usage` |
| `codex` / `openai` | `/status` (PAS `/usage` !) |

```bash
tmux send-keys -t "$SESS" "<slash>" Enter
sleep 4   # render modal
```

⚠️ **PAS d'Esc preventif** avant le slash command : casse Kimi (interprete /usage comme du texte) et pour les autres c'est inutile en session fraiche.

### Step 5 — Capture pane

```bash
tmux capture-pane -t "$SESS" -p -S -100
```

Lis le pane avec **tes yeux LLM**, extrais `usage`, `reset`, `weekly`.

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
→ reset_at: heure_UTC + 3h 27m → calcule HH:MM UTC

#### Format Codex

```
5h limit:    [████░░] 35% left (resets 18:10)
Weekly limit: [██░░░░] 88% left (resets 14:00 on 02 May)
```
→ usage=`100-35=65`, weekly=`100-88=12`, reset=`18:10`

⚠️ Codex affiche **"% left"**, pas `% used` : soustrais de 100.

### Step 6 — KILL session IMMEDIATEMENT

```bash
tmux kill-session -t "$SESS"
```

⚠️ **Termine TOUJOURS** meme si le parse echoue. Aucune session persistante.

### Step 7 — Ecris le sample dans le JSONL

```bash
python3 /app/shared/skills/usage_record.py --manual \
    --usage <X> --reset-at <HH:MM> --weekly <W> \
    --provider <claude|kimi|openai> --source sentinella-worker
```

### Step 8 — Continue avec la decision

Tu as maintenant le sample frais avec proj/status calcules par compute_metrics. Mets a jour la memoire (voir skill `memory-state`) et decide l'ordre au Capitano (voir skill `order-formats`).

## Troubleshooting

### Pane vide / pas de modal
- CLI pas encore pret → attends 8s de plus et recapture.
- Trust dialog encore ouvert → envoie `Enter` (PAS `Escape` : annule et te renvoie en bash).

### `Loading usage data…` infini (Claude)
TUI bloque. Kill+respawn de la session et reessaie ; si ca persiste, tombe en L3 (FATAL).

### `Unrecognized command` (codex)
Tu as envoye `/usage` sur codex. Envoie `/status` tout simplement.

### CLI mort / pane en bash
Termine la session et respawn.
