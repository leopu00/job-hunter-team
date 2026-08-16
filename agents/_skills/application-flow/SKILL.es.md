<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: application-flow
description: Contrato de DB + filesystem que cada Scrittore sigue cuando lleva una posición de `scored` (≥50) a `ready`/`excluded`. Tres puertas ANTES de escribir una sola línea de CV (anti-reescritura, anti-colisión, verificación de enlace), una ruta canónica para entregables, una puerta final después de la 3.ª ronda del Critic. Saltarse cualquiera de estas produce trabajo duplicado, sobrescribe la reclamación de otro Writer, o — peor — envía un CV de grado `excluded` al usuario como `ready`. Propiedad del Scrittore.
allowed-tools: Bash(python3 *), Bash(mkdir -p *), Bash(find *), Bash(test *)
---

# application-flow — reclamar, escribir, validar

El Writer toca solo dos áreas de la DB:
- `positions.status` (writing → ready | excluded)
- `applications` (INSERT + UPDATE vía UPSERT)

Todo lo demás está fuera de límites: nunca `scores`, `companies`, `position_highlights`, `positions.notes` (territorio del Analyst), `positions.applied` (solo Capitano/usuario). T09 + límite de rol del scrittore.

## Paso 1 — Obtener la siguiente posición

```bash
python3 /app/shared/skills/db_query.py next-for-scrittore
```

Prioridad: `score ≥ 70` primero, luego `50-69` descendente. El script ya ordena.

## Paso 2 — Puerta anti-reescritura (DEBE ejecutarse antes de la reclamación)

Una posición cuyo veredicto del Critic ya está establecido es FINAL — nunca re-revisar.

```bash
if python3 /app/shared/skills/db_query.py application "$ID" >/dev/null; then
  : # exit 0 → application faltante, O application sin veredicto → proceder
else
  : # exit 1 → critic_verdict ya valorizado → SKIP ABSOLUTO
  continue
fi
```

Códigos de salida:
- `0` → aún no hay application, o application sin veredicto → proceder al Paso 3.
- `1` → `critic_verdict` ya establecido → **SKIP ABSOLUTO**, el voto del Critic es final.

> ⚠️ `sqlite3` CLI NO está instalado en el contenedor. Siempre usa `db_query.py`. Nunca workarounds `python3 -c "import sqlite3 ..."` — evitan los invariantes del script.

## Paso 3 — Reclamación anti-colisión

Verificar que la posición no esté ya reclamada por otro Writer, luego reclamarla atómicamente cambiando el estado.

```bash
# Verificar estado actual
python3 /app/shared/skills/db_query.py position "$ID"

# Si el estado ya es `writing` → otro Writer la tiene, SKIP
# De lo contrario reclamar:
python3 /app/shared/skills/db_update.py position "$ID" --status writing
```

Opcional pero recomendado: anunciar la reclamación a los pares vía tmux para que ni siquiera inicien la secuencia de puertas en el mismo ID.

```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -E '^SCRITTORE-[0-9]+$' | grep -v "^${MY_SESSION}$"); do
  jht-tmux-send "$s" "[@$MY_ID -> @${s,,}] [INFO] Sto prendendo position #$ID"
done
```

Detalles del contrato anti-colisión: `agents/_manual/anti-collision.md`.

## Paso 4 — Verificación de enlace

Un JD que murió entre la Fase 2 (Analyst) y ahora NO debería consumir presupuesto del Critic. Verificación de dos niveles:

```bash
# Nivel 1 — fetch verificado con UA de navegador
python3 /app/shared/skills/safe_fetch.py "<JD-URL>" \
  | grep -i 'no longer accepting\|closed-job\|position has been filled\|expired\|job not found'
```

Si coincide → marcar como excluida y salir:
```bash
python3 /app/shared/skills/db_update.py position "$ID" --status excluded \
  --notes "ESCLUSA: [LINK_MORTO] verificato dallo Scrittore prima di scrivere"
```

Nivel 2 (solo si el Nivel 1 no es concluyente) — fetch MCP, buscar "No longer accepting" / "applications closed" en el DOM renderizado.

## Paso 5 — INSERTAR la fila de application + escribir el CV

Después de que el enlace sea válido, crear la fila de application. **Siempre vía `db_update.py application` (UPSERT)** — nunca `python3 -c "import sqlite3; INSERT INTO applications ..."` crudo.

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id "$ID" \
  --cv-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md" \
  --cv-pdf-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf" \
  --written-by "$MY_ID" --written-at now
```

> ⚠️ Nunca pases la cadena literal `'now'` como valor de timestamp a un SQL hecho a mano — se almacena como la cadena `"now"` en lugar de un timestamp ISO. El wrapper maneja `--written-at now` correctamente; el wrapper es la única ruta segura.

Luego escribe el CV (skill `cv-structure`) → genera el PDF → ejecuta `critic-loop`.

## Paso 6 — Disciplina de rutas (T11) + nombres únicos (bug #25)

Los entregables finales DEBEN vivir bajo `$JHT_USER_DIR`, NUNCA bajo `$JHT_AGENT_DIR`. **El nombre de archivo debe incluir `position_id`** para que 2+ vacantes en la misma empresa no se sobrescriban entre sí:

| Artefacto                      | Ruta                                                                                |
|--------------------------------|--------------------------------------------------------------------------------------|
| CV markdown                    | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.md`         |
| CV PDF                         | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.pdf`        |
| Carta de presentación (solo si se solicita) | `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<position_id>_<CompanySlug>.{md,pdf}` |

- `<Candidato>` = `Nome_Cognome` del perfil.
- `<position_id>` = `positions.id` (entero, monótono, único).
- `<CompanySlug>` = empresa en minúsculas, no alfanuméricos → `-`. Ej. `canonical`, `bending-spoons`.
- `<TitleSlug>` = título en minúsculas + truncado a ~30 chars. Ej. `observability`, `junior-ubuntu`.

Ejemplo para 2 vacantes de Canonical (caso del bug #25):
```
CV_MarioRossi_28_canonical_observability.pdf
CV_MarioRossi_62_canonical_junior-ubuntu.pdf
```

Antes del fix del bug #25, ambos se guardaban como `CV_MarioRossi_Canonical.pdf` → el segundo sobrescribía al primero → la DB tenía 2 filas de application apuntando al mismo archivo → corrupción silenciosa de datos visible solo cuando el usuario abría el PDF y leía contenido de la *otra* application.

Al registrar la ruta en la DB (`--cv-path`, `--cv-pdf-path`), registra la ruta `$JHT_USER_DIR/...`. Nunca una ruta bajo `$JHT_AGENT_DIR` (eso es scratch — ver workspace abajo).

## Paso 7 — Puerta final (después de que `critic-loop` alcance la ronda 3)

La skill `critic-loop` registra la puntuación de cada ronda; aquí persistes el veredicto, cambias el estado de la application y alineas el estado de la posición.

> ⚠️ **Regla de escritor único (bug #21).** `applications.status='ready'` se establece **solo aquí, por ti, después del PASS del Critic**. El Critic nunca escribe `applications.status` directamente — su única salida es `critic_verdict` + `critic_score`. Tú posees la transición final.

**`--critic-notes` ES VISIBLE PARA EL USUARIO** — se muestra bajo la tarjeta de Candidatura del candidato con el **mismo markdown que el razonamiento del Scorer**, así que escríbelo así (scorer RULE-09), nunca la línea telegráfica de abajo:
- **En el idioma del usuario** (RULE-T14 lista "critic feedback" como contenido user-locale). El archivo de review está en inglés — reformúlalo para el candidato; no lo dejes en inglés cuando el idioma del equipo no lo es.
- **Markdown que habla AL candidato**: empieza con el veredicto y cómo se movió la puntuación a lo largo de las 3 rondas *en palabras*, luego `**negrita**` en los puntos decisivos, un par de viñetas pro/contra, un emoji con moderación. Dos párrafos cortos — sin muro de texto, sin lista de palabras clave.
- **Sin jerga interna** — nunca códigos de reglas (`T10`, `RULE-*`), nombres de herramientas (`WeasyPrint`/`pandoc`/`typst`) o ids de sesión.
- Saltos de línea reales con `$'...\n...'` (un `\n` literal se imprime como texto). Constrúyelo una vez antes de la puerta:

```bash
CRITIC_NOTES=$'**PASS · 7.5/10** — estable en las tres rondas, un ajuste honesto y sólido.\n\n**Puntos fuertes**\n- ✅ <fortaleza concreta: CV vs este rol>\n- ✅ <otra fortaleza real>\n\n**A tener en cuenta**\n- ⚠️ <una carencia real, dicha con claridad>\n\n<una frase de cierre>'
# NEEDS_WORK/REJECT: misma forma, pero indica qué falta y qué lo elevaría.
```

```bash
# UPSERT final en la application — veredicto + puntuación + promoción ready/draft
# `--reviewed-by` debe establecerse al ID de sesión del ÚLTIMO Critic que generaste
# (ej. CRITICO-S3 si la ronda 3 fue la final). Sin esto, `reviewed_by`
# queda NULL — observado 95% null pre-2026-05-22 (vps1-run-postmortem #1).
LAST_CRITIC="${LAST_CRITIC:-CRITICO-S3}"   # establecido por critic-loop al generar la ronda

if [[ <final_verdict> == "PASS" ]]; then
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict PASS \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$LAST_CRITIC" \
    --status ready
else
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict <NEEDS_WORK|REJECT> \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$LAST_CRITIC"
  # el estado queda en 'draft' — la application no está lista para el usuario.
fi

# Estado de la posición — automático desde la puntuación final
if [[ <final_score>_int >= 5 ]]; then
  python3 /app/shared/skills/db_update.py position "$ID" --status ready
else
  python3 /app/shared/skills/db_update.py position "$ID" --status excluded
fi
```

La promoción `applications.status='ready'` es lo que hace visible el CV en el dashboard `/ready` del usuario. Saltarla deja la fila en `'draft'` para siempre — el Capitano reporta un conteo de ready que la DB y el dashboard no coinciden.

Luego notifica al Capitano con un `[REPORT]` (skill `tmux-send`).

## Workspace — `tools/` + `tmp/`, mantenimiento al arranque (T12)

Tu `$JHT_AGENT_DIR` tiene 2 subdirectorios canónicos creados por el launcher:

| Subdir                       | Qué contiene                                                      | Tiempo de vida                          |
|------------------------------|-------------------------------------------------------------------|------------------------------------------|
| `$JHT_AGENT_DIR/tools/`      | scripts auxiliares que escribiste para ti mismo (parsers de JD puntuales, etc.) | mientras sean útiles; auditar en cada arranque |
| `$JHT_AGENT_DIR/tmp/`        | scratch: JDs descargadas, revisiones de CV entre rondas            | limpiado al arranque si tiene más de 7 días |

**Mantenimiento al arranque (PRIMER paso en tu bucle, antes del Paso 1):**

```bash
mkdir -p "$JHT_AGENT_DIR/tools" "$JHT_AGENT_DIR/tmp"
find "$JHT_AGENT_DIR/tmp" -type f -mtime +7 -delete 2>/dev/null || true
```

Repetir cada ~6h de ejecución continua o cada ~50 iteraciones del bucle principal. NO dentro de un bucle ajustado — cuesta llamadas FS.

> 🚫 **Fuera de límites:** nunca `find -delete` fuera de `$JHT_AGENT_DIR/tmp/`. Nunca limpiar `$JHT_USER_DIR` (entregables), nunca limpiar workspaces de agentes hermanos. T12.

## Reglas estrictas

- **Anti-reescritura antes de reclamar, siempre.** Saltarse el Paso 2 significa re-ejecutar el Critic en una application finalizada = tokens Opus desperdiciados y posiblemente sobrescribir un veredicto final.
- **Reclamar antes de escribir.** Un CV escrito sin reclamación arriesga que dos Writers produzcan CVs paralelos para la misma posición.
- **Ruta bajo `$JHT_USER_DIR/cv/`, nunca `$JHT_AGENT_DIR/`.** El usuario busca bajo `$JHT_USER_DIR`; CVs dispersos en workspaces de agentes son invisibles para ellos. T11.
- **Sin SQL crudo.** Siempre `db_query.py` / `db_update.py` / `db_insert.py`. Los wrappers imponen invariantes de los que depende el equipo.
- **Sin git.** Sin `git add`, sin `git commit`, sin `git push` (T02).

## Anti-patrones

- ❌ Saltarse el Paso 2 (anti-reescritura) "porque la posición parece fresca" — exit 1 significa que el Critic ya votó, nunca es invisible.
- ❌ Reclamar una posición y luego escribir el CV bajo `$JHT_AGENT_DIR/cv/` — el usuario no puede verlo; la ruta en la DB es incorrecta; violación T11.
- ❌ `python3 -c "import sqlite3; INSERT INTO applications ..."` — evita la lógica UPSERT, datos basura en la DB.
- ❌ Pasar `'now'` como cadena literal cuando no se usa el wrapper — se almacena como cadena en lugar de timestamp ISO.
- ❌ Tocar `positions.notes` (columna del Analyst) — violación del límite de rol, rompe los campos estructurados del Analyst.
- ❌ Establecer `positions.applied` desde aquí — solo el Capitano o el usuario pueden cambiar esa bandera.

## Ver también

- `cv-structure` — qué escribir entre el Paso 5 y `critic-loop`.
- `critic-loop` — la revisión de 3 rondas que produce la puntuación final para el Paso 7.
- `agents/_manual/anti-collision.md` — contrato completo de coordinación multi-Writer.
- `agents/_manual/db-schema.md` — columnas de `applications` + límites de rol.
- `agents/_team/team-rules.md` T11 (ruta de entregables) + T12 (mantenimiento de workspace).
