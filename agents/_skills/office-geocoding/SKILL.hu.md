<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: office-geocoding
description: Az iroda épület pontos geokódolása (lat/lon/cím) egy pozícióhoz MIUTÁN a location-enrichment feltöltötte a loc_city/loc_country-t. Agresszívan használj web keresést (3+ kísérlet) a cég HQ/iroda cím megtalálásához, majd oldd fel a koordinátákat Nominatim/Photon-on. Csak kimerítő keresés sikertelensége VAGY több kétértelmű iroda esetén hagyd ki. Beállítja: office_lat, office_lon, office_address, office_geocoded, office_verified.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch, WebFetch
---

# office-geocoding — az iroda pontos koordinátái

Futtasd a `location-enrichment` **után**. Előfeltételek: `loc_city` és/vagy
`loc_country` feltöltve (R12-15-ből). Ha a pozíció full-remote
város nélkül, azonnali kihagyás (nincs geokódolható iroda).

## 5 kitöltendő oszlop

```
office_lat        numeric  WGS84 szélességi fok (pl. 41.8933203)
office_lon        numeric  WGS84 hosszúsági fok (pl. 12.4829321)
office_address    text     az iroda teljes címe
office_geocoded   bool     true ha végrehajtottad a geokódolást
office_verified   bool     true ha BIZTOS vagy, hogy ez a helyes iroda;
                           false ha város-szintű tartalék / több kétértelmű
```

## Aranyszabály: web ellenőrzés kötelező

**SOHA ne ments utca-szintű címet anélkül, hogy előbb
webes forrásból ellenőrizted volna** mint a cég valós irodája. A helyes sorrend
**web keresés ELŐSZÖR, geokódolás UTÁNA** — nem fordítva.

### Kanonikus sorrend (mindig ebben a sorrendben)

1. **1. kísérlet — Web keresés a cég HQ-ja a városban**
   - Lekérdezés: `"<Company> headquarters <city> address"`, `"<Company>
     sede <city>"`, `"<Company> office <city>"`, `"<Company> contact"`
   - Elfogadható bizonyítékforrások: a cég hivatalos oldala,
     LinkedIn "About", Crunchbase, cégregiszterek (partitaiva.it,
     cerved.com IT-hez), Google Maps eredmény a cégről.
   - **Vond ki a címet** a talált forrásból.

2. **2. kísérlet — Kinyerés a JD-ből**
   - Keress mintákat: "Visit us at...", "Sede operativa:", "Our office",
     cím a JD láblécében.

3. **3. kísérlet — Gyanús forrás Webfetch-e**
   - Ha a web keresés mutat címet, de nem a snippetben,
     `WebFetch` a hivatalos oldalra a kinyeréshez.

4. **Geokódolás Nominatim/Photon-on** **CSAK** a cím megtalálása után.
   A Nominatim/Photon szöveget koordinátákká alakít, **nem
   ellenőrzés**. Nincs web-ből származó cím → nincs
   `office_verified=true`.

5. **Város-szintű tartalék**, ha a fenti kísérletek mind sikertelenek:
   geokódold a **városnevet** (pl. `"Roma, Italy"`), mentsd
   `office_verified=false`-szal és `office_address = <city>, <country>`-val.
   **SOHA ne hagyj NULL-t, ha a pozíciónak van city/country-ja a location-
   enrichment-ből** — használd a város-tartalékot.

### Mikor hagyj ki TELJESEN NULL-lal

Csak ha a pozíció full-remote loc_city/loc_country nélkül (nincs
fizikai iroda a geokódoláshoz). Lásd a "Mikor SKIP" szekciót alább.

## Mikor tölts ki `office_verified=true`-val

**Valóban biztos** vagy, hogy az a cím a helyes iroda:

- A cég oldala kifejezetten megerősíti a székhely ebben a városban van
- A hirdetés tartalmaz utca + házszám címet explicit módon
- A cég LinkedIn "About"-ja felsorolja azt a várost címmel
- Cégregiszter / kereskedelmi kamara IT/EU cégekhez

## Mikor tölts ki `office_verified=false`-szal

Vannak koordináták, de bizonytalansággal:

- Megtaláltad a fő székhely, de a JD azt mondja "több irodánk van
  <városban>, a jelölt az egyikben dolgozik"
- Város-szintű geokódolást végeztél (város centroid) tartalékként
- A cím hozzávetőleges (pl. csak kerületnév utca nélkül)

## Mikor SKIP (hagyj mindent NULL-on)

```
office_lat = NULL
office_lon = NULL
office_address = NULL
office_geocoded = false
office_verified = false
```

- Full remote: pozíció teljesen elosztott, specifikus város nélkül
- Kétértelmű több-helyszín: "Róma vagy Milánó vagy Torino" + work_mode=remote
- 3+ kísérlet sikertelen, semmi konkrét nem találva
- Rendkívül általános cég (ügynökség/toborzó saját iroda nélkül
  arra a pozícióra)

## Munkafolyamat parancsok

### 1. lépés — Web keresés a cég HQ-jára

```bash
# Keresd a cég fő székhelyét abban a városban
# Próbálj 2-3 különböző lekérdezést, ha az első nem tisztázza
```

Használd a `WebSearch` eszközt ilyen lekérdezésekkel:
- `"<Company> headquarters <city> address"`
- `"<Company> office <city> via OR street"` (olaszul: via)
- `"<Company> sede legale OR sede operativa <city>"` (olaszul)
- `"<Company> contact us <city>"` (gyakran tartalmazza a címet)

Különösen olasz JD-khez keresd ezeket is:
- `"<Company> Roma sede"` / `"<Company> Milano via"` / stb.
- Regisztereken mint `partitaiva.it`, `easy.it`, `cerved.com`,
  `infoimprese.it` olasz cégekhez

### 2. lépés — Geokódolás Nominatim-on (1 kérés/mp rate limit)

```bash
# URL-encode-old a lekérdezést
Q=$(jq -nr --arg s "<talált cím> <city>" '$s | @uri')

python3 /app/shared/skills/safe_fetch.py \
  --user-agent 'jht-analyst/1.0 (+https://github.com/leopu00/job-hunter-team)' \
  "https://nominatim.openstreetmap.org/search?q=${Q}&format=json&limit=1"
```

JSON válasz: `[{"lat": "...", "lon": "...", "display_name": "..."}]`.
Vond ki a `lat`, `lon`, `display_name` (= `office_address`) értékeket.

**Rate limit**: 1.2 mp alvás Nominatim lekérdezések között. Ha 429: válts Photon-ra.

### 3. lépés — Tartalék Photon (komoot, nincs látható rate limit)

```bash
Q=$(jq -nr --arg s "<Company> <City>" '$s | @uri')
python3 /app/shared/skills/safe_fetch.py \
  --user-agent 'jht-analyst/1.0' \
  "https://photon.komoot.io/api?q=${Q}&limit=1"
```

GeoJSON: `features[0].geometry.coordinates = [lon, lat]` (FIGYELEM, fordított
sorrend! Photon = `[lon, lat]`, Nominatim = `{"lat","lon"}`).

### 4. lépés — UPDATE wrapperen keresztül

```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --office-lat 41.8933203 \
  --office-lon 12.4829321 \
  --office-address "Via Roma 1, 00100 Roma, Italy" \
  --office-geocoded true \
  --office-verified true \
  --action geocode --outcome updated
```

Kihagyáshoz 3 kísérlet után:
```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --office-geocoded false --office-verified false \
  --action geocode --outcome failed
# (lat/lon/address NULL marad)
```

## Tipikus megoldott esetek

### 1. eset — Olasz cég egyértelmű egyetlen székhellyel

```
"Bending Spoons" + "Milano"
→ web keresés: "Bending Spoons via Nino Bonnet 10, 20154 Milano"
→ Nominatim: 45.4870, 9.1908
→ office_address = "Bending Spoons Spa, Via Nino Bonnet, Milano"
→ office_verified = TRUE
```

### 2. eset — Több székhely ugyanabban a városban (explicit TBD)

```
"ION Group" + "Roma" → 3 iroda Rómában (Eur, Centro, Tiburtina)
→ JD nem specifikálja melyik → office_verified = FALSE
→ Használd a fő székhely koordinátáját (HQ Roma)
→ office_address = "ION Trading Italy, Viale dell'Aeronautica 100, Roma"
```

### 3. eset — JD tartalmazza a címet a szövegben

```
JD: "...vieni a trovarci in Via Tagliamento 45, Roma..."
→ Vond ki közvetlenül a címet a jd_text-ből
→ Geokódold azt → office_verified = TRUE
```

### 4. eset — Kihagyás kétértelműség miatt

```
"IBM" + "Roma" + remote-eligible
→ IBM-nek 4 székhelye van Rómában, JD nem specifikálja
→ office_geocoded=true, office_verified=false, koordináta a HQ Roma-hoz
→ location_notes már tartalmazza "IBM Roma multi-sede"
```

### 5. eset — Kihagyás full remote miatt

```
work_mode = remote, loc_city = NULL
→ A pozíciónak nincs fizikai irodája → minden NULL
→ office_geocoded = false, office_verified = false
```

## Rate limit szabályzat

- Nominatim: 1 kérés/mp, 1.2 mp alvás lekérdezések között. Soha több mint 6 kérés 10 mp alatt.
- Photon: nincs látható rate limit, de 0.5 mp udvariassági alvás.
- Web keresés: lusta, csak ha a közvetlen geokódolás sikertelen.
- Ha 429 a Nominatim-tól: 30 mp alvás, válts Photon-ra, NE próbáld újra
  a Nominatim-ot a következő 5 percben.

## Tiltottak

- ❌ Valószínű koordináták kitalálása web ellenőrzés nélkül
- ❌ `office_verified=true` beállítás, ha város-centroidot használtál
- ❌ Feladás EGYETLEN Nominatim üres találat után
- ❌ Full-remote geokódolása (nincs fizikai iroda)
- ❌ `office_geocoded=NULL` hagyás (explicit `true` vagy `false` kell)
- ❌ Nominatim-ból "talált" cím mentése anélkül, hogy először
  web forráshoz (cég oldal / LinkedIn / cégregiszter) kötötted volna
  → kockázat, hogy egy hasonló nevet geokódolsz egy másik városban
- ❌ `office_address=NULL` hagyás pozíciókhoz, amelyeknek VAN city/country-ja:
  kötelező tartalék `office_address = "<city>, <country>"` with
  `office_verified=false`
