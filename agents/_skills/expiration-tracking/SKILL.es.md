<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: expiration-tracking
description: Extrae deadlines de las ofertas y comunica informacion factual sobre ellas solo cuando el usuario la solicita expresamente. Nunca notifiques ni solicites automaticamente.
allowed-tools: Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/expiration_alerts.py *)
---

# expiration-tracking — datos de vencimiento bajo peticion

Los plazos ayudan al usuario a evaluar oportunidades. Conservalos con precision, pero no los conviertas en un recordatorio, una invitacion a postularse o una medida de progreso.

## A. Scout/Analyst: extracción de deadline del JD

Cuando insertas una nueva posición (Scout) o cuando enriqueces el JD (Analyst), pasa el texto por `deadline_extract`:

```bash
# CLI directo: extrae de stdin o --jd
echo "$JD_TEXT" | python3 /app/shared/skills/deadline_extract.py
# → 2026-06-15 (fecha ISO) o cadena vacía

# Inline en db_insert.py position
deadline_iso=$(echo "$JD_TEXT" | python3 /app/shared/skills/deadline_extract.py)
if [ -n "$deadline_iso" ]; then
  python3 /app/shared/skills/db_insert.py position \
    --title "$TITLE" --company "$COMPANY" --url "$URL" \
    --jd-text "$JD_TEXT" \
    --deadline "$deadline_iso"  # ← nuevo, F-4
fi
```

El parser es **conservador** (solo ISO, dd/mm/yyyy EU, Month dd[, yyyy] EN/IT, "expires in N days"). Si no encuentra un match de alta confianza devuelve cadena vacía → mejor NULL en la DB que fecha inventada.

## C. Informacion de vencimiento, solo bajo peticion

Usa esta seccion solo al responder la pregunta explicita del usuario sobre la fecha limite de una posicion o candidatura. Nunca la programes, la envies de forma proactiva ni reenvies su salida como notificacion.

Ejecuta: python3 /app/shared/skills/expiration_alerts.py --user-requested

La salida ofrece informacion factual sobre plazos de posiciones que ya estan en los registros del usuario, por ejemplo: [DEADLINE] Sisal Data Analyst (PASS 7.5) — vence 2026-05-18 (manana).

## B. Re-verificación periódica de posiciones antiguas (Analyst) — POR HACER

Extensión futura de la skill `liveness-check`: cada 6h, re-fetch URL de las posiciones en `status IN ('scored', 'ready')` con `last_checked < NOW() - 12h`. Si la URL devuelve 404 / "no longer accepting" → cambiar a `status='expired'` + nota. Fuera de alcance para F-4 inicial; el enfoque bottom-up de deadlines capturados del JD cubre la mayoría de los casos.

## Anti-patrones

- No ejecutes el informe de vencimientos sin una solicitud explicita del usuario.
- No conviertas la informacion de vencimiento en una invitacion, recordatorio o presion para postularse.

## Ver también

- `shared/skills/deadline_extract.py` — parser
- shared/skills/expiration_alerts.py — informe de vencimientos bajo peticion
- `agents/_skills/db-update/SKILL.md` § Positions — flag `--deadline`
