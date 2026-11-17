---
name: recheck-batch
description: Recheck acompasado del MODO CUIDADO con coste mínimo. El script hace el trabajo mecánico sobre un batch (verificación escalonada de cada URL, actualiza last_checked de las OPEN verificadas); tú juzgas SOLO los casos ambiguos. Medido 78-86kT por posición con la ronda manual — con el batch gastas un turno para 10 posiciones, no 10 turnos. La exclusión es SIEMPRE decisión tuya, nunca del script.
allowed-tools: Bash(python3 /app/shared/skills/recheck_batch.py *), Bash(python3 /app/shared/skills/db_update.py *), Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-batch — el recheck del modo cuidado, sin desperdiciar un turno por posición

## Por qué existe
Volver a comprobar una posición YA analizada es una fracción del check de una
posición nueva: nada de reanálisis, nada de releer la JD, nada de metadatos.
La ronda manual (cola → una posición → recheck-liveness → db_update →
repetir) costaba 78-86kT por posición porque cada paso era un turno LLM. Este
batch comprime toda la parte mecánica en UN solo comando.

## Cómo se usa (UN turno por batch)
```sh
python3 /app/shared/skills/recheck_batch.py            # batch di 10 dalla coda
python3 /app/shared/skills/recheck_batch.py --limit 5
```
Toma las posiciones de la cola `next-for-recheck-due` (vivas, score ≥
policy, no verificadas desde hace > 14 días, SCORE DESC: primero las mejores)
y para cada una ejecuta la verificación escalonada de `recheck_liveness.py`
(curl → navegador, nunca un falso abierto).

El informe tiene tres resultados:
- **OK abiertas y actualizadas** — verificadas `OPEN`: `last_checked` ya
  está actualizado, salen de la cola durante 14 días. **No las toques, no
  las releas, cero trabajo para ti.**
- **POR JUZGAR** — evidencia de cierre (404/410, closed-marker o
  `expires_at` vencida). Aquí entras TÚ.
- **NO VERIFICABLES** — host JS/authwall y navegador no concluyente. Aquí
  entras TÚ (one-shot).

## El juicio es tuyo — el script NUNCA excluye (orden del usuario 2026-07-30)
Un script estático puede equivocarse y tirar una posición todavía viva.
Para cada posición **POR JUZGAR**: mira la evidencia reportada; si hace
falta, UNA sola mirada directa a la página. Si estás seguro al 100 % de que
está caducada/cerrada:
```sh
python3 /app/shared/skills/db_update.py position <ID> --status excluded \
  --is-open false --last-open-check now --notes "[SCADUTO] <evidenza>"
```
Si en cambio sigue viva (falso positivo del script):
```sh
python3 /app/shared/skills/db_update.py position <ID> --is-open true --last-checked now
```
Para cada **NO VERIFICABLE**: one-shot con el navegador sobre la URL; luego
decide como arriba. Si sigue sin poder verificarse → `--last-checked now` +
nota `[OPEN_UNVERIFIED]`, `is_open` sin cambios (nunca la hagas pasar por
abierta).

## Disciplina de coste (el sentido de la skill)
- **Un batch = un turno.** No hagas una ronda por posición, no reanalices,
  no releas JD ni empresa: el recheck solo decide «¿sigue abierta?».
- Batch acotado (por defecto 10): NO subas el límite para «terminar la cola
  de una vez» — la cadencia reparte el trabajo, el Capitano marca el ritmo
  (C-09/C-18).
- Cola OFF por enrichment-policy = estado deseado: detente, no la esquives.
