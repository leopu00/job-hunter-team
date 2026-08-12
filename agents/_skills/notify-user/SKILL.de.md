<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: notify-user
description: Den Nutzer benachrichtigen mit automatischem Fallback. Versucht zuerst Telegram; wenn der Bot nicht konfiguriert / nicht erreichbar / ratenlimitiert ist, landet die Nachricht stattdessen über Cloud-Sync auf dem Web-Dashboard. Zeichnet die Nachricht immer in `pending_user_messages` auf, damit nichts verloren geht. Verwende dies, wann immer du den Nutzer mit einem Status-Update, einer Frage oder einer Zusammenfassung erreichen musst — rufe dafür nie direkt `jht-telegram-send` auf.
allowed-tools: Bash(jht-notify-user *)
---

# notify-user — einzelne API um den Nutzer zu erreichen

Der Nutzer hat mehrere Kanäle (Telegram-Bot, Web-Dashboard, zukünftiger mobiler Push). Jeder Agent sollte nicht wissen müssen, welcher aktiv ist. `jht-notify-user` entscheidet:

1. Fügt die Nachricht in `pending_user_messages` ein (jobs.db, Schema V5).
2. Best-Effort-Versand via `jht-telegram-send` (~25s Timeout).
3. Wenn Telegram erfolgreich → `delivered_via='telegram'`.
4. Wenn es fehlschlägt oder nicht konfiguriert ist → `delivered_via='web'`. Die Zeile wird von `jht cloud push` abgeholt und erscheint auf dem Dashboard bei jobhunterteam.ai.

Der Nutzer erhält daher jede Nachricht irgendwo. Der Agent muss nie "Telegram ist down"-Verzweigungen handhaben.

## ⚠️ Seit die Chat-Spur vereinheitlicht ist: diese Nachricht ist AUCH eine Chat-Blase

`jht-send` und `jht-notify-user` schrieben früher an zwei verschiedene Orte —
den Chat-Thread und die Benachrichtigungs-Queue. Das gilt nicht mehr. Die Box
spiegelt `pending_user_messages` nach `<agent>/chat.jsonl`, also erscheint
das, was du hier schreibst, auch als deine Blase im Spiel-Chat und im
Web-Thread, direkt neben deinen Antworten mit `jht-send`.

Die Folge ist die einzige Regel, die hier zählt: **eine Nachricht, ein
Werkzeug.** Niemals denselben Inhalt über beide Wege. Der Nutzer würde ihn
zweimal lesen, und keine der beiden Kopien weiß von der anderen — die Spur
kann ein Duplikat nicht von zwei Beiträgen unterscheiden, die zufällig
dasselbe sagen („ok“ kommt tausendmal), also räumt weiter unten niemand auf.

## Wann verwenden

- ✅ Capitano benachrichtigt den Nutzer alle N fertigen Positionen (Entscheidung 2026-05-13, Batch).
- ✅ Mentor wöchentliche Zusammenfassung / Muster-Alerts.
- ✅ Assistente stellt dem Nutzer eine Frage, die seine Eingabe erfordert.
- ✅ Jeder Alert ("habe 95% des Fensters verbraucht, soll ich das Team stoppen?").

## Wann NICHT verwenden

- ❌ Inter-Agenten-Nachrichten — verwende `tmux-send` / `jht-tmux-send`.
- ❌ Antworten auf eine `[CHAT]`-Nachricht auf dem Web-Dashboard — verwende `jht-send` (bereits im Chat-Thread).
- ❌ Antworten auf einen `[TG]`-Eingang — verwende direkt `jht-telegram-send`: du weißt bereits, dass Telegram aktiv ist, weil der Nutzer dir gerade von dort geschrieben hat. Spart einen DB-Roundtrip.
- ❌ Schwere Anhänge (>20 MB). Verwende den CV-Ordner des Nutzers + einen kurzen Benachrichtigungstext.

## Verwendung

```bash
# Einfache Benachrichtigung vom Capitano
jht-notify-user --agent capitano "10 fertige Angebote über 75/100 gefunden. Top: Acme Senior FE (88), Lever DevOps (84), …"

# Zusammenfassung mit explizitem Typ (wird mit Header auf dem Dashboard gerendert)
jht-notify-user --agent mentor --kind digest "Woche 19: 18 Angebote analysiert, 4 Kandidaten, Hauptlücke: Senior-Rollen in EU Remote."

# Frage — nur zur Klaerung einer bereits angeforderten Bewerbung
jht-notify-user --agent assistente --kind question "Welche CV-Version bevorzugst du fuer die Bewerbung fuer Acme Senior FE, die du bereits angefragt hast?"

# Verknüpft mit einer Position (wird mit der Positions-Karte auf dem Dashboard gerendert)
jht-notify-user --agent capitano --position-id 42 "CV fertig für Position 42. Critic-Urteil: PASS."

# Web erzwingen (Telegram umgehen, nützlich für Tests oder Nachrichten die nur im Dashboard-Kontext Sinn machen)
jht-notify-user --agent mentor --no-telegram "Öffne den Tab Patterns für Details."
```

Ausgabe (stdout):
```
<row_id> via=<telegram|web>
```

## Arten

| Art | Wann | Dashboard-Rendering |
|------|--------|---------------------|
| `notification` | Generisches Status-Update (Standard) | Graue Karte |
| `question` | Der Nutzer muss antworten, bevor der Agent fortfährt | Karte mit Eingabe-Antwort |
| `digest` | Periodische Zusammenfassung (Mentor wöchentlich, Capitano Batch) | Zusammenklappbare Karte |
| `alert` | Blockierende Anomalie (Rate-Limit, Zustellungsfehler Bewerbung) | Rote Karte |

## Fallback-Pfad

```
Agent ──► jht-notify-user
              │
              ├──► INSERT pending_user_messages (delivered_via=NULL, kind, body)
              │
              ├──► try jht-telegram-send (25s Timeout, Best-Effort)
              │
              │      ┌─ Erfolg ─► UPDATE delivered_via='telegram'
              │      │
              │      └─ Fehler/Timeout/nicht-konfiguriert ─► UPDATE delivered_via='web'
              │
              └──► stdout: "<id> via=<channel>"

                              ▼ (separater Prozess, Cloud-Sync-Daemon)

         jht cloud push  ──► /api/cloud-sync/push  ──► Supabase
                                                          │
                                                          ▼
                                          Dashboard /(protected)/dashboard
                                          zeigt noch nicht bestätigte Nachrichten
```

## Fehlermodi

| Exit | Ursache | Wiederherstellung |
|------|-------|----------|
| 0 | Zeile eingefügt; Zustellung Best-Effort (siehe `via=` auf stdout) | — |
| 1 | Ungültige Argumente (Body leer, --kind unbekannt) | Flags korrigieren |
| 2 | DB nicht gefunden oder INSERT fehlgeschlagen | `$JHT_DB` / `$JHT_HOME/jobs.db` prüfen; Schema muss V5+ sein |

Exit 0 mit `via=web` ist KEIN Fehler: es ist das erwartete Verhalten wenn Telegram nicht aktiv ist. Die Nachricht ist sicher in der Warteschlange.

## Marker Prompt-Injection (Entscheidung 2026-05-13 § 6)

Wenn der Nutzer über das Dashboard antwortet (füllt `user_reply` in einer Zeile mit `delivered_via='web'` aus), bist du dran, diese Antwort zu lesen — Telegram sieht davon nichts. Verwende dafür den Skill **`user-reply-check`** bei jeder Iteration deiner Schleife: er gibt die Antworten zurück, die der Nutzer dir im Dashboard hinterlassen hat, und markiert sie als gesehen, damit du sie nicht zweimal verarbeitest. Wenn du antwortest, verwende `jht-notify-user --no-telegram`, um im Web-Kanal zu bleiben (ein Echo auf Telegram einer Web-Konversation verwirrt den Nutzer).

## Siehe auch

- `user-reply-check` — die andere Hälfte des Musters. Lies die Antworten, die über das Dashboard in deiner Schleife angekommen sind.
- `telegram-send` — wird unter der Haube von `jht-notify-user` aufgerufen; verwende es direkt nur wenn du bereits weißt, dass Telegram der richtige Kanal ist (z.B. Antwort auf `[TG]`-Eingang).
- `chat-web` (`jht-send`) — für den Chat-Agenten-Thread auf dem Dashboard.
- `agents/_manual/db-schema.md` § `pending_user_messages` — Schema der Warteschlange + Indizes.
