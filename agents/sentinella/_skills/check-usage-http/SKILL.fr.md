<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: check-usage-http
description: Verifie l'utilisation du fournisseur via HTTP fast path (~2s, zero token CLI). Action PRIMAIRE quand le bridge ne parvient pas a lire l'utilisation. Bascule sur `check-usage-tui` si HTTP renvoie RATE_LIMIT ou echoue.
allowed-tools: Bash(python3 *)
---

# Skill — Verifier l'utilisation via HTTP (rapide, ~2s, ZERO token)

## QUAND L'UTILISER

**Primaire** quand tu recois `[BRIDGE FAILURE]` (= le bridge ne parvient pas a lire usage). HTTP est rapide, gratuit (pas de spawn TUI), et fonctionne presque toujours — seul Anthropic applique un rate-limit agressif avec des ticks rapides.

Ordre de fallback : **HTTP → TUI → FATAL**.

## Step 1 — Lis le provider actif

```bash
python3 -c "import json; print(json.load(open('/jht_home/jht.config.json'))['active_provider'])"
```

Output : `claude` / `kimi` / `codex`.

## Step 2 — Appelle HTTP via la librairie du bridge

Utilise les fonctions `fetch_*_api` exposees par `sentinel-bridge.py` en tant que librairie :

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

Output Python dict :

```python
{'usage': 42, 'reset_at': '20:10', 'weekly_usage': 25}
```

## Step 3 — Gere les cas limites

### Anthropic 429 (rate-limit)

`fetch_claude_api()` renvoie la chaine `"RATE_LIMIT"` au lieu du dict. Cooldown interne de 5 min : avant cela, il renverra encore `"RATE_LIMIT"`. Cela signifie : HTTP indisponible pendant 5 min → bascule sur L2 (TUI worker).

### None / empty

API hors service, identifiants expires, fichier rollout codex absent. Bascule sur L2.

## Step 4 — Ecris le sample dans le JSONL

```bash
python3 /app/shared/skills/usage_record.py --manual \
    --usage <X> \
    --reset-at <HH:MM> \
    --weekly <W> \
    --provider <claude|kimi|openai> \
    --source sentinella-api
```

Le script appelle en interne `compute_metrics` → calcule la vitesse, la projection, le statut, le throttle. Affiche le sample complet en JSON.

## Step 5 — Procede a la decision

Tu disposes maintenant d'un sample frais avec `usage`, `proj`, `status`. Mets a jour ta memoire interne (voir skill `memory-state`) et decide si tu dois envoyer un ordre au Capitaine (voir skill `order-formats`).

## Notes

- **Pas de spawn tmux**, zero token CLI consomme. ~2s au total.
- **Pour Kimi et Codex** : l'API est stable, le check fonctionne presque toujours sans probleme.
- **Pour Claude** : avec des ticks trop rapides (< 2 min) Anthropic applique un rate-limit. Si tu vois `RATE_LIMIT` → bascule immediatement sur le TUI fallback (skill `check-usage-tui`).
