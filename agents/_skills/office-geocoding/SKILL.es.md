<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: office-geocoding
description: Geocodificar el edificio de oficina preciso (lat/lon/dirección) para una posición DESPUÉS de que location-enrichment haya poblado loc_city/loc_country. Usar búsqueda web agresivamente (3+ intentos) para encontrar la dirección de HQ/oficina de la empresa, luego resolver coordenadas vía Nominatim/Photon. Saltar SOLO después de que la búsqueda exhaustiva falle o cuando existan múltiples oficinas ambiguas. Establece office_lat, office_lon, office_address, office_geocoded, office_verified.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch, WebFetch
---

# office-geocoding — coordenadas precisas de la oficina

Ejecutar **después** de `location-enrichment`. Prerrequisitos: `loc_city` y/o `loc_country` poblados (desde R12-15). Si la posición es full-remote sin city, skip inmediato (no hay oficina que geocodificar).

## 5 columnas a poblar

```
office_lat        numeric  latitud WGS84 (ej. 41.8933203)
office_lon        numeric  longitud WGS84 (ej. 12.4829321)
office_address    text     dirección completa de la oficina
office_geocoded   bool     true si ejecutaste geocoding
office_verified   bool     true si ESTÁS SEGURO de que es la oficina correcta;
                           false si es fallback a nivel ciudad / multi-ambiguo
```

## REGLA de oro: verificación web obligatoria

**NUNCA guardes una dirección a nivel de calle sin antes haberla verificado vía web** como oficina real de la empresa. La secuencia correcta es **búsqueda web PRIMERO, geocoding DESPUÉS** — no al revés.

### Secuencia canónica (siempre en este orden)

1. **Intento 1 — Búsqueda web HQ de la empresa en la ciudad**
   - Query: `"<Company> headquarters <city> address"`, `"<Company> sede <city>"`, `"<Company> office <city>"`, `"<Company> contact"`
   - Fuentes aceptables como prueba: sitio oficial de la empresa, LinkedIn "About", Crunchbase, registros empresariales (partitaiva.it, cerved.com para IT), resultado de Google Maps de la empresa.
   - **Extraer la dirección** de la fuente encontrada.

2. **Intento 2 — Extracción del JD**
   - Buscar patrones "Visit us at...", "Sede operativa:", "Our office", dirección en el pie de página del JD.

3. **Intento 3 — Webfetch de una fuente sospechosa**
   - Si la búsqueda web muestra título pero no snippet con dirección, `WebFetch` de la página oficial para extraer.

4. **Geocoding vía Nominatim/Photon** **SOLO después** de haber encontrado la dirección. Nominatim/Photon convierten texto→coordenadas, **no son verificación**. Sin dirección de la web → sin `office_verified=true`.

5. **Fallback a nivel ciudad** cuando todos los intentos anteriores fallan: geocodifica el **nombre de la ciudad** (ej. `"Roma, Italy"`), guarda con `office_verified=false` y `office_address = <city>, <country>`. **NUNCA dejar NULL si la posición tiene city/country del location-enrichment** — usa el fallback de ciudad.

### Cuándo saltar con TODO NULL

Solo si la posición es full-remote sin loc_city/loc_country (no hay oficina física que geocodificar). Ver sección "Cuándo SKIP" abajo.

## Cuándo poblar con `office_verified=true`

Estás **realmente seguro** de que esa dirección es la oficina correcta:

- Sitio de la empresa confirma explícitamente la sede en esa ciudad
- La publicación incluye dirección de calle + número cívico explícitamente
- LinkedIn "About" de la empresa lista esa ciudad con dirección
- Registro empresarial / cámara de comercio para empresas de Italy/EU

## Cuándo poblar con `office_verified=false`

Tienes coordenadas pero con incertidumbre:

- Encontraste la sede principal pero el JD dice "tenemos múltiples oficinas en <city>, el candidato trabaja desde una de ellas"
- Geocodificaste a nivel ciudad (centroide de la ciudad) como fallback
- La dirección es aproximada (ej. solo nombre de barrio sin calle)

## Cuándo SKIP (dejar todo NULL)

```
office_lat = NULL
office_lon = NULL
office_address = NULL
office_geocoded = false
office_verified = false
```

- Full remote: posición completamente distribuida sin city específica
- Multi-ubicación ambigua: "Roma o Milano o Torino" + work_mode=remote
- 3+ intentos fallidos, nada concreto encontrado
- Empresa extremadamente genérica (agencia/recruiter sin oficina propia para esa posición)

## Workflow de comandos

### Paso 1 — Búsqueda web HQ de la empresa

```bash
# Buscar la sede principal de la empresa en esa ciudad
# Probar 2-3 queries diferentes si la primera no aclara
```

Usa la herramienta `WebSearch` con queries tipo:
- `"<Company> headquarters <city> address"`
- `"<Company> office <city> via OR street"` (italiano: via)
- `"<Company> sede legale OR sede operativa <city>"` (italiano)
- `"<Company> contact us <city>"` (frecuentemente tiene la dirección)

Para JDs italianas en particular busca también:
- `"<Company> Roma sede"` / `"<Company> Milano via"` / etc.
- En registros como `partitaiva.it`, `easy.it`, `cerved.com`, `infoimprese.it` para empresas italianas

### Paso 2 — Geocoding vía Nominatim (rate limit 1 req/sec)

```bash
# URL-encode la query
Q=$(jq -nr --arg s "<dirección encontrada> <city>" '$s | @uri')

python3 /app/shared/skills/safe_fetch.py \
  --user-agent 'jht-analyst/1.0 (+https://github.com/leopu00/job-hunter-team)' \
  "https://nominatim.openstreetmap.org/search?q=${Q}&format=json&limit=1"
```

Respuesta JSON: `[{"lat": "...", "lon": "...", "display_name": "..."}]`.
Extraer `lat`, `lon`, `display_name` (= `office_address`).

**Rate limit**: sleep 1.2 sec entre queries Nominatim. Si 429: cambiar a Photon.

### Paso 3 — Fallback Photon (komoot, sin rate limit visible)

```bash
Q=$(jq -nr --arg s "<Company> <City>" '$s | @uri')
python3 /app/shared/skills/safe_fetch.py \
  --user-agent 'jht-analyst/1.0' \
  "https://photon.komoot.io/api?q=${Q}&limit=1"
```

GeoJSON: `features[0].geometry.coordinates = [lon, lat]` (NB orden invertido! Photon = `[lon, lat]`, Nominatim = `{"lat","lon"}`).

### Paso 4 — UPDATE Supabase vía wrapper

```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --office-lat 41.8933203 \
  --office-lon 12.4829321 \
  --office-address "Via Roma 1, 00100 Roma, Italy" \
  --office-geocoded true \
  --office-verified true \
  --action geocode --outcome updated
```

Para skip después de 3 intentos:
```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --office-geocoded false --office-verified false \
  --action geocode --outcome failed
# (lat/lon/address quedan NULL)
```

## Casos típicos resueltos

### Caso 1 — Empresa italiana con sede única clara

```
"Bending Spoons" + "Milano"
→ búsqueda web: "Bending Spoons via Nino Bonnet 10, 20154 Milano"
→ Nominatim: 45.4870, 9.1908
→ office_address = "Bending Spoons Spa, Via Nino Bonnet, Milano"
→ office_verified = TRUE
```

### Caso 2 — Multi-sede en la misma ciudad (TBD explícito)

```
"ION Group" + "Roma" → tiene 3 oficinas en Roma (Eur, Centro, Tiburtina)
→ JD no especifica cuál → office_verified = FALSE
→ Usar coordenada de la sede principal (HQ Roma)
→ office_address = "ION Trading Italy, Viale dell'Aeronautica 100, Roma"
```

### Caso 3 — JD incluye dirección en el texto

```
JD: "...vieni a trovarci in Via Tagliamento 45, Roma..."
→ Extraer directamente la dirección del jd_text
→ Geocodificar eso → office_verified = TRUE
```

### Caso 4 — Skip por ambigüedad

```
"IBM" + "Roma" + remote-eligible
→ IBM tiene 4 sedes en Roma, JD no especifica
→ office_geocoded=true, office_verified=false, coordenada sede HQ Roma
→ location_notes ya contiene "IBM Roma multi-sede"
```

### Caso 5 — Skip por full remote

```
work_mode = remote, loc_city = NULL
→ La posición no tiene oficina física → todo NULL
→ office_geocoded = false, office_verified = false
```

## Política de rate limit

- Nominatim: 1 req/sec, sleep 1.2s entre queries. Nunca más de 6 req en 10s.
- Photon: sin rate limit visible, de todas formas sleep 0.5s de cortesía.
- Búsqueda web: perezosa, solo cuando el geocoding directo falla.
- Si 429 de Nominatim: sleep 30s, cambiar a Photon, NO reintentar Nominatim durante los próximos 5 minutos.

## Prohibidos

- ❌ Inventar coordenadas plausibles sin verificación web
- ❌ Poner `office_verified=true` si usaste centroide de ciudad
- ❌ Renunciar después de UN solo intento vacío en Nominatim
- ❌ Geocodificar full-remote (no hay oficina física)
- ❌ Dejar `office_geocoded=NULL` (debe ser `true` o `false` explícito)
- ❌ Guardar una dirección Nominatim "encontrada" sin antes haberla anclado a una fuente web (sitio empresa / LinkedIn / registro empresarial) → riesgo de geocodificar un nombre similar en otra ciudad
- ❌ Dejar `office_address=NULL` para posiciones que TIENEN city/country: fallback obligatorio `office_address = "<city>, <country>"` con `office_verified=false`
