<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: profile-yaml
description: "Mantener `$JHT_HOME/profile/candidate_profile.yml` — los datos estructurados del candidato que consume todo el equipo. El frontend sondea este archivo cada ~2s; un YAML invalido hace que el panel izquierdo del usuario se quede silenciosamente en blanco. Propiedad del Assistente. Usar esta skill en CADA nueva pieza de informacion del usuario (texto o archivo subido): escribir incrementalmente, validar inmediatamente, hablar con el usuario solo despues de que el validador diga VALID_PROFILE. Tambien cubre `ready.flag` (el desbloqueo del boton \"Ir al dashboard\") con su protocolo estricto de 3 pasos verificar-luego-anunciar."
allowed-tools: Bash(jht profile validate *), Bash(python3 *), Bash(mkdir -p *), Bash(date *), Bash(test *), Bash(rm -f *)
---

# profile-yaml — fuente unica de verdad sobre el candidato

El equipo lee `candidate_profile.yml` para cada CV, cada puntuacion, cada decision de coincidencia. Si lo mantienes preciso el resto del sistema funciona; si lo dejas derivar los Writers producen CVs esteriles y el Scorer desajusta posiciones.

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
- archivo subido con detalles de experiencia → despues del Read, actualizar **todos** los campos en un solo Write.

Cada nuevo dato = un `Write` o `Edit` en el archivo. Luego validar. Luego seguir moviendo la conversacion.

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

El frontend tiene un respaldo que desbloquea "Ir al dashboard" cuando estos estan presentes + no vacios (para que el usuario pueda proceder incluso antes de que crees `ready.flag`). Poblarlos todos:

```yaml
name: <Nombre Apellido>
target_role: <rol objetivo>
location: <ciudad o area>
experience_years: <int>
has_degree: <true|false>
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
  experience:                 # >= 1 voz, cada una con company/role/years/summary
    - company: ...
      role: ...
      years: ...              # ej. "Mar 2022 - en curso" — usado para duracion real
      summary: |-
        ...
  education:                  # >= 1 voz, cada una con institution/degree/year
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

Las claves `preferences.work_mode`, `preferences.relocation`, `preferences.salary_annual_eur` son leidas literalmente por el frontend para poblar la seccion "Preferencias de trabajo". Nombres alternativos (`work_location`, `flexible`, `remote`) quedan escritos pero invisibles al usuario.

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
jht-tmux-send CAPITANO "[@assistente -> @capitano] [PROFILO-PRONTO] perfil del candidato completo y validado — el equipo puede arrancar."
```

El Capitano no mira el archivo del perfil: mientras nadie se lo diga, en el primer
arranque deja al usuario delante de una oficina casi parada. Este mensaje es el
disparador de su skill `first-run-burst` (plantilla completa de inmediato en lugar
de la subida gradual). Sin el, el primer dia el usuario ve una posicion cada diez
minutos y concluye que la aplicacion esta rota.

### Anti-alucinacion del paso 2

Es conocido que un LLM tiende a escribir "he hecho X" incluso cuando la tool call no fue emitida. El `test -f` existe a proposito para interrumpirte si saltaste la creacion: ves `FLAG_MISSING` y te acuerdas de volver atras. **No confies en tu recuerdo, confia solo en la salida de `test -f`.**

### Cuando eliminar el flag

Si durante la conversacion emerge que un campo de la checklist de bloqueo es incorrecto o faltante (ej. el usuario dice "ah no, esa experiencia no era realmente mia"):

```bash
rm -f "$JHT_HOME/profile/ready.flag"
```

Y avisa al usuario: "he puesto el boton en espera — revisemos este punto antes de continuar".

### NO crear el flag si

- la ultima validacion del perfil imprimio `INVALID_PROFILE` (incluso una sola vez despues del ultimo Write);
- faltan: nombre, rol objetivo, ciudad, anos de experiencia, email;
- faltan: skills (>=2), idiomas (>=1), experiencias (>=1), titulos de estudio (>=1).

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
