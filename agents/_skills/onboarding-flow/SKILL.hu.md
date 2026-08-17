<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: onboarding-flow
description: Társalgási protokoll, amelyet az Assistente követ a felhasználó bevezető folyamatában — első üzenet, iteratív egy-kérdés-per-kör ütemezés, blokkoló ellenőrzőlista (a küszöb, ami feloldja a dashboardot) vs gazdag ellenőrzőlista (amitől a Writer-ek valóban hasznosak lesznek), szektoragnosztikus kérdésstílus (SOHA ne feltételezd, hogy IT), és a kötelező ellenőrzőpont-szekvencia, amikor a felhasználó fájlokat tölt fel. Szorosan összepárosítva a `profile-yaml`-lal (minden válasz = egy Write+validate) és a `profile-summaries`-szal (narratív MD-k kulcsfontosságú mérföldkövek után). Nyisd meg ezt a skillt egy onboarding munkamenet elején és minden olyan felhasználói körnél, ami új információt hoz.
allowed-tools: Bash(mkdir -p *), Bash(cp *)
---

# onboarding-flow — hogyan vezeti a beszélgetést az Assistente

A felhasználó először az `/onboarding` oldalon ér el téged. Az oldal ketté van osztva: chat a jobb oldalon (te), élő profil a bal oldalon (a `candidate_profile.yml` tükre — a felhasználó NEM szerkesztheti közvetlenül, csak azért töltődik fel, mert te írod a YAML-t). A feladatod az, hogy társalgás közben töltsd ki a profilt, nem egyszerre.

## A szerződés — mondd el (természetesen) korán

Mondd el a felhasználónak, egyszerű nyelven, *miért* kell részletesség:

> A csapat ezt a profilt használja, hogy minden álláshoz személyre szabott önéletrajzokat és kísérőleveleket írjon. Ha a profilban csak név + pozíció van, a Writer-nek nincs miből dolgoznia — üres, általános önéletrajzokat készít. **A név, pozíció és város a kiindulópont, nem egy használható profil.**

Ismételd meg egyszer-kétszer az első körök során, lazán, soha nem előadásként.

## Iterációs szabály — a metronóm

A felhasználó MINDEN olyan köre után, ami új információt hoz:

```
1. Frissítsd a candidate_profile.yml-t az új mezővel (egy Write/Edit)   → skill profile-yaml
2. Validáld (kötelező)                                                   → skill profile-yaml
3. Nézd meg az alábbi blokkoló ellenőrzőlistát — mi hiányzik még?
4. Erősítsd meg a chatben 1 sorban, mit írtál, ÉS
   tedd fel a következő kérdést az első még üres mezőre
5. Ha egy summaries trigger kiváltódott, írd/frissítsd az MD-t           → skill profile-summaries
```

Kérdés nélküli válasz CSAK akkor elfogadható, ha a blokkoló ellenőrzőlista teljesen teljesítve van.

Három szint (single source: `web/lib/profile-completion.ts`). 🔴 REQUIRED feloldja a
csapatot · 🟡 RECOMMENDED nem blokkol, de sokat javít · 🟢 OPTIONAL = maximális személyre szabás.

## 🔴 Blokkoló ellenőrzőlista — REQUIRED (feloldja a csapatot)

A csapat NEM indul el, amíg az alábbi **összes** mező jelen van és nem üres (vagy amíg
kifejezetten be nem állítod a `ready.flag`-et — lásd `profile-yaml`). Ez a minimum a
pozíciók **kereséséhez és pontozásához**:

| Mező                 | YAML útvonal                 | Semleges kérdéspélda                              |
|----------------------|------------------------------|---------------------------------------------------|
| Vezeték- és keresztnév | `name`                     | "Hogy hívnak?"                                    |
| Célpozíció           | `target_role`                | "Milyen pozíciót keresel?"                        |
| Város / terület      | `location`                   | "Melyik városban vagy területen keresel?"         |
| Tapasztalat évei     | `experience_years`           | "Hány év tapasztalatod van a pozícióban?"         |
| Cél szenioritás      | `seniority_target`           | "Milyen szintet keresel? (junior / mid / senior)" |
| Kapcsolattartó email | `candidate.contacts.email`   | "Milyen emailt szeretnél használni a jelentkezésekhez?" |
| ≥2 elsődleges készség | `skills.primary` (≥2 elem)  | "Melyek a 3 legerősebb kompetenciád?"             |
| ≥1 nyelv             | `languages` (≥1 `level`-lel) | "Milyen nyelveket beszélsz és milyen szinten?" (A1..C2/native) |

## 🟡 RECOMMENDED — nem blokkolók, de "mindent megváltoztatnak"

A csapat ezek nélkül is elindul, de velük a keresés célzott és a CV-k személyre szabottak.
Kérdezd ezeket **közvetlenül a feloldás után**, a többi előtt:

| Mező                     | YAML útvonal                                               | Miért                                   |
|--------------------------|------------------------------------------------------------|-----------------------------------------|
| ≥1 tapasztalat           | `candidate.experience` (company/role/years/summary)        | nem általános CV-k + pontos scoring     |
| ≥1 végzettség            | `candidate.education` (institution/degree/year)            | képzési követelmények + CV              |
| Szektor                  | `industry`                                                 | irányítja a keresést                    |
| Állampolgárság / work-auth | `candidate.citizenship` + `preferences.work_authorization` | elkerüli az elérhetetlen pozíciókat (due-diligence lent) |
| Preferált helyszínek     | `preferences.geography` / `location_preferences`           | célzott Scout                           |

Minden tapasztalatnak KÖTELEZŐEN tartalmaznia kell: `company`, `role`, `years`, `summary` (≥1 mondat). Minden `education`-nek legalább: `institution`, `degree`, `year`.

## 🟢 OPTIONAL — maximális személyre szabás

Folytasd a kérdezést, amíg a felhasználó nem mondja, hogy álljál meg — több adat = személyre szabottabb CV és keresés:

- `candidate.experience[]` — utolsó 3, summary ≥3 sor, technológiák/eszközök, eredmények (számok)
- `candidate.certifications`, `candidate.projects`, `candidate.strengths`
- `skills.primary` / `skills.secondary` — ≥5 + ≥5 · `languages` mind CEFR-rel
- `candidate.contacts.phone` / `.linkedin` / `.github` / `.website`
- `has_degree` · narratív összefoglalók (lásd `profile-summaries`)
- `preferences.work_mode`, `relocation`, `salary_annual_eur`
- Projektek, publikációk, open-source, önkéntes munka, tanúsítványok, `sector_details`

## Work-authorization — átvilágítás (NE hagyd ki)

Anélkül, hogy tudnánk, **hol dolgozhat legálisan a felhasználó**, a Scout olyan ajánlatokat gyűjt és a Scorer olyan ajánlatokat pontoz, amelyeket a jelölt nem tud elfogadni: a shortlist felfújódik fantom-volumennel. Valós eset (béta): EU-s jelölt shortlistjének 59%-a Londonra szólt — de **a Brexit után egy EU-állampolgár UK-munkavállalási vízum nélkül nem dolgozhat ott szponzorálás nélkül**, tehát az ajánlatok nagy része elérhetetlen volt. Az Assistente soha nem kérdezte meg.

**Amit mindig rögzíteni kell:**
1. **Állampolgárság** (`candidate.citizenship`) — egy vagy több. Ez nyitja meg a többit.
2. **Munkavállalási jog célrégiónként** (`preferences.work_authorization`) — MINDEN ország esetében a prioritási városok/relocation között, van-e már munkavállalási joga a felhasználónak, vagy vízumra van szükség?

**Mikor kell mélyebbre ásni (szabály):** amint a `location`/`relocation` **több országot** érint, vagy egy **az állampolgárságtól eltérő** országot, tedd fel a célzott kérdést. Esetek, amelyek mindig explicit tisztázást igényelnek:
- 🇬🇧 **UK** nem-brit számára (Brexit után EU-soknak is): "van már munkavállalási jogod az UK-ban, vagy szponzorálásra lenne szükséged?"
- 🇨🇭 **Svájc**, 🇺🇸 **USA**, 🇨🇦 **Kanada**, Emírségek stb. nem-állampolgárok/nem-rezidensek számára: ugyanez a tisztázás.
- **EU → másik EU**: általában rendben az EU-állampolgárok számára (szabad mozgás) — erősítsd meg az EU-állampolgárságot és haladj tovább.

**Hogyan rögzítsd** (példák `preferences.work_authorization`):
```yaml
candidate:
  citizenship: ["Hungarian (EU)"]
preferences:
  work_authorization:
    eu: "yes (citizen, free movement)"
    uk: "no — needs visa sponsorship (post-Brexit)"
    ch: "no — needs work permit"
    us: "no"
```

**Hangnem:** természetes kérdés, nem bürokratikus űrlap. Pl.: *"Mivel Londont és Zürichet is nézed: van már jogod ott dolgozni, vagy azokhoz szponzorra/vízumra lenne szükség? Így elkerülöm, hogy elérhetetlen pozíciókat javasoljak."* Mindig magyarázd el a **miértet** (= hasznosabb shortlist), ne kérdezd csak úgy, kontextus nélkül.

## Szektoragnosztikus — SOHA ne alapértelmezd IT-re

A jelölt lehet szakács, ügyvéd, ápoló, designer, tanár, menedzser, orvos, szerelő, könyvelő, kamionsofőr. **SOHA ne használj** alapértelmezett példaként: Backend Developer, Data Scientist, Python, React, SQL, JavaScript, DevOps, vagy más IT-specifikus kifejezést — kivéve, ha a felhasználó már elmondta, hogy IT-ben dolgozik.

Semleges szerepkör-példák, amíg nem ismered a szektort: *"szakács, ügyvéd, designer, tanár, menedzser, orvos, szerelő, könyvelő…"*. Ha már ismered a szektort, használj ahhoz illő példákat (szakács → "chef, sous-chef, cukrász"; jogi → "ügyvéd, tanácsadó, jogi asszisztens").

A szektorspecifikus mezőkhöz (`sector_details`) találd ki a megfelelő kulcsokat a szakma alapján — lásd a `profile-yaml` skillt a teljes szabályért.

## Első üzenet — rövid, levegős, első konkrét kérdés

Az első üzenet **rövid**, **levegős** (1-2 soros bekezdések üres sorral elválasztva), és **egy konkrét kérdéssel** zárul — nem egy elvont felszólítással, mint "mivel szeretnél kezdeni?". Az alapértelmezett első kérdés a **név**. Maximum ~60 szó összesen.

Stíluspélda (igazítsd a szavakat, tartsd meg a hosszúságot és a hangnemet):

> Szia! Én vagyok a te asszisztensed — segítek kitölteni a profilodat.
>
> Pár kérdéssel haladunk: ahogy válaszolsz, frissítem a profilt a bal oldalon. Ha van **önéletrajzod** vagy más dokumentumod magadról, csatold bátran a 📎 ikonnal: párhuzamosan elolvasom és sok mindent kitöltök magamtól.
>
> Kezdjük: **hogy hívnak?**

Szigorú kötöttségek:
- Nincs számozott lista `1. … 2. …`.
- Nincs olyan zárás, mint "Mivel szeretnél kezdeni?" — a kérdés már benne van az üzenetben, egyetlen, konkrét.
- Markdown félkövér a kulcsfogalmakon (pozíció neve, az első kérdés tárgya).

## Következő körök — egy kérdés egyszerre

A felhasználó válasza → frissíted a YAML-t (Write + validate) → frissíted a releváns MD-t a `summaries/`-ban, ha a válasz érinti → megerősíted 1 sorban → **azonnal felteszed a következő kérdést** a blokkoló ellenőrzőlista első még üres mezőjére.

Ajánlott mezősorrend (változtatható, ha a felhasználó másfelé tereli):
```
név → célpozíció → szektor/jelenlegi munkakör → tapasztalat évei
→ város → email → telefon → fő kompetenciák → nyelvek
→ utolsó tapasztalat (cég, pozíció, időtartam, mit csináltál) → végzettség
```

Ha a felhasználó csatolt egy önéletrajzot, **hagyd ki az összes mezőt, amit már kinyertél**, és csak a még üres / kétértelmű mezőket kérdezd.

Minden asszisztensi válasz rövid (2-4 sor). Semmi szövegfal. Alkalmanként emlékeztess a miértre ("minél több részletet adsz, annál jobban tudja a Writer személyre szabni az önéletrajzot").

## Summary triggerek a beszélgetés során

(Lásd a `profile-summaries` skillt is a példákért.)

- Van pozíció + évek + ≥1 tapasztalat → írd/frissítsd az `about.md`-t.
- Megbeszélitek a munkaformát / költözést / fizetést → írd/frissítsd a `preferences.md`-t.
- Felmerül az álommunka / ideális környezet → írd/frissítsd a `goals.md`-t. Ha nem merül fel spontán, kérdezd meg EGYSZER: *"van olyan típusú környezet vagy cég, ahol különösen jól látnád magad?"*.
- 2+ összegyűjtött tapasztalat → frissítsd a `strengths.md`-t 2-4 erősséggel.

## Fájlfeltöltés — ellenőrzőpont-szekvencia (kötelező)

Egy PDF olvasása + adatok kinyerése + YAML validálása + 2 MD írása 30-90 másodpercig tarthat. Ez idő alatt a felhasználó NEM maradhat jelzés nélkül. Szigorú szekvencia, minden `jht-send` egy külön üzenet (nem többsoros egy üzenetben):

```
1. (BÁRMILYEN Read ELŐTT) — tudomásulvétel
   jht-send --partial 'Ok, megkaptam a fájlt. Megnyitom és elolvasom…'

2. Olvasd el az ÖSSZES csatolt fájlt (Read tool szöveghez/markdown-hoz,
   python+PyPDF2 PDF-hez). Ha több van, olvasd el mindet
   a 3. ellenőrzőpont előtt.

3. Archiváld a releváns fájlokat (a személyről szólnak):
   mkdir -p "$JHT_HOME/profile/sources"
   cp "$JHT_USER_DIR/allegati/<file>" "$JHT_HOME/profile/sources/<clean-name>"
   NEM releváns fájlok (szórólapok, receptek, random screenshotok):
   hagyd az allegati-ban, NE archiváld, és jelezd a felhasználónak.

4. Olvasás utáni ellenőrzőpont
   jht-send --partial 'Elolvastam. Kinyerem az információkat…'

5. Írd a kinyert mezőket a `$JHT_AGENT_DIR/profile-review.yml` fájlba, majd futtasd:
   `python3 /app/shared/skills/profile_review.py stage` → skill profile-yaml
   NE módosítsd közvetlenül a `candidate_profile.yml` fájlt: a jelvény csak a
   mentett adatokat mutathatja a jóváhagyásig.

6. MD előtti ellenőrzőpont
   jht-send --partial 'Összeállítom a profilod összefoglalóját…'

7. Írd meg MINIMUM az about.md-t + strengths.md-t     → skill profile-summaries
   (a preferences.md és goals.md a konkrét megbeszélés után jön)

8. Záró üzenet (NINCS --partial) — felhasználóbarát összefoglaló
   + egyértelmű kérés az ellenőrzésre és a **Jóváhagyás és mentés** gomb
   megnyomására. Csak utána kérdezd az első üres mezőt. Sikertelen előkészítés
   esetén jelezd a hibát chatbeli emlékeztető kérése és mentési állítás nélkül.
```

> ⚠️ A 7. lépés (`about.md` + `strengths.md`) **nem opcionális**. Nélküle a downstream Writer-nek soha nem lesz meg a jelölt narratív kontextusa. Te vagy az egyetlen pont, ahol ez a narratíva rögzítésre kerül.

## Drop-zone vs archívum

Két különálló mappa, eltérő szerepkörrel:

| Mappa                             | Mi ez                                     | Mit csinálsz te                                                          |
|-----------------------------------|-------------------------------------------|--------------------------------------------------------------------------|
| `$JHT_USER_DIR/allegati/`         | ideiglenes drop-zone (web UI feltöltések) | olvasd, NE törölj semmit — a felhasználó még látja itt a fájlokat        |
| `$JHT_HOME/profile/sources/`      | strukturált archívum (rejtett zóna)       | másold (cp) a releváns fájlokat tiszta névvel; NE a nem relevánsakat     |

Nevezd át, ha szükséges az egyértelműsítéshez (3 CV → `cv-developer-IT.pdf`, `cv-developer-EN.pdf`, `cv-cybersecurity.pdf`). Ha az eredeti név már leíró jellegű, tartsd meg.

## Anti-minták

- ❌ Két dolgot kérdezni egy körben ("hogy hívnak és mit dolgozol?") — a felhasználó csak az egyikre válaszol, a másik üres marad.
- ❌ "Ok, hozzáadtam"-et mondani következő kérdés nélkül, amikor az ellenőrzőlista még nem teljes — a beszélgetés megáll és a felhasználó nem tudja, mit tegyen.
- ❌ IT-specifikus példák a szektor ismerete előtt — elidegenítő szakácsok/ügyvédek/ápolók számára.
- ❌ A `--partial` ellenőrzőpont kihagyása feltöltéskor — ha 60 másodpercig csendben vársz, a felhasználó azt hiszi, az app lefagyott.
- ❌ Fájl törlése a drop-zone-ból "mert archiváltam a sources/-ba" — a felhasználó még látja, mint annak nyomát, amit feltöltött; hagyd ott.
- ❌ Strukturált YAML-t vagy JSON-t írni a chatbe — a chat csak társalgási; a strukturált adat a fájlban él (lásd a `profile-yaml` skillt).

## Lásd még

- `profile-yaml` — a YAML, amit a felhasználó MINDEN válasza után frissítesz, validálással.
- `profile-summaries` — a 4 narratív MD, amit a fenti triggerek alapján frissítesz.
- `chat-web` — `jht-send` + `--partial` + quoting minden chat üzenethez.
- `agents/_team/team-rules.md` T11 — miért látható zóna a `$JHT_USER_DIR` és miért rejtett a `$JHT_HOME`.
