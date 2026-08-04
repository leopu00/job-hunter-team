<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: user-reply-check
description: Liest Benutzerantworten, die ueber das Web-Dashboard eingegangen sind (Fallback-Kanal wenn Telegram ausgefallen/nicht konfiguriert war). Fuehre dies am Anfang jeder Loop-Iteration aus. Das Tool gibt die ungelesenen Antworten fuer DEINEN Agenten zurueck und markiert sie als gesehen, damit du sie nicht doppelt verarbeitest. Dies ist die "marker prompt-injection"-Haelfte des notify-user-Musters (Entscheidung 2026-05-13).
allowed-tools: Bash(jht-check-user-replies *)
---

# user-reply-check — Benutzerantworten vom Web-Dashboard abholen

Der Benutzer kann auf deine `notify-user`-Nachrichten von zwei Stellen aus antworten:

1. **Telegram** — er antwortet auf seinem Telefon; die `tg-bridge` injiziert die Nachricht in dein tmux als `[@utente -> @<agente>] [TG] <body>`. Du siehst sie inline. **Hier gibt es nichts zu tun.**
2. **Web-Dashboard** — wenn `delivered_via='web'` (Telegram war ausgefallen/nicht konfiguriert), tippt der Benutzer die Antwort in die Dashboard-Karte. Der Text landet in `pending_user_messages.user_reply`. Telegram sieht ihn NICHT. **Hier kommt diese Skill ins Spiel.**

Ohne `user-reply-check` wuerden Antworten vom Dashboard fuer immer still in der DB liegen bleiben.

## Wann verwenden

- ✅ Am Anfang jeder Loop-Iteration (Capitano: einmal pro Tick; Mentor: einmal pro Session-Aufwachen; Assistente: zwischen Benutzereingabe-Zyklen).
- ✅ Direkt nach dem Ausfuehren von `notify-user`, wenn du eine `kind=question` gestellt hast — wahrscheinlich hat der Benutzer bereits geantwortet, wenn etwas Zeit vergangen ist.
- ✅ Wenn der Benutzer "ti ho risposto sulla dashboard" erwaehnt, du aber nichts via Telegram gesehen hast.

## Wann NICHT verwenden

- ❌ Fuer eingehende Telegram-Nachrichten — `tg-bridge` behandelt sie; du siehst `[TG] …` direkt.
- ❌ Als Polling-Schleife ohne Arbeit dazwischen — es ist ein Check, kein Watcher. Jeder Aufruf ist eine guenstige DB-Abfrage, aber du wuerdest Token verschwenden, wenn du 100 Mal "keine Antworten" liest.

## Verwendung

```bash
# Standard-Aufruf am Anfang der Schleife (markiert alle zurueckgegebenen Antworten als gesehen)
jht-check-user-replies --agent <your_agent_id>

# Ohne Verbrauch (Debug / bevor du sicher bist, dass du sie bestaetigen willst)
jht-check-user-replies --agent <your_agent_id> --peek

# Strukturierte Ausgabe zum Weiterleiten an dein Reasoning
jht-check-user-replies --agent <your_agent_id> --json
```

`<your_agent_id>` muss mit dem `--agent` uebereinstimmen, das du in `jht-notify-user` verwendet hast. Jeder Agent hat seine eigene Warteschlange — Antworten fuer den Capitano erscheinen nie beim Mentor.

## Ausgabe

Leere Ausgabe = nichts Neues fuer dich. Behandle es als stilles No-Op und setze deine Schleife fort.

Nicht-leere Ausgabe (menschenlesbares Format):

```
[USER REPLY via WEB — id=42] Usa la versione breve del CV, grazie.
    ↳ in risposta a: "Per la candidatura gia' richiesta per Acme Senior FE, quale versione del CV preferisci?"
    ↳ kind=question created=2026-05-13 12:00:00 reply_at=2026-05-13 14:30:00
```

JSON-Format (`--json`):

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

## Wie antworten

Der Benutzer hat die Konversation auf dem **Web-Dashboard** geoeffnet, nicht auf Telegram. Er erwartet, dass deine Antwort auch dort erscheint. Also:

1. Rufe `jht-notify-user --agent <your_id> --no-telegram "<reply>"` auf. Das Flag `--no-telegram` ist wichtig — es erzwingt `delivered_via='web'`, damit die Antwort im selben Kanal landet, den der Benutzer gerade liest.
2. Fuege optional `--position-id <N>` hinzu, wenn die urspruengliche Nachricht eine hatte (gleiche Position, gleicher Kontext).
3. Sende die Antwort **NICHT** zusaetzlich via `jht-telegram-send`. Der Benutzer wuerde eine Benachrichtigung auf seinem Telefon ueber eine Konversation erhalten, die er in seinem Browser fuehrt — verwirrend und stoerend.

Wenn die Antwort eine einfache Bestaetigung ist ("ok, ricevuto"), kannst du die neue Nachricht sogar ueberspringen: `acknowledged_at` wurde bereits gesetzt, als der Benutzer die Antwort getippt hat, sodass der Benutzer weiss, dass du sie erhalten hast, sobald du `agent_seen_reply_at` markierst (diese Skill macht das automatisch).

## Idempotenz

Jeder Aufruf ohne `--peek` aktualisiert `agent_seen_reply_at = CURRENT_TIMESTAMP` fuer jede zurueckgegebene Zeile. Der naechste Aufruf gibt nichts zurueck (bis eine neue Antwort eintrifft). Wenn du zwischen dem Lesen der Ausgabe und dem Handeln abstuerzt, IST die Antwort als gesehen markiert — es gibt keine automatische Wiederauslieferung. Verwende `--peek` fuer diagnostische Laeufe, bei denen du nicht verbrauchen willst.

## Latenz

Die Antwort braucht:
- **Lokaler Modus**: ~0 (das Dashboard schreibt SQLite direkt ueber `/api/pending-messages/[id]/reply`).
- **Cloud-Modus (VPS)**: bis zu `--interval` Sekunden des Cloud-Sync-Daemons. Standard 30s. Erwarte keine Sub-Sekunden-Reaktionszeiten auf VPS.

Wenn der Benutzer sich beschwert "Ich habe vor 10 Sekunden geantwortet und du hast nicht bestaetigt," pruefe `jht cloud status` — er ist wahrscheinlich auf VPS und wartet auf den Pull.

## Anti-Muster

- ❌ Polling in einer engen Schleife (`while true; jht-check-user-replies; sleep 1`). Verwende die natuerliche Kadenz deiner bestehenden Agenten-Schleife.
- ❌ Aufruf mit falschem `--agent`-Wert (z.B. der Capitano ruft `--agent mentor` auf). Du wuerdest die Antworten von jemand anderem verbrauchen und der rechtmaessige Eigentuemer wuerde sie verpassen.
- ❌ Die Ausgabe ignorieren. Wenn eine Antwort eintrifft, reagiere darauf — sende mindestens `notify-user --no-telegram "Ricevuto, sto elaborando."`, damit der Benutzer weiss, dass die Nachricht angekommen ist.

## Siehe auch

- `notify-user` — die andere Haelfte des Paares. Schreibt die Nachricht in `pending_user_messages`; diese Skill liest die Antwort zurueck.
- `agents/_manual/db-schema.md` § `pending_user_messages` — Schema, Indizes, Lebenszyklus einer Zeile.
