<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: db-update
description: Bestehende Datensätze in der JHT-DB aktualisieren (positions / applications). Verwende es, um Positions auf checked/excluded zu befördern, Critic-Score/Urteil zu schreiben, Applications als gesendet zu markieren, Gehalt, last-checked usw. zu aktualisieren. Immer nach einer `db-query`, die den aktuellen Datensatzstatus bestätigt.
allowed-tools: Bash(python3 *)
---

# db-update — Datensatz-Updates in der JHT-DB

Wrapper unter `/app/shared/skills/db_update.py`. Aktualisiert spezifische Felder bestehender Datensätze. **Erstellt keine** Datensätze — dafür siehe `db-insert`.

## Allgemeines Muster

```bash
python3 /app/shared/skills/db_update.py <table> <id> --<field> <value> [--<field> <value>...]
```

Tabellen: `position`, `application`.

## Positions

```bash
# Auf checked / excluded befördern (Aufgabe des Analysten)
python3 /app/shared/skills/db_update.py position 42 --status checked
python3 /app/shared/skills/db_update.py position 42 --status excluded

# last-checked-Marker (Link als lebendig bestätigt — auch als Anti-Kollisions-Beanspruchung verwendet)
python3 /app/shared/skills/db_update.py position 42 --last-checked now

# Liveness: --is-open / --last-open-check setzen auch last_checked von selbst
# vor, also verlässt eine erneut geprüfte Position die Pflege-Queue (die auf
# das jüngere der beiden Daten filtert). --last-checked nur zum Erzwingen.
python3 /app/shared/skills/db_update.py position 42 --is-open false --last-open-check now

# Gehalt wie in der JD angegeben
python3 /app/shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Geschätztes Gehalt (Glassdoor / Levels.fyi / Schätzung des Analysten)
python3 /app/shared/skills/db_update.py position 42 --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Rollenfamilie (semantische Kategorie).
python3 /app/shared/skills/db_update.py position 42 --role-family "Technical Writing"

# Strukturierter Standort (Analyst). Vollständiges Beispiel für "Dublin, Ireland" hybrid:
python3 /app/shared/skills/db_update.py position 42 \
  --loc-city "Dublin" --loc-region "Leinster" \
  --loc-country "Ireland" --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" --work-country-code "IE" \
  --is-multi-location false

# Beispiele für Sonderfälle:
# A) "Europe Remote" → country=NULL, continent=EU, work_country vom Firmen-HQ
python3 /app/shared/skills/db_update.py position 42 \
  --loc-continent "Europe" --work-mode "remote" \
  --work-country "United States" --work-country-code "US" \
  --location-notes "Remote within EU, US-based company"

# B) "Italy" + full_remote
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Italy" --loc-country-code "IT" --loc-continent "Europe" \
  --work-mode "remote" --work-country "Italy" --work-country-code "IT"

# E) Multi-Standort gleiches Land ("Barcelona / Malaga")
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Spain" --loc-country-code "ES" --loc-continent "Europe" \
  --work-mode "hybrid" --work-country "Spain" --work-country-code "ES" \
  --is-multi-location true --location-notes "Barcelona or Málaga (candidato sceglie)"

# Um ein Feld zu "bereinigen" (NULL setzen), leeren String übergeben:
python3 /app/shared/skills/db_update.py position 42 --loc-city ""
```

## Applications

```bash
# Critic-Urteil (pro Runde: NEEDS_WORK / PASS / REJECT) + Score 0-10 + Notizen
python3 /app/shared/skills/db_update.py application 42 --critic-verdict NEEDS_WORK --critic-score 5.0 --critic-notes "needs more detail on project X"

# CV/Anschreiben committiert (Writer markiert als geschrieben)
python3 /app/shared/skills/db_update.py application 42 --written-at now

# Auf ready befördern nach Critic PASS — nur Writer, in application-flow Schritt 7
python3 /app/shared/skills/db_update.py application 42 --status ready

# Nutzer hat bestätigt, dass die Bewerbung gesendet wurde
python3 /app/shared/skills/db_update.py application 42 --applied-at "2026-02-28" --applied-via linkedin
python3 /app/shared/skills/db_update.py application 42 --applied true

# Antwort erhalten (Interview / Absage / Ghosted)
python3 /app/shared/skills/db_update.py application 42 --response "rejected" --response-at now
```

### Positions-Statusübergänge werden automatisch protokolliert (Bug #14)

Jeder Aufruf von `db_update.py position <id> --status <s>`, der tatsächlich
`positions.status` ändert, fügt eine Zeile in `position_state_transitions`
ein mit `from_state`, `to_state`, `ts`, `by_agent` (aus `JHT_AGENT_NAME`)
und den `--notes`, die du übergeben hast (falls vorhanden). Gleiches gilt für das initiale
`db_insert.py position` (protokolliert als `NULL → 'new'`).

Du musst nichts tun — der Wrapper erledigt das. Umgehe ihn nicht
mit rohem SQL: ein `python3 -c "import sqlite3; UPDATE positions SET
status=..."` Workaround überspringt das Übergangsprotokoll und macht Durchsatz- /
Funnel-Diagramme unvollständig.

### Single-Writer-Gate bei `applications.status='ready'` (Bug #21)

`applications.status='ready'` wird **ausschließlich vom Scrittore** in
`application-flow` Schritt 7 gesetzt, **nur nach** Critic PASS in der 3. Runde.
Dies ist das Gate, das den CV auf dem `/ready`-Dashboard des Nutzers sichtbar macht. Andere Agenten:

- **Critic**: schreibt nur `critic_verdict` + `critic_score`. Niemals `status`.
- **Capitano**: schreibt nie `applications.status`. Darf lesen.
- **Mentor / Assistente**: nur Lesen bei `applications`.

Ohne dieses Gate kann der Capitano verbal "12 ready" melden, während die
DB noch 0 zeigt — genau die Divergenz, die Bug #21 behoben hat.

## Sicherheitsregeln

1. **Erst lesen.** `db-query position <id>` (oder `application`) ausführen, um den aktuellen Status zu sehen, bevor geschrieben wird. Blindes Überschreiben erzeugt inkonsistente Datensätze.
2. **Statusfluss ist nur vorwärts.** Legitime Übergänge: `new → checked → scored → writing → ready → applied → response`. `excluded` ist von jedem Schritt erreichbar, aber kein Schritt geht je rückwärts. Nicht umkehren.
3. **`now`-Zeitstempel.** Der Wrapper konvertiert den Literal-String `now` in den aktuellen Zeitstempel. Nicht `$(date)` übergeben — Parsing wird Python-seitig behandelt.
4. **Ausschluss-Tags in `--notes`.** Beim Markieren einer Position als `excluded`, die Notizen mit einem der kanonischen Tags voranstellen: `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` · `[STACK]`. Gleiche Taxonomie wie vom Analysten verwendet (siehe `agents/analista/analista.md` REGOLA-06).

## Nicht verwenden für

- Leseoperationen: **`db-query`** verwenden
- Datensätze erstellen: **`db-insert`** verwenden (nur der Scout fügt Positions ein)
- Schemaänderungen: niemals rohes `sqlite3` gegen die Tabellen ausführen — es umgeht Fremdschlüssel und das WAL-Journaling von Next.js
