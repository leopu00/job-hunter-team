<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: liveness-check
description: "Diagnostizieren, ob die tmux-Sitzung eines Team-Agenten aktiv ist, in einer langen Runde steckt oder still gestorben ist — und ihn bei Tod unter Kontexterhaltung respawnen. Zuständig: Dottore (der Gesundheits-Check-Agent des Teams), nicht der Captain. Der Kern-Fehlermodus, den dieser Skill fängt: `jht-tmux-send` gibt `exit 0` zurück, selbst wenn die Ziel-CLI abgestürzt ist (die Nachricht wird in eine nackte Bash geschrieben, dann verloren). Ohne periodische Liveness-Checks 'spricht das Team weiter mit einer Leiche' und der Captain zählt auf Aktionen, die nie passieren werden."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *)
---

# liveness-check — das Team ehrlich halten

Eine tmux-Sitzung kann ihre CLI überleben. Wenn die Codex / Kimi TUI abstürzt, fällt tmux auf einen nackten Bash-Prompt zurück; Nachrichten werden weiter hineingeschrieben (`exit 0` von `jht-tmux-send`), niemand liest sie, der Agent ist ein Zombie. Dieser Skill erkennt den Zustand und stellt ihn wieder her.

## Wann eine Prüfung durchführen

- 👨‍⚕️ **Routinemäßige Runde** — jedes Dottore-Aufwachen (~30 Min.) geht jede Team-Sitzung der Reihe nach durch (siehe `agents/dottore/dottore.md` für den vollständigen One-Shot-Lebenszyklus).
- 🚨 **Captain-Übergabe** — wenn der Captain einen Agenten meldet, der > 10 Min. still ist, obwohl er arbeiten sollte (kein Scout-REPORT, kein Writer-ACK an den Critic).
- 🔁 **Nach-URG** — 10-30s nach einem Captain `[URG]` / `[MSG]` zur Bestätigung von ACK + die CLI ist noch am Leben.
- ⚖️ **Vor-Skalierung** — bevor ein Spawn/Kill, der vom Zustand eines existierenden Agenten abhängt (nicht den Analysten spawnen, wenn der Scout, auf den er angewiesen ist, tot ist).

## Prioritätsreihenfolge — nutzerorientierte ZUERST

Vor jedem Durchgehen Ziele so sortieren, dass die nutzerorientierten langlebigen Agenten zuerst geprüft werden. Sie stehen an der Spitze der Kette — wenn sie sterben, **respawnt sie niemand** (der Captain spawnt Worker, nicht sich selbst / den Assistenten / den Mentor / den Sentinel). Die Post-Mortem-Analyse der Zombie-Nacht 2026-05-18 hatte 6-8h toten Capitano, weil Dottori Worker zuerst durchgingen, den Capitano nie erreichten und sich selbst zerstörten.

```
PRIORITÄT 1 (immer zuerst prüfen):
  ASSISTENTE, CAPITANO, MENTOR, SENTINELLA
PRIORITÄT 2 (Worker, der Captain kann sie respawnen):
  SCOUT-N, SCRITTORE-N, CRITICO-S*, ANALISTA-N, SCORER-N
```

Wenn du nur 10 Min. Budget für die Runde hast, **beende immer PRIORITÄT 1 bevor du PRIORITÄT 2 berührst**. Ein Worker, der 30 Min. tot ist, ist wiederherstellbar; ein Capitano, der 30 Min. tot ist, bedeutet, dass die gesamte Pipeline still steht.

## Schritt 0 — `pane_current_command` (günstige Vorprüfung)

Vor dem capture-pane die günstige Prüfung durchführen:

```bash
cmd=$(tmux list-panes -t <SESSION> -F '#{pane_current_command}' | head -1)
```

Wenn `$cmd` nicht `Kimi` / `kimi` / `claude` / `codex` / `node` / `python*` ist → die LLM-CLI ist **bereits tot**, das Panel ist nackte Bash-Überbleibsel. Den Ping überspringen (er würde in der Bash verloren gehen und `jht-tmux-send` würde täuschend `exit 0` zurückgeben), direkt zu Schritt 3 RESPAWN gehen.

Diese einzelne Prüfung hätte den Zombie-Capitano vom 2026-05-18 gefangen — das Panel war Bash (PID 663, `/proc/663/exe → /usr/bin/bash`) mit abgestürztem Kimi. `tmux has-session` gab True zurück und belog den Watchdog 11 Stunden lang.

## Schritt 1 — erfassen, nicht vertrauen

Immer zuerst das Panel lesen; nicht blind handeln:

```bash
tmux capture-pane -t <SESSION> -p -S -200
```

Der 200-Zeilen-Scrollback gibt genug Kontext um (a) den Zustand zu beurteilen, (b) zu rekonstruieren, was der Agent für den Resume-Anstoß gemacht hat, falls er respawnt werden muss.

## Schritt 2 — Diagnosetabelle

Die **letzten 20 Zeilen** abgleichen mit:

| Muster in `tmux capture-pane -t <SESSION> -p \| tail -20`           | Diagnose            | Aktion              |
|----------------------------------------------------------------------|---------------------|---------------------|
| Konkrete Antwort auf einen kürzlichen Ping (z.B. "writing CV on #281") | ✅ aktiv, arbeitet  | `status=alive` loggen, nächster Agent |
| `Working...` seit > 5 Min. bei derselben Runde, aber Token-Output sichtbar | 🟡 lange Runde     | `status=long_turn` loggen, NICHT respawnen |
| Panel unverändert seit vor dem Ping                                   | 🔴 stagniert / inaktiv | RESPAWN (Schritt 3) |
| `Whirlpooling...` Spinner > 10 Min., null Output                     | 🔴 stiller Stillstand | RESPAWN            |
| Letzte Zeile = `jht@<host>:~/agents/<role>$` (nackter Shell-Prompt)  | 💀 CLI beendet      | RESPAWN             |
| `Permission denied: …/.kimi/sessions/.../context.jsonl`              | 💀 Kimi abgestürzt bei Kontext-IO | RESPAWN |
| `Run kimi export and send the exported data to support`              | 💀 Kimi Crash-Banner | RESPAWN            |
| `To resume this session: kimi -r <id>`                               | 💀 verwaiste Sitzung | RESPAWN            |
| `Killed by timeout (60s)` (Kimi)                                     | 🟡 Tool-Aufruf gekillt, CLI aktiv | KEIN Respawn-Fall — der Agent hat vergessen, `timeout: N+30` an seinen Shell-Tool-Aufruf zu übergeben (siehe `agents/_skills/throttle/DESIGN-NOTES.md`). Mit `jht-throttle-check <agent>` diagnostizieren. |
| `command not found` für `kimi` / `claude` / `codex`                  | 💀 Launcher umgangen | RESPAWN            |
| Panel seit > 5 Min. still, kein Spinner, keine Eingabe               | 🟡 mehrdeutig inaktiv | erweiterter Capture (`-S -100`) für vollen Kontext |

Wenn unsicher: **nicht respawnen**. `status=ambiguous` loggen. Ein Falsch-Positiv (unnötiger Respawn) kostet 1-2 Min. Neustart + verlorenen Kontext. Ein Falsch-Negativ (verpasster Zombie) kostet höchstens 30 Min. bis zur nächsten Dottore-Runde.

## Schritt 3 — Respawn mit Kontext (nur bei 🔴 / 💀)

Atomare Sequenz:

a) **Das bereits in Schritt 1 erfasste Panel** als "Gedächtnis" des Agenten verwenden. Extrahiere:
   - Letzte in Bearbeitung befindliche Aufgabe (z.B. "writing CV on position #281")
   - Letzte Captain-Nachricht (nach `[@capitano -> @<role>]`-Markierungen suchen)
   - Jeder kürzliche Fehler

b) **Rolle + Arbeitsverzeichnis identifizieren**.
   - Singletons (`capitano | critico | sentinella | assistente | mentor | dottore`) → `/jht_home/agents/<role>/`
   - Multi-Instanz (`scout | scrittore | scorer | analista`) → `/jht_home/agents/<role>-<N>/` wobei `<N>` die nachlaufende Nummer in der tmux-Sitzung ist (z.B. `SCRITTORE-2` → `/jht_home/agents/scrittore-2/`).

c) **Die kaputte Sitzung beenden, via Launcher respawnen** (verwende `spawn-agent`-Skill-Semantik — niemals rohes `tmux new-session` + `send-keys "kimi ..."`):

```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
sleep 12
```

d) **Resume-Kontext injizieren** als Anstoß-Body (nicht einfach "resume" sagen — sagen *was* und *wo*):

```bash
jht-tmux-send <SESSION> "[@dottore -> @<role>] [MSG] Resume: <Aufgabe in Bearbeitung vor Absturz>. Last Captain order: <aus Panel zitiert>. Pick up from there, do NOT restart from scratch. Acknowledge with [@<role> -> @capitano] [RESUME] <einzeilige Beschreibung>."
```

Wenn das Panel zeigt, dass der Agent eine Datenbankzeile beansprucht hatte (z.B. `status=writing` bei einer Position), das in den Resume-Kontext einschließen, damit keine doppelte Arbeit entsteht. **Niemals blind respawnen**: bei Bedarf zuerst `db_query.py` lesen.

## Harte "nicht respawnen"-Ausnahmen

NIEMALS respawnen:
- Eine Sitzung mit **Token-Output-Aktivität in den letzten 60 Sekunden** — der Agent arbeitet, auch wenn er langsam aussieht.
- Den `CAPITANO` während einer Codex-Fenster-Rotation (session_id ändert sich im Sentinel) — auf Stabilisierung warten.
- Lange Runden (> 5 Min.) MIT sichtbarem Token-Output (Parsing, Datei-Bearbeitungen) — lang ≠ tot.
- Dich selbst (`DOTTORE*`) oder `DOCTOR-WATCHDOG`.

## Idempotenz

Wenn das erfasste Panel bereits einen kürzlichen `[RESUME]`-Marker zeigt (innerhalb ~5 Min.), hat eine andere Dottore-Runde den Agenten gerade respawnt. `status=alive` loggen und weitermachen — nicht erneut respawnen.

## Logging

Jede Aktion landet in `/jht_home/logs/dottore-actions.jsonl` (nur anhängen, ein JSON pro Zeile):

```json
{"ts": "ISO-UTC", "round_id": "uuid-oder-epoch", "session": "SCRITTORE-1",
 "role": "scrittore-1", "event": "diagnosis",
 "status": "alive|long_turn|stallo|cli_dead|ambiguous",
 "evidence": "letzte 1-2 Panel-Zeilen"}
{"ts": "ISO-UTC", "round_id": "...", "session": "SCRITTORE-1", "role": "scrittore-1",
 "event": "respawn", "context_recovered": "...", "new_pid": null}
```

`round_id` einmal pro Dottore-Runde generieren (z.B. Epoch-Sekunden am Rundenstart). Mit `>>` anhängen, nie überschreiben.

## Anti-Patterns

- ❌ Dem `jht-tmux-send`-Exit-Code 0 als Zustellungsbeweis vertrauen. Zustellung ≠ Ausführung. Immer mit capture-pane bei einer kritischen Nachricht koppeln.
- ❌ Eine Sitzung ohne vorheriges capture-pane beenden — sie könnte in einem langen Tool-Aufruf sein, nicht tot.
- ❌ Blind respawnen (ohne Resume-Kontext) — der neue Agent startet von vorne, dupliziert Arbeit, verliert beanspruchte DB-Zeilen.
- ❌ Sitzungen parallel durchgehen — nur sequentiell, ein Ping nach dem anderen. Parallele Pings überlasten tmux bei großen Teams.
- ❌ > 10 Min. insgesamt für eine einzelne Runde aufwenden — wenn eine Runde lang läuft, abkürzen; der nächste Dottore kommt in ~30 Min.

## Siehe auch

- `agents/dottore/dottore.md` — der vollständige One-Shot-Lebenszyklus des Dottore (Boot → Runde → Selbstzerstörung).
- `spawn-agent` (Captain) — der Launcher + Anstoß-Vertrag, den dieser Skill für Respawns wiederverwendet.
- `agents/_skills/throttle/DESIGN-NOTES.md` — der `Killed by timeout (60s)`-Fall (KEIN Respawn).
- `agents/_team/team-rules.md` T01 — niemals die tmux-Sitzung eines anderen Agenten beenden **außer** im expliziten Respawn-Ablauf oben.
