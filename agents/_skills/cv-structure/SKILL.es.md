<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: cv-structure
description: Escribir el CV en markdown que será convertido a PDF y revisado por el Critico. Seis secciones fijas, máximo 2 páginas, cada afirmación trazable a `candidate_profile.yml` (cero invenciones — T10). Las viñetas siguen el patrón "métrica en negrita + tecnología entre paréntesis"; el tono coincide con el tipo de empresa del JD (startup/corporativa/fintech); Carta de Presentación solo si el JD la solicita explícitamente. Propiedad del Scrittore. Combinar con `application-flow` (reclamación + ruta) y `critic-loop` (iteraciones de revisión).
allowed-tools: Bash(pandoc *)
---

# cv-structure — el layout canónico del CV

La salida va a `$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md` (luego PDF vía pandoc/typst). Regla de ruta: skill `application-flow` — nunca escribir el CV final bajo `$JHT_AGENT_DIR` (eso es solo scratch, T11).

`<Candidato>` = `Nome_Cognome` del perfil. `<Company>` = nombre de empresa normalizado PascalCase, sin espacios ni barras (ej. `Acme_Corp` → `AcmeCorp`).

## Las 6 secciones (orden fijo, máximo 2 páginas)

| # | Sección            | Longitud      | Contenido                                                                                        |
|---|--------------------|---------------|--------------------------------------------------------------------------------------------------|
| 1 | **Encabezado**     | 4-6 líneas    | Nombre, título de rol alineado al JD, contactos (email/teléfono/LinkedIn/GitHub), idiomas (CEFR) |
| 2 | **Sobre Mí**       | 2-3 líneas    | Credibilidad concreta. **NUNCA** frases genéricas ("apasionado por", "orientado a resultados")   |
| 3 | **Experiencia**    | 4-5 sub       | Cada sub = una experiencia, mapeada a **un requisito específico del JD**. Viñetas: métrica + tech |
| 4 | **Habilidades Técnicas** | 1 tabla | Coincide con keywords del JD. Solo tech realmente documentada en el perfil.                     |
| 5 | **Educación**      | 2-4 líneas    | Títulos exactos del perfil. No disculparse por títulos faltantes.                                |
| 6 | **Proyectos Personales** | 0-3 sub | Solo si refuerzan el ajuste al JD. Saltar la sección completamente si nada encaja.              |

## Sección 1 — Encabezado

```markdown
# <Nombre Apellido>
**<Título de rol alineado al JD>** · <Ciudad, País>
✉️ <email> · 📱 <teléfono> · 🔗 linkedin.com/in/<handle> · 💻 github.com/<handle>
🗣 <Idioma1 (nivel)>, <Idioma2 (nivel)>
```

Adapta el título de rol: si el JD dice "Backend Engineer (Python)" usa eso, no el objetivo genérico del perfil. Sé veraz — nunca reclames una seniority que no tienes.

## Sección 2 — Sobre Mí

2-3 líneas. El usuario es una persona real que ha hecho cosas reales; muéstralo en 30-50 palabras. Frases prohibidas:

| ❌ Prohibido                           | ✅ Reemplazar con                                            |
|----------------------------------------|--------------------------------------------------------------|
| "Apasionado por <X>"                   | un hecho: "5 años construyendo <X> en producción"            |
| "Profesional orientado a resultados"   | un número: "Reducida latencia p95 de 320ms a 110ms en 3 servicios" |
| "Buscando una oportunidad para crecer" | eliminar por completo; la candidatura misma lo señala        |
| "Jugador de equipo orientado al detalle" | dar un ejemplo u omitir                                    |

## Sección 3 — Experiencia

La sección más difícil. Cada sub-bloque es **una experiencia** mapeada a **un requisito del JD**.

```markdown
### <Rol> @ <Empresa> — <Mar 2022 – presente>
- **Reducido tiempo de cold-start de 4.2s a 0.8s** reescribiendo la capa de bootstrap (Python, asyncio, uvloop)
- **Entregados 3 productos de datos para clientes** poseyendo el stack completo (FastAPI, Postgres, dbt, Airflow)
- **Mentorizados 2 ingenieros backend junior** a través de sus primeros incidentes en producción
```

Reglas de viñetas:
- **Métrica en negrita** al inicio (número, %, tiempo, escala)
- **Tech entre paréntesis** al final de la viñeta
- **Verbo de acción** como primera palabra (ver lista prohibido/permitido abajo)
- Una línea por viñeta. Si se envuelve, estás metiendo demasiado.
- 3-5 viñetas por experiencia. Menos = la experiencia parece delgada; más = ruido.

### Verbos de acción

| ✅ Usar                                              | ❌ Prohibido                    |
|-------------------------------------------------------|---------------------------------|
| Built, Architected, Shipped, Engineered, Reduced,     | learned, studied, assisted,     |
| Migrated, Designed, Owned, Mentored, Scaled, Cut       | helped, was involved in,        |
|                                                       | participated in, was responsible for |

Los verbos prohibidos señalan una voz junior/insegura. Usa la lista activa incluso cuando el rol fue junior — enfócate en lo que *entregaste*, no en lo que *hiciste*.

## Sección 4 — Habilidades Técnicas

Una tabla markdown de 2 columnas que refleja la lista de keywords del JD. **Solo tech que el perfil realmente documenta.** Inventar una herramienta que no conoces es un fallo instantáneo en la revisión del Critic (y mata tu candidatura en la vida real).

```markdown
| Área              | Stack                                                  |
|-------------------|--------------------------------------------------------|
| Lenguajes         | Python, Go, Bash                                       |
| Backend           | FastAPI, Django, gRPC                                  |
| Data              | PostgreSQL, Redis, dbt, Airflow                        |
| Infra             | Docker, GitHub Actions, AWS (EC2, S3, RDS)             |
```

Las categorías deberían coincidir con lo que el JD enfatiza. Si el JD nunca menciona infra, elimina o comprime esa fila.

## Sección 5 — Educación

```markdown
### <Título>, <Institución> — <Año>
<nota de una línea: GPA solo si > 28/30 ≈ 3.5/4, título de tesis solo si relevante al JD>
```

Si el candidato no tiene título:
- **No te disculpes** ("actualmente cursando", "autodidacta en lugar de"). Disculparse señala debilidad.
- Lista certificaciones relevantes, bootcamps, programas online como entradas propias.
- Apóyate en la sección de Experiencia para llevar el peso.

## Sección 6 — Proyectos Personales (opcional)

Incluir SOLO si un proyecto refuerza claramente el ajuste al JD. Mismo patrón de viñetas que Experiencia.

```markdown
### <Nombre del proyecto> — <enlace github>
- **<métrica / resultado>** (<stack tecnológico>)
- Descripción de una línea de qué hace y por qué es relevante
```

Si nada encaja, **salta la sección completamente**. El relleno vacío señala falta de sustancia.

## Tono por tipo de empresa (de señales del JD)

| Tipo de empresa | Tono                                          | Señales en el JD                                                |
|-----------------|-----------------------------------------------|----------------------------------------------------------------|
| Startup         | Confiado, enfocado en ownership, directo, verbos de acción primero | "ritmo rápido", "muchos sombreros", "early-stage", equipo pequeño |
| Corporativa     | Profesional, estructurado, consciente de procesos | "stakeholders", "cross-funcional", equipo más grande, proceso bien definido |
| Fintech / regulada | Consciente de compliance, preciso, cita frameworks (PCI-DSS, SOC 2, ISO 27001) | menciones de auditorías, reguladores, equipos de compliance |
| Agencia         | Versátil, orientado al cliente, amplitud sobre profundidad | "proyectos variados", "orientado al cliente", "delivery" |

No exageres — el tono es un color, no un disfraz. Las viñetas se mantienen factuales de cualquier forma.

## Carta de Presentación (solo si el JD la solicita)

Por defecto: **no escribas una**. Token + tiempo ahorrado. Escríbela SOLO si el JD la menciona explícitamente ("por favor incluya una carta de presentación", "cuéntanos por qué quieres este rol").

Longitud: 250-400 palabras. Ruta: `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<Company>.{md,pdf}`.

```markdown
Apertura (directa, NO "Escribo para expresar mi interés"):
"Me postulo para <rol> porque <3-4 pruebas concretas que coinciden con el JD>."

Medio (1-2 párrafos):
- Un logro pasado específico que mapea al principal punto de dolor del JD
- Una cosa que notaste sobre la empresa que va más allá de su landing page

Cierre:
- Una línea mirando al futuro: qué querrías hacer en los primeros 90 días
- "Feliz de discutir esto en más detalle."
```

Prohibido en cartas de presentación:
- "Escribo para expresar mi interés…" → empieza con esfuerzo y termina con nada
- "Adjunto encontrará mi CV…" → es una candidatura, por supuesto está adjunto
- "Sería un honor…" → cliché corporativo

## Generación de PDF — motor + escritura atómica + UPDATE DB (W-03, bug #26)

### Motor: `wkhtmltopdf` (NO typst, NO fpdf2)

Decisión técnica 2026-05-18 tras investigación "estética CV simplificada":

- **`wkhtmltopdf 0.12.6` (Qt 5.15.8)** → motor oficial, ya instalado en el contenedor. Produce CVs profesionales HTML+CSS, 2 páginas, ~30 KB (salida idéntica a los CVs "bonitos" del 16 de mayo).
- ❌ **NO usar `--pdf-engine=typst`**: typst no está disponible en pandoc 2.17 del contenedor (requeriría pandoc 3.x). Error histórico en la skill, reportado 2026-05-18.
- ❌ **NO usar `pdf_gen.py` (fpdf2)** para CVs: es solo respaldo minimalista para el 80% de casos simples. Para CVs orientados al usuario produce layout espartano de 1 página, sin CSS, sin spacing fino.

El anti-patrón histórico: generar el PDF directamente en `$JHT_USER_DIR/cv/`, luego ejecutar `db_update.py application --cv-pdf-path ...` por separado. Si el Sentinel mató al Writer entre los dos pasos (EMERGENCIA freeze 2026-05-17 04:43), el PDF quedó en disco pero la DB tenía `cv_pdf_path=NULL`. Sisal 7.5/10 PASS se convirtió en *"CV por escribir"* en el dashboard del usuario — oportunidad top invisible.

Fix: tempfile + puerta de tamaño + mv atómico + UPDATE de una sola vez. Si el UPDATE falla, eliminar el archivo final para no dejar un huérfano.

```bash
# El nombre de archivo final incluye position_id para que 2 vacantes en la misma empresa no colisionen (bug #25)
SRC_MD="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.md"
FINAL_PDF="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.pdf"
TMP_PDF="$(mktemp -t cv_${POSITION_ID}.XXXXXX.pdf)"

# ── PREFLIGHT ─────────────────────────────────────────────────────────
# Verificación explícita de que el motor esté disponible ANTES de pandoc.
# Sin esto, en caso de skill obsoleta (typst que no existe, pandoc 3.x que
# falta, …) el Scrittore ejecutaba el comando, fallaba, improvisaba
# fallback random → CVs feos del 2026-05-18 por la mañana.
if ! command -v wkhtmltopdf >/dev/null 2>&1; then
  echo "[cv-structure] ABORT preflight: wkhtmltopdf no disponible."
  echo "  Motores alternativos aceptables: weasyprint (pandoc --pdf-engine=weasyprint)."
  echo "  NUNCA fallback a pdf_gen.py / fpdf2 para CVs (salida fea)."
  echo "  Reportar el problema al Capitano vía [REPORT] y ABORT."
  exit 2
fi

# 1. Render vía pandoc → html → wkhtmltopdf (motor ganador, 32 KB / 2 pág).
#    --metadata title=... evita el warning de wkhtmltopdf "no title element".
pandoc "$SRC_MD" -o "$TMP_PDF" \
       --pdf-engine=wkhtmltopdf \
       --metadata title="CV $CANDIDATO"

# ── PUERTA POST-RENDER: tamaño + Producer ─────────────────────────────
# DOS checks obligatorios. NINGUNO de los dos es opcional.
#
# Check A) tamaño: < 20 KB indica motor equivocado (fpdf2 ~22 KB pero 1 pág
# espartana, wkhtmltopdf ≥30 KB con HTML+CSS completo). Umbral 20 KB OK para
# distinguir.
size=$(stat -c%s "$TMP_PDF" 2>/dev/null || stat -f%z "$TMP_PDF")
if [ ! -s "$TMP_PDF" ] || [ "$size" -lt 20000 ]; then
  echo "[cv-structure] ABORT post-render: PDF $size B sospechoso (esperado ≥20 KB)."
  echo "  Probable motor equivocado (fpdf2 minimalista en lugar de wkhtmltopdf)."
  rm -f "$TMP_PDF"
  exit 3
fi

# Check B) Producer: debe ser wkhtmltopdf (= 'Qt 5.15.8' o similar).
# Si es 'fpdf2' / vacío / '?', el motor NO era wkhtmltopdf — el PDF
# saldrá igualmente pero será feo. ABORT ruidoso así el Capitano lo ve.
producer=$(python3 -c "
from pypdf import PdfReader
import sys
try:
    r = PdfReader('$TMP_PDF')
    m = r.metadata or {}
    print(m.get('/Producer', ''))
except Exception as e:
    print('?'); sys.exit(1)
" 2>/dev/null)
case "$producer" in
  *Qt*)
    : # OK, wkhtmltopdf funcionó
    ;;
  *)
    echo "[cv-structure] ABORT post-render: Producer='$producer' (esperado 'Qt 5.x.x')."
    echo "  El motor real NO era wkhtmltopdf — salida no profesional."
    rm -f "$TMP_PDF"
    exit 4
    ;;
esac

# 3. Move atómico + UPDATE en secuencia; rollback si UPDATE falla
mv "$TMP_PDF" "$FINAL_PDF"
if ! python3 /app/shared/skills/db_update.py application "$POSITION_ID" \
        --cv-pdf-path "$FINAL_PDF" --written-at now; then
  echo "[cv-structure] UPDATE DB falló, elimino PDF para no dejar huérfanos"
  rm -f "$FINAL_PDF"
  exit 1
fi
```

Códigos de salida:
- `0` → CV OK, DB actualizada, listo para critic-loop
- `2` → preflight FALLO (motor no disponible) — señalar al Capitano
- `3` → post-render FALLO (tamaño < 20 KB, salida minimalista) — motor equivocado
- `4` → post-render FALLO (Producer != Qt) — motor equivocado
- `1` → DB UPDATE FALLO (rollback de archivo)

El Dottore vía `cv-disk-audit` healthcheck (bug #18) reconecta eventuales huérfanos disco↔DB; además ahora señala también los CVs con Producer no-Qt como "motor equivocado — regenerar".

## Puerta de estado pre-generación (W-04, bug #26)

Antes de ejecutar pandoc, verifica que la posición siga siendo de grado scoring. A veces el Analyst marca `excluded` *después* de que el Writer ha reclamado la posición (condición de carrera) y el Writer sigue escribiendo — 3 CVs desperdiciados en Canonical ContainerImages / K8s / Deloitte en los dumps del 2026-05-17.

```bash
status=$(python3 /app/shared/skills/db_query.py position "$POSITION_ID" --field status)
case "$status" in
  excluded|rejected)
    echo "[cv-structure] position #$POSITION_ID es $status, saltando generación de CV"
    exit 0
    ;;
esac
```

## Reglas estrictas

- **Cero invenciones.** Cada métrica, cada tecnología, cada proyecto debe ser trazable a `candidate_profile.yml` o las fuentes proporcionadas por el usuario. Inventar falla en el Critic y es motivo de despido en la vida real. T10.
- **Adaptar por JD.** El mismo candidato recibe un CV diferente por rol: diferente Sobre Mí, diferente énfasis de Experiencia, diferente orden de Skills. CVs genéricos fallan la puerta de puntuación.
- **Un requisito → un bloque de experiencia.** Si el JD tiene 5 requisitos y tu sección de Experiencia mapea 2, no estás contando la historia correcta.
- **Máximo 2 páginas.** Los reclutadores escanean. Si la página 3 existe, corta.

## Anti-patrones

- ❌ Sobre Mí genérico ("desarrollador apasionado con fuertes habilidades") — eliminación instantánea en la revisión del Critic.
- ❌ Tabla de Skills con tech no documentada en el perfil — invención, violación T10.
- ❌ Disculparse por título faltante / años — señala debilidad.
- ❌ Mismo CV para múltiples JDs — la puerta de puntuación penaliza CVs genéricos.
- ❌ Carta de presentación cuando no se solicita — tokens desperdiciados, ciclo de revisión más largo, sin valor.
- ❌ Más de 5 viñetas por experiencia — los reclutadores escanean, pierdes el impacto de la viñeta principal.

## Ver también

- `application-flow` — reclamación + ruta + UPSERT ANTES de escribir una sola línea de CV.
- `critic-loop` — la revisión ciega de 3 rondas que sigue. Aplica sus `Concrete Actions` entre rondas.
- `agents/_team/team-rules.md` T10 (perfil solo-lectura) + T11 (entregables en `$JHT_USER_DIR`).
- `agents/scrittore/scrittore.md` — el prompt orquestador que llama esta skill en el bucle principal.
