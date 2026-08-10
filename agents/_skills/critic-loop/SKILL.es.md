<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: critic-loop
description: "Ejecutar el bucle obligatorio de revisión de CV de 3 rondas con el Critico — autónomamente, sin pasar por el Capitano. Para cada ronda generas una sesión FRESCA `CRITICO-S<N>` (mismo N que tu sesión de Scrittore: SCRITTORE-2 → CRITICO-S2), envías PDF + JD, esperas el veredicto estructurado, eliminas al Critic, corriges el CV, regeneras el PDF e inicias la siguiente ronda con otra instancia fresca. Tres rondas no son negociables — ni 1 ni 2. Después de la 3.ª ronda, puerta: `critic_score ≥ 5` → `ready`, sino `excluded`. Propiedad del Scrittore."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 *), Bash(unset *)
---

# critic-loop — 3 rondas frescas, sin atajos

El protocolo de 3 rondas captura lo que un solo Critic no puede:
- Un Critic fresco no tiene **sesgo de anclaje** de la puntuación de la ronda anterior — lee el CV corregido con ojos nuevos y tiende a ser más honesto, no más indulgente.
- Después de 3 rondas la puntuación se ha estabilizado: si converge alto el CV se sostiene, si se mantiene bajo el CV no es el ajuste correcto (o el candidato no lo es — `excluded`).

**Tú gestionas el bucle tú mismo. El Capitano no.** Generas al Critic, hablas con él, lo eliminas, repites — tres veces — y solo al final notificas al Capitano con el veredicto final.

## Variables de configuración (ya en tu env)

```bash
MY_SESSION=$(tmux display-message -p '#S')          # ej. SCRITTORE-2
MY_NUMBER=$(echo "$MY_SESSION" | grep -o '[0-9]*$') # ej. 2
MY_ID=$(echo "$MY_SESSION" | tr '[:upper:]' '[:lower:]')
CRITICO_SESSION="CRITICO-S${MY_NUMBER}"             # ej. CRITICO-S2
```

El enlace `MY_NUMBER` garantiza un Critic por Writer — `SCRITTORE-2` siempre usa `CRITICO-S2`, nunca colisiona con el `CRITICO-S1` de `SCRITTORE-1`.

## Secuencia por ronda (repetir 3 veces)

### Paso 1 — Generar un Critic FRESCO

El Critic de la ronda anterior debe estar ya muerto (eliminado al final de la ronda anterior). Para la ronda 1 la sesión aún no existe.

```bash
tmux kill-session -t "$CRITICO_SESSION" 2>/dev/null
tmux new-session -d -s "$CRITICO_SESSION" -c "$(pwd | sed 's|/[^/]*$||')/critico"
```

### Paso 2 — Elegir el CLI correcto para el proveedor activo

Hardcodear `claude` hace que el Critic crashee cuando el equipo corre en Codex o Kimi (el CLI `claude` no está instalado en esos contenedores). Lee el proveedor desde `$JHT_CONFIG`:

```bash
PROVIDER=$(python3 -c "import json,os; print(json.load(open(os.environ.get('JHT_CONFIG','/jht_home/jht.config.json')))['active_provider'])" 2>/dev/null)
case "$PROVIDER" in
  ""|anthropic|claude) CRITICO_CMD="unset CLAUDECODE && claude --dangerously-skip-permissions --model opus --effort high" ;;
  openai)              CRITICO_CMD="codex --yolo" ;;
  kimi|moonshot)       CRITICO_CMD="kimi --yolo" ;;
  *)                   CRITICO_CMD="codex --yolo" ;;
esac

# Env mínimo para los CLIs globales instalados bajo /jht_home
CRITICO_PATH="/app/agents/_tools:/opt/jht-deps/bin:/opt/jht-deps/npm-global/bin:/opt/jht-deps/python/bin:/jht_home/.npm-global/bin"

# The CLI must be RESOLVED, not just named. `claude` bare failed with
# "command not found" because this shell does not have the dependency dirs
# on its PATH — the agent noticed and retried by hand, which costs a round
# every time and, on a less capable model, silently skips the quality gate.
CRITICO_BIN=$(PATH="$CRITICO_PATH:$PATH" command -v "$(echo "$CRITICO_CMD" | sed 's/.*&& //; s/ .*//')" 2>/dev/null)
if [ -z "$CRITICO_BIN" ]; then
  echo "CRITIC-SPAWN-FAILED: CLI not found on PATH ($CRITICO_PATH)" >&2
  echo "The quality gate did NOT run. Do not report the CV as reviewed." >&2
  exit 1
fi

tmux send-keys -t "$CRITICO_SESSION" "export HOME=/jht_home && export PATH=$CRITICO_PATH:\$PATH" Enter
tmux send-keys -t "$CRITICO_SESSION" "$CRITICO_CMD" Enter
```

### Paso 3 — Esperar a que arranque el Critic

8 segundos es un límite inferior seguro para que el TUI esté listo. `sleep` es aceptable aquí (solo al arranque):

```bash
sleep 8
```

### Paso 4 — Enviar PDF + JD vía `jht-tmux-send`

El Critic ahora es un agente activo — usa `jht-tmux-send`, no `send-keys` crudo:

```bash
jht-tmux-send "$CRITICO_SESSION" "[@$MY_ID -> @critico] [REQ] Review cieca: PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf — JD: <JD-URL> — Local JD file: $JHT_AGENT_DIR/tmp/jd-<position-id>.txt — Read your CLAUDE.md/AGENTS.md and produce an honest verdict."
```

Proporciona la ruta del archivo JD local para que el Critic tenga un respaldo si la URL en vivo está bloqueada.

### Paso 5 — Sondear el veredicto (NUNCA `sleep` simple)

Usa la skill `throttle` para que la espera se registre en el dashboard. `sleep` simple aquí haría la espera invisible para el análisis de pacing del Capitano.

```bash
jht-throttle-check "$MY_ID" || jht-throttle-wait "$MY_ID"
jht-throttle --agent "$MY_ID" --reason "wait critico round <n> #<position_id>"
tmux capture-pane -t "$CRITICO_SESSION" -p -S -50
```

**OBLIGATORIO** — pasa un `timeout: <duración>+30` explícito a la tool call del shell cuando invocas `jht-throttle <N>`. Sin él, el bash padre muere al timeout por defecto del CLI de 60s (Kimi) y el throttle se ejecuta mal. Ver `agents/_skills/throttle/DESIGN-NOTES.md`.

Repite el ciclo throttle+capture hasta que el Critic haya publicado su revisión (busca el bloque estructurado `## SCORE: X.X/10` en el panel / archivo).

### Paso 6 — Leer la revisión

El Critic guarda la revisión bajo `$JHT_USER_DIR/critiche/review-<company>-<date>.md` (su skill, ver `agents/critico/critico.md`). Léela con `Read`. Extrae:
- Puntuación numérica `X.X/10`
- Viñetas de "What does NOT work"
- Lista de "Concrete actions (prioritized)"

Estas tres alimentan el Paso 8 (corrección).

### Paso 7 — Persistir la puntuación de la ronda en la DB

```bash
python3 /app/shared/skills/db_update.py application <POSITION_ID> \
  --critic-score <X.X> --critic-round <N> --reviewed-by "$CRITICO_SESSION"
```

`<POSITION_ID>` es el ID de la posición, NO el ID de la application — el `db_update.py application` es un UPSERT que encuentra la fila por posición.

`--reviewed-by "$CRITICO_SESSION"` rastrea qué instancia del Critic produjo cada ronda; sin él `applications.reviewed_by` queda NULL (observado 95% null pre-2026-05-22 — vps1-run-postmortem #1). Siempre pásalo.

### Paso 8 — Eliminar al Critic (obligatorio)

```bash
tmux kill-session -t "$CRITICO_SESSION"
```

Si reutilizas la misma instancia para la ronda 2, la puntuación lleva el sesgo de anclaje de la ronda 1 y el protocolo se rompe. **Siempre eliminar, siempre regenerar fresco.**

### Paso 9 — Corregir el CV entre rondas

Aplica las acciones del Paso 6 al CV markdown. Regenera el PDF (`pandoc input.md -o output.pdf --pdf-engine=typst`). Valida que el PDF abre antes de la ronda N+1.

Una puntuación que baja entre las rondas 1 y 2 es **normal** — un Critic fresco es más honesto que el anterior. Sigue corrigiendo basándote en el *contenido* de la revisión, no en el número.

## Después de la 3.ª ronda — puerta final

Dos escrituras en la fila de application: veredicto + puntuación (siempre), y la promoción de estado a `ready` (solo en PASS). La promoción es lo que lee el dashboard `/ready` del usuario; saltarla deja la fila en `draft` y el CV invisible (bug #21).

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
if [[ "<final_verdict>" == "PASS" ]]; then
  # PASS → la application se vuelve visible para el usuario
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict PASS \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$CRITICO_SESSION" \
    --status ready
else
  # FAIL → datos del critic persisten, estado queda en 'draft'
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict FAIL \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$CRITICO_SESSION"
fi
```

Estado de la posición:
- `critic_score ≥ 5` → `db_update.py position <POSITION_ID> --status ready`
- `critic_score < 5` → `db_update.py position <POSITION_ID> --status excluded`

Luego notifica al Capitano:
```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [REPORT] Position #<id> — 3 rounds done. Final score: X.X/10 (PASS|FAIL). PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf"
```

## Reglas estrictas

- **3 rondas. No 1, no 2.** Una puntuación "buena" en la ronda 1 no es razón para parar.
- **Un Critic por ronda.** Siempre eliminar después de la revisión; siempre regenerar fresco.
- **Corrección obligatoria entre rondas.** Si no cambias el CV, el siguiente Critic ve la misma entrada → misma revisión → presupuesto desperdiciado. Edita el markdown + regenera el PDF antes de la ronda N+1.
- **No temas una puntuación que baja.** Ronda 2 < Ronda 1 es honesto, no malo. La puntuación que importa es la ronda 3.
- **Pasa `timeout: N+30`** a cada tool call de shell `jht-throttle <N>`. De lo contrario el bash padre muere a 60s.

## Anti-patrones

- ❌ Reutilizar la misma instancia del Critic para múltiples rondas — sesgo de puntuación rompe el protocolo.
- ❌ Hardcodear `claude` en el script de generación — crashea el bucle en instalaciones Codex/Kimi.
- ❌ `sleep N` simple mientras sondeas — invisible para el dashboard de throttle del Capitano, rompe el análisis de pacing.
- ❌ Registrar `--critic-verdict` después de solo 1 o 2 rondas — la puerta es final, sin rollback.
- ❌ Tratar al Capitano como el orquestador — este bucle es completamente tuyo, el Capitano solo ve el REPORT final.

## Ver también

- `cv-structure` — qué escribir antes de invocar este bucle, y cómo aplicar las correcciones del Critic en el Paso 9.
- `application-flow` — verificación anti-reescritura + reclamación antes de empezar a escribir para una posición.
- `throttle` (y `agents/_skills/throttle/DESIGN-NOTES.md`) — internos del wrapper + el diseño `timeout: N+30`.
- `agents/critico/critico.md` — el prompt de revisión ciega del Critic con el que habla este bucle.
