<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: office-geocoding
description: Geocodifica l'edificio preciso dell'ufficio (lat/lon/indirizzo) per una posizione DOPO che location-enrichment ha popolato loc_city/loc_country. Usa la web search aggressivamente (3+ tentativi) per trovare l'indirizzo HQ/ufficio dell'azienda, poi risolvi le coordinate via Nominatim/Photon. Salta SOLO dopo che la ricerca esaustiva fallisce o quando esistono più uffici ambigui. Imposta office_lat, office_lon, office_address, office_geocoded, office_verified.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch, WebFetch
---

# office-geocoding — coordinate precise dell'ufficio

Esegui **dopo** `location-enrichment`. Prerequisiti: `loc_city` e/o
`loc_country` popolati (da R12-15). Se la position è full-remote senza
city, skip immediato (nessun ufficio da geocodificare).

## 5 colonne da popolare

```
office_lat        numeric  latitudine WGS84 (es. 41.8933203)
office_lon        numeric  longitudine WGS84 (es. 12.4829321)
office_address    text     indirizzo completo dell'ufficio
office_geocoded   bool     true se hai eseguito geocoding
office_verified   bool     true se SEI SICURO sia l'ufficio giusto;
                           false se city-level fallback / multi-ambiguo
```

## REGOLA d'oro: verifica web obbligatoria

**NON salvare mai un indirizzo street-level senza prima averlo
verificato via web** come ufficio reale della company. La sequenza
corretta è **web search PRIMA, geocoding DOPO** — non l'inverso.

### Sequenza canonica (sempre in quest'ordine)

1. **Tentativo 1 — Web search HQ company nella city**
   - Query: `"<Company> headquarters <city> address"`, `"<Company>
     sede <city>"`, `"<Company> office <city>"`, `"<Company> contact"`
   - Sorgenti accettabili come prova: sito company ufficiale,
     LinkedIn "About", Crunchbase, registri d'impresa (partitaiva.it,
     cerved.com per IT), risultato Google Maps della company.
   - **Estrai l'indirizzo** dalla sorgente trovata.

2. **Tentativo 2 — Estrazione da JD**
   - Cerca pattern "Visit us at...", "Sede operativa:", "Our office",
     indirizzo nel piè di pagina dello JD.

3. **Tentativo 3 — Webfetch di una sorgente sospetta**
   - Se la web search mostra titolo ma non snippet con indirizzo,
     `WebFetch` della pagina ufficiale per estrarre.

4. **Geocoding via Nominatim/Photon** **SOLO dopo** aver trovato
   l'indirizzo. Nominatim/Photon convertono testo→coordinate, **non
   sono verification**. Niente address da web → niente
   `office_verified=true`.

5. **Fallback city-level** quando tutti i tentativi sopra falliscono:
   geocodifica il **nome city** (es. `"Roma, Italy"`), salva con
   `office_verified=false` e `office_address = <city>, <country>`.
   **MAI lasciare NULL se la position ha city/country dal location-
   enrichment** — usa il fallback city.

### Quando skippare con TUTTO NULL

Solo se la position è full-remote senza loc_city/loc_country (niente
ufficio fisico da geocodificare). Vedi sezione "Quando SKIP" sotto.

## Quando popolare con `office_verified=true`

Sei **veramente sicuro** che quell'indirizzo è l'ufficio giusto:

- Sito company conferma esplicitamente la sede in quella city
- L'annuncio include indirizzo street + civico esplicitamente
- LinkedIn "About" della company elenca quella city con indirizzo
- Registro d'impresa / camera commercio per aziende Italy/EU

## Quando popolare con `office_verified=false`

Hai coordinate ma con incertezza:

- Hai trovato la sede principale ma il JD dice "we have multiple offices
  in <city>, candidate works from one of them"
- Hai geocodificato a livello city (centroide città) come fallback
- L'indirizzo è approssimato (es. solo nome quartiere senza street)

## Quando SKIP (lascia tutto NULL)

```
office_lat = NULL
office_lon = NULL
office_address = NULL
office_geocoded = false
office_verified = false
```

- Full remote: position completamente distribuita senza city specifica
- Multi-location ambigua: "Roma o Milano o Torino" + work_mode=remote
- 3+ tentativi falliti, niente di concreto trovato
- Company estremamente generica (agenzia/recruiter senza ufficio proprio
  per quella posizione)

## Workflow comandi

### Step 1 — Web search HQ company

```bash
# Cerca la sede principale della company in quella city
# Prova 2-3 query diverse se la prima non chiarisce
```

Usa il tool `WebSearch` con query tipo:
- `"<Company> headquarters <city> address"`
- `"<Company> office <city> via OR street"`  (italiano: via)
- `"<Company> sede legale OR sede operativa <city>"`  (italiano)
- `"<Company> contact us <city>"`  (spesso ha l'indirizzo)

Per JD italiane in particolare cerca anche:
- `"<Company> Roma sede"` / `"<Company> Milano via"` / ecc.
- Su registri come `partitaiva.it`, `easy.it`, `cerved.com`,
  `infoimprese.it` per le aziende italiane

### Step 2 — Geocoding via Nominatim (rate limit 1 req/sec)

```bash
# URL-encode la query
Q=$(jq -nr --arg s "<indirizzo trovato> <city>" '$s | @uri')

python3 /app/shared/skills/safe_fetch.py \
  --user-agent 'jht-analyst/1.0 (+https://github.com/leopu00/job-hunter-team)' \
  "https://nominatim.openstreetmap.org/search?q=${Q}&format=json&limit=1"
```

Risposta JSON: `[{"lat": "...", "lon": "...", "display_name": "..."}]`.
Estrai `lat`, `lon`, `display_name` (= `office_address`).

**Rate limit**: sleep 1.2 sec tra query Nominatim. Se 429: passa a Photon.

### Step 3 — Fallback Photon (komoot, nessun rate limit visibile)

```bash
Q=$(jq -nr --arg s "<Company> <City>" '$s | @uri')
python3 /app/shared/skills/safe_fetch.py \
  --user-agent 'jht-analyst/1.0' \
  "https://photon.komoot.io/api?q=${Q}&limit=1"
```

GeoJSON: `features[0].geometry.coordinates = [lon, lat]` (NB ordine
invertito! Photon = `[lon, lat]`, Nominatim = `{"lat","lon"}`).

### Step 4 — UPDATE Supabase via wrapper

```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --office-lat 41.8933203 \
  --office-lon 12.4829321 \
  --office-address "Via Roma 1, 00100 Roma, Italy" \
  --office-geocoded true \
  --office-verified true \
  --action geocode --outcome updated
```

Per skip dopo 3 tentativi:
```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --office-geocoded false --office-verified false \
  --action geocode --outcome failed
# (lat/lon/address restano NULL)
```

## Casi tipici risolti

### Caso 1 — Azienda italiana con sede unica chiara

```
"Bending Spoons" + "Milano"
→ web search: "Bending Spoons via Nino Bonnet 10, 20154 Milano"
→ Nominatim: 45.4870, 9.1908
→ office_address = "Bending Spoons Spa, Via Nino Bonnet, Milano"
→ office_verified = TRUE
```

### Caso 2 — Multi-sede nella stessa city (TBD esplicito)

```
"ION Group" + "Roma" → ha 3 uffici a Roma (Eur, Centro, Tiburtina)
→ JD non specifica quale → office_verified = FALSE
→ Usa coordinata della sede principale (HQ Roma)
→ office_address = "ION Trading Italy, Viale dell'Aeronautica 100, Roma"
```

### Caso 3 — JD include indirizzo nel testo

```
JD: "...vieni a trovarci in Via Tagliamento 45, Roma..."
→ Estrai direttamente l'indirizzo dal jd_text
→ Geocodifica quello → office_verified = TRUE
```

### Caso 4 — Skip per ambiguità

```
"IBM" + "Roma" + remote-eligible
→ IBM ha 4 sedi a Roma, JD non specifica
→ office_geocoded=true, office_verified=false, coordinata sede HQ Roma
→ location_notes già contiene "IBM Roma multi-sede"
```

### Caso 5 — Skip per full remote

```
work_mode = remote, loc_city = NULL
→ La position non ha ufficio fisico → tutto NULL
→ office_geocoded = false, office_verified = false
```

## Policy rate limit

- Nominatim: 1 req/sec, sleep 1.2s tra query. Mai più di 6 req in 10s.
- Photon: nessun rate limit visibile, comunque sleep 0.5s di cortesia.
- Web search: lazy, solo quando il geocoding diretto fallisce.
- Se 429 da Nominatim: sleep 30s, passa a Photon, NON ritentare
  Nominatim per i prossimi 5 minuti.

## Vietati

- ❌ Inventare coordinate plausibili senza verifica web
- ❌ Mettere `office_verified=true` se hai usato centroide città
- ❌ Rinunciare dopo UN solo tentativo Nominatim vuoto
- ❌ Geocodificare full-remote (niente ufficio fisico)
- ❌ Lasciare `office_geocoded=NULL` (deve essere `true` o `false` esplicito)
- ❌ Salvare un indirizzo Nominatim "trovato" senza prima averlo
  ancorato a una fonte web (sito company / LinkedIn / registro
  impresa) → rischio di geocodificare un nome simile in un'altra città
- ❌ Lasciare `office_address=NULL` per positions che HANNO city/country:
  fallback obbligatorio `office_address = "<city>, <country>"` con
  `office_verified=false`
