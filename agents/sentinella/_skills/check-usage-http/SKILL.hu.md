<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: check-usage-http
description: Ellenorzi a szolgaltato hasznalatat HTTP fast path-on keresztul (~2s, nulla CLI token). ELSODELGES muvelet, amikor a bridge nem tudja kiolvasni a hasznalati adatokat. Visszaesik a `check-usage-tui`-ra, ha a HTTP RATE_LIMIT-et ad vissza vagy sikertelen.
allowed-tools: Bash(python3 *)
---

# Skill — Hasznalat ellenorzese HTTP-n keresztul (gyors, ~2s, ZERO token)

## MIKOR HASZNALD

**Elsodelges** amikor `[BRIDGE FAILURE]`-t kapsz (= a bridge nem tudja olvasni a usage-t). A HTTP gyors, ingyenes (nincs TUI spawn), es szinte mindig mukodik — csak az Anthropic alkalmaz agressziv rate-limitet gyors tickeknel.

Fallback sorrend: **HTTP → TUI → FATAL**.

## Step 1 — Olvasd ki az aktiv providert

```bash
python3 -c "import json; print(json.load(open('/jht_home/jht.config.json'))['active_provider'])"
```

Output: `claude` / `kimi` / `codex`.

## Step 2 — Hivd meg a HTTP-t a bridge konyvtaran keresztul

Hasznald a `sentinel-bridge.py` altal konyvtarkent kiajanlott `fetch_*_api` fuggvenyeket:

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

## Step 3 — Kezeld a hatareseteket

### Anthropic 429 (rate-limit)

A `fetch_claude_api()` a `"RATE_LIMIT"` stringet adja vissza a dict helyett. Belso cooldown 5 perc: azelott tovabbra is `"RATE_LIMIT"`-et ad vissza. Ez azt jelenti: HTTP 5 percig nem elerheto → esj vissza L2-re (TUI worker).

### None / empty

API nem elerheto, hitelesito adatok lejartak, codex rollout fajl hianyzik. Esj vissza L2-re.

## Step 4 — Ird be a sample-t a JSONL-be

```bash
python3 /app/shared/skills/usage_record.py --manual \
    --usage <X> \
    --reset-at <HH:MM> \
    --weekly <W> \
    --provider <claude|kimi|openai> \
    --source sentinella-api
```

A szkript belsoen meghivja a `compute_metrics`-t → kiszamolja a sebesseget, projekciot, statuszt, throttle-t. Kiirja a teljes sample-t JSON-kent.

## Step 5 — Folytasd a dontessel

Most mar van egy friss sample-od `usage`, `proj`, `status` ertekekkel. Frissitsd a belso memoriadat (lasd `memory-state` skill) es dontsd el, hogy kuldesz-e parancsot a Kapitanynak (lasd `order-formats` skill).

## Megjegyzesek

- **Nincs tmux spawn**, nulla CLI token felhasznalva. Osszesen ~2s.
- **Kimi es Codex eseten**: az API stabil, az ellenorzes szinte mindig problemamentesen megy.
- **Claude eseten**: tul gyors tickeknel (< 2 perc) az Anthropic rate-limitet alkalmaz. Ha `RATE_LIMIT`-et latsz → azonnal esj vissza a TUI fallbackre (`check-usage-tui` skill).
