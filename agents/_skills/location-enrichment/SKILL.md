---
name: location-enrichment
description: Standardize positions.location free-text into structured loc_*/work_*/role_family columns BEFORE marking any position as `checked`. Covers 10 special cases (Europe Remote, Italy+remote, multi-location, US-entity-in-EU). Enforces one-position-at-a-time, peer-aligned vocabulary, never-NULL work_country. Use whenever the Analyst is about to set status=checked on a position.
allowed-tools: Bash(python3 *), Bash(curl *), Bash(jq *), WebSearch
---

# location-enrichment — playbook strutturazione location + role_family

L'Analista popola **11 colonne** della tabella `positions` PRIMA di
marcare `status=checked`. Mai lasciare una position `checked` senza
location enrichment.

## Le 11 colonne da popolare

```
role_family         text   categoria semantica del ruolo
loc_city            text   città di ufficio (NULL se solo country)
loc_region          text   regione/stato (opzionale)
loc_country         text   paese fisico ufficio (NULL se solo continent)
loc_country_code    text   ISO-3166 alpha-2: IT, IE, HU, ...
loc_continent       text   Europe | Asia | Americas | Africa | Oceania
work_mode           text   onsite | hybrid | remote
work_country        text   paese contrattuale (entity che firma) — MAI NULL
work_country_code   text   ISO-2 del work_country
is_multi_location   bool   true se JD elenca più città/paesi
location_notes      text   note libere analista
```

## REGOLE comportamentali (CRITICHE — sim 1-2 ha trovato problemi qui)

### R1 — Una posizione alla volta (NO BATCH)

Processa il tuo range una posizione per turno: leggi JD → ragiona →
db-update → status=checked → prossima. NIENTE caricare 20+ JD in un
unico turno LLM. Eccezione: 3-5 casi banali senza web search (es.
"Dublin, Ireland" + hybrid).

**Perché**: batch da 17k+ tokens (sim 1) genera responses generiche
("multi-location + remote + EU") invece di dati specifici per ogni
record. E gli altri analisti girano a vuoto durante il tuo mega-turn.

### R2 — Peer DB lookup tassonomia (ogni 5-10 record)

PRIMA di scegliere un valore `role_family`, controlla cosa hanno usato
i colleghi:

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n FROM positions
   WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

Se trovi una family **semanticamente equivalente**, ALLINEATI al loro
nome. Esempi sbagliati visti in sim 1:

```
✗ "Translation / Localization" vs "Localization / Language Quality"
  vs "Language / Localization"           → uno solo
✗ "Customer Support" vs "Customer Success / Technical"
  vs "Technical Support"                 → uno solo
✗ "Technical Engineering" per un Technical Writer  → wrong
```

Se la posizione è davvero una nuova categoria, annota in
`location_notes` perché.

### R3 — Fallback work_country (MAI NULL su checked)

Se dopo 2 tentativi di web search non trovi `work_country` con
certezza, NON lasciarlo NULL. Procedi:

1. Paese del **posting board** (es. linkedin.it → IT) + nota
   `"work_country inferred from posting board (low confidence)"`
2. Paese citato in JD come "region" / "office" anche se non sede legale
3. Ultima istanza: il `loc_continent` come placeholder + nota
   `"work_country=Europe placeholder, entity unverified"`

## Standard di scrittura

| Sì ✓ | No ✗ |
|---|---|
| `Italy` | `Italia`, `IT`, `Italie` |
| `United Kingdom` | `UK`, `Great Britain`, `England` |
| `Czechia` | `Czech Republic` |
| `Netherlands` | `Holland`, `The Netherlands` |
| `Székesfehérvár` | `Szekesfehervar` (preserva sempre i diacritici) |
| ISO-2 `IT, IE, HU, NL, DE, GB, US, ES` | ISO-3, lowercase |

## Casi speciali (decisione standard)

### A — "Europe Remote" / "EMEA - Flexible" / "Remote"

```
loc_city          = NULL
loc_country       = NULL          # niente paese fisico vincolato
loc_continent     = "Europe"      # solo se area è esplicita
work_mode         = "remote"
work_country      = <web search HQ azienda → fallback R3>
is_multi_location = false
location_notes    = "Remote within EU"
```

### B — "Italy" / "Spain" + full_remote (paese + remote)

```
loc_country       = "Italy"
loc_country_code  = "IT"
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Italy"       # stesso paese, contratto IT
work_country_code = "IT"
```

### C — "Dublin, Ireland" + hybrid (city+country pulito)

```
loc_city          = "Dublin"
loc_region        = "Leinster"    # opzionale
loc_country       = "Ireland"
loc_country_code  = "IE"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Ireland"
work_country_code = "IE"
```

### D — Multi-location stesso paese ("Barcelona / Malaga")

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

### E — Multi-country ("Amsterdam, Berlin, London, Remote-Europe")

```
loc_city          = NULL
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "hybrid"      # o remote
work_country      = <HQ azienda via web>
is_multi_location = true
location_notes    = "EU multi-country: NL, DE, GB + remote option"
```

### F — Area metropolitana vaga ("Greater Bologna Metropolitan Area")

```
loc_city          = "Bologna"     # promuovi alla città principale
loc_country       = "Italy"
location_notes    = "Area metropolitana Bologna (raggio ~30km)"
```

### G — Azienda US con entity EU che assume in Spagna

```
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Spain"       # entity locale che firma
location_notes    = "US company (X Inc.), assume tramite entity ES"
```

### H — JD precisa città che lo scout aveva generalizzato

Scout aveva scritto "Italy" → JD nel testo specifica "Milano HQ":
**promuovi a città**.

```
loc_city          = "Milan"
loc_country       = "Italy"
location_notes    = "JD specifica HQ Milano (scout aveva 'Italy')"
```

### I — City abbreviata ("Dublin 2")

```
loc_city          = "Dublin"
loc_region        = "Dublin 2"    # distretto in region
```

### J — Azienda solo job board (Railsware, Top Remote Talent, ecc.)

Quando l'azienda è una società distribuita senza HQ chiaro:
applica fallback R3 (paese del posting board) + annota.

## Vietati assoluti

- ❌ `loc_country = "Europe"` o `"EMEA"` — è continent, non country
- ❌ Mappare "EMEA" come "Europe" senza controllo (include Middle East + Africa)
- ❌ `work_country = NULL` su una position `checked` (rompe UI stipendio)
- ❌ Inventare role_family se i colleghi hanno già usato simili → vedi R2
- ❌ Caricare il batch intero del proprio range → vedi R1

## Comandi tipo

### Salvataggio struttura location completa

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

### Peer lookup tassonomia (eseguilo ogni 5-10 record)

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n
   FROM positions WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

### Promozione a checked (SOLO dopo enrichment completo)

```bash
python3 /app/shared/skills/db_update.py position <ID> --status checked \
  --notes "ESPERIENZA: ... \\n LINGUA: ... \\n SENIORITY: ..."
```

## Riferimenti

- `docs/internal/2026-05-23-location-playbook.md` — versione lunga con
  appendice country→continent
- `docs/internal/2026-05-23-sim-1-location-enrichment-report.md` —
  anti-pattern e findings sim 1
