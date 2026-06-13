<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: salary-estimate
description: Hierarchikus fizetésbecslés a Scorer számára (bug #27). 4 szint — megadott tartomány (L1), helyi cache (L2), web search (L3), semleges default (L4). A cache kizárólag a Scorer-ek helyi tárhelye, nincs távoli szinkronizálás. TTL 30 nap, mert a fizetések évről évre változnak, nem hetente. Használd a skillt minden alkalommal, amikor `salary_fit`-et írsz: nélküle a pozíciók 95%-a `salary_fit=5/10` semleges értéket kap (de facto inert).
allowed-tools: Bash(python3 /app/shared/skills/salary_estimate.py *), Bash(python3 /app/shared/skills/db_update.py *)
---

# salary-estimate — hierarchikus becslés helyi cache-sel

## Miért létezik

Snapshot 2026-05-17 (43 Kimi score): 43-ból 41 score
`salary_fit=5/10` (default "no data no bias"), 2 valós értékkel
explicit JD-ből. Eredmény: salary_fit (súly 10/100) *de facto*
inert volt — a Scorer döntési tere 100-ról 95-re csökkent.

Ok: senki nem töltötte ki a `salary_estimated_*` mezőket. A Scorer
becsületes, nem talál ki adatot, és adat nélkül visszaesik a defaultra.
A felhasználó döntése: helyi cache építése a becslésekhez, hogy az
első fetch költséges legyen, a következők pedig ingyenesek.
*"A fizetések nem hetente változnak, hanem évről évre"*.

## 4 szint (sorrendben, megáll az elsőnél, amely tartományt ad)

### 1. SZINT — Megadott tartomány (pozíció)
Ha `positions.salary_declared_min` és `salary_declared_max` nem NULL →
ezeket használja, nincs becslés. A Writer így hívhatja:

```bash
python3 /app/shared/skills/salary_estimate.py --position-id 42
```

A script beolvassa a declared értékeket a DB-ből és `level=1`-gyel
adja vissza a számokat.

### 2. SZINT — Helyi cache
Path: `/jht_home/.cache/salary_estimates.json`. Kulcs:
`(stack, seniority, country, mode)`. TTL 30 nap.

```bash
python3 /app/shared/skills/salary_estimate.py \
    --stack python --seniority junior --country IT --mode remote
```

Találat → JSON `level=2, source=cache, min, max` értékekkel. Hiány →
L3-ra vagy L4-re esik vissza.

### 3. SZINT — Web search (stub, F-2-től függ)
Jelenleg None-t ad vissza: a skill közvetlenül L4-re esik. Amikor
F-2 (Scout web access) elérhető lesz, a Scout/Elemző feltölti a
cache-t web search-ön keresztül (Glassdoor/Levels/Indeed). Attól
kezdve egy új kombináció első lookup-ja egyetlen fetch-et igényel,
majd 29 napig ingyenes találatok.

### 4. SZINT — Semleges default + flag
Ha az összes fenti szint sikertelen → visszaadja: `level=4, min=null,
max=null, estimation_failed=true, reason="no_data_default"`. A Scorer
`salary_fit=5`-öt ad ÉS hozzáfűzi a `no_data_default` értéket a
`score.notes`-hoz — így a Mentor (downstream) nem terjeszti az 5-öt
valós adatként, hanem "N/A"-ként (lásd bug #27 fix Mentor).

## Output schema

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

## Mit csinál a Scorer az eredménnyel

```bash
result=$(python3 /app/shared/skills/salary_estimate.py \
    --stack "$STACK" --seniority "$SENIORITY" \
    --country "$COUNTRY" --mode "$MODE" \
    --declared-min "$DECL_MIN" --declared-max "$DECL_MAX")

# 1. Mezők kinyerése
min=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['min'] or '')")
max=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['max'] or '')")
failed=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('estimation_failed', False))")

# 2. Ha valós számok vannak, kitölti a positions.salary_estimated_* mezőket
if [ -n "$min" ] && [ -n "$max" ]; then
  python3 /app/shared/skills/db_update.py position "$POS_ID" \
    --salary-estimated-min "$min" --salary-estimated-max "$max" \
    --salary-estimated-source "salary-estimate"
fi

# 3. Kiszámítja a salary_fit értéket (0-10) a meglévő logikával
#    (összehasonlítás a jelölt target értékével: candidate_profile.salary_annual_eur)
#    és hozzáadja a "no_data_default" megjegyzést, ha failed=True.
```

## Seed-cache dev-only

A cache előmelegítése új containeren (pl. teszt):

```bash
python3 /app/shared/skills/salary_estimate.py --seed-cache \
    --stack python --seniority junior --country IT --mode remote \
    --declared-min 28000 --declared-max 38000
```

Éles környezetben a cache magától melegszik fel: L1 (declared a JD-ből) +
jövőbeli L3 (web search) organikusan töltik fel egy hét működés
alatt.

## Anti-patternek

- ❌ Web fetch minden pozíciónál — a cache pont azért van, hogy ezt
  elkerülje. Ugyanaz a `python junior IT remote` 10-szer futtatva =
  9 felesleges fetch.
- ❌ Agresszív TTL (1 nap) — a fizetések éves granularitásúak,
  napi frissítés nulla információnyereség + pazarlás.
- ❌ Declared értékek mentése a cache-be — a declared már a pozíció
  DB-jében van, nem kell a becslés cache-ben duplikálni.
- ❌ Cache szinkronizálás Supabase-re — ez egy **Scorer-ek helyi**
  cache-je, nem kell sem menteni, sem megosztani. Néhány nap alatt
  nulláról újragenerálódik.

## Lásd még

- `agents/_skills/db-update/SKILL.md` § Positions — `salary-estimated-*`
- `candidate_profile.yml.example` — `salary_annual_eur` (jelölt target,
  side-fix bug #27)
- `agents/_skills/mentor-output/SKILL.md` — elrejti a "passzív 5"-öt, ha
  a `notes` tartalmazza a `no_data_default` értéket
