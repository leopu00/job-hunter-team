<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: db-query
description: A JHT SQLite DB lekérdezése (pozíciók, alkalmazások, statisztikák). Használd, amikor pozíció állapotot, ágensenkénti sorokat, pontszámokat, egyezési arányt vagy rekordszámokat kell látnod. DB útvonal a $JHT_DB-ből, tartalék /jht_home/jobs.db.
allowed-tools: Bash(python3 *)
---

# db-query — JHT DB lekérdezések

A fő adatbázis a `$JHT_DB` (alapértelmezés: `/jht_home/jobs.db`). Minden lekérdezés wrapper a `/app/shared/skills/db_query.py`-ban él. Ez a skill a leggyakoribb hívásokat mutatja be.

## Statisztikák és dashboard

```bash
# Összesített számok állapot szerint + egyezési arány (felhasználói áttekintés)
python3 /app/shared/skills/db_query.py dashboard

# Numerikus statisztikák (táblánkénti összesítések)
python3 /app/shared/skills/db_query.py stats
```

## Pozíciók

```bash
# Lista állapot szerint
python3 /app/shared/skills/db_query.py positions --status new
python3 /app/shared/skills/db_query.py positions --status checked
python3 /app/shared/skills/db_query.py positions --status excluded

# Szűrés minimális pontszám szerint
python3 /app/shared/skills/db_query.py positions --min-score 70

# Egyetlen pozíció részletei (minden mező)
python3 /app/shared/skills/db_query.py position 42

# Duplikált URL/ID? (hasznos a SCOUT-nak INSERT előtt)
python3 /app/shared/skills/db_query.py check-url 4361788825
```

## Ágensenkénti sorok (pipeline)

```bash
python3 /app/shared/skills/db_query.py next-for-analista
python3 /app/shared/skills/db_query.py next-for-scorer
python3 /app/shared/skills/db_query.py next-for-scrittore
python3 /app/shared/skills/db_query.py next-for-critico   # ⚠️ örökség — V5-ben a Critic-et az Író hozza létre körenként, nem egy sorból húzza
```

Mindegyik a következő, az adott szerepkör számára kész köteget adja vissza, a V5 állapotfolyamot követve: `new → checked → scored → writing → ready → applied → response` (az `excluded` mint bármely lépésből elérhető kilépési lehetőség).

## Mikor használd

- Skálázási döntések előtt (a Capitano-nak tudnia kell, van-e ≥ 3 `checked` rekord, mielőtt SCORER-t indít)
- INSERT-ek előtt (a Scout-nak URL duplikátumokat kell ellenőriznie)
- A felhasználó kérdéseire válaszolva, mint "hány scout aktív / hány függő alkalmazás / legmagasabb pontszám"
- Bármilyen frissítés előtt — lásd a `db-update` skill-t: mindig olvasd el a rekordot először, hogy ne írd felül mást írását

## Ne használd erre

- Írások: használd a **`db-update`** / **`db-insert`**-t helyette
- Séma változtatások: a `db_migrate.py` kezeli — nem skill-ként elérhető (felhasználói művelet)
