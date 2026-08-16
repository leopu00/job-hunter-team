<!-- @translation: es, ai-translated 2026-07-18 -->
---
name: logo-extraction
description: Extrae el logo corporativo para una empresa de la tabla companies y guárdalo como un pequeño data-URI base64 (máx ~35KB, mín 32px). La vía primaria está totalmente automatizada vía logo_fetch.py contra el sitio oficial (apple-touch-icon → icon → og:image → favicon); cuando el sitio bloquea bots o no tiene iconos usables, encuentra la URL directa de una imagen del logo vía búsqueda web y pásala con --from-url. Verifica que el sitio pertenezca DE VERDAD a la empresa ANTES del fetch. Establece companies.logo, logo_source, logo_fetched.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch, WebFetch
---

# logo-extraction — logo corporativo para la página de posición

La web muestra el logo de la empresa en la página de detalle de la
posición. El logo vive en la fila `companies` (UNA por empresa: 1000
posiciones de Wizz Air = 1 logo) como data-URI base64 pequeño, y viaja
con el sync de companies existente. Sin uploads, sin storage externo.

## 3 columnas a poblar (las escribe `logo_fetch.py`, NUNCA a mano)

```
logo          text  data-URI base64 (png/jpeg/webp/ico), <= ~35KB raw
logo_source   text  URL de la que se extrajo el logo (audit/refresh)
logo_fetched  bool  true = extracción INTENTADA (aunque fallida) —
                    patrón office_geocoded: la empresa sale de la cola
                    next-for-logo-missing y no se reintenta cada ronda
```

## REGLA de oro: empresa correcta, sitio correcto

**Un logo equivocado es peor que ningún logo.** Antes de lanzar el
fetch verifica que `companies.website` pertenece DE VERDAD a la empresa
de la posición (no un homónimo, no el agregador que publicó el anuncio,
no el grupo matriz equivocado). En caso de duda: búsqueda web
`"<Company> official site"` y compara con el sector/país de la fila.

- Anuncio publicado por agencia/recruiter (Manpower, Randstad, ...) PERO
  por cuenta de un hotel/empresa nombrada → el logo es de la empresa de
  la fila `companies` vinculada a la posición, sea cual sea.
- Cadena vs propiedad (ej. "CARDO ROMA, Autograph Collection"): usa el
  logo de la marca que aparece como `companies.name`.

## Workflow

### Paso 0 — La cola

```bash
python3 /app/shared/skills/db_query.py next-for-logo-missing
```

Lista las empresas con posiciones vivas y logo nunca intentado,
ordenadas por número de posiciones (primero las más visibles). `NO
WEBSITE (cercalo prima)` = haz primero el Paso 1.

### Paso 1 — ¿Website ausente? Encuéntralo y guárdalo

```bash
# tras búsqueda web "<Company> official website":
python3 /app/shared/skills/db_update.py company "<Company>" \
  --website https://www.wizzair.com
```

### Paso 2 — Fetch automático (la vía normal)

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>"
```

El script: descarga la homepage, prueba `apple-touch-icon` → `icon`
grandes → `og:image` → `/favicon.*`, valida formato (png/jpeg/webp/ico,
NUNCA svg), peso (200B–35KB) y lado mínimo (>=32px), guarda el data-URI
y marca `logo_fetched=1`. Salida JSON en stdout. `--dry-run` para
probar sin escribir, `--force` para sustituir un logo existente.

### Paso 3 — Sitio anti-bot o sin icono usable → `--from-url`

Si el Paso 2 da `NO_CANDIDATE` (sitios como marriott.com bloquean bots):

1. Búsqueda web `"<Company> logo png"` / `"<Company> press kit logo"` /
   página de Wikipedia de la empresa (los archivos Wikimedia tienen URL
   directas).
2. Encuentra la **URL directa de la imagen** (debe terminar en .png/
   .jpg/.webp/.ico o servir la imagen raw, no una página HTML).
3. ```bash
   python3 /app/shared/skills/logo_fetch.py "<Company>" \
     --from-url "https://upload.wikimedia.org/.../Wizz_Air_logo.png"
   ```
   Se aplica la misma validación (peso/formato/dimensiones): si la
   imagen pesa demasiado busca una variante más ligera (thumbnail de
   Wikimedia: sustituye en el path `/1200px-` por `/240px-`).

### Paso 4 — Nada usable tras 3 intentos → marca y sigue

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>" --mark-attempted
```

`logo_fetched=1` con logo NULL: la web muestra el fallback de
iniciales, la empresa sale de la cola. NO insistas más de 3 intentos.

## Policy de ahorro (enrichment-policy)

El fetch autónomo respeta `$JHT_HOME/profile/enrichment-policy.json`
(compruébalo con `python3 /app/shared/skills/enrichment_policy.py show`).
Respuestas posibles de `logo_fetch.py`:

- `POLICY_DISABLED` — ahorro activo (`economy=true`) o
  `logo.enabled=false`: NO extraigas, no es un error. Sigue adelante.
- `POLICY_SCORE_GATE` — la empresa aún no tiene posiciones vivas con
  score ≥ `logo.min_score`: NO insistas. No marca `logo_fetched`:
  cuando el Scorer supere el umbral, la empresa vuelve a la cola sola.

`--force` salta la policy: úsalo SOLO a petición explícita del
usuario, nunca por tu cuenta.

## Calidad esperada

- **Prefiere** iconos cuadrados de 96–256px (apple-touch-icon es lo
  ideal).
- 32–48px (favicon) es aceptable como último recurso: el recuadro web
  es pequeño. Por debajo de 32px el script lo rechaza solo.
- El tope de 35KB es **rígido** (protege DB y sync): no lo evadas,
  busca una variante más ligera.

## Prohibido

- ❌ Logo de una empresa HOMÓNIMA o del grupo equivocado (¡verifica web!)
- ❌ Logo del agregador/job-board (LinkedIn, Indeed) en lugar de la
  empresa
- ❌ Escribir `logo`/`logo_source`/`logo_fetched` a mano con db_update:
  pasa SIEMPRE por `logo_fetch.py` (es el único que valida)
- ❌ SVG, imágenes >35KB, iconos <32px (el script los rechaza: no
  intentes evadirlo)
- ❌ Capturas de pantalla de la homepage o recortes: solo archivos-logo
  reales
- ❌ Más de 3 intentos por empresa: marca `--mark-attempted` y sigue
