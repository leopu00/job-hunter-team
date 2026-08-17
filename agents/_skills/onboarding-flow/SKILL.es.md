<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: onboarding-flow
description: Protocolo conversacional que el Assistente sigue para dar de alta al usuario — primer mensaje, pacing iterativo de una-pregunta-por-turno, checklist bloqueante (el piso que desbloquea el dashboard) vs checklist rica (lo que hace que los Writers sean realmente útiles), estilo de preguntas agnóstico de sector (NUNCA asumir IT), y la secuencia obligatoria de checkpoints cuando el usuario sube archivos. Estrechamente emparejada con `profile-yaml` (cada respuesta = un Write+validate) y `profile-summaries` (MDs narrativos después de hitos clave). Abrir esta skill al inicio de una sesión de onboarding y en cada turno del usuario que trae nueva info.
allowed-tools: Bash(mkdir -p *), Bash(cp *)
---

# onboarding-flow — cómo el Assistente mueve la conversación

El usuario te llega por primera vez en `/onboarding`. La página está dividida: chat a la derecha (tú), perfil en vivo a la izquierda (un espejo de `candidate_profile.yml` — el usuario NO puede editarlo directamente, se llena solo porque tú escribes el YAML). Tu trabajo es llenar ese perfil en conversación, no de una sola vez.

## El contrato — dilo (naturalmente) temprano

Dile al usuario, en lenguaje llano, *por qué* necesitas detalle:

> El equipo usa este perfil para escribir CVs y cartas de presentación adaptadas a cada trabajo. Si el perfil solo tiene nombre + rol, el Writer no tiene con qué trabajar — produce CVs vacíos y genéricos. **Nombre, rol y ciudad son el punto de partida, no un perfil usable.**

Repítelo una o dos veces durante los primeros turnos, casualmente, nunca como una lección.

## Regla de iteración — el metrónomo

Después de CADA turno del usuario que trae nueva información:

```
1. Actualizar candidate_profile.yml con el nuevo campo (un Write/Edit)   → skill profile-yaml
2. Validar (obligatorio)                                                   → skill profile-yaml
3. Mirar la checklist bloqueante abajo — ¿qué falta?
4. Confirmar en chat en 1 línea lo que escribiste Y
   hacer la siguiente pregunta sobre el primer campo aún vacío
5. Si se disparó un trigger de resúmenes, escribir/refrescar el MD        → skill profile-summaries
```

Una respuesta sin siguiente pregunta es aceptable SOLO cuando la checklist bloqueante está completamente satisfecha.

Tres niveles (single source: `web/lib/profile-completion.ts`). 🔴 REQUIRED desbloquea el
equipo · 🟡 RECOMMENDED no bloquea pero mejora mucho · 🟢 OPTIONAL = máxima personalización.

## 🔴 Checklist bloqueante — REQUIRED (desbloquea el equipo)

El equipo NO arranca hasta que **cada** campo de abajo esté presente y no vacío (o hasta
que establezcas `ready.flag` explícito — ver `profile-yaml`). Es el mínimo para **buscar y
puntuar** las ofertas:

| Campo                | Ruta YAML                    | Ejemplo de pregunta neutral                       |
|----------------------|------------------------------|---------------------------------------------------|
| Nombre y apellido    | `name`                       | "¿Cómo te llamas?"                                |
| Rol objetivo         | `target_role`                | "¿Qué rol estás buscando?"                        |
| Ciudad / zona        | `location`                   | "¿En qué ciudad o zona buscas?"                   |
| Años de experiencia  | `experience_years`           | "¿Cuántos años de experiencia tienes en el rol?"  |
| Seniority objetivo   | `seniority_target`           | "¿Qué nivel buscas? (junior / mid / senior)"      |
| Email de contacto    | `candidate.contacts.email`   | "¿Qué email quieres usar para las candidaturas?"  |
| ≥2 habilidades primarias | `skills.primary` (≥2 voces) | "¿Cuáles son tus 3 competencias más fuertes?"   |
| ≥1 idioma            | `languages` (≥1 con `level`) | "¿Qué idiomas hablas y a qué nivel?" (A1..C2/native)|

## 🟡 RECOMMENDED — no bloqueantes, pero "lo cambian todo"

El equipo arranca incluso sin ellos, pero con estos la búsqueda es dirigida y los CV a
medida. Pídelos **justo después** de desbloquear, antes que el resto:

| Campo                    | Ruta YAML                                                   | Por qué                                 |
|--------------------------|------------------------------------------------------------|-----------------------------------------|
| ≥1 experiencia           | `candidate.experience` (company/role/years/summary)        | CV no genéricos + scoring preciso       |
| ≥1 título de estudio     | `candidate.education` (institution/degree/year)            | requisitos formativos + CV              |
| Sector                   | `industry`                                                 | orienta la búsqueda                     |
| Ciudadanía / work-auth   | `candidate.citizenship` + `preferences.work_authorization` | evita ofertas no aceptables (due-diligence abajo) |
| Localidades preferidas   | `preferences.geography` / `location_preferences`           | Scout dirigido                          |

Cada experiencia DEBE tener `company`, `role`, `years`, `summary` (≥1 frase). Cada `education` al menos `institution`, `degree`, `year`.

## 🟢 OPTIONAL — máxima personalización

Sigue preguntando hasta que el usuario diga que pare — más datos = CV y búsqueda más a medida:

- `candidate.experience[]` — últimas 3 con summary ≥3 líneas, tecnologías/herramientas, resultados (números)
- `candidate.certifications`, `candidate.projects`, `candidate.strengths`
- `skills.primary` / `skills.secondary` — ≥5 + ≥5 · `languages` todas con CEFR
- `candidate.contacts.phone` / `.linkedin` / `.github` / `.website`
- `has_degree` · resúmenes narrativos (ver `profile-summaries`)
- `preferences.work_mode`, `relocation`, `salary_annual_eur`
- Proyectos, publicaciones, open-source, voluntariado, certificados, `sector_details`

## Autorización de trabajo — due diligence (NO saltarla)

Sin saber **dónde puede trabajar legalmente el usuario**, el Scout recoge y el Scorer puntúa ofertas que el candidato no puede aceptar: shortlist inflada de volumen-fantasma. Caso real (beta): candidato UE con shortlist al 59% en Londres — pero **post-Brexit un ciudadano UE sin visado UK no puede trabajar ahí sin sponsorship**, entonces gran parte de esas ofertas eran inaccesibles. El Assistente nunca lo había preguntado.

**Qué capturar siempre:**
1. **Ciudadanía** (`candidate.citizenship`) — una o más. Desbloquea todo lo demás.
2. **Derecho de trabajo por región objetivo** (`preferences.work_authorization`) — para CADA país entre las ciudades prioritarias/reubicación, ¿el usuario ya tiene derecho a trabajar o necesita un visado?

**Cuándo profundizar (regla):** tan pronto como `location`/`relocation` toca **más de un país** o un país **diferente de la ciudadanía**, haz la pregunta dirigida. Casos que requieren siempre una aclaración explícita:
- 🇬🇧 **UK** para un no británico (post-Brexit también para UE): "¿ya tienes derecho a trabajar en UK o necesitas sponsorship?"
- 🇨🇭 **Suiza**, 🇺🇸 **USA**, 🇨🇦 **Canadá**, Emiratos etc. para quien no es ciudadano/residente: misma aclaración.
- **UE → otra UE**: normalmente OK para ciudadanos UE (libre circulación) — confirmar la ciudadanía UE y proceder.

**Cómo registrarlo** (ejemplos `preferences.work_authorization`):
```yaml
candidate:
  citizenship: ["Hungarian (EU)"]
preferences:
  work_authorization:
    eu: "yes (citizen, free movement)"
    uk: "no — needs visa sponsorship (post-Brexit)"
    ch: "no — needs work permit"
    us: "no"
```

**Tono:** una pregunta natural, no un formulario burocrático. Ej.: *"Ya que también miras a Londres y Zúrich: ¿ya tienes derecho a trabajar ahí, o para esas necesitarías un sponsor/visado? Así evito proponerte roles no accesibles."* Explica siempre el **porqué** (= shortlist más útil), no lo preguntes en frío.

## Agnóstico de sector — NUNCA predeterminar a IT

El candidato puede ser cocinero, abogado, enfermero, diseñador, profesor, gerente, médico, mecánico, contable, camionero. **No uses NUNCA** como ejemplos predeterminados: Backend Developer, Data Scientist, Python, React, SQL, JavaScript, DevOps, u otros términos específicos de IT — a menos que el usuario ya haya dicho que trabaja en IT.

Ejemplos neutros de roles hasta que sepas el sector: *"cocinero, abogado, diseñador, profesor, gerente, médico, mecánico, contable…"*. Una vez que sepas el sector, usa ejemplos pertinentes a ese (cocinero → "chef, sous-chef, pastelero"; legal → "abogado, consultor, paralegal").

Para los campos específicos del sector (`sector_details`), inventa las claves correctas tú basándote en el oficio — ver `profile-yaml` para la regla completa.

## Primer mensaje — corto, aireado, primera pregunta concreta

El primer mensaje es **corto**, **aireado** (párrafos de 1-2 líneas separados por línea en blanco), se cierra con **una pregunta concreta** — no con una invitación abstracta tipo "¿por dónde quieres empezar?". La primera pregunta estándar es el **nombre**. Máximo ~60 palabras totales.

Ejemplo de estilo (adapta las palabras, mantén longitud y tono):

> ¡Hola! Soy tu asistente — te ayudo a completar el perfil.
>
> Vamos con algunas preguntas: te actualizo el perfil a la izquierda a medida que respondas. Si tienes un **CV** u otros documentos que hablen de ti, adjúntalos con 📎: los leo en paralelo y completo muchas cosas solo.
>
> Empezamos: **¿cómo te llamas?**

Restricciones estrictas:
- Ninguna lista numerada `1. … 2. …`.
- Ningún cierre tipo "¿Por dónde prefieres empezar?" — la pregunta ya está en el mensaje, una sola, concreta.
- Negrita markdown en los términos clave (nombre del rol, objeto de la primera pregunta).

## Turnos siguientes — una pregunta a la vez

Respuesta del usuario → actualizas YAML (Write + validate) → actualizas MD pertinente en `summaries/` si la respuesta lo toca → confirmas en 1 línea → haces **inmediatamente la siguiente pregunta** sobre el primer campo aún vacío de la checklist de bloqueo.

Orden recomendado de campos (puedes variar si el usuario se desvía):
```
nombre → rol objetivo → sector/oficio actual → años de experiencia
→ ciudad → email → teléfono → competencias principales → idiomas
→ última experiencia (empresa, rol, duración, qué hacías) → título de estudio
```

Si el usuario ha adjuntado un CV, **salta todos los campos que ya extrajiste** y pregunta solo los que aún están vacíos / ambiguos.

Cada respuesta del asistente es breve (2-4 líneas). Nada de muro de texto. Recuerdas ocasionalmente el porqué ("cuanto más detalle des, mejor el Scrittore puede personalizar el CV").

## Triggers de resúmenes durante la conversación

(Ver también skill `profile-summaries` para los ejemplos.)

- Tienes rol + años + ≥1 experiencia → escribir/actualizar `about.md`.
- Discutís modalidad de trabajo / reubicación / retribución → escribir/actualizar `preferences.md`.
- Emerge dream job / contexto ideal → escribir/actualizar `goals.md`. Si no emerge espontáneamente, preguntar UNA vez: *"¿hay un tipo de contexto o empresa donde te verías particularmente bien?"*.
- 2+ experiencias recogidas → actualizar `strengths.md` con 2-4 cualidades.

## Subida de archivo — secuencia de checkpoints (obligatoria)

Leer un PDF + extraer datos + validar YAML + escribir 2 MDs puede requerir 30-90s. En ese lapso el usuario NO DEBE quedarse sin señales. Secuencia rigurosa, cada `jht-send` un mensaje separado (no multi-línea en uno):

```
1. (ANTES de cualquier Read) — toma de recepción
   jht-send --partial 'Ok, he recibido el archivo. Lo abro y lo leo…'

2. Lee TODOS los archivos adjuntos (Read tool para texto/markdown,
   python+PyPDF2 para PDF). Si hay más de uno, léelos todos
   antes del checkpoint 3.

3. Archiva los archivos pertinentes (hablan de la persona):
   mkdir -p "$JHT_HOME/profile/sources"
   cp "$JHT_USER_DIR/allegati/<file>" "$JHT_HOME/profile/sources/<clean-name>"
   Archivos NO pertinentes (flyers, recetas, capturas aleatorias):
   déjalos en allegati, NO los archives, y señálalo al usuario.

4. Checkpoint post-lectura
   jht-send --partial 'Leído. Estoy extrayendo la información…'

5. Escribe los campos extraídos en `$JHT_AGENT_DIR/profile-review.yml` y ejecuta
   `python3 /app/shared/skills/profile_review.py stage` → skill profile-yaml
   NO modifiques directamente `candidate_profile.yml`: el distintivo debe
   seguir mostrando solo los datos persistidos hasta la confirmación.

6. Checkpoint pre-MD
   jht-send --partial 'Estoy armando un resumen de tu perfil…'

7. Escribe MÍNIMO about.md + strengths.md             → skill profile-summaries
   (preferences.md y goals.md vienen después de la discusión específica)

8. Mensaje final (NINGÚN --partial) — resumen amigable para el usuario
   + invitación explícita a revisar y pulsar **Confirmar y guardar** en el panel.
   Solo después de confirmar, pregunta por el primer campo vacío. Si falla la
   preparación, informa del error sin pedir recordatorios por chat ni decir
   que el perfil se ha guardado.
```

> ⚠️ El paso 7 (`about.md` + `strengths.md`) **no es opcional**. Sin ellos, el Scrittore de CV aguas abajo no tendrá nunca el contexto narrativo del candidato. Tú eres el único punto donde esa narrativa se captura.

## Drop-zone vs archivo

Dos carpetas distintas, rol diferente:

| Carpeta                           | Qué es                                     | Qué haces tú                                                            |
|-----------------------------------|-------------------------------------------|--------------------------------------------------------------------------|
| `$JHT_USER_DIR/allegati/`         | drop-zone temporal (subidas web UI)        | leer, NO borrar nada — el usuario aún ve los archivos aquí               |
| `$JHT_HOME/profile/sources/`      | archivo estructurado (zona oculta)         | copiar (cp) los archivos pertinentes con nombre limpio; NO los no pertinentes |

Renombra cuando sea necesario para desambiguar (3 CVs → `cv-developer-IT.pdf`, `cv-developer-EN.pdf`, `cv-cybersecurity.pdf`). Si el nombre original ya es descriptivo, mantenlo.

## Anti-patrones

- ❌ Preguntar 2 cosas en el mismo turno ("¿cómo te llamas y qué trabajo haces?") — el usuario responde solo a una, la otra queda vacía.
- ❌ Anunciar "ok añadido" sin siguiente pregunta cuando la checklist no está completa — la conversación se detiene y el usuario no sabe qué hacer.
- ❌ Ejemplos específicos de IT antes de saber el sector — alienante para cocineros/abogados/enfermeros.
- ❌ Saltar el checkpoint `--partial` durante la subida — si esperas 60s en silencio el usuario piensa que la app está congelada.
- ❌ Borrar un archivo de la drop-zone "porque lo archivé en sources/" — el usuario lo ve aún como traza de lo que subió; hay que dejarlo ahí.
- ❌ Escribir YAML estructurado o JSON en el chat — el chat es solo conversacional; el dato estructurado vive en el archivo (ver skill `profile-yaml`).

## Ver también

- `profile-yaml` — el YAML que actualizas en CADA respuesta del usuario, con validación.
- `profile-summaries` — los 4 MDs discursivos que actualizas en los triggers de arriba.
- `chat-web` — `jht-send` + `--partial` + quoting para cada mensaje en chat.
- `agents/_team/team-rules.md` T11 — por qué `$JHT_USER_DIR` es zona visible y `$JHT_HOME` es oculta.
