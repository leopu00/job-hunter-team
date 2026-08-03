<!-- @translation: hu, ai-translated 2026-08-03 -->
---
name: scaling-calc
description: "A roster fokozatos kalibrálása — mérd meg 1 worker burnjét, számold ki, hány worker és milyen throttle kell a cél-sebesség eléréséhez, és spawnolj lépcsőzetesen (soha nem hatodikban)."
---

# 🎚️ scaling-calc — egyszerre egy fokozatot kapcsolj, ne indulj rögtön hatodikban

Amikor a csapat kinyitja a munkaablakot (vagy többet kell fogyasztanod), **NE** indulj
hatodikban ("bőven van budget → spawnolj 5 scoutot / throttle nullára"): még nem tudod,
mennyit fogyaszt valójában egy worker EBBEN a ciklusban. Lépcsőnként kalibrálsz.

## Eljárás

**1. Indulj EGYETLEN workerrel** a flooron (5min, a workerek minimuma).

**2. Figyeld ~30 percig**, hogy megmérd a valós burnt. Olvasd ki a worker burnjét:
```
python3 /app/shared/skills/rate_budget.py            # fenntartható cél-sebesség (S)
# burn ágensenként: abból a táblázatból, amelyet a Sentinella továbbít neked, vagy:
python3 /app/shared/skills/agent-speed-table.py
```
Vedd: **S** = fenntartható sebesség (pl. `sustainable_burn` %weekly/h) és **b** = a worker
mért burnje (ugyanabban az egységben).

**3. Számold ki** a rostert + throttle-t:
```
python3 /app/agents/_skills/scaling-calc/scaling_calc.py --target <S> --measured <b>
# ha N workert figyeltél T throttle mellett:
python3 .../scaling_calc.py --target <S> --measured <b_total> --workers <N> --throttle <T>
```
Megadja: **hány worker**, **milyen throttle**, és egy **lépcsőzetes tervet**.

**4. Spawnolj LÉPCSŐZETESEN** a terv szerint: **egyesével**, a következő előtt **újramérve**
(~10 perc elég, hogy lásd az újonnan érkező burnjét). SOHA ne spawnold az egész blokkot egyben.

> Az a 10 perc **megfigyelési ablak**, nem fáziseltolás: két azonos lépcsőn lévő worker közötti
> fázistávolság `T/N` (a periódus osztva az azon osztozó workerek számával), és a launcher magától
> alkalmazza spawnoláskor. Ez nem itt eldöntendő szám, és nem is állandó: egy 5 perces lépcsőn
> három worker 100s távolságra akar lenni egymástól.

## A két kar
- **Worker a cél alatt** (1 worker kevesebbet éget a célnál) → a kar a **workerek száma**
  (párhuzamosság), mind **a flooron**. Lépcsőzetesen add hozzá őket.
- **Worker a cél felett** (1 worker már többet éget a célnál) → a kar a **throttle**: tarts
  1 workert, és **emeld** a throttle-ját (az eszköz megadja a pontos értéket). SOHA ne nullázd
  le a throttle-t (a workereknek amúgy is 5min floorjuk van).

## Mit NE csinálj
- ❌ "Csapat ON, bőven van budget → GYORSÍTSUNK MINDENT" — ez az a hajsza, amely 25 perc alatt
  eléget egy budget-ablakot nulla outputért. **GYORSÍTÁS = EGY lépcsővel feljebb** (eggyel több
  worker, vagy eggyel kevesebb throttle-fokozat **egészen a floorig**), majd újramérés.
- ❌ 2-3 worker együttes spawnolása. Mindig **eltolva**.
- ❌ Throttle 0 egy workeren (lehetetlen: 5min floor; és amúgy is ebből készülnek a maratonok).

## Példa
1 scout a flooron (5min) **1.4%/h**-t égetett, a fenntartható cél **0.7%/h**:
```
scaling_calc.py --target 0.7 --measured 1.4
→ 1 worker @ 600s (10min) → burn ≈ 0.7/h   (elég megemelni a throttle-t, nincs spawn)
```
Ha viszont 1 scout csak **0.3%/h**-t éget 0.7-es cél mellett:
```
→ 2 worker @ 300s (floor), lépcsőzetesen: spawnold a #1-et, figyeld 10min-ig, mérj újra, aztán a #2-t.
```
