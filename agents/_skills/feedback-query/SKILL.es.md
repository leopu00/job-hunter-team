<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: feedback-query
description: Leer feedback del usuario (like/dislike/hide/star) desde la nube — una posición a la vez, o agregado sobre una ventana. Usado por el Scorer para aplicar un multiplicador en la puntuación final y para llevar el motivo del usuario a la nota, por el Mentor para contar los motivos recurrentes (Patrón F) y por el Scout como señal contextual. Devuelve un payload neutral "sin señal" cuando la nube está deshabilitada o inaccesible, para que los llamadores nunca fallen de forma dura.
allowed-tools: Bash(python3 *)
---

# feedback-query — Feedback del usuario por posición

El usuario puede hacer clic en like/dislike/hide/star en cualquier posición desde el dashboard web. Esos clics se almacenan en Supabase `position_feedback` (mig 019 base + mig 028 extendida) y se exponen a los agentes vía esta skill. Esquema:

| Columna             | Tipo    | Significado |
|---------------------|---------|-------------|
| `position_legacy_id`| TEXT    | El `legacy_id` (cadena) de la posición en `positions` |
| `action`            | TEXT    | Uno de `like`, `dislike`, `hide`, `star`, `clear` (mig 059 — el usuario retira el juicio; gana el último evento, así que un `clear` al final significa "sin juicio") |
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

## Lectura agregada (ventana sobre todas las posiciones)

Una sola llamada HTTP en lugar de N: `GET /api/positions/feedback?days=&limit=`, mismo bearer token, mismo fallback neutral.

```bash
# Todos los eventos de feedback en la ventana, del más reciente
python3 /app/shared/skills/feedback_query.py recent --days 30

# Los motivos que el usuario escribió, agrupados por similitud
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3
```

Salida de `themes`:

```json
{"ok": true, "window_days": 30, "field": "both",
 "events_total": 31, "events_with_text": 19,
 "positions_with_text": 17, "positions_cleared": 2,
 "by_action": {"like": 6, "dislike": 21, "hide": 3, "star": 1},
 "min_positions": 3,
 "themes": [
   {"key": "tropp senio", "label": "troppo senior",
    "positions": 7, "events": 8, "share": 0.412,
    "actions": {"dislike": 6, "hide": 2},
    "legacy_ids": ["42", "51", "63"],
    "examples": ["troppo senior", "richiesta troppo seniore — Lead role"]}
 ]}
```

Cómo funciona el agrupamiento (no se exige coincidencia exacta, ninguna dependencia nueva): minúsculas → acentos fuera → puntuación fuera → palabras de servicio fuera → cada palabra cortada a sus primeros 5 caracteres (`senior` / `seniority` / `seniore` / `séniorité` caen en una sola clave) → se cuentan palabras sueltas y **pares adyacentes**, por **posiciones distintas**, no por eventos. Un par absorbe sus partes cuando cubre ≥ 80% de las mismas posiciones, así "demasiado senior" gana a "senior"; los intensificadores se quedan en el flujo a propósito. `reason` y `comment` se tokenizan por separado, así no se inventa ningún par a caballo de los dos.

Límites deliberados, declarados para que nadie lea en los números más de lo que hay:
- Los sinónimos lejanos quedan separados (`salario` y `RAL` son dos temas) — es conteo de palabras, no semántica. Lee los `examples` (literales, máx. 3) y une con la cabeza.
- Las posiciones cuyo **último** evento es `clear` quedan fuera (el juicio fue retirado); `--include-cleared` las devuelve.
- `share` = posiciones del tema / `positions_with_text`.
- `--field reason|comment|both` (por defecto `both`), `--top N`, `--days 0` para todo el historial.
- Fallback cuando el endpoint agregado no responde: `--legacy-ids 12,13,14` lee esas posiciones una a una (más lento, mismo formato de salida).

Flags: `--days` (por defecto 30, `0` = todo), `--limit` (por defecto 500 eventos), `--min-positions` (por defecto 3), `--text-chars` en `recent` (por defecto 300, trunca comentarios largos).

Cuando el payload trae una `note` (`no-signal (...)`), no hay agregado: nube apagada, endpoint ausente o red caída. Trátalo como "sin datos", nunca como "sin feedback".

## Cómo lo usan los agentes

**Scorer** (obligatorio en el momento de puntuar):
1. Después de computar la puntuación base (suma de componentes ponderados), llamar a `feedback_query check <legacy_id>`.
2. Aplicar multiplicador basado en `latest_action`:
   - `like` → final_score = round(base * 1.10), añadir nota `feedback:like+10%`
   - `star` → final_score = round(base * 1.15), añadir nota `feedback:star+15%`
   - `dislike` → final_score = round(base * 0.85), añadir nota `feedback:dislike-15%`
   - `hide` → status=`excluded`, nota `feedback:hide`, saltar escritura de puntuación
   - `clear` / `null` → sin cambio (un juicio retirado no es un juicio)
3. **Lleva el motivo a la nota**, cuando el usuario escribió uno. Toma `reason` (o, si está vacío, `comment`) del **mismo evento** que `latest_action` — `actions[0]` — cítalo literalmente, recórtalo a ~80 caracteres y añádelo a la nota:

   ```
   feedback:dislike-15% — "demasiado senior"
   feedback:star+15% — "exactamente el stack que quiero"
   ```

   Sin texto en ese evento → la nota se queda como está. El motivo vale **solo para esta posición**: no lo lleves nunca a otra, no lo conviertas en una regla, no lo reescribas ni lo resumas — son palabras del usuario y el usuario las relee. Agregar los motivos a través de las posiciones es tarea del Mentor (Patrón F), no del Scorer.
4. Limitar puntuación final a 100 después del multiplicador.

**Mentor** (Patrón F, solo lectura): `themes` sobre los últimos 30 días para contar los motivos que el usuario escribe. Umbrales e interpretación viven en la skill `mentor-patterns`. El Mentor habla **al usuario** — nunca emite instrucciones de búsqueda a partir de este dato.

**Scout** (señal contextual opcional):
- No para skip por posición — eso ya está manejado por dedup (SC-05).
- Usarlo con moderación al re-evaluar una posición conocida (ej. lógica de promoción): si el usuario explícitamente le dio dislike, no re-surfacear incluso si el dedup normalmente re-puntuaría.
- **Señal de patrón vía `direction`** (mig 028): cuando `latest_direction='less_like_this'` en una posición, el usuario pide menos posiciones COMO esa (misma empresa / role_family / ubicación). Depriorizar esa fuente/patrón en búsquedas posteriores. Cuando `latest_direction='more_like_this'`, priorizar replicar el patrón. Es una pista contextual, no una regla dura — combínala con el panorama más amplio (ej. un solo `less_like_this` en un nicho pequeño puede ser ruido; tres en la misma empresa no lo son).

## Notas

- La skill es **solo lectura**. Las escrituras ocurren solo desde el navegador vía POST `/api/positions/{legacy_id}/feedback`.
- El bearer token viene de `cloud.json`; no se necesita variable de entorno separada.
- Timeout de 10s en `check`, 20s en la llamada agregada. Si procesas muchas posiciones con `check`, espera ~50-200ms por llamada — es exactamente lo que `recent` / `themes` existen para evitar.
- El agregado está acotado al usuario del lado servidor: devuelve el feedback de este usuario y nada más.
