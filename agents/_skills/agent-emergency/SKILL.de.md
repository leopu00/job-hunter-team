<!-- @translation: de, ai-translated 2026-07-30 -->
---
name: agent-emergency
description: "Capitano — behandelt einen Agenten, bei dem der Verdacht besteht, dass er IN EINER AKTIVEN SCHLEIFE FESTHÄNGT (lebendig und Züge generierend, aber denselben Zyklus wiederholend, ohne etwas zu produzieren: ACK-Ping-Schleife mit einem Peer, dieselbe Aktion/Abfrage, die zu nichts führt). Deckt die Lücke zwischen C-08 (tot/still → Dottore) und C-12 (Verbrennen mit cadenza 0.00/min → kill) ab. Abgestufte Leiter, Dottore-ZUERST → kill + sauberer Respawn nur, wenn es anhält oder Budget verbrennt. Deterministische Erkennung (capture-pane-Diff + 0 DB-Fortschritt), Eskalationsentscheidung dem LLM überlassen."
allowed-tools: Bash(tmux *), Bash(jht-agent-contain *), Bash(jht-tmux-send *), Bash(/app/.launcher/spawn-doctor.sh *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *)
---

# agent-emergency — Agent in einer aktiven Schleife festgefahren

## Warum es sie gibt (die Lücke zwischen C-08 und C-12)

Die vorhandenen Signale decken zwei Fälle ab:
- **C-08** — ein **toter / stiller** Agent (Pane = bash, keine Züge) → Diagnose durch den **Dottore**.
- **C-12** — ein Agent, der mit `cadenza 0.00/min` und null Checkpoints **verbrennt** → Kill-Kandidat.

Der dritte fehlt: **ein Agent, der LEBENDIG und AKTIV ist und denselben Zyklus WIEDERHOLT, ohne etwas
zu produzieren**. Er generiert Züge (er ist also NICHT "tot" und hat NICHT `cadenza 0.00`), aber er
macht keine Fortschritte. Reale Beispiele:
- zwei Sitzungen, die sich endlos **ACK** hin und her werfen (Koordinations-Ping-Schleife);
- ein Worker, der **dieselbe Abfrage / dieselbe Aktion** wirkungslos wiederholt;
- ein Agent, der dieselbe nicht zugestellte Nachricht immer wieder verarbeitet.

Früher war das unsichtbar → der Capitano griff nie ein. Diese Skill macht es erkennbar und
handhabbar.

## Wann sie zu verwenden ist

**Bei VERDACHT**, nicht flächendeckend und nicht bei jedem Tick. Starte diese Prozedur, wenn dir
einer dieser Hinweise auffällt (meist während du etwas anderes tust): ein Agent, der seit einer Weile
"arbeitet", dessen Warteschlange aber nicht schrumpft / keine neue Position wechselt den Zustand;
oder du siehst denselben Austausch im Chat/Pane wiederholt.

## 1. DETERMINISTISCHE Erkennung (kein Augenmaß)

Bestätige die Schleife mit zwei günstigen Checks — **keine Nachricht an den Agenten** (störe ihn
nicht, das ist Tier-2-Pull):

```bash
# (a) WIEDERHOLUNG — zeigt das Pane denselben Austausch/dieselbe Ausgabe N-mal?
#     Zwei zeitlich versetzte Captures: ist der "neue" Inhalt identisch → es wiederholt sich.
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_1.txt
sleep 20
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_2.txt
diff /tmp/ae_1.txt /tmp/ae_2.txt        # wenig/kein Unterschied an "echter Arbeit" = Schleifenverdacht

# (b) 0 DB-FORTSCHRITT — ist der Agent "aktiv", bewegt aber nichts in der DB?
#     Falls verfügbar, der Observability-Helper pro Agent (er nutzt
#     position_state_transitions wieder): 0 kürzliche Übergänge für diesen Agenten = keine Ausgabe.
python3 /app/shared/skills/db_query.py recent-activity   # by_agent: 0 für die Sitzung = keine Ausgabe
#     Generischer Fallback: die Warteschlange vor dem Agenten schrumpft zwischen zwei Checks NICHT
#     (z. B. next-for-analista unverändert, während ANALISTA-N "arbeitet").
```

**SCHLEIFEN-Urteil** = (a) Wiederholung **UND** (b) 0 Fortschritt, über ≥ 2-3 Beobachtungen. Zeigt das
Pane stattdessen `Working… / esc to interrupt` mit Inhalt, der sich weiter ändert, dann ist es eine
**lange Aufgabe, die LEBT** (C-08 bis): das ist KEINE Schleife, lass sie in Ruhe.

## 2. Abgestufte Leiter — Dottore-ZUERST

### Stufe 1 — außerordentliche Dottore-Runde (ERSTE Intervention)

Eine Kontext-Auffrischung durchbricht die Schleife oft **ohne Zustandsverlust**. Verwende die
`spawn-doctor`-Skill:

```bash
bash /app/.launcher/spawn-doctor.sh
sleep 10
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Gezielte Runde: <SESSION> scheint in einer aktiven SCHLEIFE festzuhängen (sie wiederholt <was>, 0 DB-Fortschritt über N Ticks). Diagnostiziere sie und, falls bestätigt, frische die Sitzung auf / repariere sie. Melde dich mit [RES] zurück."
# Warte auf das [RES] des Dottore — kein Polling.
```

### Sicherheits-Containment — KEIN Neustart

Wenn die Sitzung unten bleiben muss, niemals rohes `tmux kill-session` verwenden:

```bash
jht-agent-contain <SESSION> --by "$JHT_AGENT_NAME" --reason "<beobachteter Sicherheitsgrund>"
```

Der Befehl sichert zuerst den Pane, setzt den sticky Zustand `contained` und
stoppt erst danach die exakte Sitzung. Nur ein explizites Release hebt ihn auf:

```bash
jht-agent-contain <SESSION> --release --by "$JHT_AGENT_NAME" --reason "<warum jetzt sicher>"
```

### Stufe 2 — Kill (+ Respawn) — NUR wenn nötig

Kill **nur wenn**: die Schleife **nach dem Dottore fortbesteht**, *oder* sie **ernsthaft Budget
verbrennt** (hohe Rate + 0 Ausgabe über ≥ N Ticks und es ist keine Zeit für eine Diagnose).

⚠️ **SCHUTZ gegen Doppel-Spawn mit dem Watchdog.** `agent-watchdog.sh` respawnt automatisch (≤30s)
**nur die 3 Core-Agenten**: `ASSISTENTE`, `CAPITANO`, `MENTOR`. Er deckt die Worker NICHT ab. Der
Respawn hängt also vom Ziel ab:

- **Ziel = CORE-Agent (ASSISTENTE / MENTOR)** → **NUR killen**. Der Watchdog erkennt es und
  **respawnt ihn von selbst sauber** (`jht team start <role>`, idempotent, frischer Zustand). Führe
  `start-agent.sh` **NICHT** zusätzlich selbst aus → das wäre ein Doppel-Spawn (das gemeldete Race).
  Der "Backoff" ist faktisch das Watchdog-Intervall (~30s). (Der CAPITANO bist du: er ist nie das
  Ziel — du killst dich nicht selbst.)
  ```bash
  tmux kill-session -t <SESSION>     # STOPP hier: der Watchdog respawnt sauber innerhalb von 30s
  ```
- **Ziel = WORKER (Scout / Analista / Scorer / Scrittore / Critico)** → der Watchdog deckt sie NICHT
  ab, also **killst du + Backoff + Respawn** (kein Race):
  ```bash
  tmux kill-session -t <SESSION>
  sleep 5                                                 # Backoff: nicht direkt zurück in die Schleife fallen
  bash /app/.launcher/start-agent.sh <role> <N>          # SAUBERER Respawn (frischer Zustand)
  ```

Der Backoff + der Respawn mit frischem Zustand verhindern, dass er in genau demselben Zyklus wieder
anläuft; die Core-Agenten nicht selbst zu respawnen vermeidet das Race mit dem Watchdog.

## Regeln

- **Dottore ZUERST, Kill DANACH.** Kille nie beim ersten Verdacht: eine legitime lange Aufgabe sieht
  "festgefahren" aus, ist aber lebendig (C-08 bis). Der Kill ist das letzte Mittel.
- **Erkennung und Kill sind deterministisch; die Eskalation ist deine Entscheidung (LLM).** Sitze
  nicht bei jedem Tick starrend vor den Panes: wende diese Prozedur an, wenn ein Verdacht reift.
- **Störe den Peer nicht, um zu ermitteln.** Die Checks sind Pull (capture-pane + DB), keine
  Nachricht an den verdächtigen Agenten (das würde der Schleife nur einen weiteren Zug hinzufügen).
- **Kille niemals Service-Sitzungen `*-WORKER-*`**, wenn du nicht weißt, was sie sind — prüfe zuerst
  die Rolle.
