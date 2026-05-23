# Location enrichment — playbook per gli analisti

Data: 2026-05-23
Stato: bozza per simulazione

## Obiettivo

Trasformare il campo grezzo `positions.location` (testo libero scritto dallo
scout o dal job board originario) in dati strutturati che permettono:

1. **Pin precisi sul globo** della dashboard (uno per posizione, non sparsi)
2. **Statistiche per paese / continente / mode** affidabili
3. **Lettura immediata** dello stipendio atteso (= paese contrattuale)
4. **Filtri** per "lavora da casa", "in ufficio", "ibrido", "Italia solo"

Lo scout estrae il dato grezzo, l'analista lo **interpreta** (anche con web
search) e popola colonne strutturate. La dashboard legge le colonne
strutturate, non il testo grezzo.

---

## Schema proposto (DDL — non ancora applicato)

```sql
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS loc_city          text,
  ADD COLUMN IF NOT EXISTS loc_region        text,
  ADD COLUMN IF NOT EXISTS loc_country       text,
  ADD COLUMN IF NOT EXISTS loc_country_code  text,   -- ISO-3166 alpha-2 ("IT","IE","HU")
  ADD COLUMN IF NOT EXISTS loc_continent     text,   -- Europe|Asia|Americas|Africa|Oceania
  ADD COLUMN IF NOT EXISTS work_mode         text,   -- onsite|hybrid|remote
  ADD COLUMN IF NOT EXISTS work_country      text,   -- paese contrattuale (sede legale/HQ)
  ADD COLUMN IF NOT EXISTS work_country_code text,
  ADD COLUMN IF NOT EXISTS is_multi_location boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS location_notes    text;   -- note libere analista (es. "5 città EU")

CREATE INDEX IF NOT EXISTS idx_positions_loc_country_code ON positions(loc_country_code);
CREATE INDEX IF NOT EXISTS idx_positions_work_mode        ON positions(work_mode);
```

**Deprecate ma non droppate** (per backward-compat UI esistente):
- `is_remote` (sempre FALSE, morta)
- `remote_type` (sostituita da `work_mode`)
- `office_*` (riempite via geocoding, non dall'analista)

L'analista popola solo le colonne `loc_*`, `work_*`, `is_multi_location`,
`location_notes`. Il geocoding di `office_lat/lon` è un job successivo che
parte da `loc_city + loc_country`.

---

## Regole di standardizzazione

### 1. Nomi paese — sempre in inglese ISO

| Sì ✓ | No ✗ |
|---|---|
| `Italy` | `Italia`, `IT`, `Italie` |
| `United Kingdom` | `UK`, `Great Britain`, `England` (se l'azienda è inglese ma anche scozzese, etc.) |
| `Czechia` | `Czech Republic`, `Cechia` |
| `Netherlands` | `Holland`, `The Netherlands` |
| `United States` | `USA`, `US`, `America` |

### 2. Country code — ISO-3166 alpha-2

`IT, IE, HU, NL, DE, GB, US, ES, PT, BE, AT, CH, PL, …`

### 3. Diacritici — preserva sempre

| Sì ✓ | No ✗ |
|---|---|
| `Székesfehérvár` | `Szekesfehervar` |
| `Pécs` | `Pecs` |
| `Łódź` | `Lodz` |
| `Brașov` | `Brasov` |

### 4. Città — usa il nome **localmente** o l'inglese se più comune

- `Milan` (forma EN) preferita a `Milano` in dataset internazionale
- `Brussels` (EN) a `Bruxelles`
- `Vienna` (EN) a `Wien`
- Città solo locali → mantieni nome locale (`Brugnera`, `Vigodarzere`, …)

### 5. Region — facoltativa, ma utile per filtri

- `Friuli-Venezia Giulia`, `Lombardy`, `North Holland`, `Bavaria`
- NON ripetere paese qui

### 6. Continent — derivato da `loc_country_code`

Mapping fisso (vedi appendice A). L'analista non deve scegliere:
basta valorizzare `loc_country_code` correttamente e il continente si
calcola al server-side. Comunque includi il valore per consistenza.

### 7. `work_mode` — enum stretto

| valore | quando |
|---|---|
| `onsite` | obbligo in ufficio tutti i giorni |
| `hybrid` | mix ufficio + home (qualunque rapporto) |
| `remote` | nessun obbligo di presenza |

In dubbio tra hybrid/onsite → `hybrid` (più conservativo per filtri).

### 8. `work_country` — paese contrattuale

**Regola d'oro**: il `work_country` è il **paese che firma il contratto e
paga lo stipendio**. È quello che determina il livello di stipendio atteso,
le tasse, e il diritto del lavoro applicabile.

- `work_country` = paese della **sede legale che assume**, non
  necessariamente quello dove vivi.
- Se la JD dice "remote in Europe da azienda US con entity europea in
  Spagna" → `work_country = Spain` (l'entity europea è chi assume).
- Se la JD dice "remote, contractor B2B con LLC americana" → `work_country =
  United States` (anche se vivi in Italia: la fattura va negli US).
- Se non riesci a determinarlo da JD + web → fallback al paese HQ del
  Company. Annota in `location_notes` "work_country inferred from HQ".

---

## Casi speciali — decisioni standard

### A. "Europe Company" / "Company" / "EMEA - Flexible"

JD vaga, niente città. Significa: lavora da dove vuoi nell'area, sede
contrattuale altrove.

```
loc_city          = NULL
loc_region        = NULL
loc_country       = NULL          # niente paese fisico vincolato
loc_country_code  = NULL
loc_continent     = "Europe"      # se l'area è esplicita (EMEA, EU, Europe)
work_mode         = "remote"
work_country      = <da web search HQ azienda o entity locale>
work_country_code = <ISO-2 di sopra>
is_multi_location = false
location_notes    = "Company within EU"
```

**Pin sul globo**: centroide del continente (Europe → ~50°N, 10°E), badge
"remote".

### B. "Italy" + full_remote

JD dice solo il paese, è remoto. Significa: lavora da casa in Italia,
azienda italiana o entity italiana, stipendio italiano.

```
loc_city          = NULL
loc_country       = "Italy"
loc_country_code  = "IT"
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Italy"
work_country_code = "IT"
is_multi_location = false
location_notes    = "Country-wide remote"
```

**Pin sul globo**: centroide Italia (~Roma).

### C. "Spain - Company" (paese + remote esplicito)

Come (B). Esattamente lo stesso pattern.

### D. "Dublin, Ireland" + hybrid

JD città + paese, ibrido. Caso "pulito".

```
loc_city          = "Dublin"
loc_region        = "Leinster"   # opzionale, se l'analista la sa
loc_country       = "Ireland"
loc_country_code  = "IE"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Ireland"
work_country_code = "IE"
is_multi_location = false
```

**Pin**: lat/lon di Dublin (geocoded separatamente nel passo office).

### E. "Barcelona / Malaga" (multi-location, stesso paese)

JD propone scelta tra città dello stesso paese. **Un solo pin**.

```
loc_city          = NULL
loc_country       = "Spain"
loc_country_code  = "ES"
loc_continent     = "Europe"
work_mode         = "hybrid"      # o quello dichiarato
work_country      = "Spain"
work_country_code = "ES"
is_multi_location = true
location_notes    = "Barcelona or Málaga (candidato sceglie)"
```

**Pin**: centroide del paese (Spain → ~Madrid).

### F. "Amsterdam, Berlin, London, Company - Europe" (multi-paese, multi-country)

JD lascia scelta tra paesi diversi. **Un solo pin sul continente**.

```
loc_city          = NULL
loc_country       = NULL
loc_country_code  = NULL
loc_continent     = "Europe"
work_mode         = "hybrid"      # o remote, dipende
work_country      = <HQ azienda dal web>
work_country_code = <ISO-2>
is_multi_location = true
location_notes    = "EU multi-country: NL, DE, GB + remote option"
```

**Pin**: centroide continente, badge "multi".

### G. "Greater Bologna Metropolitan Area" (area vaga ma identificabile)

Risolvi all'area metropolitana → città principale.

```
loc_city          = "Bologna"
loc_country       = "Italy"
loc_country_code  = "IT"
loc_continent     = "Europe"
work_mode         = <dal JD>
work_country      = "Italy"
location_notes    = "Area metropolitana Bologna (raggio ~30km)"
```

### H. Azienda USA con sede EU che assume in Spagna

JD: "Company in Europe, Spain-based entity". Azienda madre US, ma entity
che assume è SL spagnola.

```
loc_country       = NULL          # remote, nessun vincolo città
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Spain"       # entity che firma il contratto
work_country_code = "ES"
location_notes    = "US company (Anywhere Inc.), assume tramite entity ES"
```

### I. Job dice "Italy" ma JD specifica "Milano headquarters"

Lo scout ha riportato "Italy" generico, il JD nel testo specifica città.
Promuovi a città.

```
loc_city          = "Milan"
loc_country       = "Italy"
loc_country_code  = "IT"
work_mode         = <dal JD>
work_country      = "Italy"
location_notes    = "JD specifica HQ Milano (scout aveva solo 'Italy')"
```

### J. JD con città abbreviata / errata

Esempi: "Dublin 2" → `loc_city = "Dublin"`, region opzionale "Dublin 2".

---

## Pin policy sul globo (riepilogo)

| Caso | Pin | Badge |
|---|---|---|
| city precisa + onsite/hybrid | lat/lon city (geocoded) | — |
| country only + remote | centroide paese | 🏠 remote |
| continent only | centroide continente | 🌐 remote-area |
| multi-location stesso paese | centroide paese | 📍 multi |
| multi-location multi-paese | centroide continente | 🌐 multi |
| Anywhere globale | centroide mondo (atlantico) | 🌍 global |

**Regola**: mai più di un pin per posizione. Mai pin sparsi per
multi-location.

---

## Indicatore stipendio (UI)

Quando `loc_country != work_country` mostra un badge "💰 contratto
&lt;work_country&gt;" accanto alla riga. Aiuta a riconoscere casi tipo
"vivo in Italia ma stipendio londinese" senza aprire il JD.

---

## Output dell'analista (formato comando)

Estendere `db-update position` con questi flag (proposta — da implementare
in `agents/_tools/`):

```bash
db-update position --id <uuid> \
  --loc-city "Dublin" \
  --loc-region "Leinster" \
  --loc-country "Ireland" \
  --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" \
  --work-country-code "IE" \
  --is-multi-location false \
  --location-notes ""
```

Solo i flag che cambiano vanno passati. Tutti gli altri restano com'erano.

---

## Workflow analista (estensione del prompt esistente)

Sezione da inserire in `agents/analista/analista.it.md` dopo "Analisi
posizione":

```markdown
### Enrichment Location (obbligatorio)

Dopo l'analisi JD e PRIMA di marcare la posizione come `checked`:

1. Leggi `location` grezzo e `jd_text`.
2. Identifica: city, region, country, continent. Se ambiguo (vaga, EMEA,
   multi-country), segui il playbook `docs/internal/2026-05-23-location-playbook.md`.
3. Determina `work_mode` (onsite|hybrid|remote) dalla JD.
4. Determina `work_country` (paese contrattuale = chi paga). Usa web
   search se non chiaro dal JD: cerca HQ azienda + entity locali.
5. Per multi-location: imposta `is_multi_location=true` e usa pin
   centroide paese (se stesso paese) o continente (se cross-country).
6. Esegui `db-update position --id <uuid> --loc-... --work-...`.
7. Solo dopo, marca la posizione come `checked`.

Casi non risolvibili: marca `[GEO]` ed esclude. Esempi: "Tokyo only" per
candidato italiano senza relocation.
```

---

## Cosa NON deve fare l'analista

- ❌ Geocodare lat/lon (job separato del geocoder)
- ❌ Inventare città se la JD non lo permette (lascia city=NULL)
- ❌ Mettere "EU" o "Europe Company" in `loc_country` (è un continent, non
  un paese)
- ❌ Mappare "EMEA" come "Europe" senza controllo: EMEA include anche
  Middle East e Africa
- ❌ Usare `work_country` per il paese fisico di residenza del candidato

---

## Appendice A — mapping country_code → continent

Lista canonica (parziale, ~60 paesi più frequenti):

```
Europe:    IT, FR, DE, ES, PT, NL, BE, LU, IE, GB, AT, CH, DK, SE, NO,
           FI, IS, PL, CZ, SK, HU, RO, BG, GR, HR, SI, RS, BA, ME, MK,
           AL, EE, LV, LT, MT, CY, UA, MD, BY, RU
Americas:  US, CA, MX, BR, AR, CL, CO, PE, UY, EC, VE
Asia:      IN, CN, JP, KR, SG, HK, TW, ID, MY, TH, VN, PH, AE, SA, IL,
           TR, GE
Africa:    EG, MA, ZA, NG, KE
Oceania:   AU, NZ
```

Lo script di derivazione vive in `web/lib/country-continent.ts`
(file da creare, popolato da questa lista).
