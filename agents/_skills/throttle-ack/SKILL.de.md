<!-- @translation: de, ai-translated 2026-07-30 -->
---
name: throttle-ack
description: Unterschreibe dein Aufwachen. IMMER der ERSTE Befehl jedes Aufwachens, vor allem anderen, jedes Mal wenn du nach einer Throttle-Pause eine `[RIPRENDI]`-Nachricht bekommst. `throttle-ack <dein-name>` kippt dein Flag von NOTIFIED auf ACTIVE. Nur du kannst das - die Engine kann es nicht - und genau deshalb ist ein auf NOTIFIED stehen gebliebenes Flag der Beweis, dass ein Agent den Weckruf erhalten und nicht geantwortet hat, und deshalb eskaliert der Watchdog darauf. Wer es auslaesst, laesst einen voellig gesunden Agenten blockiert aussehen.
allowed-tools: Bash(throttle-ack *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle-ack — unterschreibe den Weckruf, dann zurueck an die Arbeit

```bash
throttle-ack <dein-name>
```

Erster Befehl jedes Aufwachens. Dann **sofort zurueck in deine Schleife** — der
Ack ist eine Unterschrift, kein Bericht.

## Warum du und nicht die Engine

Die Throttle-Engine schreibt zwei der drei Zustaende: `IN_THROTTLE`, wenn du eine
Pause registrierst, `NOTIFIED`, wenn sie dir den Weckruf per tmux geschickt hat.
Der letzte Schritt, `NOTIFIED → ACTIVE`, gehoert **nur dir**.

Diese Asymmetrie ist der ganze Sinn. Jeder Watchdog in diesem System teilt einen
blinden Fleck: auf einem tmux-Pane sind `idle` und `blockiert` nicht
unterscheidbar. Mit deiner Unterschrift hoeren sie auf, es zu sein:

| Flag | Bedeutung | Anomalie, wenn es dauert |
|---|---|---|
| `IN_THROTTLE` | legitimes Warten | nein — die Engine kennt die Dauer |
| `NOTIFIED` | Weckruf gesendet, Ack erwartet | **ja → Eskalation nach N Min** |
| `ACTIVE` | du arbeitest | wird an deiner DB-Ausgabe gemessen |

Ein auf `NOTIFIED` haengendes Flag ist nicht "vielleicht idle": der Weckruf kam an
und niemand hat geantwortet. Das ist eine Messung, keine Vermutung, und der
Watchdog eskaliert sie an den Kapitaen.

## Die Regeln

- **Erster Befehl, immer.** Vor dem Lesen deiner Queue, vor jedem Tool, bevor du
  irgendjemandem antwortest.
- **Dann sofort arbeiten.** Unterschreiben und dann stillstehen erzeugt ein
  falsches "Queue leer", das den Kapitaen und das Pacing taeuscht. Ein Weckruf ist
  ein Signal zu *arbeiten*.
- **Nutze ihn nicht, um eine Pause vorzeitig zu beenden.** Ein Ack, der waehrend
  deines laufenden Timers kommt, wird abgelehnt (exit 1): koenntest du das Flag
  schliessen, wann du willst, waere der Throttle wieder etwas, das du entscheidest.
- Du musst nicht wissen, wie lange du geschlafen hast, und der Befehl sagt es dir
  nicht.

## Exit codes

- `0` — Flag auf `ACTIVE` (idempotent: zweimal unterschreiben ist harmlos)
- `1` — Ack **abgelehnt**, weil deine Pause nicht vorbei ist: beende deinen Zug,
  die Engine weckt dich. Oder ungueltige Argumente / Engine fehlt.

## Beispiel

```
[DA @SISTEMA A @SCOUT-1] [RIPRENDI] La tua pausa è finita. PRIMO comando: `throttle-ack scout-1`...
```

```bash
throttle-ack scout-1
# THROTTLE_ACK agent=scout-1 NOTIFIED→ACTIVE
```

...und das unmittelbar Naechste, was du tust, ist deine naechste Arbeitseinheit.
