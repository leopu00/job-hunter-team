<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: feedback-query
description: Leer feedback del usuario (like/dislike/hide/star) para una posición dada desde la nube. Usado por el Scorer para aplicar un multiplicador en la puntuación final y por el Scout como señal contextual. Devuelve un payload neutral "sin señal" cuando la nube está deshabilitada o inaccesible, para que los llamadores nunca fallen de forma dura.
allowed-tools: Bash(python3 *)
---

# feedback-query — Feedback del usuario por posición

El usuario puede hacer clic en like/dislike/hide/star en cualquier posición desde el dashboard web. Esos clics se almacenan en Supabase `position_feedback` (mig 019 base + mig 028 extendida) y se exponen a los agentes vía esta skill. Esquema:

| Columna             | Tipo    | Significado |
|---------------------|---------|-------------|
| `position_legacy_id`| TEXT    | El `legacy_id` (cadena) de la posición en `positions` |
| `action`            | TEXT    | Uno de `like`, `dislike`, `hide`, `star` |
| `reason`            | TEXT    | Razón corta opcional (≤500 char) |
| `comment`           | TEXT    | Comentario verbose opcional (≤2000 char, mig 028) |
| `score`             | INTEGER | Puntuación granular opcional 1-5 (mig 028) |
| `direction`         | TEXT    | Opcional `more_like_this` / `less_like_this` — señal de patrón para el Scout, NO skip por posición (mig 028) |
| `created_at`        | TS      | Hora de envío |

La skill llama a `GET /api/positions/{legacy_id}/feedback` en la nube (usando el bearer token en `$JHT_HOME/cloud.json`). Cuando la nube está deshabilitada o hay fallo de red, la skill **no genera error** — devuelve `ok=true, latest_action=null` con un campo `note`. Los agentes deben continuar.

## Búsqueda de posición individual

```bash
python3 /app/shared/skills/feedback_query.py check <legacy_id>
```

Salida (JSON en stdout):

```json
{
  "ok": true,
  "legacy_id": "42",
  "latest_action": "dislike",
  "latest_direction": "less_like_this",
  "count": 2,
  "actions": [
    {"action": "dislike", "created_at": "2026-05-30T14:21:00Z",
     "reason": "too senior", "comment": "5+ anni in Java richiesti, non mi interessa stack legacy",
     "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "comment": null, "score": null, "direction": null}
  ]
}
```

`latest_action` es el clic más reciente. `latest_direction` es el valor NO-NULL más reciente de `direction` en el historial (en cualquier parte del actions[], no necesariamente la última acción). `actions[]` está ordenado DESC por `created_at`. Vacío cuando no existe feedback:

```json
{"ok": true, "legacy_id": "99", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": []}
```

Cuando la nube está deshabilitada o el endpoint es inaccesible, la skill devuelve:

```json
{"ok": true, "legacy_id": "...", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": [],
 "note": "no-signal (cloud-disabled)"}
```

## Cómo lo usan los agentes

**Scorer** (obligatorio en el momento de puntuar):
1. Después de computar la puntuación base (suma de componentes ponderados), llamar a `feedback_query check <legacy_id>`.
2. Aplicar multiplicador basado en `latest_action`:
   - `like` → final_score = round(base * 1.10), añadir nota `feedback:like+10%`
   - `star` → final_score = round(base * 1.15), añadir nota `feedback:star+15%`
   - `dislike` → final_score = round(base * 0.85), añadir nota `feedback:dislike-15%`
   - `hide` → status=`excluded`, nota `feedback:hide`, saltar escritura de puntuación
   - `null` → sin cambio
3. Limitar puntuación final a 100 después del multiplicador.

**Scout** (señal contextual opcional):
- No para skip por posición — eso ya está manejado por dedup (SC-05).
- Usarlo con moderación al re-evaluar una posición conocida (ej. lógica de promoción): si el usuario explícitamente le dio dislike, no re-surfacear incluso si el dedup normalmente re-puntuaría.
- **Señal de patrón vía `direction`** (mig 028): cuando `latest_direction='less_like_this'` en una posición, el usuario pide menos posiciones COMO esa (misma empresa / role_family / ubicación). Depriorizar esa fuente/patrón en búsquedas posteriores. Cuando `latest_direction='more_like_this'`, priorizar replicar el patrón. Es una pista contextual, no una regla dura — combínala con el panorama más amplio (ej. un solo `less_like_this` en un nicho pequeño puede ser ruido; tres en la misma empresa no lo son).

## Notas

- La skill es **solo lectura**. Las escrituras ocurren solo desde el navegador vía POST `/api/positions/{legacy_id}/feedback`.
- El bearer token viene de `cloud.json`; no se necesita variable de entorno separada.
- Timeout de 10s por llamada. Si procesas muchas posiciones en lote, espera ~50-200ms por llamada. Para ejecuciones masivas, agrupa en el bucle con pausas de throttle como siempre.
