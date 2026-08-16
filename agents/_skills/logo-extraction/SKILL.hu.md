<!-- @translation: hu, ai-translated 2026-07-18 -->
---
name: logo-extraction
description: Nyerd ki a cég logóját a companies tábla egy vállalatához, és mentsd el kis base64 data-URI-ként (max ~35KB, min 32px). Az elsődleges út teljesen automatizált a logo_fetch.py-jal a hivatalos weboldal ellen (apple-touch-icon → icon → og:image → favicon); ha az oldal blokkolja a botokat vagy nincs használható ikonja, keresd meg webkereséssel egy logókép közvetlen URL-jét, és add át --from-url-lel. A fetch ELŐTT ellenőrizd, hogy a weboldal TÉNYLEG a cégé. Beállítja: companies.logo, logo_source, logo_fetched.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch, WebFetch
---

# logo-extraction — céglogó a pozícióoldalhoz

A web a cég logóját a pozíció részletoldalán mutatja. A logó a
`companies` soron él (EGY cégenként: 1000 Wizz Air-pozíció = 1 logó)
kis base64 data-URI-ként, és a meglévő companies-sync-kel utazik.
Nincs feltöltés, nincs külső tároló.

## 3 kitöltendő oszlop (a `logo_fetch.py` írja, SOHA kézzel)

```
logo          text  base64 data-URI (png/jpeg/webp/ico), <= ~35KB raw
logo_source   text  URL, ahonnan a logó származik (audit/refresh)
logo_fetched  bool  true = kinyerés MEGKÍSÉRELVE (akkor is, ha nem
                    sikerült) — office_geocoded-minta: a cég kikerül a
                    next-for-logo-missing sorból, nincs újrapróba
                    minden körben
```

## ARANYSZABÁLY: jó cég, jó weboldal

**A rossz logó rosszabb, mint a semmilyen.** A fetch előtt ellenőrizd,
hogy a `companies.website` TÉNYLEG a pozíció cégéhez tartozik (nem
névrokon, nem a hirdetést közzétevő aggregátor, nem rossz anyacég).
Kétség esetén: webkeresés `"<Company> official site"`, és vesd össze a
sor szektorával/országával.

- Ügynökség/recruiter (Manpower, Randstad, ...) által közzétett
  hirdetés, DE egy megnevezett hotel/cég nevében → a logó a pozícióhoz
  kapcsolt `companies` sor cégéé.
- Lánc vs. ház (pl. „CARDO ROMA, Autograph Collection"): azt a
  márkalogót használd, amelyik `companies.name`-ként szerepel.

## Munkafolyamat

### 0. lépés — A sor

```bash
python3 /app/shared/skills/db_query.py next-for-logo-missing
```

Az élő pozíciókkal bíró, soha meg nem kísérelt logójú cégeket listázza,
pozíciószám szerint rendezve (a leglátványosabbak elöl). `NO WEBSITE
(cercalo prima)` = előbb az 1. lépés.

### 1. lépés — Hiányzó website? Keresd meg és mentsd el

```bash
# a "<Company> official website" webkeresés után:
python3 /app/shared/skills/db_update.py company "<Company>" \
  --website https://www.wizzair.com
```

### 2. lépés — Automatikus fetch (a normál út)

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>"
```

A szkript: letölti a kezdőlapot, próbálja: `apple-touch-icon` → nagy
`icon` → `og:image` → `/favicon.*`, validálja a formátumot (png/jpeg/
webp/ico, SOHA svg), a súlyt (200B–35KB) és a minimális oldalt
(>=32px), elmenti a data-URI-t és beállítja: `logo_fetched=1`. JSON
kimenet stdout-ra. `--dry-run` írás nélküli próbához, `--force` meglévő
logó cseréjéhez.

### 3. lépés — Anti-bot oldal vagy nincs használható ikon → `--from-url`

Ha a 2. lépés `NO_CANDIDATE`-et ad (a marriott.com-hoz hasonló oldalak
blokkolják a botokat):

1. Webkeresés `"<Company> logo png"` / `"<Company> press kit logo"` /
   a cég Wikipédia-oldala (a Wikimedia-fájloknak közvetlen URL-jük van).
2. Keresd meg a **kép közvetlen URL-jét** (.png/.jpg/.webp/.ico végű
   legyen, vagy a nyers képet szolgálja ki, ne HTML-oldalt).
3. ```bash
   python3 /app/shared/skills/logo_fetch.py "<Company>" \
     --from-url "https://upload.wikimedia.org/.../Wizz_Air_logo.png"
   ```
   Ugyanaz a validálás (súly/formátum/méret) érvényes: ha a kép túl
   nehéz, keress könnyebb változatot (Wikimedia-thumbnail: a pathban
   cseréld a `/1200px-`-t `/240px-`-re).

### 4. lépés — 3 próba után semmi használható → jelöld és lépj tovább

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>" --mark-attempted
```

`logo_fetched=1`, logo NULL: a weboldal a monogram-fallbacket mutatja,
a cég kikerül a sorból. NE erőltesd 3 próbálkozáson túl.

## Takarékossági policy (enrichment-policy)

Az autonóm fetch tiszteletben tartja a
`$JHT_HOME/profile/enrichment-policy.json`-t (ellenőrizd:
`python3 /app/shared/skills/enrichment_policy.py show`).
A `logo_fetch.py` lehetséges válaszai:

- `POLICY_DISABLED` — takarékos mód aktív (`economy=true`) vagy
  `logo.enabled=false`: NE nyerd ki, nem hiba. Lépj tovább.
- `POLICY_SCORE_GATE` — a cégnek még nincs élő pozíciója
  `logo.min_score` ≥ score-ral: NE erőltesd. Nem jelöli a
  `logo_fetched`-et: amikor a Scorer átlépi a küszöböt, a cég magától
  visszakerül a sorba.

A `--force` megkerüli a policy-t: CSAK a felhasználó kifejezett
kérésére használd, soha önhatalmúlag.

## Elvárt minőség

- **Részesítsd előnyben** a 96–256px négyzetes ikonokat (az
  apple-touch-icon az ideális).
- 32–48px (favicon) végső megoldásként elfogadható: a webes négyzet
  kicsi. 32px alatt a szkript magától elutasítja.
- A 35KB-os plafon **szigorú** (a DB-t és a syncet védi): ne kerüld
  meg, keress könnyebb változatot.

## Tilos

- ❌ NÉVROKON cég vagy rossz csoport logója (webes ellenőrzés!)
- ❌ Az aggregátor/állásportál (LinkedIn, Indeed) logója a cégé helyett
- ❌ `logo`/`logo_source`/`logo_fetched` kézi írása db_update-tel:
  MINDIG a `logo_fetch.py`-on át (egyedül az validál)
- ❌ SVG, >35KB képek, <32px ikonok (a szkript elutasítja: ne próbáld
  kijátszani)
- ❌ Kezdőlap-képernyőképek vagy kivágások: csak valódi logófájlok
- ❌ Cégenként 3-nál több próbálkozás: jelöld `--mark-attempted`-del és
  tovább
