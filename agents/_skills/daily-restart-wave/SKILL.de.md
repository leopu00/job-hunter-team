<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: daily-restart-wave
description: "Präventiver Massen-Neustart jedes Team-Agenten einmal pro 24h für Kontextfrische. Zuständig: Dottore. Läuft nur innerhalb eines engen täglichen Fensters (Standard 03:00 UTC ± 30 Min.) und nur wenn keine Welle in den letzten 23h ausgelöst wurde. Jeder Agent wird beendet + über die gleiche atomare Sequenz wie `liveness-check` Schritt 3 neu gespawnt, geordnet Tier 3 → Tier 2 → Tier 1, damit die Worker zuerst durchlaufen und die Koordinatoren (Capitano/Sentinella/Mentor/Assistente) zuletzt. Hintergrund: Codex/Kimi Langzeit-Sitzungen akkumulieren 'Rauschen' — alte Entscheidungen, veraltete Fakten, Prompt-Drift — und werden nach Stunden messbar weniger klar. Empirischer Beleg aus Case Study #1 (Codex-Lauf 2026-05-19/21): manueller Massen-Neustart stellte Entscheidungsqualität wieder her. Dieser Skill schließt diese Lücke ohne manuellen Eingriff."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *), Bash(cat *), Bash(mkdir *), Bash(date *)
---

# daily-restart-wave — präventiver Neustart für Kontextfrische

Die normale Aufgabe des Dottore (`liveness-check`) ist **konservativ**: nur die still gestorbenen neu starten. Dieser Skill ist das Gegenteil: **alle bewusst neu starten, einmal am Tag**, weil Langzeit-Agenten-Sitzungen driften, auch wenn sie nicht sterben. Gleiche atomare Respawn-Primitive (`liveness-check` Schritt 3), anderer Trigger und andere Reihenfolge.

## Warum das existiert

Empirisch: In Case Study #1 (Codex-Lauf 2026-05-19/21, siehe `docs/about/RESULTS.md`) bemerkte der Betreuer Verfall der Entscheidungsqualität nach ~12-24h kontinuierlicher Agenten-Laufzeit — wiederholte Fehler, Bezug auf veraltete Fakten, gelegentliches Ignorieren expliziter Nutzer-Anweisungen. Eine manuelle "starte alle neu"-Anweisung nach ~30h stellte sichtbar die Klarheit wieder her. Codex zeigt kein Kontextfenster wie Claude/Kimi an, daher ist der Drift unsichtbar, bis man Vorher/Nachher vergleicht.

Theoretisch: Jede LLM-Sitzung ist eine lange Konversation. Wenn Token sich akkumulieren, tendiert das Modell dazu:
- Sich auf frühe Entscheidungen zu verankern, die falsch gewesen sein könnten
- Anhand veralteter Fakten zu schlussfolgern (eine Stellenanzeige, die geschlossen wurde, eine Strategie, die überarbeitet wurde)
- Langsamer pro Runde zu werden (mehr KV-Cache zu beachten)
- Unter Nutzerdruck vom System-Prompt abzudriften ("der Team-Rules-Sweep")

Ein frischer Boot liest den Prompt + aktuellen DB-Status + Übergabe-Snapshots neu und entscheidet von sauberer Grundlage. Kosten: ~2 Min./Agent "ich hole auf". Nutzen: Stunden vermiedener niedrigqualitativer Output.

## Wann auslösen — die 3 Gate-Bedingungen

ALLE DREI müssen wahr sein. Andernfalls mit `status=skipped` und einem `reason`-Feld im Log überspringen.

1. **Innerhalb des täglichen Fensters**. Standard: 03:00 UTC ± 30 Min. (d.h. 02:30-03:30 UTC). Begründung: Fenster mit geringer Nutzeraktivität für europäische/US-Tagesnutzer; wenn der Nutzer schläft, ist die ~10 Min. Neustart-Parade unsichtbar. Aktuelle Stunde lesen:

   ```bash
   now_h=$(date -u +%H)
   now_m=$(date -u +%M)
   # 02:30 ≤ now ≤ 03:30
   in_window=$([ "$now_h" = "02" -a "$now_m" -ge "30" ] || [ "$now_h" = "03" -a "$now_m" -le "30" ] && echo yes || echo no)
   ```

2. **Keine Welle in den letzten 23h ausgelöst** (Anti-Thrash). `/jht_home/logs/daily-restart-wave-state.json` lesen:

   ```json
   { "last_wave_at": "2026-05-30T03:11:42Z", "agents_restarted": 9, "duration_sec": 612 }
   ```

   Wenn die Datei nicht existiert → als "nie ausgelöst" behandeln → Bedingung ist wahr.
   Wenn `now - last_wave_at < 23h` → mit `reason=anti_thrash` überspringen.

3. **Team ist nicht in `.team-halted.flag` oder `.weekly-halt.flag`**. Wenn eines der Flags existiert, hat der Nutzer das Team explizit pausiert — jetzt neu zu starten wäre feindlich.

   ```bash
   [ -f /jht_home/.jht/.team-halted.flag ] && skip
   [ -f /jht_home/.jht/.weekly-halt.flag ] && skip
   ```

Wenn alle 3 bestehen → fortfahren. Der gesamte 3-Prüfungs-Block ist `<2s`, läuft bei jedem Dottore-Aufwachen, kostet nichts wenn außerhalb des Fensters.

## Reihenfolge des Neustarts — Tier 3 → Tier 2 → Tier 1

Umgekehrt zum `liveness-check` (der nutzerorientierte ZUERST prüft, damit sie nicht unbemerkt sterben). Für eine präventive Welle wollen wir das Gegenteil: **Worker zuerst, Koordinatoren zuletzt**, damit der Capitano der letzte ist, der seinen Thread verliert, und beobachten kann (in seinem Panel), dass alle seine Worker frisch zurückgekommen sind, dann wird er selbst recycelt und startet den neuen Tag mit sauberem Zustand.

```
TIER 3 (Worker, ZUERST neu starten):
  SCOUT-*, SCRITTORE-*, CRITICO-*, ANALISTA-*, SCORER-*

TIER 2 (Semi-Koordinatoren):
  (heute keine — reserviert für zukünftige "untergeordnete Koordinatoren")

TIER 1 (nutzerseitig langlebig, ZULETZT neu starten):
  ASSISTENTE, MENTOR, SENTINELLA, CAPITANO   (Capitano als allerletzter)
```

Leere Sitzungen von Tier 3 (z.B. `SCRITTORE-*` wenn kein CV in Bearbeitung ist per Writer-on-demand V6) → still überspringen, kein Kill, kein Respawn. Der nächste bedarfsgesteuerte Spawn vom Capitano wird ohnehin frisch sein.

## Benachrichtigung an den Capitano — 10 Minuten vorher

Der Capitano koordiniert Spawn/Skalierung. Wenn er gerade einen Scrittore-Burst spawnen will und wir ihn 30s später beenden, stirbt der Spawn mitten im Flug. Daher:

1. **Zum Zeitpunkt t=0 der Welle** (Entscheidung zum Auslösen getroffen), BEVOR ein Agent berührt wird, dem Capitano eine Vorankündigung via `tmux-send` senden:

   ```
   [HEADS-UP DOTTORE → CAPITANO] Daily restart wave parte fra 10 min.
   Non spawnare nuovi worker fino a NEW DAY. Termina task <5min in corso.
   Quando arriva il tuo turno (ultimo), ti riavvio io.
   ```

2. **10 Min. schlafen**. Dem Capitano Zeit geben, kurzlebigen Zustand abzuarbeiten.

3. **Dann die Parade starten** in der Tier 3 → Tier 1 Reihenfolge.

Wenn der Capitano bereits ein Zombie ist (nackte Bash), die Vorankündigung überspringen und direkt zur Parade gehen — es gibt nichts zu koordinieren.

## Die Respawn-Primitive — Schritt 3 von liveness-check wiederverwenden

Für jede Zielsitzung, unabhängig vom Liveness-Zustand:

```
a. tmux capture-pane -t <SESSION> -S -200 -p > /tmp/$session-pre-restart.log
b. python3 /app/shared/skills/db_query.py <agent-role> --recent-context   (optional)
c. tmux kill-session -t <SESSION>
d. bash /app/.launcher/start-agent.sh <agent-role> [<instance-num>]
e. sleep 8s   (CLI booten lassen)
f. tmux send-keys -t <SESSION> "RESUME: daily restart wave. Riprendi dai recenti log DB (db-query) + tuo prompt di identità. Nessuna task short-lived persa: il Capitano ha dranato la coda 10 min fa." Enter
g. log event=agent_restarted, agent=<role-N>, duration_ms=<X>
```

Hinweise:
- Der Panel-Capture geht nach `/tmp/`, damit die neue Instanz ihn lesen kann, wenn sie inspizieren will "was habe ich gerade gemacht".
- Wir schreiben hier NICHT `~/.jht/<agent>-pre-respawn-snapshot.txt` (das ist eine strukturierte Übergabe, die im BACKLOG-Follow-up angefordert wird, aber erfordert, dass jeder Agenten-Prompt weiß, wie er sie schreibt+liest — außerhalb des Scopes für MVP, separat verfolgt).
- Die `RESUME:`-Startnachricht ist generisch; sie sagt dem Agenten, auf seine eigenen DB-Tracks zu schauen statt auf einen internen Snapshot zu verlassen.

## Pacing zwischen Neustarts

**15-20s zwischen Agenten** desselben Tiers warten. Warum:
- Schnelles Feuern von `start-agent.sh`-Aufrufen hintereinander kann bei gemeinsamen `~/.jht/.local/`-Schreibvorgängen eine Race Condition auslösen (RULE-T13 Python-Magazzino).
- Gibt jeder neuen Agenten-CLI ~10s zum Einpendeln (Handshake, Tool-Listing, System-Prompt-Auswertung) bevor die nächste den tmux-Server flutet.

Gesamtzeit für ein gesundes Team (8-10 Sitzungen):
- 1 Min. Vorankündigung + 10 Min. Capitano-Schlaf
- 7 Tier-3-Agenten × ~20s = ~2,5 Min. (die meisten sind im Steady State abwesend)
- 4 Tier-1-Agenten × ~30s (schwerere Prompts) = ~2 Min.
- **Gesamtbudget: ~15 Min.**, komfortabel unter den schlimmsten 30 Min., die der Dottore für die Welle am Leben sein könnte.

## Ende-der-Welle Logging

An `/jht_home/logs/dottore-actions.jsonl` anhängen:

```json
{"ts":"2026-05-31T03:08:11Z","event":"daily_restart_wave_done","agents_restarted":9,"agents_skipped_empty":3,"duration_sec":612,"capitano_ack":"yes"}
```

Zustandsdatei `/jht_home/logs/daily-restart-wave-state.json` aktualisieren:

```json
{ "last_wave_at": "2026-05-31T03:08:11Z", "agents_restarted": 9, "duration_sec": 612 }
```

Den Capitano (jetzt frisch) eine Zeile benachrichtigen:

```
[DA DOTTORE A CAPITANO] Daily restart wave completed at 03:08 UTC.
9 agents restarted, 0 errors. Team back online — riprendi la pipeline.
```

## Fehlermodi — was zu tun ist

| Fehler | Aktion |
|---|---|
| `start-agent.sh` Exit ≠ 0 für einen Agenten | `event=agent_restart_failed` loggen, zum nächsten überspringen, die Welle NICHT abbrechen. Die nächste routinemäßige `liveness-check`-Runde wird die Abwesenheit bemerken und erneut versuchen. |
| `tmux server` nicht ansprechbar (selten) | Welle abbrechen, `event=tmux_dead` loggen, `last_wave_at` NICHT aktualisieren (damit der nächste Dottore erneut versucht). |
| Welle auf halbem Weg abgebrochen (Dottore-Timeout 10 Min. Budget) | `event=daily_restart_wave_partial` loggen, `last_wave_at` NICHT aktualisieren. Der nächste Dottore innerhalb des Fensters wird fortsetzen (Anti-Thrash-Prüfung schlägt fehl bis 23h, aber es ist dieselbe Welle — den seltenen Doppel-Tap akzeptieren). |
| Capitano bestätigt nie die Vorankündigung | Trotzdem 10 Min. warten. Wenn er bei t=10 still ist, beendet die Parade ihn auch — der neue Capitano wird sauber aufgreifen. |

## Was dieser Skill NICHT tut

- ❌ **Neustart auf Anfrage** außerhalb des täglichen Fensters. Wenn der Nutzer "starte alle neu jetzt" will, schreibt er dem Assistente / Capitano, und einer von ihnen ruft `spawn-agent` pro Ziel auf oder bittet den Dottore, das Gate zu überspringen (ein zukünftiger expliziter Parameter, nicht im MVP).
- ❌ **Den laufenden Task jedes Agenten snapshotten**. Heute verlässt sich der Respawn darauf, dass der Agent DB + capture-pane in `/tmp/` neu liest. Eine richtige Übergabe (jeder Agent schreibt "was ich gemacht habe + nächster Schritt" vor dem Exit) erfordert Prompt-Änderungen bei allen 10 Agenten — separat als BACKLOG-Follow-up verfolgt.
- ❌ **`~/.jht/preferences.json` lesen** für nutzerspezifische Anpassung von Stunde/Fenster. MVP hardcodet 03:00 UTC ± 30 Min., 23h Anti-Thrash. Wenn der Nutzer in einer Nicht-EU-Zeitzone läuft und ein anderes Fenster will, bearbeitet er diese Skill-Datei (oder wartet auf den preferences.json-Hook-Follow-up).
- ❌ **`.team-halted.flag` überschreiben**. Wenn der Nutzer das Team gestoppt hat, keine Welle. Punkt.
