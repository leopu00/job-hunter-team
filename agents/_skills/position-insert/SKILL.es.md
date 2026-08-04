<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: position-insert
description: "La secuencia de 5 puertas que el Scout ejecuta para CADA posición candidata antes de INSERTAR en `positions`: dedup → verificación de enlace → fetch de JD → filtros permisivos → INSERT. Saltarse cualquier puerta llena la DB con duplicados, enlaces muertos, o filas fuera de alcance que el Analyst luego tiene que descartar — presupuesto Sonnet desperdiciado downstream. Propiedad del rol Scout; combinar con `circles-and-sources` (decide DÓNDE buscar) y `scout-coord` (decide QUIÉN busca dónde)."
allowed-tools: Bash(curl *), Bash(python3 *), Bash(grep *)
---

# position-insert — 5 puertas por posición

Una posición vale insertarla solo si las cinco puertas pasan. El orden importa: las verificaciones más baratas vienen primero para que las caras (fetch completo de JD + filtrado) se ejecuten solo en candidatos viables.

## Puerta 1 — Dedup (barata, obligatoria primero)

```bash
python3 /app/shared/skills/db_query.py check-url <linkedin_id_or_url>
```

- Salida `TROVATA` → **SKIP** (ya en DB, posiblemente diferente estado — nunca re-insertar).
- Salida `NON TROVATA` → proceder a la Puerta 2.

La clave de dedup es la URL canónica (o LinkedIn job ID para LinkedIn). Si la misma publicación viene de dos fuentes diferentes (ej. página de carreras de la empresa Y un cross-listing en LinkedIn), `check-url` deduplica.

## Puerta 2 — Verificación de enlace (HTTP + URL)

`curl` en dos pasos para detectar publicaciones muertas Y redirecciones silenciosas a una página genérica `/careers` (= trabajo eliminado pero la página devuelve 200).

### Paso 2a — código de estado + URL final

```bash
curl -s -o /dev/null -w "HTTP:%{http_code} URL_FINALE:%{url_effective}" \
  -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' '<URL>'
```

| Resultado                                     | Acción                                         |
|-----------------------------------------------|------------------------------------------------|
| `HTTP:404` / `HTTP:410`                       | SKIP (enlace muerto)                           |
| `HTTP:301/302` a un genérico `/careers` o `/jobs` | SKIP (posición eliminada, redirección genérica) |
| `HTTP:200/301/302` URL final = página de publicación | proceder al Paso 2b                      |

### Paso 2b — señales de contenido

```bash
curl -s -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' '<URL>' \
  | grep -i 'no longer accepting\|closed-job\|position has been filled\|expired\|job not found'
```

- Coincidencia → SKIP (trabajo cerrado)
- Sin coincidencia → proceder a la Puerta 3

### Nota sobre Workable

Para ATS alojados en Workable: hay **dos** URLs por publicación. Usa la correcta:
- `apply.workable.com/...` → formulario de aplicación: devuelve `302` cuando el trabajo está cerrado (parece enlace muerto, falso positivo).
- `jobs.workable.com/...` → página canónica del JD: HTTP 200 + JSON-LD válido si la posición está viva.

Siempre verificar la página **canónica** (`jobs.workable.com`), no el formulario de aplicación. Mismo principio para Greenhouse, Lever, Ashby.

## Puerta 3 — Obtener el JD COMPLETO

El contrato de la DB requiere que `--jd-text` y `--requirements` sean COMPLETOS — scrapes parciales rompen al Analyst downstream.

```bash
# nivel 1 — curl con UA de navegador (la mayoría de casos)
curl -s -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' '<URL>' > $JHT_AGENT_DIR/tmp/jd-raw.html

# nivel 2 — páginas con mucho JS (Wellfound, algunos careers custom): usar playwright MCP
# nivel 3 — respaldo: WebFetch / WebSearch
```

Extraer el **cuerpo de texto completo** (no solo el título) y la **sección de requisitos** (habilidades, años de experiencia, idiomas). Si la página tiene una sección clara "Requirements" / "Must have" / "What you'll bring", scrapeala textualmente en `--requirements`.

Sitios bloqueados (NO usar `fetch` MCP, bloqueado por robots.txt):
- `linkedin.com` → usar `linkedin_check.py` (autenticado) o `curl` con UA de navegador
- `wellfound.com` → usar `playwright` o `curl`

## Puerta 4 — Filtros permisivos a nivel de Scout

Aplicar SOLO los cuatro filtros totalmente-fuera-de-alcance (tabla completa en skill `circles-and-sources`). Saltar si:

- El título contiene explícitamente: `senior`, `lead`, `staff`, `principal`, `head of`, `director`
- Incompatibilidad geográfica de work-auth (`US-only` / `Canada-only` y el candidato no tiene visado)
- Dominio completamente fuera de IT/coding (y el candidato está en IT)
- Requisito duro de `> real_years + 3` años de experiencia

Todo lo demás: pasar a la Puerta 5. **No hagas el trabajo del Analyst** — stacks adyacentes, casi-ajustes, brechas ligeras son todo material `checked`; el Scorer aplica la penalización de brecha.

## Puerta 5 — INSERT

```bash
python3 /app/shared/skills/db_insert.py position \
  --title "<TÍTULO>" \
  --company "<EMPRESA>" \
  --url "<URL canónica, NO formulario de apply>" \
  --location "<ubicación real del JD>" \
  --remote-type <full_remote|hybrid|on_site> \
  --source <slug fuente: linkedin|greenhouse|lever|indeed|wellfound|remoteok|...> \
  --found-by $MY_ID \
  --jd-text "<TEXTO COMPLETO DEL JD>" \
  --requirements "<stack + requisitos extraídos del JD>"
```

**Todos los flags son obligatorios** — `--jd-text` vacío o `--url` faltante significa que el Analyst no puede hacer su trabajo. El script `db_insert.py` impone valores no vacíos; si rechaza tu llamada, corrige el input — nunca evitar con SQL crudo.

## Límite de escritura de DB (T05 + rol)

El Scout escribe SOLO:
- `positions` (INSERT, nunca UPDATE excepto para el caso de recuperación de dup abajo)

NUNCA toca:
- `companies` (territorio del Analyst)
- `scores` (Scorer)
- `applications` (Scrittore)
- `position_highlights` (Analyst)
- posiciones con `status != 'new'` (ya movidas downstream, no tocar)

### Recuperación de dup (el único UPDATE permitido)

Si accidentalmente insertaste un duplicado (la Puerta 1 se equivocó, ej. una URL normalizada se coló), puedes marcar el duplicado como excluido — pero nunca DELETE:

```bash
python3 /app/shared/skills/db_update.py position <DUP_ID> --status excluded \
  --notes "DUPLICATA di #<ORIGINAL_ID>"
```

`DELETE` / `DROP` SQL está prohibido (T02 + seguridad DB). Reversiones vía notas `excluded` son auditables; eliminaciones no lo son.

## Después del INSERT — notificar a los Analysts

Después de cada lote de 3-5 inserts, hacer ping a las sesiones de Analyst con el rango de IDs. Ellos recogen `status=new` de la DB de todas formas, pero el ping acorta la latencia:

```bash
jht-tmux-send ANALISTA-1 "[@$MY_ID -> @analista-1] [INFO] Batch 5 posizioni inserite (IDs: X-Y)"
```

Si tienes 2 Analysts, alterna el objetivo del ping para balancear carga (los Analysts también tienen coordinación de reclamación `last_checked` así que nunca está mal, pero la notificación tmux ayuda a la responsividad).

## Anti-patrones

- ❌ Saltarse la Puerta 1 "porque parecía nuevo" — `check-url` es barato, siempre ejecutarlo.
- ❌ Insertar con `--jd-text` vacío "lo llenaré después" — no hay después, el Analyst lo procesa inmediatamente.
- ❌ Verificar con `curl` sin `-L` — un 302 a un `/careers` genérico parece vivo sin follow-redirect; insertarías un JD muerto.
- ❌ Verificar el formulario de apply en Workable en lugar de la página canónica del JD — falsos positivos de enlaces muertos.
- ❌ Usar `fetch` MCP en `linkedin.com` / `wellfound.com` — bloqueado, obtienes un banner 403 en lugar del JD.
- ❌ Evitar el wrapper con `python3 -c "import sqlite3; INSERT ..."` — rompe invariantes de dedup y tracking de `found-by`, y ahora la DB también lo rechaza: `positions.url` es UNIQUE. `UNIQUE constraint failed: positions.url` significa que el anuncio ya está en la DB — vuelve al Gate 1, no reintentes con una URL retocada.
- ❌ Establecer `--status` a algo diferente del `new` por defecto (el Scout nunca establece status manualmente; el wrapper lo maneja).

## Ver también

- `circles-and-sources` — qué buscar DÓNDE (esta skill es qué hacer DESPUÉS de encontrar una publicación candidata).
- `scout-coord` — partición al arranque (esta skill es por-posición, downstream de la partición).
- `db-insert` — internos del wrapper + esquema de `position`.
- `agents/_manual/anti-collision.md` — contrato más amplio de coordinación de Scout.
- `agents/scout/scout.md` — el prompt orquestador que llama esta skill en el bucle principal.
