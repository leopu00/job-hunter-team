---
name: team-pause
description: "PAUSE the team (or one agent) without shutting anything down, and resume it. Open it the moment the user says «take a break», «pause», «hold on», «stop for now», «wait until I tell you», «freeze» — or «resume», «carry on», «you can start again». A pause keeps every session ON with its context; nobody works and nothing new starts until the user says to resume. It is NOT the stop: shutting the team down (`jht team stop`, `.team-halted.flag`, killing sessions) throws every agent's context away and is only for an explicit «turn the team off»."
allowed-tools: Bash(python3 /app/shared/skills/agent_control.py *), Bash(python3 /app/shared/skills/standby.py status *), Bash(python3 /app/shared/skills/agent_pause.py status *)
---

# team-pause — eine Pause ist kein Herunterfahren

Am 05.11. sagte der Nutzer dem Assistente *„macht eine Pause, ich sage euch, wann es weitergeht“*. Der Assistente bat den Capitano um ein „controlled freeze“; der Capitano, ohne irgendeine Skill für die Pause, schrieb das Stopp-Flag und **schloss alle Sitzungen** — jeder Agent verlor seinen Kontext — und dem Nutzer wurde *„Paused ✅“* gesagt. Diese Skill gibt es, damit das nicht wieder passiert: Die vom Nutzer gewünschte Pause hält die Sitzungen an und den Kontext intakt, und **was du dem Nutzer sagst, ist das, was die Antwort des Befehls sagt**.

## 1. Welches Wort was bedeutet

| Der Nutzer sagt (in jeder Sprache) | Bedeutet | Was du tust |
|---|---|---|
| „Pause“, „haltet an“, „wartet, ich sage euch, wann es weitergeht“, „einfrieren“, „alle erst mal still“ | **PAUSE** | §2 |
| „weitermachen“, „macht weiter“, „ihr könnt wieder anfangen“, „los“ (nach einer Pause) | **FORTSETZEN** | §4 |
| „setz den Scout auf Pause“ / „halte Analista-1 kurz an“ | **PAUSE eines Agenten** | §5 |
| „schalte das Team aus“, „fahrt alles herunter“, „stoppe das Team“ *als Herunterfahren gemeint* | **STOPP** — nicht diese Skill | sag dem Nutzer, dass dies die Sitzungen schließt und jeder Agent verliert, was er im Kopf hatte; tu es nur, wenn er bestätigt, dass er das will |
| mehrdeutig („stopp“, „stopp alles“) | als **PAUSE** behandeln | rückgängig zu machen und der Kontext bleibt; sag es und biete das Herunterfahren an, falls das gemeint war |

**Niemals** `jht team stop`, `.team-halted.flag`, `tmux kill-session` oder das „Freeze“ des Capitano für eine Pause: Das ist der Stopp.

## 2. Das Team pausieren

Der **Assistente** führt den Befehl selbst aus (bitte den Capitano nicht, ein Freeze zu improvisieren):

```bash
python3 /app/shared/skills/agent_control.py pause --until-resumed --from-assistant
```

Der **Capitano**, wenn der Auftrag ihn erreicht (ein `[REQ]`, der Pause sagt, oder der Nutzer schreibt ihm), führt dieselbe Zeile **ohne** `--from-assistant` aus. Eine JSON-Zeile kommt zurück. Lies sie:

```json
{"ok": true, "op": "pause", "result": "paused",
 "detail": {"reached": ["CAPITANO","SCOUT-1", ...], "not_reached": ["SCORER-1"], "until_resumed": true}}
```

- `result: "paused"` — erledigt. `"already_paused"` — war schon so; sag es.
- `detail.reached` — die Sitzungen, die die Nachricht *„schließe deinen Schritt ab, notiere, wo du bist, warte“* erhielten. `detail.not_reached` — lebende Sitzungen, die dem Transport nicht antworteten: **sag dem Nutzer, welche**.
- `ok: false` / `error` — es ist **nicht** passiert. Sag es. Niemals „pausiert“ nach einem Fehler.

Die Sitzungen bleiben an. Bridges und Watchdogs schweigen von selbst (kein Heartbeat, keine Pacing-Ticks, kein Refresh, keine Nudges). Der Assistente ist **nicht** pausiert: Er bleibt erreichbar.

Die Pause hat keine Endzeit: Sie endet, wenn der Nutzer es sagt, mit einer **Obergrenze von 7 Tagen**, nach der das Team von selbst weitermacht (eine vergessene Pause bringt es so nicht für immer zum Schweigen). Sag das einmal.

## 3. Solange das Team pausiert ist

- Wecke den Capitano oder sonst jemanden **nicht** für neue Anfragen, Tickets oder Antworten: Sag dem Nutzer, dass *sie bearbeitet werden, sobald er fortsetzt*. Ein Ticket bleibt offen, nichts geht verloren.
- Agenten **nicht** starten, stoppen, neu starten oder erzeugen. Throttles nicht anfassen.
- Wenn nach dem Stand gefragt wird: `python3 /app/shared/skills/standby.py status` (und für einen Agenten `python3 /app/shared/skills/agent_pause.py status SCOUT-1`). Die Sitzungen sind an; niemand arbeitet.
- Der Capitano, wenn wach: Schritt abschließen, keine neuen Aufträge, still warten.

## 4. Fortsetzen

```bash
python3 /app/shared/skills/agent_control.py resume
```

`result: "resumed"` — jede Sitzung erhielt *„mach genau da weiter, wo du warst“* und die Automatik ist wieder aktiv. `"not_paused"` — es gab keine Pause. `error: "team_halted"` — der Nutzer hatte das Team **gestoppt**: Eine Pause fortzusetzen schaltet es nicht ein; sag es und biete an, es zu starten.

Ein Agent, den der Nutzer **einzeln** pausiert hat (§5), wird vom Fortsetzen des Teams nicht geweckt: Er bleibt pausiert, bis er für sich fortgesetzt wird.

## 5. Ein einzelner Agent

```bash
python3 /app/shared/skills/agent_control.py pause-agent SCOUT-1
python3 /app/shared/skills/agent_control.py resume-agent SCOUT-1
```

Der Rest des Teams arbeitet weiter. `error: "agent_not_running"` — diese Sitzung läuft nicht; `"agent_contained"` — jemand hat sie absichtlich gestoppt: sag es, erzwinge nichts. Einen Agenten zu stoppen oder neu zu starten löscht seine Pause.

## 6. Was du dem Nutzer sagst — nur was geschehen ist

Nach der Pause (Worte anpassen, Fakten behalten):

> Das Team ist pausiert. Die N Agenten laufen noch und jeder behält im Kopf, was er tat; niemand arbeitet, bis du mir sagst, dass es weitergeht, und nichts wurde heruntergefahren. Ich bleibe hier. (Bei `not_reached`: „X hat nicht geantwortet, ich konnte es nicht benachrichtigen.“)

Nach dem Fortsetzen: *„Erledigt: jeder macht da weiter, wo er war.“* Nach einem Fehler: *was fehlgeschlagen ist* und in welchem Zustand das Team ist (`standby.py status`).

## Anti-Muster

- ❌ „Paused ✅“ ohne die Antwort des Befehls. Das Wort kommt aus `result`, die Zahlen aus `detail`.
- ❌ Den Capitano bitten, „ein controlled freeze anzuwenden“, und seine Antwort als die Pause melden. Der Capitano ohne Skill schrieb das Stopp-Flag.
- ❌ `jht team stop`, `.team-halted.flag`, `kill-session`, `freeze_team.py` (Esc an jedes Pane) für eine Pause.
- ❌ Das Team während einer Pause für ein Ticket wecken.
- ❌ Das Herunterfahren zum Standard für „stopp alles“ machen: Jeder Agent verliert seinen Kontext.

## Siehe auch

- `graceful-shutdown` — den Arbeitstag beenden, wenn der Nutzer die Anwendung verlässt (etwas anderes: die Agenten werden geschlossen).
- `throttle-distribution` — Agenten auf das Tempo des Budgets bremsen (eine Pause ist kein Throttle).
