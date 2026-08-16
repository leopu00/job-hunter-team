<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: location-enrichment
description: A positions.location szabad szöveg szabványosítása strukturált loc_*/work_*/role_family oszlopokba MIELŐTT bármely pozíciót `checked`-nek jelölnéd. 10 speciális esetet fed le (Europe Remote, Italy+remote, több helyszín, US-entity-in-EU). Érvényesíti az egyszerre-egy-pozíció, peer-igazított szókincs, soha-NULL work_country szabályokat. Használd, amikor az Analyst `status=checked`-et fog beállítani egy pozíción.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch
---

# location-enrichment — helyszín + role_family strukturálás playbook

Az Analista **11 oszlopot** tölt ki a `positions` táblában, MIELŐTT
`status=checked`-et jelölne. Soha ne hagyj egy `checked` pozíciót
helyszín gazdagítás nélkül.

## A 11 kitöltendő oszlop

```
role_family         text   a szerepkör szemantikai kategóriája
loc_city            text   iroda városa (NULL ha csak ország)
loc_region          text   régió/állam (opcionális)
loc_country         text   fizikai iroda országa (NULL ha csak kontinens)
loc_country_code    text   ISO-3166 alpha-2: IT, IE, HU, ...
loc_continent       text   Europe | Asia | Americas | Africa | Oceania
work_mode           text   onsite | hybrid | remote
work_country        text   szerződéses ország (aláíró entitás) — SOHA NULL
work_country_code   text   work_country ISO-2 kódja
is_multi_location   bool   true ha a JD több várost/országot sorol fel
location_notes      text   analista szabad megjegyzések
```

## Viselkedési SZABÁLYOK (KRITIKUS — sim 1-2 itt talált problémákat)

### R1 — Egy pozíció egyszerre (NEM KÖTEGELT)

Dolgozd fel a tartományodat egy pozíció per kör: olvasd a JD-t → gondolkodj →
db-update → status=checked → következő. SEMMILYEN 20+ JD betöltés egyetlen
LLM körben. Kivétel: 3-5 triviális eset web search nélkül (pl.
"Dublin, Ireland" + hybrid).

**Miért**: 17k+ tokenes köteg (sim 1) általános válaszokat generál
("multi-location + remote + EU") specifikus rekordadatok helyett.
És a többi analista üresen forog a mega-köröd alatt.

### R2 — Peer DB lookup taxonómia (minden 5-10 rekordban)

MIELŐTT `role_family` értéket választanál, ellenőrizd, mit használtak
a kollégák:

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n FROM positions
   WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

Ha találsz egy **szemantikailag egyenértékű** family-t, IGAZODJ a
nevükhöz. Hibás példák sim 1-ből:

```
✗ "Translation / Localization" vs "Localization / Language Quality"
  vs "Language / Localization"           → csak egy
✗ "Customer Support" vs "Customer Success / Technical"
  vs "Technical Support"                 → csak egy
✗ "Technical Engineering" egy Technical Writerre  → rossz
```

Ha a pozíció valóban új kategória, jegyezd fel a
`location_notes`-ban, miért.

### R3 — Tartalék work_country (SOHA NULL checked-en)

Ha 2 web search kísérlet után nem találod a `work_country`-t
biztosan, NE hagyd NULL-on. Haladj tovább:

1. A **hirdetési board** országa (pl. linkedin.it → IT) + megjegyzés
   `"work_country inferred from posting board (low confidence)"`
2. JD-ben "region" / "office"-ként említett ország, még ha nem jogi székhely is
3. Végső megoldás: a `loc_continent` mint placeholder + megjegyzés
   `"work_country=Europe placeholder, entity unverified"`

### R4 — Peer DB lookup városok (MIELŐTT `loc_city`-t írnál)

Pontosan mint R2 a `role_family`-hoz, de a **városokra**. MIELŐTT
`loc_city`-t írnál, ellenőrizd, milyen formát használtak már a kollégák
az adott országban, hogy ne hozz létre duplikátumot más nyelven
(Rome vs Roma, Milan vs Milano):

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT loc_country, loc_city, COUNT(*) AS n FROM positions
   WHERE loc_city IS NOT NULL
   GROUP BY loc_country, loc_city ORDER BY loc_country, n DESC"
```

- Ha a város **már jelen van** egy formában → IGAZODJ ahhoz
  (feltéve, hogy megfelel az "angol exonima" szabványnak, lásd lent).
- Ha egy másik nyelven lévő duplikátumot látsz már a DB-ben (pl.
  létezik `Roma` és `Rome` is), használd az **angol** formát és
  jegyezd fel a `location_notes`-ban a konszolidálandó formát.

## Írásbeli szabvány

### Országok (`loc_country` / `work_country`)

| Igen ✓ | Nem ✗ |
|---|---|
| `Italy` | `Italia`, `IT`, `Italie` |
| `United Kingdom` | `UK`, `Great Britain`, `England` |
| `Czechia` | `Czech Republic` |
| `Netherlands` | `Holland`, `The Netherlands` |
| `Székesfehérvár` | `Szekesfehervar` (mindig őrizd meg a diakritikus jeleket) |
| ISO-2 `IT, IE, HU, NL, DE, GB, US, ES` | ISO-3, kisbetűs |

### Városok (`loc_city`) — angol EXONIMA ha létezik

**Egyetlen szabály**: mindig az **angol** formát írd a városnévnél, ha
létezik bevett exonima. Ha a városnak NINCS angol exonimája, használd a
helyi nevet **a diakritikus jelek megőrzésével**. Ez igazítja az
Analista-t a Scout dedup térképéhez (`_CITY_SYNONYMS` a
`shared/skills/db_insert.py`-ban) és kiküszöböli a Rome/Roma,
Milan/Milano duplikátumokat.

| Igen ✓ (EN exonima) | Nem ✗ (helyi forma) |
|---|---|
| `Rome` | `Roma` |
| `Milan` | `Milano` |
| `Naples` | `Napoli` |
| `Turin` | `Torino` |
| `Florence` | `Firenze` |
| `Venice` | `Venezia` |
| `Genoa` | `Genova` |
| `Munich` | `München`, `Monaco di Baviera` |
| `Cologne` | `Köln` |
| `Vienna` | `Wien` |
| `Prague` | `Praha` |
| `Brussels` | `Bruxelles` |
| `Lisbon` | `Lisboa` |
| `Plzeň` (nincs exonima → helyi + diakritikus jelek) | `Plzen` |

Ha kétséged van egy bevett exonima létezéséről, alkalmazd a peer DB
lookup-ot (R4) és **igazodj a már meglévő formához** az adott városnál.

## Speciális esetek (standard döntés)

### A — "Europe Remote" / "EMEA - Flexible" / "Remote"

```
loc_city          = NULL
loc_country       = NULL          # nincs kötött fizikai ország
loc_continent     = "Europe"      # csak ha a terület explicit
work_mode         = "remote"
work_country      = <web search cég HQ → tartalék R3>
is_multi_location = false
location_notes    = "Remote within EU"
```

### B — "Italy" / "Spain" + full_remote (ország + remote)

```
loc_country       = "Italy"
loc_country_code  = "IT"
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Italy"       # ugyanaz az ország, IT szerződés
work_country_code = "IT"
```

### C — "Dublin, Ireland" + hybrid (város+ország tiszta)

```
loc_city          = "Dublin"
loc_region        = "Leinster"    # opcionális
loc_country       = "Ireland"
loc_country_code  = "IE"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Ireland"
work_country_code = "IE"
```

### D — Több helyszín ugyanabban az országban ("Barcelona / Malaga")

```
loc_city          = NULL
loc_country       = "Spain"
loc_country_code  = "ES"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Spain"
is_multi_location = true
location_notes    = "Barcelona or Málaga (candidato sceglie)"
```

### E — Több ország ("Amsterdam, Berlin, London, Remote-Europe")

```
loc_city          = NULL
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "hybrid"      # vagy remote
work_country      = <cég HQ weben>
is_multi_location = true
location_notes    = "EU multi-country: NL, DE, GB + remote option"
```

### F — Homályos nagyvárosi terület ("Greater Bologna Metropolitan Area")

```
loc_city          = "Bologna"     # léptessd a fő városra
loc_country       = "Italy"
location_notes    = "Area metropolitana Bologna (raggio ~30km)"
```

### G — US cég EU entitással, ami Spanyolországban vesz fel

```
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Spain"       # helyi aláíró entitás
location_notes    = "US company (X Inc.), assume tramite entity ES"
```

### H — JD pontosabb várost ad, mint amit a scout általánosított

A Scout "Italy"-t írt → a JD szövegében "Milano HQ" van:
**léptessd városra**.

```
loc_city          = "Milan"
loc_country       = "Italy"
location_notes    = "JD specifica HQ Milano (scout aveva 'Italy')"
```

### I — Rövidített város ("Dublin 2")

```
loc_city          = "Dublin"
loc_region        = "Dublin 2"    # kerület a region-ban
```

### J — Cég csak job boardon (Railsware, Top Remote Talent, stb.)

Ha a cég egy elosztott társaság egyértelmű HQ nélkül:
alkalmazd az R3 tartalékot (hirdetési board országa) + jegyezd fel.

## Abszolút tiltások

- ❌ `loc_country = "Europe"` vagy `"EMEA"` — az kontinens, nem ország
- ❌ "EMEA" leképezése "Europe"-ra ellenőrzés nélkül (tartalmazza a Middle East + Africa-t)
- ❌ `work_country = NULL` egy `checked` pozíción (elrontja a fizetési UI-t)
- ❌ role_family kitalálása, ha a kollégák már hasonlót használtak → lásd R2
- ❌ `loc_city` írása helyi nyelven, amikor létezik az angol exonima
  (`Roma`, `Milano`, `Napoli` → használd `Rome`, `Milan`, `Naples`)
  vagy peer DB lookup nélkül → lásd R4 + várostáblázat
- ❌ A teljes köteg betöltése a saját tartományodból → lásd R1
- ❌ **`loc_city = "Remote" / "Anywhere" / "Distributed"`** — EZEK NEM városok.
  Ha a pozíció full-remote specifikus város nélkül, `loc_city = NULL`.
  Bug észlelve sim 4-ben: A2 `loc_city='Remote'`-ot írt 8 rekordhoz
  (Canonical, Miratech, Link Group, stb.). Mindig javítsd
  `db_update --loc-city ""`-vel (üres string = NULL).

## Tipikus parancsok

### Teljes helyszín struktúra mentése

```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --loc-city "Dublin" \
  --loc-region "Leinster" \
  --loc-country "Ireland" --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" --work-country-code "IE" \
  --is-multi-location false \
  --role-family "Technical Writing" \
  --location-notes ""
```

### Peer lookup taxonómia (futtasd minden 5-10 rekordnál)

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n
   FROM positions WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

### Léptetés checked-re (CSAK teljes gazdagítás UTÁN)

```bash
python3 /app/shared/skills/db_update.py position <ID> --status checked \
  --notes "ESPERIENZA: ... \\n LINGUA: ... \\n SENIORITY: ..."
```
