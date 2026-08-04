<!-- @translation: es, ai-translated 2026-08-03 -->
---
name: resilience
description: "Cuando una herramienta crítica para la misión falla, NUNCA degrades en silencio ni informes \"cola agotada\"/new=0. Clasifica rota-vs-vacía y luego sube la escalera de fallbacks — autorreparación con jht-install, reintento, método alternativo, marcar OPEN_UNVERIFIED, escalar al Capitano con el fix exacto. Úsala siempre que una herramienta de la que dependes (navegador, linkedin_check, un fetch, una CLI) dé error o falte una dependencia."
---

# resilience — nunca te rindas en silencio ante una herramienta rota

## Por qué existe

Una herramienta crítica para la misión (la verificación de LinkedIn vía Playwright) murió porque
faltaba una librería del sistema. Los agentes informaron "no puedo verificar" y cayeron en silencio a
"cola vacía" — el fallo se descubrió aguas abajo tras horas de `new=0`. Esta skill hace que el fallo
de una herramienta sea **ruidoso y recuperable** en lugar de silencioso y fatal.

## La regla fundamental

**Una herramienta rota NO es un resultado vacío.** Antes de escribir "cola agotada", `new=0` o "nada
que hacer", DEBES autocomprobar la herramienta de la que dependes. Si la herramienta está rota, no
tienes "nada de trabajo" — tienes **una reparación que hacer** o **una escalada que abrir**.

## La escalera de fallbacks — súbela en orden, párate en el primer peldaño que funcione

1. **Detecta y clasifica.** Herramienta que sale con código distinto de cero / dependencia ausente /
   error de carga (`exitCode 127`, `cannot open shared object file`, `command not found`,
   `error while loading shared libraries`) → **BROKEN**. Herramienta que se ejecuta limpia y devuelve
   cero elementos → **EMPTY** (genuino). Solo EMPTY justifica un "nada que hacer".
2. **Autorreparación.** Restaura la dependencia ausente con **`jht-install`** (el wrapper canónico —
   enruta correctamente system/python/node/browser y usa el `sudo apt` que ya tienes). Después
   **reintenta la herramienta original**.
   *Ejemplo:* el navegador falla con `cannot load libatk-1.0.so.0` → `jht-install` de las
   dependencias de sistema del navegador (`playwright install-deps` / `sudo apt-get install` de la
   librería) → relanza.
3. **Método alternativo.** Si la herramienta principal no se puede reparar en el bucle, cambia de
   método manteniendo el mismo objetivo:
   - LinkedIn: usa el fetch HTTP como invitado, o verifica que la oferta siga viva en la **página
     canónica de careers/ATS de la empresa** (Greenhouse / Lever / Ashby / Workable). **Nunca** te
     fíes de un HTTP 200 de LinkedIn — el authwall devuelve 200 también para ofertas cerradas.
4. **Marca, no descartes.** Si sigue sin ser concluyente, deja el estado del dato **SIN CAMBIOS** y
   etiquétalo `OPEN_UNVERIFIED` + un `NOTE_MISMATCH`. Nunca sobrescribas en silencio con una
   suposición.
5. **Escala (dentro del techo de 2-3 intentos, ver abajo).** Herramienta rota y no reparable en ≤2-3
   intentos → manda un mensaje al **Capitano** con el fix EXACTO: el comando que falla, la
   dependencia ausente y la línea `jht-install` / Dockerfile que lo resuelve. Después **sigue
   trabajando con el método alternativo** (o pasa a otra fuente) — no te quedes parado, pero
   **tampoco pases del techo**.

## Qué prohíbe

- ❌ Escribir "cola agotada" / `new=0` / "nada que verificar" cuando la causa real es un error de
  herramienta.
- ❌ Recurrir a una señal conocidamente poco fiable (p. ej. LinkedIn `200` = "abierta") y darla por
  verificada.
- ❌ Reportar un bloqueo y quedarte inactivo. Repórtalo **y** sigue trabajando con la alternativa.

## Clasifica antes de declarar "vacío"

Clasificador canónico — el smoke-test compartido `tool_health` comprueba todo el conjunto crítico de
una sola vez (`status` OK|BROKEN|UNKNOWN por herramienta, exit 1 si alguna está rota). Ejecútalo
antes de informar "nada que hacer":

```sh
# Si una herramienta crítica está BROKEN, NO tienes una cola vacía — tienes una reparación/escalada.
if ! python3 /app/shared/skills/tool_health.py >/tmp/tools_health.json 2>&1; then
  echo "Una herramienta crítica está BROKEN -> jht-install + reintento -> alternativa -> escalada. NO 'vacío'."
fi
```

Comprobación inline por herramienta (cuando en el bucle solo dependes de una):

```sh
out=$(JHT_HOME=/jht_home python3 /app/shared/skills/linkedin_check.py "$JOB_ID" 2>&1); rc=$?
if [ "$rc" -ne 0 ] || printf '%s' "$out" | grep -qiE 'libatk|shared librar|exitCode 127|cannot open'; then
  echo "BROKEN -> reparar + reintentar + alternativa; NO es un EMPTY genuino."
else
  echo "herramienta OK -> un cero aquí es un EMPTY genuino."
fi
```

## ⛔ Techo de terquedad — máximo 2-3 intentos, luego ESCALAR (2026-06-26)

La terquedad tiene **presupuesto**, NO es infinita. Para una fuente/herramienta que sigue fallando
haz **como mucho 2-3 intentos reales** (p. ej. `reparar+reintentar` y luego **UNA** alternativa) —
**no** construyas wrapper sobre wrapper ni entres en bucles de decenas de iteraciones. *Eso fue
exactamente la maratón de scout-6: 54 scrapes de LinkedIn + 42 búsquedas web + una ejecución de
playwright hecha a medida para **3** ofertas, ~308 kT quemados.* La *escalera de resiliencia*
necesita un techo; si no, se convierte en un pozo de tokens.

Una vez gastados los 2-3 intentos:
1. **Párate en esa fuente** — no insistas más.
2. Deja el dato como `OPEN_UNVERIFIED` (nunca lo sobrescribas con una suposición) **o** pasa a otra
   fuente/círculo (round-robin, no agotes siempre el mismo).
3. **Escala al Capitano** con el diagnóstico exacto (el comando que falla, la dependencia ausente, la
   línea `jht-install`/Dockerfile que lo resuelve). **Él decide** si merece la pena insistir, reparar
   aguas arriba o abandonar ese círculo.

Crítico para la misión (navegador / LinkedIn) = insiste **hasta el techo**, no para siempre; y solo
desde fuentes oficiales. Una herramienta rota sigue siendo una **reparación/escalada**, no una "cola
vacía" — pero la reparación cuesta 2-3 intentos como mucho, y a partir de ahí decide el Capitano.
