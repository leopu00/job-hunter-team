<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: cache-prune
description: "Speicherplatz auf den gemeinsamen JHT-Caches zurückgewinnen (`uv` Wheel-Cache + `codex` SQLite-Log) alle ~24h. Zuständig: Dottore — Einzelinstanz, läuft am Ende einer Routinerunde wenn das Team inaktiv ist. Niemals mitten in einem Notfall ausführen: das SQLite VACUUM blockiert ~30s bei einer 200 MB DB und würde einer Sentinel-gesteuerten Wiederherstellung Zyklen stehlen. Vom Captain migriert, damit der Captain sich auf Koordination konzentriert, nicht auf Housekeeping."
allowed-tools: Bash(node /app/cli/bin/jht.js cache *), Bash(du *), Bash(df *)
---

# cache-prune — gemeinsame Caches zurückgewinnen

Das gemeinsame `$JHT_HOME` sammelt zwei Caches an, die monoton wachsen bis sie zurückgewonnen werden:

| Pfad                                  | Was es speichert                        | Typisches Wachstum (Stichprobe 2026-05-02) |
|---------------------------------------|-----------------------------------------|------------------------------------|
| `$JHT_HOME/.cache/uv/`                | Wheel-Cache für jedes `uv pip install`  | ~364 MB                            |
| `$JHT_HOME/.codex/logs_2.sqlite`      | Codex-Telemetrie SQLite (71% TRACE-Zeilen) | ~223 MB                         |

Keines wird auf der Festplatte benötigt: uv lädt bei Bedarf neu herunter, Codex kürzt TRACE-Zeilen sicher. Die obigen Zahlen stammen von einem kontinuierlichen Lauf; bei einem frischen `$JHT_HOME` starten sie bei 0 und erreichen Hunderte MB innerhalb weniger Tage.

## Der einzige sichere Befehl

```bash
node /app/cli/bin/jht.js cache prune
```

Idempotent und No-Op wenn nichts zurückzugewinnen ist. Intern:
1. `uv cache prune` — verwirft veraltete Wheels (behält den aktiven Satz, der von aktuellen Installationen referenziert wird).
2. SQLite `VACUUM` auf `logs_2.sqlite` nach dem Löschen alter TRACE-Zeilen.
3. Bereinigung von ephemeren Codex-Temporärdateien.

Jeder Schritt hat ein Sicherheits-Gate: `idle > 1h` bei den destruktiven Operationen (VACUUM-Lock, TRACE-Löschung) — wenn das Team aktiv Token verbraucht, wird der Schritt übersprungen.

## Wann ausführen

- 👨‍⚕️ **Ende einer routinemäßigen Dottore-Runde** (~24h kontinuierlicher Lauf oder am Beginn eines inaktiven Betriebstags).
- 📉 **Auf Anfrage** wenn `du -sh $JHT_HOME/.cache $JHT_HOME/.codex` Wachstum > 800 MB gesamt zeigt.
- 🚫 **NIEMALS** mitten in budget-kritischer Phase (proj > 95%) — das VACUUM blockiert 30s die Codex-SQLite, die der Sentinel über die Bridge liest.
- 🚫 **NIEMALS** als Reaktion auf einen Sentinel `[ORDINE]` — Befehle verlangen Pacing/Skalierungs-Aktionen, kein Housekeeping.

## Sicherheit: was NICHT angefasst werden darf

Das Team hat *andere* Caches, die ähnlich aussehen, aber NICHT im Scope sind:

| Pfad                                 | Warum Finger weg                                                  |
|--------------------------------------|-------------------------------------------------------------------|
| `.cache/ms-playwright/`              | Browser-Binaries auf Version gepinnt — erneutes Herunterladen ist langsam + unzuverlässig |
| `.cache/claude-cli-nodejs/`          | Anthropic CLI-Runtime-Cache, wird bei Bedarf neu erstellt, aber größer wenn warm |
| `$JHT_HOME/logs/`                    | Sentinel-Zustand lebt hier. Löschen verliert das EMA-Fenster und mehrere Minuten Monitoring-Historie. |

Der Wirkungsbereich von `cache prune` ist auf die zwei Pfade in der obigen Tabelle begrenzt.

> ⚠️ **`cache clear` ist verboten.** Dieser Befehl (ein destruktiver Verwandter von `cache prune`, bereitgestellt von `jht`) löscht `logs/` zusammen mit den Caches und zerstört den Sentinel-Zustand. Wenn du je den Drang verspürst, `cache clear` auszuführen, eskaliere stattdessen an den Nutzer.

## Anomales Wachstum — eskalieren

Wenn `du -sh` einen Pfad *außerhalb* der 2 Ziele oben schnell wachsend zeigt (z.B. `.cache/ms-playwright/` hat sich verdoppelt, `.codex/sessions/` bläht sich auf), NICHT eigenständig bereinigen. Erfasse:

```bash
du -sh $JHT_HOME/.cache/* $JHT_HOME/.codex/*
df -h $JHT_HOME
```

…logge es in `dottore-actions.jsonl` mit `event=disk_anomaly` + der `du`-Ausgabe und bringe es über den Captain an den Nutzer (`jht-tmux-send CAPITANO`). Ein neuer wachsender Pfad könnte bedeuten, dass ein neues Tool ohne Budget für Bereinigung hinzugefügt wurde.

## Ausgabe zum Log

An `/jht_home/logs/dottore-actions.jsonl` anhängen:

```json
{"ts": "ISO-UTC", "round_id": "...", "event": "cache_prune",
 "uv_freed_mb": 142, "codex_freed_mb": 87, "total_freed_mb": 229,
 "duration_sec": 31}
```

Wenn ein Schritt vom Idle-Gate übersprungen wurde, setze den entsprechenden `_freed_mb` auf `null` und füge `"skipped": ["vacuum"]` hinzu.

## Anti-Patterns

- ❌ `cache prune` vom Captain ausführen — diese Verantwortung wurde hierher migriert. Der Captain koordiniert, der Dottore wartet.
- ❌ Ausführen während ein Writer mitten im CV ist (seine Schleife greift gelegentlich auf den uv-Cache für pandoc/typst-Libs zu).
- ❌ Einen cron-artigen Loop im Dottore-Prompt hinzufügen — der Dottore ist One-Shot mit ~30 Min. Kadenz, du platzierst cache-prune am Rundenende wenn es sinnvoll ist, nicht nach festem Zeitplan.
- ❌ Den `jht.js cache prune`-Wrapper umgehen, um `uv cache prune` / `sqlite vacuum` direkt auszuführen — du übergehst das Idle-Gate und das einheitliche Logging.

## Siehe auch

- `agents/dottore/dottore.md` — wann im Lebenszyklus des Dottore dieser Skill einzuordnen ist (nur am Rundenende).
- `py-tools-audit` — Schwester-Wartungs-Skill (Python-Pakete, ~wöchentliche Kadenz).
- `agents/_team/team-rules.md` T13 — uv-als-einziger-Installer-Regel (warum der uv-Cache überhaupt existiert).
