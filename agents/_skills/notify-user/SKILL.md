---
name: notify-user
description: Notify the user with automatic fallback. Tries Telegram first; if the bot is not configured / unreachable / rate-limited, the message lands on the web dashboard via cloud sync instead. Always records the message in `pending_user_messages` so nothing is lost. Use this whenever you need to reach the user with a status update, a question, or a digest — never call `jht-telegram-send` directly for that purpose.
allowed-tools: Bash(jht-notify-user *)
---

# notify-user — single API to reach the user

The user has multiple channels (Telegram bot, web dashboard, future mobile push). Each agent should not have to know which one is live. `jht-notify-user` decides:

1. INSERTs the message into `pending_user_messages` (jobs.db, schema V5).
2. Best-effort send via `jht-telegram-send` (~25s timeout).
3. If Telegram succeeds → `delivered_via='telegram'`.
4. If it fails or isn't configured → `delivered_via='web'`. The row is picked up by `jht cloud push` and appears on the dashboard at jobhunterteam.ai.

The user therefore receives every message somewhere. The agent never has to handle "Telegram is down" branches.

## ⚠️ Since the chat lane was unified: this message is ALSO a chat bubble

`jht-send` and `jht-notify-user` used to write to two different places — the
chat thread and the notification queue. They do not any more. The box mirrors
`pending_user_messages` into `<agent>/chat.jsonl`, so what you write here also
shows up as your bubble in the game chat and in the web chat thread, right
next to the replies you send with `jht-send`.

The consequence is the only rule that matters here: **one message, one tool.**
Never send the same content down both paths. The user would read it twice, and
neither copy knows about the other — the lane cannot tell a duplicate from two
turns that happen to say the same thing ("ok" arrives a thousand times), so
nothing downstream will clean it up.

## When to use it

- ✅ Capitano notifies the user every N ready positions (decisione 2026-05-13, batch).
- ✅ Mentor weekly digest / pattern alerts.
- ✅ Assistente asks the user a question that requires their input.
- ✅ Any alert ("ho consumato 95% della finestra, fermo il team?").

## When NOT to use it

- ❌ Inter-agent messages — use `tmux-send` / `jht-tmux-send`.
- ❌ Replies to a `[CHAT]` message on the web dashboard — use `jht-send` (already in the chat thread).
- ❌ Replies to a `[TG]` inbound — use `jht-telegram-send` directly: you already know Telegram is up because the user just wrote you from there. Saves a DB roundtrip.
- ❌ Heavy attachments (>20 MB). Use the user's CV folder + a short notification body.

## Usage

```bash
# Plain notification from Capitano
jht-notify-user --agent capitano "Trovate 10 offerte pronte sopra 75/100. Top: Acme Senior FE (88), Lever DevOps (84), …"

# Digest with explicit kind (rendered with a header on the dashboard)
jht-notify-user --agent mentor --kind digest "Settimana 19: 18 offerte analizzate, 4 candidate, gap principale: ruoli senior in EU remote."

# Question — only to clarify an application the user already requested
jht-notify-user --agent assistente --kind question "For the application you already requested for Acme Senior FE, which CV version do you prefer?"

# Linked to a position (renders with the position card on the dashboard)
jht-notify-user --agent capitano --position-id 42 "CV pronto per posizione 42. Critic verdict: PASS."

# Forza web (bypass Telegram, utile per test o per messaggi che hanno senso solo nel context dashboard)
jht-notify-user --agent mentor --no-telegram "Apri il tab Patterns per i dettagli."
```

Output (stdout):
```
<row_id> via=<telegram|web>
```

## Kinds

| Kind | Quando | Rendering dashboard |
|------|--------|---------------------|
| `notification` | Status update generico (default) | Card grigia |
| `question` | L'utente deve rispondere prima che l'agente proceda | Card con input reply |
| `digest` | Riepilogo periodico (Mentor settimanale, Capitano batch) | Card collapsible |
| `alert` | Anomalia bloccante (rate limit, errore consegna candidatura) | Card rossa |

## Fallback path

```
agent ──► jht-notify-user
              │
              ├──► INSERT pending_user_messages (delivered_via=NULL, kind, body)
              │
              ├──► try jht-telegram-send (25s timeout, best-effort)
              │
              │      ┌─ success ─► UPDATE delivered_via='telegram'
              │      │
              │      └─ fail/timeout/not-configured ─► UPDATE delivered_via='web'
              │
              └──► stdout: "<id> via=<channel>"

                              ▼ (separate process, cloud-sync daemon)

         jht cloud push  ──► /api/cloud-sync/push  ──► Supabase
                                                          │
                                                          ▼
                                          dashboard /(protected)/dashboard
                                          mostra messaggi non ancora ack
```

## Failure modes

| Exit | Cause | Recovery |
|------|-------|----------|
| 0 | Riga inserita; consegna best-effort (vedi `via=` su stdout) | — |
| 1 | Argomenti invalidi (body vuoto, --kind sconosciuto) | Correggi i flag |
| 2 | DB non trovato o INSERT fallita | Controlla `$JHT_DB` / `$JHT_HOME/jobs.db`; lo schema deve essere V5+ |

Exit 0 con `via=web` NON e' un errore: e' il comportamento atteso quando Telegram non e' attivo. Il messaggio e' al sicuro nella coda.

## Marker prompt-injection (decisione 2026-05-13 § 6)

Quando l'utente risponde via dashboard (compila `user_reply` su una riga con `delivered_via='web'`), tocca a te leggere quella risposta — Telegram non vedra' nulla. Per farlo usa la skill **`user-reply-check`** ad ogni iterazione del tuo loop: ritorna le risposte che l'utente ti ha lasciato in dashboard e le marca come viste cosi' non le processi due volte. Quando rispondi, usa `jht-notify-user --no-telegram` per restare nel canale web (mandare un eco su Telegram di una conversazione web confonde l'utente).

## See also

- `user-reply-check` — l'altra meta' del pattern. Leggi le risposte arrivate via dashboard nel tuo loop.
- `telegram-send` — chiamato sotto il cofano da `jht-notify-user`; usalo direttamente solo se sai gia' che Telegram e' il canale giusto (es. reply a `[TG]` inbound).
- `chat-web` (`jht-send`) — per il thread chat-agente sulla dashboard.
- `agents/_manual/db-schema.md` § `pending_user_messages` — schema della coda + indici.
