---
name: session-refresh
description: "Nur für den Doctor. Kontext-Refresh-Runde: für jede Agenten-Sitzung wird eine Retrospektive durchgeführt (Alter + breite Erfassung + Interview + Analytics), eine dichte Synthese an das wachsende Tagesjournal angehängt und dann die Sitzung GETÖTET + neu erstellt + mit Fortsetzungskontext fortgesetzt — so wird das Kontextfenster des Agenten geleert, ohne zu vergessen, wo er stand. Läuft 2× pro Arbeitsfenster (bei +30min und in der Mitte). Überspringt frische Sitzungen und startet nie eine Sitzung neu, die der Capitano bewusst geparkt hat."
allowed-tools: Bash(tmux *), Bash(python3 *), Bash(bash /app/.launcher/start-agent.sh *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# session-refresh — Agentenkontext leeren, Kontinuität bewahren

Du (der Dottore) wirst zu einem geplanten Slot gespawnt (`+30min` ab Beginn des Arbeitsfensters, oder in der Mitte `mid` des Fensters). Deine Aufgabe in dieser Runde ist **nicht** das Liveness-Pingen — sie besteht darin, den **Kontext zu aktualisieren** der aktiven Agenten-Sitzungen: jede langlaufende Sitzung sammelt ein aufgeblähtes Kontextfenster an; du fasst zusammen, was sie getan hat, persistierst es, erstellst dann die Sitzung frisch neu und übergibst die Fortsetzung.

> Warum es das gibt: der alte Dottore verbrannte ~51% des Team-Budgets damit, alle 2h `[HEALTH]` zu pingen, ohne nützliche Prüfungen. Diese Runde ist selten (2×/Fenster) und erzeugt ein dauerhaftes, dichtes Journal der Arbeit des Teams.

## Schritt 0 — Fensterbeginn (das Analytics-Fenster)
```bash
WIN_START=$(python3 -c "import sys; sys.path.insert(0,'/app'); from shared.skills.working_hours import current_window_bounds as b; w=b(); print(w[0].isoformat() if w else '')")
# 24/7 (kein Fenster): Rückfall auf die letzten 6h
[ -z "$WIN_START" ] && WIN_START=$(python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=6)).isoformat())")
ROUND_ID=$(date -u +%Y%m%dT%H%M%SZ)
DAY=$(date -u +%F)
JOURNAL=/jht_home/logs/doctor-retrospective.jsonl
```

## Schritt 1 — Sitzungen + Alter auflisten, Reihenfolge entscheiden
```bash
tmux list-sessions -F '#{session_name}|#{session_created}'
```
- **Reihenfolge**: Worker-Sitzungen ZUERST (`SCOUT-N · ANALISTA-N · SCORER-N · SCRITTORE-N · CRITICO-S*`), Koordinatoren ZULETZT und mit Sorgfalt (`ASSISTENTE · MENTOR · SENTINELLA · CAPITANO`). „Mit Sorgfalt" heißt **ihren Zustand gut erfassen und sie kompaktieren — sie NICHT überspringen** (sie sind die Top-Konsumenten; siehe Regeln). Aktualisiere niemals `DOTTORE` / `DOCTOR-WATCHDOG` (dich selbst / den Scheduler).
- **FRESH-Skip**: `age = now - session_created`. Wenn `age < 40 min` → vollständig ÜBERSPRINGEN (es gibt noch nichts zusammenzufassen, und ein Refresh würde eine gerade erst gestartete Sitzung wegwerfen). Logge `action=skipped_fresh`.

## Schritt 2 — pro Sitzung: Erfassung (breit + relevant)
Erfasse den GESAMTEN Scrollback einmal, dann die relevanten Zeilen — lade NICHT Tausende von Zeilen in deinen eigenen Kontext, grep die Highlights:
```bash
tmux capture-pane -p -S - -t "$S" > /tmp/cap_$S.txt          # vollständiger Scrollback in Datei
tail -n 60 /tmp/cap_$S.txt                                    # aktueller Zustand
grep -nE '\[ERROR\]|Traceback|throttle|EXCLUDED|inserted|\[FEEDBACK\]|\[RETRO\]|spawn|Killed' /tmp/cap_$S.txt | tail -40   # relevante Momente
```

## Schritt 3 — Analytics (objektive Zahlen, nicht nur die Erzählung des Agenten)
```bash
python3 /app/shared/skills/doctor_analytics.py "$S" "$WIN_START"
```
Gibt JSON zurück: `produced{found,analyzed,scored,written,reviewed}`, `communications{sent,received,top_peers}`, `throttles{events,max_sleep_s}`, `last_captain_msg`, `session_age_h`, `role`, `instance`.

## Schritt 4 — PARKED-Prüfung (datengetrieben, NICHT raten)
Eine Sitzung ist **PARKED** (der Capitano hat sie bewusst angelassen, nutzt sie aber nicht — z.B. ein Scout, der vom vorherigen Fenster übrig ist und den der Capitano heute nicht zugewiesen hat), wenn **alle** zutreffen:
- age ≥ 40min (nicht frisch), UND
- `produced` ist im Fenster komplett null, UND
- `last_captain_msg` ist null oder älter als der Fensterbeginn.

Wenn PARKED → **NICHT neu erstellen, um sie neu zu starten**. Schreibe die Synthese (Schritt 6) mit `action=skipped_parked` und gehe weiter. (Ein Neuerstellen würde ein bewusstes Parken in Arbeit verwandeln, die der Capitano nicht wollte.) Falls du sie aus Hygienegründen doch neu erstellst, MUSS die Resume-Nachricht sagen, dass sie inaktiv war: `[RESUME] you were in STANDBY — stay idle until the Capitano assigns you a queue.`

## Schritt 5 — den Agenten interviewen
```bash
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RETRO] Inizio-giornata: 1) intoppi in questa sessione? 2) imparato qualcosa di utile? 3) cosa stavi facendo proprio ora (per il resume)? Rispondi denso, 3-4 righe."
sleep 45
tmux capture-pane -p -S -40 -t "$S" | tail -25   # die Antwort lesen
```
(Überspringe das Interview für PARKED/frische Sitzungen — es gibt nichts Laufendes, wonach man fragen könnte.)

## Schritt 6 — die DICHTE Synthese anhängen (nur Anhängen, wächst täglich)
Ein JSONL-Eintrag pro Agent pro Runde. Kombiniere Analytics + Interview zu einer kompakten Zusammenfassung. NIEMALS überschreiben — mehrere Doctors über den Tag verteilt hängen alle an.
```bash
python3 - "$S" "$ROUND_ID" "$DAY" "$JOURNAL" <<'PY'
import json, sys, datetime
session, round_id, day, journal = sys.argv[1:5]
entry = {
  "ts": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z"),
  "round_id": round_id, "day": day,
  "timing": "start+30",          # or "mid"  — set to the slot you were spawned for
  "session": session, "role": "<role>", "session_age_h": 0.0,
  "analytics": { },              # paste the doctor_analytics.py JSON here
  "interview": {"intoppi": "...", "imparato": "...", "summary_denso": "..."},
  "action": "recreated",         # recreated | skipped_parked | skipped_fresh
  "resume_msg_sent": False,
}
with open(journal, "a") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
print("appended", session)
PY
```

## Schritt 7 — neu erstellen + fortsetzen (nur wenn NICHT frisch und NICHT geparkt)
Atomarer Refresh — du hast den Kontext bereits in Schritt 2 erfasst, daher ist das Töten sicher:
```bash
ROLE=<role>; N=<instance>      # from analytics; recreate the SAME number (no dice — the die is for NEW spawns only)
tmux kill-session -t "$S"
bash /app/.launcher/start-agent.sh "$ROLE" "$N"
sleep 8
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RESUME] Contesto pre-refresh: stavi facendo <X>; avevi completato <Y> (analytics: produced=<...>); il prossimo passo era <Z>. Riprendi da li'. Coda: <next-for-role>."
```
Setze `resume_msg_sent=True` im Journal-Eintrag. Gehe dann zur nächsten Sitzung über (Tempo ~15-20s zwischen den Agenten).

## Regeln
- **Ein Doctor erledigt alle Sitzungen dieser Runde** (Benutzervorgabe: vorerst ein einzelner Doctor). Nutze die dateibasierte Erfassung + grep, damit du nie dein eigenes Kontextfenster sprengst.
- **CAPITANO & SENTINELLA sind die TOP-Token-Konsumenten** (ihr Kontext ist fast immer aufgebläht — die Sentinella tickt alle ~15min, der Capitano koordiniert ununterbrochen). Sie sind NICHT ausgenommen: **kompaktiere sie jede Runde** (zuletzt, nach den Workern). **Kompaktieren, nicht zurücksetzen** — der Refresh mit dichter Synthese bewahrt die Kontinuität, ein roher Kill verliert sie.
- **CAPITANO**: er ist der Koordinator mit In-Flight-Zustand (Worker-Zuweisungen, aktive Throttle-Konfiguration, letzte Pacing-Anweisung, ausstehende Entscheidungen). Erfasse im Interview (Step 5) ausdrücklich diesen Koordinationszustand und lege ihn in den seed (Step 7), damit er den Faden nicht verliert. **Falls `$JHT_HOME/profile/capitano-maintenance.json` existiert, lies sie und lege auch ihre aktiven `orders` (Maintenance-Modus + `stop_search` / `discard_expired_rotating` / weekly-recheck / geocoding) in den seed** — diese Maintenance-Anweisung aus dem seed zu streichen hat am 2026-07-12 eine ganze Maintenance-Woche verstummen lassen (der Capitano liest die Datei danach ohnehin gemäß seiner eigenen Regel C-18 erneut, aber trage sie weiter, damit er nie davon abhängt). Mach es ZULETZT; wenn er gerade eine live EMERGENZA behandelt (sichtbare Orchestrierung im Pane genau jetzt), lass ihn zuerst stabilisieren, sonst kompaktiere ihn.
- **SENTINELLA**: sie ist **nahezu zustandslos** — ihr Arbeitszustand lebt im bridge/config und in `sentinel-data.jsonl`, nicht in ihrem Chat. Das macht sie zur **sichersten und wertvollsten zum Kompaktieren**: frische sie jede Runde auf, zuletzt, mit einem minimalen seed: `[RESUME] sei la Sentinella; il tuo stato vive nel bridge + sentinel-data.jsonl — riprendi il monitoraggio del pacing dal prossimo tick.` Die alters-basierte Neuerstellung durch den `agent-watchdog` (jenseits von `JHT_SENTINELLA_MAX_CTX_AGE_H`, Default 24h) bleibt nur als **Fallback** für den Fall, dass der Dottore nicht läuft; da du sie jetzt jede Runde kompaktierst, erreicht sie dieses Alter nicht, also gibt es kein Race.
- **Niemals** `tmux new-session` von Hand — immer `start-agent.sh` (siehe `spawn-agent`).
- Logge jede Aktion im Journal (`recreated`/`skipped_parked`/`skipped_fresh`) — das Journal ist der Audit-Trail und wächst jeden Tag.
