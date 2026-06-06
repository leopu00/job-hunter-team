<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: check-usage-tui
description: Ellenorzi a provider hasznalatat TUI workeren keresztul (~30s, CLI tokeneket fogyaszt). FALLBACK amikor a `check-usage-http` RATE_LIMIT-et ad vissza vagy meghiusul. Indit egy rovid eletu tmux munkamenetet, futtatja a `/usage`-t (vagy `/status`-t Codex eseten), elemzi a modalt, leallitja a munkamenetet.
allowed-tools: Bash(tmux *), Bash(python3 *)
---

# Skill — Hasznalat ellenorzese TUI workeren keresztul (robust, ~30s, token-koltsegos)

## MIKOR HASZNALD

**Csak L2-kent** miutan L1 (HTTP) meghiusult. Robust, mert megkerueli az Anthropic rate-limitet (helyi CLI-bol olvas), de koltsege van:
- ~30s ido (worker spawn + CLI boot + modal rendereles)
- nehany Claude token (munkamenet megnyitasa + /usage)
- kockazata annak, hogy a TUI rendellenes allapotban van (Loading, lejart, stb.)

Fallback sorrend: **HTTP → TUI → FATAL**.

## Workflow

### Step 1 — Aktiv provider

```bash
python3 -c "import json; print(json.load(open('/jht_home/jht.config.json'))['active_provider'])"
```

### Step 2 — ROVID ELETU tmux munkamenet inditasa

Egyedi nev idopecsattal (nincs utkozes):

```bash
SESS="SENTINELLA-WORKER-$(date +%s)"
tmux new-session -d -x 220 -y 50 -s "$SESS" -c /jht_home
tmux send-keys -t "$SESS" "export HOME='/jht_home'" C-m
tmux send-keys -t "$SESS" "export PATH='/app/agents/_tools:/jht_home/.npm-global/bin:\$PATH'" C-m
tmux send-keys -t "$SESS" "export KIMI_CLI_NO_AUTO_UPDATE=1" C-m
```

### Step 3 — Provider CLI inditasa

| Provider | Comando |
|---|---|
| `claude` / `anthropic` | `claude --dangerously-skip-permissions` |
| `kimi` / `moonshot` | `kimi --yolo` |
| `codex` / `openai` | `codex --yolo` |

```bash
tmux send-keys -t "$SESS" "<comando>" C-m
sleep 18   # boot + esetleges trust dialog auto-accept
```

### Step 4 — Slash command

| Provider | Slash command |
|---|---|
| `claude` / `anthropic` | `/usage` |
| `kimi` / `moonshot` | `/usage` |
| `codex` / `openai` | `/status` (NEM `/usage`!) |

```bash
tmux send-keys -t "$SESS" "<slash>" Enter
sleep 4   # modal renderelese
```

⚠️ **NINCS megelozo Esc** a slash command elott: elrontja a Kimi-t (szovegkent ertelmezi a /usage-t), a tobbieknel pedig felesleges friss munkamenetben.

### Step 5 — Capture pane

```bash
tmux capture-pane -t "$SESS" -p -S -100
```

Olvasd el a pane-t az **LLM szemeddel**, nyerd ki a `usage`, `reset`, `weekly` ertekeket.

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
→ reset_at: aktualis_UTC + 3h 27m → szamold ki HH:MM UTC-ben

#### Format Codex

```
5h limit:    [████░░] 35% left (resets 18:10)
Weekly limit: [██░░░░] 88% left (resets 14:00 on 02 May)
```
→ usage=`100-35=65`, weekly=`100-88=12`, reset=`18:10`

⚠️ A Codex **"% left"**-et jelent, nem `% used`-et: vond ki 100-bol.

### Step 6 — Munkamenet AZONNALI LEALLITASA

```bash
tmux kill-session -t "$SESS"
```

⚠️ **MINDIG allitsd le**, meg ha a parse sikertelen is. Semmi persistens munkamenet.

### Step 7 — Sample irasa a JSONL-be

```bash
python3 /app/shared/skills/usage_record.py --manual \
    --usage <X> --reset-at <HH:MM> --weekly <W> \
    --provider <claude|kimi|openai> --source sentinella-worker
```

### Step 8 — Folytasd a dontessel

Most mar megvan a friss sample a compute_metrics altal szamitott proj/status ertekekkel. Frissitsd a memoriat (lasd skill `memory-state`) es dontsd el a parancsot a Capitano szamara (lasd skill `order-formats`).

## Troubleshooting

### Ures pane / nincs modal
- A CLI meg nem kesz → varj meg 8s-ot es rogzitsd ujra.
- Trust dialog meg nyitva → kuld `Enter`-t (NEM `Escape`-et: megszakitja es bash-be dob).

### `Loading usage data…` vegtelen (Claude)
TUI blokkolt. Kill+respawn a munkamenetnek es probald ujra; ha fennall, esj vissza L3-ra (FATAL).

### `Unrecognized command` (codex)
`/usage`-t kuldtel codex-nek. Kuld `/status`-t es kesz.

### CLI halott / pane bash-ben
Allitsd le a munkamenetet es spawn-old ujra.
