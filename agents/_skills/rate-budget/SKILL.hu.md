<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: rate-budget
description: Beolvassa az aktív provider rate-limit költségvetés-pillanatképét (használat %, reset-ig hátralevő idő, sebesség, projekció, ajánlott throttle) a bridge-ből. A Captain indításakor használd a tempó tervezéséhez és annak eldöntéséhez, hány ágenst spawnolj, majd időszakosan, ha friss pillanatképet szeretnél anélkül, hogy tokeneket költenél közvetlen provider-hívásra. Nulla provider-hívás — a bridge által már megírt utolsó tickot olvassa.
allowed-tools: Bash(python3 *)
---

# rate-budget — rate-limit költségvetés-pillanatkép

A monitorozó bridge (`.launcher/sentinel-bridge.py`) az aktív providert 1–10 percenként kérdezi le (dinamikusan — nyomás alatt gyakrabban) és minden mintát a `/jht_home/logs/sentinel-data.jsonl` fájlba ír. Ez a skill csak a már megírt **utolsó mintát** olvassa — nincs extra provider-hívás.

## A Captain indításakor

Bármely ágens spawnolása előtt futtasd:

```bash
python3 /app/shared/skills/rate_budget.py plan
```

Tipikus kimenet:
```
=== Rate Budget — claude ===
  Usage:            53%
  Reset:            tra 2h 34m (2026-04-24 15:49 CEST)
  Measured velocity:+0.39%/h (EMA)
  Target velocity:  11.38%/h (to close at 92% by reset)
  Reset projection: 56%
  Status:           OK
  Throttle:         T0 full speed
  Host:             cpu=4.7% ram=9.8% (OK)

  Recommended policy: Spawn freely in parallel — keep normal pace.
  Margin to 92% target: 39%
  Last tick:        2026-04-24T10:23:18.705062+00:00
```

**Captain-értelmezés** (használd a `Measured velocity` vs `Target velocity` összehasonlítást — NEM a `Reset projection`-t, ami volatilis INFO):
- `Throttle T0–T1` + `Measured velocity` jóval a `Target velocity` alatt (tempó alatt) → teljes spawn (Scout + Analyst + Scorer + Writer + Critic)
- `Throttle T1–T2` + `Measured` ≈ `Target` (tempóban) → csökkentett spawn (egy példány szerepenként)
- `Throttle T2+` vagy `Measured velocity` a `Target velocity` felett (égetés) → **nincs spawn**, várd meg, amíg a bridge feloldja a throttle-t
- `Reset projection` csak INFO (volatilis extrapoláció az ablak végén) — ne alapozd a spawn-t erre.

**Ha a kimenet `NO_DATA`:** a bridge még nem kérdezett le. Várj 1-2 percet és próbáld újra. Ne indítsd el a csapatot e jel nélkül — kockáztatod, hogy vakon telíted a rate-limitet.

## Egysoros verzió (scripteléshez)

```bash
python3 /app/shared/skills/rate_budget.py status
# → provider=claude usage=55% status=OK throttle=0 reset_in=2h 34m (at 2026-04-24 15:49 CEST)
```

Hasznos gyors logokhoz vagy ciklus közbeni ellenőrzésekhez.

## Mikor NE használd

- **Ne hívd minden lépésnél.** Használd a terved *fázisváltásainál* (bootstrap, Scout-batch vége, szünet után, stb.). A bridge a saját ütemében frissül; gyakoribb hívás nem ad frissebb adatot.
- **Nem helyettesíti az aszinkron `[BRIDGE ORDER]` folyamatot:** a bridge értesít *amikor* a szabályzat változik; te *a költségvetést nézve* tervezel. A két mechanizmus kiegészíti egymást.
