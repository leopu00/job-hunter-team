<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: db-query
description: Abfragen der JHT SQLite-DB (Positions, Applications, Statistiken). Verwende es, wann immer du Position-Status, Warteschlangen pro Agent, Scores, Match-Rate oder Datensatz-Zählungen benötigst. DB-Pfad aus $JHT_DB, Fallback /jht_home/jobs.db.
allowed-tools: Bash(python3 *)
---

# db-query — JHT-DB-Abfragen

Die Hauptdatenbank ist `$JHT_DB` (Standard `/jht_home/jobs.db`). Alle Abfrage-Wrapper befinden sich in `/app/shared/skills/db_query.py`. Dieser Skill stellt die häufigsten Aufrufe bereit.

## Statistiken und Dashboard

```bash
# Aggregierte Zählungen nach Status + Match-Rate (Benutzer-Übersicht)
python3 /app/shared/skills/db_query.py dashboard

# Numerische Statistiken (Gesamtzahlen pro Tabelle)
python3 /app/shared/skills/db_query.py stats
```

## Positions

```bash
# Nach Status auflisten
python3 /app/shared/skills/db_query.py positions --status new
python3 /app/shared/skills/db_query.py positions --status checked
python3 /app/shared/skills/db_query.py positions --status excluded

# Nach Mindest-Score filtern
python3 /app/shared/skills/db_query.py positions --min-score 70

# Einzelne Position im Detail (alle Felder)
python3 /app/shared/skills/db_query.py position 42

# Doppelte URL/ID? (nützlich für den SCOUT vor INSERT)
python3 /app/shared/skills/db_query.py check-url 4361788825
```

## Warteschlangen pro Agent (Pipeline)

```bash
python3 /app/shared/skills/db_query.py next-for-analista
python3 /app/shared/skills/db_query.py next-for-scorer
python3 /app/shared/skills/db_query.py next-for-scrittore
python3 /app/shared/skills/db_query.py next-for-critico   # ⚠️ Legacy — in V5 wird der Critic vom Writer pro Runde gespawnt, nicht aus einer Warteschlange gezogen
```

Jeder gibt den nächsten Batch zurück, der für diese Rolle bereit ist, entsprechend dem V5-Statusfluss: `new → checked → scored → writing → ready → applied → response` (mit `excluded` als Ausfahrt von jedem Schritt).

## Wann verwenden

- Vor Skalierungsentscheidungen (Captain muss wissen, ob es ≥ 3 `checked`-Datensätze gibt, bevor ein SCORER gespawnt wird)
- Vor INSERTs (Scout muss auf URL-Duplikate prüfen)
- Als Antwort auf Benutzer-Fragen wie "wie viele Scouts aktiv / wie viele ausstehende Bewerbungen / höchster Score"
- Vor jedem Update — siehe den `db-update`-Skill: immer den Datensatz zuerst lesen, um das Überschreiben eines anderen Agenten zu vermeiden

## Nicht verwenden für

- Schreiboperationen: **`db-update`** / **`db-insert`** stattdessen verwenden
- Schemaänderungen: werden von `db_migrate.py` behandelt — nicht als Skill exponiert (Benutzer-Operation)
