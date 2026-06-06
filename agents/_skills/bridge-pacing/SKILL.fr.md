<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: bridge-pacing
description: Traduire un tick de calibration `[BRIDGE PACING]` de 15 minutes en ajustements de throttle par agent. Le bridge mesure le taux réel de consommation de l'équipe et vous donne un verdict (SFORO / MARGINE / ALLINEATO) plus la part par agent + la cadence nécessaire pour choisir QUI ralentir et DE COMBIEN. Ouvrez cette skill UNIQUEMENT quand une ligne `[BRIDGE PACING]` arrive ; les ordres routiniers `[SENTINELLA]` utilisent un flux différent (`sentinel-orders`).
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — calibration de throttle basée sur les données

Le bridge exécute une fenêtre de mesure toutes les 15 min (alignée sur :00/:15/:30/:45 UTC). À chaque fermeture de fenêtre, il écrit une ligne dans le panneau du Capitano qui résume le taux réel de l'équipe et vous indique dans quel sens biaiser le throttle. Ce n'est **pas** un ordre de la Sentinella — c'est un signal de calibration sur lequel vous agissez avec `throttle-config.py`.

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

## Formule de calibration (la seule nouveauté ici)

Pour obtenir une réduction de taux de `f%` sur un agent avec cadence `c` checkpoint/min, la durée à mettre dans `throttle-config` est :

```
durata_sec = (f / 100) × 60 / c
```

L'intuition : chaque appel `jht-throttle` ajoute `durata_sec` de pause. Sur 60s l'agent l'appelle `c` fois → ajoute `c · durata` secondes de pause par minute → réduction fractionnelle du taux `= c · durata / 60`. Résoudre pour `durata`.

### Exemple détaillé — concentrer la réduction sur un seul agent

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
```

Pousser presque toute la réduction sur `analista-1` :
- fraction sur analista-1 ≈ 19% / 47% ≈ 40%
- `durata_sec = 0.40 × 60 / 0.6 = 40s`
- → `throttle-config.py set analista-1 40`

### Exemple détaillé — répartir la réduction sur deux agents

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
scout-1:    share 26%, cadenza c_scout
```

Poids combiné 47 + 26 = 73%. Répartir les 19% proportionnellement :
- fraction par agent ≈ 19% / 73% ≈ 26%
- analista-1: `0.26 × 60 / 0.6 = 26s`
- scout-1:    `0.26 × 60 / c_scout`
- → une écriture atomique `bulk-set` :

```bash
python3 /app/shared/skills/throttle-config.py bulk-set \
    analista-1=26 scout-1=<dérivé de c_scout>
```

## Lors de la libération du throttle (MARGINE)

Si le verdict est `MARGINE −X%/h → puoi salire Y%` :
1. Choisir le rôle que vous voulez accélérer (priorité : le goulot actuel — `pipeline-triage` en cas de doute).
2. Réduire son throttle actuel d'environ `Y%` (ou le mettre à zéro s'il était faible).
3. **Ne pas** tout mettre à zéro d'un coup — vous oscilleriez vers un SFORO au tick suivant.

## Cadence après un changement de config

- Après tout changement, attendre **2-3 ticks** (≈30-45 min) avant d'intervenir à nouveau.
- Le pacing est déjà votre synthèse — ne faites **pas** d'appels supplémentaires `rate_budget live` entre les ticks (ils gonflent le `velocity_smooth` de la Sentinella).
- Si après 3 ticks le verdict est toujours SFORO, doublez les durées sur les mêmes agents (linéaire → géométrique) ; si toujours MARGINE, divisez par deux.

## Anti-patterns

- ❌ Lire uniquement `VERDETTO` et ignorer `share` / `cadenza` : vous coupez à l'aveugle sur tous les agents et frappez les rôles bon marché (Scorer, Analista) avant les coûteux (Scrittore, Critico).
- ❌ Traiter un seul tick SFORO comme un état permanent : 1 tick est du bruit, 2 ticks consécutifs sont un signal.
- ❌ Mélanger ce flux avec celui de `sentinel-orders` : un `[BRIDGE PACING]` et un `[URG] RALLENTARE` peuvent arriver à quelques minutes d'intervalle. Le `[URG]` gagne toujours — appliquez-le d'abord, le prochain pacing remesurera.
- ❌ Pousser des chiffres de pacing via tmux aux agents (`[INFO] sleep 40s`). Passez toujours par `throttle-config.py` — les agents lisent le fichier, ils ne parsent pas le corps de votre tmux.

## Voir aussi

- `sentinel-orders` — ticks routiniers, niveaux de throttle 0-4, urgences.
- `bridge-mailbox` — vider les verdicts de pacing manqués pendant un long tour (le bridge ajoute au JSONL même si l'envoi tmux en direct a échoué).
- `throttle` — la référence CLI de `throttle-config.py` et le fichier d'état par agent.
- `pipeline-triage` — quand MARGINE signifie "spawner un de plus au goulot" plutôt que simplement mettre le throttle à zéro.
