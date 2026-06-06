<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: py-tools-audit
description: "Pulizia coordinata e a livello di team dei pacchetti Python installati sotto `$JHT_HOME/.local` tramite `uv pip install --user` (T13 magazzino). Gestita dal Dottore. L'audit NON è unilaterale — solo gli agenti Writer / Critic sanno se una libreria importata dinamicamente è ancora necessaria, perciò il flusso è broadcast → finestra di consenso di 1h → disinstallare il set silenzioso → ri-audit. Poiché il Dottore è one-shot (~10 min per round, ~30 min di distanza), la finestra di consenso di 1h copre 2 round del Dottore: il round N avvia l'audit + broadcast, il round N+1 raccoglie le risposte + disinstalla."
allowed-tools: Bash(python3 /app/shared/skills/py_tools_audit.py *), Bash(uv pip uninstall *), Bash(jht-tmux-send *), Bash(tmux *), Bash(du *), Bash(xargs *)
---

# py-tools-audit — pulizia del magazzino Python condiviso

`$JHT_HOME/.local/lib/python3.x/site-packages/` è la **singola user-base condivisa** da cui leggono tutti gli agenti (T13). Qualsiasi agente può fare `uv pip install --user <pkg>` quando ha bisogno di una libreria, ma gli agenti *non* disinstallano quando cambiano approccio — i pacchetti si accumulano. Circa settimanalmente il magazzino supera gli 800 MB e richiede un audit coordinato.

L'audit è coordinato perché un `import` grep statico può mancare librerie caricate dinamicamente a runtime (es. uno script in `tools/` che il Writer chiama solo quando una JD richiede un formato specifico). Quindi: chiedere prima di rimuovere.

## Trigger

- ⏰ ~settimanale (ogni 7 giorni di esecuzione continua), all'inizio di un giorno operativo tranquillo
- 📈 on-demand quando `du -sh /jht_home/.local` > 800 MB
- 🚀 prima di una release importante / consegna all'utente

## Flusso a due round (perché il Dottore è one-shot)

```
Round N:    audit → broadcast dei candidati → salvataggio file di stato
…30 min…
Round N+1:  raccolta risposte → calcolo keep_set → disinstallazione → ri-audit → report
```

Ogni round registra la sua fase in `$JHT_HOME/logs/py-audit-state.json`:

```json
{"phase": "broadcast_sent", "round_id": "...", "ts": "ISO-UTC",
 "candidates": ["pymupdf", "pdfminer.six", "reportlab", "..."],
 "broadcast_at": "ISO-UTC"}
```

Quando ti svegli, **controlla questo file per primo**:
- file mancante o `phase=done` → round nuovo, vai a "Round N" sotto
- `phase=broadcast_sent` e `now - broadcast_at >= 1h` → "Round N+1" sotto
- `phase=broadcast_sent` e `now - broadcast_at < 1h` → la finestra di consenso non è ancora chiusa, salta l'audit in questo round

## Round N — avvia l'audit

### 1. Controllo soglia

```bash
python3 /app/shared/skills/py_tools_audit.py --threshold-mb 800
```

- Exit `0` → niente di urgente. Fermati qui, non fare il broadcast.
- Exit `2` → vale la pena pulire. Lo script stampa anche la *tabella dei candidati* — pacchetti senza import attivo, esclusa la whitelist (dipendenze transitive + CLI binarie pinnate).

### 2. Broadcast a ogni agente

Invia un messaggio `[PY-AUDIT]` a ogni sessione agente attiva tramite `jht-tmux-send`:

```
[@dottore -> @<role>] [PY-AUDIT] candidates uninstall: pymupdf,
pdfminer_six, reportlab, weasyprint, pypdf, ...
If you USE one of these, reply within 1h with [KEEP <pkg>].
Silence = consent to uninstall.
```

La finestra di 1h è imposta dall'**inizio del round successivo**, non da un `sleep` in questo round (il Dottore è one-shot). Persisti l'orario del broadcast in `py-audit-state.json`.

### 3. Persisti lo stato ed esci dal round

```json
{"phase": "broadcast_sent", "round_id": "...",
 "candidates": ["..."], "broadcast_at": "ISO-UTC"}
```

Fine del Round N. Auto-distruzione come al solito; il prossimo Dottore (~30 min dopo) riprenderà da qui.

## Round N+1 — raccogli, disinstalla, riporta

Si attiva quando `py-audit-state.json` mostra `phase=broadcast_sent` ed è passata ≥1h.

### 1. Raccogli le risposte

Per ogni agente a cui è stato fatto il broadcast, esegui `tmux capture-pane -t <SESSION> -p -S -200 | grep '\[KEEP '` per trovare eventuali risposte `[KEEP <pkg>]`. Costruisci il `keep_set`:

```
keep_set = (whitelist predefinita) ∪ (ogni <pkg> in qualsiasi risposta [KEEP])
```

Silenzio su un candidato = consenso alla disinstallazione.

### 2. Disinstalla il set silenzioso

```bash
python3 /app/shared/skills/py_tools_audit.py --candidates-only --keep <keep_set...> \
  | xargs -r uv pip uninstall --user -y
```

`xargs -r` salta la chiamata quando non c'è nulla da disinstallare (stdin vuoto).

### 3. Ri-audit + report

```bash
python3 /app/shared/skills/py_tools_audit.py
du -sh /jht_home/.local
```

Calcola `freed_mb = before - after` e notifica l'utente tramite il Capitano:

```bash
jht-tmux-send CAPITANO "[@dottore -> @capitano] [REPORT] py-audit done: <N> packages removed, <freed_mb> MB freed. Magazzino now <after_mb> MB."
```

### 4. Resetta lo stato

```json
{"phase": "done", "round_id": "...", "completed_at": "ISO-UTC",
 "removed": ["..."], "freed_mb": 142}
```

Un `py-audit-state.json` pulito con `phase=done` permette al prossimo round di ripartire da zero.

## Regole ferree

- **Mai disinstallare senza il broadcast + finestra di 1h.** Alcuni pacchetti sono caricati dinamicamente e non emergono in un grep statico — il broadcast è l'unico modo per intercettarli.
- **Mai toccare `ALWAYS_KEEP`.** Le note transitive (numpy, pillow, packaging, ecc.) sono lì per buone ragioni; lo script di audit le esclude già.
- **Se un Writer protesta dopo una disinstallazione**, reinstalla immediatamente e aggiungi il pacchetto a `ALWAYS_KEEP`. Trattalo come un bug di processo (il broadcast non ha raggiunto l'agente), non come colpa del Writer.
- **Mai sudo-uninstall.** Resta dentro `uv pip uninstall --user`. T13 vieta `sudo pip` per la stessa ragione per cui vieta `sudo pip install`.

## Anti-pattern

- ❌ Eseguire entrambi i round in un singolo risveglio del Dottore con `sleep 3600` — supera il budget di 10 min per round e rompe la cadenza del watchdog.
- ❌ Dedurre il keep set dal proprio `import` grep senza fare il broadcast — fallimenti silenti su caricamenti dinamici.
- ❌ Disinstallare pacchetti > 100 in un singolo round — troppo rumoroso, difficile da ripristinare. Limita al batch naturale dell'audit (quello che restituisce lo script di soglia).
- ❌ Eseguire questa skill in reazione a un `[ORDINE]` del Sentinel — gli ordini richiedono pacing/scaling, non manutenzione. py-audit attende una finestra di inattività.

## Vedi anche

- `cache-prune` — skill di manutenzione sorella (uv wheel cache, ~24h di cadenza). Eseguila per prima; a volte riduce la dimensione del magazzino sotto gli 800 MB e rende l'audit non necessario.
- `agents/_team/team-rules.md` T13 — regola di installazione (`uv pip install --user`) che giustifica questo audit.
- `agents/dottore/dottore.md` — ciclo di vita del Dottore; questa skill si estende su 2 round del ciclo di vita tramite il file di stato.
