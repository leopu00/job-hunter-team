---
name: codex-dialog
description: Unterscheide einen Dialog der verwalteten Codex-CLI von einem toten Worker, bevor du ihn wiederherstellst oder ersetzt.
---
<!-- @translation: de, ai-translated 2026-11-07 -->

Nutze diese Skill nur für Agenten in der **Codex-Terminal-CLI**, nicht in der API-Laufzeit.
Eine Meldung `[CODEX-DIALOG]` bezeichnet einen eigenen Zustand und beweist nicht,
dass der Worker tot ist. Der Watchdog erkennt den sichtbaren Modellhinweis,
behält das aktuelle Modell bei und meldet das Ergebnis der Wiederherstellung.
Er ersetzt keine Sitzung, bestätigt keine Vertrauensanfragen, wechselt kein Modell,
aktualisiert die CLI nicht und erteilt keine Zugriffsrechte.

Lies die letzte gespeicherte Beobachtung, ohne Eingaben zu senden:

```bash
python3 /app/shared/skills/codex_dialog.py status SCORER-1
```

`last_observation` und `at` beschreiben die letzte Prüfung, garantieren aber nicht,
dass der Agent noch aktiv ist. `codex_dialog_recovered` bedeutet, dass derselbe
Bereich wieder zur Eingabe oder zur Arbeit zurückgekehrt ist. `codex_dialog_ready`
meldet eine spätere gesunde Beobachtung, ohne automatische Wiederherstellung zu
behaupten. `pending`, `timeout`, `changed`, `unrecognized` und `io_error` müssen
untersucht werden. Die vollständigen Codes beginnen mit `codex_dialog_`.

Melde dem Benutzer diesen Zustand, bevor du manuelle Wiederherstellung oder Ersatz entscheidest.
Klone, beende oder ersetze den Worker nicht stillschweigend. Lass einen ungelösten
Dialog vom Dottore diagnostizieren und erkläre die vorgeschlagene Maßnahme. Sende
niemals blind Enter und wähle kein vorgeschlagenes Modell. Normale Nachrichten
verwenden weiterhin `tmux-send` und dessen Bereitschaftsprüfungen. Ein wirklich
erschöpftes Kontingent, eine Anmeldung oder Vertrauensanfrage sind keine erfolgreiche Wiederherstellung.
