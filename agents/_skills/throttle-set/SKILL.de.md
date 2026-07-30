<!-- @translation: de, ai-translated 2026-07-30 -->
---
name: throttle-set
description: Der EINZIGE Weg, auf dem die Rhythmen des Teams geschrieben werden. Nur der Kapitaen. `throttle-set <agent> <sekunden>` bearbeitet die Throttle-Config pro Agent; die Engine liest sie neu, wenn sie jeden Timer armiert, also greift die Aenderung von selbst im NAECHSTEN Zyklus dieses Agenten - keine tmux-Nachricht, kein Agent muss etwas neu lesen, und der bereits laufende Zyklus wird nicht gestoert. Nutze es, statt Zahlen an Worker zu schicken. Ausserdem `throttle-set a=N b=M ...` fuer einen atomaren Mehrfach-Write, `--dump` fuer die effektiven Werte, `--get <agent>`, `--reset`.
allowed-tools: Bash(throttle-set *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle-set — die Rhythmen steuern, ohne die Agenten anzufassen

```bash
throttle-set <agent> <sekunden>             # ein Agent
throttle-set scout-1=660 analista-1=300     # mehrere, ein atomarer Write
throttle-set --dump                         # die EFFEKTIVEN Werte jetzt
throttle-set --get <agent>                  # der effektive Wert eines Agenten
throttle-set --reset                        # alle Overrides verwerfen
```

## Warum du nie eine Zahl per tmux schickst

Die Throttle-Engine liest die Config **in dem Moment, in dem sie jeden Timer
armiert**. Also:

- ein Wert, den du hier aenderst, greift von selbst im **naechsten** Zyklus dieses
  Agenten;
- der **laufende** Zyklus bleibt unberuehrt — seine Faelligkeit war schon
  berechnet, und sie zu verschieben waere eine Ueberraschung, die niemand wollte;
- Worker sehen nie eine Zahl und erfahren nie, wie lange sie warten. Sie rufen
  `throttle <ihr-name>` und halten an. Die Dauer gehoert allein dir.

Das ist der ganze Grund, warum es dieses Werkzeug gibt: fuenf tmux-Nachrichten mit
einer Zahl sind fuenf Chancen, mit einem Agenten mitten in der Pause zu
kollidieren. Ein atomarer Write ist keine.

## Was du zurueckbekommst, ist der EFFEKTIVE Wert, nicht der gewuenschte

Zwei automatische Korrekturen greifen beim Lesen, die Zahl, die der Agent
tatsaechlich erhaelt, kann also von deiner abweichen:

- **Worker floor, 5 Min.** Worker (Scout/Analyst/Scorer/Schreiber/Kritiker) gehen
  nie unter 300s, `0` eingeschlossen. Es stammt aus einem gemessenen Vorfall — ein
  Scout ohne Pause verbrannte ~308kT fuer 3 Positionen mit schmutzigen Daten. Der
  interaktive Kern (Kapitaen/Sentinel/Assistent/Mentor) hat **keinen** Floor: er
  muss fuer den Chat des Nutzers reaktiv bleiben, dort bleibt `0` also `0`.
- **Koprime Leiter.** Jeder Wert > 0 rastet auf eine Sprosse in Primminuten ein
  (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60). Sprossen als Vielfache von 5
  synchronisierten Worker *konstruktionsbedingt* wieder auf: 5+10 fielen alle 10
  Minuten zusammen. Koprime Sprossen machen Kollisionen selten statt periodisch.

`throttle-set scout-1 120` liest sich also als `300` zurueck. Das ist nicht das
Werkzeug, das dich ignoriert — es ist der Wert, den der Agent erhaelt, und das ist,
was `--dump` zeigt.

Beide treten zurueck, solange die befristete Ausnahme des Nutzers lebt, und kommen
bei ihrem Ablauf von selbst wieder. Du musst nicht daran denken, sie
wiederherzustellen.

## Um mehr zu VERBRAUCHEN ist der Hebel Parallelitaet, nicht ein kleinerer Throttle

Worker gehen nicht unter 5 Min, "setz den Throttle auf 0" existiert fuer sie also
nicht. Liegt das Team unter dem Zielrhythmus, fuege Worker **in Stufen** hinzu;
versuche nicht, es durch Abschleifen der Pause aufzuholen. Ein gesaettigter
Throttle ist ein Signal, kein Ziel: wenn ein Agent schon hoch auf der Leiter steht
und weiter ueberzieht, wird der Hebel, ihn zu beenden — nicht ein weiterer Anstoss.

## Exit codes

- `0` — geschrieben / gelesen
- `1` — ungueltige Argumente, Wert ausserhalb 0..3600, oder Config fehlt

## Beispiel

```bash
throttle-set --dump
# default = 0s
# scout-1        = 660s
# analista-1     = 300s

throttle-set scout-1 1380
# scout-1=1380s

# scout-1 ist mitten in der Pause: es behaelt seine 660s und erhaelt 1380s im
# naechsten Zyklus. Niemand hat ihm etwas gesagt.
```
