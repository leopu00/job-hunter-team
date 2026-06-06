<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: cache-prune
description: "Recuperar espacio en disco en las cachés compartidas de JHT (caché de wheels `uv` + log SQLite de `codex`) cada ~24h. Propiedad del Dottore — instancia única, se ejecuta al final de una ronda rutinaria cuando el equipo está inactivo. Nunca ejecutar en medio de una emergencia: el VACUUM de SQLite bloquea ~30s en una DB de 200 MB y robaría ciclos de una recuperación dirigida por el Sentinel. Migrado del Captain para que el Captain se enfoque en coordinación, no en mantenimiento."
allowed-tools: Bash(node /app/cli/bin/jht.js cache *), Bash(du *), Bash(df *)
---

# cache-prune — recuperar cachés compartidas

El directorio compartido `$JHT_HOME` acumula dos cachés que crecen monótonamente hasta ser recuperadas:

| Ruta                                  | Qué almacena                            | Crecimiento típico (muestra 2026-05-02) |
|---------------------------------------|-----------------------------------------|-----------------------------------------|
| `$JHT_HOME/.cache/uv/`                | caché de wheels para cada `uv pip install` | ~364 MB                               |
| `$JHT_HOME/.codex/logs_2.sqlite`      | telemetría SQLite de Codex (71% filas TRACE) | ~223 MB                            |

Ninguna es necesaria en disco: uv re-descarga si es necesario, Codex trunca filas TRACE de forma segura. Los números anteriores provienen de una ejecución continua; en un `$JHT_HOME` fresco empiezan en 0 y alcanzan cientos de MB en pocos días.

## El único comando seguro

```bash
node /app/cli/bin/jht.js cache prune
```

Idempotente y no-op cuando no hay nada que recuperar. Internamente:
1. `uv cache prune` — elimina wheels obsoletas (mantiene el set activo referenciado por instalaciones actuales).
2. SQLite `VACUUM` en `logs_2.sqlite` después de eliminar filas TRACE antiguas.
3. Limpieza de archivos temporales efímeros de Codex.

Cada paso tiene una puerta de seguridad: `idle > 1h` en las operaciones destructivas (bloqueo VACUUM, eliminación TRACE) — si el equipo está quemando tokens activamente, el paso se salta.

## Cuándo ejecutar

- 👨‍⚕️ **Final de una ronda rutinaria del Dottore** (~24h de ejecución continua, o al inicio de un día operativo inactivo).
- 📉 **Bajo demanda** si `du -sh $JHT_HOME/.cache $JHT_HOME/.codex` muestra crecimiento > 800 MB total.
- 🚫 **NUNCA** en medio de presupuesto crítico (proj > 95%) — el VACUUM de 30s bloquea el SQLite de Codex que el Sentinel lee a través del bridge.
- 🚫 **NUNCA** en reacción a una `[ORDINE]` del Sentinel — las órdenes demandan acciones de pacing/escalamiento, no mantenimiento.

## Seguridad: qué NO tocar

El equipo tiene *otras* cachés que lucen similares pero NO están dentro del alcance aquí:

| Ruta                                 | Por qué no tocar                                                  |
|--------------------------------------|-------------------------------------------------------------------|
| `.cache/ms-playwright/`              | binarios de navegador fijados por versión — re-descargar es lento + frágil |
| `.cache/claude-cli-nodejs/`          | caché de runtime del CLI de Anthropic, se recrea perezosamente pero es más grande cuando está caliente |
| `$JHT_HOME/logs/`                    | El estado del Sentinel vive aquí. Limpiarla pierde la ventana EMA y varios minutos de historial de monitoreo. |

El radio de explosión de `cache prune` se limita a las dos rutas en la tabla de arriba.

> ⚠️ **`cache clear` está prohibido.** Ese comando (un primo destructivo de `cache prune` expuesto por `jht`) limpia `logs/` junto con las cachés, destruyendo el estado del Sentinel. Si alguna vez sientes la necesidad de `cache clear`, escala al usuario en su lugar.

## Crecimiento anómalo — escalar

Si `du -sh` muestra una ruta *fuera* de los 2 objetivos anteriores creciendo rápido (ej. `.cache/ms-playwright/` se duplicó, `.codex/sessions/` inflándose), **NO** la podes por tu cuenta. Captura:

```bash
du -sh $JHT_HOME/.cache/* $JHT_HOME/.codex/*
df -h $JHT_HOME
```

...regístralo en `dottore-actions.jsonl` con `event=disk_anomaly` + la salida de `du`, y súrfalo al usuario vía el Captain (`jht-tmux-send CAPITANO`). Una nueva ruta creciendo podría significar que se añadió una herramienta nueva sin presupuesto para limpieza.

## Salida al log

Añadir a `/jht_home/logs/dottore-actions.jsonl`:

```json
{"ts": "ISO-UTC", "round_id": "...", "event": "cache_prune",
 "uv_freed_mb": 142, "codex_freed_mb": 87, "total_freed_mb": 229,
 "duration_sec": 31}
```

Si un paso fue saltado por la puerta de inactividad, establecer el correspondiente `_freed_mb` a `null` y añadir `"skipped": ["vacuum"]`.

## Anti-patrones

- ❌ Ejecutar `cache prune` desde el Captain — esa responsabilidad fue migrada aquí. El Captain coordina, el Dottore mantiene.
- ❌ Ejecutarlo mientras un Writer está a mitad de CV (su bucle toca la caché uv ocasionalmente para libs de pandoc/typst).
- ❌ Añadir un bucle tipo cron en el prompt del Dottore — el Dottore es one-shot ~30 min de cadencia, ajustas cache-prune al final de la ronda cuando tenga sentido, no en un horario fijo.
- ❌ Saltarse el wrapper `jht.js cache prune` para ejecutar `uv cache prune` / `sqlite vacuum` directamente — saltas la puerta de inactividad y el logging unificado.

## Ver también

- `agents/dottore/dottore.md` — cuándo en el ciclo de vida del Dottore encajar esta skill (solo al final de la ronda).
- `py-tools-audit` — skill de mantenimiento hermana (paquetes Python, cadencia ~semanal).
- `agents/_team/team-rules.md` T13 — regla de uv como único instalador (por qué existe la caché uv en primer lugar).
