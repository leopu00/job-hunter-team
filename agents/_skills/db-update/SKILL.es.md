<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: db-update
description: Actualizar registros existentes en la DB de JHT (positions / applications). Usarlo para promover posiciones a checked/excluded, escribir puntuación/veredicto del Critic, marcar applications como enviadas, actualizar salario, last-checked, etc. Siempre después de un `db-query` que confirme el estado actual del registro.
allowed-tools: Bash(python3 *)
---

# db-update — actualizaciones de registros en la DB de JHT

Wrapper en `/app/shared/skills/db_update.py`. Actualiza campos específicos en registros existentes. **No crea** registros — para eso, ver `db-insert`.

## Patrón general

```bash
python3 /app/shared/skills/db_update.py <table> <id> --<field> <value> [--<field> <value>...]
```

Tablas: `position`, `application`.

## Posiciones

```bash
# Promover a checked / excluded (trabajo del Analyst)
python3 /app/shared/skills/db_update.py position 42 --status checked
python3 /app/shared/skills/db_update.py position 42 --status excluded

# Marcador last-checked (enlace confirmado vivo — también usado como reclamación anti-colisión)
python3 /app/shared/skills/db_update.py position 42 --last-checked now

# Liveness: --is-open / --last-open-check hacen avanzar por sí solos también
# last_checked, así una posición reverificada sale de la cola de cuidado (que
# filtra por la más reciente de las dos fechas). --last-checked solo para forzarla.
python3 /app/shared/skills/db_update.py position 42 --is-open false --last-open-check now

# Salario declarado en el JD
python3 /app/shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Salario estimado (glassdoor / levels.fyi / estimación del analyst)
python3 /app/shared/skills/db_update.py position 42 --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Familia de rol (categoría semántica).
python3 /app/shared/skills/db_update.py position 42 --role-family "Technical Writing"

# Ubicación estructurada (Analyst). Ejemplo completo para "Dublin, Ireland" híbrido:
python3 /app/shared/skills/db_update.py position 42 \
  --loc-city "Dublin" --loc-region "Leinster" \
  --loc-country "Ireland" --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" --work-country-code "IE" \
  --is-multi-location false

# Ejemplos de casos especiales:
# A) "Europe Remote" → country=NULL, continent=EU, work_country del HQ de la empresa
python3 /app/shared/skills/db_update.py position 42 \
  --loc-continent "Europe" --work-mode "remote" \
  --work-country "United States" --work-country-code "US" \
  --location-notes "Remote within EU, US-based company"

# B) "Italy" + full_remote
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Italy" --loc-country-code "IT" --loc-continent "Europe" \
  --work-mode "remote" --work-country "Italy" --work-country-code "IT"

# E) Multi-ubicación mismo país ("Barcelona / Malaga")
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Spain" --loc-country-code "ES" --loc-continent "Europe" \
  --work-mode "hybrid" --work-country "Spain" --work-country-code "ES" \
  --is-multi-location true --location-notes "Barcelona or Málaga (candidato sceglie)"

# Para "limpiar" un campo (set NULL) pasa cadena vacía:
python3 /app/shared/skills/db_update.py position 42 --loc-city ""
```

## Applications

```bash
# Veredicto del Critic (por ronda: NEEDS_WORK / PASS / REJECT) + puntuación 0-10 + notas
python3 /app/shared/skills/db_update.py application 42 --critic-verdict NEEDS_WORK --critic-score 5.0 --critic-notes "needs more detail on project X"

# CV/carta de presentación comprometidos (Writer marca como escrito)
python3 /app/shared/skills/db_update.py application 42 --written-at now

# Promover a ready después del PASS del Critic — solo Writer, en application-flow Paso 7
python3 /app/shared/skills/db_update.py application 42 --status ready

# El usuario confirmó que la candidatura fue enviada
python3 /app/shared/skills/db_update.py application 42 --applied-at "2026-02-28" --applied-via linkedin
python3 /app/shared/skills/db_update.py application 42 --applied true

# Respuesta recibida (`interview` / `rejected` / `ghosted`)
python3 /app/shared/skills/db_update.py application 42 --response "rejected" --response-at now
```

### Las transiciones de estado de posición se auto-registran (bug #14)

Cada llamada a `db_update.py position <id> --status <s>` que realmente cambia `positions.status` inserta una fila en `position_state_transitions` con `from_state`, `to_state`, `ts`, `by_agent` (de `JHT_AGENT_NAME`), y las `--notes` que pasaste (si las hay). Lo mismo aplica para el `db_insert.py position` inicial (registrado como `NULL → 'new'`).

No tienes que hacer nada — el wrapper lo maneja. No lo evites con SQL crudo: un workaround `python3 -c "import sqlite3; UPDATE positions SET status=..."` salta el log de transiciones y hace que los gráficos de throughput / funnel subcuenten.

### Puerta de escritor único en `applications.status='ready'` (bug #21)

`applications.status='ready'` es **establecido exclusivamente por el Scrittore** en `application-flow` Paso 7, **solo después** del PASS del Critic en la 3.ª ronda. Esta es la puerta que hace visible el CV en el dashboard `/ready` del usuario. Otros agentes:

- **Critic**: escribe `critic_verdict` + `critic_score` solamente. Nunca `status`.
- **Capitano**: nunca escribe `applications.status`. Puede leerlo.
- **Mentor / Assistente**: solo lectura en `applications`.

Sin esta puerta, el Capitano puede reportar "12 ready" verbalmente mientras la DB aún muestra 0 — exactamente la divergencia que corrigió el bug #21.

## Reglas de seguridad

1. **Leer primero.** Ejecuta `db-query position <id>` (o `application`) para ver el estado actual antes de escribir. Sobrescrituras ciegas producen registros inconsistentes.
2. **El flujo de estados es solo hacia adelante.** Transiciones legítimas: `new → checked → scored → writing → ready → applied → response`. `excluded` es alcanzable desde cualquier paso pero ningún paso retrocede. No reversar.
3. **Timestamp `now`.** El wrapper convierte la cadena literal `now` en el timestamp actual. No pases `$(date)` — el parsing se maneja del lado de Python.
4. **Etiquetas de exclusión en `--notes`.** Al marcar una posición como `excluded`, prefija las notas con una de las etiquetas canónicas: `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` · `[STACK]`. Misma taxonomía usada por el Analyst (ver `agents/analista/analista.md` REGOLA-06).

## No usarlo para

- Lecturas: usar **`db-query`**
- Crear registros: usar **`db-insert`** (solo el Scout INSERTA posiciones)
- Cambios de esquema: nunca ejecutar `sqlite3` crudo contra las tablas — evita claves foráneas y el journaling WAL de Next.js
