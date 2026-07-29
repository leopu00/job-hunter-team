<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: tmux-send
description: Consegna un messaggio alla sessione tmux di un altro agente in modo atomico. Usa SEMPRE questo skill per comunicare con SCOUT/ANALISTA/SCORER/SCRITTORE/CRITICO/SENTINELLA/CAPITANO. NON chiamare MAI `tmux send-keys` a mano — le TUI basate su Ink (Codex, Kimi) perdono il carattere Enter.
allowed-tools: Bash(jht-tmux-send *)
---

# tmux-send — messaggistica inter-agente

Wrapper shell situato in `/app/agents/_skills/tmux-send/jht-tmux-send` (anche nel `PATH` tramite symlink in `/usr/local/bin`, creato durante la build dell'immagine).

## Perché esiste

Le TUI basate su Ink (Codex, Kimi Code) **perdono l'Enter** se arriva nella stessa chiamata `tmux send-keys` insieme al corpo del messaggio. Il testo viene inviato carattere per carattere; Ink deve completare il rendering prima di accettare un'altra pressione di tasto. Se chiami `tmux send-keys "msg" Enter`, il messaggio resta nel buffer di input del peer senza essere inviato → deadlock silenzioso tra agenti.

Il wrapper gestisce tutto atomicamente: `text → sleep 0.3 → Enter → sleep 0.5 → Enter` (il secondo Enter è idempotente per robustezza).

## Utilizzo

```bash
jht-tmux-send <SESSION> "<message>"
```

## Esempi (V5)

```bash
# Captain → Scout (INFO, messaggio operativo generico)
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [INFO] Start the main loop. Begin from CIRCLE 1 (Remote EU); ping after each batch of 3-5 positions."

# Captain → Writer (URG, ordine in tempo reale)
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [URG] FREEZE — finish the current Critic round, then sleep until throttle returns to T0/T1."

# Analyst → Scout (FEEDBACK, coaching su pattern di rifiuto)
jht-tmux-send SCOUT-2 "[@analista-1 -> @scout-2] [FEEDBACK] [SENIORITY] 4 of last 5 inserts from greenhouse.io require senior+ — switch source or query for the next batch."

# Sentinel → Captain (URG, cambio di stato)
jht-tmux-send CAPITANO "[@sentinella -> @capitano] [URG] Usage 94%, projection 102% — recommend throttle T2 + freeze Writers."

# Writer → Captain (REPORT, risultato finale)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [REPORT] Position 42 — verdict PASS, score 7.5/10. PDF: /jht_user/.../CV.pdf"

# Worker → Captain (ACK, conferma di un URG)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [ACK] freeze applied, sleeping."
```

## Busta del messaggio

Mantieni sempre il prefisso strutturato:

```
[@<from> -> @<to>] [<TYPE>] <text>
```

Tipi standard (vedi `agents/_manual/communication-rules.md` per la tassonomia completa e le aspettative per ruolo):

- `BLOCKED` — worker → Capitano: hai **SMESSO di produrre** e non lascia traccia nel DB (tool rotto, `403`/`LOCKED`, fonti secche, un elemento che non riesci né a lavorare né a saltare). Dal 2026-07-27 è l'UNICA cosa che distingue uno stallo dal lavoro silenzioso
- `URG` — ordine in tempo reale che richiede azione immediata (FREEZE, throttle, kill)
- `FEEDBACK` — coaching verso l'agente a monte con un tag di rifiuto (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`)
- `REQ` / `RES` — richiesta/risposta sincrona tra agenti
- `ACK` — conferma di ricezione di un `URG` o `REQ` che non puoi ancora gestire
- ~~`INFO` / `REPORT`~~ — **ritirati per il traffico fra colleghi** (2026-07-27): erano 8 dei 30 messaggi di puro stato che svegliavano il Capitano in ~1,5h. L'avanzamento si tira giù da `db_query.py recent-activity`, non si racconta

> 💬 `[CHAT]` è riservato ai messaggi **utente → agente** dalla web UI (vedi il protocollo nel prompt del Capitano). Non usarlo per il traffico inter-agente.

## Codici di uscita

- `0` — messaggio consegnato
- `1` — argomenti mancanti
- `2` — la sessione di destinazione non esiste (verifica il nome con `tmux ls`)

## Regole

- **MAI** usare `tmux send-keys` direttamente per comunicare con un altro agente. Passa sempre da `jht-tmux-send`.
- **MAI** terminare la sessione tmux di un altro agente (regola #0 del Capitano).
- Se `tmux ls` mostra che la sessione di destinazione non esiste, **non crearla** — chiedi al Capitano (o usa `start-agent.sh` se *sei* il Capitano).
- Di default usa il **coordinamento via DB** per i passaggi di pipeline (Scout→Analyst→Scorer→Writer); usa questo skill solo per i segnali in tempo reale elencati sopra. Vedi `agents/_manual/communication-rules.md`.
