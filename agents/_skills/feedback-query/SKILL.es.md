<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: feedback-query
description: Lee feedback del usuario (like/dislike/hide/star) desde la nube — una posición a la vez o agregado sobre una ventana. El Scorer lo usa como evidencia contextual de preferencia solo para posiciones futuras, excluyendo la actual; el Mentor cuenta motivos recurrentes (Patrón F) y el Scout lo usa como señal contextual. Devuelve un payload neutral "sin señal" cuando la nube está deshabilitada o inaccesible.
allowed-tools: Bash(python3 *)
---

## Límite raw/display (`RAW_DISPLAY_BOUNDARY`)

`reason` y `comment` son entrada raw solo para máquina. Nunca los cites, reenvíes, resumas ni muestres al usuario. Toda nota o mensaje user-facing debe usar únicamente `display_reason` / `display_comment`; `label` / `examples` de los temas ya pasaron por el mismo sanitizer compartido. Una `note` es solo un enum cerrado `no-signal:*`: trátala como estado de disponibilidad y nunca como detalle de infraestructura.

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
     "display_reason": "too senior", "display_comment": "5+ anni in Java richiesti, non mi interessa stack legacy",
     "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "comment": null, "display_reason": null,
     "display_comment": null, "score": null, "direction": null}
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
 "note": "no-signal:cloud-disabled"}
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
- Los sinónimos lejanos quedan separados (`salario` y `RAL` son dos temas) — es conteo de palabras, no semántica. Lee los `examples` display sanitizados (máx. 3) y une con la cabeza.
- Las posiciones cuyo **último** evento es `clear` quedan fuera (el juicio fue retirado); `--include-cleared` las devuelve.
- `share` = posiciones del tema / `positions_with_text`.
- `--field reason|comment|both` (por defecto `both`), `--top N`, `--days 0` para todo el historial.
- Fallback cuando el endpoint agregado no responde: `--legacy-ids 12,13,14` lee esas posiciones una a una (más lento, mismo formato de salida).

Flags: `--days` (por defecto 30, `0` = todo), `--limit` (por defecto 500 eventos), `--min-positions` (por defecto 3), `--text-chars` en `recent` (por defecto 300, trunca comentarios largos).

Cuando el payload trae una `note` enum cerrada (`no-signal:*`), no hay agregado. Trátala como "sin datos", nunca como "sin feedback", y no reenvíes el código.

## Cómo lo usan los agentes

**Scorer — `FUTURE_FEEDBACK_ONLY`:** llama `themes --days 30 --min-positions 1 --top 10 --exclude-legacy-id <legacy_id>`. Usa únicamente `label` / `examples` sanitizados como evidencia contextual de preferencia para esa posición futura. El feedback de una posición ya votada nunca cambia su score, status o notes: sin bonus/malus fijo, marker de feedback ni backfill. Los scores existentes permanecen iguales. O-70 reevaluación explícita es un flujo separado pedido por el usuario.

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
