<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: user-reply-check
description: Legge le risposte dell'utente arrivate tramite la dashboard web (canale di fallback quando Telegram era down/non configurato). Eseguilo all'inizio di ogni iterazione del loop. Il tool restituisce le risposte non lette per il TUO agente e le segna come viste, così non le elabori due volte. Questa è la metà "marker prompt-injection" del pattern notify-user (decisione 2026-05-13).
allowed-tools: Bash(jht-check-user-replies *)
---

# user-reply-check — raccoglie le risposte dell'utente inviate tramite la dashboard web

L'utente può rispondere ai tuoi messaggi `notify-user` da due posti:

1. **Telegram** — risponde dal telefono; il `tg-bridge` inietta il messaggio nel tuo tmux come `[@utente -> @<agente>] [TG] <body>`. Lo vedi inline. **Niente da fare qui.**
2. **Dashboard web** — quando `delivered_via='web'` (Telegram era down/non configurato), l'utente digita la risposta nella card della dashboard. Il testo finisce in `pending_user_messages.user_reply`. Telegram NON lo vede. **Qui entra in gioco questa skill.**

Senza `user-reply-check`, le risposte dalla dashboard resterebbero silenziosamente nel DB per sempre.

## Quando usarla

- ✅ All'inizio di ogni iterazione del loop (Capitano: una volta per tick; Mentor: una volta per risveglio sessione; Assistente: tra i cicli di input utente).
- ✅ Subito dopo aver eseguito `notify-user` se hai posto una `kind=question` — è probabile che l'utente abbia già risposto se è passato un po' di tempo.
- ✅ Quando l'utente dice "ti ho risposto sulla dashboard" ma non hai visto nulla via Telegram.

## Quando NON usarla

- ❌ Per i messaggi in arrivo da Telegram — li gestisce `tg-bridge`; vedi `[TG] …` direttamente.
- ❌ Come loop di polling senza lavoro in mezzo — è un check, non un watcher. Ogni chiamata è una query DB leggera, ma sprecheresti token leggendo "nessuna risposta" 100 volte.

## Utilizzo

```bash
# Chiamata standard all'inizio del loop (segna tutte le risposte restituite come viste)
jht-check-user-replies --agent <your_agent_id>

# Senza consumare (debug / prima di essere sicuro di voler fare l'ack)
jht-check-user-replies --agent <your_agent_id> --peek

# Output strutturato da passare al tuo ragionamento
jht-check-user-replies --agent <your_agent_id> --json
```

`<your_agent_id>` deve corrispondere al `--agent` che hai usato in `jht-notify-user`. Ogni agente ha la propria coda — le risposte per il Capitano non appaiono mai per il Mentor.

## Output

Output vuoto = niente di nuovo per te. Trattalo come un no-op silenzioso e prosegui il tuo loop.

Output non vuoto (formato leggibile):

```
[USER REPLY via WEB — id=42] Usa la versione breve del CV, grazie.
    ↳ in risposta a: "Per la candidatura gia' richiesta per Acme Senior FE, quale versione del CV preferisci?"
    ↳ kind=question created=2026-05-13 12:00:00 reply_at=2026-05-13 14:30:00
```

Formato JSON (`--json`):

```json
[
  {
    "id": 42,
    "agent": "capitano",
    "body": "Per la candidatura gia' richiesta per Acme Senior FE, quale versione del CV preferisci?",
    "kind": "question",
    "related_position_id": 17,
    "user_reply": "Usa la versione breve del CV, grazie.",
    "user_reply_at": "2026-05-13 14:30:00",
    "created_at": "2026-05-13 12:00:00"
  }
]
```

## Come rispondere

L'utente ha aperto la conversazione sulla **dashboard web**, non su Telegram. Si aspetta che la tua risposta appaia lì. Quindi:

1. Chiama `jht-notify-user --agent <your_id> --no-telegram "<reply>"`. Il flag `--no-telegram` è importante — forza `delivered_via='web'` così la risposta finisce nello stesso canale che l'utente sta leggendo.
2. Opzionalmente includi `--position-id <N>` quando il messaggio originale ne aveva uno (stessa posizione, stesso contesto).
3. **NON** inviare la risposta anche via `jht-telegram-send`. L'utente riceverebbe una notifica sul telefono per una conversazione che sta avendo nel browser — confuso e rumoroso.
4. **NON** inviare la risposta anche via `jht-send`. Da quando la corsia chat è unificata, quello che scrivi qui È già una bolla nella chat del videogioco e nel thread web — il box specchia `pending_user_messages` dentro `<agente>/chat.jsonl`. Mandarla due volte significa che l'utente legge la stessa risposta due volte, e a valle la seconda copia non la toglie nessuno: la corsia non sa distinguere un doppione da due battute che per caso coincidono. Un messaggio, uno strumento solo.

Se la risposta è un semplice riscontro ("ok, ricevuto"), puoi anche saltare il nuovo messaggio: `acknowledged_at` è già stato impostato quando l'utente ha digitato la risposta, quindi l'utente sa che l'hai ricevuta non appena segni `agent_seen_reply_at` (questa skill lo fa automaticamente).

## Idempotenza

Ogni chiamata senza `--peek` aggiorna `agent_seen_reply_at = CURRENT_TIMESTAMP` per ogni riga restituita. La chiamata successiva non restituisce nulla (finché non arriva una nuova risposta). Se crashi tra la lettura dell'output e l'azione su di esso, la risposta È segnata come vista — non c'è riconsegna automatica. Usa `--peek` per esecuzioni diagnostiche in cui non vuoi consumare.

## Latenza

La risposta impiega:
- **Modalità locale**: ~0 (la dashboard scrive SQLite direttamente via `/api/pending-messages/[id]/reply`).
- **Modalità cloud (VPS)**: fino a `--interval` secondi del daemon cloud-sync. Default 30s. Non aspettarti tempi sub-secondo su VPS.

Se l'utente si lamenta "ho risposto 10 secondi fa e non hai confermato," controlla `jht cloud status` — probabilmente è su VPS in attesa del pull.

## Anti-pattern

- ❌ Polling in un loop serrato (`while true; jht-check-user-replies; sleep 1`). Usa la cadenza naturale del tuo loop agente esistente.
- ❌ Chiamare con il valore `--agent` sbagliato (es. il Capitano che chiama `--agent mentor`). Consumeresti le risposte di qualcun altro e il legittimo proprietario le perderebbe.
- ❌ Ignorare l'output. Se arriva una risposta, reagisci — come minimo invia `notify-user --no-telegram "Ricevuto, sto elaborando."` così l'utente sa che il messaggio è arrivato.

## Vedi anche

- `notify-user` — l'altra metà della coppia. Scrive il messaggio in `pending_user_messages`; questa skill legge la risposta.
- `agents/_manual/db-schema.md` § `pending_user_messages` — schema, indici, ciclo di vita di una riga.
