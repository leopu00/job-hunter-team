<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: bridge-pacing
description: A `[BRIDGE PACING]` 15 perces kalibrációs tick lefordítása ágensenkénti throttle beállításokra. A bridge méri a csapat tényleges fogyasztási sebességét, és ítéletet ad (SFORO / MARGINE / ALLINEATO), valamint az ágensenkénti részesedést + ütemet, amelyek alapján eldöntheted, KIT lassíts le és MENNYIVEL. Csak akkor nyisd meg ezt a skill-t, amikor egy `[BRIDGE PACING]` sor érkezik; a szokásos `[SENTINELLA]` parancsok más folyamatot használnak (`sentinel-orders`).
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — adatvezérelt throttle kalibrálás

A bridge 15 percenként futtat egy mérési ablakot (:00/:15/:30/:45 UTC-re igazítva). Minden ablak zárásakor egy sort ír a Capitano paneljébe, amely összefoglalja a csapat tényleges sebességét és megmondja, melyik irányba torzítsd a throttle-t. Ez **nem** Sentinel parancs — ez egy kalibrációs jel, amelyre a `throttle-config.py`-val reagálsz.

## Üzenet formátuma

```
[BRIDGE PACING] HH:MM UTC window=15m (effettivi Xm) samples=N |
  usage=U% reset_in=Rh reset_at=THH:MM UTC (proj=P% — INFO, secondario non-driver) |
  vel_team=V%/h | vel_target=T%/h (per chiudere a TGT% al reset) [schedule+ratio phase=ON] |
  ratio=K kT/% (team Σ kT / Δusage) |
  agenti: name=p%/h [kT/Xm → kT/h ÷ K = p%/h, share s%, cadenza c/min (n chk in Xm)] ; ... |
  VERDETTO: SFORO|MARGINE|ALLINEATO ...
```

`TGT` a bridge által választott **dinamikus cél**:
- 24/7 konfiguráció vagy nincs ütemezés → `TGT=92` (sáv közepe, történelmi alapértelmezés)
- munkaidő konfiguráció + heti korlátú szolgáltató (Codex/Claude) → `TGT` az a %, ami reset-kor szükséges ahhoz, hogy a heti költségkeret pontosan a felhasználó aktív óráira oszoljon el. Példa: irodai idő 9-18 Codex Pro-n → `TGT≈76`.
- munkaidő konfiguráció + Kimi (nincs heti korlát) → `TGT=92` (sáv közepe tartalék).

A `[schedule+ratio phase=ON]` címke a zárójelben a cél **forrása** — `band_center` (nincs munkaidő), `schedule+ratio` (teljes munkaidő-figyelő), `schedule+band` (munkaidő + Kimi tartalék). Használd a váratlan célok hibakereséséhez.

## Mezők, amelyeket ténylegesen használsz

| Mező              | Mit mond neked                                                                                         |
|-------------------|---------------------------------------------------------------------------------------------------------|
| **`vel_team`**    | mért csapat sebesség, költségvetési %-pont per óra                                                      |
| **`vel_target`**  | sebesség, amellyel `TGT%`-on landolnál reset-kor (`TGT` körüli ±10 pontos sáv közepe)                  |
| **`share s%`**    | ágensenkénti súly az összesített sebességben (Σ share-ek ≈ 100%) — megmondja **KIT** lassíts le         |
| **`cadenza c/min`** | ágensenkénti `jht-throttle` hívások percenként az ablakban — megmondja **MENNYIT** adj a konfighoz    |
| **`VERDETTO`**    | cselekvésre kész összefoglaló; közvetlenül az alábbi táblázathoz rendeld                                |

> ⚠️ **A `proj` csak INFO — NE reagálj rá.** Rövid ablakú sebesség volatilis extrapolációja (pl. `proj=-8.66%`-ot írt ki, miközben a csapat csak hajszálnyival volt a cél alatt). A vezérlőkör a **`vel_team` vs `vel_target`** (mindkettő heti-figyelő) + `weekly_remaining`. Hagyd figyelmen kívül a `proj`-t throttle/spawn döntéseknél.

## Ítélet → cselekvés

| Ítélet                           | Jelentés                                                      | Cselekvés                                                                             |
|----------------------------------|---------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `SFORO +X%/h → riduci Y%`        | `vel_team` meghaladja a célt X ponttal/ó. Csökkentsd Y%-kal. | **Növeld** a `throttle-config`-ot a **magas részesedésű** ágensnél (top 1-2)          |
| `MARGINE −X%/h → puoi salire Y%` | `vel_team` a cél alatt. Van mozgástered.                      | **Nullázd vagy csökkentsd** a throttle-t a throttle-ozott ágensnél (prioritás: szűk keresztmetszet szerep) |
| `ALLINEATO Δ ±0.2%/h`            | tűrésen belül.                                                | ne csinálj semmit, várd a következő tick-et                                           |

> 💡 `X%/h` vs `Y%` ugyanaz két egységben. `Y = X / vel_team × 100`.

## Kalibrálási képlet (az egyetlen új dolog itt)

Ahhoz, hogy `f%` sebesség-csökkentést érj el egy `c` checkpoint/perc ütemű ágensnél, a `throttle-config`-ba írandó időtartam:

```
durata_sec = (f / 100) × 60 / c
```

Az intuíció: minden `jht-throttle` hívás `durata_sec` szünetet ad. 60 másodperc alatt az ágens `c`-szer hívja → `c · durata` másodperc szünetet ad percenként → törtsebesség-csökkentés `= c · durata / 60`. Megoldd `durata`-ra.

### Részletes példa — a csökkentés koncentrálása egy ágensre

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
```

Szinte a teljes csökkentést az `analista-1`-re terheld:
- frakció analista-1-re ≈ 19% / 47% ≈ 40%
- `durata_sec = 0.40 × 60 / 0.6 = 40s`
- → `throttle-config.py set analista-1 40`

### Részletes példa — a csökkentés elosztása két ágensre

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
scout-1:    share 26%, cadenza c_scout
```

Kombinált súly 47 + 26 = 73%. Oszd el a 19%-ot arányosan:
- frakció ágensenként ≈ 19% / 73% ≈ 26%
- analista-1: `0.26 × 60 / 0.6 = 26s`
- scout-1:    `0.26 × 60 / c_scout`
- → egy `bulk-set` írás atomikusan:

```bash
python3 /app/shared/skills/throttle-config.py bulk-set \
    analista-1=26 scout-1=<c_scout-ból számított>
```

## Throttle feloldásakor (MARGINE)

Ha az ítélet `MARGINE −X%/h → puoi salire Y%`:
1. Válaszd ki a szerepkört, amit gyorsítani akarsz (prioritás: az aktuális szűk keresztmetszet — `pipeline-triage`, ha bizonytalan vagy).
2. Csökkentsd az aktuális throttle-jét körülbelül `Y%`-kal (vagy nullázd, ha kicsi volt az érték).
3. **Ne** nullázd mindenkit egyszerre — a következő tick-re oszcillálnál egy SFORO-ba.

## Ütem konfigurációs változtatás után

- Bármilyen változtatás után várj **2-3 tick-et** (≈30-45 perc) a következő beavatkozás előtt.
- A pacing már a te szintézised — NE adj hozzá extra `rate_budget live` hívásokat közben (ezek felfújják a Sentinella `velocity_smooth`-ját).
- Ha 3 tick után az ítélet még mindig SFORO, duplázzd meg az időtartamokat ugyanazoknál az ágensnél (lineáris → geometrikus); ha még mindig MARGINE, felezd.

## Anti-minták

- ❌ Csak a `VERDETTO`-t olvasni és figyelmen kívül hagyni a `share`-t / `cadenza`-t: vakon vágsz az összes ágensben és az olcsó szerepköröket (Scorer, Analyst) éred el az árak (Writer, Critic) előtt.
- ❌ Egyetlen SFORO tick-et állandó állapotként kezelni: 1 tick zaj, 2 egymást követő tick jel.
- ❌ Ezt a folyamatot keverni a `sentinel-orders` folyamatokkal: egy `[BRIDGE PACING]` és egy `[URG] RALLENTARE` perceken belül érkezhet egymás után. Az `[URG]` mindig nyer — alkalmazd először, a következő pacing újramér.
- ❌ Pacing-ból származó számokat tmux-on keresztül küldeni az ágenseknek (`[INFO] sleep 40s`). Mindig a `throttle-config.py`-n keresztül haladj — az ágensek a fájlt olvassák, nem a tmux üzenettörzset elemzik.

## Lásd még

- `sentinel-orders` — szokásos tick-ek, throttle 0-4 szintek, vészhelyzetek.
- `bridge-mailbox` — hosszú kör során kihagyott pacing ítéletek kiürítése (a bridge JSONL-be ír, még ha az élő tmux küldés is sikertelen volt).
- `throttle` — a `throttle-config.py` CLI referencia és az ágensenkénti állapotfájl.
- `pipeline-triage` — amikor a MARGINE azt jelenti, hogy "hozz létre egyet a szűk keresztmetszetben" ahelyett, hogy csak a throttle-t nulláznád.
