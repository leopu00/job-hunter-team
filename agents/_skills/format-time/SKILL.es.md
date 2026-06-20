<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: format-time
description: Convertir timestamps UTC a la zona horaria del usuario antes de mostrarlos en chat, gráficos, Telegram o cualquier salida orientada al usuario. Usa este helper cada vez que de otro modo escribirías un `strftime("%H:%M")` crudo de un datetime UTC en algo que el usuario lee.
allowed-tools: Bash(python3 *)
---

# format-time — UTC → zona horaria del usuario en salida orientada al usuario

Bug #15: el contenedor corre en UTC, el usuario vive en CEST/CET. Sin conversión, cada "reset at 03:11" en chat o gráficos obliga al usuario a hacer `+2` en su cabeza — y a veces el usuario dice *"aquí son las 3:21"* y el Capitano tiene que luchar con la conversión.

## Cuándo usarlo

Aplícalo cada vez que produzcas un timestamp que el **usuario** leerá:

- Mensajes de Telegram de cualquier agente (Capitano, Assistente, Mentor)
- Subtítulos de gráficos Matplotlib, etiquetas de eje x, leyendas
- Widgets de dashboard que muestran hora
- Líneas de log o resúmenes devueltos al usuario

**Saltar** cuando:
- Escribes archivos de log internos (`messages.jsonl`, `sentinel-data.jsonl`,
  `dottore-actions.jsonl`) — quedan en UTC ISO para parsing cross-agente.
- Escribes columnas de DB — mantener UTC ISO para que el dashboard pueda
  formatear al renderizar.
- Computes intervalos / deltas — trabaja en UTC, formatea solo en los bordes.

## Cómo usarlo

```python
from shared.skills.format_time import fmt_user, fmt_user_with_utc
from datetime import datetime, timezone

now = datetime.now(timezone.utc)
print(fmt_user(now))            # "03:21 CEST"
print(fmt_user_with_utc(now))   # "03:21 CEST (01:21 UTC)"
```

O, desde bash:

```bash
python3 /app/shared/skills/format_time.py --now
python3 /app/shared/skills/format_time.py --iso 2026-05-17T01:14:00Z --with-utc
```

## Cuándo mostrar tanto hora-usuario como UTC

En **gráficos operativos** que un ingeniero de guardia (o tú, depurando) podría leer junto con los logs UTC del equipo, prefiere `fmt_user_with_utc` para que ambos sean visibles:

> *"Ahora 03:21 CEST (01:21 UTC) — usage 63% — proj 92.2%"*

En **chat Telegram simple** al usuario, `fmt_user` solo es usualmente suficiente:

> *"📅 Reset ventana 5h a las 05:11 CEST (~1h 50m)."*

## De dónde viene la zona horaria del usuario

`candidate_profile.yml::timezone` (nombre IANA, ej. `Europe/Rome`). Por defecto `Europe/Rome` si falta — cubre ~95% de beta users. Para sobreescribir por sesión: variable de entorno `JHT_USER_TZ` (leída por el helper).

## Anti-patrones

- ❌ `datetime.now().strftime("%H:%M")` en una cadena orientada al usuario — produce la hora del **contenedor** (UTC) sin sufijo → confusión del usuario.
- ❌ Matemáticas `+2` hechas a mano en cualquier parte. Usa el helper; el cambio DST cambia Europe/Rome a CET (+1) al final de octubre y lo olvidarás.
- ❌ Hardcodear `"CEST"` como sufijo — incorrecto para la mitad del año e incorrecto para usuarios no italianos.

## Ver también

- `shared/skills/format_time.py` — implementación.
- `candidate_profile.yml.example` — documentación del campo `timezone:`.
