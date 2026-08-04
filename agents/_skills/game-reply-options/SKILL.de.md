<!-- @translation: de, ai-translated 2026-08-03 -->
---
name: game-reply-options
description: "Biete im Chat des JHT-Spiels 2 bis 5 kontextspezifische, anklickbare Antwort-Buttons an, wenn sie dem Nutzer die nächste Entscheidung wirklich erleichtern. Nur für eine kleine, klar begrenzte Auswahl verwenden; sonst wie gewohnt mit jht-send antworten. Niemals als festen Onboarding-Baum einsetzen."
allowed-tools: Bash(jht-reply-options *)
---

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
