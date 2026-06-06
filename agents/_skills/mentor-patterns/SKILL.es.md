<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: mentor-patterns
description: Los cinco patrones que el Mentor busca en los registros para decidir CUÁNDO hablar. El silencio es el predeterminado; solo un patrón real y recurrente merece una palabra. Esta skill da el método de detección canónico para cada patrón (consulta DB + umbral) para que el Mentor nunca hable desde un solo punto de datos. Solo lectura — nunca escribe en la DB. Propiedad del Mentor.
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(grep *), Bash(awk *)
---

# mentor-patterns — lo que revelan los registros

El Mentor observa conjuntos, no puntos individuales. Cinco patrones valen hablar; todo lo demás es ruido.

## Patrón A — Brecha de habilidades entre perfil y mercado

Habilidades que aparecen repetidamente en requisitos del JD pero están ausentes en `candidate_profile.yml > skills`. Si también aparecen en posiciones de **alta puntuación**, la brecha es **costosa** (cerrarla desbloquearía envíos, no ruido).

### Detección

```bash
# 1. Obtener las últimas 30 posiciones con sus requisitos + puntuación
python3 /app/shared/skills/db_query.py positions --limit 30 \
    --status scored,checked --order-by created_at:desc

# 2. Tokenizar requisitos, comparar con profile.skills.primary + .secondary
# 3. Contar tokens NO en el perfil que aparecen en N posiciones
```

### Umbral

Hablar solo si una habilidad faltante aparece en **≥ 5 posiciones de las últimas 30** Y **≥ 1 de ellas tiene puntuación ≥ 65** (al alcance de la puerta de envío).

### Ejemplo de salida

> *"<Nombre>, he contado. **Docker** aparece en doce de las últimas treinta posiciones en los registros. Nueve puntuaron entre 65 y 78 — al alcance de la puerta de envío, sin cruzarla nunca. Un oficio te separa de un tercio del camino que tienes delante."*

## Patrón B — Exclusiones recurrentes

Conteos de marcadores `ESCLUSA: [TAG]` en `positions.notes` en los últimos 30 días. Si una etiqueta domina, la dirección de búsqueda está desalineada.

### Detección

```bash
python3 /app/shared/skills/db_query.py positions --status excluded --limit 50 \
    --order-by last_checked:desc \
    | grep -oE 'ESCLUSA: \[(SENIORITY|STACK|GEO|LINGUA|LINK_MORTO|SCAM)\]' \
    | sort | uniq -c | sort -rn
```

### Umbral

Hablar solo si **una etiqueta representa ≥ 40% de las exclusiones** Y exclusiones totales ≥ 20 en los últimos 30 días.

### Interpretación

| Etiqueta dominante | Causa probable                                           | Movimiento sugerido                      |
|--------------------|----------------------------------------------------------|------------------------------------------|
| `[SENIORITY]`      | Apuntando demasiado alto (o demasiado bajo) para el nivel del candidato | Ajustar `seniority_target` en el perfil |
| `[LINGUA]`         | Un solo idioma está cerrando mercados enteros            | Añadir el idioma, o reducir alcance geográfico |
| `[GEO]`            | `work_mode` / `relocation` desalineados con la búsqueda  | Re-discutir preferencias con el usuario  |
| `[STACK]`          | Ruido de stacks adyacentes llegando al equipo            | Ajustar filtros del Scout vía Capitano   |
| `[LINK_MORTO]` (>40%) | Problema de calidad de fuente, no del candidato       | Reenviar al Capitano, esto es problema del Scout |

## Patrón C — "Banda de parking" de puntuación baja (40-49)

La señal más rica: posiciones en la banda de parking son **casi-ajustes**. Un componente de puntuación las retiene. Ese componente es la **palanca**.

### Detección

```bash
# Obtener todas las posiciones 40-49 con su desglose de puntuación
python3 /app/shared/skills/db_query.py scores \
    --min-total 40 --max-total 49 --limit 30
```

Para cada una, identificar el **componente individual más bajo** (`stack_match` / `experience_fit` / `remote_fit` / `salary_fit` / `strategic_fit`). Agregar: ¿qué componente es la palanca para más posiciones?

### Umbral

Hablar solo si **≥ 5 posiciones en la banda de parking comparten el mismo componente bajo** Y ese componente es < 50% de su tope de peso.

### Interpretación

| Componente palanca  | Qué significa                                                         |
|---------------------|-----------------------------------------------------------------------|
| `stack_match`       | Brecha de habilidades (verificación cruzada con Patrón A)             |
| `experience_fit`    | Desajuste de seniority (verificación cruzada con Patrón B `[SENIORITY]`) |
| `salary_fit`        | Expectativa salarial del candidato drifteando del mercado             |
| `remote_fit`        | Preferencias geográficas demasiado estrechas                          |
| `strategic_fit`     | Bonus de stack/sector erosionado — el nicho se desvanece o aún no era fuerte |

## Patrón D — Feedback post-envío

Si `applications.applied = true`, los embudos de resultados llevan la verdad.

### Detección

```bash
# Applications enviadas en los últimos 60 días
python3 /app/shared/skills/db_query.py applications --applied true \
    --order-by applied_at:desc --limit 30
```

Agrupar por `response`: `interview` / `rejected` / `ghosted` / `null` (aún sin respuesta). Computar:
- Tasa de entrevista = entrevistas / enviadas
- Tasa de rechazo = rechazados / enviadas
- Tasa de ghosting = ghosted (`now - applied_at > 30d` Y sin respuesta) / enviadas

### Umbral

Hablar solo con **≥ 10 applications enviadas** en la ventana (de lo contrario muestra demasiado pequeña).

### Interpretación

| Patrón observado                                | Movimiento                                                                |
|-------------------------------------------------|---------------------------------------------------------------------------|
| Rechazos comparten tipo de empresa / brecha de seniority | Re-enfocar la búsqueda (brecha de habilidades o seniority, ver Patrón A/B) |
| Ghosting > 60% sin cluster específico            | CV no destaca O mercado sobre-saturado → revisar CV con Critic / pausar envíos agresivos |
| Entrevistas existen → buscar qué comparten       | **Oro**: replicar la forma del JD, el tamaño de empresa, el stack        |

## Patrón E — Tendencias de veredicto de revisión

Cuando el Critic rebota CVs que no tienen nada concreto en qué apoyarse. El `critic_score` del Critic vive en `applications` después del bucle de 3 rondas.

### Detección

```bash
python3 /app/shared/skills/db_query.py applications \
    --critic-score-max 5 --order-by written_at:desc --limit 20
```

Agrupar las `critic_notes` por modo de fallo recurrente (ej. "sin métricas", "desajuste de stack", "About demasiado genérico").

### Umbral

Hablar solo si **≥ 5 CVs recientes puntuaron < 6** Y el mismo tipo de observación aparece en ≥ 3 de ellos.

### Interpretación

Un `critic_score < 5` recurrente con notas similares NO significa "el Writer es malo" — significa **el perfil no dice suficiente**. El fix es aguas arriba:
- About es demasiado genérico → preguntar al usuario por una inflexión concreta de carrera
- Sin métricas → minar al usuario por números (% de costo de alimentos, reducciones de latencia, headcount, horas ahorradas)
- Desajuste de stack → re-verificar `skills.primary` contra requisitos reales del JD

## Referencia cruzada de patrones

Los patrones se refuerzan mutuamente. Señal fuerte:
- **A + C** (brecha de habilidades + componente bajo en `stack_match`) → casi seguro vale hablar.
- **B `[SENIORITY]` + C `experience_fit`** → desalineamiento de seniority, mencionar una vez.
- **D cluster rechazado + E critic_score < 5** → problema de CV, escalar como Patrón E.

Evitar **A solo** cuando la habilidad se menciona en solo 5/30 posiciones y ninguna puntúa alto — eso es ruido, mantener silencio.

## Recordatorio de cadencia

Esta skill dice **cómo detectar**. CUÁNDO hablar está gobernado por el prompt del Mentor:
- 🌅 Primer despertar — recorrido rápido de los registros, una observación si lo merece
- 🌗 Diario — pase silencioso, hablar solo si un patrón cruza el umbral
- 🌕 Semanal — digest incluso si nada arde (usar skill `mentor-output`, formato semanal)
- 📞 Bajo demanda — responder la pregunta del usuario con los datos que tienes

Si no tienes nada de grado patrón que decir, **no digas nada**. El silencio es una respuesta.

## Anti-patrones

- ❌ Hablar después de detectar un solo hit (1 posición con requisito `Docker`) — muestra demasiado pequeña, parece chapuceo.
- ❌ Agregar a lo largo de toda la DB (ej. últimos 6 meses) — posiciones antiguas distorsionan la señal actual del mercado. Mantener los últimos 30 días a menos que estés comparando tendencias explícitamente.
- ❌ Usar el campo redondo `experience_years` para razonamiento del Patrón B/C — computar AÑOS REALES desde `candidate.experience[].years` (misma regla que el Analista).
- ❌ Hablar desde datos web sin un patrón basado en registros primero — los registros son el trigger, la web es la verificación (ver paso de confirmación `WebSearch` / `WebFetch` en `mentor.md`).
- ❌ Catastrofismo ("esto no lleva a ninguna parte") O porrismo ("¡tú puedes!") — ambos violan la voz del Mentor. Números, luego una pregunta. Ver skill `mentor-output`.

## Ver también

- `mentor-output` — CÓMO formular el mensaje una vez que un patrón está confirmado.
- `db-query` — internos del wrapper.
- `agents/mentor/mentor.md` — prompt orquestador + cadencia.
- `agents/_team/team-rules.md` T10 — el perfil es solo-lectura, también para el Mentor.
