<!-- @translation: es, ai-translated 2026-06-06 -->
# Esquema de Base de Datos — jobs.db (V6)

**Actualizado**: 2026-05-29
**Versión del esquema**: `PRAGMA user_version = 6`
**Cambios respecto a V5**: añadidas columnas `positions.write_requested` (INTEGER DEFAULT 0) y `positions.write_requested_at` (TIMESTAMP) para Writer-on-demand. El usuario selecciona desde el panel web (botón "Escribir CV") o vía Telegram (`/cv <id>`) las posiciones para las que desea un CV; el Capitán genera Escritores on-demand solo cuando el flag está activado. Migración idempotente mediante `_migrate_positions_write_requested()` (ALTER TABLE ADD COLUMN). Ver BACKLOG [JHT-WRITER-ON-DEMAND] (2026-05-29) y mig Supabase 024.
**Cambios V4→V5**: añadida tabla `pending_user_messages` para el patrón fallback de notificaciones vía cloud sync (decisión 2026-05-13 — Telegram caído/no configurado ⇒ escribe en DB ⇒ cloud sync ⇒ panel web). La migración es no destructiva: `CREATE TABLE IF NOT EXISTS` + trigger touch_updated_at estándar. Los DB pre-V5 se auto-actualizan en la primera `ensure_schema()`.
**Cambios V3→V4**: añadidas columnas `created_at` y `updated_at` uniformes en las 5 tablas de datos, con `DEFAULT CURRENT_TIMESTAMP` (DB nuevas) y trigger `touch_updated_at` (AFTER UPDATE) que mantiene `updated_at` actualizado automáticamente en cada UPDATE. Los campos de dominio (`scored_at`, `applied_at`, `written_at`, `analyzed_at`, `found_at`, `last_checked`) permanecen para la semántica de eventos. Migración retroactiva automática mediante `_migrate_v3_to_v4()` en `shared/skills/_db.py`: ALTER TABLE ADD COLUMN (sin DEFAULT — límite de SQLite) + UPDATE de las filas existentes con los campos de dominio `*_at` como fallback (ej. `created_at = COALESCE(found_at, CURRENT_TIMESTAMP)`).
**Cambios V2→V3**: añadido `CHECK` constraint en `positions.status`. Migración mediante `_migrate_v2_to_v3()`.
**Ruta**: `$JHT_HOME/jobs.db` (canónica) o `$JHT_DB=<archivo>`. Fuera del contenedor la copia del repo `shared/data/jobs.db` debe PEDIRSE con `JHT_DB_FALLBACK=1`: sin ninguna de estas el módulo falla en vez de adivinar una ruta (O-26).
**Scripts de habilidades**: `shared/skills/`

Este archivo es la REFERENCIA OFICIAL del esquema de la base de datos. Todos los agentes deben leer ESTE archivo para conocer la estructura de las tablas y los comandos disponibles.

---

## Tablas

### companies
| Columna | Tipo | Default | Notas |
|---------|------|---------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| name | TEXT NOT NULL UNIQUE | | Nombre de la empresa (clave de coincidencia) |
| website | TEXT | | URL del sitio web corporativo |
| hq_country | TEXT | | País de la sede principal |
| sector | TEXT | | Sector (fintech, ai, etc.) |
| size | TEXT | | Tamaño (startup, PYME, enterprise) |
| glassdoor_rating | REAL | | Valoración en Glassdoor |
| red_flags | TEXT | | Señales de alerta encontradas |
| culture_notes | TEXT | | Notas sobre la cultura empresarial |
| analyzed_by | TEXT | | Quién la analizó (analista-1, etc.) |
| analyzed_at | TIMESTAMP | CURRENT_TIMESTAMP | Cuándo fue analizada |
| verdict | TEXT | | GO, CAUTIOUS, NO_GO |
| logo | TEXT | | **mig 056** — data-URI base64 del logo (≤ ~35KB) — lo escribe SOLO `logo_fetch.py` |
| logo_source | TEXT | | **mig 056** — URL fuente del logo (audit/refresh) |
| logo_fetched | INTEGER | 0 | **mig 056** — 1 = extracción intentada (patrón office_geocoded); cola `next-for-logo-missing` |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserción de fila |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — actualizado automáticamente en cada UPDATE mediante trigger |

### positions
| Columna | Tipo | Default | Notas |
|---------|------|---------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| title | TEXT NOT NULL | | Título de la posición |
| company | TEXT NOT NULL | | Nombre de la empresa (texto) |
| company_id | INTEGER FK | NULL | Enlace a companies(id) — resuelto automáticamente |
| location | TEXT | | Ubicación unificada (Remote EU, London, etc.) |
| remote_type | TEXT | | full_remote, hybrid, onsite |
| salary_declared_min | INTEGER | | Salario declarado en la JD — mínimo |
| salary_declared_max | INTEGER | | Salario declarado en la JD — máximo |
| salary_declared_currency | TEXT | EUR | Moneda del salario declarado |
| salary_estimated_min | INTEGER | | Salario estimado — mínimo |
| salary_estimated_max | INTEGER | | Salario estimado — máximo |
| salary_estimated_currency | TEXT | EUR | Moneda del salario estimado |
| salary_estimated_source | TEXT | | Fuente de la estimación: glassdoor, levels.fyi, manual |
| url | TEXT | | URL de la descripción del puesto |
| source | TEXT | | linkedin, indeed, glassdoor, dynamite, etc. |
| jd_text | TEXT | | Texto COMPLETO de la descripción del puesto |
| requirements | TEXT | | Requisitos extraídos de la JD |
| found_by | TEXT | | Quién la encontró (scout-1, etc.) |
| found_at | TIMESTAMP | CURRENT_TIMESTAMP | Cuándo fue encontrada |
| deadline | TEXT | | Fecha límite (YYYY-MM-DD o "no presente") |
| status | TEXT | new | new → checked → scored → writing → ready → applied → response · `excluded` desde cualquier paso. **V3: restringido por `CHECK` constraint** — los valores que no están en esta lista son rechazados con `IntegrityError`. |
| notes | TEXT | | Notas libres |
| last_checked | TIMESTAMP | | Última verificación de enlace/JD |
| write_requested | INTEGER | 0 | **V6** — `1` = el usuario ha solicitado un CV para esta posición (mediante botón web o `/cv` Telegram). El Capitán consulta esta columna para generar Escritores on-demand. |
| write_requested_at | TIMESTAMP | NULL | **V6** — cuándo el usuario solicitó el CV. Usado por el Capitán para el ordenamiento FIFO al generar Escritores. |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserción de fila |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — actualizado automáticamente en cada UPDATE mediante trigger |

### position_highlights
| Columna | Tipo | Default | Notas |
|---------|------|---------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL | | Enlace a positions(id) |
| type | TEXT NOT NULL | | pro, con |
| text | TEXT NOT NULL | | Texto del pro/contra |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserción de fila |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — actualizado automáticamente en cada UPDATE mediante trigger |

### scores
| Columna | Tipo | Default | Notas |
|---------|------|---------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Enlace a positions(id) |
| total_score | INTEGER NOT NULL | | Puntuación total 0-100 |
| stack_match | INTEGER | | Sub-puntuación stack /40 |
| remote_fit | INTEGER | | Sub-puntuación remoto /25 |
| salary_fit | INTEGER | | Sub-puntuación salario /20 |
| experience_fit | INTEGER | | Sub-puntuación experiencia |
| strategic_fit | INTEGER | | Sub-puntuación estratégico /15 |
| breakdown | TEXT | | Desglose de la puntuación |
| notes | TEXT | | Notas del scorer |
| scored_by | TEXT | | Quién asignó la puntuación |
| scored_at | TIMESTAMP | CURRENT_TIMESTAMP | Cuándo se puntuó |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserción de fila |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — actualizado automáticamente en cada UPDATE mediante trigger |

### applications
| Columna | Tipo | Default | Notas |
|---------|------|---------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Enlace a positions(id) |
| cv_path | TEXT | | Ruta del CV en markdown |
| cl_path | TEXT | | Ruta de la carta de presentación en markdown |
| cv_pdf_path | TEXT | | Ruta del CV en PDF |
| cl_pdf_path | TEXT | | Ruta de la carta de presentación en PDF |
| critic_verdict | TEXT | | PASS, NEEDS_WORK, REJECT |
| critic_score | REAL | | Nota del crítico (1-10) |
| critic_notes | TEXT | | Notas del crítico |
| status | TEXT | draft | draft (por defecto) — el flag operativo es `applied` (BOOLEAN). Los estados `review/approved` no están actualmente poblados por los agentes. |
| written_at | TIMESTAMP | | Cuándo se creó el CV |
| applied_at | TIMESTAMP | | Cuándo se envió la candidatura |
| applied_via | TEXT | | Dónde fue enviada (linkedin, sitio, etc.) |
| response | TEXT | | Respuesta recibida |
| response_at | TIMESTAMP | | Cuándo llegó la respuesta |
| written_by | TEXT | | Quién lo escribió (scrittore-1, etc.) |
| reviewed_by | TEXT | | Quién hizo la revisión |
| critic_reviewed_at | TIMESTAMP | | Establecido automáticamente con --critic-score |
| applied | BOOLEAN | 0 | TRUE si el usuario ha enviado |
| interview_round | INTEGER | NULL | Fase de la entrevista (1, 2, 3...) |
| cv_drive_id | TEXT | | ID del archivo en Google Drive del CV PDF |
| cl_drive_id | TEXT | | ID del archivo en Google Drive de la carta PDF |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserción de fila |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — actualizado automáticamente en cada UPDATE mediante trigger |

### pending_user_messages

**V5** — cola de notificaciones al usuario con fallback al panel web cuando Telegram no está disponible/configurado. Cada agente que quiere comunicarse con el usuario hace una INSERT aquí ANTES de intentar Telegram: si el envío por Telegram tiene éxito, el agente actualiza `delivered_via='telegram'`; si falla o Telegram no está configurado, deja `delivered_via='web'` y la fila se sincroniza en Supabase mediante `jht cloud push` → el panel web la presenta al usuario. La respuesta del usuario vía web regresa en las columnas `user_reply`/`user_reply_at`; en el siguiente ciclo el agente ve el marcador y responde por el mismo canal.

| Columna | Tipo | Default | Notas |
|---------|------|---------|-------|
| id | INTEGER | PK AUTOINCREMENT | |
| agent | TEXT | NOT NULL | Quién escribe: `capitano`, `mentor`, `assistente`, ... |
| body | TEXT | NOT NULL | Texto del mensaje (markdown permitido) |
| kind | TEXT | 'notification' | `notification` / `question` / `digest` / `alert` |
| related_position_id | INTEGER | FK positions(id) | Opcional — para notificaciones ligadas a una oferta |
| delivered_via | TEXT | NULL | `telegram` (entregado vía bot) / `web` (pendiente en panel) / NULL (en cola) |
| delivered_at | TIMESTAMP | | Cuándo se entregó en el canal elegido |
| acknowledged_at | TIMESTAMP | | El usuario ha leído/descartado vía panel |
| user_reply | TEXT | | Respuesta del usuario vía panel web (opcional) |
| user_reply_at | TIMESTAMP | | Cuándo respondió el usuario |
| agent_seen_reply_at | TIMESTAMP | | Cuándo el agente vio la respuesta — usado por el marcador de protección prompt-injection para evitar procesos duplicados |
| cloud_synced_at | TIMESTAMP | | Establecido por `jht cloud push` |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | Actualizado automáticamente en cada UPDATE mediante trigger |

---

## Índices

| Nombre | Tabla | Columnas |
|--------|-------|----------|
| idx_positions_status | positions | status |
| idx_positions_company | positions | company |
| idx_positions_company_id | positions | company_id |
| idx_positions_url | positions | url |
| idx_positions_write_requested | positions | write_requested (parcial WHERE = 1) |
| idx_scores_total | scores | total_score |
| idx_applications_status | applications | status |
| idx_pending_user_messages_agent | pending_user_messages | agent |
| idx_pending_user_messages_delivery | pending_user_messages | delivered_via, acknowledged_at |
| idx_pending_user_messages_unseen_reply | pending_user_messages | user_reply_at, agent_seen_reply_at |

---

## Comandos CLI

### Consultas
```bash
python3 shared/skills/db_query.py dashboard                    # Panel completo
python3 shared/skills/db_query.py stats                        # Conteos de tablas
python3 shared/skills/db_query.py positions --status new       # Filtrar por estado
python3 shared/skills/db_query.py positions --min-score 70     # Filtrar por puntuación
python3 shared/skills/db_query.py position 42                  # Detalle individual
python3 shared/skills/db_query.py companies --verdict GO       # Empresas por veredicto
python3 shared/skills/db_query.py company "Azienda"            # Detalle de empresa
python3 shared/skills/db_query.py check-url 4361788825         # Verificar duplicados
python3 shared/skills/db_query.py next-for-scorer              # Cola del scorer
python3 shared/skills/db_query.py next-for-scrittore           # Cola del escritor
python3 shared/skills/db_query.py next-for-critico             # ⚠️ legacy — el Crítico hoy es generado por el Escritor, no extrae de la cola
```

### Insertar
```bash
# Posición (Scout)
python3 shared/skills/db_insert.py position \
  --title "Python Developer" --company "Azienda" \
  --location "Remote EU" --remote-type full_remote \
  --salary-declared-min 40000 --salary-declared-max 65000 \
  --url "https://..." --source linkedin --found-by scout-1 \
  --jd-text "TESTO COMPLETO JD" --requirements "Python, Flask"

# Empresa (Analista)
python3 shared/skills/db_insert.py company \
  --name "Azienda" --hq-country "Italia" --sector "fintech" \
  --verdict GO --analyzed-by analista-1

# Puntuación (Scorer)
python3 shared/skills/db_insert.py score \
  --position-id 42 --total 85 --stack-match 35 --remote-fit 20 \
  --salary-fit 15 --experience-fit 5 --strategic-fit 10 --scored-by scorer

# Candidatura (Escritor)
python3 shared/skills/db_insert.py application \
  --position-id 42 --cv-path "..." --cl-path "..." \
  --cv-pdf-path "..." --cl-pdf-path "..." \
  --written-by scrittore-1 --written-at now

# Punto fuerte/débil (Analista/Scorer)
python3 shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Stack identico"
```

### Actualizar
```bash
# Estado de la posición
python3 shared/skills/db_update.py position 42 --status checked

# Salario declarado
python3 shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Salario estimado
python3 shared/skills/db_update.py position 42 \
  --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Última verificación (OBLIGATORIO después de verificar el enlace)
python3 shared/skills/db_update.py position 42 --last-checked now

# Nota del crítico (critic_reviewed_at se establece automáticamente)
python3 shared/skills/db_update.py application 42 \
  --critic-verdict PASS --critic-score 8.5 --critic-notes "note"

# Enviada (applied=1 se establece automáticamente con --applied-at)
python3 shared/skills/db_update.py application 42 \
  --applied-at "2026-02-28" --applied-via linkedin

# Respuesta
python3 shared/skills/db_update.py application 42 \
  --response "rejected" --response-at now

# Fase de entrevista (1=primera entrevista, 2=segunda, etc.)
python3 shared/skills/db_update.py application 42 --interview-round 1
```

### Sincronización (almacenamiento cloud opcional)
```bash
python3 shared/skills/db_to_sheets.py sync            # DB → Google Sheets
python3 shared/skills/db_to_sheets.py sync --dry-run  # Vista previa sin escribir

python3 shared/skills/db_to_supabase.py sync          # DB → Supabase (espejo de solo lectura)
python3 shared/skills/db_to_supabase.py sync --dry-run

python3 shared/skills/db_to_drive.py sync             # CV/CL PDF → Google Drive
python3 shared/skills/db_to_drive.py sync --dry-run
```

### Migración
```bash
python3 shared/skills/db_migrate_v2.py --verify       # Verificar integridad
```

---

## Comportamientos automáticos

| Acción | Efecto automático |
|--------|-------------------|
| `--critic-score X` | Establece `critic_reviewed_at = NOW` |
| `--applied-at "..."` | Establece `applied = 1` |
| Insert position con `--company "X"` | Resolución automática de `company_id` desde companies |
| Update position con `--company "X"` | Resolución automática de `company_id` desde companies |

---

## Pipeline de estados

```
new → checked → scored → writing → ready → applied → response
  │       │         │         │       │
  ▼       ▼         ▼         ▼       ▼
        excluded (enlace roto, no cualificado, score < 40, critic_score < 5, etc.)
```

**Estado por fase:**
- `new` — el Scout acaba de insertar (Fase 1)
- `checked` — el Analista ha verificado y promovido (Fase 2) · `excluded` si [LINK_MORTO/SCAM/GEO/LINGUA/SENIORITY/STACK]
- `scored` — el Scorer ha asignado puntuación (Fase 3) · `excluded` si score < 40
- `writing` — el Escritor la ha tomado a cargo (Fase 4) — claim coordinado entre pares
- `ready` — la Ronda 3 del Crítico ha dado score ≥ 5 (Fase 4) · `excluded` si score < 5
- `applied` — el usuario ha confirmado el envío (Fase 5) — manual, nunca por el equipo
- `response` — respuesta recibida (entrevista/rechazo/ghosted) — flag gestionado por el usuario
