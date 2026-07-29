<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: db-query
description: Consultar la DB SQLite de JHT (posiciones, applications, estadísticas). Usarlo cada vez que necesites estado de posición, colas por agente, puntuaciones, tasa de coincidencia o conteos de registros. Ruta de DB desde $JHT_DB, respaldo /jht_home/jobs.db.
allowed-tools: Bash(python3 *)
---

# db-query — consultas a la DB de JHT

La base de datos principal es `$JHT_DB` (por defecto `/jht_home/jobs.db`). Todos los wrappers de consulta viven en `/app/shared/skills/db_query.py`. Esta skill expone las invocaciones más comunes.

## Estadísticas y dashboard

```bash
# Conteos agregados por estado + tasa de coincidencia (vista general del usuario)
python3 /app/shared/skills/db_query.py dashboard

# Estadísticas numéricas (totales por tabla)
python3 /app/shared/skills/db_query.py stats
```

## Posiciones

```bash
# Listar por estado
python3 /app/shared/skills/db_query.py positions --status new
python3 /app/shared/skills/db_query.py positions --status checked
python3 /app/shared/skills/db_query.py positions --status excluded

# Filtrar por puntuación mínima
python3 /app/shared/skills/db_query.py positions --min-score 70

# Detalle de una posición (todos los campos)
python3 /app/shared/skills/db_query.py position 42

# ¿URL/ID duplicado? (útil para el SCOUT antes del INSERT)
python3 /app/shared/skills/db_query.py check-url 4361788825
```

## Actividad del equipo — quién produjo y quién se calló

```bash
# Cada transición de posición de los últimos N minutos + recuentos por agente
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
python3 /app/shared/skills/db_query.py recent-activity --minutes 30 --json
```

Salida: `per-agente: analista-1=9, scorer-1=7`, luego una línea por transición —
`14:22:07 scorer-1 #22 checked→scored`, `14:19:51 analista-1 #27 new→excluded — [DEAD_LINK]`
(horas en UTC). **Sustituye** los mensajes `[START]`/`[DONE]` de los workers, retirados el
2026-07-27: en un equipo de primer arranque esos bookends eran 30 de los 37 mensajes que recibió el
Capitano en ~1,5h, por un estado que ya estaba en la DB.

⚠️ **Lista quién PRODUCE.** Un agente que se ha parado no aparece en absoluto — no destaca,
**desaparece**. Para distinguir un stall de un idle legítimo, cruza con `tmux list-sessions`
(¿vivo?) y la cola `next-for-*` del rol (¿tenía algo que hacer?): **vivo + cola no vacía + cero
transiciones = stall**; vivo + cola vacía + cero transiciones = idle, déjalo en paz.

## Colas por agente (pipeline)

```bash
python3 /app/shared/skills/db_query.py next-for-analista
python3 /app/shared/skills/db_query.py next-for-scorer
python3 /app/shared/skills/db_query.py next-for-scrittore
python3 /app/shared/skills/db_query.py next-for-critico   # ⚠️ legacy — en V5 el Critic es generado por el Writer por ronda, no extraído de una cola
```

Cada uno retorna el siguiente lote listo para ese rol, siguiendo el flujo de estados V5: `new → checked → scored → writing → ready → applied → response` (con `excluded` como salida lateral desde cualquier paso).

## Cuándo usarlo

- Antes de decisiones de escalamiento (el Captain necesita saber si hay ≥ 3 registros `checked` antes de generar un SCORER)
- Antes de INSERTs (el Scout debe verificar duplicados de URL)
- En respuesta a preguntas del usuario como "cuántos scouts activos / cuántas applications pendientes / puntuación más alta"
- Antes de cualquier actualización — ver la skill `db-update`: siempre leer el registro primero para evitar pisar la escritura de otro

## No usarlo para

- Escrituras: usar **`db-update`** / **`db-insert`** en su lugar
- Cambios de esquema: manejados por `db_migrate.py` — no expuesto como skill (operación del usuario)
