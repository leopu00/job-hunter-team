---
name: game-reply-options
description: "Biete im Chat des JHT-Spiels 2 bis 5 kontextspezifische, anklickbare Antwort-Buttons an, wenn sie dem Nutzer die nächste Entscheidung wirklich erleichtern. Nur für eine kleine, klar begrenzte Auswahl verwenden; sonst wie gewohnt mit jht-send antworten. Niemals als festen Onboarding-Baum einsetzen."
allowed-tools: Bash(jht-reply-options *)
---
<!-- @translation: de, ai-translated 2026-08-03 -->

# Generierte Antwortoptionen im Spiel

Wenn die Nachricht des Nutzers nur wenige klare nächste Schritte zulässt, schließe
deinen Zug mit einer Frage und 2–5 Antworten ab, die genau für diesen Kontext erzeugt wurden:

```bash
jht-reply-options --prompt 'Womit fangen wir an?' \
  'Meine Zielrollen durchgehen' 'Lücken in meinem Profil prüfen' 'Die besten Positionen zeigen'
```

Das Spiel stellt diese Optionen als Buttons dar, freie Texteingabe bleibt dabei
weiterhin möglich. Ein Klick sendet den Text des Buttons als ganz normale Nutzernachricht zurück.

Regeln:

- Die Optionen sind freiwillig, auf das laufende Gespräch bezogen und nie aus dem
  offline verfassten Onboarding kopiert.
- Verwende 2–5 knappe Optionen, die sich sinnvoll ergänzen. Biete keine Scheinauswahl
  an, deren Ergebnis du gar nicht liefern kannst.
- `jht-reply-options` ist die letzte Antwort dieses Zuges. Lass darauf kein
  `jht-send` folgen, sonst würden die Buttons — zu Recht — unter der neueren Antwort verschwinden.
- Bei offenen Fragen oder einer direkten Antwort nutzt du wie immer `jht-send`.

## Ein `$` im Text: einfache Anführungszeichen oder stdin

In doppelten Anführungszeichen liest die Shell `$1` und `$2` als eigene Argumente und ersetzt sie durch nichts, **bevor das Tool startet**: „Plus — $20/month; Pro — $200/month“ kommt beim Nutzer als „Plus — 0/month; Pro — 00/month“ an, und danach kann niemand die Ziffern zurückbringen. Steht im Text ein `$` (Preise, Beträge), schreibe ihn in einfache Anführungszeichen oder übergib ihn über stdin.

```bash
# Single quotes for the labels; the prompt from stdin: "-" reads it, the quoted delimiter keeps every $
jht-reply-options --prompt - 'Plus — $20/month' 'Pro — $100/month' <<'TXT'
Which plan do you want? Plus — $20/month; Pro — $100/month
TXT
```

Schreibe das schließende `TXT` in die erste Spalte, allein in der Zeile, ohne Leerzeichen davor (kopierst du die Einrückung, schließt das Heredoc nie: ein Text, der mit einer Zeile `TXT` endet, wird abgelehnt, es wird nichts gesendet).
