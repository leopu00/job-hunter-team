<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: bridge-mailbox
description: Ausstehende Bridge-Urteile am ANFANG jeder Captain-Runde abrufen — VERPFLICHTENDE erste Aktion bevor irgendetwas anderes getan wird. Während einer langen Runde kann `jht-tmux-send` von der Bridge mit rc=3 fehlschlagen (Text erschien nie im Panel) und ein `[BRIDGE PACING]`- oder `PIPELINE STALLED`-Urteil wird stillschweigend verworfen. Die Bridge hängt JEDES Urteil an eine JSONL-Mailbox an, damit du sie wiederherstellen kannst. Das Überspringen dieses Abrufens bedeutet, auf veralteten Messungen zu handeln, während ein frischeres Urteil ungelesen bereitliegt.
allowed-tools: Bash(python3 /app/shared/skills/bridge_mailbox.py *)
---

# bridge-mailbox — verpasste Urteile wiederherstellen

Die Bridge kommuniziert mit dir über tmux, aber die tmux-Zustellung kann während einer langen Runde stillschweigend fehlschlagen (Codex / Kimi TUI-Rendering-Probleme, du warst in einem langen Tool-Aufruf etc.). Um sicherzustellen, dass kein Urteil verloren geht, hängt die Bridge **auch** jeden Tick an eine JSONL-Mailbox unter `$JHT_HOME/logs/bridge-mailbox.jsonl` an. Du leerst sie am Anfang jeder Runde.

## Die verpflichtende erste Aktion

Vor *allem anderen* — bevor du Nachrichten liest, bevor du Aktionen entscheidest, bevor du einen anderen Skill öffnest — führe aus:

```bash
python3 /app/shared/skills/bridge_mailbox.py drain
```

Mögliche Ausgaben:
- `no pending verdicts` → Mailbox leer, normal mit der Runde fortfahren.
- Eine oder mehrere Zeilen, formatiert wie Live-tmux-Ticks (`[BRIDGE PACING] ...`, `PIPELINE STALLED ...`, `[BRIDGE ALERT] ...`).

`drain` konsumiert die Einträge (sie werden bei Erfolg als gelesen markiert) — erneutes Ausführen gibt `no pending verdicts` zurück, bis die Bridge neue anhängt.

## Wie abgerufene Urteile angewendet werden

Verarbeite ALLE Zeilen, aber **handle nur nach der letzten**. Die früheren sind bereits veraltet — die Metriken haben sich seitdem verändert. Zwei Ausnahmen, bei denen eine frühere Zeile noch relevant ist:

1. **`PIPELINE STALLED` kürzlich (< 30 Min.) und noch relevant** (proj ist immer noch niedrig, team_kt ist gerade immer noch niedrig). Handle nach dem Playbook (Pipeline upstream neu befeuern) selbst wenn ein späterer gültiger `[BRIDGE PACING]` danach ankam. Stalls sind Zustände, nicht Ereignisse — sie müssen aufgelöst werden, nicht nur gemessen.
2. **Ein `[PAUSA TEAM]` / `[HARD FREEZE]`, den du verpasst hast**. Wenn einer in der Warteschlange ist und du noch kein `[RIPRENDI]` gesendet hast, ist das Team immer noch eingefroren — behandle es mit `sentinel-orders` *bevor* du das neueste Pacing anwendest.

Für den Routinefall (eine oder mehrere `[BRIDGE PACING]`-Zeilen):
- Lies jede Zeile, um den zeitlichen Kontext zu behalten (du kannst sehen, wie sich der Trend entwickelt hat, während du beschäftigt warst)
- Öffne den `bridge-pacing`-Skill einmal und wende nur die Kalibrierung des **letzten** Urteils an

## Andere Befehle (Debug / Inspektion)

```bash
python3 /app/shared/skills/bridge_mailbox.py status   # wie viele ausstehend vs gesamt
python3 /app/shared/skills/bridge_mailbox.py peek     # lesen ohne zu konsumieren
```

Verwende `peek`, wenn du etwas Verdächtiges vermutest und schauen willst, ohne zu committen — es markiert Einträge NICHT als gelesen.

## Anti-Patterns

- ❌ Den Drain überspringen "weil die Runde kurz aussieht" — die rc=3-Fehler treten unvorhersehbar auf; ein verpasster Tick während einer langen Runde ist der typische Fall.
- ❌ Auf jede abgerufene Zeile nacheinander reagieren — du würdest veraltete Throttle-Änderungen wiederholen, gegen deine eigenen vergangenen Kalibrierungen kämpfen und das Team zum Oszillieren bringen.
- ❌ `drain` mitten in der Runde ausführen, nur um zu "sehen was reinkam" — drain konsumiert; wenn du nicht bereit bist, auf die Zeilen zu reagieren, verwende stattdessen `peek`.
- ❌ `peek`-Output als maßgeblich behandeln — `peek` zeigt ausstehende Einträge, aber das Live-tmux-Panel enthält möglicherweise bereits neuere, die das JSONL noch nicht erfasst hat. Der Drain am Rundenbeginn gibt dir das konsistente Bild.

## Siehe auch

- `sentinel-orders` — leitet `[PAUSA TEAM]` / `[HARD FREEZE]` / `[RIPRENDI]` weiter, sobald abgerufen.
- `bridge-pacing` — Formel zur Anwendung auf die letzte `[BRIDGE PACING]`-Zeile.
- `pipeline-triage` — Playbook für `PIPELINE STALLED` (Pipeline upstream neu befeuern).
