<!-- @translation: de, ai-translated 2026-08-03 -->
---
name: scaling-calc
description: "Schrittweise Kalibrierung des Rosters — miss den Burn von 1 Worker, berechne, wie viele Worker und welcher Throttle nötig sind, um die Zielgeschwindigkeit zu treffen, und spawne in Stufen (nie im sechsten Gang)."
---

# 🎚️ scaling-calc — schalte einen Gang nach dem anderen, nicht direkt in den sechsten

Wenn das Team das Arbeitsfenster öffnet (oder du mehr verbrauchen musst), fahre **NICHT**
im sechsten Gang los ("Budget im Überfluss → 5 Scouts spawnen / Throttle auf 0"): du weißt
noch nicht, wie viel ein Worker in DIESEM Zyklus wirklich verbraucht. Du kalibrierst in Stufen.

## Vorgehen

**1. Beginne mit 1 EINZIGEN Worker** am Floor (5min, das Minimum für Worker).

**2. Beobachte ~30 min**, um den echten Burn zu messen. Lies den Burn des Workers:
```
python3 /app/shared/skills/rate_budget.py            # nachhaltige Zielgeschwindigkeit (S)
# Burn pro Agent: aus der Tabelle, die dir die Sentinella weiterleitet, oder:
python3 /app/shared/skills/agent-speed-table.py
```
Nimm: **S** = nachhaltige Geschwindigkeit (z. B. `sustainable_burn` %weekly/h) und **b** = der
gemessene Burn des Workers (gleiche Einheit).

**3. Berechne** Roster + Throttle:
```
python3 /app/agents/_skills/scaling-calc/scaling_calc.py --target <S> --measured <b>
# wenn du N Worker bei Throttle T beobachtet hast:
python3 .../scaling_calc.py --target <S> --measured <b_total> --workers <N> --throttle <T>
```
Es liefert dir: **wie viele Worker**, **welchen Throttle** und einen **Stufenplan**.

**4. Spawne IN STUFEN** nach dem Plan: **einen nach dem anderen**, mit **erneuter Messung** vor
dem nächsten (~10 min reichen, um den Burn des Neuzugangs zu sehen). Spawne NIEMALS den ganzen
Block auf einmal.

> Diese 10 Minuten sind ein **Beobachtungsfenster**, keine Phasenverschiebung: der Phasenabstand
> zwischen zwei Workern auf derselben Stufe ist `T/N` (die Periode geteilt durch die Zahl der
> Worker, die sie sich teilen), und der Launcher wendet ihn beim Spawn von selbst an. Das ist
> keine Zahl, die hier zu entscheiden wäre, und keine Konstante: auf einer 5-Minuten-Stufe wollen
> drei Worker 100s voneinander entfernt sein.

## Die zwei Hebel
- **Worker unter dem Ziel** (1 Worker verbrennt weniger als das Ziel) → der Hebel ist die
  **Anzahl der Worker** (Parallelität), alle **am Floor**. Füge sie in Stufen hinzu.
- **Worker über dem Ziel** (1 Worker verbrennt bereits mehr als das Ziel) → der Hebel ist der
  **Throttle**: behalte 1 Worker und **erhöhe** dessen Throttle (das Tool gibt dir den exakten
  Wert). Setze den Throttle NIEMALS auf null (Worker haben ohnehin einen 5min-Floor).

## Was du NICHT tun sollst
- ❌ "Team ON, Budget im Überfluss → ALLES BESCHLEUNIGEN" — genau diese Hektik verbrennt ein
  Budgetfenster in 25 min für null Output. **BESCHLEUNIGEN = EINE Stufe hoch** (ein Worker mehr
  oder eine Throttle-Stufe weniger **bis hinunter zum Floor**), dann erneut messen.
- ❌ 2-3 Worker zusammen spawnen. Immer **versetzt**.
- ❌ Throttle 0 bei einem Worker (unmöglich: 5min-Floor; und ohnehin ist genau das der Stoff, aus dem Marathons sind).

## Beispiel
1 Scout am Floor (5min) hat **1.4%/h** verbrannt, nachhaltiges Ziel **0.7%/h**:
```
scaling_calc.py --target 0.7 --measured 1.4
→ 1 Worker @ 600s (10min) → Burn ≈ 0.7/h   (einfach den Throttle erhöhen, kein Spawn)
```
Verbrennt 1 Scout stattdessen nur **0.3%/h** bei einem Ziel von 0.7:
```
→ 2 Worker @ 300s (Floor), in Stufen: #1 spawnen, 10min beobachten, erneut messen, dann #2.
```
