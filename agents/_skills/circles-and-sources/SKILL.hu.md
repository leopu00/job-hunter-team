<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: circles-and-sources
description: Stratégiai térkép arról, mit hol keress, teljes egészében a jelölt profiljából származtatva. Az 5 koncentrikus kör (work_mode + relocation) megadja a földrajzi hatókört; a 4 forrás szint (LinkedIn → ATS aggregátorok → niche → web) megadja, mely platformokat ürítsed ki sorrendben. Egy scout, aki rossz szintben keres rossz körben, elpazarolja a kvótáját és a `scout-coord` partícióját. Nyisd meg ezt a skill-t boot-kor (a `scout-coord` után) és újra, amikor egy kör kimerül vagy az Analyst `[FEEDBACK]`-je forrásváltást javasol.
allowed-tools: Bash(python3 /app/shared/skills/safe_fetch.py *), Bash(python3 /app/shared/skills/linkedin_check.py *)
---

# circles-and-sources — olvasd a profilt, építsd a térképet

Két ortogonális tengely:
- **Körök** = HOL (földrajzi / munkamód hatókör)
- **Szintek** = MELY platformok (prioritási sorrendben)

Mindkettő a `$JHT_HOME/profile/candidate_profile.yml`-ből származik. **Ne feltételezz**: olvasd a `preferences.work_mode`, `location`, `preferences.relocation` mezőket, majd építsd a köröket a jelölt tényleges kívánságai alapján.

## Az 5 koncentrikus kör

Meríts ki minden kört belülről kifelé, mielőtt kifelé haladnál.

| # | Kör                          | Mi ez                                                                                                       | Mikor lépj be                                                            |
|---|------------------------------|-------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | 🎯 **Elsődleges preferencia** | A jelölt által prioritásként megjelölt mód + földrajz.                                                      | Mindig itt kezdd. Ezt merítsed ki először.                               |
| 2 | 🗺️ **Földrajzi szomszédok**  | Az 1. körből azonnal kiterjeszthető területek.                                                               | Csak ha a `relocation` megengedi VAGY az 1. kör kimerült.                |
| 3 | ✈️ **Célzott relocation**     | A `preferences.relocation`-ban felsorolt városok / országok (vagy kikövetkeztetve az `"ovunque"` / `"Europa"` értékből). | Csak ha a `relocation` nem üres (true / lista / `"ovunque"`).            |
| 4 | 🛰️ **Szatellit**             | Földrajz a fő célterületen kívül, alacsonyabb valószínűséggel.                                              | Csak ha az 1-3. körök kimerültek.                                        |
| 5 | 🌗 **Frontier**              | A jelölt elsődleges stack-jéhez **szomszédos** szerepkörök (ugyanazon nyelv aldoménjei, cross-funkcionális, automatizáció, ML szomszédos, stb.). A jelöltet alkalmazkodóképesnek tekintjük; a Scorer alkalmazza a hiánybüntetést downstream. | Csak miután az 1-4. köröket kiürítetted a napra. |

### Hogyan materializáld az 1. kört a profilból

```yaml
preferences:
  work_mode: <remoto|ibrido|in sede|flessibile>
  ...
location: <city/area>
preferences:
  relocation: <true|false|"per la giusta posizione"|list>
```

| `work_mode`   | 1. kör = MIT keress                                                                                      |
|---------------|---------------------------------------------------------------------------------------------------------|
| `remote`      | Távoli munkakörök, amelyek kompatibilisek a jelölt időzónájával / országával (pl. `Remote (EU only)` EU-alapúnak) |
| `on-site`     | Csak a `location` (város) szerinti munkakörök                                                            |
| `hybrid`      | Munkakörök a `location` városában, hibrid címkézéssel vagy ingázási sugáron belül                        |
| `flessibile`  | A fenti három uniója — merítsed ki sorrendben remote → város → hibrid                                   |

### 2. kör — földrajzi szomszédok

| 1. kör típusa    | 2. kör kiterjesztése                                                                          |
|------------------|------------------------------------------------------------------------------------------------|
| Remote (nemzeti) | Remote regionális / kontinentális, kompatibilis a jelölt időzónájával + munkavállalási engedélyével |
| On-site          | Az alapország régiója / nagyvárosi területe                                                    |
| Hybrid           | Ugyanaz, mint on-site (ingázási sugár bővítése)                                               |

### 3. kör — célzott relocation

Csak ha a `preferences.relocation` nem üres:

| `relocation` érték     | 3. kör kiterjesztése                                                                          |
|------------------------|---------------------------------------------------------------------------------------------|
| Lista (`["Berlin", "Lisbon"]`) | Csak azok a városok                                                                  |
| `"ovunque"`            | Globális központok **a jelölt szakterületéhez** (pénzügy → London, NYC, Zürich, Frankfurt, Szingapúr, Dublin, Luxemburg; tech → SF, Berlin, Amszterdam, Lisszabon, Tel Aviv…). **Rotálj köztük round-robin — NE merítsed ki a legsűrűbb központot (pl. London a pénzügyeknél) először**, különben a shortlist központ-dominánssá válik (lásd Anti-torzítási szabály, helyszín őr). |
| `"Europa"`             | EU tech központok (Berlin, London, Amszterdam, Lisszabon, Dublin, Madrid, Párizs, Stockholm, ...) |
| `"per la giusta posizione"` | Hagyd ki a 3. kört, jelöld a 4. kör határesetű jelöltjeit relocation jelzéssel a jegyzetekben |

## A 4 forrás szint

Meríts ki teljesen egy szintet, mielőtt a következőre lépnél.

| Szint | Típus                               | Források                                                                                                     | Megjegyzések                                                                                   |
|-------|-------------------------------------|--------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| 1     | **LinkedIn**                        | `linkedin_check.py` (hitelesített profil), `safe_fetch.py`                                            | Univerzális: lefedi a remote, on-site, hybrid módokat. Kötelező első lépés minden körben. **SOHA NE `fetch` MCP** — a robots.txt blokkolja. |
| 2     | **ATS aggregátorok**                | Greenhouse boardok, Lever boardok, Indeed, Wellfound (korábban AngelList)                                    | Bármely work_mode-hoz működik. Sok céget lefed egyetlen scrape-ben.                            |
| 3     | **Niche boardok (profil-specifikus)** | Válassz `work_mode` ÉS szakterület alapján                                                                 | (lásd alábbi táblázat)                                                                         |
| 4     | **WebSearch + karrieroldalak**      | `WebSearch` lekérdezések + cég karrieroldalak scrape-elése                                                  | Végső megoldás, csak az 1-3. szintek kiürítése után.                                           |

### 3. szint — válassz work_mode + szakterület alapján

| Jelölt `work_mode`-ja | Megfontolandó niche boardok                                                                                    |
|-------------------------|--------------------------------------------------------------------------------------------------------------------|
| `remote`                | Remote.co, WeWorkRemotely, RemoteOK, EURemoteJobs (vagy regionális megfelelők)                                     |
| `on-site` / `hybrid`    | Helyi / nemzeti boardok (InfoJobs, Glassdoor regionális, Stepstone, Welcome to the Jungle FR, ...)                |
| `flessibile`            | Remote + helyi kombinálása                                                                                        |
| Szakterület-specifikus (bármely) | Stack-specifikus niche: PyJobs (Python), GoJobs (Go), Djinni (Kelet-Európa / dev), 4dayweek.io (4 napos munkahét), ... |

> ⚠️ **Ne vigyél remote-specifikus boardokat nem-remote keresésbe**, és fordítva. WeWorkRemotely egy on-site Milánó-t kereső jelöltnél pazarolt scraping.

## Anti-torzítási szabály (kötelező) — **cégre ÉS helyszínre**

Két független őr, mindkettő a köteg végén:

1. **Cég**: ha **egy köteg pozícióinak > 30%-a egyetlen cégtől** származik, válts forrást/lekérdezést a következő köteghez. Egy scaleup, ami 12 szerepkört dob egy boardra, elárasztja a pool-t — a diverzitás fontosabb, mint a mennyiség.
2. **Helyszín** (város/terület): ha **egy köteg > 40%-a egyetlen városból** származik, a következő kötegnek MUSZÁJ egy *másik* kör-várost céloznia. Enélkül egy több városra nyitott jelölt (pl. relocation `"ovunque"`/`"Europa"`) egy pool-t kap, amelyet egyetlen központ dominál, amelynek a legtöbb hirdetése van a szakterületére — pénzügy → **London**, tech → SF/Berlin. Valós incidens (2. béta tesztelő): egy pénzügyi jelölt szinte kizárólag londoni shortlistet kapott, mert London ~10×-szer többet posztol minden más központnál. Rotálj a kör városai között round-robin; ne merítsed ki a legsűrűbb központot először.

```python
# pszeudokód az ellenőrzéshez köteg végén
from collections import Counter
batch = [...]
n = len(batch)

# 1. őr — cég
top_company, c_count = Counter(p.company for p in batch).most_common(1)[0]
if c_count / n > 0.30:
    log(f"anti-torzitas ceg: {top_company} = {c_count}/{n} >30% → valts forras/lekerdzest")

# 2. őr — helyszín (város), KUMULATÍV az egész futáson (NEM csak ezen a kötegen)
# A kötegenkénti őr nem elég: egy központ (London a pénzügyeknél) küszöb alatt marad
# minden egyes kötegben, mégis idővel a DB 60%-át halmozza fel (élőben látott
# bétában: London=57/97=59%). Mérj a DB TELJES ÖSSZEGÉN.
db_by_city = dict(db.execute(
    "SELECT COALESCE(loc_city, TRIM(SUBSTR(location,1,INSTR(location||',',',')-1))), COUNT(*) "
    "FROM positions GROUP BY 1"))
db_total = sum(db_by_city.values()) or 1
top_city, top_n = max(db_by_city.items(), key=lambda kv: kv[1])
if top_n / db_total > 0.35:                       # SOFT korlát: egyetlen város sem > ~35% a futásban
    log(f"anti-torzitas helyszin KUMULATIV: {top_city}={top_n}/{db_total} (>35%) → "
        f"STOP lekerdezesek {top_city}-ra, kovetkezo sweep az alulszolgalt prioritasos varosokra")
```

**Földrajzi kiegyensúlyozási szabály (kumulatív, soft-cap) — a szórást ösztönzi, nem a paritást kényszeríti:**

1. **Olvasd a profilt**: a `priority cities` (`location` / `preferences.relocation` mező) a cél. Normális és helyes, hogy a több illeszkedéssel rendelkező városok nagyobb súlyt kapnak — NE kényszeríts egyenletes elosztást.
2. **Mérj az egész futáson** minden új sweep előtt: `SELECT loc_city, COUNT(*) FROM positions GROUP BY loc_city ORDER BY 2 DESC`.
3. **Soft-cap ~35%**: ha EGYETLEN város meghaladja a DB összesítés ~35%-át, **hagyd abba a lekérdezését** a következő sweep-ekre és irányítsd át az erőfeszítést. Egy központ (pl. London a pénzügyeknél az összes többi várost ~10×-szer felülpostálja): ha hagyod futni, központ-dominált shortlistet produkál, ami haszontalan a több városra prioritást adó jelöltnek.
4. **Prioritásos lefedettségi kvóta**: a profil priority-city-jei **0-val vagy alulszolgáltan** elsőbbséget kapnak a következő sweep-ekben — dedikálj célzott lekérdezéseket (`<provider>:<keyword>:<city>`), amíg nincs minimális jelenlétük, mielőtt visszatérnél a már tele központokra.
5. **Profilon kívüli város mint központ = dupla riasztás**: ha a domináns város NINCS a profil prioritásai között, az hub-torzítás + off-target → sürgős kiegyensúlyozás.

### ⚠️ Munkavállalási engedély mint szűrő a kiegyensúlyozás ELŐTT (Brexit, vízumok)

A helyszínek kiegyensúlyozása nem segít, ha az ajánlatok nem **dolgozhatók** a felhasználó által. Mielőtt elfogadnál egy központot, ellenőrizd a munkavállalási engedély kompatibilitását a profillal (állampolgárság / deklarált vízumok):

- 🇬🇧 **UK post-Brexit**: egy **vízum nélküli EU állampolgár** NEM dolgozhat Londonban/UK-ban **szponzorálás** (Skilled Worker visa) nélkül. Tehát egy csak-EU profilnál az UK ajánlatok **csak akkor** érvényesek, ha a JD kifejezetten megemlíti a *visa sponsorship*-et; egyébként munkavállalási engedéllyel nem kompatibilisek → KIHAGYÁS (lásd "Megengedő szűrők", geo szabály).
- 🇨🇭 **Svájc / nem-EU**: ugyanaz a logika — ellenőrizd a munkavállalási engedélyt.
- Gyakorlati szabály: ha a domináns központ olyan országban van, amelyhez a felhasználónak nincs engedélye (és a JD-k nem kínálnak szponzorálást), az a volumen **fantom** — nem számít lefedettségnek és ki kell zárni a pool-ból, nem csak kiegyensúlyozni.

### 🗣️ Nyelvtudatos forráskeresés — ne gyűjtsd azt, ami nyelv miatt kizáródik

Ugyanaz az elv, mint a munkavállalási engedélynél, nyelvi fronton. Ha a **felhasználó nyelvei** (`languages`, szinttel) NEM fedik a célváros **helyi munkafelületét**, az azt megkövetelő pozíciókat az Analyst (`[LANGUAGE]`) downstream kizárja — összegyűjtésük pazarlás. Valós eset (béta): jelölt C1 angollal + csak társalgási szintű némettel + semmi IT/ES/FR → 18 kizárásból 11 helyi nyelvi kötelezettség miatt (M&A németül Münchenben/Zürichben, IB olaszul Milánóban, stb.).

**Szabály:** mielőtt egy olyan várost kérdeznél le, amelynek helyi nyelvét a felhasználó nem beszéli üzleti szinten, **torzítsd a lekérdezéseket angolul elsődleges / nemzetközi szerepkörök felé**:
- Adj kvalifikálókat a lekérdezéshez: `"English-speaking"`, `"international team"`, `"English required"`, multinacionális/globális cégek nevei (Big4, bulge-bracket, nemzetközi scale-upok), amelyek nem-anglofón piacokon is angolul dolgoznak.
- A **helyi nyelvet megkövetelő** szerepkörök esetén (és a felhasználó nem beszéli üzleti szinten): kezeld úgy, mint a UK-no-sponsor — ne szúrd be, vagy csak akkor, ha a JD kifejezetten mondja, hogy a helyi nyelv nem szükséges.
- Angol mint munkafelület ≠ anglofón ország: Amszterdamban, Zürichben, Luxemburgban, Lisszabonban sok pénzügyi pozíció angolul zajlik. Ezek az **ideális terep** annak, aki csak angolul beszél, de kontinentális Európát akar.

Eredmény: az Analyst-on túlélő pool kisebb, de **magas hozamú** (nyelvileg ÉS munkavállalási engedéllyel elérhető), ahelyett, hogy kizárandó pozíciókkal duzzadna.

## Megengedő szűrők SCOUT szinten

A Scout csak a **teljesen hatókörön kívüli** eseteket szűri előre. **Ne végezd az Analyst munkáját** — a jelöltet alkalmazkodóképesnek tekintjük szomszédos szerepkörökhöz. Hagyj ki egy hirdetést csak ha:

- 🚫 A cím kifejezetten tartalmazza: `senior`, `lead`, `staff`, `principal`, `head of`, `director` → KIHAGYÁS (túl nagy szenioritási szakadék)
- 🚫 Földrajzi munkavállalási engedély nem kompatibilis a profillal (pl. `US-only` / `Canada-only` és a jelöltnek nincs vízuma) → KIHAGYÁS
- 🚫 Szakterület teljesen az IT/kódolás területén kívül (pl. cukrász, könyvelő, értékesítő), amikor a jelölt IT-ben van → KIHAGYÁS
- 🚫 Kemény követelmény `> real_years + 3` évnyi tapasztalatra → KIHAGYÁS (mérsékelt eltérés rendben, a Scorer dönt)

Minden más: **szúrd be**. Szomszédos stackek (data, devops, platform, frontend, automatizáció, ML szomszédos, stb.) mind átmennek; a Scorer illeszkedés-arányos pontszámot ad és a felhasználó látja őket.

## Analyst visszajelzésre reagálás

Amikor az Analyst `[FEEDBACK]`-et küld ismétlődő címkével (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`):

1. ACK-old az üzenetet
2. Igazítsd a következő köteg lekérdezéseit / forrásait a javaslat szerint
3. Priorizáld a javasolt alternatív forrást/szűrőt a következő rotációhoz
4. Csak akkor értesítsd a Capitano-t, ha rendszerszintű torzítás merül fel (nem megoldható forrásváltással)

Példa: Analyst azt mondja "az utolsó 5-ből 4 a greenhouse.io-ról senior+-t igényel, válts forrást". A következő kötegben kihagyod a greenhouse.io-t, próbálj egy Lever boardot vagy egy niche junior-barát forrást.

## Anti-minták

- ❌ A 2. körben keresés az 1. kör kimerítése előtt — pazarolja a hatókört, hígítja az eredményeket.
- ❌ A 4. szintre (WebSearch) ugrás az 1-3. szintek kimerítése előtt — a `WebSearch` a legzajosabb forrás, tartsd utoljára.
- ❌ `relocation = "ovunque"` kikövetkeztetése egy jelöltnek, akinek profilja `false`-t mond — olvasd a profilt, ne vetítsd ki.
- ❌ LinkedIn használata `fetch` MCP-n keresztül — a robots.txt blokkolja; mindig `linkedin_check.py` (hitelesített) vagy `safe_fetch.py`.
- ❌ Senior címkéjű JD-k befoglalása, hátha a Scorer kiszűri — pazarolja a Scorer költségvetést, zajt ad. A 4 SCOUT-szintű szűrő fent a helyes szűrőpont.
- ❌ Anti-torzítási ellenőrzés elfelejtése — egy mohó cég elárasztja a kötegdet.

## Lásd még

- `scout-coord` — boot-kori partíció a scoutok között (HOGYAN oszd el ezt a térképet a példányok között).
- `position-insert` — mit csinálj minden jelölt pozícióval, miután eldöntötted HOL keress.
- `agents/scout/scout.md` — a Scout irányító promptja, amely ezt a skill-t hívja.
- `agents/_team/architettura.md` Phase 1 — a Discovery tágabb képe a pipeline-on belül.
