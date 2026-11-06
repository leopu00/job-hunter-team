---
name: scout-pass-log
description: "Mérd a kereséseidet, hogy a csapat lássa: egy forrás kimerült-e, vagy rosszul keresel. Minden forrásban végzett keresés után írd le, hány jelölt jött vissza; amikor egy jelölt kilép a gate-ekből, írd le, hol végezte. Két rövid parancs, zárt szókincs, soha nem szabad szöveg."
allowed-tools: Bash(python3 /app/shared/skills/scout_pass_log.py *)
---
<!-- @translation: hu, ai-translated 2026-11-02 -->

# scout-pass-log — mérd, mit adnak vissza a kereséseid

Kívülről senki sem tudja megmondani, hogy egy profil forrásai kimerültek-e, vagy a Scout rosszul keres: az INSERT előtt kiesett jelölt (halott link, egy szűrő, a hirdetésben látott nyelv) nem hagyott nyomot. Ez a két parancs egy-egy rövid sort hagy. Nem kerülnek semmibe, és soha nem állítják meg a munkádat.

## Mikor

- **Minden forrásban végzett keresés után** (jelöltek listája jött vissza): a `pass` parancs.
- **Amikor egy jelölt kilép a gate-ekből** (beszúrva, vagy elvetve és miért): a `candidate` parancs. Add hozzá a `--opened`-et, ha letöltötted a teljes JD-t (a drága lépés).

## Parancsok

```bash
python3 /app/shared/skills/scout_pass_log.py pass --source greenhouse --country nl --returned 25 \
    --query-kind role --query "<the query you searched>"
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome language --opened
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome inserted --opened
```

## Zárt szókincs

`--source`: ugyanaz a slug, amit az INSERT `--source`-ának adsz (`linkedin`, `greenhouse`, ...). `--country`: két betű (`nl`), vagy `multi` / `remote`. `--query-kind`: `role` · `role_language` · `broad` · `synonym` · `level` · `city` · `company` · `generic` · `other`. `--outcome`: `inserted` · `duplicate` · `dead_link` · `closed_ad` · `seniority` · `work_auth` · `domain` · `experience` · `language` · `role` · `area` · `other`.

## Szabályok

- A szabad szöveget elutasítja (kilépés 2, semmi sem íródik): soha ne írj mezőbe címet, céget, nevet vagy a profil bármely részét. A keresett lekérdezés a `--query`-be csak azért kerül, hogy hash legyen belőle; a szövege soha nem tárolódik.
- Ha elutasítja, javítsd az értéket, és hívd újra. Emiatt soha ne hagyd ki a keresést vagy a jelöltet.
- A `language` annak a jelöltnek az eredménye, akit azért vetsz el, mert a hirdetés olyan nyelvet kér, amelyet a felhasználó nem beszél, akár a listában, akár a JD-ben láttad.
- Egy hívás keresésenként és egy jelöltenként, ha tudod, ugyanabban a shell-hívásban, mint a döntő gate.
- Minden hirdetés, amelyet egy lista elolvasása után helyben elvetsz, megkapja az indokát a naplóban, soha nem a csend: a cím a profil szerepein kívül → `role`, a hely a profil területein kívül → `area`, meg a többi (`seniority`, `language`, `experience`, `domain`, `work_auth`). Sok, azonos indokú hirdetésnél NE hívj hirdetésenként: a `candidate --source S --country CC --outcome role --count 640` EGY sor, amely 640-et ér (1-től 100000-ig; soha `inserted`-del és soha `--opened`-del, az soronként egy). Az a portál, amely 403-at, belépési falat vagy 410-et ad: `pass ... --returned 0 --status closed` (410-nél `gone`, üres listánál `empty`). A jelentés `unexpl` oszlopa az, amit a portál visszaadott, és senki sem magyarázott meg: 0-ra kell érnie.
- Az a forrás, amelyik HIBÁVAL válaszol (429, 5xx, időtúllépés, hálózati hiba), nem üres lista: naplózd `pass ... --returned 0 --status blocked` formában. Ez semmit nem mond a piacról: a portál kb. 3 órát pihen (`JHT_SCOUT_BLOCKED_PAUSE_H`), majd újra megkérdezik, három blokkolt lekérdezés jó nélkül lezárja, és soha nem számít „száraznak”. Három egymás utáni `--returned 0` lekérdezésed ugyanazon a forráson `ALERT` kiírására készteti az eszközt (és értesíti a felhasználót és az Orvost): ne kérdezd újra azt a forrást, futtasd a `scout_coverage.py next` parancsot.
