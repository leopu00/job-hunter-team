# Skill — Check usage via TUI worker (manuale, ultimo fallback)

## QUANDO USARLA

**Solo come L3** dopo che sono falliti, nell'ordine:
1. `rate_budget.py live` (fetch HTTP/JSONL diretto)
2. `check_usage.py` (script multi-provider con worker auto)

Se entrambi sopra sono andati ko, sei tu LLM a guidare l'estrazione: spawni il worker tmux, digiti il comando giusto per il provider attivo, leggi il pane, parsi a occhio il numero, lo scrivi nel JSONL.

**Niente Python qui** — solo `tmux` e `usage_record.py --manual` per la scrittura finale.

---

## TABELLA PROVIDER → COMANDO TUI

| Provider attivo | Comando da digitare | Cosa cercare nel pane |
|---|---|---|
| `claude` / `anthropic` | `/usage` | `XX% used` (la riga senza tag "all models" / "only" è la sessione 5h) |
| `openai` / `codex` | `/status` ⚠️ **SOLO**, NON `/usage` | `5h limit: [bars] XX% left (resets HH:MM)` + `Weekly limit: … XX% left` |
| `kimi` / `moonshot` | `/usage` (alias `/status`) | progress bars + `XX%` remaining sulla finestra 5h |

### ⚠️ Trappola Codex

Il CLI codex risponde `Unrecognized command '/usage'`. Se ne mandi due consecutivi, il secondo entra come testo nel prompt del primo → `/status/usage` non eseguibile.

**Regola**: prima leggi `~/.jht/jht.config.json` campo `active_provider`, POI digiti il comando giusto. Mai due tentativi.

### ⚠️ XX% used vs XX% left (codex)

- claude/kimi: `XX% used` → usage = XX
- codex: `XX% left` → **usage = 100 - XX**

Esempio codex: `5h limit: [████░░░] 35% left` → usage = 65%.

---

## STEP-BY-STEP

### 1. Verifica provider attivo

```bash
python3 -c "import json; print(json.load(open('/jht_home/jht.config.json'))['active_provider'])"
```

(o `~/.jht/jht.config.json` se fuori container).

### 2. Verifica/spawna SENTINELLA-WORKER

```bash
tmux has-session -t SENTINELLA-WORKER 2>/dev/null && echo "ALIVE" || echo "DEAD"
```

Se DEAD:

```bash
bash /app/.launcher/start-agent.sh worker
```

Attendi **18s** che il CLI booti (boot + eventuale trust dialog).

### 3. Manda il comando giusto

In base al provider:

```bash
# claude:
tmux send-keys -t SENTINELLA-WORKER "/usage" Enter

# codex (openai):
tmux send-keys -t SENTINELLA-WORKER "/status" Enter

# kimi:
tmux send-keys -t SENTINELLA-WORKER "/usage" Enter
```

Attendi **4s** che la modal/output renderizzi.

### 4. Cattura il pane

```bash
tmux capture-pane -t SENTINELLA-WORKER -p -S -300
```

### 5. Leggi a occhio il numero

#### Claude — pattern atteso

```
Resets 6:10pm (UTC)                                42% used
Resets 7pm (UTC) (all models)                      12% used
```

→ usage = `42`, reset = `18:10` UTC. Ignora le righe con `(all models)` / `(... only)`: sono limiti diversi, non la finestra 5h.

#### Codex — pattern atteso

```
5h limit:    [████████░░░░░░░░] 35% left (resets 18:10)
Weekly limit: [██░░░░░░░░░░░░░░] 88% left (resets 14:00 on 02 May)
```

→ usage = `100 - 35 = 65`, reset = `18:10` (UTC, default codex), weekly_usage = `100 - 88 = 12`.

#### Kimi — pattern atteso

```
5-hour usage:  [██████░░░░] 40% used   resets 18:10 UTC
Weekly usage:  [██░░░░░░░░] 18% used   resets 02 May
```

→ usage = `40`, reset = `18:10`, weekly = `18`.

Se il pattern non corrisponde (es. CLI in stato errore, schermata diversa): vedi sezione TROUBLESHOOTING.

### 6. Scrivi sample nel JSONL

```bash
python3 /app/shared/skills/usage_record.py --manual \
  --usage <NUM> \
  --reset-at <HH:MM> \
  --provider <claude|openai|kimi> \
  --weekly <NUM_O_OMITTI> \
  --source sentinella-worker
```

Esempi reali:

```bash
# claude 42% reset 18:10
python3 /app/shared/skills/usage_record.py --manual \
  --usage 42 --reset-at 18:10 --provider claude --source sentinella-worker

# codex 65% (era 35% left) reset 18:10 weekly 12%
python3 /app/shared/skills/usage_record.py --manual \
  --usage 65 --reset-at 18:10 --provider openai --weekly 12 --source sentinella-worker

# kimi 40% reset 18:10 weekly 18
python3 /app/shared/skills/usage_record.py --manual \
  --usage 40 --reset-at 18:10 --provider kimi --weekly 18 --source sentinella-worker
```

Lo script calcola velocità/proiezione/status via `compute_metrics`, scrive nel JSONL con `source=sentinella-worker`, stampa il sample.

### 7. Procedi con la decisione throttle

Ora hai un sample fresco. Applica la solita tabella throttle del prompt principale e manda l'ordine al CAPITANO.

---

## TROUBLESHOOTING

### Pane vuoto / nessuna modal

- CLI non ancora ready → attendi altri 8s e ricaptura.
- Trust dialog ancora aperto → `tmux send-keys -t SENTINELLA-WORKER Enter` (NON `Escape`: cancella e ti butta in bash).

### `Unrecognized command` (codex)

Hai mandato `/usage` su codex. Manda `/status` (e basta).

### `command-not-found` o pane in bash

Il CLI è morto. Killa la sessione e respawna:

```bash
tmux kill-session -t SENTINELLA-WORKER
bash /app/.launcher/start-agent.sh worker
sleep 18
```

### Modal aperta sopra il prompt (claude)

Dopo aver letto i numeri, chiudi la modal con `Escape` **una sola volta** prima del prossimo check, altrimenti il pane resta sporco e il parse successivo confonde le letture.

```bash
tmux send-keys -t SENTINELLA-WORKER Escape
```

### Provider sconosciuto

Se `active_provider` non è uno tra `claude/anthropic/openai/codex/kimi/moonshot`: NON tirare a indovinare. Segnala FATAL al Capitano:

```
[SENTINELLA] [FATAL] provider attivo '<X>' senza strategia TUI documentata. Aggiungere branch a check_usage_tui.md.
```

---

## BUDGET TEMPORALE

Il flusso L3 completo (spawn worker → 18s boot → comando → 4s render → capture → parse → record) prende **~25-30s**. È accettabile come ultima spiaggia ma non come modalità normale: se il bridge resta in failure per più tick consecutivi, segnala al Capitano e investigate la causa upstream (rete container, credenziali scadute, file rollout corrotto) invece di restare in L3 perpetuo.
