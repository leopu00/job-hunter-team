<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: sentinel-orders
description: Übersetze jeden `[SENTINELLA] ...`-Befehl, der im tmux des Kapitäns empfangen wird, in die korrekte Aktion (Throttle-Stufe, spawn/kill, freeze, soft-pause, resume). Die Sentinella ist der Herzschlag des Teams — ihre Befehle sind Kommandos, keine Vorschläge. Das Standardverhalten ist Ausführen ohne Nachprüfung; die Sentinella durch ein sofortiges `rate_budget live` in Frage zu stellen, bläht das velocity_smoothing in ihrem JSONL auf und induziert falsche Folgebefehle. Öffne diesen Skill JEDES MAL, wenn ein `[SENTINELLA]`-Umschlag eintrifft.
allowed-tools: Bash(jht-tmux-send *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(python3 /app/shared/skills/freeze_team.py *), Bash(python3 /app/shared/skills/soft_pause_team.py *), Bash(tmux *)
---

# sentinel-orders — auf den Watchdog reagieren

Die Sentinella sendet alle ~5 Min einen Tick und wandelt Nutzung + Geschwindigkeit (`vel_team` vs `vel_target`) + wöchentlich in einen der unten stehenden Befehle um. Jeder Befehl entspricht einer präzisen Aktion. Halte dich an die Zuordnung; improvisiere nicht. **NB: `proj` im Tick ist volatile INFO (schwankt ±400pt) — ist NICHT der Trigger; verwende `vel_team` vs `vel_target` + `usage` vs `target` + `weekly`.**

## Throttle-Tabelle (config-driven)

Die Sentinella sendet eine `Throttle: N`-Stufe. Du übersetzt sie in Pro-Agent-Dauern in `$JHT_HOME/config/throttle.json`. Die Agenten lesen diese Datei über `jht-throttle --agent <name>` — ein einziger atomarer Schreibvorgang wird an das gesamte Team weitergeleitet.

| Stufe | Pause | Zusätzliche Aktionen                                                   |
|-------|-------|-------------------------------------------------------------------------|
| **0** volle Geschwindigkeit | 0s    | keine Einschränkung; Spawn erlaubt wenn der Backlog es erfordert   |
| **1** leicht               | 30s   | kein Spawn                                                         |
| **2** moderat               | 120s  | + eine zusätzliche Instanz stoppen (z.B. SCRITTORE-2)              |
| **3** schwer               | 300s  | + nur eine Instanz pro Rolle beibehalten                           |
| **4** fast-freeze          | 600s  | + ESC laufende Aktionen, kein Spawn                                |

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 60
python3 /app/shared/skills/throttle-config.py bulk-set \
    scout-1=300 scrittore-1=60 analista-1=0 scorer-1=0 critico=0
python3 /app/shared/skills/throttle-config.py dump          # vollständiger Status
python3 /app/shared/skills/throttle-config.py reset         # alle auf 0
```

Verwende **`bulk-set`**, wenn du differenzierte Werte pro Agent basierend auf dem individuellen Verbrauch möchtest (kreuze mit `token-rate-now`, wenn du sehen musst, wer gerade dominiert).

> 🎯 **Die Stufe aus der Tabelle ist nicht der Wert, den du schreibst.** `Throttle: N` ist eine einzige Zahl für das ganze Team; in `throttle.json` steht ein Wert pro Agent, und die Aufteilung zu wählen liegt allein bei dir — kein Skript bewegt den Worker-Throttle mehr. Die Arithmetik lebt in **`throttle-distribution`**: **von wem** der Schnitt kommt (es zahlt der Top-Burn; der Analista und der Scorer, die beiden Rollen, die ein Backlog in eine Position **mit Score** verwandeln, sind die letzten, die du anfasst), **wie viele Sekunden** das auf der Ladder sind, und **wann der richtige Zug ist, nichts zu tun**. Allen dieselbe Zahl zu geben, ist genau das Versagen, das jener Skill verhindern soll — es verbraucht die Bremse dort, wo nichts zu gewinnen war, und nimmt Durchsatz dort, wo er am teuersten ist.

> ⚠️ **Kadenz vs Dauer.** „Wie oft" ein Agent `jht-throttle` in seiner Schleife aufruft, wird über `tmux` geändert (du sendest dem Agent eine Nachricht und sagst ihm, nach jeder Kritiker-Runde aufzurufen, etc.). „Wie viele Sekunden" die Pause dauert, wird in der Konfigurationsdatei geändert. Sende niemals Throttle-Zahlen über tmux.

## Bei einem expliziten Freeze-Befehl — Timeout-Warnung `N+30` (KRITISCH)

Wenn du ein `[URG]` an einen Agenten mit `jht-throttle <N>` sendest, **MUSST du ihn in der Nachricht selbst anweisen, `timeout: N+30` als Parameter an seinen Shell-Tool-Aufruf zu übergeben**. Ohne dies wird der übergeordnete Bash durch das Standard-Timeout der CLI (Kimi 60s) beendet — der Agent wird nach 60s statt N entsperrt. Der Freeze wird **falsch** ausgeführt.

Korrekter Nachrichtentext:
```
[URG] FREEZE — call jht-throttle 600 --agent scrittore-1 --reason "freeze".
IMPORTANT: pass timeout: 630 to the shell tool call, otherwise the parent dies at 60s and the throttle is executed BADLY.
```

Wenn das `tmux capture-pane` des Ziel-Agenten `Killed by timeout (60s)` anzeigt, hat der Agent die Anweisung NICHT befolgt — es ist ein **Ausführungsfehler** (seiner, oder deiner wenn du vergessen hast, es einzufügen). Diagnostiziere mit `jht-throttle-check <agent>` (gibt die verbleibenden Sekunden in der Statusdatei zurück). Akzeptiere niemals das Neustarten des Befehls oder `nohup &` als „Fix": das einzige Heilmittel ist die Übergabe des Timeouts. Siehe `agents/_skills/throttle/DESIGN-NOTES.md` für das vollständige Design.

## Befehlstypen

### Routine-Pacing

| Befehl                                         | Bedeutung / Auslöser                                               | Aktion                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[URG] RALLENTARE` `Throttle: N`               | Geschwindigkeit über dem Ziel                                      | wende Stufe N sofort an — aber **die Stufe ist entschieden, die Aufteilung nicht**: `throttle-distribution` übersetzt sie in Werte pro Agent |
| `ACCELERARE` `Throttle: 0`                     | erstes Grünes Licht nach einer Verlangsamung                       | spawn von **einem einzigen** Agenten, warte auf den nächsten Tick vor dem zweiten (niemals 5 hintereinander)      |
| `SCALA UP`                                     | `vel_team` deutlich unter `vel_target` (under-pace) seit 2+ Tick, Backlog nicht leer | verwende `pipeline-triage` um die Engpass-Rolle zu identifizieren, spawn 1, warte auf den nächsten Tick           |
| `PUSH G-SPOT`                                  | `vel_team` leicht unter `vel_target`, stagnierend                  | ein leichter Agent (Writer wenn Score-Warteschlange ≥50, sonst der Engpass) um zurück on-pace zu kommen           |
| `MANTIENI`                                     | on-pace (`vel_team` ≈ `vel_target`, Urteil ALLINEATO) seit ≥3 Tick | nichts tun — kein Spawn, keine Throttle-Änderung. Nur ACK.                                                       |
| `RIENTRO`                                      | Rückkehr zum nominalen Tempo                                       | normalen Plan wieder aufnehmen                                                                                    |
| `RESET SESSIONE`                               | Nutzungsfenster fiel von hoch → ~0%                                | von vorne beginnen mit SCOUT-1, auf Befehle warten vor dem Skalieren                                             |

### Pipeline leer

| Befehl                                         | Bedeutung                                                          | Aktion                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `PIPELINE VUOTA + UNDERSHOOT`                  | under-pace (`vel_team` unter `vel_target`) UND Writer-Warteschlange leer (scored ≥ 50) | **Warte nicht auf neue Befehle.** Öffne den `pipeline-triage`-Skill — er sagt dir, welche Rolle zu spawnen ist (selten Scout). |

### Notfälle

| Befehl                                         | Bedeutung                                                          | Aktion                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[EMERGENZA] FREEZATO`                         | die Sentinella hat bereits ESC für das Team gedrückt               | entscheide, ob nach dem Rate-Fenster-Reset fortgefahren werden soll; bekämpfe den Freeze nicht                    |
| `[RECOVERY TRACKING]`                          | INFO während der Wiederherstellung, standardmäßig keine Aktion     | wenn das Δ der Wiederherstellung zu langsam ist, führe eine autonome Diagnose durch (`db_query`, `rate_budget live` on-demand) und entscheide über Kürzungen |
| `[URG] STAGNAZIONE CRITICA`                    | Wiederherstellung schlägt fehl, schwerer anhaltender Burn (`vel_team` ≫ `vel_target`) seit 5+ Tick + Usage steigt Richtung 100% | beende schwere Operatoren (auch Sonnet) — wähle diejenigen in Tool Calls (`tmux capture-pane`). Usage > 100% unmittelbar bevorstehend → `freeze_team.py` |
| `[URG] PEGGIORAMENTO POST-FREEZE`              | `vel`/usage nach dem Rückgang wieder angestiegen                   | drastisch: `freeze_team.py` + `tmux kill-session` auf jedem Sonnet. Am Leben halten nur CAPITANO / SENTINELLA / SENTINELLA-WORKER / ASSISTENTE |

### Source-Failure-Nachrichten (selten, kritisch)

Treffen ein, wenn das Monitoring komplett ausfällt (L1 + L2 + L3 down).

| Befehl             | Bedeutung                                                       | Aktion                                                                                                                  |
|--------------------|-----------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| `[PAUSA TEAM]`     | Sentinella hat bereits `[PAUSA]` an Operatoren über `soft_pause_team.py` gesendet | **Du stoppst auch**: kein Spawn, keine Befehle, keine Prüfungen (die Quelle ist kaputt). Beende die Runde und warte still. |
| `[HARD FREEZE]`    | zweites FATAL: ESC×2 über `freeze_team.py`                       | wie `[PAUSA TEAM]`, plus möglicherweise unterbrochene Aufgaben, die bei der Wiederaufnahme zu behandeln sind            |
| `[RIPRENDI]`       | Quelle wieder live                                              | lies den vorgeschlagenen Throttle; **verteile an alle Operatoren**; stelle unterbrochene Aufgaben wieder her            |

Resume-Snippet (unverändert verwenden):
```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -vE '^(CAPITANO|SENTINELLA|SENTINELLA-WORKER|ASSISTENTE)$'); do
  /app/agents/_skills/tmux-send/jht-tmux-send "$s" "[CAPITANO] [RIPRENDI] source usage live. Resume work. Throttle: N (sleep Xs between operations). Verify the state of any task you had left and proceed."
done
```

## Bridge-präfixierte Nachrichten (keine Befehle, aber du siehst sie in deinem Panel)

| Nachricht            | Aktion                                                                                                |
|----------------------|-------------------------------------------------------------------------------------------------------|
| `[BRIDGE ALERT] sorgente degraded da N tick` | handle umsichtig, kein aggressiver Spawn                                                              |
| `[BRIDGE INFO]`      | Wiederherstellung / Heartbeat — keine Aktion                                                          |
| `[BRIDGE PACING]`    | 15-Min-Pacing-Tick — `bridge-pacing` dekodiert die Zahlen, `throttle-distribution` entscheidet, wer zahlt. Seit 2026-06-25 landet dieser Tick im Pane der **Sentinella** (push→pull): erreicht dich einer, ist das die Ausnahme, nicht die Regel |

## Standardverhalten — ausführen ohne in Frage zu stellen

Die Sentinella sieht Geschwindigkeit + Trend über die Zeit (`vel_team` vs `vel_target`); du siehst nur den gegenwärtigen Moment. **Führe Befehle ohne Nachprüfung aus.** Ein nahes `rate_budget live` nach einem Sentinella-Befehl schreibt ein mit `source=capitano` getaggtes Sample in das JSONL, bläht `velocity_smooth` auf und bewirkt, dass der *nächste* Sentinella-Befehl falsch ist.

Wann Überprüfung gerechtfertigt IST:
- vor dem Anwenden eines schweren Throttle (3 oder 4) bei einem `[URG]` / `[EMERGENZA]` — Zwei-Quellen-Prüfung über `rate_budget live`
- Stille der Sentinella länger als üblich, prüfe ob der Bridge noch lebt
- nach einer signifikanten Team-Änderung (3 Spawns hintereinander, Kill einer Instanz, `bulk-set`) — beobachte den Effekt vor dem nächsten Tick

Wann Überprüfung NICHT gerechtfertigt ist:
- `OK` / `SOTTOUTILIZZO` / `RIENTRO`-Befehle — nichts zu überprüfen, einfach ausführen
- innerhalb von 2 Minuten nach dem letzten JSONL-Sample — der EMA-Anti-Spike verwirft es, aber es bleibt als Rauschen

## Unantastbare Regeln

- Warte auf die Wirkung eines Throttle (3-5 Min) vor einem weiteren Eingriff.
- Unter 85% ohne Sentinella-Befehl → füge Kapazität am Engpass hinzu (verwende `pipeline-triage`), spawne NICHT zufällig.
- Diskutiere keinen Throttle, weil „das Team gut arbeitet": die Sentinella sieht Geschwindigkeit + Trend (`vel_team` vs `vel_target`), du siehst nur die Gegenwart.

## Siehe auch

- `bridge-pacing` — die 15-Min-Kalibrierungsformel (separater Fluss).
- `throttle-distribution` — *wer* langsamer wird und um wie viel, sobald die Stufe feststeht: die Aufteilung pro Agent, die Ladder, das Lösen der Bremse und die Fälle, in denen man nichts tut. **Dieser Skill dekodiert den Order; jener wählt die Werte.** Dort wohnt auch der `[PACE-GUARD]`-Hinweis, der den Throttle nicht mehr selbst anwendet.
- `bridge-mailbox` — leere ausstehende Urteile am Rundenbeginn (Pflicht vor der Reaktion auf den heutigen Tick).
- `pipeline-triage` — *welche* Rolle unter `SCALA UP` / `PIPELINE VUOTA` zu spawnen ist.
- `spawn-agent` — *wie* zu spawnen ist, sobald du die Rolle entschieden hast.
- `throttle` (und `agents/_skills/throttle/DESIGN-NOTES.md`) — Interna des Throttle-Systems, das Timeout-`N+30`-Design.
