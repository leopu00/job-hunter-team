<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: profile-summaries
description: Escribir los 4 resúmenes narrativos en Markdown bajo `$JHT_HOME/profile/summaries/` que complementan el YAML estructurado. Los Writers downstream NECESITAN estos — un YAML solo produce CVs estériles porque no tiene voz, ni narrativa, ni posicionamiento. Propiedad del Assistente. Los nombres de archivo son FIJOS (el frontend ignora cualquier otro); siempre escritos en primera persona del usuario ("soy un desarrollador…"); siempre reescritos completamente (Write, no Edit append) — son snapshots del presente, no logs append-only.
allowed-tools: Bash(mkdir -p *)
---

# profile-summaries — la voz del candidato en disco

El YAML estructurado es genial para filtros y coincidencias pero no dice nada sobre *quién* es el candidato. Los 4 archivos MD en `summaries/` llevan la narrativa que los Writers necesitan para producir CVs que lean como una persona, no como una lista de checkboxes.

## Los 4 archivos (nombres de archivo FIJOS)

| Archivo          | Título UI mostrado al usuario   | Qué contiene                                                            | Límite de longitud |
|------------------|---------------------------------|-------------------------------------------------------------------------|-------------------|
| `about.md`       | **Quién eres**                  | Resumen de persona: rol actual/objetivo, años, sector, rasgo distintivo | ~400 char |
| `preferences.md` | **Preferencias contadas**       | Modalidad de trabajo, reubicación, retribución, horarios, ambiente      | ~400 char |
| `goals.md`       | **Objetivos y dream job**       | Qué busca en los próximos 1-3 años, contexto/empresa soñada            | ~500 char |
| `strengths.md`   | **Puntos fuertes**              | 2-4 cualidades concretas con ejemplo breve para cada una                | ~500 char |

Ruta: `$JHT_HOME/profile/summaries/<archivo>.md`. Crear el dir si falta:
```bash
mkdir -p "$JHT_HOME/profile/summaries"
```

Nombres de archivo diferentes (ej. `about-mario.md`, `goals_v2.md`) son **silenciosamente ignorados** por el frontend.

## Restricciones de estilo (vinculantes)

- **Markdown simple**: párrafos separados por línea en blanco, `**negrita**` para enfatizar, listas solo si ayudan a la legibilidad.
- **Sin tablas, sin encabezados `#`** — estos MDs viven en cards UI ya tituladas.
- **Longitud**: respetar el límite. Sin muros de texto.
- **Primera persona del usuario**: `"soy un desarrollador…"`, `"prefiero trabajar remoto…"`. Nunca tercera persona (`"Mario es…"`).
- **Tono**: natural, como si el usuario hablara de sí mismo a un amigo experto del sector.
- **Nunca rutas / nombres de archivo / jargon** en el texto — el usuario lee "el resumen", no "about.md".

## Regla de actualización — reescribir completo, nunca append

Cuando llega información que cambia el sentido de un MD existente, **reescribe el archivo desde cero** (herramienta `Write`, NO `Edit` append). Son snapshots del presente, no logs cronológicos. Un append arriesga dejar párrafos obsoletos junto al nuevo.

## Trigger — cuándo escribir cada archivo

| Archivo           | Cuándo escribirlo por primera vez / actualizarlo                                                                                                                                                       |
|-------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `about.md`        | Tienes rol + años + ≥1 experiencia. Reescribirlo cada vez que cambia algo sustancial (rol, seniority, sector).                                                                                         |
| `preferences.md`  | Has discutido con el usuario al menos una de: modalidad de trabajo, reubicación, retribución. Actualizar cada vez que una de estas cambia.                                                              |
| `goals.md`        | El usuario ha contado aspiraciones / contexto ideal / dream job (incluso parcial). No forzar la mano: si no emerge espontáneamente, **preguntar una sola vez** "¿hay un tipo de contexto o empresa donde te verías particularmente bien?". |
| `strengths.md`    | Has recogido **2+ experiencias o proyectos relevantes**. Extraer 2-4 cualidades recurrentes del patrón.                                                                                                |

## Regla de arranque — primer CV cargado

Cuando el usuario carga un CV, después de poblar el YAML escribe MÍNIMO **`about.md` + `strengths.md`** en el mismo turno. Tienes suficientes datos (rol, años, experiencias, competencias, tono) para hacerlo inmediatamente; no pospongas. Saltar este paso significa que el Scrittore de CV aguas abajo nunca tendrá el contexto narrativo del candidato → producirá CVs estériles. Tú eres el único punto donde esa narrativa se captura.

`preferences.md` y `goals.md` llegarán en los turnos siguientes (después de la discusión específica).

## Ejemplos

### `about.md` (sector tech)
```markdown
Soy un desarrollador backend con 4 años de experiencia en **Python** y
sistemas distribuidos, últimamente concentrado en pipelines ETL y APIs
de alto throughput. Vengo de un recorrido híbrido entre **data engineering**
y backend "clásico", y me muevo bien cuando el problema está en el medio:
modelado del dato + servicio que lo expone.

Busco un rol backend o data senior donde pueda llevar ownership
end-to-end del servicio, no solo "ticket".
```

### `strengths.md` (sector no-tech, ejemplo cocina)
```markdown
**Resistencia en los picos.** He gestionado brigada de 12 personas en un
restaurante con 200 cubiertos por noche: he aprendido a mantener ritmo y
calidad incluso cuando se pone caliente de verdad.

**Costo de materia prima.** En los últimos 3 años he reducido el food cost
de partida salada del 34% al 28% trabajando en el menú y en la relación
con los proveedores, sin tocar la calidad.

**Team mentoring.** He formado 2 sous-chefs que ahora gestionan
autónomamente sus propias brigadas.
```

## Anti-patrones

- ❌ Escribir en tercera persona ("Mario es un desarrollador…") — el frontend renderiza el texto como voz directa del candidato, tercera persona suena alienante.
- ❌ Append con `Edit` en lugar de `Write` — termina con dos intros contradictorias en el mismo archivo.
- ❌ Tablas / encabezados `#` / listas numeradas verbosas — la card UI ya tiene su propio chrome.
- ❌ Saltar `about.md` / `strengths.md` después de upload de CV "porque ya está escrito en el YAML" — el YAML no tiene tono, los scrittori producen CVs estériles.
- ❌ Insertar rutas o nombres de archivo (`/jht_home/profile/summaries/about.md`) en el texto — el usuario no sabe qué son.
- ❌ Escribir más allá del límite de longitud — la card UI trunca / hace scroll horizontal, el mensaje se pierde.

## Ver también

- `profile-yaml` — skill hermana: dato estructurado que se actualiza en paralelo a estos MDs.
- `onboarding-flow` — cuándo en la conversación recoger los datos que alimentan estos MDs.
- `agents/scrittore/scrittore.md` — el agente downstream que lee estos MDs para escribir CVs con voz.
