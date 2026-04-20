---
name: tmux-send
description: Consegna un messaggio a un'altra sessione tmux (altro agente) in modo atomico. SEMPRE usala per comunicare con SCOUT/ANALISTA/SCORER/SCRITTORE/CRITICO/SENTINELLA. NON usare mai `tmux send-keys` a mano — le TUI Ink perdono l'Enter.
allowed-tools: Bash(jht-tmux-send *)
---

# tmux-send — messaggistica inter-agente

Wrapper shell in `/app/agents/_tools/jht-tmux-send` (anche `jht-tmux-send` nel PATH via symlink `/usr/local/bin`).

## Perché esiste

Le TUI Ink (Codex, Kimi Code) **non registrano l'Enter** se arriva nello stesso `tmux send-keys` del testo. Il testo viene inviato char-per-char, Ink deve finire il render prima di accettare un nuovo keystroke. Se mandi `tmux send-keys "msg" Enter`, il messaggio resta nell'input dell'altro agente senza essere submittato → deadlock inter-agente.

Il wrapper gestisce atomicamente: `testo → sleep 0.3 → Enter → sleep 0.5 → Enter` (secondo Enter idempotente per robustezza).

## Uso

```bash
jht-tmux-send <SESSIONE> "<messaggio>"
```

## Esempi

```bash
# Capitano → Scout
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [MSG] Inizia il loop principale. Parti dal CERCHIO 1 (Remote EU) e notifica dopo ogni batch di 3-5 posizioni."

# Capitano → Analista (ack batch)
jht-tmux-send ANALISTA-1 "[@capitano -> @analista-1] [ACK] Ricevuto batch IDs 1-3. Procedi con le prossime new."

# Scout → Capitano (report batch)
jht-tmux-send CAPITANO "[@scout-1 -> @capitano] [REPORT] Inserite IDs 1-3: Percona FS, Deep Infra SE, G2i AI. Link morti segnalati per ID 3."

# Scorer → Critico (handoff)
jht-tmux-send CRITICO "[@scorer -> @critico] [HANDOFF] App 42 pronta per review: gate 50 superato (score 78)."
```

## Protocollo di formato messaggio

Mantieni **SEMPRE** il prefisso strutturato:
```
[@<src> -> @<dest>] [<TIPO>] <testo>
```

Tipi standard:
- `[MSG]` comando operativo
- `[ACK]` conferma ricezione
- `[REPORT]` dati / risultati
- `[HANDOFF]` passaggio di consegna
- `[ALERT]` anomalia o blocco
- `[CHAT]` usato dal solo *utente → agente* (non inter-agente)

## Exit codes

- `0` — messaggio consegnato
- `1` — argomenti mancanti
- `2` — sessione target inesistente (controlla il nome con `tmux ls`)

## Regole

- **MAI** usare `tmux send-keys` direttamente per comunicare con altri agenti. Sempre `jht-tmux-send`.
- **MAI** killare sessioni tmux di altri agenti (regola #0 del Capitano).
- Se `tmux ls` mostra che la sessione di destinazione non esiste, NON crearla: chiedi al Capitano (o usa `start-agent.sh` se sei tu il Capitano).
