<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: bridge-pacing
description: Olvasd el a 15 perces `[BRIDGE PACING]` kalibrációs tick-et — a bridge mérését a csapat tényleges sebességéről, ítélettel (SFORO / MARGINE / ALLINEATO), valamint ágensenkénti részesedéssel és kadenciával. A tick a SENTINELLÁNAK szól, nem neked: akkor nyisd meg ezt a skillt, amikor ő továbbítja neked ezeket a számokat, vagy amikor saját kezdeményezésből nézel meg egy tick-et. Ne várd, hogy a te paneledbe érkezzen — nem fog. Az ítélet ágensenkénti throttle-értékekké alakítása a `throttle-distribution` dolga.
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — a 15 perces kalibrációs tick olvasása

A bridge 15 percenként futtat egy mérési ablakot (:00/:15/:30/:45 UTC-re igazítva). Minden ablak zárásakor egy sort ír a csapat tényleges sebességéről — **a Sentinella paneljébe, nem a tiédbe** (push→pull, 2026-06-25). Szándékosan nem pingelnek negyedóránként: ő olvassa a tick-et, és csak akkor ébreszt fel, ha megér egy körödet. Ezt a formátumot tehát akkor használod, amikor **ő továbbítja neked a számokat**, vagy amikor saját kezdeményezésből nézel meg egy tick-et — soha nem olyasmiként, amire várni kell.

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

## Mit kezdj vele

Az ítélet megmondja, **kell-e** mozdulnod és nagyjából **mennyit**. Ezt `throttle.json`-beli értékekké alakítani — melyik ágens lassul, hány fokkal, és mikor az a helyes, ha semmit nem teszel — a **`throttle-distribution`** dolga. A cselekvéshez azt nyisd meg: nála van az aritmetika, a létra és a biztonsági szabályok.

Két dolog, amit vigyél magaddal:

- **A `share` a KI kérdésre válaszol.** A throttle csak annak arányában ad vissza keretet, amennyit egy ágens ténylegesen költ — egy csapatszintű „vágj 19%-ot" tehát soha nem azt jelenti, hogy „mindenki le 19%-kal".
- **A `cadenza` a MENNYIVEL kérdésre válaszol.** Ez az időtartam-képlet bemenete: ugyanaz a config-érték egészen máshogy vág egy óránként kétszer checkpointoló ágensen, mint egy tízszer checkpointolón.

## Anti-minták

- ❌ Csak a `VERDETTO`-t olvasni és figyelmen kívül hagyni a `share`-t / `cadenza`-t: vakon vágsz az összes ágensben és az olcsó szerepköröket (Scorer, Analyst) éred el az árak (Writer, Critic) előtt.
- ❌ Egyetlen SFORO tick-et állandó állapotként kezelni: 1 tick zaj, 2 egymást követő tick jel.
- ❌ Ezt a folyamatot keverni a `sentinel-orders` folyamatokkal: egy `[BRIDGE PACING]` és egy `[URG] RALLENTARE` perceken belül érkezhet egymás után. Az `[URG]` mindig nyer — alkalmazd először, a következő pacing újramér.
- ❌ Pacing-ból származó számokat tmux-on keresztül küldeni az ágenseknek (`[INFO] sleep 40s`). Mindig a `throttle-config.py`-n keresztül haladj — az ágensek a fájlt olvassák, nem a tmux üzenettörzset elemzik.

## Lásd még

- `throttle-distribution` — a végrehajtás: ki lassít, mennyivel, és mikor ne tégy semmit.
- `sentinel-orders` — szokásos tick-ek, throttle 0-4 szintek, vészhelyzetek.
- `bridge-mailbox` — hosszú kör során kihagyott pacing ítéletek kiürítése (a bridge JSONL-be ír, még ha az élő tmux küldés is sikertelen volt).
- `throttle` — a `throttle-config.py` CLI referencia és az ágensenkénti állapotfájl.
- `pipeline-triage` — amikor a MARGINE azt jelenti, hogy "hozz létre egyet a szűk keresztmetszetben" ahelyett, hogy csak a throttle-t nulláznád.
