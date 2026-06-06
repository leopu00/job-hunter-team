<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: check-usage-http
description: Comprueba el uso del proveedor mediante HTTP fast path (~2s, cero tokens CLI). Accion PRIMARIA cuando el bridge no consigue leer el uso. Fallback a `check-usage-tui` si HTTP devuelve RATE_LIMIT o falla.
allowed-tools: Bash(python3 *)
---

# Skill — Comprobar uso via HTTP (rapido, ~2s, ZERO tokens)

## CUANDO USARLA

**Primario** cuando recibes `[BRIDGE FAILURE]` (= el bridge no consigue leer usage). HTTP es rapido, gratuito (sin spawn TUI), y casi siempre funciona — solo Anthropic aplica rate-limit agresivamente con ticks rapidos.

Orden de fallback: **HTTP → TUI → FATAL**.

## Step 1 — Lee el provider activo

```bash
python3 -c "import json; print(json.load(open('/jht_home/jht.config.json'))['active_provider'])"
```

Output: `claude` / `kimi` / `codex`.

## Step 2 — Llama HTTP mediante la libreria del bridge

Usa las funciones `fetch_*_api` expuestas por `sentinel-bridge.py` como libreria:

```bash
python3 -c "
import importlib.util
spec = importlib.util.spec_from_file_location('br', '/app/.launcher/sentinel-bridge.py')
br = importlib.util.module_from_spec(spec); spec.loader.exec_module(br)
print(br.fetch_claude_api())   # claude → /api/oauth/usage
# OPPURE: br.fetch_kimi_api()  # kimi  → /coding/v1/usages
# OPPURE: br.fetch_codex_rollout()  # codex → file rollout JSONL locale
"
```

Output Python dict:

```python
{'usage': 42, 'reset_at': '20:10', 'weekly_usage': 25}
```

## Step 3 — Gestiona los casos limite

### Anthropic 429 (rate-limit)

`fetch_claude_api()` devuelve la cadena `"RATE_LIMIT"` en lugar del dict. Cooldown interno de 5 min: antes de eso seguira devolviendo `"RATE_LIMIT"`. Significa: HTTP no disponible durante 5 min → cae a L2 (TUI worker).

### None / empty

API caida, credenciales expiradas, archivo rollout codex ausente. Cae a L2.

## Step 4 — Escribe el sample en el JSONL

```bash
python3 /app/shared/skills/usage_record.py --manual \
    --usage <X> \
    --reset-at <HH:MM> \
    --weekly <W> \
    --provider <claude|kimi|openai> \
    --source sentinella-api
```

El script llama internamente a `compute_metrics` → calcula velocidad, proyeccion, estado, throttle. Imprime el sample completo como JSON.

## Step 5 — Procede con la decision

Ahora tienes un sample fresco con `usage`, `proj`, `status`. Actualiza tu memoria interna (ver skill `memory-state`) y decide si enviar una orden al Capitan (ver skill `order-formats`).

## Notas

- **Sin spawn tmux**, cero tokens CLI consumidos. ~2s totales.
- **Para Kimi y Codex**: la API es estable, casi siempre el check funciona sin problemas.
- **Para Claude**: con ticks demasiado rapidos (< 2 min) Anthropic aplica rate-limit. Si ves `RATE_LIMIT` → cae inmediatamente al TUI fallback (skill `check-usage-tui`).
