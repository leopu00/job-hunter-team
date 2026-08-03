<!-- @translation: hu, ai-translated 2026-08-03 -->
---
name: team-modes
description: "A csapat-módok kézikönyve — módonként egy kártya (search / harvest / care / calibration / saving). Akkor nyisd meg, amikor az órás [MODALITÀ CORRENTE] banner megnevez egy módot, és nem emlékszel, mit jelent operatívan; ébredéskor egy context-refresh után; vagy amikor a felhasználó a játékból módot vált. A mód MINDIG a felhasználó választása - ez a skill azt mondja meg, hogyan VIDD az aktuálisat, soha nem azt, hogyan változtasd meg."
allowed-tools: Bash(python3 /app/shared/skills/mode_banner.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/feedback_query.py *), Bash(python3 /app/shared/skills/team_directives.py *)
---

# team-modes — mit jelent az aktuális mód, harminc másodpercben

A csapatnak egyszerre egyetlen tartós módja van. A
`$JHT_HOME/profile/capitano-maintenance.json` fájlban él (történelmi fájlnév —
NE várj átnevezett fájlt), a `"mode"` kulcs alatt, amely **öt értékből álló
zárt enum**. Az órás `[MODALITÀ CORRENTE]` banner a tömör specifikációt hozza;
ez a skill a teljes kártya. Ha a banner és a contexted ellentmond egymásnak,
**a lemezen lévő fájl nyer** — a contextedet törölhette egy refresh.

| érték | jelentés |
|---|---|
| `search` | alapértelmezett: gyűjtés (scout → elemzés → score) |
| `harvest` | állítsd le a sourcingot, a már megtalált legjobb pozíciókat váltsd CV-re |
| `care` | tartsd frissen a megtalált portfóliót: ütemezett recheck, a lejártak kizárása (C-18) |
| `calibration` | olvasd el a felhasználó visszajelzését, és irányozd be újra a keresés **prioritását** |
| `saving` | puszta túlélési minimum, semmilyen autonóm gazdagítás |

- **Nincs fájl → `search`.** Legacy értékek: `"normal"` → search,
  `"maintenance"` → care (élő telepítések még hordozzák őket — tartsd
  tiszteletben őket, ugyanaz a mód).
- **A fájl létezik, de olvashatatlan → `sconosciuto` mód**: kezeld AKTÍV
  parancsként (a sourcing állva marad), és magad nyisd meg a fájlt, mielőtt
  bármit eldöntenél.
- Az enumon kívüli érték is a felhasználó parancsa: jelentsd, ne normalizáld el.

Minden mód **négy dolgot** deklarál — pontosan azt a négyet, amit a banner
tömörít: **(1)** mely sorok aktívak, **(2)** mi van felfüggesztve, **(3)** hová
megy a budget, **(4)** mikor KÉSZ a munkája. A 4. pont az, ami történetileg
hiányzott: egyetlen mód sem ért véget magától, és egy csapat egyszer 18 napig
ült karbantartásban anélkül, hogy bárki észrevette volna. Amikor a banner azt
mondja, hogy a mód munkája kimerült, **szólj a felhasználónak** — soha ne válts
módot magadtól, de a hallgatás sem megengedett.

Az `orders` szótár (`stop_search`, `discard_expired_rotating`, `cv_min_score`,
`pre_check_liveness_for_cv`, plusz a kézzel írt kulcsok) MINDEN móddal
összeáll: egy explicit kulcs az `orders`-ben mindig felülírja a mód
alapértelmezését. Egy élő produkciós VPS ma `care` módban fut, ezekkel a
parancsokkal aktívan.

---

## `search` — ricerca (keresés; alapértelmezett: gyűjtés)

1. **Aktív sorok**: a teljes pipeline — a Scoutok sourcingolnak,
   `next-for-analista`, `next-for-scorer`; a Scrittore/Critico on-demand marad
   (C-10).
2. **Felfüggesztve**: semmi. A C-05/C-05c (anti-idle sourcing) érvényben van.
3. **Budget-prioritás**: előbb a sourcing, aztán elemzés/score; a beérkezőt
   billentsd a PONTOZOTT pozíciók felé (a shortlist a termék).
4. **Kilépési feltétel**: nincs — folyamatos mód. Nem ér véget; a felhasználó
   mozdít ki belőle (jellemzően `harvest` vagy `care` felé, amikor a pontozott
   backlog túlnő azon az időn, amennyit el tud olvasni).

**Mit csinálsz**: normál üzem — C-02 fokozatos kalibráció, C-07 throttle-létra,
C-09 weekly-tudatosság. **C-25-tel**: `[SCOUT-ESAUSTO]` + üres downstream sorok
+ mozgástér → a C-25 alapértelmezett hasznos munkája már eleve ennek a módnak a
munkája; tartsd a pace-t a célon, soha ne állj tétlenül, ha van mozgástér. **NE
tedd**: a „nincs fájl"-t „nincs szabály"-ként kezelni — a tábla
(`team_directives`) attól még érvényes.

## `harvest` — raccolto (betakarítás: állítsd le a sourcingot, váltsd át a legjobbakat)

1. **Aktív sorok**: a már megtalált portfólió, előbb a legjobb pontszámok.
   CV-folyam: `next-for-scrittore` (a felhasználó által flaggelt) plusz azok a
   pozíciók, amelyeket a felhasználó választ, amikor elé teszed a shortlist
   elejét; a Critico a szokásos módon átnézi.
2. **Felfüggesztve**: a sourcing — **SEMMI Scout** (a `stop_search`
   alapértelmezetten true: a C-05/C-05c felfüggesztve, az üres `new` sor a
   SZÁNDÉKOLT állapot).
3. **Budget-prioritás**: előbb a Scrittore/Critico; az Analista csak a CV
   előtti liveness-ellenőrzésre (`pre_check_liveness_for_cv` — soha ne írj CV-t
   halott ajánlatra).
4. **Kilépési feltétel**: egyetlen élő, a CV-küszöböt
   (`orders.cv_min_score`, alapértelmezés 75) elérő pozíció sem marad CV
   nélkül. A banner ezt csak olvasva értékeli ki a DB-n; amikor azt mondja,
   HARVEST DONE, jelentsd a felhasználónak, és kérdezd meg, merre tovább.

**Mit csinálsz**: öld meg / ne spawnolj Scoutot; a C-10 szerint spawnolj
Scrittorét on-demand, ahogy a felhasználó flaggeli a pozíciókat; tartsd
mozgásban a flaggeltek sorát; tedd a felhasználó elé a legjobb, még meg nem írt
pozíciókat, hogy flaggelhesse őket. **C-25-tel**: a betakarítás kimerült +
budget-mozgástér → a többlet visszamegy a sourcingra (1 Scout, normál pacing),
KIVÉVE ha a felhasználó kifejezetten megtiltotta a sourcingot (tábla, C-26) —
akkor a helyeden maradsz, és elmondod a felhasználónak, hogy van fel nem
használt budget. **NE tedd**: a küszöb alatti pozíciókra CV-t írni, „hogy
elmenjen a budget", vagy Scoutot spawnolni, „hogy ne állj tétlenül", amíg
maradtak meg nem írt jelöltek.

## `care` — cura (gondozás: tartsd frissen a portfóliót; a teljes szabály: C-18)

1. **Aktív sorok**: `next-for-recheck-due` (élő, score ≥ 70, >14 nap, előbb a
   legjobbak, a `recheck-batch` révén), `next-for-geocode-missing`,
   `next-for-logo-missing`, plusz a lejártak halmaza
   (`discard_expired_rotating`).
2. **Felfüggesztve**: a sourcing `stop_search: true`-val (itt ez az
   alapértelmezése) — a C-05/C-05c felfüggesztve.
3. **Budget-prioritás**: a portfólió karbantartása, az aktív órákra elosztva
   (lassan, egyenletesen — soha nem az elejére sűrítve); CV csak a felhasználó
   kérésére és ≥ `cv_min_score` (alapértelmezés 90).
4. **Kilépési feltétel**: MIND A NÉGY gondozási sor üres. A 14 napos ütem újra
   megérleli a pozíciókat, tehát a „kész" annyit tesz: kész-egyelőre — a banner
   ezt ki is mondja, és a C-18 4. pontja + a C-25 szerint a többlet visszamegy
   a sourcingra, hacsak nincs tiltás.

**Mit csinálsz**: az Analisti a motor — példányonként egy külön sor (C-13),
kimondva a kick-offban. Egy pozíció kizárása MINDIG az Analista ítélete, soha
nem egy szkripté. A gazdagítási sorok KÓDSZINTEN tiszteletben tartják az
`enrichment-policy.json`-t: egy sor, amely policy-indokkal üresen tér vissza,
szándékolt állapot, nem bug. **NE tedd**: egyetlen menetben elégetni az összes
rechecket, újrapróbálni egy policy által letiltott sort, vagy Scoutot
spawnolni, amíg a gondozási soroknak van munkájuk.

## `calibration` — calibrazione (kalibráció: irányozd be újra a keresés prioritását)

1. **Aktív sorok**: a felhasználó visszajelzése (`feedback_query.py recent` —
   a felhőben él), a score-profil, a `role_family` taxonómia.
2. **Felfüggesztve**: a tömeges sourcing — amíg a prioritás nincs frissítve, az
   új pozíciók a RÉGI irányzékkal kerülnének elő (pontosan ezt a pazarlást
   előzi meg ez a mód). A `stop_search` alapértelmezetten true.
3. **Budget-prioritás**: a visszajelzés elolvasása + újrairányzás: állítsd be a
   Scoutok keresési prioritásait és köreit, és ha a kritériumok elmozdultak,
   pontozd újra az érintett pozíciókat egy behatárolt batchben.
4. **Kilépési feltétel**: a friss visszajelzés-batch elolvasva és a prioritás
   frissítve. Ez lemezről NEM ellenőrizhető géppel (a visszajelzés a felhőben
   él) — a banner szándékosan azt mondja, „non valutabile"; TE jelented ki a
   felhasználónak, hogy kész, azzal együtt, mi változott (pl. „a helyszíni
   Berlin lejjebb sorolva, a fintech felhúzva — 12 pozíció újrapontozva").

**Mit csinálsz**: húzd le a visszajelzést, szűrd ki belőle a mintát (mi
tetszett neki / mit rejtett el / mit csillagozott), fordítsd le Scout-
prioritásokra és — ha indokolt — egy behatárolt újrapontozásra. Utána jelents,
és várd meg, hogy a felhasználó módot váltson. **C-25-tel**: a kalibráció kész
+ mozgástér → a többlet visszamegy a sourcingra (immár az ÚJ prioritással),
hacsak nincs tiltás. **NE tedd**: újrapontozni az egész DB-t, olyan
preferenciákat kitalálni, amiket a visszajelzés nem mutat, vagy a régi
irányzékkal tovább sourcingolni.

## `saving` — risparmio (takarékosság: túlélési minimum)

1. **Aktív sorok**: egy autonóm sem. Csak az, amit a felhasználó kifejezetten
   kér: chat-válaszok, ticketek (C-15), a felhasználó által indított flagek
   (kért write/geocode/recheck — azok soha nem mennek át policyn).
2. **Felfüggesztve**: a sourcing ÉS minden autonóm gazdagítás (recheck,
   geocode, logo). Azok a workerek, amelyek a függőben lévő felhasználói
   kérésekhez nem kellenek, megölésre kerülnek, vagy el sem indulnak.
3. **Budget-prioritás**: nulla közeli. Az egyetlen kiadás a felhasználónak adott
   válasz.
4. **Kilépési feltétel**: nincs — addig tart, amíg a felhasználó fel nem oldja.
   Nincs mit kimeríteni; a banner ezt ki is mondja.

**Mit csinálsz**: tartsd válaszkésznek a Capitanót/Assistentét/Mentort; ezen túl
semmi nem mozdul közvetlen felhasználói kérés nélkül. **C-25-tel**: a
takarékosság ÖNMAGÁBAN a felhasználó explicit tiltása az autonóm költésre — a
C-25 itt NEM oldja fel a sourcingot; ha budget megy veszendőbe, azt ELMONDOD a
felhasználónak (ez a C-25 másik fele), nem költöd el. **NE tedd**: a
„minimum"-ot úgy átértelmezni, hogy „egy kis sourcing nem árt".

---

## Módokon átívelő szabályok

- **A C-25 (soha ne pazarold a budgetet)** minden móddal összeáll: a mód saját
  munkája KÉSZ + mozgástér → az alapértelmezett hasznos munka a sourcing 1
  Scout tempójában — kivéve ott, ahol a mód vagy a felhasználó kifejezetten
  tiltja a költést (takarékosság; explicit tiltás a táblán); ott a helyes lépés
  a fel nem használt budget jelentése. A C-25 soha nem ír felül egy féket: a
  weekly/napi capek, a `work_phase=OFF`, a C-23 kapui és a felhasználói
  throttle-ok mind nyernek.
- **A pacing-kapuk módfüggetlenek**: egyetlen mód sem hatalmaz fel burstre vagy
  a `vel_target` figyelmen kívül hagyására; a mód csak azt változtatja meg,
  HOVÁ megy az adagolt budget.
- **Kilépés ≠ módváltás.** Amikor egy mód jelenti, hogy a munkája kimerült,
  értesítsd a felhasználót, és tartsd tovább a módot, amíg Ő meg nem
  változtatja. A fájlt a játék konzolja írja a felhasználó nevében — soha nem
  te.

## Lásd még

- `mode_banner.py` (`shared/skills/`) — lemezről állítja össze az órás bannert;
  a `python3 /app/shared/skills/mode_banner.py show` kérésre újraolvassa.
- **C-18** az identitásfájlodban — a gondozási mód teljes szabálya.
- `sentinel-orders`, `pipeline-triage`, `scaling-calc` — a karok, amelyeket
  minden mód más-más sorra irányít.
