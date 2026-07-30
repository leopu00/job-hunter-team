<!-- @translation: de, ai-translated 2026-07-30 -->
---
name: throttle
description: Registriere deine Pause und BEENDE DEINEN ZUG. Die Zeit gehoert nicht mehr dir - eine Engine ausserhalb deines Prozesses besitzt den Timer und weckt dich per tmux, wenn er ablaeuft. Nutze IMMER das statt `sleep`, wenn du deine Iterationsrate senken willst. Ein Aufruf, `throttle <dein-name>`, kehrt sofort zurueck; du weisst nicht, wie lange du wartest, und du darfst es nicht herausfinden wollen. Beim Aufwachen ist dein ERSTER Befehl immer `throttle-ack <dein-name>`. `sleep` fuer Throttle-Pausen ist VERBOTEN, und ebenso, diesen Aufruf mit `&` / `nohup` / einem Hintergrund-Task in den Hintergrund zu schicken.
allowed-tools: Bash(throttle *), Bash(throttle-ack *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle — Pause registrieren, dann anhalten

```bash
throttle <dein-name> [--reason "..."]
```

Kehrt sofort zurueck. Dann **beende deinen Zug**: keine weitere Aufgabe, kein
weiterer Befehl.

## Warum es so funktioniert

Bis zum 2026-07-30 war der Throttle ein Vertrag, den du selbst einhalten musstest:
`jht-throttle` blockierte *deinen eigenen Prozess* mit einer Sleep-Schleife, und
wenn dieser Prozess starb, musstest du es merken und dich neu blockieren. Jeder in
Produktion beobachtete Ausfall entstand aus diesem Design. Der schlimmste: ein
Analyst startete `jht-throttle … &` in einem zusammengesetzten Befehl, den das
Tool-Call-Timeout nach 60s abschoss. Das abgeloeste Kind starb mit seinem Parent,
der Agent beendete seinen Zug in der Annahme, die Pause laufe — und **niemand
weckte ihn je wieder**. 2h15m Stillstand, wobei der Watchdog die Session als
`idle` = gesund meldete.

Nun gehoert der Timer einer Engine, die **kein Kind deiner Shell ist**:

```
DU                           ENGINE (Daemon, ausserhalb deines Prozesses)
 |                              |
 |-- throttle <me> ------------>|  liest die vom Kapitaen kalibrierte Dauer
 |                              |  setzt dein Flag auf IN_THROTTLE
 |   (du beendest den Zug       |  armiert den Timer AUF PLATTE
 |    und tust NICHTS)          |
 |                              |
 |<-- [RIPRENDI] per tmux ------|  Timer abgelaufen -> Flag wird NOTIFIED
 |                              |
 |-- throttle-ack <me> -------->|  DU kippst NOTIFIED -> ACTIVE
 |   (erste Handlung beim Wecken)|
```

Ein Daemon-Neustart verliert nichts: die Faelligkeit ist ein absoluter Zeitstempel
auf Platte, es gibt also keinen Timer im Speicher, der neu armiert werden muesste.

## Die Regeln

- **Du uebergibst nie eine Zahl und du siehst nie eine.** Die Dauer steht in
  `$JHT_HOME/config/throttle.json`, gehoert dem Kapitaen, und die Engine liest sie
  *beim Armieren des Timers* — so greift eine Neukalibrierung in deinem
  **naechsten** Zyklus, ohne dass es dir jemand sagen muss. Verdrahte kein
  `throttle 600` in deiner Schleife.
- **BEENDE DEN ZUG nach dem Aufruf.** Der Aufruf kehrt in Millisekunden zurueck,
  genau damit kein Tool-Call-Timeout ihn toeten kann. Arbeitest du danach weiter,
  laeufst du voellig ohne Pause — genau das, was der Throttle verhindern soll.
- **NIEMALS** in den Hintergrund (`&`, `nohup`, `disown`, ein Hintergrund-Task). Es
  gibt nichts in den Hintergrund zu schicken: er schlaeft nicht.
- **NIEMALS** rohes `sleep N` fuer eine Throttle-Pause. `sleep` ist nur fuer sehr
  kurze Wartezeiten zwischen Retries (≤ 5 s), wo Logging Rauschen waere.
- **Beim Aufwachen ist `throttle-ack <dein-name>` dein erster Befehl** — siehe die
  Skill `throttle-ack`. Laesst du ihn aus, bleibt dein Flag auf `NOTIFIED`, was der
  Watchdog als Beweis liest, dass du blockiert bist, und er eskaliert an den
  Kapitaen wegen eines Agenten, dem es voellig gut geht.
- `--reason` ist optional, aber nuetzlich: ein kurzes Label (`"post-batch"`,
  `"warte auf den Kritiker"`) macht `logs/throttle-engine.jsonl` spaeter lesbar.

## Beispiele

```bash
# Scout, am Ende einer Position:
throttle scout-1 --reason "post-batch"
# ... und der Zug endet hier.

# Schreiber, der auf den Kritiker wartet:
throttle scrittore-1 --reason "waiting critic review"
```

## Exit codes

- `0` — Timer armiert, oder Dauer 0 (keine Pause: der interaktive Kern steht
  absichtlich auf 0, damit er fuer den Chat des Nutzers reaktiv bleibt — weiter)
- `1` — ungueltige Argumente, oder Engine fehlt

## Veraltete Befehle

`jht-throttle`, `jht-throttle-check` und `jht-throttle-wait` funktionieren weiter:
sie sind heute duenne Shims ueber der Engine, gehalten fuer noch nicht migrierte
Prompts. Bevorzuge `throttle` + `throttle-ack`. Wenn du dich beim Berechnen von
Timeouts fuer einen Tool-Call wiederfindest (`timeout: N+30`), bist du auf dem
alten Weg — das brauchst du nicht mehr.

## Notiz fuer den Kapitaen

Um einen Rhythmus zu aendern, bearbeite die Config — schicke nie eine Zahl per
tmux:

```bash
throttle-set scout-1 660                       # ein Agent
throttle-set scout-1=660 analista-1=300        # mehrere, 1 atomarer Write
throttle-set --dump                            # die aktuell effektiven Werte
```

Die Aenderung greift von selbst im naechsten Zyklus jedes Agenten. Nutze tmux nur,
um einem Agenten zu sagen, die Skill **oefter oder seltener** in seiner Schleife
aufzurufen, nie um eine Dauer zu diktieren.
