<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: salary-estimate
description: Hierarchische Gehaltsschätzung für den Scorer (Bug #27). 4 Ebenen — deklarierter Bereich (L1), lokaler Cache (L2), Web-Suche (L3), neutraler Standard (L4). Lokaler Cache nur für Scorer, keine Remote-Synchronisation. TTL 30 Tage, da sich Gehälter jährlich ändern, nicht wöchentlich. Diesen Skill verwenden, wann immer du `salary_fit` schreiben willst: ohne ihn hat 95% der Positionen `salary_fit=5/10` neutral (de facto inaktiv).
allowed-tools: Bash(python3 /app/shared/skills/salary_estimate.py *), Bash(python3 /app/shared/skills/db_update.py *)
---

# salary-estimate — hierarchische Schätzung mit lokalem Cache

## Warum er existiert

Snapshot 2026-05-17 (43 Kimi-Scores): 41 von 43 Scores mit
`salary_fit=5/10` (Standard "keine Daten, kein Bias"), 2 mit echten Werten aus
expliziter JD. Ergebnis: salary_fit (Gewicht 10/100) war *de facto*
inaktiv — Entscheidungsspielraum des Scorers von 100 auf 95 reduziert.

Ursache: niemand befüllte `salary_estimated_*`. Der Scorer ist ehrlich,
erfindet nicht, und ohne Daten fällt er auf den Standard zurück. Nutzer-Entscheidung:
einen lokalen Cache der Schätzungen aufbauen, damit der erste Abruf kostet, die
nachfolgenden kostenlos sind. *"Gehälter ändern sich nicht von Woche zu
Woche, sondern von Jahr zu Jahr"*.

## 4 Ebenen (in Reihenfolge, Stop bei der ersten, die einen Bereich liefert)

### EBENE 1 — Deklarierter Bereich (Position)
Wenn `positions.salary_declared_min` und `salary_declared_max` nicht NULL →
verwende diese, keine Schätzung. Der Scrittore kann aufrufen:

```bash
python3 /app/shared/skills/salary_estimate.py --position-id 42
```

Das Skript liest die Declared aus der DB und gibt `level=1` mit den Zahlen zurück.

### EBENE 2 — Lokaler Cache
Pfad: `/jht_home/.cache/salary_estimates.json`. Schlüssel:
`(stack, seniority, country, mode)`. TTL 30 Tage.

```bash
python3 /app/shared/skills/salary_estimate.py \
    --stack python --seniority junior --country IT --mode remote
```

Hit → JSON mit `level=2, source=cache, min, max`. Miss → fällt auf L3
oder L4.

### EBENE 3 — Web-Suche (Stub, abhängig von F-2)
Gibt derzeit None zurück: der Skill fällt direkt auf L4. Wenn
F-2 (Scout Web Access) verfügbar ist, wird der Scout/Analyst den
Cache via Web-Suche Glassdoor/Levels/Indeed befüllen. Ab dann macht der
erste Lookup einer neuen Kombination einen einzigen Abruf, dann 29 Tage
kostenlose Treffer.

### EBENE 4 — Neutraler Standard + Flag
Wenn alle obigen Ebenen fehlschlagen → gibt `level=4, min=null,
max=null, estimation_failed=true, reason="no_data_default"` zurück. Der Scorer
setzt `salary_fit=5` UND fügt `no_data_default` in `score.notes` hinzu —
damit der Mentor (nachgelagert) die 5 nicht als echte Daten weitergibt, sondern als
"k.A." (siehe Bug #27 Fix Mentor).

## Ausgabe-Schema

```json
{
  "level": 1 | 2 | 3 | 4,
  "min": int | null,
  "max": int | null,
  "currency": "EUR",
  "source": "declared" | "cache" | "web" | "default",
  "fetched_at": "YYYY-MM-DD",
  "estimation_failed": false | true,
  "reason": "<optional>"
}
```

## Was der Scorer mit dem Ergebnis macht

```bash
result=$(python3 /app/shared/skills/salary_estimate.py \
    --stack "$STACK" --seniority "$SENIORITY" \
    --country "$COUNTRY" --mode "$MODE" \
    --declared-min "$DECL_MIN" --declared-max "$DECL_MAX")

# 1. Felder extrahieren
min=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['min'] or '')")
max=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['max'] or '')")
failed=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('estimation_failed', False))")

# 2. Wenn echte Zahlen vorhanden, positions.salary_estimated_* befüllen
if [ -n "$min" ] && [ -n "$max" ]; then
  python3 /app/shared/skills/db_update.py position "$POS_ID" \
    --salary-estimated-min "$min" --salary-estimated-max "$max" \
    --salary-estimated-source "salary-estimate"
fi

# 3. salary_fit (0-10) mit der bestehenden Logik berechnen
#    (Vergleich mit Kandidatenziel aus candidate_profile.salary_annual_eur)
#    und die Notiz "no_data_default" einfügen wenn failed=True.
```

## Seed-Cache (nur Dev)

Zum Vorwärmen des Cache auf einem neuen Container (z.B. Test):

```bash
python3 /app/shared/skills/salary_estimate.py --seed-cache \
    --stack python --seniority junior --country IT --mode remote \
    --declared-min 28000 --declared-max 38000
```

In Produktion wärmt sich der Cache von selbst: L1 (declared aus JD) +
zukünftiges L3 (Web-Suche) befüllen ihn organisch im Laufe einer
Woche Betrieb.

## Anti-Patterns

- ❌ Web-Fetch bei jeder Position — der Cache existiert genau dafür.
  Gleiches `python junior IT remote` 10 mal ausgeführt =
  9 verschwendete Fetches.
- ❌ Aggressiver TTL (1 Tag) — Gehälter haben jährliche Granularität,
  tägliches Auffrischen ist Null-Info-Gewinn + Verschwendung.
- ❌ Deklarierte Werte im Cache speichern — das Deklarierte ist bereits in der DB der
  Position, muss nicht im Schätz-Cache dupliziert werden.
- ❌ Cache auf Supabase synchronisieren — es ist ein Cache **lokal für die Scorer**, er
  soll weder gesichert noch geteilt werden. Regeneriert sich von Null in wenigen Tagen.

## Siehe auch

- `agents/_skills/db-update/SKILL.md` § Positions — `salary-estimated-*`
- `docs/examples/candidate_profile.yml.example` — `salary_annual_eur` (Kandidatenziel,
  Side-Fix Bug #27)
- `agents/_skills/mentor-output/SKILL.md` — "5 passiv" verstecken wenn
  `notes` `no_data_default` enthält
