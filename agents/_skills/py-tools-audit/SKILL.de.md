<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: py-tools-audit
description: "Koordinierte, teamweite Bereinigung von Python-Paketen, die unter `$JHT_HOME/.local` via `uv pip install --user` installiert wurden (T13 magazzino). Verantwortlich ist der Dottore. Das Audit ist NICHT einseitig — nur die Writer-/Critic-Agenten wissen, ob eine dynamisch importierte Bibliothek noch benötigt wird, daher der Ablauf: Broadcast → 1h-Zustimmungsfenster → stilles Set deinstallieren → Re-Audit. Da der Dottore one-shot ist (~10 Min pro Runde, ~30 Min Abstand), erstreckt sich das 1h-Zustimmungsfenster über 2 Dottore-Runden: Runde N startet das Audit + Broadcast, Runde N+1 sammelt Antworten + deinstalliert."
allowed-tools: Bash(python3 /app/shared/skills/py_tools_audit.py *), Bash(uv pip uninstall *), Bash(jht-tmux-send *), Bash(tmux *), Bash(du *), Bash(xargs *)
---

# py-tools-audit — das gemeinsame Python-Magazzino bereinigen

`$JHT_HOME/.local/lib/python3.x/site-packages/` ist die **einzige gemeinsame User-Base**, aus der alle Agenten lesen (T13). Jeder Agent kann `uv pip install --user <pkg>` ausführen, wenn er eine Bibliothek braucht, aber Agenten deinstallieren *nicht*, wenn sie ihren Ansatz wechseln — Pakete häufen sich an. Ungefähr wöchentlich überschreitet das Magazzino 800 MB und braucht ein koordiniertes Audit.

Das Audit ist koordiniert, weil ein statisches `import`-Grep Bibliotheken übersehen kann, die zur Laufzeit dynamisch geladen werden (z.B. ein Skript in `tools/`, das der Writer nur aufruft, wenn eine JD ein bestimmtes Format verlangt). Daher: vor dem Entfernen nachfragen.

## Auslöser

- ⏰ ~wöchentlich (alle 7 Tage Dauerbetrieb), zu Beginn eines ruhigen Betriebstages
- 📈 bei Bedarf, wenn `du -sh /jht_home/.local` > 800 MB
- 🚀 vor einem wichtigen Release / Übergabe an den Benutzer

## Zwei-Runden-Ablauf (weil der Dottore one-shot ist)

```
Round N:    audit → Broadcast der Kandidaten → Zustandsdatei speichern
…30 min…
Round N+1:  Antworten sammeln → keep_set berechnen → deinstallieren → Re-Audit → Bericht
```

Jede Runde protokolliert ihre Phase in `$JHT_HOME/logs/py-audit-state.json`:

```json
{"phase": "broadcast_sent", "round_id": "...", "ts": "ISO-UTC",
 "candidates": ["pymupdf", "pdfminer.six", "reportlab", "..."],
 "broadcast_at": "ISO-UTC"}
```

Wenn du aufwachst, **prüfe diese Datei zuerst**:
- Datei fehlt oder `phase=done` → neue Runde, gehe zu „Round N" unten
- `phase=broadcast_sent` und `now - broadcast_at >= 1h` → „Round N+1" unten
- `phase=broadcast_sent` und `now - broadcast_at < 1h` → Zustimmungsfenster noch nicht geschlossen, überspringe das Audit in dieser Runde

## Round N — das Audit starten

### 1. Schwellenwertprüfung

```bash
python3 /app/shared/skills/py_tools_audit.py --threshold-mb 800
```

- Exit `0` → nichts Dringendes. Hier stoppen, keinen Broadcast senden.
- Exit `2` → Bereinigung lohnt sich. Das Skript gibt auch die *Kandidatentabelle* aus — Pakete ohne aktiven Import, abzüglich der Whitelist (transitive Abhängigkeiten + gepinnte binäre CLIs).

### 2. Broadcast an jeden Agenten

Sende eine `[PY-AUDIT]`-Nachricht an jede aktive Agentensitzung via `jht-tmux-send`:

```
[@dottore -> @<role>] [PY-AUDIT] candidates uninstall: pymupdf,
pdfminer_six, reportlab, weasyprint, pypdf, ...
If you USE one of these, reply within 1h with [KEEP <pkg>].
Silence = consent to uninstall.
```

Das 1h-Fenster wird durch den **Start der nächsten Runde** erzwungen, nicht durch ein `sleep` in dieser Runde (der Dottore ist one-shot). Persistiere die Broadcast-Zeit in `py-audit-state.json`.

### 3. Zustand persistieren und Runde beenden

```json
{"phase": "broadcast_sent", "round_id": "...",
 "candidates": ["..."], "broadcast_at": "ISO-UTC"}
```

Ende von Round N. Selbstzerstörung wie üblich; der nächste Dottore (~30 Min später) wird hier anknüpfen.

## Round N+1 — sammeln, deinstallieren, berichten

Wird ausgelöst, wenn `py-audit-state.json` `phase=broadcast_sent` zeigt und ≥1h vergangen ist.

### 1. Antworten einsammeln

Für jeden Agenten, an den gesendet wurde, führe `tmux capture-pane -t <SESSION> -p -S -200 | grep '\[KEEP '` aus, um `[KEEP <pkg>]`-Antworten zu finden. Baue das `keep_set`:

```
keep_set = (Standard-Whitelist) ∪ (jedes <pkg> in jeder [KEEP]-Antwort)
```

Schweigen zu einem Kandidaten = Zustimmung zur Deinstallation.

### 2. Das stille Set deinstallieren

```bash
python3 /app/shared/skills/py_tools_audit.py --candidates-only --keep <keep_set...> \
  | xargs -r uv pip uninstall --user -y
```

`xargs -r` überspringt den Aufruf, wenn nichts zu deinstallieren ist (leere stdin).

### 3. Re-Audit + Bericht

```bash
python3 /app/shared/skills/py_tools_audit.py
du -sh /jht_home/.local
```

Berechne `freed_mb = before - after` und benachrichtige den Benutzer über den Capitano:

```bash
jht-tmux-send CAPITANO "[@dottore -> @capitano] [REPORT] py-audit done: <N> packages removed, <freed_mb> MB freed. Magazzino now <after_mb> MB."
```

### 4. Zustand zurücksetzen

```json
{"phase": "done", "round_id": "...", "completed_at": "ISO-UTC",
 "removed": ["..."], "freed_mb": 142}
```

Eine saubere `py-audit-state.json` mit `phase=done` ermöglicht der nächsten Runde, von vorne zu beginnen.

## Strenge Regeln

- **Niemals ohne Broadcast + 1h-Fenster deinstallieren.** Manche Pakete werden dynamisch geladen und tauchen in einem statischen Grep nicht auf — der Broadcast ist der einzige Weg, sie zu erfassen.
- **Niemals `ALWAYS_KEEP` anfassen.** Transitive Einträge (numpy, pillow, packaging usw.) sind aus gutem Grund dort; das Audit-Skript schließt sie bereits aus.
- **Wenn ein Writer nach einer Deinstallation protestiert**, sofort reinstallieren und das Paket zu `ALWAYS_KEEP` hinzufügen. Behandle dies als Prozessfehler (Broadcast hat den Agenten verfehlt), nicht als Schuld des Writers.
- **Niemals sudo-uninstall.** Bleibe bei `uv pip uninstall --user`. T13 verbietet `sudo pip` aus demselben Grund wie `sudo pip install`.

## Anti-Patterns

- ❌ Beide Runden in einem einzigen Dottore-Aufwachen mit `sleep 3600` ausführen — überschreitet das 10-Min-Budget pro Runde und bricht die Watchdog-Kadenz.
- ❌ Das keep set aus dem eigenen `import`-Grep ableiten, ohne zu broadcasten — stille Fehler bei dynamischen Ladevorgängen.
- ❌ Mehr als 100 Pakete in einer Runde deinstallieren — zu viel Rauschen, schwer rückgängig zu machen. Beschränke dich auf den natürlichen Batch des Audits (was das Schwellenwert-Skript zurückgibt).
- ❌ Diese Skill als Reaktion auf einen `[ORDINE]` des Sentinel ausführen — Befehle verlangen Pacing/Scaling, keine Wartung. py-audit wartet auf ein Leerlauf-Fenster.

## Siehe auch

- `cache-prune` — Schwester-Wartungsskill (uv wheel cache, ~24h Kadenz). Führe diesen zuerst aus; er reduziert manchmal die Magazzino-Größe unter 800 MB und macht das Audit überflüssig.
- `agents/_team/team-rules.md` T13 — Installationsregel (`uv pip install --user`), die dieses Audit begründet.
- `agents/dottore/dottore.md` — Dottore-Lebenszyklus; diese Skill erstreckt sich über 2 Lebenszyklusrunden mittels der Zustandsdatei.
