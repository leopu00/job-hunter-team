<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: py-tools-audit
description: "Limpieza coordinada a nivel de equipo de los paquetes Python instalados bajo `$JHT_HOME/.local` mediante `uv pip install --user` (T13 magazzino). Gestionada por el Dottore. La auditoría NO es unilateral — solo los agentes Writer / Critic saben si una librería importada dinámicamente aún les sirve, por eso el flujo es broadcast → ventana de consentimiento de 1h → desinstalar el conjunto silencioso → re-auditoría. Como el Dottore es one-shot (~10 min por ronda, ~30 min de separación), la ventana de consentimiento de 1h abarca 2 rondas del Dottore: la ronda N inicia la auditoría + broadcast, la ronda N+1 recopila respuestas + desinstala."
allowed-tools: Bash(python3 /app/shared/skills/py_tools_audit.py *), Bash(uv pip uninstall *), Bash(jht-tmux-send *), Bash(tmux *), Bash(du *), Bash(xargs *)
---

# py-tools-audit — limpiar el magazzino Python compartido

`$JHT_HOME/.local/lib/python3.x/site-packages/` es la **única user-base compartida** de la que leen todos los agentes (T13). Cualquier agente puede hacer `uv pip install --user <pkg>` cuando necesita una librería, pero los agentes *no* desinstalan cuando cambian de enfoque — los paquetes se acumulan. Aproximadamente cada semana el magazzino supera los 800 MB y necesita una auditoría coordinada.

La auditoría es coordinada porque un `import` grep estático puede no detectar librerías cargadas dinámicamente en tiempo de ejecución (por ejemplo, un script en `tools/` que el Writer llama solo cuando una JD requiere un formato específico). Por tanto: preguntar antes de eliminar.

## Disparador

- ⏰ ~semanal (cada 7 días de ejecución continua), al inicio de un día operativo tranquilo
- 📈 bajo demanda cuando `du -sh /jht_home/.local` > 800 MB
- 🚀 antes de una release importante / entrega al usuario

## Flujo de dos rondas (porque el Dottore es one-shot)

```
Round N:    audit → broadcast de candidatos → guardar archivo de estado
…30 min…
Round N+1:  recopilar respuestas → calcular keep_set → desinstalar → re-audit → informe
```

Cada ronda registra su fase en `$JHT_HOME/logs/py-audit-state.json`:

```json
{"phase": "broadcast_sent", "round_id": "...", "ts": "ISO-UTC",
 "candidates": ["pymupdf", "pdfminer.six", "reportlab", "..."],
 "broadcast_at": "ISO-UTC"}
```

Cuando despiertes, **revisa este archivo primero**:
- archivo ausente o `phase=done` → ronda nueva, ve a "Round N" abajo
- `phase=broadcast_sent` y `now - broadcast_at >= 1h` → "Round N+1" abajo
- `phase=broadcast_sent` y `now - broadcast_at < 1h` → la ventana de consentimiento aún no ha cerrado, salta la auditoría en esta ronda

## Round N — iniciar la auditoría

### 1. Verificación de umbral

```bash
python3 /app/shared/skills/py_tools_audit.py --threshold-mb 800
```

- Exit `0` → nada urgente. Detente aquí, no hagas broadcast.
- Exit `2` → vale la pena limpiar. El script también imprime la *tabla de candidatos* — paquetes sin import activo, excluyendo la whitelist (dependencias transitivas + CLIs binarios fijados).

### 2. Broadcast a cada agente

Envía un mensaje `[PY-AUDIT]` a cada sesión de agente activa mediante `jht-tmux-send`:

```
[@dottore -> @<role>] [PY-AUDIT] candidates uninstall: pymupdf,
pdfminer_six, reportlab, weasyprint, pypdf, ...
If you USE one of these, reply within 1h with [KEEP <pkg>].
Silence = consent to uninstall.
```

La ventana de 1h se aplica por el **inicio de la siguiente ronda**, no por un `sleep` en esta ronda (el Dottore es one-shot). Persiste la hora del broadcast en `py-audit-state.json`.

### 3. Persistir estado y salir de la ronda

```json
{"phase": "broadcast_sent", "round_id": "...",
 "candidates": ["..."], "broadcast_at": "ISO-UTC"}
```

Fin del Round N. Auto-destrucción como de costumbre; el próximo Dottore (~30 min después) continuará desde aquí.

## Round N+1 — recopilar, desinstalar, informar

Se activa cuando `py-audit-state.json` muestra `phase=broadcast_sent` y ha pasado ≥1h.

### 1. Recopilar respuestas

Para cada agente al que se hizo broadcast, ejecuta `tmux capture-pane -t <SESSION> -p -S -200 | grep '\[KEEP '` para encontrar respuestas `[KEEP <pkg>]`. Construye el `keep_set`:

```
keep_set = (whitelist predeterminada) ∪ (cada <pkg> en cualquier respuesta [KEEP])
```

Silencio sobre un candidato = consentimiento para desinstalar.

### 2. Desinstalar el conjunto silencioso

```bash
python3 /app/shared/skills/py_tools_audit.py --candidates-only --keep <keep_set...> \
  | xargs -r uv pip uninstall --user -y
```

`xargs -r` omite la llamada cuando no hay nada que desinstalar (stdin vacío).

### 3. Re-auditoría + informe

```bash
python3 /app/shared/skills/py_tools_audit.py
du -sh /jht_home/.local
```

Calcula `freed_mb = before - after` y notifica al usuario a través del Capitano:

```bash
jht-tmux-send CAPITANO "[@dottore -> @capitano] [REPORT] py-audit done: <N> packages removed, <freed_mb> MB freed. Magazzino now <after_mb> MB."
```

### 4. Restablecer estado

```json
{"phase": "done", "round_id": "...", "completed_at": "ISO-UTC",
 "removed": ["..."], "freed_mb": 142}
```

Un `py-audit-state.json` limpio con `phase=done` permite que la siguiente ronda reinicie desde cero.

## Reglas estrictas

- **Nunca desinstalar sin el broadcast + ventana de 1h.** Algunos paquetes se cargan dinámicamente y no aparecerán en un grep estático — el broadcast es la única forma de detectarlos.
- **Nunca tocar `ALWAYS_KEEP`.** Las notas transitivas (numpy, pillow, packaging, etc.) están ahí por buenas razones; el script de auditoría ya las excluye.
- **Si un Writer protesta tras una desinstalación**, reinstala inmediatamente y añade el paquete a `ALWAYS_KEEP`. Trátalo como un bug de proceso (el broadcast no alcanzó al agente), no como culpa del Writer.
- **Nunca sudo-uninstall.** Mantente dentro de `uv pip uninstall --user`. T13 prohíbe `sudo pip` por la misma razón que prohíbe `sudo pip install`.

## Anti-patrones

- ❌ Ejecutar ambas rondas en un solo despertar del Dottore con `sleep 3600` — excede el presupuesto de 10 min por ronda y rompe la cadencia del watchdog.
- ❌ Inferir el keep set desde tu propio `import` grep sin hacer broadcast — fallos silenciosos en cargas dinámicas.
- ❌ Desinstalar > 100 paquetes en una sola ronda — demasiado ruidoso, difícil de revertir. Limita al lote natural de la auditoría (lo que devuelva el script de umbral).
- ❌ Ejecutar esta skill en reacción a un `[ORDINE]` del Sentinel — las órdenes demandan pacing/scaling, no mantenimiento. py-audit espera una ventana de inactividad.

## Ver también

- `cache-prune` — skill de mantenimiento hermana (uv wheel cache, ~24h de cadencia). Ejecútala primero; a veces reduce el tamaño del magazzino por debajo de 800 MB y hace innecesaria la auditoría.
- `agents/_team/team-rules.md` T13 — regla de instalación (`uv pip install --user`) que justifica esta auditoría.
- `agents/dottore/dottore.md` — ciclo de vida del Dottore; esta skill abarca 2 rondas del ciclo de vida mediante el archivo de estado.
