<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: decision-throttle
description: Table de référence mappant `proj` (utilisation projetée au reset) à un état Sentinelle et un niveau de throttle (0-4). Utilisez-la à chaque tick APRÈS avoir obtenu un échantillon frais pour décider quel ordre envoyer au Capitaine.
---

# Skill — Table des états et throttle

Référence pour déterminer l'état à partir du `proj` reçu et le niveau de throttle à imposer au Capitaine.

## États basés sur `proj`

| État | Condition `proj` | Ordre au Capitaine |
|---|---|---|
| **CRITIQUE** | `> 100%` | URGENCE / FREINER fort |
| **ATTENTION** | `95-100%` | FREINER légèrement |
| **STEADY** (G-spot) | `90-95%` pendant **3 ticks consécutifs** | MAINTENIR |
| **SOUS-UTILISATION proche** | `70-90%` pendant **2+ ticks stagnants** | PUSH G-SPOT |
| **SOUS-UTILISATION grave** | `< 70%` pendant **2+ ticks + vel<ideale×0.7** | MONTER EN PUISSANCE |
| **OK** | quelconque, premier tick | ACCÉLÉRER |

## Table de throttle

```
rapporto = velocità_smussata / velocità_ideale
```

| rapporto | throttle | sleep entre opérations | sémantique |
|---|---|---|---|
| ≤ 1.0 | **0** | 0s | pleine vitesse, sous la cible |
| 1.0 – 1.3 | **1** | 30s | légèrement au-dessus |
| 1.3 – 1.8 | **2** | 2 min | modéré |
| 1.8 – 2.5 | **3** | 5 min | lourd |
| > 2.5 | **4** | 10 min | quasi-gel, urgence |

Si `velocità_ideale ≤ 0` (proj > SAFE_TARGET 95%) → throttle = 4.

## Bypass d'urgence (envoyer immédiatement, ignorer le cooldown)

L'une de ces conditions → envoyer URGENCE + exécuter freeze_team.py (voir skill `emergency-handling`) :

- `proj > 200%` (catastrophique)
- `velocità_smussata > velocità_ideale × 5` (explosion)
- `usage ≥ 90%` absolu (limite hard)

## Vitesse idéale

```
velocità_ideale = (TARGET - usage_attuale) / ore_al_reset
```

`TARGET` est **dynamique**, choisi dans cet ordre :

1. Si le dernier `[BRIDGE TICK]` inclut `target=N%` → utiliser **N** (cible tenant compte des heures de travail : le pacing-bridge l'a calculé en fonction des heures de travail configurées par l'utilisateur et du rapport cap-5h/cap-weekly du fournisseur).
2. Sinon → **92** (fallback historique, en dessous de SAFE_TARGET 95% par marge de sécurité).

### Exemples

- Tick standard 24/7 : `[BRIDGE TICK] ... ` (pas de champ target) → target = 92.
- Heures de bureau sur Codex Pro : `[BRIDGE TICK] ... target=76% work_phase=ON` → target = 76. Cela signifie que le pacing-bridge sait que l'utilisateur travaille de 9h à 18h et qu'avec ce ratio, une fenêtre de 5h complète vaudrait 14.7% du weekly → viser 76% au reset distribue exactement 100% du weekly sur les heures ON.
- Hors horaire (rare, car le pacing-bridge saute généralement le tick) : `[BRIDGE TICK] ... target=0% work_phase=OFF` → target = 0 (l'équipe doit descendre/rester bas).

### Table des états — elle aussi est centrée sur le TARGET

Les seuils 95%/90% dans la table ci-dessus s'interprètent toujours comme "proche de la cible". Quand la cible est 76% (heures de travail), STEADY = `proj ∈ [target−4, target+1]` ≈ 72-77%, ATTENTION = 77-82%, CRITIQUE > 84%. Quand la cible est 92% (fallback), les seuils reviennent aux chiffres originaux 90/95/100.

Si vous n'êtes pas sûr de la cible au tick courant → gardez-la à 92 et log explicite "(target fallback 92)". Mieux vaut un comportement conservateur que de mal interpréter le schedule.
