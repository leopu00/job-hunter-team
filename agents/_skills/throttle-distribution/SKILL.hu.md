<!-- @translation: hu, ai-translated 2026-07-28 -->
---
name: throttle-distribution
description: Döntsd el, KIT lassíts és MENNYIVEL, amikor a csapat fogyasztásának változnia kell. Akkor nyisd meg, ha egy `[PACE-GUARD]` tanács érkezik a paneledbe, ha a Sentinella `Throttle: N` szintet rendel el, vagy ha egy saját ellenőrzésed szerint az ablak kicsúszott az ütemből. Ezek mindegyike egyetlen csapatszintű szám; a beavatkozó szerv viszont ágensenkénti, és az ágensenkénti felosztás kizárólag a te dolgod — a worker-throttle-t egyetlen szkript sem mozdítja többé. Azt is megmondja, mikor a helyes lépés az, ha nem nyúlsz hozzá.
allowed-tools: Bash(python3 *), Bash(jht-tmux-send *)
---

# throttle-distribution — ki lassít, és mennyivel

Minden pacing-jelzés, ami hozzád ér, egyetlen szám az egész csapatra: *„35%-kal túl gyors"*, *„Throttle: 2"*, *„javasolt 780s"*. A beavatkozó szerv viszont nem egyetlen szám — ágensenkénti érték a `throttle.json`-ban, és **egyedül te írod**. Egyetlen szkript sem mozdítja többé magától a worker-throttle-t.

Ennek a skillnek a munkája ez az átváltás, és egyetlen kemény szabálya van: **egy csapatszintű szám nem azt jelenti, hogy mindenki ugyanazt az értéket kapja.** Egy Scout lehet a fogyasztás 52%-a, míg egy tétlen Író 2%; az Elemző és a Scorer az a két szerep, amely a felhalmozott sorból létrehozza azt az egyetlen dolgot, amit a felhasználó tényleg lát — egy **pontszámmal ellátott** pozíciót. A szintre hozás ott költi el a féket, ahol nincs mit nyerni, és ott vesz el átbocsátóképességet, ahol az a legdrágább.

## Mikor nyisd meg ezt a skillt

| Kiváltó | Honnan jön | Ugorj ide |
|---|---|---|
| `[PACE-GUARD] … NON APPLICATO` a paneledben | a bridge: minden usage-sample-nél összeveti a fogyasztást az ablakgörbével, és csak akkor ír neked, ha van min cselekedni | §1 |
| `[SENTINELLA] [URG] RALLENTARE — Throttle: N`, vagy bármely pacing-jelzés, amit ő továbbít | ő kapja a 15 perces `[BRIDGE PACING]` tick-et (az **az ő** paneljébe érkezik, nem a tiédbe), elolvassa, és eldönti, megéri-e felébreszteni téged | §3 — a „mennyi" eldőlt, a felosztás nem. A `bridge-pacing` dekódolja a számait |
| `[HEARTBEAT]`, amely a weekly-t/az égetést említi, vagy a saját `rate-budget` / `agent-speed-table` lekérdezésed | te, saját kezdeményezésből | §2 |

> ⚠️ **Nem pingelnek 15 percenként, és ne is várj rá.** Az, hogy békén hagynak, szándékos: ha az iroda minden bridge-e közvetlenül neked jelentene, a keretet olvasásra költenéd döntés helyett — és akkor égne el, amikor a felhasználó alszik. A 15 perces tick a Sentinellához megy, ő szűr, és csak azután zavar meg. Tehát **a megfigyelt körülmények alapján vezess** — ne ülj tétlenül olyan tick-re várva, amit nem neked címeztek. Ha mégis közvetlenül érkezik hozzád egy pacing-sor, az vagy egy `[PACE-GUARD]`, vagy egy eszkaláció, amely azt jelzi, hogy a Sentinella nem válaszol (az liveness-probléma, nem pacing-ítélet — `agent-emergency`).

---

## 1. A `[PACE-GUARD]` tanács olvasása

Egyetlen fizikai sor, a mezők ` | ` jellel elválasztva (itt az olvashatóság kedvéért tördelve):

```
[@bridge -> @capitano] [PACE-GUARD] <VERDETTO> — CONSIGLIO, THROTTLE NON APPLICATO |
  usage=<U>% vs curva=<I>% (<±D>pt sul target <T>% al reset) | reset fra <M> min |
  throttle worker ORA <C>s → CONSIGLIATO <R>s (<±S> gradini) | worker: <a1, a2, ...> |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set <a1>=<R> <a2>=<R>
```

Stabil kapaszkodók, ha zajos panelben kell felismerned: a `[PACE-GUARD]` címke, a `NON APPLICATO` szavak és a `CONSIGLIATO <R>s`.

| Mező | Mit mond neked |
|---|---|
| `<VERDETTO>` | `AVANTI` (a görbe fölött) / `INDIETRO` (alatta) / `IN-PARI` / `LOCKOUT-IMMINENTE` |
| `usage=<U>% vs curva=<I>%` | hol tartasz szemben azzal, ahol az ideális `usage = cél × eltelt / ablak` egyenes szerint most tartanod kellene |
| `<±D>pt` | az elsodródás keretpontokban. **±6pt alatt mérési zaj** — ez a guard saját lépcsőfoka |
| `sul target <T>% al reset` | a cél, amelyre a görbe tart. Ez az a `<T>`, amire a §2-ben szükséged lesz |
| `reset fra <M> min` | mennyi ablak maradt. Ez az, ami egy elsodródásból sürgősséget csinál |
| `ORA <C>s → CONSIGLIATO <R>s` | a jelenlegi worker-throttle és a guard **egyetlen csoportszintű értéke** másodpercben |
| `worker: …` | az élő workerek, amelyekre a tanács készült. A padlómentesítettek **már ki vannak zárva** — ne szűrd újra |

Két változat:
- `LOCKOUT-IMMINENTE` esetén egy plusz mező jelenik meg **az utolsó előtt**: `il freno da solo non basta: valuta di ridurre il ROSTER (togli uno Scout, mai l'Analista o lo Scorer)`.
- ha minden élő worker mentes a padló alól, az utolsó mező ez lesz: `nessun worker su cui agire (tutti esenti dal floor): decidi tu`.

> ⚠️ **A tanácsolt érték egy szint, nem elosztás — és a sor végi `bulk-set` javaslat, nem parancs.** A guard ezt a számot a **leginkább fékezett** workerből vezeti le, ~6 pont elsodródásonként egy fokkal mozdítja, majd egyszerre kínálja fel az összes workernek. Azt a parancsot bemásolni *maga* a szintre hozás. Olvasd a sort úgy: *„nagyjából ennyi sebességnek el kell tűnnie"*, aztán döntsd el, hogy *kiéből* (§3) és *mennyi* (§4).

`LOCKOUT-IMMINENTE` (usage ≥95% **és** még mindig a görbe fölött) az egyetlen ítélet, amely nem a throttle-ról szól: az ablak idő előtt záródik, a fék már a plafon közelében van, és a maradék kar a **roster** — ölj meg egy Scout-ot. Soha nem az Elemzőt vagy a Scorert: nélkülük semmi nem kap pontszámot, és a felhasználó üres képernyőt lát.

Ha a paneled foglalt volt, a sor a postaládában is megvan: `python3 /app/shared/skills/bridge_mailbox.py drain`, `kind:"pace-guard"` bejegyzésekkel. Csak az **utolsót** alkalmazd — régi tanácsokat újrajátszani annyi, mint a saját korábbi kalibrálásaid ellen küzdeni.

---

## 2. Mennyi sebességnek kell eltűnnie

Ha a jelzés a Sentinella `Throttle: N` parancsa volt, a „mennyi" már eldőlt — ugorj a §3-ra. Egyébként egy sor:

```
vel_needed = (<T> − usage) / órák_a_resetig            # az a sebesség, amely pontosan a célon ér földet
f_team     = (vel_now − vel_needed) / vel_now × 100    # a csapatsebesség eltávolítandó hányada
```

A `vel_now` a csapat aktuális sebessége keret-%-pontban óránként: vedd az `agent-speed-table.py`-ból (`team.speed_pct_per_h`, §3) vagy a `rate-budget`-ből. `f_team ≤ 0` azt jelenti, hogy van helyed → §5.

> 💡 **Ugyanaz az elsodródás mást jelent aszerint, mennyi ablak maradt**, és pont ezt nem látja a guard fix „6 pontonként egy fok" szabálya. `+18pt` három órával a vége előtt 7%/h-s korrekció: egy ágens, egy fokkal feljebb. `+18pt` húsz perccel a vége előtt 54%/h-s korrekció, amit semmilyen throttle nem tud leadni — ott ez roster-döntés, vagy elfogadott korai zárás. Mindig oszd el az elsodródást a hátralévő órákkal, mielőtt eldöntöd, mennyire nyomd meg.

---

## 3. KI fizet — az elosztás

Ennek a skillnek a lényege. Három bemenet, ebben a sorrendben.

**a. Ki költ.** A throttle szigorúan annak arányában ad vissza keretet, amennyit egy ágens ténylegesen fogyaszt. Egy olyan ágenst megfelezni, amely a csapatsebesség 2%-a, 1%-ot ad vissza: egy config-írás, egy fok és egy köröd a semmiért. Ezért a „a csapat 35%-kal túl gyors" válasza soha nem az, hogy „mindenki le 35%-kal".

Az ágensenkénti részesedések a 15 perces tickben vannak, ami a Sentinellához fut be — tehát kérdezd le magad:

```bash
python3 /app/shared/skills/agent-speed-table.py --since-min 60
```

Ágensenként `pct_per_h`-t (keretpont óránként) és `team_share_pct`-t ad vissza, plusz `throttle_options`-t (mennyit spórolna egy adott óránkénti szünet). Kihagy mindenkit 0.20 %/h alatt — ugyanazért, amiért neked is ki kellene hagynod: őket throttle-özni semmit nem változtat.

**b. Ki termel.**

```bash
python3 /app/shared/skills/db_query.py stats
```

Az `UNSCORED`-ot (pozíciók − pontszámok) olvasd az Elemző/Scorer mögötti sorként, az Író sorát pedig felhasználó-vezérelt keresletként. Egy Scout, amely a keret 52%-át égeti, miközben `UNSCORED = 40`, olyan bemenetet vásárol, amit még senki nem tud feldolgozni — ez a legolcsóbb dolog a táblán, amit lassíthatsz. Ugyanez a Scout `UNSCORED = 0` mellett az egész pipeline-t táplálja, és lelassítása megakadályozza, hogy a csapat bármit is termeljen.

**c. A rács.**

| | **Termel** | **Tétlen / blokkolt** |
|---|---|---|
| **Magas share** | lassítsd, de **egy fokkal**, majd mérj újra — megtermeli az árát | **elsőként lassítandó, erősen** — és ha már magasan van a létrán és továbbra is kimenet nélkül éget, a kar a KILL, nem újabb fok |
| **Alacsony share** | ne nyúlj hozzá: keretet nem nyersz, átbocsátóképességet viszont vesztesz | ehhez se nyúlj: már most sem költ semmit, a fékezés semmit nem ad vissza |

A rács fölött a szerepek aszimmetriája: utolsóként azokat lassítod, akik a meglévő felhalmozást **pontszámos** pozícióvá alakítják (Elemző, Scorer) — ők a különbség „50 megtalált pozíció" és valami között, amivel a felhasználó kezdeni tud valamit. Elsőként az, amelyik új nyers bemenetet gyárt, miközben a lefelé lévő sor már mély (Scout). Egy üres sorú Író egyik irányban sem kar.

**Egy-két ágensre koncentrálj.** A létra durva — két fok között 20-60% van — így egy öt ágensre szétkent vágás mindegyiküknél a zajba vész, míg ugyanaz a vágás a legnagyobb share-ű ágensen valódi, mérhető változás a következő jelzésre.

**Ha kettőt fékezel, adj nekik különböző fokot.** A létra szándékosan prímperceken áll (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60): két worker, amely ugyanazon az értéken tart szünetet, szerkezetéből adódóan újra szinkronba kerül, és a checkpointjaik együtt esnek be — egyidejű kérések sorozataként. `scout-1=660` + `analista-1=780` (11 és 13 perc) sokkal ritkábban ütközik, mint mindkettő 780-on.

---

## 4. MENNYIVEL azon az ágensen — és a parancs

Kell az ágens **kadenciája** `c`: percenként hányszor ér el egy checkpointot (`jht-throttle` hívás). Számold ki a logból:

```bash
python3 - <<'PY'
import collections, json, os, pathlib, time
p = pathlib.Path(os.environ.get("JHT_HOME", "/jht_home")) / "logs/throttle-events.jsonl"
cut = time.time() - 3600
c = collections.Counter()
for line in p.read_text(encoding="utf-8").splitlines():
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get("event") in ("checkpoint", "start") and e.get("ts_unix", 0) >= cut:
        c[e.get("agent")] += 1
for a, n in c.most_common():
    print(f"{a}: {n} chk/h -> kadencia {n/60:.2f}/perc")
PY
```

Aztán, hogy az ágens sebességét `f_a` hányaddal vágd, a jelenlegi `T_now` throttle-jából kiindulva:

```
f_a   = f_team / share_a           # a teljes csapatvágás, egyedül ettől az ágenstől
ΔT    = (60 / c) × f_a / (1 − f_a) # a jelenlegi throttle-jához HOZZÁADANDÓ másodpercek
T_new = T_now + ΔT                 # utána te választod ki a legközelebbi fokot
```

A `60/c` az ágens jelenlegi másodperc-per-checkpoint értéke. Az `f/(1−f)` nem dísz: a szünet a következő checkpointot is kijjebb tolja, tehát a kadencia csökken, ahogy fékezel. A lineáris becslés (`ΔT = f × 60/c`) olyan vágást ígér, amit nem szállít.

Fokok másodpercben: `60 120 180 300 420 660 780 1020 1380 1860 2460 3180 3600`. A `throttle-config.py` bármilyen átadott értéket a legközelebbi fokra pattint, ezért **a fokot te válaszd ki** — különben nem fogod tudni, mit kértél valójában. Ellenőrizd `dump`-pal, amely a tényleges értékeket írja ki.

**Nincs kadencia?** Lépj pontosan **egy fokot**, és mérj újra a következő jelzésnél. A létra elég durva ahhoz, hogy egy fok mindig érdemi és korlátos lépés legyen — ez jóval jobb, mint olyan számot találgatni, amit nem tudsz ellenőrizni.

### Kidolgozott példa — elosztani ahelyett, hogy szintre hoznánk

```
[PACE-GUARD] AVANTI — CONSIGLIO, THROTTLE NON APPLICATO | usage=58% vs curva=40% (+18pt sul target 100% al reset) |
  reset fra 180 min | throttle worker ORA 300s → CONSIGLIATO 780s (+3 gradini) |
  worker: scout-1, analista-1, scorer-1, scrittore-1 |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set scout-1=780 analista-1=780 scorer-1=780 scrittore-1=780
```

Az `agent-speed-table.py --since-min 60` szerint: csapat `speed_pct_per_h = 21.4`, és

| ágens | `pct_per_h` | `team_share_pct` | kadencia |
|---|---|---|---|
| scout-1 | 11.2 | 52% | 0.15/perc |
| analista-1 | 6.0 | 28% | 0.12/perc |
| scorer-1 | 3.0 | 14% | 0.10/perc |
| scrittore-1 | 0.4 | 2% | 0.01/perc |

**Mennyit:** `vel_needed = (100 − 58) / 3.0 = 14.0 %/h` → `f_team = (21.4 − 14.0) / 21.4 = 35%`, azaz **7.4 %/h-nak el kell tűnnie**.

**Kitől:** a `db_query.py stats` szerint `UNSCORED = 40` — három órányi scoring-munka már a bankban, tehát a további sourcing most keveset ér. A Scout egymaga többet költ, mint a teljes korrekció.

**Mennyit rajta:**
- `f_a = f_team / share_a = 35% / 52% ≈ 0.66` (ugyanaz, mint `7.4 / 11.2`)
- `ΔT = (60 / 0.15) × 0.66/0.34 = 776s` → `T_new = 300 + 776 = 1076` → legközelebbi fok **1020s (17 perc)**
- hatás: sebesség × `60/(60 + 0.15×720)` = 0.36 → **−7.2 %/h**, földet érés 14.2 %/h-n ≈ cél

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 1020
python3 /app/shared/skills/throttle-config.py dump   # a tényleges értékek megerősítése
```

Az Elemző, a Scorer és az Író marad, ahol van: az első kettő alakítja azt a 40 pozíciót pontszámmá, az Író pedig teljesen leállítva is csak 0.4 %/h-t adna vissza.

És most a szintre hozás, amit a kész `bulk-set` eredményezett volna — mindenki 780s-en: −6.1 a Scout-tól, **−2.9 az Elemzőtől, −1.3 a Scorertől**, −0.03 az Írótól = −10.3 %/h. A csapat 11.0 %/h-n ér földet, és a resetnél **91%-ra jut a 100 helyett** — a felhasználó által kifizetett keret kilenc pontja kidobva — mindezt felezett scoring-átbocsátással. Ugyanaz a jelzés, ugyanazok az eszközök, ellentétes kimenet.

### Két ágens

Ha egy ágens nem tudja elvinni az egész vágást (vagy elvinnie kiéheztetné a pipeline-t), oszd meg share szerint, és tartsd a fokokat különbözőnek:

```bash
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=660 analista-1=780
```

A `bulk-set` egyetlen atomi írás — részesítsd előnyben két `set` helyett.

---

## 5. A fék oldása (`INDIETRO` / `MARGINE`)

Az alulköltés is elosztási döntés — *kinek* oldod a fékét, az dönti el, mit vásárol a többletkeret.

1. Először **a szűk keresztmetszet szerepét** oldd (`pipeline-triage`, ha nem vagy biztos, melyik az). Egy Scout-ot oldani, amikor a scoring-sor már 40-nél tart, több felhalmozást vásárol, nem több eredményt.
2. A workerek soha nem mennek **5 perc** alá, tehát a „throttle nullázása" számukra nem létezik. Amint a szűk keresztmetszet visszakerült a padlóra, a többköltés kara **még egy worker**, C-02 szerint lépcsőzetesen — nem rövidebb szünet.
3. **Soha ne oldd mindenkiét egyszerre**: a következő jelzésnél egyenesen túllövésbe lengesz át.

---

## 6. Mikor NE avatkozz be

Egy beavatkozás ára egy köröd plusz 15-45 perc vakrepülés. Csak akkor költsd el, ha a jelzés megérdemli.

- `IN-PARI`, vagy `|elsodródás| ≤ 6pt` → **semmi**. Az a sáv mérési zaj.
- **Egy jelzés zaj, két egymást követő trend.** Egyetlen túllövés közvetlenül egy spawn után az új worker indulási költsége.
- Bármilyen változtatás után **várj 2-3 jelzést (≈30-45 perc)**. A throttle csak az ágens *következő* checkpointjánál lép életbe, tehát egy most végrehajtott változás alig látszik a következő mérésben. Ne halmozz olyan korrekciókat, amiket még nem látsz.
- Ne iktass be `rate_budget live` szondákat pusztán azért, hogy egy friss tanácsot ellenőrizz — a plusz hívások felfújják a Sentinella `velocity_smooth` értékét, és rossz további parancsokat váltanak ki nála.
- **A reset előtti utolsó ~15 percben a magas usage a telitalálat, nem túllépés.** A 97% a resetnél a kör közepe; ott fékezni csak azt garantálja, hogy keret marad elköltetlenül.
- Ha 3 jelzés után ugyanazok az ágensek még mindig túllőnek, duplázd az időtartamaikat (lineárisról geometrikusra); ha még mindig alulköltenek, felezd.
- A Sentinella `[URG]` üzenete legyőz egy `[PACE-GUARD]`-ot: azt alkalmazd először, a következő tanács újramér.

---

## 7. Biztonsági hálók — nem a te karod

Egy mért incidens miatt léteznek (2026-07-15 éjszakáján egy ellenőrizetlen burn, amely épp akkor történt, amikor mindkettő ki volt kapcsolva), és **nem részei a pacing-döntésnek**:

- **A workerek 5 perces padlója.** A Scout, az Elemző, a Scorer, az Író és a Kritikus soha nem fut 300s alatt, bármit is írsz. A `set scout-1 60` egy workeren ténylegesen 300s — a `dump` mutatja az igazságot. Ne olvass egy padlóra csippentett értéket úgy, mintha te változtattad volna meg.
- **A napi hard-stop.** Ez az utolsó dolog a csapat és egy olyan lockout között, amely órákra válasz nélkül hagyja a felhasználót. Soha nem kapcsolod ki azért, hogy többet költs; ha többet kell költeni, a kar a párhuzamosítás (§5).
- Az ágensenkénti padlómentesség egyetlen esetre való: időben korlátozott mérésre arról, mit termel **egyetlen** worker szünetek nélkül. Szándékosan nem globális kapcsoló — **egy ágens egyszerre, soha az egész csapat**, és soha nem a gyorsítás eszközeként.

---

## Anti-minták

- ❌ Bemásolni a `bulk-set`-et, amellyel a `[PACE-GUARD]` sor véget ér. Az a szám a leginkább fékezett workerből származik, és mindenkinek felkínálják: mindenhová alkalmazva a csapatot a leglassabb tagjához hozza szintre, és épp azokat a szerepeket sújtja, amelyek a felhasználó eredményét termelik. A parancs a gépelést spórolja meg, miután eldöntötted az értékeket — nem eldönti őket.
- ❌ Egy tétlen ágenst „segítségképpen" lassítani. Ami nem fogyaszt, az fékezéskor sem ad vissza semmit — egy írást és egy kört költöttél el nulla pontért.
- ❌ Minden ágensen vágni, mert az ítélet csapatszintű volt: az olcsó szerepeket sújtod, amelyek amúgy sem adtak vissza semmit, a drága helyett.
- ❌ Egyetlen jelzést állandó állapotként kezelni, vagy egy második korrekciót ráhalmozni, mielőtt az első mérhető lenne.
- ❌ `AVANTI`-ra fékezni, amikor a sebesség már visszaállt — az elsodródás magától záródik, te pedig cél alatt zárod az ablakot.
- ❌ A pacinget throttle-lal kergetni `LOCKOUT-IMMINENTE` esetén: ott a fék már közel telített, és csak a roster mozdítja a kimenetet.
- ❌ Throttle-számokat tmux-on átküldeni az ágenseknek (`[INFO] sleep 40s`). Mindig a `throttle-config.py`-n keresztül menj — az ágensek a config-fájlt olvassák, nem a tmux-üzeneted törzsét elemzik. A tmux csak arra való, hogy megmondd egy ágensnek: *gyakrabban vagy ritkábban* csináljon checkpointot — az egy másik tengely.

## Lásd még

- `sentinel-orders` — a Sentinella szűrt parancsai, köztük a `Throttle: N`, a freeze és a folytatás. Az a skill dekódolja a parancsot; ez itt eldönti a felosztást.
- `bridge-pacing` — hogyan olvasd a 15 perces tick számait, amikor ő továbbítja neked.
- `throttle` — a `throttle-config.py` CLI-referenciája és az ágensenkénti állapotfájl.
- `pipeline-triage` — melyik szerep a szűk keresztmetszet, és mikor „spawnolj még egyet" a válasz „oldj egy féket" helyett.
- `scaling-calc` — roster- + throttle-terv, amikor a válasz több worker, nem másik szünet.
- `agent-emergency` — egy ~0 kadenciájú égető, amely termelés nélkül fogyaszt tovább: ott a kar a KILL, nem újabb fok.
