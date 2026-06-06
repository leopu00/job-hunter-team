<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: db-insert
description: Insertar NUEVOS registros en la DB de JHT (positions / scores / applications / companies / position_highlights). Usarlo SOLO cuando un agente necesita crear un registro — Scout para posiciones, Analyst para empresas y highlights, Scorer para puntuaciones, Writer para applications. Nunca sobrescribir a ciegas — para actualizaciones usa `db-update`.
allowed-tools: Bash(python3 *)
---

# db-insert — creación de registros en la DB de JHT

Wrapper en `/app/shared/skills/db_insert.py`. Crea nuevos registros en la DB SQLite de JHT. Los campos requeridos difieren por tabla.

## Patrón

```bash
python3 /app/shared/skills/db_insert.py <table> --<field> <value> [--<field> <value>...]
```

Tablas: `position`, `company`, `score`, `application`, `highlight`.

## Position (Scout)

```bash
python3 /app/shared/skills/db_insert.py position \
  --title "Python Developer" --company "Acme Corp" \
  --location "Remote EU" --remote-type full_remote \
  --url "https://acme.com/jobs/42" --source linkedin --found-by scout-1 \
  --jd-text "<texto completo del JD>" --requirements "Python, Flask, PostgreSQL"
```

`--url` es **requerido** (el script falla sin él). El Scout debe siempre pre-verificar duplicados con `db-query check-url` primero.

## Company (Analyst)

```bash
python3 /app/shared/skills/db_insert.py company \
  --name "Acme Corp" --hq-country "Italy" --sector "fintech" \
  --verdict GO --analyzed-by analista-1
```

`--verdict` acepta `GO`, `CAUTIOUS`, `NO_GO`.

## Score (Scorer)

```bash
python3 /app/shared/skills/db_insert.py score \
  --position-id 42 --total 85 \
  --stack-match 35 --remote-fit 18 --salary-fit 8 \
  --experience-fit 9 --strategic-fit 15 \
  --scored-by scorer-1
```

Las 5 sub-puntuaciones mapean a columnas de la DB: `stack_match · remote_fit · salary_fit · experience_fit · strategic_fit`. `--total` es la puntuación canónica 0–100 que lee el Captain.

## Application (Writer)

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id 42 \
  --cv-path "/jht_user/applications/42/cv.md" \
  --cv-pdf-path "/jht_user/applications/42/cv.pdf" \
  --written-by scrittore-1 --written-at now
```

Carta de presentación (`--cl-path` / `--cl-pdf-path`) solo si el JD la solicitó.

## Highlight (Analyst / Scorer)

```bash
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Stack matches candidate primary stack 1:1"
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type con --text "Salary range below candidate target"
```

`--type` es `pro` o `con`.

## Reglas de seguridad

1. **Leer primero.** Usa `db-query check-url <url>` antes de insertar una posición. Usa `db-query position <id>` para verificar que el registro padre existe antes de insertar score/application.
2. **URL requerida en posiciones.** Sin URL → sin inserción (el script lo impone).
3. **Idempotente en duplicados.** La inserción se rechaza si hay conflicto de `(user_id, legacy_id)` o clave única — manejar con gracia y usar `db-update` en su lugar.
4. **Timestamp `now`.** El wrapper convierte la cadena literal `now` en el timestamp actual.

## No usarlo para

- Actualizaciones: usar **`db-update`**
- Lecturas: usar **`db-query`**
- Cambios de esquema: manejados por `db_migrate.py` — operación del Commander, no expuesta como skill
