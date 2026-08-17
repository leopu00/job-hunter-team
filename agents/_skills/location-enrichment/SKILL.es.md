<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: location-enrichment
description: Estandarizar el texto libre de positions.location en columnas estructuradas loc_*/work_*/role_family ANTES de marcar cualquier posición como `checked`. Cubre 10 casos especiales (Europe Remote, Italy+remote, multi-ubicación, entidad-US-en-EU). Impone una-posición-a-la-vez, vocabulario alineado entre pares, work_country nunca-NULL. Usar cada vez que el Analyst esté a punto de establecer status=checked en una posición.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch
---

# location-enrichment — playbook de estructuración location + role_family

El Analyst puebla **11 columnas** de la tabla `positions` ANTES de marcar `status=checked`. Nunca dejar una posición `checked` sin location enrichment.

## Las 11 columnas a poblar

```
role_family         text   categoría semántica del rol
loc_city            text   ciudad de oficina (NULL si solo country)
loc_region          text   región/estado (opcional)
loc_country         text   país físico de oficina (NULL si solo continent)
loc_country_code    text   ISO-3166 alpha-2: IT, IE, HU, ...
loc_continent       text   Europe | Asia | Americas | Africa | Oceania
work_mode           text   onsite | hybrid | remote
work_country        text   país contractual (entidad que firma) — NUNCA NULL
work_country_code   text   ISO-2 del work_country
is_multi_location   bool   true si el JD lista más ciudades/países
location_notes      text   notas libres del analyst
```

## REGLAS de comportamiento (CRÍTICAS — sim 1-2 encontró problemas aquí)

### R1 — Una posición a la vez (NO BATCH)

Procesa tu rango una posición por turno: lee JD → razona → db-update → status=checked → siguiente. NADA de cargar 20+ JDs en un único turno LLM. Excepción: 3-5 casos triviales sin web search (ej. "Dublin, Ireland" + hybrid).

**Por qué**: batch de 17k+ tokens (sim 1) genera respuestas genéricas ("multi-location + remote + EU") en lugar de datos específicos para cada registro. Y los otros analistas giran en vacío durante tu mega-turno.

### R2 — Lookup de taxonomía entre pares (cada 5-10 registros)

ANTES de elegir un valor `role_family`, verifica qué han usado los colegas:

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n FROM positions
   WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

Si encuentras una family **semánticamente equivalente**, ALINÉATE a su nombre. Ejemplos erróneos vistos en sim 1:

```
✗ "Translation / Localization" vs "Localization / Language Quality"
  vs "Language / Localization"           → uno solo
✗ "Customer Support" vs "Customer Success / Technical"
  vs "Technical Support"                 → uno solo
✗ "Technical Engineering" para un Technical Writer  → incorrecto
```

Si la posición es realmente una nueva categoría, anota en `location_notes` por qué.

### R3 — Fallback work_country (NUNCA NULL en checked)

Si después de 2 intentos de web search no encuentras `work_country` con certeza, NO lo dejes NULL. Procede:

1. País del **posting board** (ej. linkedin.it → IT) + nota `"work_country inferred from posting board (low confidence)"`
2. País citado en el JD como "region" / "office" aunque no sea sede legal
3. Última instancia: el `loc_continent` como placeholder + nota `"work_country=Europe placeholder, entity unverified"`

### R4 — Lookup de ciudades en la DB de pares (ANTES de escribir `loc_city`)

Exactamente como R2 para `role_family`, pero para las **ciudades**. ANTES de
escribir `loc_city`, verifica qué forma han utilizado los colegas para
ese país, para no crear un duplicado en otro idioma
(Rome vs Roma, Milan vs Milano):

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT loc_country, loc_city, COUNT(*) AS n FROM positions
   WHERE loc_city IS NOT NULL
   GROUP BY loc_country, loc_city ORDER BY loc_country, n DESC"
```

- Si la ciudad **ya está presente** en una forma → ALINÉATE a esa
  (siempre que cumpla el estándar "exónimo inglés", ver más abajo).
- Si ves un duplicado en otro idioma ya en el DB (ej. existen tanto
  `Roma` como `Rome`), usa la forma **inglesa** y anota en
  `location_notes` la forma a consolidar.

## Estándar de escritura

### Países (`loc_country` / `work_country`)

| Sí ✓ | No ✗ |
|---|---|
| `Italy` | `Italia`, `IT`, `Italie` |
| `United Kingdom` | `UK`, `Great Britain`, `England` |
| `Czechia` | `Czech Republic` |
| `Netherlands` | `Holland`, `The Netherlands` |
| `Székesfehérvár` | `Szekesfehervar` (preservar siempre los diacríticos) |
| ISO-2 `IT, IE, HU, NL, DE, GB, US, ES` | ISO-3, minúsculas |

### Ciudades (`loc_city`) — exónimo INGLÉS cuando existe

**Regla única**: escribe siempre la forma **inglesa** de la ciudad cuando
existe un exónimo consolidado. Si la ciudad NO tiene un exónimo inglés,
usa el nombre local **preservando los diacríticos**. Esto alinea
al Analyst con el mapa de dedup del Scout (`_CITY_SYNONYMS` en
`shared/skills/db_insert.py`) y elimina los duplicados Rome/Roma,
Milan/Milano.

| Sí ✓ (exónimo EN) | No ✗ (forma local) |
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
| `Plzeň` (sin exónimo → local + diacríticos) | `Plzen` |

En caso de duda sobre la existencia de un exónimo consolidado, aplica el
peer DB lookup (R4) y **alinéate a la forma ya presente** para esa
ciudad.

## Casos especiales (decisión estándar)

### A — "Europe Remote" / "EMEA - Flexible" / "Remote"

```
loc_city          = NULL
loc_country       = NULL          # ningún país físico vinculante
loc_continent     = "Europe"      # solo si el área es explícita
work_mode         = "remote"
work_country      = <web search HQ empresa → fallback R3>
is_multi_location = false
location_notes    = "Remote within EU"
```

### B — "Italy" / "Spain" + full_remote (país + remote)

```
loc_country       = "Italy"
loc_country_code  = "IT"
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Italy"       # mismo país, contrato IT
work_country_code = "IT"
```

### C — "Dublin, Ireland" + hybrid (ciudad+país limpio)

```
loc_city          = "Dublin"
loc_region        = "Leinster"    # opcional
loc_country       = "Ireland"
loc_country_code  = "IE"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Ireland"
work_country_code = "IE"
```

### D — Multi-ubicación mismo país ("Barcelona / Malaga")

```
loc_city          = NULL
loc_country       = "Spain"
loc_country_code  = "ES"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Spain"
is_multi_location = true
location_notes    = "Barcelona or Málaga (candidato elige)"
```

### E — Multi-país ("Amsterdam, Berlin, London, Remote-Europe")

```
loc_city          = NULL
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "hybrid"      # o remote
work_country      = <HQ empresa vía web>
is_multi_location = true
location_notes    = "EU multi-country: NL, DE, GB + remote option"
```

### F — Área metropolitana vaga ("Greater Bologna Metropolitan Area")

```
loc_city          = "Bologna"     # promover a la ciudad principal
loc_country       = "Italy"
location_notes    = "Área metropolitana Bologna (radio ~30km)"
```

### G — Empresa US con entidad EU que contrata en España

```
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Spain"       # entidad local que firma
location_notes    = "US company (X Inc.), contrata mediante entidad ES"
```

### H — JD precisa ciudad que el scout había generalizado

Scout había escrito "Italy" → JD en el texto especifica "Milano HQ": **promover a ciudad**.

```
loc_city          = "Milan"
loc_country       = "Italy"
location_notes    = "JD specifica HQ Milano (scout había 'Italy')"
```

### I — Ciudad abreviada ("Dublin 2")

```
loc_city          = "Dublin"
loc_region        = "Dublin 2"    # distrito en region
```

### J — Empresa solo job board (Railsware, Top Remote Talent, etc.)

Cuando la empresa es una sociedad distribuida sin HQ claro: aplica fallback R3 (país del posting board) + anota.

## Prohibidos absolutos

- ❌ `loc_country = "Europe"` o `"EMEA"` — es continent, no country
- ❌ Mapear "EMEA" como "Europe" sin verificación (incluye Middle East + Africa)
- ❌ `work_country = NULL` en una posición `checked` (rompe UI de salario)
- ❌ Inventar role_family si los colegas ya han usado similares → ver R2
- ❌ Escribir `loc_city` en idioma local cuando existe el exónimo
  inglés (`Roma`, `Milano`, `Napoli` → usar `Rome`, `Milan`, `Naples`)
  o sin peer DB lookup → ver R4 + tabla de ciudades
- ❌ Cargar el batch entero del propio rango → ver R1
- ❌ **`loc_city = "Remote" / "Anywhere" / "Distributed"`** — NO son ciudades. Si la posición es full-remote sin city específica, `loc_city = NULL`. Bug observado en sim 4: A2 escribió `loc_city='Remote'` para 8 registros (Canonical, Miratech, Link Group, etc.). Corregir siempre con `db_update --loc-city ""` (cadena vacía = NULL).

## Comandos tipo

### Guardado de estructura location completa

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

### Lookup de taxonomía entre pares (ejecutarlo cada 5-10 registros)

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n
   FROM positions WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

### Promoción a checked (SOLO después de enrichment completo)

```bash
python3 /app/shared/skills/db_update.py position <ID> --status checked \
  --notes "ESPERIENZA: ... \\n LINGUA: ... \\n SENIORITY: ..."
```
