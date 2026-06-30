<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: rate-budget
description: Lire l'instantané du budget de rate-limit pour le fournisseur actif (utilisation %, temps avant réinitialisation, vélocité, projection, throttle recommandé) depuis le bridge. Utilisez-le au démarrage du Capitaine pour planifier le rythme et décider combien d'agents lancer, puis périodiquement quand vous souhaitez un instantané frais sans dépenser de tokens en appelant directement le fournisseur. Zéro appel fournisseur — lit le dernier tick déjà écrit par le bridge.
allowed-tools: Bash(python3 *)
---

# rate-budget — instantané du budget de rate-limit

Le bridge de monitoring (`.launcher/sentinel-bridge.py`) interroge le fournisseur actif toutes les 1–10 min (dynamique — plus fréquemment sous pression) et écrit chaque échantillon dans `/jht_home/logs/sentinel-data.jsonl`. Cette skill lit uniquement le **dernier échantillon** déjà écrit — aucun appel fournisseur supplémentaire.

## Au démarrage du Capitaine

Avant de lancer un agent, exécutez :

```bash
python3 /app/shared/skills/rate_budget.py plan
```

Sortie typique :
```
=== Rate Budget — claude ===
  Usage:            53%
  Reset:            tra 2h 34m (2026-04-24 15:49 CEST)
  Measured velocity:+0.39%/h (EMA)
  Target velocity:  11.38%/h (to close at 92% by reset)
  Reset projection: 56%
  Status:           OK
  Throttle:         T0 full speed
  Host:             cpu=4.7% ram=9.8% (OK)

  Recommended policy: Spawn freely in parallel — keep normal pace.
  Margin to 92% target: 39%
  Last tick:        2026-04-24T10:23:18.705062+00:00
```

**Interprétation par le Capitaine** (utilisez `Measured velocity` vs `Target velocity` — PAS `Reset projection`, qui est une INFO volatile) :
- `Throttle T0–T1` + `Measured velocity` bien en dessous de `Target velocity` (sous-rythme) → spawn complet (Scout + Analyst + Scorer + Writer + Critic)
- `Throttle T1–T2` + `Measured` ≈ `Target` (au rythme) → spawn réduit (une instance par rôle)
- `Throttle T2+` ou `Measured velocity` au-dessus de `Target velocity` (consommation excessive) → **pas de spawn**, attendre que le bridge lève le throttle
- `Reset projection` est purement INFO (extrapolation volatile en fin de fenêtre) — ne basez pas le spawn là-dessus.

**Si la sortie est `NO_DATA` :** le bridge n'a pas encore interrogé. Attendez 1–2 min et réessayez. Ne démarrez pas l'équipe sans ce signal — vous risquez de saturer le rate-limit à l'aveugle.

## Version en une ligne (scriptable)

```bash
python3 /app/shared/skills/rate_budget.py status
# → provider=claude usage=55% status=OK throttle=0 reset_in=2h 34m (at 2026-04-24 15:49 CEST)
```

Utile pour des logs rapides ou des vérifications en cours de boucle.

## Quand NE PAS l'utiliser

- **Ne l'appelez pas à chaque étape.** Utilisez-le aux *changements de phase* de votre plan (bootstrap, fin d'un batch Scout, après une pause, etc.). Le bridge se met à jour à son propre rythme ; appeler plus souvent ne renvoie pas de données plus fraîches.
- **Cela ne remplace pas le flux asynchrone `[BRIDGE ORDER]` :** le bridge vous notifie *quand* la politique change ; vous planifiez *en consultant* le budget. Les deux mécanismes sont complémentaires.
