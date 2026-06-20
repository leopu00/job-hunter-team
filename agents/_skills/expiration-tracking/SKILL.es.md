<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: expiration-tracking
description: Extrae deadline del JD (helper deadline_extract) y produce alertas al usuario cuando una candidatura READY está por vencer (helper expiration_alerts, idempotente). F-4 task #50. Scout/Analyst pueblan positions.deadline, Mentor/Capitano notifican al usuario cuando deadline-now ≤ 3 días.
allowed-tools: Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/expiration_alerts.py *), Bash(jht-telegram-send *)
---

# expiration-tracking — no perder top PASS por vencimiento

Bug latente F-4: el usuario acumula 50 CVs `ready`, olvida aplicar durante 2 días, oportunidades top (ej. Sisal PASS 7.5) vencen en silencio. El pipeline es user-curated apply (bug #9 degradado) → sin alerta proactiva, el celo del equipo en preparar top CVs se ve anulado por el silencio del usuario.

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

## C. Mentor/Capitano: alerta proactiva al usuario

Trigger recomendado: después de cada `[BRIDGE TICK]` (Capitano) o al final del pase del Mentor. La idempotencia hace que llamadas frecuentes produzcan alertas solo para NUEVAS parejas (app_id, deadline_iso).

```bash
alerts=$(python3 /app/shared/skills/expiration_alerts.py)
if [ -n "$alerts" ]; then
  # Enviar al usuario vía Telegram
  echo "$alerts" | jht-telegram-send --from capitano --keyboard capitano
fi
```

Salida 1 línea por application en riesgo:
```
⏳ [ALERT scadenza] Sisal Data Analyst (PASS 7.5) — scade 2026-05-18 (DOMANI). Spedisci candidatura o perdi l'opportunità.
```

El estado de idempotencia está en `$JHT_HOME/state/expiration_alerts_sent.json` (set de `(app_id, deadline_iso)` ya notificados). Para re-enviar una alerta ya enviada: `expiration_alerts.py --reset` (solo dev).

## B. Re-verificación periódica de posiciones antiguas (Analyst) — POR HACER

Extensión futura de la skill `liveness-check`: cada 6h, re-fetch URL de las posiciones en `status IN ('scored', 'ready')` con `last_checked < NOW() - 12h`. Si la URL devuelve 404 / "no longer accepting" → cambiar a `status='expired'` + nota. Fuera de alcance para F-4 inicial; el enfoque bottom-up de deadlines capturados del JD cubre la mayoría de los casos.

## Anti-patrones

- ❌ Parsear deadline a mano con regex inline — usa el helper, tiene fallback EN/IT + verificación de sanidad en fechas pasadas.
- ❌ Inventar deadline cuando el JD no lo especifica explícitamente — mejor `NULL` que `+30d arbitrario`.
- ❌ Spamear al usuario con la misma alerta cada 6h — el estado de idempotencia existe para eso.
- ❌ Enviar la alerta desde un bot diferente al Capitano (ej. Assistente genérico) — pierde contexto operativo; el Capitano lo acompaña al pipeline.

## Ver también

- `shared/skills/deadline_extract.py` — parser
- `shared/skills/expiration_alerts.py` — emisor + estado de idempotencia
- `agents/_skills/db-update/SKILL.md` § Positions — flag `--deadline`
