<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: salary-estimate
description: Estimación salarial jerárquica para el Scorer (bug #27). 4 niveles — rango declarado (L1), caché local (L2), web search (L3), default neutro (L4). Caché local solo para los Scorer, sin sync remoto. TTL 30 días porque los salarios cambian de año en año, no de semana en semana. Usa la skill cada vez que vayas a escribir `salary_fit`: sin ella, el 95% de las posiciones acaba con `salary_fit=5/10` neutro (de facto inerte).
allowed-tools: Bash(python3 /app/shared/skills/salary_estimate.py *), Bash(python3 /app/shared/skills/db_update.py *)
---

# salary-estimate — estimación jerárquica con caché local

## Por qué existe

Snapshot 2026-05-17 (43 scores Kimi): 41 scores de 43 con
`salary_fit=5/10` (default "no data no bias"), 2 con valores reales de
JD explícito. Resultado: salary_fit (peso 10/100) era *de facto*
inerte — espacio decisional del Scorer reducido de 100 a 95.

Causa: nadie rellenaba `salary_estimated_*`. El Scorer es honesto,
no inventa, y sin dato cae en el default. Decisión del usuario:
construir una caché local de estimaciones para que la primera fetch
cueste, y las siguientes sean gratis. *"Los salarios no cambian de
semana en semana, sino de año en año"*.

## 4 niveles (en orden, se detiene en el primero que produce un rango)

### NIVEL 1 — Rango declarado (posición)
Si `positions.salary_declared_min` y `salary_declared_max` no son NULL →
usa esos, sin estimación. El Writer puede llamar:

```bash
python3 /app/shared/skills/salary_estimate.py --position-id 42
```

El script lee los declared de la DB y devuelve `level=1` con los números.

### NIVEL 2 — Caché local
Path: `/jht_home/.cache/salary_estimates.json`. Clave:
`(stack, seniority, country, mode)`. TTL 30 días.

```bash
python3 /app/shared/skills/salary_estimate.py \
    --stack python --seniority junior --country IT --mode remote
```

Hit → JSON con `level=2, source=cache, min, max`. Miss → cae a L3
o L4.

### NIVEL 3 — Web search (stub, depende de F-2)
Por ahora devuelve None: la skill cae directamente a L4. Cuando
F-2 (Scout web access) esté disponible, el Scout/Analista rellenará
la caché vía web search Glassdoor/Levels/Indeed. A partir de ese
momento, el primer lookup de una nueva combinación hace una sola fetch,
luego 29 días de hits gratuitos.

### NIVEL 4 — Default neutro + flag
Si todos los niveles anteriores fallan → devuelve `level=4, min=null,
max=null, estimation_failed=true, reason="no_data_default"`. El Scorer
asigna `salary_fit=5` Y añade `no_data_default` en `score.notes` —
así el Mentor (downstream) no propaga el 5 como dato real sino como
"N/D" (ver bug #27 fix Mentor).

## Output schema

```json
{
  "level": 1 | 2 | 3 | 4,
  "min": int | null,
  "max": int | null,
  "currency": "EUR",
  "source": "declared" | "cache" | "web" | "default",
  "fetched_at": "YYYY-MM-DD",
  "estimation_failed": false | true,
  "reason": "<optional>"
}
```

## Qué hace el Scorer con el resultado

```bash
result=$(python3 /app/shared/skills/salary_estimate.py \
    --stack "$STACK" --seniority "$SENIORITY" \
    --country "$COUNTRY" --mode "$MODE" \
    --declared-min "$DECL_MIN" --declared-max "$DECL_MAX")

# 1. Extraer los campos
min=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['min'] or '')")
max=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['max'] or '')")
failed=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('estimation_failed', False))")

# 2. Si tiene números reales, rellena positions.salary_estimated_*
if [ -n "$min" ] && [ -n "$max" ]; then
  python3 /app/shared/skills/db_update.py position "$POS_ID" \
    --salary-estimated-min "$min" --salary-estimated-max "$max" \
    --salary-estimated-source "salary-estimate"
fi

# 3. Calcula salary_fit (0-10) con tu lógica existente
#    (comparación con target del candidato de candidate_profile.salary_annual_eur)
#    e incluye la nota "no_data_default" si failed=True.
```

## Seed-cache dev-only

Para calentar la caché en un nuevo container (ej. test):

```bash
python3 /app/shared/skills/salary_estimate.py --seed-cache \
    --stack python --seniority junior --country IT --mode remote \
    --declared-min 28000 --declared-max 38000
```

En producción la caché se calienta sola: L1 (declared del JD) +
futuro L3 (web search) la rellenan orgánicamente en el transcurso de una
semana de operación.

## Anti-patterns

- ❌ Web fetch en cada posición — la caché existe precisamente para
  evitarlo. Mismo `python junior IT remote` ejecutado 10 veces =
  9 fetches desperdiciadas.
- ❌ TTL agresivo (1 día) — los salarios tienen granularidad anual,
  refrescar todos los días es zero-info-gain + desperdicio.
- ❌ Guardar los declared en caché — el declared ya está en la DB de
  la posición, no hace falta duplicarlo en la caché de estimaciones.
- ❌ Sync de caché en Supabase — es una caché **local de los Scorer**, no
  se debe ni respaldar ni compartir. Se regenera desde cero en pocos días.

## Ver también

- `agents/_skills/db-update/SKILL.md` § Positions — `salary-estimated-*`
- `candidate_profile.yml.example` — `salary_annual_eur` (target del candidato,
  side-fix bug #27)
- `agents/_skills/mentor-output/SKILL.md` — oculta "5 pasivo" cuando
  `notes` contiene `no_data_default`
- `docs/internal/_archive/2026-05-17-team-strategy-bugs.md` §27 — discusión
  Scorer + decisión del usuario
