---
name: tmux-send
description: Consegna un messaggio alla sessione tmux di un altro agente in modo atomico. Usa SEMPRE questo skill per comunicare con SCOUT/ANALISTA/SCORER/SCRITTORE/CRITICO/SENTINELLA/CAPITANO. NON chiamare MAI `tmux send-keys` a mano — le TUI basate su Ink (Codex, Kimi) perdono il carattere Enter.
allowed-tools: Bash(jht-tmux-send *)
---
<!-- @translation: it, ai-translated 2026-06-06 -->

# tmux-send — messaggistica inter-agente

Wrapper shell situato in `/app/agents/_skills/tmux-send/jht-tmux-send` (anche nel `PATH` tramite symlink in `/usr/local/bin`, creato durante la build dell'immagine).

## Perché esiste

Le TUI basate su Ink (Codex, Kimi Code) **perdono l'Enter** se arriva nella stessa chiamata `tmux send-keys` insieme al corpo del messaggio. Il testo viene inviato carattere per carattere; Ink deve completare il rendering prima di accettare un'altra pressione di tasto. Se chiami `tmux send-keys "msg" Enter`, il messaggio resta nel buffer di input del peer senza essere inviato → deadlock silenzioso tra agenti.

Il wrapper gestisce tutto atomicamente: digita il testo, **rilegge il pane per confermare che sia comparso**, manda Enter, e **rilegge di nuovo il pane per confermare che il turno sia davvero partito**. La consegna non è "aver scritto": è "aver visto partire il turno".

> ⚠️ Esiste un secondo stato, più insidioso: la TUI **accetta il testo e ignora l'Enter**, lasciando la riga appesa nel composer mentre l'agente resta fermo per ore. Visto 4 volte in 3 giorni su una sola VPS, Capitano incluso, quando un messaggio arriva mentre il peer sta chiudendo un turno lungo. Ora il wrapper ritenta l'Enter e, se il turno non parte comunque, restituisce **`5`** invece di dichiarare falsamente successo.

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

- `0` — messaggio consegnato **e submittato** (verificato: il turno è partito)
  - Se il destinatario usa la casella (`mail_receivers`), `0` vuol dire **in coda**: il messaggio è un file durevole e il terminale ha ricevuto solo un breve sollecito. Se l'agente lo ha *preso* lo dice `jht-mail status <agente> <id>`; un messaggio che nessuno prende in tempo viene segnalato al mittente. Una volta in coda, l'uscita è `0` qualunque cosa succeda al sollecito, tranne `3` (un terminale che non risponde); una sessione che sparisce dopo l'accodamento non risponde più `2`, il messaggio aspetta nella casella. Il sollecito si digita solo quando il terminale aspetta al prompt; altrimenti resta trattenuto (l'uscita è sempre `0`) e il watchdog lo ripete.
- `1` — argomenti mancanti
- `2` — la sessione di destinazione non esiste (verifica il nome con `tmux ls`)
- `3` — testo mai apparso e pane non occupato → TUI irricettiva. **L'unico codice che suggerisce morta/wedged.**
- `4` — peer occupato su un turno lungo oltre il budget d'attesa → **vivo**. Riprova più tardi, mai respawnare.
- `5` — testo accettato ma mai submittato ("vivo ma muto") → **vivo**. Riprova più tardi, mai respawnare.
- `7` — il testo e' uscito dalla casella ma nulla prova che la CLI lo abbia preso: **non so**. Guarda il pane prima di riscrivere, mai respawnare.
- `8` — un'altra consegna alla stessa sessione era ancora in corso: non e' stato digitato niente. Riprova.
- `130` — la casella non e' libera e il messaggio **NON e' consegnato**. Quello che c'e' non e' provato nostro (una bozza di una persona, o un segnaposto di incolla che nessuno di nostro spiega): non e' stato incollato ne' premuto niente, e il tuo messaggio e' scritto in `logs/pending-input.jsonl` (`unsent`). Non ripetere in ciclo: avvisa il Capitano (`[BLOCKED]`). Lo stesso codice **dopo** l'incolla vuol dire che la casella non e' piu' solo il nostro testo: nessun Invio, e il testo e' annotato li' (`draft`). Il pane e' vivo: mai respawnare. Il testo li' e' tagliato a 64 KiB.
- Un testo PROVATO nostro (lasciato da una consegna nostra: identico, o il suo segnaposto di incolla, `[Pasted Content N chars]` su Codex / `[Pasted text #1 +N lines]` su Claude, con il nostro numero) riceve il suo Invio alla consegna dopo, di qualunque eta'. `jht-tmux-send --flush-ours <SESSIONE>` fa solo questo (0 = libera o preso, 130 = non nostro, 5 = Invio ingoiato).
- Una casella che contiene SOLO testo firmato (uno o piu' messaggi, di chiunque, rimasti non inviati: una busta `[@x -> @y]`, le parole della persona fra i marchi `⟦UTENTE·id⟧ … ⟦/UTENTE·id⟧`, o un segnaposto di incolla che il registro qui sopra spiega: quello di Codex di qualunque eta', quello di Claude entro `JHT_TMUX_TOKEN_WINDOW` secondi, 600) e' un messaggio che aspetta il suo Invio, non una persona che scrive: il tuo messaggio si incolla dietro e un solo Invio li manda tutti e due; l'agente puo' ricevere in ritardo quello vecchio. Un testo scritto a mano, un marchio non chiuso o un segnaposto che nessuno spiega restano quello che erano (130). Una busta valida si puo' scrivere a mano: non e' un'autenticazione, e il costo e' lo stesso di un messaggio vecchio che arriva in ritardo. Una busta SENZA marchi (un messaggio fra agenti) non ha una fine propria, e una persona potrebbe continuare a scrivere in coda: conta come firmata solo se il registro del trasporto ha l'impronta di quel testo preciso (quello che ha incollato lui e non ha visto preso); altrimenti e' testo della persona (130).

> Solo `3` può portare a un liveness-check e a un respawn. `4` e `5` significano entrambi che il peer è vivo: trattarli come morte è esattamente come iniziano gli over-spawn.

## Regole

- **MAI** usare `tmux send-keys` direttamente per comunicare con un altro agente. Passa sempre da `jht-tmux-send`.
- **MAI** terminare la sessione tmux di un altro agente (regola #0 del Capitano).
- Se `tmux ls` mostra che la sessione di destinazione non esiste, **non crearla** — chiedi al Capitano (o usa `start-agent.sh` se *sei* il Capitano).
- Di default usa il **coordinamento via DB** per i passaggi di pipeline (Scout→Analyst→Scorer→Writer); usa questo skill solo per i segnali in tempo reale elencati sopra. Vedi `agents/_manual/communication-rules.md`.
# Comunicazione durante un turno occupato

Il messaggio viene accodato subito: se la consegna non è verificabile, l'esito è `queued/delivery unverified` (exit 6) con coda durevole. Non scartare né duplicare al retry.
