---
name: scout-coverage
description: "Durchsuche die nationalen Kernportale der Profilsprachen VOR jeder kleinen Quelle und wisse, wie viel des Plans erledigt ist. `next` nennt das Portal, das zu loggende Land und die Art der Anfrage; ein Portal ist mit 3 Durchgängen und 3 verschiedenen Anfragen abgedeckt, und «erschöpft» verlangt abgedeckte Kernportale. Führe `next` zu Beginn jeder Suche aus."
allowed-tools: Bash(python3 /app/shared/skills/scout_coverage.py *) Bash(python3 /app/shared/skills/scout_pass_log.py *)
---

# scout-coverage — wo zuerst suchen, und wie viel erledigt ist

Suche ZUERST dort, wo die eigenen Märkte des Profils liegen, und wisse, wie viel davon erledigt ist. Ein echter Lauf hat 105 Quellen je einmal gefragt und die größten nationalen Portale der Sprache des Nutzers nie geöffnet: «erschöpft» wurde bei unberührtem Heimatmarkt erklärt. Diese Skill liefert die Liste (nationale Portale jeder Sprache, die das Profil spricht, erst die Kernportale, dann die English-first- und Remote-Portale) und den Zähler über dein eigenes Durchgangs-Log.

## 1. Frage, was als Nächstes kommt, bei jeder Suche

`next` gibt eine JSON-Zeile aus: das Portal (`source`, `country`, `tier`), die ART der Anfrage (`query_kind`: `broad` = eine BREITE Anfrage, immer die erste: die Rollenfamilie oder ein Einstiegswort allein (in `broad_terms`), ohne vollen Titel und ohne Ort, `role_language` = der Titel in der Sprache des Portals, `role` = der Titel auf Englisch, `synonym` = ein verwandter Titel, `level` = der Titel mit einem Level-Wort der Sprache, aufgelistet in `level_terms`, `city` = der Titel mit einem Ort, aufgelistet in `cities`), was du hast (`have`) gegen das Nötige (`need`) und die `log`-Zeile für danach. Suche genau das und logge den Durchgang mit demselben `--query-kind`. `plan_done: true` heißt: Plan erledigt, weiter mit den anderen Quellen.

```bash
# the next thing to search: portal, country to log, kind of query, and the line to log it with
python3 /app/shared/skills/scout_coverage.py next

# the whole plan for this profile (once), and how much of it is done (any time)
python3 /app/shared/skills/scout_coverage.py plan
python3 /app/shared/skills/scout_coverage.py status

# after the search: the same portal, country and kind that `next` named
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --query-kind role_language --query "<the query you ran>" --returned 12
# a portal that answers 403 / a login wall / a challenge (closed) or 410 (gone): ONE pass closes it
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --returned 0 --status closed
```

## Regeln

- Die ERSTE Frage an ein Portal ist immer `broad`: ein Wort aus `broad_terms` oder die Rollenfamilie, ALLEIN. Ein Portal, das die Wörter mit AND verknüpft, antwortet auf «junior project coordinator» + eine Stadt mit 0 und auf «praktik» mit Hunderten. Lies ALLE Ergebnisse, jede Seite, und filtere sie selbst gegen das Profil. Ein Portal ist nur mit einem `broad`-Durchgang abgedeckt, zusätzlich zu den 3 verschiedenen Anfragen und der in seiner Sprache.
- Platsbanken (Schweden) hat eine öffentliche API ohne Schlüssel: `python3 /app/shared/skills/platsbanken_search.py --q "praktik" --city stockholm --no-experience --query-kind broad --log`. Die Firmen-Boards eines Landes: `python3 /app/shared/skills/scout_coverage.py boards --country se`.
- Erst die Kernportale, dann die kleinen: keine kleine Quelle, solange `next` ein Kernportal nennt.
- Ein Portal ist ABGEDECKT mit 3 Durchgängen und 3 VERSCHIEDENEN Anfragen (eine in der Sprache des Portals, wenn es nicht Englisch ist). Dieselbe Anfrage dreimal zählt einmal: wechsle die Art, nicht die Wörter.
- Ein Portal, das mit 403, 410, einer Login-Wand oder einer Challenge antwortet, ist mit EINEM Durchgang `--status closed` (oder `gone` bei 410) GESCHLOSSEN: sag es und geh weiter, bohre nicht nach.
- `exhausted` (`scout_exhaustion.py check`) verlangt zusätzlich zu Quellen, Anfragen und Minuten abgedeckte Kernportale: `core_missing` sagt, wohin du noch musst.
- Vom Profil wird nie etwas geschrieben: das Log hat Slugs, Ländercodes, Arten und Zahlen.
