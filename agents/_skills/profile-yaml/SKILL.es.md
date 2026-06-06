<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: profile-yaml
description: "Mantener `$JHT_HOME/profile/candidate_profile.yml` — los datos estructurados del candidato que consume todo el equipo. El frontend sondea este archivo cada ~2s; un YAML inválido hace que el panel izquierdo del usuario se quede silenciosamente en blanco. Propiedad del Assistente. Usar esta skill en CADA nueva pieza de información del usuario (texto o archivo subido): escribir incrementalmente, validar inmediatamente, hablar con el usuario solo después de que el validador diga VALID_YAML. También cubre `ready.flag` (el desbloqueo del botón \"Ir al dashboard\") con su protocolo estricto de 3 pasos verificar-luego-anunciar."
allowed-tools: Bash(python3 *), Bash(mkdir -p *), Bash(date *), Bash(test *), Bash(rm -f *)
---

# profile-yaml — fuente única de verdad sobre el candidato

El equipo lee `candidate_profile.yml` para cada CV, cada puntuación, cada decisión de coincidencia. Si lo mantienes preciso el resto del sistema funciona; si lo dejas derivar los Writers producen CVs estériles y el Scorer desajusta posiciones.

## Ruta y propiedad

| Ruta                                          | Quién lo escribe      | Quién lo lee             |
|-----------------------------------------------|----------------------|--------------------------|
| `$JHT_HOME/profile/candidate_profile.yml`     | **Assistente** (tú), Capitano, usuario vía la UI web | todos los demás agentes (solo lectura — T10) |
| `$JHT_HOME/profile/ready.flag`                | **Assistente** (tú)  | la puerta CTA del dashboard |

Crear el directorio si no existe:
```bash
mkdir -p "$JHT_HOME/profile"
```

## Actualización en vivo — incremental, después de CADA input relevante

El frontend sondea el archivo cada ~2s. No esperes al final de la conversación; **cada vez que el usuario te da un nuevo dato, escríbelo ahora**.

- "me llamo Mario" → escribir `name: Mario` inmediatamente.
- "busco un rol de cocinero" → actualizar `target_role: cocinero` inmediatamente.
- archivo subido con detalles de experiencia → después del Read, actualizar **todos** los campos en un solo Write.

Cada nuevo dato = un `Write` o `Edit` en el archivo. Luego validar. Luego seguir moviendo la conversación.

## Validación obligatoria después de CADA write/edit

```bash
python3 -c 'import yaml,sys; yaml.safe_load(open(sys.argv[1]))' \
    "$JHT_HOME/profile/candidate_profile.yml" \
    && echo VALID_YAML || echo INVALID_YAML
```

Si `INVALID_YAML` → leer el archivo con `Read`, encontrar la línea que señaló el error Python, corregir, validar de nuevo. **NO continuar la conversación con el usuario hasta VALID_YAML.** Un solo YAML roto limpia todo el panel izquierdo; el usuario piensa que la app crasheó.

Si olvidaste añadir el paso de validación puedes estar seguro de que el archivo está roto — no hay "probablemente ok". Siempre ejecutarlo.

## Reglas de seguridad YAML

El parser del frontend es estricto. Cinco reglas que previenen cada problema que hemos visto:

1. **Escalar de bloque (`|-` o `>-`) para cualquier texto > 60 caracteres** — descripciones, resúmenes, notas libres, fortalezas. Cadenas inline se rompen con comas, dos puntos, comillas, saltos de línea, paréntesis.
   ```yaml
   summary: |-
     Aquí puedes escribir texto largo, incluso con comas, dos puntos, apóstrofes,
     saltos de línea, paréntesis: el parser lo toma tal cual.
   ```
2. **Entrecomillar cadenas inline con chars especiales** — si debes mantener una cadena inline y contiene `"`, `:`, `#`, `&`, `*`, `>`, `|`, `%`, `@`, envuélvela en comillas dobles (`"…"`) o cambia a escalar de bloque.
3. **Espacio después de cada `:`** — `role: Senior` ✅ · `role:Senior` ❌.
4. **Indentar con 2 espacios, nunca tabulaciones** — las viñetas de lista indentan en la misma columna que el primer carácter de contenido del padre.
5. **Sin guiones largos / comillas inteligentes** — pegar desde editores de texto enriquecido inyecta `—`, `"`, `"`. Reemplazar con `-`, `"` simple, o usar escalar de bloque.

## Esquema mínimo (el piso)

El frontend tiene un respaldo que desbloquea "Ir al dashboard" cuando estos están presentes + no vacíos (para que el usuario pueda proceder incluso antes de que crees `ready.flag`). Poblarlos todos:

```yaml
name: <Nombre Apellido>
target_role: <rol objetivo>
location: <ciudad o área>
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
      years: ...              # ej. "Mar 2022 - en curso" — usado para duración real
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
  <claves libres, snake_case — ver sección abajo>
```

Las claves `preferences.work_mode`, `preferences.relocation`, `preferences.salary_annual_eur` son leídas literalmente por el frontend para poblar la sección "Preferencias de trabajo". Nombres alternativos (`work_location`, `flexible`, `remote`) quedan escritos pero invisibles al usuario.

Esquema completo + ejemplos: `candidate_profile.yml.example` en la raíz del repo (para documentación, **NO copiar sus valores** — ver anti-alucinación).

## `sector_details` — claves libres para el sector del usuario

Sección genérica key/value que el frontend muestra como lista. Las claves las eliges tú basándote en el oficio del usuario. Ejemplos reales:

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

# Construcción / instalaciones
sector_details:
  patenti: ["CAP carrello elevatore", "PES/PAV", "patentino ponteggi"]
  specializzazione: "Impianti elettrici industriali"
  anni_cantiere: 12

# Enseñanza
sector_details:
  classe_concorso: "A-12 (Italiano, Storia)"
  anni_ruolo: 8
  specializzazione_sostegno: true
```

Reglas:
- Claves en `snake_case`, cortas y legibles.
- Insertar solo claves con valor real del candidato. Si no sabes → omitir (nunca `null` / `""`).
- Valores: cadena, número, booleano, array de cadenas.
- Sector no en la lista → inventa las claves correctas tú, basándote en qué es importante en ese oficio. Ej. camionero: `patente: CE+CQC`, `anni_alla_guida: 15`, `tratte_abituali: [...]`.

## `ready.flag` — desbloqueo "Ir al dashboard"

El botón está desactivado por defecto. El frontend lo activa SI:
- existe `$JHT_HOME/profile/ready.flag` (el flag explícito que TÚ creas), **O**
- el backend detecta que el esquema mínimo ya está completo (respaldo automático).

Así que a menudo el botón ya está desbloqueado por el respaldo cuando el perfil está completo — **no anuncies el desbloqueo si no fuiste tú quien hizo el flag**.

### Cuándo crear el flag (3 pasos ESTRICTOS, nunca saltarlos, nunca cambiar el orden)

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

### Anti-alucinación del paso 2

Es conocido que un LLM tiende a escribir "he hecho X" incluso cuando la tool call no fue emitida. El `test -f` existe a propósito para interrumpirte si saltaste la creación: ves `FLAG_MISSING` y te acuerdas de volver atrás. **No confíes en tu recuerdo, confía solo en la salida de `test -f`.**

### Cuándo eliminar el flag

Si durante la conversación emerge que un campo de la checklist de bloqueo es incorrecto o faltante (ej. el usuario dice "ah no, esa experiencia no era realmente mía"):

```bash
rm -f "$JHT_HOME/profile/ready.flag"
```

Y avisa al usuario: "he puesto el botón en espera — revisemos este punto antes de continuar".

### NO crear el flag si

- la última validación del YAML imprimió `INVALID_YAML` (incluso una sola vez después del último Write);
- faltan: nombre, rol objetivo, ciudad, años de experiencia, email;
- faltan: skills (≥2), idiomas (≥1), experiencias (≥1), títulos de estudio (≥1).

## ⚠️ Anti-alucinación — la regla crítica

**NUNCA leer `candidate_profile.yml.example` o `candidate_profile.hr.yml.example` como fuente de valores.** Esos archivos documentan la *estructura*, no al candidato. Si los lees arriesgas escribir "Mario Rossi" / "mario.rossi@example.com" en el perfil real.

Usa SOLO:
- lo que el usuario te ha dicho en chat
- lo que has extraído de un CV / archivo subido

Si no sabes un campo: **deja `""` u omite**, nunca inventar un valor plausible.

## Anti-patrones

- ❌ Escribir el perfil en tu cwd `$JHT_AGENT_DIR` en lugar de `$JHT_HOME/profile/` — el frontend no lo encuentra.
- ❌ Saltar la validación "total era un cambio pequeño" — cada Write puede romper YAML, siempre.
- ❌ Mostrar YAML / JSON / rutas en el chat — el usuario es no-técnico (ver `assistente.md` sección lenguaje usuario).
- ❌ Anunciar el desbloqueo sin el `test -f` — es la clásica alucinación "he hecho X" sin haberlo hecho.
- ❌ Append (Edit) en secciones existentes sin revisar el contexto — el YAML debe reescribirse de forma coherente, no parchearse al azar.

## Ver también

- `profile-summaries` — los 4 MDs discursivos que se escriben en paralelo al YAML.
- `onboarding-flow` — el protocolo conversacional que decide cuándo actualizar qué.
- `chat-web` — cómo comunicar la confirmación al usuario (1 línea, sin rutas, sin jargon).
- `agents/_team/team-rules.md` T10 — el perfil es solo-lectura para los demás agentes, citación textual.
