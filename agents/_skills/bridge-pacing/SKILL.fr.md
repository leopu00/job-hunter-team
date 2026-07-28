<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: bridge-pacing
description: Lisez un tick de calibration `[BRIDGE PACING]` de 15 minutes — la mesure du bridge sur le taux réel de l'équipe, avec un verdict (SFORO / MARGINE / ALLINEATO) plus la part et la cadence par agent. Le tick est adressé à la SENTINELLA, pas à vous : ouvrez cette skill quand c'est elle qui vous transmet ces chiffres, ou quand vous allez lire un tick de votre propre initiative. N'attendez pas qu'il en arrive un dans votre pane — il n'arrivera pas. Convertir le verdict en valeurs de throttle par agent, c'est `throttle-distribution`.
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — lire le tick de calibration de 15 min

Le bridge exécute une fenêtre de mesure toutes les 15 min (alignée sur :00/:15/:30/:45 UTC). À chaque fermeture de fenêtre, il écrit une ligne résumant le taux réel de l'équipe — **dans le pane de la Sentinella, pas le vôtre** (push→pull, 25/06/2026). On ne vous ping pas tous les quarts d'heure, et c'est délibéré : elle lit le tick, et ne vous réveille que si cela vaut un de vos tours. Vous utilisez donc ce format quand **c'est elle qui vous transmet les chiffres**, ou quand vous allez regarder un tick de votre propre initiative — jamais comme quelque chose à attendre.

## Format du message

```
[BRIDGE PACING] HH:MM UTC window=15m (effettivi Xm) samples=N |
  usage=U% reset_in=Rh reset_at=THH:MM UTC (proj=P% — INFO, secondario non-driver) |
  vel_team=V%/h | vel_target=T%/h (per chiudere a TGT% al reset) [schedule+ratio phase=ON] |
  ratio=K kT/% (team Σ kT / Δusage) |
  agenti: name=p%/h [kT/Xm → kT/h ÷ K = p%/h, share s%, cadenza c/min (n chk in Xm)] ; ... |
  VERDETTO: SFORO|MARGINE|ALLINEATO ...
```

`TGT` est la **cible dynamique** choisie par le bridge :
- Configuration 24/7 ou pas d'horaire → `TGT=92` (centre de bande, défaut historique)
- Configuration heures de travail + fournisseur avec plafond hebdomadaire (Codex/Claude) → `TGT` est le % nécessaire au reset pour que le budget hebdomadaire soit distribué exactement sur les heures actives de l'utilisateur. Exemple : heures de bureau 9-18 sur Codex Pro → `TGT≈76`.
- Configuration heures de travail + Kimi (pas de plafond hebdomadaire) → `TGT=92` (fallback centre de bande).

Le tag `[schedule+ratio phase=ON]` entre parenthèses est la **source** de la cible — `band_center` (pas d'heures de travail), `schedule+ratio` (pleinement conscient des heures de travail), `schedule+band` (heures de travail + fallback Kimi). Utilisez-le pour déboguer des cibles inattendues.

## Champs que vous utilisez réellement

| Champ             | Ce qu'il vous dit                                                                                          |
|-------------------|------------------------------------------------------------------------------------------------------------|
| **`vel_team`**    | taux mesuré de l'équipe, en points de % du budget par heure                                               |
| **`vel_target`**  | taux qui atteindrait `TGT%` au reset (centre de la bande de ±10pt autour de `TGT`)                        |
| **`share s%`**    | poids par agent sur le taux total (Σ shares ≈ 100%) — vous dit **QUI** ralentir                           |
| **`cadenza c/min`** | appels `jht-throttle` par minute par agent dans la fenêtre — vous dit **DE COMBIEN** ajouter à la config |
| **`VERDETTO`**    | résumé actionnable ; à mapper directement vers le tableau ci-dessous                                       |

> ⚠️ **`proj` est INFO uniquement — N'agissez PAS dessus.** C'est une extrapolation volatile
> de la vélocité à fenêtre courte (ex. il a affiché `proj=-8.66%` alors que l'équipe était simplement
> un poil sous la cible). La boucle de contrôle est **`vel_team` vs `vel_target`** (les deux
> conscients du planning hebdomadaire) + `weekly_remaining`. Ignorez `proj` pour les décisions de throttle/spawn.

## Verdict → action

| Verdict                          | Signification                                                 | Action                                                                                |
|----------------------------------|---------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `SFORO +X%/h → riduci Y%`        | `vel_team` dépasse la cible de X points/h. Réduire Y% du taux. | **Augmenter** `throttle-config` pour les agents avec **forte part** (top 1-2)         |
| `MARGINE −X%/h → puoi salire Y%` | `vel_team` sous la cible. Vous avez de la marge.              | **Mettre à zéro ou réduire** le throttle sur les agents throttlés (priorité : rôle goulot) |
| `ALLINEATO Δ ±0.2%/h`            | dans la tolérance.                                            | ne rien faire, attendre le prochain tick                                               |

> 💡 `X%/h` vs `Y%` sont la même chose en deux unités. `Y = X / vel_team × 100`.

## Quoi en faire

Le verdict vous dit **s'il faut** bouger et grossièrement **de combien**. Le convertir en valeurs dans `throttle.json` — quel agent ralentit, de combien de crans, et quand le bon geste est aucun — revient à **`throttle-distribution`**. Ouvrez celle-là pour agir : c'est elle qui détient l'arithmétique, l'échelle et les règles de sécurité.

Deux choses à emporter :

- **`share` répond à QUI.** Le throttle ne rend du budget qu'en proportion de ce qu'un agent dépense réellement : un « coupez 19% » au niveau de l'équipe n'est donc jamais « tout le monde baisse de 19% ».
- **`cadenza` répond à DE COMBIEN.** C'est l'entrée de la formule de durée : la même valeur en config coupe très différemment sur un agent qui atteint un checkpoint deux fois par heure et sur un qui y arrive dix fois.

## Anti-patterns

- ❌ Lire uniquement `VERDETTO` et ignorer `share` / `cadenza` : vous coupez à l'aveugle sur tous les agents et frappez les rôles bon marché (Scorer, Analista) avant les coûteux (Scrittore, Critico).
- ❌ Traiter un seul tick SFORO comme un état permanent : 1 tick est du bruit, 2 ticks consécutifs sont un signal.
- ❌ Mélanger ce flux avec celui de `sentinel-orders` : un `[BRIDGE PACING]` et un `[URG] RALLENTARE` peuvent arriver à quelques minutes d'intervalle. Le `[URG]` gagne toujours — appliquez-le d'abord, le prochain pacing remesurera.
- ❌ Pousser des chiffres de pacing via tmux aux agents (`[INFO] sleep 40s`). Passez toujours par `throttle-config.py` — les agents lisent le fichier, ils ne parsent pas le corps de votre tmux.

## Voir aussi

- `throttle-distribution` — l'actionnement : qui ralentit, de combien, et quand ne rien faire.
- `sentinel-orders` — ticks routiniers, niveaux de throttle 0-4, urgences.
- `bridge-mailbox` — vider les verdicts de pacing manqués pendant un long tour (le bridge ajoute au JSONL même si l'envoi tmux en direct a échoué).
- `throttle` — la référence CLI de `throttle-config.py` et le fichier d'état par agent.
- `pipeline-triage` — quand MARGINE signifie "spawner un de plus au goulot" plutôt que simplement mettre le throttle à zéro.
