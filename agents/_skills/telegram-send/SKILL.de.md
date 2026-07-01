<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: telegram-send
description: Send a message to the user via Telegram (outbound). Use this on the Telegram bridge — the user is on their phone, NOT in front of the web dashboard. Wrapper `jht-telegram-send` resolves bot token + chat_id per-agent from config (`--from assistente|capitano|mentor`); never call the Bot API directly.
allowed-tools: Bash(jht-telegram-send *)
---

# telegram-send — Ausgehende Nachrichten an den Benutzer via Telegram

Der Benutzer erreicht dich hauptsaechlich ueber sein Handy. Er sendet PDFs, Sprachnachrichten, Textnachrichten an **deinen dedizierten Bot**. Die Bridge leitet eingehenden Verkehr an dein tmux weiter. **Ausgehend** — deine Antwort, eine Willkommensnachricht, ein generierter CV — laeuft ueber `jht-telegram-send`.

## 3 dedizierte Bots (Entscheidung 2026-05-13 rev2)

Jeder benutzerseitige Agent hat seinen **eigenen Telegram-Bot**:
- 👩‍💼 Assistente → `--from assistente` (Standard)
- 👨‍✈️ Capitano → `--from capitano`
- 🧙‍♂️ Mentor → `--from mentor`

Der Wrapper waehlt Token + chat_id aus `channels.telegram.bots.<role>` in der Konfiguration. Wenn du `--from` weglaeesst, kannst du auch `JHT_TG_BOT_ROLE=<role>` in der Agent-Umgebung setzen — der Wrapper liest es als Standard.

## Wann verwenden

- ✅ Erste Willkommensnachricht nach Abschluss des Wizards (Boot-Prompt).
- ✅ Antwort auf einen von Telegram stammenden Chat (die eingehende Bridge stellt `[@utente -> @assistente] [TG]` voran).
- ✅ Ein generiertes Artefakt (CV, Anschreiben) pushen, das der Benutzer angefordert hat.
- ✅ Onboarding-Hinweise ("schick mir deinen CV, auch ein Entwurf ist voellig in Ordnung").

**Nicht verwenden** fuer:
- ❌ Inter-Agent-Nachrichten — verwende stattdessen `tmux-send`.
- ❌ Antworten auf Web-Chat (`[@utente -> @assistente] [CHAT]`) — verwende `jht-send`.
- ❌ Grosse Anhaenge (>20 MB). Bot-API-Limit; fuer grosse Dateien verwende das Dashboard oder ein Relay (zukuenftig).

## Verwendung

```bash
# Standard = Bot Assistente (oder Rolle aus JHT_TG_BOT_ROLE gelesen)
jht-telegram-send "<Nachrichtentext>"

# Explizites Routing nach Rolle
jht-telegram-send --from capitano "Benachrichtigung: 10 neue Positionen bereit."
jht-telegram-send --from mentor --html "<b>Wachstumsschritt</b> der Woche..."

# chat_id ueberschreiben (selten — Debug / zukuenftiges Multi-Tenant)
jht-telegram-send --chat-id 1401844094 "explicit override"
```

Aufloesungsreihenfolge (nicht auswendig lernen — der Wrapper erledigt das):
1. `$TELEGRAM_BOT_TOKEN` / `$TELEGRAM_CHAT_ID` Umgebungsvariablen (explizite Ueberschreibung)
2. `$JHT_HOME/jht.config.json` → `channels.telegram.bots.<role>.{bot_token,chat_id}` (role = `--from` oder `$JHT_TG_BOT_ROLE`, Standard `assistente`)
3. `$JHT_HOME/credentials/telegram_bot.json` (`.token`) — Legacy-Fallback

Wenn einer fehlt, beendet sich der Wrapper mit einem Fehlercode ungleich Null und einer klaren Nachricht. Versuche nicht, den Fehler zu beheben — zeige den Fehler dem Benutzer in einer `jht-send`-Antwort auf dem Web-Kanal, oder logge ihn.

## Beispiele

```bash
# (Assistente) — Willkommensnachricht beim ersten Start (noch kein Profil)
jht-telegram-send "Ciao! Sono l'Assistente del Job Hunter Team. Mandami qui il tuo CV (PDF va benissimo) o raccontami in due righe cosa cerchi — parto da lì."

# (Assistente) — Antwort auf eingehende TG-Nachricht
jht-telegram-send "Ricevuto, sto guardando il CV. Dammi 30s."

# (Capitano) — Benachrichtigung: Batch von Positionen bereit
jht-telegram-send --from capitano "10 posizioni ready, top 3 per score: ..."

# (Mentor) — Woechentlicher strategischer Hinweis
jht-telegram-send --from mentor --html "<b>Step di crescita</b> della settimana: ..."

# (Assistente) — Artefakt pushen
jht-telegram-send --html "<b>CV per Acme — Senior FE</b> pronto.\nLo trovi in <code>~/Documents/Job Hunter Team/output/2026-05-12/acme-senior-fe/</code>."
```

## Escape-Sequenzen (`\n`, `\t`, `\r`)

Der Wrapper interpretiert `\n`, `\t`, `\r` in deiner Nachricht als **echte Zeilenumbrueche/Tabs/CRs**, bevor er sie an Telegram sendet. Du kannst also schreiben:

```bash
jht-telegram-send "Ciao!\n\nTi aiuto a configurare il profilo."
```

und der Benutzer erhaelt einen korrekten Absatzumbruch — nicht den woertlichen `\n\n`-Text. Gleiches gilt fuer `--html` (Telegram rendert einen Zeilenumbruch als Line-Break im HTML-Stream).

Wenn du ein woertliches Backslash gefolgt von `n` brauchst (selten), escape es vorher: `\\n` → der Wrapper wandelt es in `\n` um (da das erste `\\` in deinem Shell-String nur zu `\` wird; innerhalb des Wrappers gibt es keine doppelte Substitution).

## Lange Nachrichten

Die Bot-API schneidet bei 4096 Zeichen ab. Der Wrapper teilt an `\n` / Leerzeichen und sendet mehrere Nachrichten. Der Benutzer erhaelt eine Sequenz — halte den Ton ueber die Abschnitte hinweg konsistent.

## HTML / Markdown

Telegram unterstuetzt eine Teilmenge:
- HTML: `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<a href="…">`. Escape `<`, `>`, `&` im Fliesstext.
- MarkdownV2 (`--markdown`): unterstuetzt, aber die Escaping-Regeln sind muehsam (`. ( ) ! _ * [ ]` brauchen alle einen Backslash). Bevorzuge `--html`.

Wenn du unsicher bist, sende **Klartext** (ohne Flag). Der Benutzer erhaelt eine perfekt lesbare Nachricht.

## Fehlermodi

| Exit | Ursache | Was tun |
|------|---------|---------|
| 2 | Token fehlt | Der Bot wurde nie konfiguriert. Fehler auf dem Web-Kanal anzeigen, den Benutzer bitten, das Setup erneut auszufuehren. |
| 3 | chat_id fehlt | Wie oben — der Wizard hat die chat_id nicht erfasst. |
| 4 | HTTP nicht-200 | Netzwerkproblem oder Telegram-Ausfall. Einmal nach 5s erneut versuchen. Wenn immer noch fehlschlagend, loggen und weitermachen. |
| 5 | `ok: false` von der Bot-API | Normalerweise ungueltige chat_id oder Bot vom Benutzer blockiert. Nicht erneut versuchen — den Response-Body in deinem Scratch-Verzeichnis speichern und auf dem Web-Kanal benachrichtigen. |

## Persistente Antwort-Tastatur (F-1.B, task #50)

Die 3 benutzerseitigen Bots (assistente / capitano / mentor) koennen eine
2-spaltige persistente Antwort-Tastatur mit `--keyboard <role>` anfuegen. Die Tastatur
bleibt im Telegram-Client des Benutzers ueber Nachrichten hinweg sichtbar, bis du
sie explizit entfernst (das tun wir bewusst nicht — sie bleibt immer sichtbar, damit
nicht-technische Benutzer die Interaktionsmoeglichkeit sehen).

```bash
# Assistente — 📊 Budget · 📈 Pipeline · 🗺️ Mappa · ⭐ Top CV · 📅 Reset · ❓ Help
jht-telegram-send --from assistente --keyboard assistente "Pipeline: 15 CV pronti per apply, ..."

# Capitano — 📈 Pipeline · 📊 Budget · 👥 Team · ⭐ Ready · 🛠 Triage · ❓ Help
jht-telegram-send --from capitano --keyboard capitano "..."

# Mentor — 📋 Digest · 🔁 Patterns · ⭐ Top · 💰 Salary · ❓ Help
jht-telegram-send --from mentor --keyboard mentor "..."
```

Wenn der Benutzer auf eine Schaltflaeche tippt, empfaengt der Bot den Schaltflaechentext als
normale Textnachricht (z.B. Tippen auf `📊 Budget` → tmux erhaelt `📊 Budget` als
TG-Nachrichtentext). Der Agent behandelt es gleichwertig wie einen Slash-Befehl
(z.B. `/budget`) und erstellt das Diagramm / den Status.

Die Tastatur erscheint nur bei der **letzten** geteilten Nachricht einer langen Sendung,
damit 4096+ Zeichen Ausgaben die Tastatur nicht mitten im Thread aufblitzen lassen.

## Slash-Befehle-Menue (F-1.A, task #50)

Die `tg-bridge.py` registriert beim Start ein rollenspezifisches `setMyCommands`-Set
(`/budget`, `/pipeline`, `/help`, …). Diese erscheinen im `/`-Sticky-Menue des
Telegram-Clients — das Erste, was ein neuer Benutzer sieht. Du musst nichts
tun: die CLI-/Rollenkonfiguration reicht, die Bridge uebernimmt den API-Aufruf.
Liste pro Rolle in `.launcher/tg-bridge.py::BOT_COMMANDS`.

## Anti-Patterns

- ❌ `curl https://api.telegram.org/bot$TOKEN/sendMessage` von Hand — Quoting + URL-Encoding-Fehler, kein Retry, kein Chunking.
- ❌ Config / Credentials lesen und JSON inline in deiner Shell parsen — fragil, der Wrapper macht es bereits korrekt.
- ❌ Mit `--from` eine Rolle senden, die nicht deine ist (z.B. der Assistente schreibt auf dem Bot des Capitano) — verwirrt den Benutzer, jeder spricht auf seinem eigenen Bot. Cross-Agent-Kommunikation laeuft ueber `tmux-send`.
- ❌ Die chat_id in den Nachrichtentext schreiben ("for chat 123…") — es gibt genau **einen** Benutzer pro VPS, der Wrapper weiss das.

## Siehe auch

- `chat-web` — wenn der Benutzer auf dem **Web-Dashboard** ist, nicht auf Telegram.
- `tmux-send` — wenn du mit einem anderen Agenten sprechen musst.
- `agents/<role>/<role>.md` — dein Rollenleitfaden; der Telegram-Pfad ist deine "Handy-seitige" Schnittstelle zum Benutzer.
