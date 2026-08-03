<!-- @translation: de, ai-translated 2026-08-03 -->
---
name: captain-diary
description: "Tägliches Übergabe-Tagebuch für den Capitano. Der Capitano wird häufig neu gestartet (Context-Refresh, neues Arbeitsfenster, Reboot) und verliert sonst die mühsam erarbeiteten Pacing-Lektionen des Tages — er wiederholt dieselben Fehler (z. B. 3 Scout auf einmal → ein nicht bremsbarer Spike → 5 h Drosselung, um die Schuld abzutragen). Lies beim Start die Notizen des VORTAGS (handoff) und HÄNGE eine einzeilige Notiz an, sobald im Laufe des Tages etwas Bedeutsames passiert (eine Scaling-Entscheidung, ein Spike, ein Kill, eine Lektion). Eine Append-only-Datei pro Tag."
allowed-tools: Bash(python3 /app/shared/skills/captain_diary.py *)
---

# captain-diary — die Übergabe zwischen Capitanos

Eine Datei pro Tag in `$JHT_HOME/logs/captain-diary-YYYY-MM-DD.md`, append-only.
Ihre Aufgabe ist es, dich davor zu bewahren, **bei jedem Neustart von vorn
anzufangen**: die Pacing-Lektionen von heute werden an den Capitano von morgen
übergeben.

## Beim Aufwachen (IMMER, vor der Arbeit)

Lies die Notizen, die der Capitano des Vortags hinterlassen hat:

```bash
python3 /app/shared/skills/captain_diary.py handoff
```

Es gibt die Notizen von **gestern** aus (oder die des zuletzt gearbeiteten
Tages) plus alles, was **heute** bereits erfasst ist. Du erbst die Lektionen →
**wiederhole nicht dieselben Fehler**. Ist nichts da, bist du der Erste: fang an
zu erfassen.

## Im Laufe des Tages — erfasse die BEDEUTSAMEN Ereignisse

Eine Zeile, immer wenn etwas passiert, das eine Lektion enthält. KEIN Tagebuch
über alles: nur das, was der Capitano von morgen brauchen würde.

```bash
python3 /app/shared/skills/captain_diary.py add "20:05 — 3 Scout auf einmal: nicht bremsbarer \
Spike innerhalb von 15 Min., 5 h Drosselung, um die Schuld abzutragen. Lektion: max. 1 Scout, \
dann 30 Min. Beobachtung (C-02)."
```

Was festzuhalten sich lohnt:
- Scaling-Entscheidungen, die schlecht (oder gut) ausgingen — wie viele Worker, welcher Throttle, was passiert ist;
- ein Spike, den du nicht bremsen konntest, und wie du dich davon erholt hast;
- ein Kill und warum;
- ein Muster, das sich abgezeichnet hat (z. B. "der Scout auf Seite X verbraucht doppelt so viel");
- alles, was dir morgen — wenn du es wüsstest — einen Fehler ersparen würde.

## Nur den heutigen Tag durchsehen

```bash
python3 /app/shared/skills/captain_diary.py today
```

## Regel

- Das Tagebuch ist der **Staffelstab**: lies es beim Boot, füttere es im Laufe des Tages.
- Notizen müssen **kurz und handlungsleitend** sein (ein Fakt + die Lektion), kein wortreiches Log.
- Den Zeitstempel setzt das Tool: du schreibst nur den Fakt und die Lektion.
