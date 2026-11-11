---
name: scout-coverage
description: "A profil nyelveinek core nemzeti portáljait keresd MINDEN kisebb forrás ELŐTT, és tudd, a terv mekkora része kész. A `next` megmondja a portált, a naplózandó országot és a lekérdezés fajtáját; egy portál 3 menettel és 3 különböző lekérdezéssel lefedett, a «kimerült» pedig lefedett core portálokat kíván. Minden keresés elején futtasd a `next`-et."
allowed-tools: Bash(python3 /app/shared/skills/scout_coverage.py *) Bash(python3 /app/shared/skills/scout_pass_log.py *) Bash(python3 /app/shared/skills/profile_version.py *) Bash(python3 /app/shared/skills/linkedin_access.py *)
---

# scout-coverage — hol keress előbb, és mennyi van meg

Előbb ott keress, ahol a profil saját piacai vannak, és tudd, mennyi van meg belőle. Egy valós futás 105 forrást kérdezett meg egyszer-egyszer, és a felhasználó nyelvének legnagyobb nemzeti portáljait soha nem nyitotta meg: a «kimerült» minősítést érintetlen hazai piaccal mondták ki. Ez a skill adja a listát (a profil minden beszélt nyelvének nemzeti portáljai, előbb a core, aztán az English-first és a remote) és a számlálót a saját menetnaplód fölött.

## 1. Kérdezd meg, mi jön ezután, minden keresésnél

A `next` egy JSON-sort ír ki: a portált (`source`, `country`, `tier`), a lekérdezés FAJTÁJÁT (`query_kind`: `broad` = SZÉLES lekérdezés, mindig az első: a szerep családja vagy egy belépő szó magában (a `broad_terms`-ben), teljes cím és hely nélkül a kulcsszavakban; a profil földrajzi szűrője megmarad, `role_language` = a cím a portál nyelvén, `role` = a cím angolul, `synonym` = egy rokon cím, `level` = a cím a nyelv egy szintjelölő szavával, a `level_terms`-ben felsorolva, `city` = a cím egy hellyel, a `cities`-ben felsorolva), mid van (`have`) a szükségeshez (`need`) képest, és a utána használandó `log` sort. Pontosan azt keresd, majd naplózd a menetet ugyanazzal a `--query-kind`-dal. A `plan_done: true` azt jelenti: a terv kész, mehetsz a többi forráshoz. Az `avoid`, ha jelen van, olyan forrásokat sorol fel, amelyek biztosan nem működnek (megszűnt, bot-védelem, csak JavaScript által kitöltött oldal, vagy egy társ ebben a futásban halottnak találta): ne nyisd meg és ne naplózd őket.

A `next` az azonosítóddal azt is megmondja, változott-e a profil, amióta a köreidet felépítetted: `"profile": {"changed": true, "groups": [...]}`. Olvasd újra a profilt, építsd újra a megváltozott csoportok köreit, tartsd meg a pozícióidat és a keresésnaplódat, majd `profile_version.py ack`.

```bash
# the next thing to search: portal, country to log, kind of query, and the line to log it with
python3 /app/shared/skills/scout_coverage.py next

# az azonosítóddal: azt is megmondja, változott-e a profil, amióta a köreidet felépítetted (akkor olvasd újra, építsd újra a köröket, és ack)
python3 /app/shared/skills/scout_coverage.py next --agent $MY_ID
python3 /app/shared/skills/profile_version.py ack --agent $MY_ID

# the whole plan for this profile (once), and how much of it is done (any time)
python3 /app/shared/skills/scout_coverage.py plan
python3 /app/shared/skills/scout_coverage.py status

# after the search: the same portal, country and kind that `next` named
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --query-kind role_language --query "<the query you ran>" --returned 12
# a portal that answers 403 / a login wall / a challenge (closed) or 410 (gone): ONE pass closes it
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --returned 0 --status closed
```

## Szabályok

- Egy portálnak feltett ELSŐ kérdés mindig `broad`: a `broad_terms` egy szava vagy a szerep családja, MAGÁBAN. Az a portál, amely a szavakat AND-del köti, a «junior project coordinator» + város kérdésre 0-t, a «praktik»-ra több százat ad. Olvasd el AZ ÖSSZES találatot, minden oldalt, és szűrd magad a profilra. Egy portál csak `broad` menettel lefedett, a 3 különböző lekérdezés és a portál nyelvén tett mellett.
- A Platsbankennek (Svédország) nyilvános, kulcs nélküli API-ja van: `python3 /app/shared/skills/platsbanken_search.py --q "praktik" --city stockholm --no-experience --query-kind broad --log`. Egy ország cégtáblái: `python3 /app/shared/skills/scout_coverage.py boards --country se`.
- A többi országhoz a `next` (és a `plan`) megadja, ha a táblában van, az `api`-t és a `hint`-et: a nyilvános, kulcs nélküli címet, amely JSON-ban vagy nyílt adatként válaszol (Németország: Arbeitnow), és minden portál keresési címét. EZT kérdezd, ne a kezdőlapot, SZÉLES szóval, és olvasd végig az összes oldalt. FR, DE, ES, PT, NL, BE, CH és AT cégtáblái: `python3 /app/shared/skills/scout_coverage.py boards --country <cc>`.
- Egy cégtáblát (Greenhouse, Lever, Teamtailor) TELJESEN olvass el ezzel: `python3 /app/shared/skills/ats_board_search.py --provider greenhouse --board truecaller --country se --log --query-kind broad`: felismeri az országot a hely minden írásmódjában, megadja a címből olvasott senioritást, és megmondja, hány hirdetést vett ki az egyes ok (`counts`, `dropped`). Olvasd el a `dropped`-ot, mielőtt egy táblát üresnek mondasz; a `--drop-seniority senior,lead` és a `--title-any` a te döntésed, kérés nélkül semmit nem vesz ki.
- Előbb a core, aztán a kisebbek: nincs kisebb forrás, amíg a `next` core portált nevez meg.
- Egy portál LEFEDETT 3 menettel és 3 KÜLÖNBÖZŐ lekérdezéssel (egy a portál nyelvén, ha az nem angol). Ugyanaz a lekérdezés háromszor egynek számít: a fajtát válts, ne a szavakat.
- Az a portál, amelyik 403-at, 410-et, belépési falat vagy challenge-et ad, EGY `--status closed` (410-nél `gone`) menettel LEZÁRT: mondd ki, és menj tovább, ne erőltesd.
- Az `exhausted` (`scout_exhaustion.py check`) a források, lekérdezések és percek mellett a terv MINDEN portáljának lefedését kéri az elmúlt 24 órában (core és kisebb, minden ország): az `uncovered` megmondja, hová kell még menned (a `core_missing` ennek a core része). Az a forrás, amelyik kiszáradt, miközben mások nincsenek lefedve, nem száraz piac: folytasd a `next` paranccsal. Az a portál, amelyik hibával válaszolt, `blocked` (`--status blocked`): kb. 3 órát pihen, majd újra megkérdezik, és sem nem lefedett, sem nem száraz.
- A profilból soha nem írunk semmit: a napló slugokat, országkódokat, fajtákat és számokat tartalmaz.

## Földrajzi hatókör és kifejezett eredmények

A profil célhelyei és preferenciái adják a területet. A `broad` csak a szerep kulcsszavait bővíti: a földrajzi szűrő minden oldalon megmarad. A portál országa és javasolt városai nem engedélyeznek költözést. LinkedIn esetén ezt használd (QUERY a szerepcsalád; COUNTRY és KIND a `next` válaszából származik):

```bash
python3 /app/shared/skills/linkedin_access.py search --profile "$JHT_HOME/profile/candidate_profile.yml" --keywords "$QUERY" --log --country "$COUNTRY" --query-kind "$KIND" --agent "$MY_ID" --posted-within-days 7
```

A parancs naplózza a tényleges eredményt: ne naplózd újra kézzel. A 4-es kilépés és az utolsó JSON-sor `search_outcome` mezője forrás-, profil- vagy területi hibát jelez: kövesd a `status` értékét (`blocked`, `closed`, `gone`), és válts másik megfelelő forrásra a már kapott jelöltek megtartásával. A 3-as kilépés megtartja a rate limit/cooldown szabályt. Csak a sikeres üres lista `empty`. A `scope_match` helyneveket hasonlít, nem geokódoló: az `unmatched` vagy `unknown` NEM bizonyít kizárást. A teljes helyet/JD-t a profil alapján ellenőrizd, minden gate maradjon meg; bizonyítottan területen kívüli ajánlatot ne szúrj be. A `scout_search_geo_mismatch` azt jelzi, hogy egyetlen név sem egyezett: vizsgáld a forrás területét vagy válts forrást, ne nyilvánítsd üresnek a helyi piacot. Nincs kitalált földrajzi ID vagy beszélt nyelvből következtetett ország. Shell nélkül a natív lekérdezésben tartsd meg a profil területét és ellenőrizd a bizonyítékokat; a konténer parancsait ne futtasd a gazdagépen.
