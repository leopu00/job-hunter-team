<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: rate-budget
description: Den Rate-Limit-Budget-Snapshot für den aktiven Provider (Nutzung %, Zeit bis Reset, Geschwindigkeit, Projektion, empfohlener Throttle) von der Bridge lesen. Beim Captain-Start verwenden, um das Tempo zu planen und zu entscheiden, wie viele Agenten gespawnt werden, dann periodisch wenn du einen frischen Snapshot willst, ohne Token für einen direkten Provider-Aufruf auszugeben. Null Provider-Aufrufe — liest den letzten bereits von der Bridge geschriebenen Tick.
allowed-tools: Bash(python3 *)
---

# rate-budget — Rate-Limit-Budget-Snapshot

Die Monitoring-Bridge (`.launcher/sentinel-bridge.py`) pollt den aktiven Provider alle 1-10 Min. (dynamisch — häufiger unter Druck) und schreibt jede Stichprobe nach `/jht_home/logs/sentinel-data.jsonl`. Dieser Skill liest nur die **letzte Stichprobe**, die bereits geschrieben wurde — kein zusätzlicher Provider-Aufruf.

## Beim Captain-Start

Vor dem Spawnen eines Agenten ausführen:

```bash
python3 /app/shared/skills/rate_budget.py plan
```

Typische Ausgabe:
```
=== Rate Budget — claude ===
  Usage:            53%
  Reset:            tra 2h 34m (2026-04-24 15:49 CEST)
  Measured velocity:+0.39%/h (EMA)
  Target velocity:  11.38%/h (to close at 92% by reset)
  Reset projection: 56%
  Status:           OK
  Throttle:         T0 full speed
  Host:             cpu=4.7% ram=9.8% (OK)

  Recommended policy: Spawn freely in parallel — keep normal pace.
  Margin to 92% target: 39%
  Last tick:        2026-04-24T10:23:18.705062+00:00
```

**Captain-Interpretation** (verwende `Measured velocity` vs `Target velocity` — NICHT `Reset projection`, die volatile INFO ist):
- `Throttle T0–T1` + `Measured velocity` deutlich unter `Target velocity` (Under-Pace) → voller Spawn (Scout + Analyst + Scorer + Writer + Critic)
- `Throttle T1–T2` + `Measured` ≈ `Target` (On-Pace) → reduzierter Spawn (eine Instanz pro Rolle)
- `Throttle T2+` oder `Measured velocity` über `Target velocity` (Verbrennung) → **kein Spawn**, warten bis die Bridge den Throttle freigibt
- `Reset projection` ist nur INFO (volatile Extrapolation am Fensterende) — Spawn nicht darauf basieren.

**Wenn die Ausgabe `NO_DATA` ist:** Die Bridge hat noch nicht gepollt. 1-2 Min. warten und erneut versuchen. Das Team nicht ohne dieses Signal starten — du riskierst das Rate-Limit blind zu sättigen.

## Einzeiler-Version (skriptfähig)

```bash
python3 /app/shared/skills/rate_budget.py status
# → provider=claude usage=55% status=OK throttle=0 reset_in=2h 34m (at 2026-04-24 15:49 CEST)
```

Nützlich für schnelle Logs oder Prüfungen mitten in der Schleife.

## Wann NICHT verwenden

- **Nicht bei jedem Schritt aufrufen.** Verwende es bei *Phasenwechseln* deines Plans (Bootstrap, Ende des Scout-Batches, nach einer Pause, etc.). Die Bridge aktualisiert mit ihrer eigenen Rate; häufigeres Aufrufen gibt keine frischeren Daten.
- **Es ersetzt nicht den asynchronen `[BRIDGE ORDER]`-Ablauf:** Die Bridge benachrichtigt dich *wenn* sich die Policy ändert; du planst *während du auf* das Budget schaust. Die beiden Mechanismen ergänzen sich.
