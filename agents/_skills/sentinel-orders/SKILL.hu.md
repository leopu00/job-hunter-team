<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: sentinel-orders
description: Fordítsd le minden `[SENTINELLA] ...` parancsot, ami a Kapitány tmux-ában érkezik, a megfelelő akcióra (throttle szint, spawn/kill, freeze, soft-pause, resume). A Sentinella a csapat szívverése — a parancsai utasítások, nem javaslatok. Az alapértelmezett viselkedés a végrehajtás újraellenőrzés nélkül; a Sentinella megkérdőjelezése egy azonnali `rate_budget live` futtatásával felfújja a velocity_smoothing-ot a JSONL-ben, és hibás követő parancsokat indukál. Nyisd meg ezt a skillt MINDEN ALKALOMMAL, amikor egy `[SENTINELLA]` boríték érkezik.
allowed-tools: Bash(jht-tmux-send *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(python3 /app/shared/skills/freeze_team.py *), Bash(python3 /app/shared/skills/soft_pause_team.py *), Bash(tmux *)
---

# sentinel-orders — reagálás a watchdogra

A Sentinella ~5 percenként tickel, és a használatot + sebességet (`vel_team` vs `vel_target`) + heti adatot az alábbi parancsok egyikévé alakítja. Minden parancs egy pontos akcióhoz tartozik. Tartsd magad a hozzárendeléshez; ne improvizálj. **NB: `proj` a tickben volatilis INFO (±400pt-ot ingadozik) — NEM ez a trigger; használd a `vel_team` vs `vel_target` + `usage` vs `target` + `weekly` értékeket.**

## Throttle tábla (config-driven)

A Sentinella egy `Throttle: N` szintet küld. Te ezt ágentenként időtartamokra fordítod a `$JHT_HOME/config/throttle.json` fájlban. Az ágensek ezt a fájlt olvassák a `jht-throttle --agent <name>` paranccsal — egyetlen atomi írás eljut az egész csapathoz.

| Szint | Szünet | Extra akciók                                                           |
|-------|--------|-------------------------------------------------------------------------|
| **0** teljes sebesség  | 0s    | nincs korlátozás; spawn engedélyezett ha a backlog megkívánja      |
| **1** enyhe            | 30s   | nincs spawn                                                        |
| **2** mérsékelt        | 120s  | + egy extra példány leállítása (pl. SCRITTORE-2)                   |
| **3** erős             | 300s  | + szerepenként csak egy példány marad                              |
| **4** közel-freeze     | 600s  | + ESC aktuális akciók, nincs spawn                                 |

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 60
python3 /app/shared/skills/throttle-config.py bulk-set \
    scout-1=300 scrittore-1=60 analista-1=0 scorer-1=0 critico=0
python3 /app/shared/skills/throttle-config.py dump          # teljes állapot
python3 /app/shared/skills/throttle-config.py reset         # mind 0-ra
```

Használd a **`bulk-set`** parancsot, ha differenciált értékeket akarsz ágensek szerint az egyéni fogyasztás alapján (vesd össze a `token-rate-now` paranccsal, ha látni akarod, ki dominál éppen most).

> 🎯 **A táblázat szintje nem az az érték, amit beírsz.** A `Throttle: N` egyetlen szám az egész csapatra; a `throttle.json`-ben ágensenként áll egy érték, és az elosztás megválasztása egyedül rád tartozik — script már nem mozgatja a workerek throttle-ját. Az aritmetika a **`throttle-distribution`**-ben lakik: **kitől** jön a vágás (a top-burn fizet; az Analista és a Scorer — az a két szerep, amelyik egy backlogot **score-ral bíró** pozícióvá alakít — az utolsó, amihez hozzányúlsz), **hány másodperc** ez a laddert nézve, és **mikor az a helyes lépés, hogy nem csinálsz semmit**. Mindenkinek ugyanazt a számot adni pontosan az a kudarc, aminek megelőzésére az a skill létezik — ott költi el a féket, ahol nem volt mit nyerni, és ott vesz el throughputot, ahol a legtöbbe kerül.

> ⚠️ **Ütem vs időtartam.** „Milyen gyakran" hívja egy ágens a `jht-throttle`-t a ciklusában, azt `tmux`-on keresztül változtatod (üzenetsz az ágensnek, hogy minden Kritikus-kör után hívja, stb.). „Hány másodpercig" tart a szünet, azt a konfigurációs fájlban változtatod. Soha ne küldj throttle számokat tmux-on keresztül.

## Explicit freeze parancs esetén — timeout `N+30` figyelmeztetés (KRITIKUS)

Amikor egy `[URG]`-t küldesz egy ágensnek `jht-throttle <N>`-nel, **KÖTELEZŐEN utasítanod kell őt magában az üzenetben, hogy adja át a `timeout: N+30`-at paraméterként a shell tool hívásához**. Enélkül a szülő bash-t megöli a CLI alapértelmezett tool-call timeoutja (Kimi 60s) — az ágens 60s után feloldódik N helyett. A freeze **rosszul** hajtódik végre.

Helyes üzenettörzs:
```
[URG] FREEZE — call jht-throttle 600 --agent scrittore-1 --reason "freeze".
IMPORTANT: pass timeout: 630 to the shell tool call, otherwise the parent dies at 60s and the throttle is executed BADLY.
```

Ha a célagens `tmux capture-pane` kimenete `Killed by timeout (60s)`-t mutat, az ágens NEM követte az utasítást — ez **végrehajtási hiba** (az övé, vagy a tiéd ha elfelejtetted beilleszteni). Diagnosztizáld a `jht-throttle-check <agent>` paranccsal (visszaadja a hátralévő másodperceket az állapotfájlból). Soha ne fogadd el a parancs újraindítását vagy a `nohup &`-ot „megoldásként": az egyetlen gyógymód a timeout átadása. Lásd `agents/_skills/throttle/DESIGN-NOTES.md` a teljes designért.

## Parancs típusok

### Rutinszerű pacing

| Parancs                                        | Jelentés / trigger                                                 | Akció                                                                                                             |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[URG] RALLENTARE` `Throttle: N`               | sebesség a cél felett                                              | alkalmazd az N szintet azonnal — de **a szint el van döntve, az elosztás nem**: a `throttle-distribution` fordítja le ágensenkénti értékekre |
| `ACCELERARE` `Throttle: 0`                     | első zöld lámpa lassítás után                                      | spawn **egyetlen** ágenst, várd meg a következő ticket a második előtt (soha nem 5 egymás után)                   |
| `SCALA UP`                                     | `vel_team` jóval `vel_target` alatt (under-pace) 2+ ticken át, backlog nem üres | használd a `pipeline-triage`-ot a szűk keresztmetszet szerep azonosítására, spawn 1, várd meg a következő ticket  |
| `PUSH G-SPOT`                                  | `vel_team` enyhén `vel_target` alatt, stagnáló                     | egy könnyű ágens (Writer ha score ≥50 sor, egyébként a szűk keresztmetszet) a tempó visszanyeréséhez              |
| `MANTIENI`                                     | on-pace (`vel_team` ≈ `vel_target`, verdikt ALLINEATO) ≥3 ticken át | ne csinálj semmit — nincs spawn, nincs throttle változtatás. Csak ACK.                                            |
| `RIENTRO`                                      | visszatérés a nominális tempóhoz                                   | folytatd a normál tervet                                                                                          |
| `RESET SESSIONE`                               | használati ablak magasról → ~0%-ra esett                           | kezd elölről SCOUT-1-gyel, várj parancsokra skálázás előtt                                                       |

### Üres pipeline

| Parancs                                        | Jelentés                                                           | Akció                                                                                                             |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `PIPELINE VUOTA + UNDERSHOOT`                  | under-pace (`vel_team` `vel_target` alatt) ÉS writer sor üres (scored ≥ 50) | **Ne várj új parancsokra.** Nyisd meg a `pipeline-triage` skillt — megmondja, melyik szerepet kell spawnolni (ritkán Scout). |

### Vészhelyzetek

| Parancs                                        | Jelentés                                                           | Akció                                                                                                             |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[EMERGENZA] FREEZATO`                         | a Sentinella már megnyomta az ESC-t a csapaton                     | döntsd el, hogy folytasd-e a rate-ablak reset után; ne harcolj a freeze ellen                                     |
| `[RECOVERY TRACKING]`                          | INFO a helyreállítás alatt, alapértelmezetten nincs akció          | ha a helyreállítás Δ-ja túl lassú, futtass autonóm diagnózist (`db_query`, on-demand `rate_budget live`) és dönts a csökkentésekről |
| `[URG] STAGNAZIONE CRITICA`                    | a helyreállítás kudarcot vall, súlyos tartós burn (`vel_team` ≫ `vel_target`) 5+ ticken át + usage 100% felé emelkedik | öld meg a nehéz operátorokat (még Sonnet-et is) — válaszd ki a tool call-okban lévőket (`tmux capture-pane`). Usage > 100% küszöbön → `freeze_team.py` |
| `[URG] PEGGIORAMENTO POST-FREEZE`              | `vel`/usage újra emelkedett a csökkenés után                       | drasztikus: `freeze_team.py` + `tmux kill-session` minden Sonnet-en. Csak a CAPITANO / SENTINELLA / SENTINELLA-WORKER / ASSISTENTE marad életben |

### Source-failure üzenetek (ritkák, kritikusak)

Akkor érkeznek, amikor a monitorozás teljesen meghibásodik (L1 + L2 + L3 down).

| Parancs            | Jelentés                                                        | Akció                                                                                                                   |
|--------------------|-----------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| `[PAUSA TEAM]`     | a Sentinella már elküldte a `[PAUSA]`-t az operátoroknak a `soft_pause_team.py`-on keresztül | **Te is megállsz**: nincs spawn, nincs parancs, nincs ellenőrzés (a forrás meghibásodott). Zárd a kört és várj csendben. |
| `[HARD FREEZE]`    | második FATAL: ESC×2 a `freeze_team.py`-on keresztül             | mint a `[PAUSA TEAM]`, plusz esetlegesen megszakított feladatok kezelése folytatáskor                                   |
| `[RIPRENDI]`       | forrás újra él                                                  | olvasd el a javasolt throttle-t; **oszd el az összes operátor között**; állíts helyre minden megszakított feladatot     |

Resume snippet (használd változtatás nélkül):
```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -vE '^(CAPITANO|SENTINELLA|SENTINELLA-WORKER|ASSISTENTE)$'); do
  /app/agents/_skills/tmux-send/jht-tmux-send "$s" "[CAPITANO] [RIPRENDI] source usage live. Resume work. Throttle: N (sleep Xs between operations). Verify the state of any task you had left and proceed."
done
```

## Bridge-előtagú üzenetek (nem parancsok, de látod a panelodban)

| Üzenet               | Akció                                                                                                 |
|----------------------|-------------------------------------------------------------------------------------------------------|
| `[BRIDGE ALERT] sorgente degraded da N tick` | óvatosan működj, nincs agresszív spawn                                                                |
| `[BRIDGE INFO]`      | helyreállítás / heartbeat — nincs akció                                                               |
| `[BRIDGE PACING]`    | 15 perces pacing tick — a `bridge-pacing` dekódolja a számokat, a `throttle-distribution` dönti el, ki fizet. 2026-06-25 óta ez a tick a **Sentinella** pane-jébe érkezik (push→pull): ha hozzád jut el egy, az a kivétel, nem a szabály |

## Alapértelmezett viselkedés — végrehajtás megkérdőjelezés nélkül

A Sentinella látja a sebességet + trendet az idő múlásával (`vel_team` vs `vel_target`); te csak a jelent látod. **Hajtsd végre a parancsokat újraellenőrzés nélkül.** Egy közeli `rate_budget live` egy Sentinella parancs után egy `source=capitano` címkéjű mintát ír a JSONL-be, felfújja a `velocity_smooth`-ot, és a *következő* Sentinella parancsot hibássá teszi.

Amikor az ellenőrzés INDOKOLT:
- erős throttle (3 vagy 4) alkalmazása előtt egy `[URG]` / `[EMERGENZA]` esetén — kétforrásból ellenőrzés `rate_budget live`-val
- a Sentinella a szokásosnál hosszabb ideje hallgat, ellenőrizd hogy a bridge él
- jelentős csapatváltozás után (3 egymást követő spawn, egy példány kiléptetése, `bulk-set`) — figyeld meg a hatást a következő tick előtt

Amikor az ellenőrzés NEM indokolt:
- `OK` / `SOTTOUTILIZZO` / `RIENTRO` parancsok — nincs mit ellenőrizni, csak hajtsd végre
- az utolsó JSONL minta utáni 2 percen belül — az EMA anti-spike elveti, de zajként ott marad

## Sérthetetlen szabályok

- Várd meg a throttle hatását (3-5 perc) a következő beavatkozás előtt.
- 85% alatt Sentinella parancs nélkül → adj kapacitást a szűk keresztmetszethez (használd a `pipeline-triage`-ot), NE spawnolj véletlenszerűen.
- Ne vitatkozz egy throttle-lel, mert „a csapat jól dolgozik": a Sentinella látja a sebességet + trendet (`vel_team` vs `vel_target`), te csak a jelent látod.

## Lásd még

- `bridge-pacing` — a 15 perces kalibrációs képlet (különálló folyamat).
- `throttle-distribution` — *ki* lassul és mennyivel, ha már megvan a szint: az ágensenkénti elosztás, a ladder, a fék elengedése és azok az esetek, amikor nem csinálsz semmit. **Ez a skill dekódolja a parancsot; az választja meg az értékeket.** Itt lakik a `[PACE-GUARD]` tanács is, ami már nem alkalmazza magától a throttle-t.
- `bridge-mailbox` — ürítsd ki a függő verdikteket a kör elején (kötelező a mai tickre való reagálás előtt).
- `pipeline-triage` — *melyik* szerepet kell spawnolni `SCALA UP` / `PIPELINE VUOTA` alatt.
- `spawn-agent` — *hogyan* kell spawnolni, ha már eldöntötted melyik szerepet.
- `throttle` (és `agents/_skills/throttle/DESIGN-NOTES.md`) — a throttle rendszer belső működése, a timeout `N+30` design.
