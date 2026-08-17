<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: pipeline-triage
description: "Döntsd el, MELYIK szerepet indítsd / szüneteltesd / állítsd le a backlog állapota alapján, ne megérzés alapján. Nyisd meg ezt a skillt MINDEN alkalommal, amikor megfigyeled — csapat sebesség < 50% cél, VAGY bármely szerep sora = 0, VAGY Scout források kimerültek, VAGY [SCALA UP] a Sentinellától, VAGY `PIPELINE VUOTA + UNDERSHOOT`, VAGY `MARGINE` a bridge-pacingtől, VAGY hidegindítás, VAGY valahányszor kísértésbe esel, hogy \"csak indíts még egy Scoutot\". NE várd meg a Sentinella kifejezett [SCALA UP] parancsát, ha a feltételek már láthatók a metrikákban. A lényeg: olvass le 4 számot, válaszd ki azt az egy szerepet, amely feloldja a szűk keresztmetszetet, és add át a `spawn-agent`-nek."
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(tmux *)
---

# pipeline-triage — adatvezérelt skálázás

A pipeline dinamikus rendszer. Minden szerep feladatonként nagyon eltérően fogyaszt — egy 2. Writer hozzáadása sokkal többe kerül, mint egy 2. Scout. Ha a fejnél skálázol, miközben a szűk keresztmetszet a végénél van, az *több* backlogot eredményez, nem több kimenetet. Mindig az adatokból indulj ki.

## Mikor nyisd meg ezt a skillt (bug #17)

**Megfigyelt feltételek** alapján nyitod meg, nem csak kifejezett Sentinella
parancsra. Triggerek:

- Csapat sebesség a cél 50%-a alatt
- Bármely szerep sora 0-n (Scout kimerült, Scorer/Writer tétlen)
- Scout források kimerülésként jelentve ("bebee, indeed, glassdoor — nincs új")
- `[SCALA UP]` a Sentinellától
- `MARGINE` / `PIPELINE VUOTA + UNDERSHOOT` a bridge-pacingtől
- Ablak hidegindítása

A történelmi anti-pattern: a Capitano látja, hogy `SCRITTORE_QUEUE=0` +
`PROMOTABLE_40_49=6`, **leírja** a helyzetet tökéletesen a
felhasználónak, **nem** futtatja az előléptetést. Ez a skill *aktív*, nem
*tanácsadó* — ha a feltételek teljesülnek, végrehajtasz.

## 1. lépés — olvasd le a backlogot (mindig, bármilyen spawn előtt)

```bash
python3 /app/shared/skills/db_query.py stats
```

A `positions` (P), `scores` (S), `applications` (A) alapján számold ki:

| Metrika              | Képlet                                                        | Mit jelent                                          |
|---------------------|---------------------------------------------------------------|-----------------------------------------------------|
| **UNSCORED**        | P − S                                                         | pozíciók, amelyeket a Scorernek még értékelnie kell |
| **DRAFT_BLOCKED**   | applications `status = draft` állapottal                      | Writer ↔ Critic hurok megakadt                      |
| **SCRITTORE_QUEUE** | pozíciók `score ≥ 50` értékkel ÉS nincs application          | Writer sor (valós igény új CV-kre)                  |
| **PROMOTABLE_40_49**| pozíciók `score 40-49` értékkel ÉS nincs application          | parkolósáv — igény szerint előléptethető             |

Szintén hasznos: `python3 /app/shared/skills/db_query.py dashboard` az azonnali áttekintéshez + szerep szerinti aktív példányok.

## 1. bis lépés — ki termel, és ki hallgatott el (2026-07-27)

A workerek már nem küldenek `[START]` / `[DONE]`-t (ezek a bookendek adták a Capitanóhoz egy első
indítású csapatnál ~1,5 óra alatt beérkezett 37 üzenetből 30-at). A haladásukat innen húzod le:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 30
```

⚠️ **Azt listázza, ki TERMEL, tehát egy elakadt ügynök eltűnik belőle ahelyett, hogy kitűnne.** Egy
backlog, ami nem ürül, nem automatikusan hiányzó workert jelent: lehet élő, de beragadt worker is, és
egy másodikat mellé indítani úgy hagyja az elsőt égni. Döntés előtt vesd össze a három forrást:

| Él (`tmux list-sessions`) | Sor (`next-for-*`) | Átmenetek (`recent-activity`) | Verdikt |
|---|---|---|---|
| igen | nem üres | 0 | **ELAKADÁS** — erősítsd meg `capture-pane`-nel, aztán `agent-emergency` (Dottore-first → kill). **Ne** indíts mellé másodikat |
| igen | nem üres | > 0 | dolgozik — kapacitásprobléma, tovább a 2. lépésre |
| igen | üres | 0 | jogos idle — hagyd békén (egy `[SCOUT-ESAUSTO]` után a nyugalom szándékos) |
| nem | nem üres | 0 | tényleg hiányzik — indítsd el (2. lépés) |

## 2. lépés — válaszd ki a prioritást (szűk keresztmetszet először, soha nem új munka)

Alkalmazd a táblázatot fentről lefelé. Állj meg az első egyező feltételnél.

| Feltétel                                                   | Művelet (ebben a sorrendben)                                                                                                         |
|-----------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `DRAFT_BLOCKED ≥ 50`                                      | **Eloszor**: vizsgald meg a tulajdonos Writereket/critic-loopot. Soha ne indits arva Criticet; minden `SCRITTORE-N` csak a sajat `CRITICO-SN` munkamenetet inditja a kanonikus launcheren at. Writert csak letezo, felhasznalo altal kert sorhoz indits. |
| `UNSCORED ≥ 20`                                           | **Azután**: indíts `SCORER-2`-t (és `SCORER-3`-at, ha `UNSCORED ≥ 50`). Egy Scorer nem elegendő 20+ sorban állónál.                  |
| `SCRITTORE_QUEUE ≥ 5`                                     | indíts 1 `SCRITTORE-N`-t, ha még nincs 3 élő (max).                                                                                  |
| `PROMOTABLE_40_49 ≥ 5`                                    | léptesd elő a legjobb 5-öt a pontszám emelésével (`db_query.py` + közvetlen `UPDATE`), majd kezeld `SCRITTORE_QUEUE`-ként.            |
| `SCRITTORE_QUEUE < 5 AND PROMOTABLE_40_49 < 5`            | **Csak most** indíts 1 `SCOUT-N`-t új pozíciókhoz.                                                                                   |

Miután kiválasztottad a szerepet, add át a `spawn-agent`-nek a tényleges indítás + beindítás érdekében.

## 3. lépés — kerülendő anti-patternek

- ❌ Scout indítása első műveletként, amikor `UNSCORED > 20` — több backlogot termel extra kimenet nélkül.
- ❌ Throttle globális visszaállítása (`throttle-config.py reset`) skálázáskor — a throttle-t csak az indított szerepre alkalmazd.
- ❌ Több szerep indítása ugyanabban a tickben "a biztonság kedvéért" — várd meg a következő Sentinel tickot (~5 perc), és olvasd le újra a számokat.
- ❌ Tétlen ágensek leállítása "rendet rakni" — a tétlenség szinte semmibe nem kerül. Csak akkor állítsd le, ha a felhasználó kifejezetten kéri, vagy ha egy ágens zavaros hurokban égeti a tokeneket.

## Empirikus indoklás (miért ez a sorrend, és nem más)

A W3-W6 ablakokban megfigyelt (medián csúcs proj 57-61%): a Scoutok konzisztensen ~3 pozíció/óra sebességgel termelnek, de a Scorer/Critic NEM üríti a backlogot → 88 pontozatlan és 217 draft halmozódott fel = 12+ rate-budget pont kihasználatlan. **A gyógymód downstream, nem upstream.** Valahányszor alulpörögsz (`vel_team` a `vel_target` alatt) nem üres backlog mellett, az ok szinte mindig Scorer vagy Critic, soha nem Scout. *(Ignora `proj`: è INFO volatile, non un trigger.)*

## Szerepenkénti fogyasztás — válassz költségtudatosan

| Szerep        | Feladatonkénti fogyasztás | Megjegyzések                                                                                           |
|---------------|--------------------------|--------------------------------------------------------------------------------------------------------|
| **Scout**     | alacsony-közepes, hosszú+kumulatív | scraping + szűrés több forráson; 2 scout teljes tempóban önmagában is telíthet                     |
| **Analyst**   | közepes, rövid löketekben | 1 feladat = 1 JD elolvasása + értékelés írása. ~2 percenként frissül, ha van sor                       |
| **Scorer**    | alacsony, rövid löketekben | illeszkedési pontszám a profilra, közel determinisztikus. A legolcsóbb szerep.                         |
| **Writer**    | **MAGAS**                | belső hurok a Critickal 3-4 kör, minden kör teljes CV/kísérőlevelet ír. Egyetlen aktív Writer felülmúlhatja mindenki mást együttvéve. |
| **Critic**    | közepes                  | csak Writer hívásra aktiválódik; költsége hozzáadódik a Writeréhez.                                    |
| **Assistant** | alacsony, igény szerint  | felhasználóval beszél; nincs az adat-pipelineban.                                                      |

**Következmény**: a 2. Writer marginális költsége sokkal magasabb, mint a 2. Scouté. A fejjel lefelé történő skálázás (`több munka → mindenből több`) túllövést eredményez.

## Szűk keresztmetszet → művelet (kvalitatív, tartalék, ha a statisztikák nem egyértelműek)

| Pipeline állapot                                        | Szűk keresztmetszet        | Művelet                                                                                              |
|---------------------------------------------------------|-----------------------------|----------------------------------------------------------------------------------------------|
| `0 new, 0 checked, 0 scored` (üres)                     | fej: nincs alapanyag        | indíts **csak Scoutokat**, akár 2-t párhuzamosan. Nincs Analyst/Scorer/Writer (nincs bemenet). |
| sok `new`, kevés `checked`                              | Analyst alulméretezett      | indíts `analista 2`-t. **Ne** adj hozzá Scoutokat (már van alapanyag; lassítsd őket, ha szükséges). |
| sok `checked`, kevés `scored`                           | Scorer lassú                | indíts `scorer 1`-et, ha hiányzik; ha már fut + sor `checked` > 20 ≥2 tick óta → indíts `scorer 2`-t (1 régen elég volt, de a vps1 run 2026-05-21 során 180 pontozás szóló scorerrel = szűk keresztmetszet) |
| sok `scored ≥ 50`                                       | írási kapacitás szükséges   | Writer. Figyelem: 1 aktív Writer + Critic önmagában telítheti a büdzsét. Indíts 1-et, figyeld meg 2-3 tickig, aztán dönts. |
| Writerek telítettek, sor `score ≥ 50` nem ürül          | terv kapacitáskorlát        | NE indíts extra Writereket — azonnali `RALLENTA` kockázata. Inkább lassítsd a Scoutokat, hogy ne tápláljak a sort. |
| alacsony `scored` sor, DE sok `writing` folyamatban     | Writerek elfoglaltak és termelnek | ne csinálj semmit. Várd meg a `writing → ready` átmenetet.                                  |

**Vezérelv**: kapcsold be az ágenseket **upstream**, ha a bemenet hiányzik, **downstream**, ha a kimenet hiányzik. Soha ne "minden szinten" gondolkodás nélkül.

## Skálázási kapuk (pacing szabályok)

- **1 spawn Sentinel tickenként (~5 perc).** Spawn → beindítás → várd meg a következő `[BRIDGE TICK]`-et → következő döntés. Soha nem 5 egymás után.
- **Maximum szerepenként**: 2 Scout, 2 Analyst, **2 Scorer** (1-ről emelve, miután a vps1 run 2026-05-21 megmutatta, hogy szóló scorer = 180 pontozási szűk keresztmetszet — vps1-postmortem anomália #6), 3 Writer, 1 Critic (a Criticot a Writer indítja, te nem nyúlsz hozzá).
- **Spawn előtti ellenőrzés**: `tmux has-session -t <SESSION> 2>/dev/null && echo ATTIVO` — soha ne indíts vakon meglévő session fölé.
- **Indítási sorrend**: Scoutok + Analyst *először*, Scorer + Writerek *utána*. Soha nem párhuzamosan.

## Spawn előtti ellenőrzőlista (futtasd le gondolatban minden spawn előtt)

1. `db_query.py stats` — hol van a backlog?
2. `db_query.py dashboard` — hány példány fut már szerepenként?
3. A szerep, amelyet indítani készülsz — feloldja-e a **valódi** szűk keresztmetszetet, vagy "feltöltöd a csapatot"? Ha a második: **ne indíts** (a kihasználatlan büdzsé jobb, mint a túllövés).

## Meglévő sessionök triázsa

Bármilyen `start-agent.sh` előtt listázd, mi van már ott:

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}'
tmux capture-pane -t <SESSION> -p -S -40 2>/dev/null | tail -20
```

| Állapot a capture-pane-ben                                                   | Művelet                                         |
|------------------------------------------------------------------------------|-------------------------------------------------|
| 🟢 CLI aktív, kontextus < 40%, friss hurok                                   | tartsd meg, ne indíts újra                      |
| 🟡 CLI aktív, kontextus > 80% vagy tétlen > 10 perc                          | mérlegeld: értékes munka → hagyd; zavaros hurok → killd + indítsd újra |
| 🔴 `command not found` / csupasz shell / panel üres > 5 perc                 | `tmux kill-session` + újraindítás (használd a `spawn-agent`-et) |

Mélyebb életjel-diagnosztikához (zombie eljárások, CLI halálának tünetei) az a **Dottore** dolga a `liveness-check` skillen keresztül — ne duplikáld itt.

## Lásd még

- `spawn-agent` — tényleges indítás + beindítás a szerepdöntés után.
- `sentinel-orders` — mi váltotta ki ezt a triázst (`SCALA UP`, `PIPELINE VUOTA + UNDERSHOOT`).
- `bridge-pacing` — amikor MARGINE azt jelenti: "indíts még egyet a szűk keresztmetszetnél".
- `liveness-check` (Dottore) — mélyebb ágens-egészségügyi diagnosztika.
- `agents/_team/architettura.md` — teljes pipeline diagram és fázisonkénti koordinációs megjegyzések.
