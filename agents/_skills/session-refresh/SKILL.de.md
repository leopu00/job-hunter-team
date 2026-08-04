---
name: session-refresh
description: "Nur für den Doctor. Kontext-Refresh-Runde: für jede Agenten-Sitzung wird die reale Kontext-Belegung gelesen (client-side-Befehl des Providers, null Tokens) und NUR Sitzungen aktualisiert, deren Kontextfenster zu mehr als 50% gefüllt ist — eine Retrospektive durchgeführt (Erfassung + Interview + Analytics), eine dichte Synthese an das wachsende Tagesjournal angehängt und dann die Sitzung GETÖTET + neu erstellt + mit Fortsetzungskontext fortgesetzt, so wird ihr Kontextfenster geleert, ohne zu vergessen, wo sie stand. Läuft 2× pro Arbeitsfenster (bei +30min und in der Mitte). Überspringt frische, kontextarme (≤50%) und vom Capitano geparkte Sitzungen — AUSSER jenseits des 12h-Session-TTL (JHT_AGENT_MAX_SESSION_AGE_H), das jeden Skip aussticht: allein das Alter entscheidet, ohne Ausnahme."
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
- **FRESH-Skip** (günstiger Vorfilter vor der Kontext-Prüfung): `age = now - session_created`. Wenn `age < 40 min` → vollständig ÜBERSPRINGEN (es gibt noch nichts zusammenzufassen, und ein Refresh würde eine gerade erst gestartete Sitzung wegwerfen). Logge `action=skipped_fresh`. Alles, was diesen Vorfilter übersteht, geht durch **Schritt 1.4 (TTL)** und dann durch **Schritt 1.5 (Kontext-Prüfung)** — jene `>50%`-Messung, nicht das Alter, entscheidet über den *gewöhnlichen* Refresh.

## Schritt 1.4 — TTL: **jede Agenten-Sitzung lebt höchstens 12 Stunden**
```bash
TTL_H="${JHT_AGENT_MAX_SESSION_AGE_H:-12}"
AGE_H=$(( ( $(date -u +%s) - $(tmux display-message -p -t "$S" '#{session_created}') ) / 3600 ))
[ "$AGE_H" -ge "$TTL_H" ] && echo "TTL ABGELAUFEN ($AGE_H h) → Refresh PFLICHT"
```
**Wenn `AGE_H ≥ TTL_H`, wird die Sitzung erneuert. Punkt.** Das TTL wird **vor** allem anderen geprüft und **hebt jeden in dieser Skill vorgesehenen Skip auf** — keine Ausnahme, keine Sonderregel, kein «aber»:

| normaler Skip | jenseits des TTL |
|---|---|
| `skipped_fresh` (age < 40min) | jenseits von 12h unmöglich, aber das TTL gewinnt ohnehin |
| `skipped_lowctx` (Kontext ≤ 50%) | **ignoriert** — eine Sitzung bei 4% nach 30h wird trotzdem neu erstellt |
| `skipped_parked` (PARKED, Schritt 4) | **ignoriert** — geparkt oder nicht, das TTL gilt |
| «der Agent arbeitet» | **ignoriert** — erfasse seinen Zustand im Seed und erstelle neu |
| außerhalb des Arbeitsfensters | **ignoriert** — das TTL wird nie ausgesetzt (siehe Regeln) |

Logge `action=recreated` mit `reason=ttl` und dem gemessenen `session_age_h`. Gehe dann direkt zu den Schritten 2 → 7 (Erfassung, Analytics, Synthese, neu erstellen + fortsetzen): **überspringe Schritt 1.5 und Schritt 4 vollständig**, sie können nur einen Skip erzeugen, und ein Skip steht hier nicht zur Verfügung.

Warum allein das Alter, ohne Gesundheits-Heuristik darüber: beim Vorfall vom 2026-07-28/29 waren die Sitzungen **38,5 · 29,5 · 27,0 · 14,5 · 14,2 Stunden** alt, jede Heuristik meldete «gesund», und das Team stand seit elf Stunden still. Die Kontexte lagen unter 50%, also hat keine Regel sie angefasst. Ein TTL hat keine Heuristik, die sich irren kann.

## Schritt 1.5 — KONTEXT-PRÜFUNG (der *gewöhnliche* Refresh-Trigger: **>50%**)
Nur für Sitzungen, die in Schritt 1.4 **nicht** das TTL ausgelöst haben.
**Aktualisiere NUR Sitzungen, deren Kontextfenster zu mehr als 50% gefüllt ist.** Lies die reale Belegung mit dem **client-side**-Kontextbefehl des Providers — er kostet **null Tokens** (lokal gerendert, kein LLM-Aufruf) und ist sofort da. Das Alter ist NICHT mehr der Trigger: eine alte-aber-leere Sitzung (z.B. ein untätiger Mentor bei 2%) muss ÜBERSPRUNGEN werden, eine aufgeblähte Sitzung muss aktualisiert werden.

Zwei zwingende Anforderungen — ignorierst du sie, *verbrennst* du Budget, statt es zu sparen:
- Die Sitzung MUSS **untätig** sein (kein aktiver Turn). Wenn ein Spinner / `esc to interrupt` zu sehen ist, arbeitet sie → ÜBERSPRINGE diese Runde (der nächste Doctor fängt sie ab). Sende niemals Tasten mitten im Turn.
- **Leere zuerst die Eingabezeile.** Sonst verkettet sich der Befehl mit dem Resttext und wird als LLM-Prompt abgeschickt (verbrennt Tokens). Sende `Escape` dann `C-u` vor dem Tippen.

```bash
S=<session>
# provider → command:  claude → /context   ·   codex → /status   ·   kimi → (verify on its TUI)
tmux send-keys -t "$S" Escape; sleep 1
tmux send-keys -t "$S" C-u;    sleep 1          # clear the input line (mandatory)
tmux send-keys -t "$S" "/context"; sleep 1
tmux send-keys -t "$S" Enter;  sleep 3
PCT=$(tmux capture-pane -p -t "$S" | grep -aoE '[0-9.]+k?/[0-9.]+[km] tokens \([0-9]+%\)' | tail -1 | grep -aoE '\([0-9]+%\)' | tr -dc '0-9')
tmux send-keys -t "$S" Escape                   # dismiss the panel
echo "context=$PCT%"
```
Entscheide anhand von `$PCT` (geparst aus einer Zeile wie `24.9k/1m tokens (2%)`):
- **`PCT` ≤ 50** → ÜBERSPRINGEN, **außer das TTL hat in Schritt 1.4 ausgelöst**. Eine Sitzung unterhalb des TTL NICHT neu erstellen, auch wenn sie alt ist. Logge `action=skipped_lowctx` mit der gemessenen `%`. Gehe zur nächsten Sitzung.
- **`PCT` > 50** → fahre mit dem Refresh fort (Schritte 2–7).
- **Befehl wurde nicht gerendert / Parsing fehlgeschlagen** → Rückfall auf die Alters-Heuristik (`age ≥ 40min` → Refresh) und logge `ctx=unparsed`.

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

**Zwei zwingende Ausnahmen von PARKED — diese Regel beschrieb den Vorfall wörtlich und hielt dem Doctor genau dann die Hände gebunden, als das Team ihn am nötigsten brauchte:**
1. **Jenseits des TTL (Schritt 1.4) gilt PARKED nicht.** Geparkt oder nicht, eine Sitzung ab 12h wird neu erstellt.
2. **Ein blockierter Agent ist kein geparkter Agent.** «nicht frisch + produced == 0 + keine aktuelle Capitano-Nachricht» ist zugleich der exakte Fingerabdruck eines Teams mit kaputter Koordination. Das objektive Signal, das beides trennt: **ein Agent, der einen anderen ohne Antwort immer wieder anfunkt, ist nicht geparkt, sondern blockiert** (die `retry_loop`-Einträge aus dem Scan von `agent-unblock`; im Pane sind die Versuche sichtbar). Dasselbe gilt für «alle Operativen stehen still bei verfügbarem Kontingent». In diesen Fällen NICHT `skipped_parked` loggen — löse die Blockade (`agent-unblock`) und setze die Runde dann fort.

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
  "action": "recreated",         # recreated | skipped_lowctx | skipped_parked | skipped_fresh
  "context_pct": 0,              # in Schritt 1.5 gemessene Kontext-Belegung (das >50%-Gate)
  "resume_msg_sent": False,
}
with open(journal, "a") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
print("appended", session)
PY
```

## Schritt 7 — neu erstellen + fortsetzen (wenn das TTL ausgelöst hat ODER Kontext **>50%** und NICHT frisch, NICHT geparkt)
Atomarer Refresh — du hast den Kontext bereits in Schritt 2 erfasst, daher ist das Töten sicher:
```bash
ROLE=<role>; N=<instance>      # from analytics; recreate the SAME number (no dice — the die is for NEW spawns only)
tmux kill-session -t "$S"
bash /app/.launcher/start-agent.sh "$ROLE" "$N"
sleep 8
# CAPITANO only: the [MODALITA' CORRENTE] section, read FROM DISK right now (never
# from the context you are throwing away). Same section heartbeat-bridge.py injects
# every hour. Workers do not get it — the mode is applied by the Capitano.
MODE=""
if [ "$ROLE" = "capitano" ]; then MODE=" $(python3 /app/shared/skills/mode_banner.py line)"; fi
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RESUME] Contesto pre-refresh: stavi facendo <X>; avevi completato <Y> (analytics: produced=<...>); il prossimo passo era <Z>. Riprendi da li'. Coda: <next-for-role>.$MODE"
```
Setze `resume_msg_sent=True` im Journal-Eintrag. Gehe dann zur nächsten Sitzung über (Tempo ~15-20s zwischen den Agenten).

## Regeln
- **Das 12h-TTL hat keine Schlupflöcher und keinen Ausschalter.** `JHT_AGENT_MAX_SESSION_AGE_H`, Standard `12`. Weder PARKED noch skip-fresh noch die Kontextschwelle noch «er arbeitet gerade» noch das Zeitfenster-Gate können es aufheben. **Staffle es**: Sitzungen entstehen in Wellen und würden gemeinsam ablaufen — erneuere höchstens EINE Sitzung jenseits des TTL pro Durchgang, sortiert nach **absteigendem** Alter, so kommt die älteste zuerst und das Team wird nie auf einen Schlag neu erstellt.
- **Außerhalb des Arbeitsfensters läuft die Runde nicht — das TTL schon.** Nachts wird die Runde übersprungen, weil Interviews Budget für nichts verbrennen würden; eine 30-Stunden-Sitzung wird trotzdem neu erstellt, denn ein Kick-off kostet nichts gegenüber einem verlorenen Tag. `agent-watchdog.sh` erzwingt dieselbe Obergrenze deterministisch (gleiche Env-Variable) für den Fall, dass der Doctor gestoppt, blockiert oder nie gespawnt ist — genau das ist am 2026-07-28/29 passiert. Beide Pfade sollen existieren: dieser ist der *reiche* Refresh (Retrospektive + Resume), jener ist das Netz, das die Obergrenze um jeden Preis garantiert.
- **`working_hours: null` (oder fehlend oder leer) bedeutet KEINE zeitliche Einschränkung** — das Team läuft 24/7 und die Runde läuft normal. Es bedeutet nie «immer außerhalb des Fensters». Beim Vorfall war `working_hours` null genau deshalb, weil die Antwort des Nutzers zur Zeitzone jene Zeile war, die im Composer des Capitano hängen blieb.
- **Erst entblocken, dann erneuern.** Führe zuerst die Phase `agent-unblock` aus: ein gelähmtes Team zu erneuern reproduziert die Lähmung nur mit sauberem Kontextfenster.
- **Ein Doctor erledigt alle Sitzungen dieser Runde** (Benutzervorgabe: vorerst ein einzelner Doctor). Nutze die dateibasierte Erfassung + grep, damit du nie dein eigenes Kontextfenster sprengst.
- **CAPITANO & SENTINELLA sind die TOP-Token-Konsumenten** (ihr Kontext ist fast immer aufgebläht — die Sentinella tickt alle ~15min, der Capitano koordiniert ununterbrochen). Sie gehen trotzdem durch das **>50%-Kontext-Gate** wie alle anderen (Schritt 1.5) — aber in der Praxis messen sie deutlich über 50%, also werden sie fast jede Runde aktualisiert. Mach sie **zuletzt** (nach den Workern) und **kompaktiere, setze nicht zurück** — der Refresh mit dichter Synthese bewahrt die Kontinuität, ein roher Kill verliert sie. Misst einer ≤50% (selten), überspringe ihn diese Runde wie jede andere kontextarme Sitzung.
- **CAPITANO**: er ist der Koordinator mit In-Flight-Zustand (Worker-Zuweisungen, aktive Throttle-Konfiguration, letzte Pacing-Anweisung, ausstehende Entscheidungen). Erfasse im Interview (Step 5) ausdrücklich diesen Koordinationszustand und lege ihn in den seed (Step 7), damit er den Faden nicht verliert. **Falls `$JHT_HOME/profile/capitano-maintenance.json` existiert (historischer Dateiname des PFLEGE-MODUS), lies sie und lege auch ihre aktiven `orders` (Pflege-Modus + `stop_search` / `discard_expired_rotating` / getakteter Recheck / geocoding) in den seed** — diese Maintenance-Anweisung aus dem seed zu streichen hat am 2026-07-12 eine ganze Maintenance-Woche verstummen lassen (der Capitano liest die Datei danach ohnehin gemäß seiner eigenen Regel C-18 erneut, aber trage sie weiter, damit er nie davon abhängt). **Und hänge an das `[RESUME]` den Abschnitt `[MODALITÀ CORRENTE]` an, den `python3 /app/shared/skills/mode_banner.py line` erzeugt** — denselben, den `heartbeat-bridge.py` jede Stunde injiziert, von der Platte gelesen und nicht aus dem Kontext, den du wegwirfst: so hängt die Anweisung weder davon ab, dass du sie gut zusammenfasst, noch davon, dass deine Runde überhaupt läuft (sie lief nicht, und achtzehn Tage Wartung waren verschwunden). Nur für den Capitano: Worker bekommen sie nie. Mach es ZULETZT; wenn er gerade eine live EMERGENZA behandelt (sichtbare Orchestrierung im Pane genau jetzt), lass ihn zuerst stabilisieren, sonst kompaktiere ihn.
- **SENTINELLA**: sie ist **nahezu zustandslos** — ihr Arbeitszustand lebt im bridge/config und in `sentinel-data.jsonl`, nicht in ihrem Chat. Das macht sie zur **sichersten und wertvollsten zum Kompaktieren**: frische sie jede Runde auf, zuletzt, mit einem minimalen seed: `[RESUME] sei la Sentinella; il tuo stato vive nel bridge + sentinel-data.jsonl — riprendi il monitoraggio del pacing dal prossimo tick.` Die alters-basierte Neuerstellung durch den `agent-watchdog` (jenseits von `JHT_SENTINELLA_MAX_CTX_AGE_H`, Default 24h) bleibt nur als **Fallback** für den Fall, dass der Dottore nicht läuft; da du sie jetzt jede Runde kompaktierst, erreicht sie dieses Alter nicht, also gibt es kein Race.
- **Niemals** `tmux new-session` von Hand — immer `start-agent.sh` (siehe `spawn-agent`).
- Logge jede Aktion im Journal (`recreated`/`skipped_lowctx`/`skipped_parked`/`skipped_fresh`) mit der gemessenen `context_pct` — das Journal ist der Audit-Trail und wächst jeden Tag.
