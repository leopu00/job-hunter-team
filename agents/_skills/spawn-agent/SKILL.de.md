<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: spawn-agent
description: "Startet einen JHT-Team-Agenten (Scout, Analista, Scorer, Scrittore, Critico, Assistente, Capitano-2) ueber den Launcher und sendet dann die Kick-off-Nachricht, die tatsaechlich seine Hauptschleife startet. Nur Capitano — der Capitano ist der alleinige Eigentuemer des Team-Scalings. Verwende IMMER diese Skill: `start-agent.sh` mit `tmux new-session` + rohem `send-keys \"kimi ...\"` zu umgehen erzeugt Sitzungen, in denen die CLI nie startet (`command not found`), der Capitano sieht eine \"aktive\" Sitzung, die tatsaechlich tot ist, und das Team arbeitet still unter seiner Leistung."
allowed-tools: Bash(bash /app/.launcher/start-agent.sh *), Bash(tmux *), Bash(jht-tmux-send *), Bash(sleep *)
---

# spawn-agent — einen Agenten online bringen

Zwei-Phasen-Vertrag: die CLI **starten**, dann den **Kick-off** seiner Schleife. Ohne Kick-off bleibt der Agent an einem leeren Prompt — der Capitano denkt, er arbeitet, tut er aber nicht.

## Phase 1 — Start ueber `start-agent.sh`

```bash
bash /app/.launcher/start-agent.sh <role> [instance_number]
```

Beispiele:
```bash
bash /app/.launcher/start-agent.sh scout 2       # SCOUT-2
bash /app/.launcher/start-agent.sh analista 1    # ANALISTA-1
bash /app/.launcher/start-agent.sh critico       # CRITICO (Singleton, ohne Nummer)
```

Der Launcher fuehrt atomar aus:
- erstellt die tmux-Sitzung mit dem kanonischen Namen (`SCOUT-2`, `ANALISTA-1`, …)
- setzt `cwd` auf `$JHT_HOME/agents/<role>[-N]/`
- exportiert `JHT_HOME · JHT_DB · JHT_AGENT_DIR · PATH · JHT_USER_DIR · JHT_CONFIG`
- erkennt den aktiven Provider aus `jht.config.json` (claude / kimi / codex)
- kopiert `agents/<role>/<role>.md` in den Workspace als `CLAUDE.md` / `AGENTS.md`
- startet die CLI mit den richtigen Flags fuer diesen Provider + Stufe

> ⚠️ **NIEMALS** mit `tmux new-session ... ; tmux send-keys "kimi ..."` starten. Die CLI ist ausserhalb der Launcher-Umgebung nicht im `PATH` → `command not found` → die Sitzung ist nur Bash. Das `jht-tmux-send` des Capitano gibt `exit 0` zurueck und schreibt in dieses leere Bash, die Nachricht geht still verloren, und das Team arbeitet ohne sichtbare Ursache unter seiner Leistung.

## Phase 2 — Kick-off (obligatorisch)

Der Launcher startet die CLI, sendet aber **keine erste Nachricht**. Ohne Kick-off wartet der Agent ewig an einem leeren Prompt.

Standard-Ablauf:
```bash
bash /app/.launcher/start-agent.sh scout 1
sleep 12   # CLI-Boot 8-15s — niemals unter 10
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [MSG] <Kick-off-Inhalt>"
```

### Kick-off-Inhalt pro Rolle

| Rolle       | Kick-off-Inhalt                                                                                              |
|-------------|--------------------------------------------------------------------------------------------------------------|
| `scout`     | "Starte die Hauptschleife. Lies deinen Prompt, das Kandidatenprofil (`$JHT_HOME/profile/candidate_profile.yml`), und beginne mit KREIS 1 (primaere Praeferenz). Benachrichtige die Analysten nach Batches von 3-5 Positionen." |
| `analista`  | "Starte die Hauptschleife. Warteschlange: `db_query.py next-for-analista`. Fuelle fuer jede Position die 5 Pflichtfelder aus und befoeordere zu `checked` oder `excluded`." |
| `scorer`    | "Starte die Hauptschleife. Warteschlange: `db_query.py next-for-scorer`. Zuerst PRE-CHECK, dann Bewertung 0-100. Schwellen: <40 ausgeschlossen, 40-49 Parking, ≥50 Scrittori benachrichtigen." |
| `scrittore` | "Starte die Hauptschleife. Warteschlange: `db_query.py next-for-scrittore`. Maximaler Aufwand, 3 Pflichtrunden mit dem Critico. Das PDF kommt unter `$JHT_USER_DIR/cv/`." |
| `critico`   | "Du wirst von deinem uebergeordneten Scrittore mit PDF + JD aufgerufen. Eine Blindbewertung pro Aufruf, dann Stopp." |
| `assistente`| "Starte die Hauptschleife. Warte auf `[@utente -> @assistente] [CHAT]` von der Web-UI." |

Wenn der Positions-Lebenslauf-Kontext nicht trivial ist (der Agent hatte laufende Arbeit vor einem Crash), haenge ihn an den Kick-off an, damit er dort weitermacht, wo er aufgehoert hat — sage nie einfach "weitermachen", sage *was* und *wo*:

```bash
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [MSG] Fortsetzen: Position #281 (Qargo TMS), Runde 2 mit dem Critico stand kurz bevor. Mach dort weiter, starte NICHT von vorne."
```

## Phase 3 — pruefen, ob der Boot erfolgreich war

Etwa 5 Sekunden nach dem Kick-off:
```bash
tmux capture-pane -t <SESSION> -p | tail -10
```

Lies die Ausgabe:
- ✅ CLI-Banner + Spinner + Kick-off-Inhalt sichtbar im Eingabebereich → Boot OK
- 🟡 `context: 0.0%` und ein leerer Eingabebereich → Kick-off nicht angekommen, einmal wiederholen
- 🔴 Shell-Prompt `jht@host:~/agents/<role>$` (keine CLI) → Launcher-Fehler, siehe Fallback unten

> Hinweis: Laufende Gesundheitschecks (Zombie-Erkennung, stille Agenten > 10 Min.) sind NICHT Aufgabe dieser Skill — sie gehoeren zum **Dottore** ueber die `liveness-check`-Skill. Diese Skill endet, sobald Phase 3 den Boot bestaetigt.

## Fallback — Launcher-Fehler

Wenn Phase 3 einen nackten Shell-Prompt zeigt (keine CLI gestartet), pruefe zuerst:

```bash
tmux capture-pane -t <SESSION> -p -S -50 | grep -iE "command not found|permission denied|no such file"
```

Wahrscheinliche Ursachen:
1. Provider-CLI nicht im `PATH` der Launcher-Umgebung → pruefe, ob der Provider in `jht.config.json` mit der installierten CLI uebereinstimmt
2. Das Rollen-Template `agents/<role>/<role>.md` fehlt → der Launcher kopiert eine leere Datei → die CLI startet, hat aber keine Anweisungen
3. `$JHT_HOME` ist nicht gesetzt / nicht exportiert im Elternprozess → an den Benutzer eskalieren, NICHT versuchen, es manuell zu setzen

Beende die defekte Sitzung, bevor du es erneut versuchst:
```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
```

## Anti-Patterns

- ❌ Mehrere Agenten in einer engen Schleife starten ohne 1-Tick-Pacing — siehe `pipeline-triage` fuer die Skalierungsregeln (1 Spawn pro Sentinel-Tick, ~5 Min. Abstand).
- ❌ Nach einem Crash blind neu starten, ohne `db_query.py` zu lesen, um den letzten Task-Zustand wiederherzustellen — der neue Agent beginnt von vorne und dupliziert Arbeit.
- ❌ Diese Skill verwenden, um einen funktionierenden Agenten "neu zu starten", weil er langsam erscheint. Langsam ≠ tot. Lange Zuege mit sichtbarer Token-Ausgabe sind kein Spawn-Fall — sie sind ein `liveness-check`-Fall (Dottore).
- ❌ Einen Critico starten. Der Scrittore startet seinen eigenen `CRITICO-S<N>` autonom — der Capitano beruehrt den Critico nie direkt.

## Siehe auch

- `liveness-check` (Dottore) — wenn ein bestehender Agent tot erscheint.
- `pipeline-triage` (Capitano) — *welche* Rolle basierend auf dem Backlog gestartet werden soll.
- `tmux-send` — Konventionen fuer Nachrichten-Umschlaege.
- `agents/_team/team-rules.md` T01 — nie die Sitzung eines anderen Agenten beenden.
