---
name: profile-yaml
description: "Mantener `$JHT_HOME/profile/candidate_profile.yml` — los datos estructurados del candidato que consume todo el equipo. El frontend sondea este archivo cada ~2s; un YAML invalido hace que el panel izquierdo del usuario se quede silenciosamente en blanco. Propiedad del Assistente. Usar esta skill en CADA nueva pieza de informacion del usuario (texto o archivo subido): escribir incrementalmente, validar inmediatamente, hablar con el usuario solo despues de que el validador diga VALID_PROFILE. Tambien cubre `ready.flag` (el desbloqueo del boton \"Ir al dashboard\") con su protocolo estricto de 3 pasos verificar-luego-anunciar."
allowed-tools: Bash(jht profile validate *), Bash(jht profile import *), Bash(python3 *), Bash(mkdir -p *), Bash(date *), Bash(test *), Bash(rm -f *)
---
<!-- @translation: es, ai-translated 2026-06-06 -->

# profile-yaml — fuente unica de verdad sobre el candidato

El equipo lee `candidate_profile.yml` para cada CV, cada puntuacion, cada decision de coincidencia. Si lo mantienes preciso el resto del sistema funciona; si lo dejas derivar los Writers producen CVs esteriles y el Scorer desajusta posiciones.

## 🌍 Idioma del texto libre (vinculante)

El texto de `narrative`, `key_points` y `timeline` del perfil se escribe en el idioma del usuario (`python3 /app/shared/skills/text_language.py lang` lo imprime), **aunque el CV del que viene esté en otro idioma** (RULE-T14). `validate_profile.py` imprime `WARN: LANGUAGE: …` para un texto largo claramente en otro idioma: reescríbelo, no ignores el aviso. Los nombres, las empresas y las herramientas se quedan como están.

## Ruta y propiedad

| Ruta                                          | Quien lo escribe      | Quien lo lee             |
|-----------------------------------------------|----------------------|--------------------------|
| `$JHT_HOME/profile/candidate_profile.yml`     | **Assistente** (tu), Capitano, usuario via la UI web | todos los demas agentes (solo lectura — T10) |
| `$JHT_HOME/profile/ready.flag`                | **Assistente** (tu)  | la puerta CTA del dashboard |

Crear el directorio si no existe:
```bash
mkdir -p "$JHT_HOME/profile"
```

## Actualizacion en vivo — incremental, despues de CADA input relevante

El frontend sondea el archivo cada ~2s. No esperes al final de la conversacion; **cada vez que el usuario te da un nuevo dato, escribelo ahora**.

- "me llamo Mario" → escribir `name: Mario` inmediatamente.
- "busco un rol de cocinero" → actualizar `target_role: cocinero` inmediatamente.
- informacion escrita en el chat → actualizar **todos** los campos pertinentes en un solo Write.

Cada nuevo dato = un `Write` o `Edit` en el archivo. Luego validar. Luego seguir moviendo la conversacion.

### Los CV subidos o pegados se revisan antes de convertirse en datos persistidos

Un mensaje que contiene `[FILE ALLEGATI]`, y un mensaje que trae el CV mismo como texto pegado (todo el recorrido laboral y los estudios, no un solo dato), son las excepciones a la escritura directa: los datos que la persona te dice uno a uno se siguen escribiendo al momento. Despues de leer el CV:

1. Escribe solo los campos extraidos en `$JHT_AGENT_DIR/profile-review.yml`. Nunca los escribas directamente en `candidate_profile.yml`. El archivo es un parche que se une al perfil: las mismas claves y la misma forma que `candidate_profile.yml` (skill `profile-schema`), solo las claves que dice el CV; `stage` lo toma y lo quita. No leas el script ni su `--help` para entender el formato.
2. Ejecuta `python3 /app/shared/skills/profile_review.py stage`.
3. Solo si devuelve `ok: true`, publica la tarjeta de confirmación: `python3 /app/shared/skills/profile_review.py ask-confirm --inferred <campos>`, donde `<campos>` son los campos que el CV NO decía y has deducido tú (por ejemplo `seniority_target,target_role,location`, o una preferencia como `location_preferences`); sin `--inferred` si no has deducido nada. La tarjeta lleva el resumen y los dos botones: no repitas el resumen y no nombres ningún panel ni botón de la app. No afirmes que el perfil ya está guardado. `--inferred` acepta solo los ocho campos (`name`, `email`, `target_role`, `location`, `experience_years`, `seniority_target`, `skills`, `languages`) o una clave que hayas escrito en `profile-review.yml`; cualquier otro nombre se rechaza con `inferred_unknown` y no se publica ninguna tarjeta.
4. Cuando la persona responda a la tarjeta, ejecuta `python3 /app/shared/skills/profile_review.py apply-confirmed`. Con `ok: true` el perfil está guardado: dilo en una línea y pregunta por el primer campo de `missing`. Si el plan aún no está declarado (`plan_registry.py get` dice `PLAN_MISSING`), pregúntalo ahora y solo con la tarjeta (`first_run.py ask-plan --agent assistente`, skill `onboarding-flow`), nunca con texto. Con el error `wants_correction`, pregunta qué corregir, actualiza `profile-review.yml`, ejecuta `stage` y después `ask-confirm` otra vez. Con cualquier otro error di que la confirmación no se pudo aplicar; nunca edites el perfil canónico para evitarlo.
5. Si la persona escribe «sí, guarda» con palabras, no guardes y no la ignores: ejecuta `ask-confirm`. `open: true` → una línea, «pulsa **Confirmar y guardar** en la tarjeta de arriba, o escribe solo «sí, guarda» (o «1») si estás en el terminal; también vale «sí, guarda y adelante»». `asked: true` (la tarjeta ya no estaba, se publica una nueva) → una línea diciendo que la has puesto otra vez debajo. `confirmed: true` → ejecuta `apply-confirmed`. Error `no_review` → el perfil ya está guardado o no hay nada que confirmar: dilo. Nunca dejes a la persona sin un paso siguiente.
6. Si falla la preparación, comunica que no se pudo preparar la revision. No pidas recordatorios por chat ni evites la revision editando el perfil canonico.

El distintivo solo lee el `candidate_profile.yml` persistido. No debe avanzar mientras haya una revision de CV pendiente.

## Validacion obligatoria despues de CADA write/edit

Validar contra el **esquema canonico** (no solo "es YAML parseable"): ver la skill
[`profile-schema`](../profile-schema/SKILL.md) para el esquema completo.

```bash
jht profile validate
# fallback directo:
# python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → continuar. `INVALID_PROFILE` → leer los `ERROR:` (campo + motivo),
corregir ese campo, revalidar. Los `WARN:` (claves legacy, ej. `languages[].name` en lugar
de `language`) no bloquean pero deben arreglarse cuando toques esa seccion.

**NO continuar la conversacion con el usuario hasta `VALID_PROFILE`.** Un perfil roto
vacia el panel izquierdo completo; el usuario piensa que la app crasheo.

Si olvidaste agregar el paso de validacion puedes estar seguro de que el archivo esta roto — no hay "probablemente ok". Siempre ejecutarlo.

## Reglas de seguridad YAML

El parser del frontend es estricto. Cinco reglas que previenen cada problema que hemos visto:

1. **Escalar de bloque (`|-` o `>-`) para cualquier texto > 60 caracteres** — descripciones, resumenes, notas libres, fortalezas. Cadenas inline se rompen con comas, dos puntos, comillas, saltos de linea, parentesis.
   ```yaml
   summary: |-
     Aqui puedes escribir texto largo, incluso con comas, dos puntos, apostrofes,
     saltos de linea, parentesis: el parser lo toma tal cual.
   ```
2. **Entrecomillar cadenas inline con chars especiales** — si debes mantener una cadena inline y contiene `"`, `:`, `#`, `&`, `*`, `>`, `|`, `%`, `@`, envuelvela en comillas dobles (`"…"`) o cambia a escalar de bloque.
3. **Espacio despues de cada `:`** — `role: Senior` ✅ · `role:Senior` ❌.
4. **Indentar con 2 espacios, nunca tabulaciones** — las vinetas de lista indentan en la misma columna que el primer caracter de contenido del padre.
5. **Sin guiones largos / comillas inteligentes** — pegar desde editores de texto enriquecido inyecta `—`, `“`, `”`. Reemplazar con `-`, `"` simple, o usar escalar de bloque.

## Esquema minimo (el piso)

El frontend tiene un respaldo que desbloquea "Ir al dashboard" cuando los ocho campos minimos estan presentes + no vacios: nombre, email, rol objetivo, ciudad, anos de experiencia, `seniority_target`, al menos 2 skills primarias, al menos 1 idioma (para que el usuario pueda proceder incluso antes de que crees `ready.flag`). Rellena primero esos. El resto del esquema de abajo es recomendado, experiencias y titulos de estudio incluidos: pidelo justo despues del desbloqueo, y no lo inventes nunca para rellenar el esquema.

```yaml
name: <Nombre Apellido>
target_role: <rol objetivo>
location: <ciudad o area>
experience_years: <int>
has_degree: <true|false>        # opcional: ausente = no declarado; si esta, booleano
seniority_target: <junior|mid|senior>
industry: <sector>

skills:
  primary: [...]              # >= 2 voces
  secondary: [...]

languages:                    # >= 1 voz
  - language: <nombre>
    level: <A1..C2 | native>

candidate:
  name: <mismo que arriba>
  target_role: <mismo que arriba>
  contacts:
    email: ...
    phone: ...
    linkedin: ...
    github: ...
  experience:                 # recomendado, no obligatorio: si esta, cada voz con company/role/years/summary
    - company: ...
      role: ...
      years: ...              # ej. "Mar 2022 - en curso" — usado para duracion real
      summary: |-
        ...
  education:                  # recomendado, no obligatorio: si esta, cada voz con institution/degree/year
    - institution: ...
      degree: ...
      year: ...

preferences:                  # CLAVES EXACTAS — el frontend busca precisamente estas
  work_mode: <remoto|ibrido|in sede|flessibile>
  work_mode_flexibility: <opcional, texto libre>
  relocation: <true|false|"per la giusta posizione">
  salary_annual_eur: <ej. "30-35k" | null>

sector_details:
  <claves libres, snake_case — ver seccion abajo>
```

Cuando la persona indique un objetivo salarial, guarda sus palabras exactas en `preferences.salary_annual_eur` del YAML y actualiza también `summaries/preferences.md`. Usa solo este campo, no una clave salarial en la raíz ni un segundo objeto salarial. Conserva cantidad, moneda y periodo; no los inventes, anualices ni conviertas. Si no ha indicado un objetivo, deja el campo ausente o null. Valida después de escribir.

Las claves `preferences.work_mode`, `preferences.relocation`, `preferences.salary_annual_eur` son leidas literalmente por el frontend para poblar la seccion "Preferencias de trabajo". `preferences` contiene solo estas cuatro claves: cualquier otra clave ahí la rechaza `jht profile validate` (`preferences: unknown field`) y el perfil no se puede importar. Todo lo demás va donde lo prevé el esquema (skill `profile-schema`): los lugares que la persona prefiere en `location_preferences` y los permisos y visados en `work_authorization` (ambos en la raíz del archivo), los roles que evitar, el alcance del rol y cualquier otro deseo en un bloque (`key: preferences`, `kind: key_points`).

Esquema completo + ejemplos: `docs/examples/candidate_profile.yml.example` (para documentacion, **NO copiar sus valores** — ver anti-alucinacion).

## `sector_details` — claves libres para el sector del usuario

Seccion generica key/value que el frontend muestra como lista. Las claves las eliges tu basandote en el oficio del usuario. Ejemplos reales:

```yaml
# Cocina
sector_details:
  specializzazione: Pasticceria
  brigate: "ristoranti grandi (10+ persone in cucina)"
  patenti: ["HACCP", "antincendio rischio medio"]
  ruolo_attuale: "Capo partita salata"

# Salud
sector_details:
  specializzazione_infermieristica: "Area critica"
  iscrizione_albo: "OPI Roma n. 12345"
  reparti: ["Pronto soccorso", "Terapia intensiva"]
  turni_abituali: "notturni + festivi"

# Construccion / instalaciones
sector_details:
  patenti: ["CAP carrello elevatore", "PES/PAV", "patentino ponteggi"]
  specializzazione: "Impianti elettrici industriali"
  anni_cantiere: 12

# Ensenanza
sector_details:
  classe_concorso: "A-12 (Italiano, Storia)"
  anni_ruolo: 8
  specializzazione_sostegno: true
```

Reglas:
- Claves en `snake_case`, cortas y legibles.
- Insertar solo claves con valor real del candidato. Si no sabes → omitir (nunca `null` / `""`).
- Valores: cadena, numero, booleano, array de cadenas.
- Sector no en la lista → inventa las claves correctas tu, basandote en que es importante en ese oficio. Ej. camionero: `patente: CE+CQC`, `anni_alla_guida: 15`, `tratte_abituali: [...]`.

## `ready.flag` — desbloqueo "Ir al dashboard"

El boton esta desactivado por defecto. El frontend lo activa SI:
- existe `$JHT_HOME/profile/ready.flag` (el flag explicito que TU creas), **O**
- el backend detecta que el esquema minimo ya esta completo (respaldo automatico).

Asi que a menudo el boton ya esta desbloqueado por el respaldo cuando el perfil esta completo — **no anuncies el desbloqueo si no fuiste tu quien hizo el flag**.

### Cuando crear el flag (3 pasos ESTRICTOS, nunca saltarlos, nunca cambiar el orden)

**Créalo en cuanto el perfil tenga rol objetivo, ciudad/zona y al menos un idioma** — no esperas a los ocho campos: el equipo arranca y las preguntas continúan (el resto del perfil se completa mientras trabaja).

**Antes del flag:** le has dicho a la persona los `gaps` que responde profile_apply.py y qué suponen, y ha elegido: ha dado los datos, o ha confirmado seguir así (`accept`). Skill onboarding-flow, § «Antes de que el equipo arranque». No es una barrera: una elección consciente nunca se bloquea.

```bash
# 1. Crear el flag con timestamp UTC
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$JHT_HOME/profile/ready.flag"

# 2. VERIFICAR que el archivo exista realmente (puede fallar silenciosamente:
#    permisos, dir faltante, cuota de disco, etc.)
test -f "$JHT_HOME/profile/ready.flag" && echo FLAG_OK || echo FLAG_MISSING

# 3. SOLO si paso 2 = FLAG_OK → enviar el mensaje en chat.
#    Si FLAG_MISSING → fix (ej. mkdir -p) y repetir desde paso 1.
#    NO anunciar NUNCA el desbloqueo sin FLAG_OK en el paso anterior.
```


### 4. Avisa al Capitano — es de aqui que arranca el equipo

Solo despues de `FLAG_OK`, y una sola vez:

```bash
jht-tmux-send CAPITANO "[@assistente -> @capitano] [PROFILO-PRONTO] perfil del candidato con el minimo para arrancar (rol, zona, idioma) — el equipo puede arrancar; el resto del perfil se completa mientras trabaja."
```

El Capitano no mira el archivo del perfil: mientras nadie se lo diga, en el primer
arranque deja al usuario delante de una oficina casi parada. Este mensaje es el
disparador de su skill `first-run-burst` (plantilla completa de inmediato en lugar
de la subida gradual). Sin el, el primer dia el usuario ve una posicion cada diez
minutos y concluye que la aplicacion esta rota.

Si `jht-tmux-send` responde que la sesión del Capitano no existe (salida 2, «no entregado»), no es un error: el Capitano arranca solo, pero no siempre enseguida. No lo reenvíes ni lo reintentes en bucle. Ejecuta una vez `python3 /app/shared/skills/captain_gate.py` y dile a la persona, en su idioma y en una frase, qué espera el equipo y cuánto, según su `reason`:
- `captain_due` true (`ready_flag`, `onboarding_done`, …): el equipo arranca en menos de un minuto.
- `tools_pending` con `tools.state` `ready`: el equipo pasa ahora a las herramientas completas de los Scout; en un par de minutos este chat se cierra y vuelve solo, conservando lo que se está escribiendo, y justo después arranca la búsqueda.
- `tools_pending` con `tools.state` `pending` o `pulling`: las herramientas de los Scout (unos 3 GB) todavía se están descargando; cuando lleguen, el equipo se reinicia una vez con ellas (el chat vuelve solo) y arranca la búsqueda. No hay nada que hacer.
- `tools_failed`: la descarga de las herramientas ha fallado; la búsqueda arranca después de que la persona ejecute `jht tools pull` en el terminal de su ordenador.
Nunca digas que el equipo arranca «cuando el Capitano se despierte» sin uno de estos casos. Luego sigue con la pregunta siguiente.

### Anti-alucinacion del paso 2

Es conocido que un LLM tiende a escribir "he hecho X" incluso cuando la tool call no fue emitida. El `test -f` existe a proposito para interrumpirte si saltaste la creacion: ves `FLAG_MISSING` y te acuerdas de volver atras. **No confies en tu recuerdo, confia solo en la salida de `test -f`.**

### Cuando eliminar el flag

Si durante la conversacion emerge que un campo de la checklist de bloqueo es incorrecto o faltante (ej. el usuario dice "ah no, esa experiencia no era realmente mia"):

```bash
rm -f "$JHT_HOME/profile/ready.flag"
```

Y avisa al usuario: "he puesto el boton en espera — revisemos este punto antes de continuar".

### NO crear el flag si

- la ultima validacion del perfil imprimio `INVALID_PROFILE` porque el YAML no se lee o un campo tiene un valor erroneo (las lineas `ERROR:` sobre un campo que la persona aun no ha dado no cuentan: se pide mientras el equipo ya trabaja);
- faltan (los tres que arrancan la busqueda): rol objetivo, ciudad/zona, idiomas (≥1). Los otros cinco de los ocho (nombre, email, anos de experiencia, `seniority_target`, skills ≥2) se piden justo despues, mientras el equipo ya trabaja: no retienen el flag.

Experiencias y titulos de estudio son recomendados: no bloquean el flag. Pidelos justo despues de crearlo.

## Después del onboarding: un cambio de la búsqueda pasa por el import

Mientras `$JHT_HOME/profile/ready.flag` no exista (el onboarding), escribe el perfil directamente, como arriba. Cuando existe, el equipo trabaja sobre el perfil, y cómo guardas un cambio depende de lo que toca:

- **El rol buscado, los lugares (localidad, lugares preferidos, traslado, permisos), los idiomas o el modo de trabajo** (los campos sobre los que se construye la búsqueda): escribe el perfil ENTERO, con el cambio, en `$JHT_AGENT_DIR/profile-next.yml`; ejecuta `jht profile validate "$JHT_AGENT_DIR/profile-next.yml"` y corrígelo hasta `VALID_PROFILE`; luego `jht profile import "$JHT_AGENT_DIR/profile-next.yml" --replace`, y di a la persona lo que dice la respuesta (los workers que se reinician con el perfil nuevo). Después del onboarding estos campos nunca se escriben directamente en `candidate_profile.yml`.
- **Todo lo demás** (una competencia, una experiencia, el objetivo salarial, un bloque): escríbelo directamente en `candidate_profile.yml`, como durante el onboarding. Los Analisti y los Scorer lo saben por su cola y releen el perfil.

En todos los casos la validación sigue enseguida a la escritura: un perfil que no pasa la validación nunca se queda en el disco. Corrígelo antes de responder a la persona o de hacer cualquier otra cosa.

## `onboarding-done.flag` — el final del onboarding

`ready.flag` pone en marcha el equipo; el onboarding sigue después. Cuando termine (están los ocho campos y `onboarding_questionnaire.py ask` responde `done: true`, o la persona dice que quiere dejar las preguntas), escribe `onboarding-done.flag`, una vez, y compruébalo como `ready.flag` (con `FLAG_MISSING` corrígelo y vuelve a escribirlo):

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$JHT_HOME/profile/onboarding-done.flag"
test -f "$JHT_HOME/profile/onboarding-done.flag" && echo FLAG_OK || echo FLAG_MISSING
```

Nunca antes, nunca para cortar una pregunta, nunca lo borres. Le dice a este ordenador que ya nadie está a mitad del onboarding: solo entonces el equipo pasa a las herramientas completas de los Scout (un reinicio de un par de minutos; el chat vuelve solo). **Dilo ANTES, nunca después.** En la imagen core (`echo "$JHT_IMAGE_TIER"` imprime `core`) el flag hace que el equipo se reinicie: en el mensaje que cierra el onboarding, y antes de escribir el flag, dile a la persona en una línea de su idioma que las preguntas han terminado y que en un momento el equipo se reinicia unos 2 minutos para pasar a las herramientas completas; el chat se detiene y se vuelve a conectar solo, lo que está escribiendo se conserva, no tiene que hacer nada. Luego escribe el flag. En la imagen completa no hay reinicio: no digas nada.

## 🎓 `has_degree` — de los estudios, nunca como relleno

`has_degree` es opcional: ausente significa «no declarado», nunca «no». Es un hecho del candidato, no un valor por defecto; puedes preguntarlo (esta entre los opcionales), pero no bloquea ni el perfil ni el desbloqueo:
- `true` cuando `education` (del CV o del chat) incluye un titulo universitario: grado, master, doctorado o equivalente.
- `false` solo despues de que el usuario te haya dicho que no tiene ninguno.
- Si no lo sabes, deja la clave fuera: nada de `false` por prudencia, ningun valor vacio, ningun texto (`"si"`): si la clave esta, debe ser `true` o `false`. Nunca `false` para rellenar un hueco: el Scorer lo compara con los requisitos de titulacion de cada oferta.

## ⚠️ Anti-alucinacion — la regla critica

**NUNCA leer `docs/examples/candidate_profile.yml.example` o `docs/examples/candidate_profile.hr.yml.example` como fuente de valores.** Esos archivos documentan la *estructura*, no al candidato. Si los lees arriesgas escribir "Mario Rossi" / "mario.rossi@example.com" en el perfil real.

Usa SOLO:
- lo que el usuario te ha dicho en chat
- lo que has extraido de un CV / archivo subido

Si no sabes un campo: **deja `""` u omite**, nunca inventar un valor plausible.

## Anti-patrones

- ❌ Escribir el perfil en tu cwd `$JHT_AGENT_DIR` en lugar de `$JHT_HOME/profile/` — el frontend no lo encuentra.
- ❌ Saltar la validacion "total era un cambio pequeno" — cada Write puede romper YAML, siempre.
- ❌ Mostrar YAML / JSON / rutas en el chat — el usuario es no-tecnico (ver `assistente.md` seccion lenguaje usuario).
- ❌ Anunciar el desbloqueo sin el `test -f` — es la clasica alucinacion "he hecho X" sin haberlo hecho.
- ❌ Append (Edit) en secciones existentes sin revisar el contexto — el YAML debe reescribirse de forma coherente, no parchearse al azar.

## Ver tambien

- `profile-summaries` — los 4 MDs discursivos que se escriben en paralelo al YAML.
- `onboarding-flow` — el protocolo conversacional que decide cuando actualizar que.
- `chat-web` — como comunicar la confirmacion al usuario (1 linea, sin rutas, sin jargon).
- `agents/_team/team-rules.md` T10 — el perfil es solo-lectura para los demas agentes, citacion textual.
