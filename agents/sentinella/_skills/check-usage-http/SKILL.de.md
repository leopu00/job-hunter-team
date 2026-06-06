<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: check-usage-http
description: Prueft die Provider-Nutzung ueber HTTP fast path (~2s, null CLI-Tokens). PRIMAERE Aktion wenn die Bridge die Nutzung nicht lesen kann. Faellt auf `check-usage-tui` zurueck wenn HTTP RATE_LIMIT zurueckgibt oder fehlschlaegt.
allowed-tools: Bash(python3 *)
---

# Skill — Nutzung via HTTP pruefen (schnell, ~2s, ZERO Tokens)

## WANN VERWENDEN

**Primaer** wenn du `[BRIDGE FAILURE]` erhaeltst (= die Bridge kann usage nicht lesen). HTTP ist schnell, kostenlos (kein TUI-Spawn) und funktioniert fast immer — nur Anthropic rate-limitiert aggressiv bei schnellen Ticks.

Fallback-Reihenfolge: **HTTP → TUI → FATAL**.

## Step 1 — Lies den aktiven Provider

```bash
python3 -c "import json; print(json.load(open('/jht_home/jht.config.json'))['active_provider'])"
```

Output: `claude` / `kimi` / `codex`.

## Step 2 — Rufe HTTP ueber die Bridge-Bibliothek auf

Nutze die `fetch_*_api`-Funktionen, die von `sentinel-bridge.py` als Bibliothek bereitgestellt werden:

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

## Step 3 — Behandle Grenzfaelle

### Anthropic 429 (rate-limit)

`fetch_claude_api()` gibt den String `"RATE_LIMIT"` statt des Dicts zurueck. Interner Cooldown von 5 Min: davor wird weiterhin `"RATE_LIMIT"` zurueckgegeben. Bedeutet: HTTP fuer 5 Min nicht verfuegbar → falle auf L2 zurueck (TUI Worker).

### None / empty

API nicht erreichbar, Zugangsdaten abgelaufen, Codex-Rollout-Datei fehlt. Falle auf L2 zurueck.

## Step 4 — Schreibe den Sample ins JSONL

```bash
python3 /app/shared/skills/usage_record.py --manual \
    --usage <X> \
    --reset-at <HH:MM> \
    --weekly <W> \
    --provider <claude|kimi|openai> \
    --source sentinella-api
```

Das Skript ruft intern `compute_metrics` auf → berechnet Geschwindigkeit, Projektion, Status, Throttle. Gibt den vollstaendigen Sample als JSON aus.

## Step 5 — Fahre mit der Entscheidung fort

Du hast jetzt einen frischen Sample mit `usage`, `proj`, `status`. Aktualisiere deinen internen Speicher (siehe Skill `memory-state`) und entscheide, ob du einen Befehl an den Kapitaen senden sollst (siehe Skill `order-formats`).

## Hinweise

- **Kein tmux-Spawn**, null CLI-Tokens verbraucht. ~2s insgesamt.
- **Fuer Kimi und Codex**: Die API ist stabil, der Check funktioniert fast immer problemlos.
- **Fuer Claude**: Bei zu schnellen Ticks (< 2 Min) wendet Anthropic Rate-Limiting an. Wenn du `RATE_LIMIT` siehst → falle sofort auf TUI-Fallback zurueck (Skill `check-usage-tui`).
