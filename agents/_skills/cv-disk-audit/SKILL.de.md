<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: cv-disk-audit
description: Periodischer Healthcheck (Dottore) zur Abstimmung von CVs auf der Festplatte und cv_pdf_path in der DB. Identifiziert Waisen (Datei auf Festplatte ohne DB-Zeile) und Geister (DB-Zeile mit cv_pdf_path, die auf nicht-existierende Datei zeigt). Benachrichtigt den Capitano über Diskrepanzen, damit der Nutzer keine unsichtbaren Top-PASS verliert und kein "CV zu schreiben" für bereits geschriebene CVs sieht.
allowed-tools: Bash(python3 *), Bash(find *), Bash(stat *), Bash(jht-tmux-send *)
---

# cv-disk-audit — Abstimmung Festplatte↔DB bei CVs

Bug #26 zeigte das Muster: der Scrittore generiert das PDF, wird
beendet (EMERGENZA Freeze 2026-05-17 04:43) vor dem DB-UPDATE. Die
Datei bleibt auf `/jht_user/cv/`, aber `applications.cv_pdf_path` bleibt NULL.
Sisal 7.5/10 (top PASS des Fensters) wurde *"CV zu schreiben"*
auf dem Nutzer-Dashboard — unsichtbar.

Der präventive Fix (atomares Schreiben im `cv-structure`-Skill) verhindert
neue Waisen. Dieses Audit repariert bereits existierende und fängt jede
neue Divergenz auf, die auftreten könnte (z.B. Nutzer verschiebt manuell ein
PDF, Watchdog beendet den Writer während des Umbenennens).

## Wann starten

Dottore-Trigger (Ende der Runde, außerhalb des kritischen Budgets):
- Immer in der ersten Runde nach einer EMERGENZA / Beendigung eines Scrittore.
- Ansonsten ~alle 4 Dottore-Runden (≈2h, bei 30 Min. Rundendauer).

Der Dottore führt diesen Skill NACH `liveness-check` und VOR
`cache-prune` aus — das Audit ist informativ, nicht destruktiv.

## Vorgehen

```bash
# 1. Festplatten-Snapshot
DISK_PDFS=$(find /jht_user/cv -maxdepth 1 -type f -name '*.pdf' 2>/dev/null | sort)

# 2. DB-Snapshot (cv_pdf_path != NULL)
DB_PDFS=$(python3 /app/shared/skills/db_query.py cv-pdf-paths 2>/dev/null | sort)

# 3. Diff
ORFANI=$(comm -23 <(echo "$DISK_PDFS") <(echo "$DB_PDFS"))     # Festplatte aber nicht DB
GHOST=$(comm -13 <(echo "$DISK_PDFS") <(echo "$DB_PDFS"))      # DB aber nicht Festplatte

# 4. Bericht an den Capitano (deterministisch, kein LLM)
if [ -n "$ORFANI$GHOST" ]; then
  msg="[@dottore -> @capitano] [REPORT] CV audit mismatch — "
  msg="${msg}orfani=$(echo "$ORFANI" | grep -c .) "
  msg="${msg}ghost=$(echo "$GHOST" | grep -c .)"
  jht-tmux-send CAPITANO "$msg"
  # Details loggen
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "{\"ts\":\"$ts\",\"orfani\":$(echo "$ORFANI" | jq -R . | jq -s .),\"ghost\":$(echo "$GHOST" | jq -R . | jq -s .)}" \
    >> /jht_home/logs/cv-disk-audit.jsonl
fi
```

`db_query.py cv-pdf-paths` (zu implementieren): schreibt 1 Pfad pro Zeile von
allen Applications mit `cv_pdf_path IS NOT NULL`. Eine Zeile
script-freundlich für `comm`.

## Was der Capitano mit dem Bericht macht

Empfängt `[REPORT] CV audit mismatch — orfani=2 ghost=0`. Öffnet
`/jht_home/logs/cv-disk-audit.jsonl`, liest die Waisen, und versucht für jede
den heuristischen Match:

1. `CV_<Candidato>_<position_id>_<...>.pdf` — neue Benennung Bug #25 →
   extrahiert `position_id`, führt `db_update.py application <pid> --cv-pdf-path <path>` aus.
2. `CV_<Candidato>_<Company>.pdf` — alte Benennung → sucht Application-
   Draft dieser Firma ohne cv_pdf_path. Wenn genau eine gefunden → 
   verknüpft. Wenn mehr als eine → meldet dem Nutzer (Sisal vs
   Leadtech vs Canonical: mehrdeutiger Fall vom 2026-05-17).

Der Capitano löscht KEINE Dateien (nie). Verschiebt nach `/jht_user/cv/_orphan/`
wenn er archivieren will, ohne zu verlieren.

## Anti-Patterns

- ❌ Einen Waisen automatisch mit `cv_pdf_path` verknüpfen, wenn es mehrere
  Application-Drafts für dieselbe Firma gibt — Mehrdeutigkeit, Nutzer
  entscheiden lassen.
- ❌ Einen Waisen löschen: CVs sind hoher kognitiver Aufwand, immer
  archivieren statt `rm`.
- ❌ Das Audit während einer EMERGENZA ausführen: der Dottore soll nur
  am Rundenende im Normalbetrieb laufen.

## Siehe auch

- `cv-structure` § PDF-Generierung (W-03 atomares Schreiben, Bug #26)
- `application-flow` Schritt 6 (Benennung mit position_id, Bug #25)
- `db-update` § Single-Writer-Gate (Bug #21)
- `liveness-check` (wird vorher in derselben Dottore-Runde ausgeführt)
