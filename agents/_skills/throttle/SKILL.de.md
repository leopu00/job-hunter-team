<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: throttle
description: Pausiere deinen Loop fuer N Sekunden auf nachverfolgbare Weise. Verwende IMMER dies anstelle von `sleep`, wann immer du deine Iterationsrate verlangsamen willst, um das Rate-Budget des Teams einzuhalten. Die Dauer wird aus $JHT_HOME/config/throttle.json gelesen (der Kapitaen kalibriert dort die Werte pro Agent); uebergib --agent <dein-name> und die Skill erledigt den Rest. Verwendet ein Muster mit abgetrenntem Kindprozess, das jeden Tool-Call-Timeout des Providers ueberlebt (Kimi 60s, Codex 30s, Claude 120s/600s). Kombiniere immer mit `jht-throttle-check` vor jeder Aufgabe, um wiederherzustellen falls ein Elternprozess vorzeitig beendet wird. Protokolliert jede Pause in $JHT_HOME/logs/throttle-events.jsonl. `sleep` fuer Throttle-Pausen ist VERBOTEN.
allowed-tools: Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle.py *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle — nachverfolgte Pause

Shell-Wrapper unter `/app/agents/_tools/jht-throttle`. Ruft intern
`/app/shared/skills/throttle.py` auf.

## Warum es existiert

Bisher hat jeder Agent `sleep N` in seinen Loop gesetzt "wenn es ihm richtig erschien".
Das funktioniert, aber das Team hat keine Beobachtbarkeit darueber: der Kapitaen kann
nicht sehen *wer* pausiert, *wie lange*, *wie oft*. Mit dieser Skill wird jede
Pause an `$JHT_HOME/logs/throttle-events.jsonl` angehaengt mit dem
Agentennamen, den angeforderten Sekunden, den angewandten Sekunden und einem optionalen Grund.

Das Dashboard in `/team` liest diese Datei und zeigt ein Throttle-Diagramm
pro Agent, damit wir das Tempo des Teams *sehen* und ueber die Zeit anpassen koennen.

## Wie die Kalibrierung funktioniert (lies dies sorgfaeltig)

Der Kapitaen kalibriert **die Dauer** fuer jeden Agenten in
`$JHT_HOME/config/throttle.json` ueber:

```bash
python3 /app/shared/skills/throttle-config.py set <agent> <seconds>
```

Du (der operierende Agent) MUSST den aktuellen Wert NICHT kennen.
Rufe einfach auf:

```bash
jht-throttle --agent <dein-name> [--reason "..."]
```

und die Skill liest die Konfiguration, schlaeft diese Sekunden, protokolliert das
Ereignis und kehrt zurueck. Wenn der Kapitaen dich auf 0 gesetzt hat (oder du nicht in
der Konfiguration bist), kehrt die Skill sofort als No-Op zurueck — kein Log, kein
Sleep, dein Loop laeuft mit voller Geschwindigkeit.

Das bedeutet:

- Der Kapitaen aendert die Kalibrierung mit **einem einzigen Config-Schreibvorgang**, keine
  tmux-Orchestrierung. Dein naechster Aufruf nimmt den neuen Wert auf.
- Du speicherst den Throttle-Wert nie in deinem eigenen Gedaechtnis; du
  hardcodest kein `jht-throttle 60` in deinem Loop. Der Kapitaen besitzt den Wert.
- Der Kapitaen kann dir auch sagen, die Skill **haeufiger oder seltener**
  in deinem Loop aufzurufen (z.B. "Throttle bei jeder Aufgabe" vs "Throttle
  alle 3 Aufgaben") — das ist eine separate Achse, die du kontrollierst.

## Verwendung

```bash
# Empfohlen (liest die Config):
jht-throttle --agent <dein-name> [--reason "..."]

# Expliziter Override (umgeht die Config; nur wenn der Kapitaen
# es dir mit einer bestimmten Zahl sagt):
jht-throttle <seconds> --agent <dein-name> [--reason "..."]
```

## Wie es intern funktioniert (abgetrenntes Muster)

`jht-throttle` verwendet ein Muster mit **abgetrenntem Kindprozess**, das jeden
Tool-Call-Timeout des Providers ueberlebt (Kimi 60s, Codex 30s, Claude 120s/600s):

1. Liest die Config, um die Dauer zu erhalten.
2. Schreibt eine Zustandsdatei `$JHT_HOME/state/throttle-<agent>.json` mit
   `until = NOW + duration` (verwendet von `jht-throttle-check` und
   `jht-throttle-wait`).
3. Forkt einen `python3 throttle.py`-Unterprozess als Kind von init
   (PPID 1) — ausserhalb des Unterprozessbaums des Tool-Calls. Dieses Kind schreibt
   das `start`-Ereignis, schlaeft und schreibt das `end`-Ereignis unabhaengig
   davon, was mit dem aufrufenden Tool-Call passiert.
4. Der Elternprozess (das Bash, das du aufrufst) blockiert fuer die gesamte Dauer
   in 15-Sekunden-Sleep-Stuecken. Der gestueckelte Sleep ist kuerzer als jeder
   Standard-Tool-Call-Timeout des Providers, also ueberlebt der Elternprozess
   auch bei Kimi 60s Standard. **Der Agent bleibt die ganze Zeit blockiert.**
5. Wenn der Provider den Elternprozess BEENDET (z.B. du hast nicht genug
   Timeout in deinem Tool-Call angegeben): das abgetrennte Kind laeuft weiter und
   schreibt `end` korrekt → kein Waise im Log. Aber der Agent (du)
   ist jetzt frei und koennte faelschlicherweise die naechste Aufgabe starten. Um das
   zu verhindern, siehe das **Gate-Muster** unten.

## Gate-Muster: pruefe IMMER vor der naechsten Aufgabe

Nach jedem `jht-throttle` (und besonders in normalen Loop-Iterationen),
**bevor du eine neue Aufgabe startest**, fuehre aus:

```bash
jht-throttle-check <dein-name>
# exit 0 → ok, starte die naechste Aufgabe
# exit 1 → "STILL_THROTTLED remaining=Xs" auf stderr, du musst warten
```

Wenn `jht-throttle-check` mit 1 beendet, rufe sofort auf:

```bash
jht-throttle-wait <dein-name>
# Blockiert (in 15s-Stuecken) bis until abgelaufen ist, dann beendet.
```

Dies ist der Wiederherstellungspfad: ein vorheriger `jht-throttle`, dessen Elternprozess
vorzeitig durch den Provider-Timeout beendet wurde. Das abgetrennte Kind
schlaeft noch, die Zustandsdatei ist noch gueltig, der Check sagt dir
"starte noch keine Aufgabe". Das Wait blockiert dich sicher erneut.

Der vollstaendige sichere Loop in deinem Role-Prompt:

```
loop:
    jht-throttle-check <me>          # gate
    if exit 1:
        jht-throttle-wait <me>       # erneut blockieren
    do_task()
    jht-throttle --agent <me>        # Eltern blockiert + Kind abgetrennt
```

## Regeln

- **NIEMALS** `sleep N` fuer Throttle-Pausen verwenden. Verwende stattdessen `jht-throttle`.
  Einfaches `sleep` ist nur fuer sehr kurze Wartezeiten zwischen Wiederholungsversuchen
  erlaubt (≤ 5 s), wo Protokollierung Rauschen waere.
- **MUSS im VORDERGRUND laufen, blockierend.** `jht-throttle` ist die Pause deines
  Loops — sein ganzer Zweck ist es, *dich* daran zu hindern, irgendetwas anderes zu tun,
  bis es zurueckkehrt. Fuehre es ueber dein normales blockierendes Shell-Tool aus (`Shell`
  / `Bash`), warte bis es beendet, und erst dann gib den naechsten Tool-
  Call aus. **NICHT** in ein Hintergrund-`Task`/`TaskOutput`/`bash &`
  / `nohup` / `disown` einwickeln und parallel weiterarbeiten — der Elternprozess
  blockiert fuer dich absichtlich. (Das abgetrennte *Kind* laeuft im
  Hintergrund; das ist ein internes Implementierungsdetail des
  Wrappers, nichts was du tust.)
- **Pruefe IMMER vor der naechsten Aufgabe.** Wenn dein Tool-Call frueher
  als die Config-Sekunden zurueckkehrte (Provider-Timeout), rufe zuerst `jht-throttle-check`
  auf. Rate nicht.
- Uebergib immer `--agent <dein-name>` (z.B. `scout-1`, `capitano`,
  `analista-2`) — es ist der Schluessel, nach dem das Dashboard gruppiert UND der Schluessel, den der
  Kapitaen in die Config schreibt.
- `--reason` ist optional aber nuetzlich: ein kurzer Tag wie
  `"post-batch"`, `"cooldown after URG"`, `"waiting for analyst"`
  hilft spaeter beim Zuruecklesen der Ereignisse.

## Beispiele

```bash
# Pre-Task-Gate (immer vor dem Start einer Aufgabe)
jht-throttle-check scout-1 || jht-throttle-wait scout-1

# Scout: Pause zwischen Batches, Dauer vom Kapitaen in der Config gesetzt.
jht-throttle --agent scout-1 --reason "post-batch cooldown"

# Kapitaen: expliziter Override (selten, nur fuer Notfaelle)
jht-throttle 60 --agent capitano --reason "between cycles"

# Schreiber: Pause waehrend er auf den Kritiker wartet, config-gesteuert
jht-throttle --agent scrittore-1 --reason "waiting critic review"
```

## Exit-Codes

- `0` — Pause durchgefuehrt und protokolliert, ODER Config gab 0 zurueck (No-Op-Schnellpfad)
- `1` — fehlende oder ungueltige Argumente

## Hinweis des Kapitaens

Um einen Agenten zu verlangsamen, **bearbeite die Config**, sende keine Zahl ueber
tmux:

```bash
# Einzelner Agent
python3 /app/shared/skills/throttle-config.py set scout-1 60

# Multi-Agent in einem atomaren Schreibvorgang
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=60 scrittore-1=120 analista-1=0

# Aktuellen Zustand ausgeben
python3 /app/shared/skills/throttle-config.py dump
```

Verwende tmux nur, um Agenten zu sagen, die Skill **haeufiger oder seltener**
in ihrem Loop aufzurufen, nicht um die Dauer vorzugeben.
