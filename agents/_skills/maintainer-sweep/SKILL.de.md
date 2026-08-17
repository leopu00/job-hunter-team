<!-- @translation: de, ai-translated 2026-08-03 -->
---
name: maintainer-sweep
description: "Der INFRA-Wartungsdurchgang des Mantenitore 👷‍♂️ (Zwilling des Dottore, jedoch auf die Infrastruktur statt auf die Agenten bezogen). Ein One-shot-Durchgang pro Tag: Liveness-Kanarienvogel der lebenserhaltenden Prozesse des Containers (bridge/daemon/watchdog) via process_health.py, Smoke-Test der mission-critical Tools (browser/LinkedIn) via tool_health.py, Audit/Konsolidierung nicht standardkonformer Abhängigkeiten, GC verwaister Skripte und tmp-Dateien, De-dup wiederkehrender Skripte, Aktualität der Abhängigkeiten, Disk-/RAM-Trend, UTF-8-Locale-Kanarienvogel der Panes via locale_health.py (kosmetischer Defekt vs korrupte Daten). Single-writer: der Mantenitore ist der EINZIGE, der die Infra repariert; DESTRUKTIVE Aktionen (löschen/archivieren) SCHLÄGT er VOR, entschieden wird vom Capitano. Ergebnis wird an mantenitore-logbook.jsonl angehängt."
allowed-tools: Bash(python3 /app/shared/skills/process_health.py *), Bash(python3 /app/shared/skills/tool_health.py *), Bash(python3 /app/shared/skills/sync_health.py *), Bash(python3 /app/shared/skills/host_vitals.py *), Bash(python3 /app/shared/skills/locale_health.py *), Bash(python3 /app/shared/skills/log_archive.py *), Bash(bash /app/.launcher/start-agent.sh *), Bash(df *), Bash(du *), Bash(free *), Bash(tmux ls *), Bash(jht-install *), Bash(ls *), Bash(stat *), Bash(jht-tmux-send *)
---

# maintainer-sweep — die INFRA gesund halten, leise und regressionssicher

Der Mantenitore ist der Zwilling des Dottore: **Dottore = Gesundheit der AGENTEN** (Sitzungen, Tokens, Context-Refresh); **Mantenitore = Gesundheit der INFRA** (Tools, Abhängigkeiten, Disk, Skripte). One-shot pro Tag: Boot → Durchgang → Logbook → STANDBY (bleib untätig, keine Selbstbeendigung; der nächste Spawn ersetzt dich, kill-then-create). Budget ~10 Min. Scharfe Grenze, null Überschneidung mit dem Dottore.

> **Warum es sie gibt:** der `libatk`-Bug (Browser tot, LinkedIn nicht verifizierbar) blieb stundenlang unsichtbar, weil *niemand die Tools per Smoke-Test prüfte und sich niemand um die Infra kümmerte*. Der Durchgang macht diese Wachsamkeit STRUKTURELL.

## Goldene Regel — single-writer + vorschlagen statt löschen
Der Mantenitore **repariert** die Infra (installiert fehlende Abhängigkeiten, konsolidiert, korrigiert). Aber jede **DESTRUKTIVE** Aktion (Dateien löschen/archivieren, Disk-Aufräumen) **SCHLÄGT** er dem Capitano mit dem exakten Befehl **VOR**; **der Capitano entscheidet** (wie beim Redesign des Usage-Monitorings). Lösche nie aus eigener Initiative.

## Der Durchgang (die Schritte, der Reihe nach)

### 0. 🫀 Liveness-Kanarienvogel der lebenserhaltenden Prozesse (das Sicherheitsnetz)
**ERSTER Schritt, vor allem anderen.** Die Bridges/Daemons, die den Container am Leben halten (sentinel-bridge, pacing-bridge, heartbeat-bridge, window-ratio-meter, codex-auth-healer + tg-bridge), werden `setsid` detached gestartet → **außerhalb des Respawn-on-crash von pid1**. Der `agent-watchdog` (`maybe_respawn_bridges`) überwacht sie alle 30s erneut, ABER falls auch der ausfallen sollte (Bug, Flap-Cap erreicht, Watchdog selbst degradiert), bist du **das letzte Netz**: beim ersten Durchgang des Tages erkennst und reparierst du sie. Ohne diesen Kanarienvogel bleibt ein toter Daemon stundenlang unsichtbar (genau das ist dem sentinel-bridge auf betaC am 2026-06-27 passiert → 8h blind beim Usage).
```bash
python3 /app/shared/skills/process_health.py summary
```
Es gibt OK/DEAD für jeden erwarteten Prozess aus (bridge-suite, pid1-child, daemon, tg-bridge). Für die DEAD:
- **Gruppe `bridge-suite`** (detached, von dir reparierbar) → **REPARIERE** sofort, es ist ein nicht destruktiver Respawn:
  ```bash
  bash /app/.launcher/start-agent.sh bridge      # startet die gesamte Suite neu (idempotent)
  ```
  dann **den Kanarienvogel erneut ausführen**, um zu bestätigen, dass sie wieder leben. Logge `processes_respawned`.
- **tg-bridge** fehlt (und Telegram-Bots sind konfiguriert) → `bash /app/.launcher/start-agent.sh tg-bridge`.
- **Gruppe `pid1-child` / `daemon` / `core`** (agent-watchdog, doctor-watchdog, auto-report-loop, cloud-daemon, pid1) → deren Respawn ist Sache von pid1: sind sie tot, sitzt das Problem tiefer → **ESKALIERE an den Capitano** via `jht-tmux-send` (versuche NICHT, sie von Hand neu zu starten: du würdest sie verwaisen lassen). Lass es nie still verlaufen.

Wenn alles lebt → logge `processes_health: all_ok` und mach weiter. Das ist der Zwilling-für-PROZESSE des Smoke-Tests-für-TOOLS aus Schritt 1.

### 0.5 ☁️ CLOUD-SYNC-Kanarienvogel (pull + push)
Direkt nach dem Prozess-Kanarienvogel. Die Synchronisation lokal↔Cloud hat sich
zweimal verklemmt (pull churn: eingefrorener Cursor → er schrieb ~500 Positionen/Tick
neu; push 413: monolithischer Payload zu groß → Cursor rückte nie vor → Cloud-Dashboard
für ~14h eingefroren). Die Code-Bugs sind behoben, aber die Wachsamkeit muss
STRUKTURELL werden.
```bash
python3 /app/shared/skills/sync_health.py summary        # oder --json
```
Es liest die Cursor nur lesend (`.cloud-sync-cursor.json`, `.cloud-pull-cursor.json`),
das Maximum von `positions.updated_at` in der DB und das Ende von `logs/daemon.log`. Es liefert
`problems[]` mit Schweregrad. Ergebnis:
- **kein Problem** → logge `sync_health: ok` und mach weiter.
- **push_behind / push_errors (HIGH)** → der Push erreicht die Cloud nicht. Von Hand ist das
  für dich NICHT sicher reparierbar (single-writer auf der DB = das Team). **ESKALIERE
  an den Capitano** via `jht-tmux-send` mit den Details des Checks (Lag + 413-Anzahl).
  Wenn der Check den Notfall-Drain vorschlägt (`JHT_PUSH_POS_CHUNK=40`), gib den
  Vorschlag an den Capitano weiter, handle nicht eigenmächtig.
- **pull_churn (MEDIUM)** → melde dem Capitano, dass der Pull zu viele Zeilen
  erneut anwendet (Symptom eines nicht konvergierenden Cursors / nicht ausgerollten Fixes).
- **cursor_stale (MEDIUM)** → sekundäres Indiz; nimm es nur dann in die Eskalation auf,
  wenn es ein HIGH-Signal begleitet.
Logge das Ergebnis unter `sync_health` im Logbook-Eintrag (siehe unten). Die goldene Regel
bleibt unverändert: **erkennen + melden, niemals log-and-forget** (es ist derselbe Fehler wie
beim libatk-Bug und beim sentinel-bridge, hier auf den CURSORN der Sync).

### 1. 🩺 Smoke-Test der mission-critical Tools (das Herzstück)
```bash
python3 /app/shared/skills/tool_health.py --json
```
Es liefert `tools_health` mit `{status: OK|BROKEN|UNKNOWN, evidence}` für jedes Tool (browser/Playwright, linkedin_check, …) + `broken[]`.
- **BROKEN** → **REPARIERE** sofort: `jht-install <dep>` (z. B. die `.so`-Dateien von Chromium), dann den Check erneut ausführen. Wenn repariert → logge `repaired`.
- **BROKEN und nicht reparierbar** → **ESKALIERE an den Capitano** mit dem EXAKTEN Fix via `jht-tmux-send` (z. B. „Browser down: `sudo playwright install-deps`; bis das behoben ist LinkedIn = OPEN_UNVERIFIED"). Lass es nie still verlaufen.
- Es ist DASSELBE `tool_health.py`, das den Build-time-Gate (dev1) und das Feld `tools_health` im Tick speist: eine einzige Quelle der Wahrheit über den Tool-Zustand.

### 2. 📦 Audit nicht standardkonformer Abhängigkeiten → konsolidieren
Abhängigkeiten, die außerhalb der Standardpräfixe installiert sind (`/opt/jht-deps`, `PLAYWRIGHT_BROWSERS_PATH`, npm-Präfix, venv) → installiere sie via `jht-install` in das Standardpräfix um, damit sie nicht verstreut liegen. Logge, welche du konsolidiert hast.

### 3. 🧹 GC verwaister Skripte/tmp-Dateien
Temporäre Skripte, die von **gekillten** Agenten zurückgelassen wurden (Sitzung nicht mehr in `tmux ls`), und abgelaufene tmp-Dateien (> N Stunden). Liste die Kandidaten auf → **SCHLAGE** dem Capitano die Löschung **VOR** (destruktive Aktion), lösche nicht direkt.

### 4. 🔁 De-dup wiederkehrender Skripte
Nahezu identische Skripte, die von mehreren Agenten wiederholt werden → **schlage** eine einzige kanonische Skill **vor** (schreibe sie nicht spontan um). Logge den Vorschlag.

### 5. 📅 Aktualität der Abhängigkeiten
Veraltete Bibliotheken/Tools oder kaputte Versionen / nicht erreichbare kritische Tools → melde es dem Capitano (keine riskanten Auto-Upgrades).

### 6. 💾 Disk / RAM + Trend + VITALS-Gegenprüfung
`du` auf den großen Pfaden, `free` für RAM. Für **`disk.used_pct` IMMER `df` verwenden** — kanonischer Befehl:
```bash
df -P /jht_home | awk 'NR==2 {gsub("%","",$5); print $5}'   # z. B. 30  (Prozentsatz so, wie df ihn meldet)
```
**NIEMALS** aus `statvfs`/`os.statvfs` (`f_bavail`/`f_blocks`) ableiten: reservierte Blöcke blähen den Wert um ca. das 3-Fache auf → Fehlalarme (z. B. gemeldete 88 % gegenüber realen 30 %). Vergleiche ihn mit dem **Trend aus dem letzten Logbook**: wächst er auf eine Schwelle zu → bespreche mit dem Capitano, was archiviert/gelöscht werden soll (er entscheidet). Logge die Zahlen + das Delta.
**Dann die Zeitreihe der Vitals GEGENPRÜFEN** (die Bridge misst RAM+CPU des Containers alle paar Minuten in `vitals.jsonl`):
```bash
python3 /app/shared/skills/host_vitals.py summary --hours 24
```
Sie liefert dir **Spitze/Durchschnitt von RAM+CPU + die UHRZEIT der Spitze** für die letzten 24h. **Korreliere die Spitzen mit dem *Wann*** (z. B. RAM 92 % um 03:00 bei 3 aktiven Analista; CPU am Anschlag während eines schweren Skripts): das ist die Angabe, die die Diagnose weit stärker schärft als eine reine Momentaufnahme. Wirkt eine Spitze anomal → melde sie dem Capitano. Logge `vitals_24h` (RAM-/CPU-Spitze + Uhrzeit) im Eintrag. NB: die Sentinella bekommt den Alarm nur, wenn RAM/CPU live >95 % ist; die Historie zu lesen und zu korrelieren ist **DEINE Aufgabe**.

### 6.5 🗜️ Archivierung der Monitoring-Historien (Anordnung von Leone 19/07 — CODE, kein Ermessen)
Die Append-only-Historien (`sentinel-data.jsonl`, `token-meter.csv`,
`throttle-events.jsonl`, `agent-vitals.jsonl`, `vitals.jsonl`) wachsen unbegrenzt:
sie speisen die Usage-Diagramme des Spiels, dürfen also niemals von Hand
gelöscht werden — sie müssen **mit dem deterministischen Ablauf archiviert** werden:
```bash
python3 /app/shared/skills/log_archive.py status          # Tiefe und Größen
python3 /app/shared/skills/log_archive.py run             # schneidet >30T → Wochen-Zips
```
Was `run` tut (alles im Code, du liest nur die JSON-Zusammenfassung): die Wochen, die
älter als 30 Tage sind, verlassen die Live-Dateien und wandern nach
`logs/archive/logs-<YYYY>-Www.zip` (das Zip der Woche wächst bei jedem
Durchgang); der Schnitt ist atomar und eine Zeile landet im Zip, BEVOR sie aus der
Live-Datei verschwindet. Geht der Platz aus (Archiv >500MB oder <1GB frei), löscht es
von selbst die ÄLTESTEN Zips und listet sie dir unter `pruned` auf.
- Frequenz: 1×/Woche genügt (sonntags); an Werktagen nur `status`,
  falls die Disk in Schritt 6 ungewöhnlich wächst.
- `pruned` NICHT leer → melde es AUSDRÜCKLICH im Logbook und warne den Capitano
  (es ist der einzige Datenverlust im Ablauf, von Leone nur unter
  Platzdruck autorisiert).
- BEWUSSTE Ausnahme von der goldenen Regel: dieser Ablauf ist von Leone
  vorab autorisiert (19/07) — du brauchst für `run` kein OK des Capitano; für jede
  andere Löschung außerhalb des Ablaufs gilt weiterhin die Single-writer-Regel.
- Logge im Eintrag: `log_archive: {archived_rows, weeks, pruned, free_gb}`.

### 7. 🔤 UTF-8-Locale der Panes (kosmetisch ≠ korrupte Daten)
```bash
python3 /app/shared/skills/locale_health.py summary        # oder --json
```
Zwei Messungen in einer, und die zweite ist die entscheidende. Er liest die Locale des **Containers** (`/proc/1/environ` — NICHT die Umgebung dieses Prozesses: CPython „coerct" `LC_CTYPE` von sich aus zu `C.UTF-8`, ein Check auf `os.environ` würde also einen kaputten Container gesund nennen) und **dekodiert dann STRIKT** ein `capture-pane` jeder lebenden Session. Der Exit-Code trägt das Urteil:
- **`0` ok** → `locale_health: ok` protokollieren und weiter.
- **`1` cosmetic** (Locale nicht UTF-8, NULL ungültige Bytes) → die Daten sind **UNVERSEHRT**: kaputt ist das Rendering für alle, die sich von außen anhängen (`_` statt jedes Akzentbuchstabens). **Melde es dem Capitano, behandle es nicht als Notfall** und „repariere" es vor allem nicht: der Fix ist `LANG=C.UTF-8` in der `docker-compose.yml` des Hosts und greift erst beim Neuerstellen des Containers — außerhalb der Reichweite eines Agenten, der DARIN läuft. Sofort-Mitigation für den Operator: `docker exec -it -e LC_ALL=C.UTF-8 jht tmux -u attach -r -t <Session>`.
- **`2` data_corruption** (ungültige Bytes in einem Pane) → **P1, ESKALIERE** an den Capitano mit den gelisteten Sessions: hier können die Agenten wirklich ein Wort für ein anderes lesen.

**Warum beide Checks und nicht nur der erste**: `echo $LANG` kann „kosmetisch" sagen, aber NIE „korrupt" — die strikte Dekodierung ist die einzige der beiden, die einen Anzeigefehler von beschädigten Daten trennt. Am 2026-08-10 hat genau sie einen Verdacht („die Agenten bekommen abgeschnittene Wörter") in eine Messung verwandelt (392 unversehrte Akzentzeichen, kein einziges ungültiges Byte) und einen Fix am falschen Problem gestoppt.

Protokolliere `locale_health: {verdict, env, panes_scanned, corrupted_sessions}` im Eintrag.

## Logbook (append-only)
Jeder Durchgang schreibt EINEN dichten Eintrag nach `/jht_home/logs/mantenitore-logbook.jsonl` (Zwilling des Logbooks des Dottore), damit der nächste Mantenitore den Trend sehen kann:
```json
{"ts":"ISO-UTC","slot":"maintainer-daily","processes_health":{"all_ok":true,"dead":[]},
 "processes_respawned":[...],"sync_health":{"healthy":true,"problems":[]},
 "tools_health":{...},"repaired":[...],
 "escalated":[...],"deps_consolidated":[...],"gc_proposed":[...],"dedup_proposed":[...],
 "locale_health":{"verdict":"ok|cosmetic|data_corruption","panes_scanned":N},
 "disk":{"used_pct":N,"delta_vs_last":N},"ram":{...},"duration_sec":N,"capitano_ack":"..."}
```
Mit `>>` anhängen, niemals überschreiben. Dichte Zusammenfassung (wie die Reisenotizen des Dottore/Capitano): was ich gefunden, was ich repariert, was ich vorgeschlagen habe.

## Anti-Patterns
- ❌ Löschen/Archivieren ohne OK des Capitano (single-writer: schlage vor). EINZIGE Ausnahme: der `log_archive.py`-Ablauf aus Schritt 6.5, von Leone vorab autorisiert.
- ❌ Bibliotheken automatisch auf neue Versionen upgraden (Bruchrisiko) — melden, nicht eigenmächtig aktualisieren.
- ❌ Ein BROKEN-Tool weder reparieren NOCH eskalieren (genau das ist der stille libatk-Bug).
- ❌ Eine DEAD-Bridge/-Daemon weder reparieren NOCH eskalieren (derselbe Fehler, auf den PROZESSEN: das ist der sentinel-bridge-Crash auf betaC am 2026-06-27).
- ❌ In die Gesundheit der AGENTEN abschweifen (Sitzungen/Tokens/Kontext) — das gehört dem Dottore.

## Siehe auch
- `shared/skills/process_health.py` — der in Schritt 0 verwendete Liveness-Kanarienvogel der lebenserhaltenden Prozesse (tägliches Sicherheitsnetz; der Zwilling-für-Prozesse von tool_health).
- `shared/skills/sync_health.py` — der in Schritt 0.5 verwendete Cloud-Sync-Kanarienvogel (pull churn / push 413 / stale Cursor); nur lesend, der Zwilling-für-SYNC von process_health/tool_health.
- `shared/skills/tool_health.py` — der in Schritt 1 wiederverwendete Smoke-Test (auch Build-time-Gate + Tick).
- `shared/skills/locale_health.py` — der Locale-Kanarienvogel aus Schritt 7 (Container-Locale + strikte UTF-8-Dekodierung der Panes); read-only, er unterscheidet einen kosmetischen Defekt von korrupten Daten.
- `shared/skills/log_archive.py` — der deterministische Archivierer aus Schritt 6.5 (schneidet Wochen >30T → Zip, prunt unter Platzdruck).
- `.launcher/agent-watchdog.sh` — die SCHNELLE Wiederherstellung (alle 30s, `maybe_respawn_bridges`), für die Schritt 0 das tägliche Sicherheitsnetz ist; Lehre vom 27/06: die Bridges starten `setsid` detached, daher deckt sie weder der Respawn von pid1 noch `agent-watchdog` ab (der tmux-Sitzungen neu startet, keine Python-Prozesse) — stürzen sie ab, bleiben sie unten, bis der Container neu startet.
- `agents/mantenitore/mantenitore.md` — Persona/Lebenszyklus des Mantenitore (dev3).
- `agents/_skills/resilience/SKILL.md` — die Anti-Stille-Leiter für die Agenten (dev3); ihr Schritt „classify" verwendet `tool_health.py` wieder.
- `agents/_skills/liveness-check/SKILL.md` — der Zwilling auf der Dottore-Seite (Agenten-Gesundheit), wegen der Struktur.
