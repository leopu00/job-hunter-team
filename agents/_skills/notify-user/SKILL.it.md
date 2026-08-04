<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: notify-user
description: Notifica l'utente con fallback automatico. Prova Telegram prima; se il bot non è configurato / irraggiungibile / rate-limitato, il messaggio atterra sulla dashboard web via cloud sync. Registra sempre il messaggio in `pending_user_messages` così nulla si perde. Usala ogni volta che devi raggiungere l'utente con un aggiornamento di stato, una domanda o un digest — mai chiamare `jht-telegram-send` direttamente per quello scopo.
allowed-tools: Bash(jht-notify-user *)
---

# notify-user — API unica per raggiungere l'utente

L'utente ha più canali (bot Telegram, dashboard web, futuro push mobile). Ogni agente non dovrebbe dover sapere quale è attivo. `jht-notify-user` decide:

1. INSERT del messaggio in `pending_user_messages` (jobs.db, schema V5).
2. Invio best-effort via `jht-telegram-send` (timeout ~25s).
3. Se Telegram ha successo → `delivered_via='telegram'`.
4. Se fallisce o non è configurato → `delivered_via='web'`. La riga viene raccolta da `jht cloud push` e appare sulla dashboard su jobhunterteam.ai.

L'utente quindi riceve ogni messaggio da qualche parte. L'agente non deve mai gestire branch "Telegram è giù".

## Quando usarla

- ✅ Il Capitano notifica l'utente ogni N posizioni ready (decisione 2026-05-13, batch).
- ✅ Digest settimanale / alert pattern del Mentor.
- ✅ L'Assistente chiede all'utente una domanda che richiede il suo input.
- ✅ Qualsiasi alert ("ho consumato 95% della finestra, fermo il team?").

## Quando NON usarla

- ❌ Messaggi inter-agente — usa `tmux-send` / `jht-tmux-send`.
- ❌ Risposte a un messaggio `[CHAT]` sulla dashboard web — usa `jht-send` (già nel thread chat).
- ❌ Risposte a un `[TG]` in ingresso — usa `jht-telegram-send` direttamente: sai già che Telegram è attivo perché l'utente ti ha appena scritto da lì. Risparmi un roundtrip DB.
- ❌ Allegati pesanti (>20 MB). Usa la cartella CV dell'utente + un corpo di notifica breve.

## Utilizzo

```bash
# Notifica semplice dal Capitano
jht-notify-user --agent capitano "Trovate 10 offerte pronte sopra 75/100. Top: Acme Senior FE (88), Lever DevOps (84), …"

# Digest con tipo esplicito (renderizzato con header sulla dashboard)
jht-notify-user --agent mentor --kind digest "Settimana 19: 18 offerte analizzate, 4 candidate, gap principale: ruoli senior in EU remote."

# Domanda — solo per chiarire una candidatura gia' richiesta dall'utente
jht-notify-user --agent assistente --kind question "Per la candidatura che hai gia' chiesto per Acme Senior FE, quale versione del CV preferisci?"

# Collegata a una posizione (renderizza con la card della posizione sulla dashboard)
jht-notify-user --agent capitano --position-id 42 "CV pronto per posizione 42. Verdetto Critico: PASS."

# Forza web (bypass Telegram, utile per test o messaggi che hanno senso solo nel contesto dashboard)
jht-notify-user --agent mentor --no-telegram "Apri il tab Patterns per i dettagli."
```

Output (stdout):
```
<row_id> via=<telegram|web>
```

## Tipi

| Tipo | Quando | Rendering dashboard |
|------|--------|---------------------|
| `notification` | Aggiornamento di stato generico (default) | Card grigia |
| `question` | L'utente deve rispondere prima che l'agente proceda | Card con input reply |
| `digest` | Riepilogo periodico (Mentor settimanale, Capitano batch) | Card collassabile |
| `alert` | Anomalia bloccante (rate limit, errore consegna candidatura) | Card rossa |

## Percorso di fallback

```
agente ──► jht-notify-user
              │
              ├──► INSERT pending_user_messages (delivered_via=NULL, kind, body)
              │
              ├──► try jht-telegram-send (timeout 25s, best-effort)
              │
              │      ┌─ successo ─► UPDATE delivered_via='telegram'
              │      │
              │      └─ fallimento/timeout/non-configurato ─► UPDATE delivered_via='web'
              │
              └──► stdout: "<id> via=<canale>"

                              ▼ (processo separato, daemon cloud-sync)

         jht cloud push  ──► /api/cloud-sync/push  ──► Supabase
                                                          │
                                                          ▼
                                          dashboard /(protected)/dashboard
                                          mostra messaggi non ancora ack
```

## Modalità di fallimento

| Exit | Causa | Recovery |
|------|-------|----------|
| 0 | Riga inserita; consegna best-effort (vedi `via=` su stdout) | — |
| 1 | Argomenti invalidi (body vuoto, --kind sconosciuto) | Correggi i flag |
| 2 | DB non trovato o INSERT fallita | Controlla `$JHT_DB` / `$JHT_HOME/jobs.db`; lo schema deve essere V5+ |

Exit 0 con `via=web` NON è un errore: è il comportamento atteso quando Telegram non è attivo. Il messaggio è al sicuro nella coda.

## Marker prompt-injection (decisione 2026-05-13 § 6)

Quando l'utente risponde via dashboard (compila `user_reply` su una riga con `delivered_via='web'`), tocca a te leggere quella risposta — Telegram non vedrà nulla. Per farlo usa la skill **`user-reply-check`** ad ogni iterazione del tuo loop: restituisce le risposte che l'utente ti ha lasciato in dashboard e le marca come viste così non le processi due volte. Quando rispondi, usa `jht-notify-user --no-telegram` per restare nel canale web (mandare un eco su Telegram di una conversazione web confonde l'utente).

## Vedi anche

- `user-reply-check` — l'altra metà del pattern. Leggi le risposte arrivate via dashboard nel tuo loop.
- `telegram-send` — chiamato sotto il cofano da `jht-notify-user`; usalo direttamente solo se sai già che Telegram è il canale giusto (es. reply a `[TG]` inbound).
- `chat-web` (`jht-send`) — per il thread chat-agente sulla dashboard.
- `agents/_manual/db-schema.md` § `pending_user_messages` — schema della coda + indici.
