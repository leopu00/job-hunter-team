<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: check-usage-http
description: Controlla l'utilizzo del provider tramite HTTP fast path (~2s, zero token CLI). Azione PRIMARIA quando il bridge non riesce a leggere l'utilizzo. Fallback su `check-usage-tui` se HTTP restituisce RATE_LIMIT o fallisce.
allowed-tools: Bash(python3 *)
---

# Skill — Controllo utilizzo via HTTP (rapido, ~2s, ZERO token)

## QUANDO USARLA

**Primario** quando ricevi `[BRIDGE FAILURE]` (= il bridge non riesce a leggere usage). HTTP è veloce, gratis (no spawn TUI), e quasi sempre funziona — solo Anthropic rate-limita aggressivamente con tick rapidi.

Ordine di fallback: **HTTP → TUI → FATAL**.

## Step 1 — Leggi il provider attivo

```bash
python3 -c "import json; print(json.load(open('/jht_home/jht.config.json'))['active_provider'])"
```

Output: `claude` / `kimi` / `codex`.

## Step 2 — Chiama HTTP tramite la libreria del bridge

Usa le funzioni `fetch_*_api` esposte da `sentinel-bridge.py` come libreria:

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

## Step 3 — Gestisci i casi limite

### Anthropic 429 (rate-limit)

`fetch_claude_api()` restituisce la stringa `"RATE_LIMIT"` invece del dict. Cooldown interno 5 min: prima di quello restituirà ancora `"RATE_LIMIT"`. Significa: HTTP non disponibile per 5 min → cadi su L2 (TUI worker).

### None / empty

API non raggiungibile, credenziali scadute, file rollout codex assente. Cadi su L2.

## Step 4 — Scrivi il sample nel JSONL

```bash
python3 /app/shared/skills/usage_record.py --manual \
    --usage <X> \
    --reset-at <HH:MM> \
    --weekly <W> \
    --provider <claude|kimi|openai> \
    --source sentinella-api
```

Lo script chiama internamente `compute_metrics` → calcola velocità, proiezione, stato, throttle. Stampa il sample completo come JSON.

## Step 5 — Procedi con la decisione

Ora hai un sample fresco con `usage`, `proj`, `status`. Aggiorna la tua memoria interna (vedi skill `memory-state`) e decidi se inviare un ordine al Capitano (vedi skill `order-formats`).

## Note

- **No spawn tmux**, nessun token CLI consumato. ~2s totali.
- **Per Kimi e Codex**: l'API è stabile, quasi sempre il check va liscio.
- **Per Claude**: con tick troppo rapidi (< 2 min) Anthropic rate-limita. Se vedi `RATE_LIMIT` → cadi subito su TUI fallback (skill `check-usage-tui`).
