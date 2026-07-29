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

## Team-Aktivität — wer produziert hat und wer verstummt ist

```bash
# Jede Positions-Transition der letzten N Minuten + Zahlen pro Agent
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
python3 /app/shared/skills/db_query.py recent-activity --minutes 30 --json
```

Ausgabe: `per-agente: analista-1=9, scorer-1=7`, dann eine Zeile pro Transition —
`14:22:07 scorer-1 #22 checked→scored`, `14:19:51 analista-1 #27 new→excluded — [DEAD_LINK]`
(Zeiten in UTC). **Ersetzt** die `[START]`/`[DONE]`-Nachrichten der Worker, entfernt am 2026-07-27:
bei einem Team im Erststart waren diese Bookends 30 der 37 Nachrichten, die der Capitano in ~1,5h
erhielt — für einen Zustand, der schon in der DB stand.

⚠️ **Sie listet, wer PRODUZIERT.** Ein Agent, der stehen geblieben ist, erscheint gar nicht — er
fällt nicht auf, er **verschwindet**. Um einen Stall von einem legitimen Idle zu unterscheiden,
kreuze mit `tmux list-sessions` (lebt er?) und der `next-for-*`-Queue der Rolle (hatte er etwas zu
tun?): **lebendig + Queue nicht leer + null Transitionen = Stall**; lebendig + leere Queue + null
Transitionen = Idle, in Ruhe lassen.

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
