<!-- @translation: es, ai-translated 2026-08-03 -->
---
name: maintainer-sweep
description: "La ronda de mantenimiento de la INFRA del Mantenitore 👷‍♂️ (gemela de la del Dottore, con alcance sobre la infraestructura en lugar de sobre los agentes). Una pasada one-shot al día: canario de liveness de los procesos de soporte vital del contenedor (bridge/daemon/watchdog) vía process_health.py, smoke-test de las herramientas mission-critical (browser/LinkedIn) vía tool_health.py, auditoría/consolidación de dependencias fuera de estándar, GC de scripts huérfanos y ficheros tmp, de-dup de scripts recurrentes, frescura de dependencias, tendencia de disco/RAM, canario del locale UTF-8 de los panes vía locale_health.py (defecto cosmético vs datos corruptos). Single-writer: el Mantenitore es el ÚNICO que repara la infra; las acciones DESTRUCTIVAS (borrar/archivar) las PROPONE, decide el Capitano. Resultado añadido a mantenitore-logbook.jsonl."
allowed-tools: Bash(python3 /app/shared/skills/process_health.py *), Bash(python3 /app/shared/skills/tool_health.py *), Bash(python3 /app/shared/skills/sync_health.py *), Bash(python3 /app/shared/skills/host_vitals.py *), Bash(python3 /app/shared/skills/locale_health.py *), Bash(python3 /app/shared/skills/log_archive.py *), Bash(bash /app/.launcher/start-agent.sh *), Bash(df *), Bash(du *), Bash(free *), Bash(tmux ls *), Bash(jht-install *), Bash(ls *), Bash(stat *), Bash(jht-tmux-send *)
---

# maintainer-sweep — mantener la INFRA sana, en silencio y a prueba de regresiones

El Mantenitore es el gemelo del Dottore: **Dottore = salud de los AGENTES** (sesiones, tokens, context-refresh); **Mantenitore = salud de la INFRA** (herramientas, dependencias, disco, scripts). One-shot al día: boot → ronda → logbook → STANDBY (quédate quieto, sin autoterminarte; el próximo spawn te sustituye, kill-then-create). Presupuesto ~10 min. Frontera nítida, cero solapamiento con el Dottore.

> **Por qué existe:** el bug de `libatk` (browser muerto, LinkedIn no verificable) permaneció invisible durante horas porque *nadie hacía smoke-test de las herramientas y nadie se ocupaba de la infra*. La ronda convierte esa vigilancia en algo ESTRUCTURAL.

## Regla de oro — single-writer + proponer, no borrar
El Mantenitore **repara** la infra (instala dependencias que faltan, consolida, arregla). Pero toda acción **DESTRUCTIVA** (borrar/archivar ficheros, limpieza de disco) se la **PROPONE** al Capitano con el comando exacto; **decide el Capitano** (como en el rediseño de la monitorización de usage). Nunca borres por iniciativa propia.

## La ronda (los pasos, en orden)

### 0. 🫀 Canario de liveness de los procesos de soporte vital (la red de seguridad)
**PRIMER paso, antes que nada.** Los bridges/daemons que mantienen vivo el contenedor (sentinel-bridge, pacing-bridge, heartbeat-bridge, window-ratio-meter, codex-auth-healer + tg-bridge) se lanzan `setsid` detached → **fuera del respawn-on-crash de pid1**. El `agent-watchdog` (`maybe_respawn_bridges`) los revisa cada 30s, PERO si eso también fallara (bug, flap-cap alcanzado, watchdog degradado él mismo) tú eres **la última red**: en la primera ronda del día los detectas y los reparas. Sin este canario un daemon muerto permanece invisible durante horas (es exactamente lo que le pasó al sentinel-bridge en betaC el 2026-06-27 → 8h ciegos sobre el usage).
```bash
python3 /app/shared/skills/process_health.py summary
```
Imprime OK/DEAD para cada proceso esperado (bridge-suite, pid1-child, daemon, tg-bridge). Para los DEAD:
- **grupo `bridge-suite`** (detached, reparable por ti) → **REPARA** de inmediato, es un respawn no destructivo:
  ```bash
  bash /app/.launcher/start-agent.sh bridge      # relanza la suite entera (idempotente)
  ```
  luego **vuelve a ejecutar el canario** para confirmar que están vivos otra vez. Registra `processes_respawned`.
- **tg-bridge** ausente (y bots de Telegram configurados) → `bash /app/.launcher/start-agent.sh tg-bridge`.
- **grupo `pid1-child` / `daemon` / `core`** (agent-watchdog, doctor-watchdog, auto-report-loop, cloud-daemon, pid1) → relanzarlos es tarea de pid1: si están muertos el problema es más profundo → **ESCALA al Capitano** vía `jht-tmux-send` (NO intentes relanzarlos a mano: los dejarías huérfanos). Nunca lo dejes en silencio.

Si todo está vivo → registra `processes_health: all_ok` y sigue. Este es el gemelo-para-PROCESOS del smoke-test-para-HERRAMIENTAS del paso 1.

### 0.5 ☁️ Canario de CLOUD-SYNC (pull + push)
Justo después del canario de procesos. La sincronización local↔cloud se ha
atascado dos veces (pull churn: cursor congelado → reescribía ~500 posiciones/tick;
push 413: payload monolítico demasiado grande → el cursor nunca avanzaba → dashboard
cloud parado unas ~14h). Los bugs de código están corregidos, pero la vigilancia
hay que volverla ESTRUCTURAL.
```bash
python3 /app/shared/skills/sync_health.py summary        # o --json
```
Lee los cursores en solo lectura (`.cloud-sync-cursor.json`, `.cloud-pull-cursor.json`),
el máximo `positions.updated_at` en la DB y la cola de `logs/daemon.log`. Devuelve
`problems[]` con severidad. Resultado:
- **ningún problema** → registra `sync_health: ok` y sigue.
- **push_behind / push_errors (HIGH)** → el push no está llegando al cloud. NO es
  reparable por ti a mano con seguridad (single-writer sobre la DB = el equipo). **ESCALA
  al Capitano** vía `jht-tmux-send` con los detalles del check (lag + recuento de 413).
  Si el check sugiere el drenaje de emergencia (`JHT_PUSH_POS_CHUNK=40`), pásale la
  propuesta al Capitano, no actúes por tu cuenta.
- **pull_churn (MEDIUM)** → informa al Capitano de que el pull está reaplicando
  demasiadas filas (síntoma de cursor que no converge / fix no desplegado).
- **cursor_stale (MEDIUM)** → evidencia secundaria; inclúyela en la escalada solo
  si acompaña a una señal HIGH.
Registra el resultado bajo `sync_health` en la entrada del logbook (ver abajo). La regla
de oro no cambia: **detectar + reportar, nunca log-and-forget** (es el mismo error del
bug de libatk y del sentinel-bridge, aquí sobre los CURSORES de la sync).

### 1. 🩺 Smoke-test de las herramientas mission-critical (el corazón)
```bash
python3 /app/shared/skills/tool_health.py --json
```
Devuelve `tools_health` con `{status: OK|BROKEN|UNKNOWN, evidence}` para cada herramienta (browser/Playwright, linkedin_check, …) + `broken[]`.
- **BROKEN** → **REPARA** de inmediato: `jht-install <dep>` (p. ej. los ficheros `.so` de Chromium) y vuelve a ejecutar el check. Si queda reparado → registra `repaired`.
- **BROKEN y no reparable** → **ESCALA al Capitano** con el fix EXACTO vía `jht-tmux-send` (p. ej. "browser caído: `sudo playwright install-deps`; hasta que se arregle LinkedIn = OPEN_UNVERIFIED"). Nunca lo dejes en silencio.
- Es el MISMO `tool_health.py` que alimenta el gate en build-time (dev1) y el campo `tools_health` del tick: una única fuente de verdad sobre el estado de las herramientas.

### 2. 📦 Auditoría de dependencias fuera de estándar → consolidar
Dependencias instaladas fuera de los prefijos estándar (`/opt/jht-deps`, `PLAYWRIGHT_BROWSERS_PATH`, prefijo npm, venv) → reinstálalas en el estándar vía `jht-install`, para que no queden desperdigadas. Registra cuáles has consolidado.

### 3. 🧹 GC de scripts huérfanos/ficheros tmp
Scripts temporales dejados atrás por agentes **matados** (sesión que ya no aparece en `tmux ls`) y ficheros tmp caducados (> N horas). Lista los candidatos → **PROPÓN** el borrado al Capitano (acción destructiva), no borres directamente.

### 4. 🔁 De-dup de scripts recurrentes
Scripts casi idénticos repetidos por varios agentes → **propón** una única skill canónica (no la reescribas sobre la marcha). Registra la propuesta.

### 5. 📅 Frescura de dependencias
Librerías/herramientas deprecadas o versiones rotas / herramientas cruciales inalcanzables → informa al Capitano (nada de auto-upgrades arriesgados).

### 6. 💾 Disco / RAM + tendencia + cross-check de VITALS
`du` sobre las rutas grandes, `free` para la RAM. Para **`disk.used_pct` usa SIEMPRE `df`** — comando canónico:
```bash
df -P /jht_home | awk 'NR==2 {gsub("%","",$5); print $5}'   # p. ej. 30  (porcentaje tal como lo reporta df)
```
**NUNCA** lo derives de `statvfs`/`os.statvfs` (`f_bavail`/`f_blocks`): los bloques reservados lo inflan ~3× → falsas alarmas (p. ej. 88% reportado frente a un 30% real). Compáralo con la **tendencia del último logbook**: si está creciendo hacia un umbral → discute con el Capitano qué archivar/borrar (decide él). Registra los números + el delta.
**Después CROSS-CHECK de la serie temporal de vitals** (el bridge muestrea la RAM+CPU del contenedor cada pocos minutos en `vitals.jsonl`):
```bash
python3 /app/shared/skills/host_vitals.py summary --hours 24
```
Te da **pico/media de RAM+CPU + la HORA del pico** de las últimas 24h. **Correlaciona los picos con el *cuándo*** (p. ej. RAM al 92% a las 03:00 con 3 Analista activos; CPU al máximo durante un script pesado): ese es el dato que afina el diagnóstico mucho más que una foto instantánea. Si un pico parece anómalo → repórtalo al Capitano. Registra `vitals_24h` (pico RAM/CPU + hora) en la entrada. Ojo: la Sentinella solo recibe la alarma si la RAM/CPU está >95% en vivo; leer el histórico y correlacionarlo es **trabajo TUYO**.

### 6.5 🗜️ Archivado de los históricos de monitorización (orden de Leone 19/07 — CÓDIGO, no criterio propio)
Los históricos append-only (`sentinel-data.jsonl`, `token-meter.csv`,
`throttle-events.jsonl`, `agent-vitals.jsonl`, `vitals.jsonl`) crecen sin fin:
alimentan los gráficos de usage del juego, así que nunca deben borrarse
a mano — deben **archivarse con el flujo determinista**:
```bash
python3 /app/shared/skills/log_archive.py status          # profundidad y tamaños
python3 /app/shared/skills/log_archive.py run             # corta >30d → zips semanales
```
Lo que hace `run` (todo en código, tú solo lees el resumen JSON): las semanas más
antiguas de 30 días salen de los ficheros vivos y entran en
`logs/archive/logs-<YYYY>-Www.zip` (el zip de la semana crece en cada
pasada); el corte es atómico y una fila entra en el zip ANTES de desaparecer del
fichero vivo. Si se acaba el espacio (archivo >500MB o <1GB libre) borra por su
cuenta los zips MÁS ANTIGUOS y te los lista bajo `pruned`.
- Frecuencia: 1×/semana basta (domingo); entre semana solo `status`
  si el disco del paso 6 crece de forma anómala.
- `pruned` NO vacío → repórtalo EXPLÍCITAMENTE en el logbook y avisa al Capitano
  (es la única pérdida de datos del flujo, autorizada por Leone solo bajo
  presión de espacio).
- Excepción DELIBERADA a la regla de oro: este flujo está preautorizado por
  Leone (19/07) — no necesitas el OK del Capitano para `run`; para cualquier
  otro borrado fuera del flujo, sigue vigente la regla single-writer.
- Registra en la entrada: `log_archive: {archived_rows, weeks, pruned, free_gb}`.

### 7. 🔤 Locale UTF-8 de los panes (cosmético ≠ datos corruptos)
```bash
python3 /app/shared/skills/locale_health.py summary        # o --json
```
Dos medidas en una, y la segunda es la que cuenta. Lee el locale del **contenedor** (`/proc/1/environ` — NO el entorno de este proceso: CPython "coerce" por su cuenta `LC_CTYPE` a `C.UTF-8`, así que un check sobre `os.environ` daría por sano un contenedor roto) y luego **descodifica de forma ESTRICTA** un `capture-pane` de cada sesión viva. El exit code lleva el veredicto:
- **`0` ok** → registra `locale_health: ok` y sigue.
- **`1` cosmetic** (locale no UTF-8, CERO bytes inválidos) → los datos están **INTACTOS**: lo roto es el renderizado para quien se conecta desde fuera (`_` en lugar de cada letra acentuada). **Repórtalo al Capitano, no lo trates como una emergencia** y sobre todo no lo "repares": el fix es `LANG=C.UTF-8` en el `docker-compose.yml` del host y solo surte efecto al recrear el contenedor — fuera del alcance de un agente que corre DENTRO de él. Mitigación inmediata para el operador: `docker exec -it -e LC_ALL=C.UTF-8 jht tmux -u attach -r -t <sesión>`.
- **`2` data_corruption** (bytes inválidos dentro de un pane) → **P1, ESCALA** al Capitano con las sesiones listadas: aquí los agentes sí pueden leer una palabra por otra.

**Por qué ambos checks y no solo el primero**: `echo $LANG` puede decir "cosmético" pero NUNCA podrá decir "corrupto" — la descodificación estricta es la única de las dos que separa un defecto de visualización de unos datos dañados. El 2026-08-10 es lo que convirtió una sospecha («los agentes reciben palabras truncadas») en una medida (392 acentuadas íntegras, ni un byte inválido) y detuvo un fix apuntado al problema equivocado.

Registra `locale_health: {verdict, env, panes_scanned, corrupted_sessions}` en la entry.

## Logbook (append-only)
Cada ronda escribe UNA entrada densa en `/jht_home/logs/mantenitore-logbook.jsonl` (gemelo del logbook del Dottore), para que el siguiente Mantenitore pueda ver la tendencia:
```json
{"ts":"ISO-UTC","slot":"maintainer-daily","processes_health":{"all_ok":true,"dead":[]},
 "processes_respawned":[...],"sync_health":{"healthy":true,"problems":[]},
 "tools_health":{...},"repaired":[...],
 "escalated":[...],"deps_consolidated":[...],"gc_proposed":[...],"dedup_proposed":[...],
 "locale_health":{"verdict":"ok|cosmetic|data_corruption","panes_scanned":N},
 "disk":{"used_pct":N,"delta_vs_last":N},"ram":{...},"duration_sec":N,"capitano_ack":"..."}
```
Añade con `>>`, nunca sobrescribas. Resumen denso (como las notas de viaje del Dottore/Capitano): qué he encontrado, qué he reparado, qué he propuesto.

## Antipatrones
- ❌ Borrar/archivar sin el OK del Capitano (single-writer: propón). ÚNICA excepción: el flujo `log_archive.py` del paso 6.5, preautorizado por Leone.
- ❌ Auto-actualizar librerías a versiones nuevas (riesgo de roturas) — informa, no actualices por tu cuenta.
- ❌ Dejar una herramienta BROKEN sin repararla NI escalarla (es exactamente el bug silencioso de libatk).
- ❌ Dejar un bridge/daemon DEAD sin repararlo NI escalarlo (el mismo error, sobre los PROCESOS: es el crash del sentinel-bridge en betaC el 2026-06-27).
- ❌ Meterte en la salud de los AGENTES (sesiones/tokens/contexto) — eso es del Dottore.

## Véase también
- `shared/skills/process_health.py` — el canario de liveness de los procesos de soporte vital usado en el paso 0 (red de seguridad diaria; el gemelo-para-procesos de tool_health).
- `shared/skills/sync_health.py` — el canario de la cloud-sync usado en el paso 0.5 (pull churn / push 413 / cursores stale); de solo lectura, el gemelo-para-SYNC de process_health/tool_health.
- `shared/skills/tool_health.py` — el smoke-test reutilizado en el paso 1 (también gate en build-time + tick).
- `shared/skills/locale_health.py` — el canario del locale del paso 7 (locale del contenedor + descodificación UTF-8 estricta de los panes); read-only, distingue un defecto cosmético de datos corruptos.
- `shared/skills/log_archive.py` — el archivador determinista del paso 6.5 (corta semanas >30d → zip, hace pruning bajo presión de espacio).
- `.launcher/agent-watchdog.sh` — la recuperación RÁPIDA (cada 30s, `maybe_respawn_bridges`) para la que el paso 0 es la red de seguridad diaria; lección del 27/06: los bridges arrancan `setsid` detached, así que ni el respawn de pid1 ni `agent-watchdog` (que relanza sesiones tmux, no procesos Python) los cubren — si crashean se quedan caídos hasta que el contenedor reinicie.
- `agents/mantenitore/mantenitore.md` — persona/ciclo de vida del Mantenitore (dev3).
- `agents/_skills/resilience/SKILL.md` — la escalera anti-silencio para los agentes (dev3); su paso "classify" reutiliza `tool_health.py`.
- `agents/_skills/liveness-check/SKILL.md` — el gemelo del lado del Dottore (salud de los agentes), por la estructura.
