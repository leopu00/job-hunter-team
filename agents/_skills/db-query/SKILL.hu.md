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

## Csapat-aktivitás — ki termelt, és ki hallgatott el

```bash
# Az utolsó N perc minden pozíció-átmenete + ügynökönkénti számok
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
python3 /app/shared/skills/db_query.py recent-activity --minutes 30 --json
```

Kimenet: `per-agente: analista-1=9, scorer-1=7`, majd átmenetenként egy sor —
`14:22:07 scorer-1 #22 checked→scored`, `14:19:51 analista-1 #27 new→excluded — [DEAD_LINK]`
(idők UTC-ben). **Kiváltja** a workerek `[START]`/`[DONE]` üzeneteit, amelyeket 2026-07-27-én
eltávolítottunk: egy első indítású csapatnál ezek a bookendek adták a Capitanóhoz ~1,5 óra alatt
beérkezett 37 üzenetből 30-at, olyan állapotért, ami már a DB-ben volt.

⚠️ **Azt listázza, ki TERMEL.** Egy megállt ügynök egyáltalán nem jelenik meg — nem tűnik ki,
hanem **eltűnik**. Hogy megkülönböztesd az elakadást a jogos idle-tól, vesd össze a
`tmux list-sessions`-szel (él?) és a szerep `next-for-*` sorával (volt egyáltalán dolga?):
**él + nem üres sor + nulla átmenet = elakadás**; él + üres sor + nulla átmenet = idle, hagyd békén.

## Ágensenkénti sorok (pipeline)

```bash
python3 /app/shared/skills/db_query.py next-for-analista
python3 /app/shared/skills/db_query.py next-for-scorer
python3 /app/shared/skills/db_query.py next-for-scrittore
python3 /app/shared/skills/db_query.py next-for-critico   # ⚠️ örökség — V5-ben a Critic-et az Író hozza létre körenként, nem egy sorból húzza
```

Mindegyik a következő, az adott szerepkör számára kész köteget adja vissza, a V5 állapotfolyamot követve: `new → checked → scored → writing → ready → applied → response` (az `excluded` mint bármely lépésből elérhető kilépési lehetőség).

### A limit alapérték, nem plafon

Minden sor az **első 20 tételt** írja ki, és mindig kimondja, **hányan vannak összesen** —
`Posizioni new pronte per analisi (mostrate 20 di 1375)`. Nézd a második számot: az a
backlog, és nem tűnik el attól, hogy a sorokat levágtuk.

```bash
# Hányat látsz, azt te döntöd el
python3 /app/shared/skills/db_query.py next-for-categorize --limit 100
python3 /app/shared/skills/db_query.py next-for-categorize --all     # mindet (= --limit 0)
python3 /app/shared/skills/db_query.py next-for-categorize --json    # {"total": 1375, "shown": 20, "rows": [...]}
```

Miért van alapérték (2026-07-30-i mérés): limit nélkül a `next-for-geocode-missing`
2.000 pozíciónál **1.375 sort ≈ 19.500 tokent** írt ki, 20.000-nél pedig **~195.000**-et —
egyetlen parancs, több mint egy teljes kontextusablak. Az alapérték attól véd meg, amit
senki nem kért; **nem** dönt helyetted: válaszd a számot ahhoz, amit épp csinálsz — 20 a
következő tétel felvételéhez, `--all` egy auditnál, önmagában a végösszeg egy backlog
felméréséhez.

És nem vagy ezekre a parancsokra korlátozva: ez a skill `Bash(python3 *)`-ot ad, tehát saját
lekérdezést írni saját `LIMIT`-tel jogos, valahányszor a kész sor nem az a kérdés, ami
valójában érdekel.

```bash
python3 -c "
import os, sqlite3
db = sqlite3.connect(os.environ.get('JHT_DB', '/jht_home/jobs.db'))
for row in db.execute('SELECT id, title FROM positions WHERE role_family IS NULL LIMIT 50'):
    print(row)
"
```

## Mikor használd

- Skálázási döntések előtt (a Capitano-nak tudnia kell, van-e ≥ 3 `checked` rekord, mielőtt SCORER-t indít)
- INSERT-ek előtt (a Scout-nak URL duplikátumokat kell ellenőriznie)
- A felhasználó kérdéseire válaszolva, mint "hány scout aktív / hány függő alkalmazás / legmagasabb pontszám"
- Bármilyen frissítés előtt — lásd a `db-update` skill-t: mindig olvasd el a rekordot először, hogy ne írd felül mást írását

## Ne használd erre

- Írások: használd a **`db-update`** / **`db-insert`**-t helyette
- Séma változtatások: a `db_migrate.py` kezeli — nem skill-ként elérhető (felhasználói művelet)
