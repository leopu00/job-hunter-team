---
name: scout-language-gate
description: "A países és a keresések a profil nyelvei alapján válaszd, és vesd el azt a jelöltet, akinek a hirdetése olyan nyelvet kér, amelyet a felhasználó nem beszél, MIELŐTT letöltenéd a teljes hirdetést. A `plan` egyszer, a `screen` minden jelöltre cím és kivonat alapján. Valós eset: egy portál 100 jelöltjéből 100-at nyelv miatt vetettek el a teljes letöltés után."
allowed-tools: Bash(python3 /app/shared/skills/scout_language.py *)
---
<!-- @translation: hu, ai-translated 2026-11-02 -->

# scout-language-gate — előbb a nyelv, aztán a letöltés

A nyelv az a vágás, amely a leggyakrabban azután öli meg a jelöltet, hogy a keresést, a teljes hirdetés letöltését és néha az INSERT-et már kifizették. Ez a skill kódban alkalmazza, a letöltés előtt, abból, amit a lista már mutat. Nem találgat: csak bizonyíték alapján vet el, és a profil által beszélt nyelvet, az angol hirdetést vagy a túl rövid szöveget soha nem veti el.

## 1. A keresés megtervezése

A `plan` minden országnak módot ad. `local`: a profil ott beszél egy munkanyelvet. `english_friendly`: ott gyakoriak az angol nyelvű pozíciók, és a profil beszél angolul: keress ott, a kiírt minősítőkkel (`English-speaking`, `international team`, `English required`). `english_only`: csak az angol hirdetéseket érdemes megnyitni. Semmit nem zár ki (prioritás igen, kizárás nem, SC-04): a kiírt `order`-ből indulj, és az első köröket ne az `english_only` országokra költsd. Kilistázza a `portals`-t is: az országuk nyelvén írt állásportálok, amelyeket a profil nem tud olvasni (jobs.ch, jobup, jobnet, stepstone-de...), `skip`-ek, akárcsak az EURES olyan országban, amelynek nyelvét a profil nem beszéli (`eures`): ne keresd őket (a `portal --source S --country CC` egyről válaszol, 10-es kilépés = skip). Az ATS-listákat itt soha nem zárja ki.

## 2. Minden jelölt ellenőrzése a letöltés előtt

Add a `screen`-nek a címet és, ha a forrás mutat ilyet, a kivonatot. `skip_language` (kilépés 10): ne töltsd le; a `--log` mellett már ott a sora a körök naplójában (eredmény `language`, nem megnyitott). `ok` vagy `unknown`: menj tovább a gate-eken a szokott módon. Csak a lista szövegét olvassa: a teljes letöltés után a hirdetést a Gate 4 szűrői és az Analista vizsgálja, mint eddig.

```bash
# once, before choosing countries and queries: the plan for THIS profile's languages
python3 /app/shared/skills/scout_language.py plan

# for each candidate, from what the LIST shows, BEFORE you fetch the full ad (exit 10 = drop it)
python3 /app/shared/skills/scout_language.py screen --title "<title>" --snippet "<the list's snippet, if any>" \
    --country nl --source greenhouse --log

# one job board in one country (exit 10 = it is in the language of its country and the profile cannot read it: skip it)
python3 /app/shared/skills/scout_language.py portal --source jobs.ch --country ch
```

## 3. A profil szintjétől eltérő szintet tedd a végére (soha ne dobd el)

A `screen` azt is válaszolja, hogy `"seniority": "above"` vagy `"below"`, ha a CÍM olyan szintet nevez meg (Senior, Principal, Head of, Junior, Trainee...), amely nem ennek a profilnak a szintje: a `seniority_target`-je, ennek híján a szakmai évei. Egy senior profilnál a `Senior` és a `Principal` nem ad kódot: ez a célja. Ez SORREND, nem ítélet: ugyanabban a körben előbb a `seniority` nélküli jelölteket szúrd be, utána a kóddal rendelkezőket, és emiatt soha ne dobj el egyet sem (a seniority-rést a Scorer dönti el; SC-04 szabály). Az első indításnál mindegyik, amelyet az Analistának szint miatt ki kellett zárnia, egy letöltésbe és egy INSERT-be került, és hátrébb tolta a 20. pontszámot.

## Szabályok

- Soha ne hagyj ki olyan jelöltet, akit a `screen` nem vetett el, mert kitaláltad a nyelvét: az eszköz bizonyíték alapján vet el, te nem.
- A szöveget úgy add át, ahogy a listán áll. A válasz csak kódokat tartalmaz (`required_language`, `ad_language`, `title_language`), és a hirdetésből semmi sem tárolódik.
- Ha a profil nyelvei nem olvashatók, a `screen` mindenre `unknown`-t válaszol, és semmit nem vet el.
