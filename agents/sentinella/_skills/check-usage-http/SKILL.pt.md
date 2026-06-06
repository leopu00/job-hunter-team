<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: check-usage-http
description: Verifica o uso do provedor via HTTP fast path (~2s, zero tokens CLI). Acao PRIMARIA quando o bridge nao consegue ler o uso. Fallback para `check-usage-tui` se HTTP retornar RATE_LIMIT ou falhar.
allowed-tools: Bash(python3 *)
---

# Skill — Verificar uso via HTTP (rapido, ~2s, ZERO tokens)

## QUANDO USAR

**Primario** quando recebes `[BRIDGE FAILURE]` (= o bridge nao consegue ler usage). HTTP e rapido, gratuito (sem spawn TUI), e quase sempre funciona — so a Anthropic aplica rate-limit agressivamente com ticks rapidos.

Ordem de fallback: **HTTP → TUI → FATAL**.

## Step 1 — Le o provider ativo

```bash
python3 -c "import json; print(json.load(open('/jht_home/jht.config.json'))['active_provider'])"
```

Output: `claude` / `kimi` / `codex`.

## Step 2 — Chama HTTP pela biblioteca do bridge

Usa as funcoes `fetch_*_api` expostas por `sentinel-bridge.py` como biblioteca:

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

## Step 3 — Trata os casos limite

### Anthropic 429 (rate-limit)

`fetch_claude_api()` retorna a string `"RATE_LIMIT"` em vez do dict. Cooldown interno de 5 min: antes disso continuara retornando `"RATE_LIMIT"`. Significa: HTTP indisponivel por 5 min → cai para L2 (TUI worker).

### None / empty

API fora do ar, credenciais expiradas, arquivo rollout codex ausente. Cai para L2.

## Step 4 — Escreve o sample no JSONL

```bash
python3 /app/shared/skills/usage_record.py --manual \
    --usage <X> \
    --reset-at <HH:MM> \
    --weekly <W> \
    --provider <claude|kimi|openai> \
    --source sentinella-api
```

O script chama internamente `compute_metrics` → calcula velocidade, projecao, estado, throttle. Imprime o sample completo como JSON.

## Step 5 — Procede com a decisao

Agora tens um sample fresco com `usage`, `proj`, `status`. Atualiza a tua memoria interna (ver skill `memory-state`) e decide se deves enviar uma ordem ao Capitao (ver skill `order-formats`).

## Notas

- **Sem spawn tmux**, zero tokens CLI consumidos. ~2s no total.
- **Para Kimi e Codex**: a API e estavel, quase sempre o check funciona sem problemas.
- **Para Claude**: com ticks demasiado rapidos (< 2 min) a Anthropic aplica rate-limit. Se vires `RATE_LIMIT` → cai imediatamente para o TUI fallback (skill `check-usage-tui`).
