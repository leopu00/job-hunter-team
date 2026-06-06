<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: cv-disk-audit
description: Healthcheck periódico (Dottore) para reconciliar CVs en disco y cv_pdf_path en la DB. Identifica huérfanos (archivo en disco sin fila DB) y fantasmas (fila DB con cv_pdf_path apuntando a archivo inexistente). Notifica al Capitano sobre las discrepancias para que el usuario no pierda top PASS invisibles y no vea "CV por escribir" para CVs ya escritos.
allowed-tools: Bash(python3 *), Bash(find *), Bash(stat *), Bash(jht-tmux-send *)
---

# cv-disk-audit — reconciliación disco↔DB de CVs

El bug #26 mostró el patrón: el Scrittore genera el PDF, es eliminado (EMERGENCIA freeze 2026-05-17 04:43) antes del UPDATE DB. El archivo queda en `/jht_user/cv/`, pero `applications.cv_pdf_path` queda NULL. Sisal 7.5/10 (top PASS de la ventana) se había convertido en *"CV por escribir"* en el dashboard del usuario — invisible.

El fix preventivo (escritura atómica en la skill `cv-structure`) impide nuevos huérfanos. Esta auditoría recose los ya existentes y captura cualquier nueva divergencia que pudiera aparecer (ej. el usuario mueve a mano un PDF, el watchdog mata al Writer durante el rename).

## Cuándo ejecutarla

Trigger del Dottore (fin de ronda, fuera de presupuesto crítico):
- Siempre en la primera ronda después de una EMERGENCIA / kill de un Scrittore.
- De lo contrario ~cada 4 rondas del Dottore (≈2h, dado la ronda de 30 min).

El Dottore ejecuta esta skill DESPUÉS de `liveness-check` y ANTES de `cache-prune` — la auditoría es informativa, no destructiva.

## Procedimiento

```bash
# 1. Snapshot disco
DISK_PDFS=$(find /jht_user/cv -maxdepth 1 -type f -name '*.pdf' 2>/dev/null | sort)

# 2. Snapshot DB (cv_pdf_path != NULL)
DB_PDFS=$(python3 /app/shared/skills/db_query.py cv-pdf-paths 2>/dev/null | sort)

# 3. Diff
ORFANI=$(comm -23 <(echo "$DISK_PDFS") <(echo "$DB_PDFS"))     # disco pero no DB
GHOST=$(comm -13 <(echo "$DISK_PDFS") <(echo "$DB_PDFS"))      # DB pero no disco

# 4. Reporte al Capitano (determinístico, sin LLM)
if [ -n "$ORFANI$GHOST" ]; then
  msg="[@dottore -> @capitano] [REPORT] CV audit mismatch — "
  msg="${msg}orfani=$(echo "$ORFANI" | grep -c .) "
  msg="${msg}ghost=$(echo "$GHOST" | grep -c .)"
  jht-tmux-send CAPITANO "$msg"
  # Log detalles
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "{\"ts\":\"$ts\",\"orfani\":$(echo "$ORFANI" | jq -R . | jq -s .),\"ghost\":$(echo "$GHOST" | jq -R . | jq -s .)}" \
    >> /jht_home/logs/cv-disk-audit.jsonl
fi
```

`db_query.py cv-pdf-paths` (por implementar): escribe 1 ruta por línea de todas las applications con `cv_pdf_path IS NOT NULL`. Una línea amigable para script para el `comm`.

## Qué hace el Capitano con el reporte

Recibe `[REPORT] CV audit mismatch — orfani=2 ghost=0`. Abre `/jht_home/logs/cv-disk-audit.jsonl`, lee los huérfanos, y para cada uno intenta el match heurístico:

1. `CV_<Candidato>_<position_id>_<...>.pdf` — naming nuevo bug #25 → extrae `position_id`, hace `db_update.py application <pid> --cv-pdf-path <path>`.
2. `CV_<Candidato>_<Company>.pdf` — naming viejo → busca application draft de esa empresa sin cv_pdf_path. Si encuentra una sola → reconecta. Si encuentra más de una → señala al usuario (Sisal vs Leadtech vs Canonical: caso ambiguo del 2026-05-17).

El Capitano NO elimina archivos (nunca). Mueve a `/jht_user/cv/_orphan/` si quiere archivar sin perder.

## Anti-patrones

- ❌ Auto-reconectar un huérfano con `cv_pdf_path` cuando hay más de una application draft para la misma empresa — ambigüedad, dejar decidir al usuario.
- ❌ Eliminar un huérfano: los CVs tienen alto costo cognitivo, archivar siempre en lugar de `rm`.
- ❌ Ejecutar la auditoría durante EMERGENCIA: el Dottore debe girar solo al final de ronda en régimen normal.

## Ver también

- `cv-structure` § PDF generation (W-03 escritura atómica, bug #26)
- `application-flow` Paso 6 (naming con position_id, bug #25)
- `db-update` § Single-writer gate (bug #21)
- `liveness-check` (ejecutada antes en la misma ronda del Dottore)
