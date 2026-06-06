<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: feedback-query
description: Lire les retours utilisateur (like/dislike/hide/star) pour une position donnée depuis le cloud. Utilisé par le Scorer pour appliquer un multiplicateur sur le score final et par le Scout comme signal contextuel. Retourne un payload neutre "no signal" quand le cloud est désactivé ou inaccessible, pour que les appelants n'échouent jamais de manière dure.
allowed-tools: Bash(python3 *)
---

# feedback-query — Retours utilisateur par position

L'utilisateur peut cliquer like/dislike/hide/star sur n'importe quelle position depuis le tableau de bord web. Ces clics sont stockés dans Supabase `position_feedback` (mig 019 base + mig 028 étendue) et surfacés aux agents via cette skill. Schéma :

| Colonne              | Type    | Signification |
|---------------------|---------|---------|
| `position_legacy_id`| TEXT    | Le `legacy_id` (chaîne) de la position dans `positions` |
| `action`            | TEXT    | Un de `like`, `dislike`, `hide`, `star` |
| `reason`            | TEXT    | Raison courte optionnelle (≤500 car) |
| `comment`           | TEXT    | Commentaire verbeux optionnel (≤2000 car, mig 028) |
| `score`             | INTEGER | Score granulaire optionnel 1-5 (mig 028) |
| `direction`         | TEXT    | Optionnel `more_like_this` / `less_like_this` — signal de pattern pour le Scout, PAS un skip par position (mig 028) |
| `created_at`        | TS      | Heure de soumission |

La skill appelle `GET /api/positions/{legacy_id}/feedback` sur le cloud (utilisant le bearer token dans `$JHT_HOME/cloud.json`). Sur cloud désactivé ou échec réseau, la skill **ne produit pas d'erreur** — elle retourne `ok=true, latest_action=null` avec un champ `note`. Les agents doivent continuer.

## Consultation pour une seule position

```bash
python3 /app/shared/skills/feedback_query.py check <legacy_id>
```

Sortie (JSON sur stdout) :

```json
{
  "ok": true,
  "legacy_id": "42",
  "latest_action": "dislike",
  "latest_direction": "less_like_this",
  "count": 2,
  "actions": [
    {"action": "dislike", "created_at": "2026-05-30T14:21:00Z",
     "reason": "too senior", "comment": "5+ anni in Java richiesti, non mi interessa stack legacy",
     "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "comment": null, "score": null, "direction": null}
  ]
}
```

`latest_action` est le clic le plus récent. `latest_direction` est la valeur NON-NULL la plus récente de `direction` dans l'historique (n'importe où dans actions[], pas nécessairement la dernière action). `actions[]` est trié DESC par `created_at`. Vide quand aucun feedback n'existe :

```json
{"ok": true, "legacy_id": "99", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": []}
```

Quand le cloud est désactivé ou l'endpoint est inaccessible, la skill retourne :

```json
{"ok": true, "legacy_id": "...", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": [],
 "note": "no-signal (cloud-disabled)"}
```

## Comment les agents l'utilisent

**Scorer** (obligatoire au moment du scoring) :
1. Après avoir calculé le score de base (somme des composantes pondérées), appeler `feedback_query check <legacy_id>`.
2. Appliquer le multiplicateur basé sur `latest_action` :
   - `like` → final_score = round(base * 1.10), ajouter note `feedback:like+10%`
   - `star` → final_score = round(base * 1.15), ajouter note `feedback:star+15%`
   - `dislike` → final_score = round(base * 0.85), ajouter note `feedback:dislike-15%`
   - `hide` → status=`excluded`, note `feedback:hide`, sauter l'écriture du score
   - `null` → aucun changement
3. Plafonner le score final à 100 après multiplicateur.

**Scout** (signal contextuel optionnel) :
- Pas pour le skip par position — c'est déjà géré par la dédup (SC-05).
- L'utiliser avec parcimonie lors de la réévaluation d'une position connue (ex. logique de promotion) : si l'utilisateur l'a explicitement disliké, ne pas la resurfacer même si la dédup la rescorerait normalement.
- **Signal de pattern via `direction`** (mig 028) : quand `latest_direction='less_like_this'` sur une position, l'utilisateur demande moins de positions COMME celle-ci (même entreprise / role_family / localisation). Déprioriser cette source/pattern dans les recherches suivantes. Quand `latest_direction='more_like_this'`, prioriser la réplication du pattern. C'est un indice contextuel, pas une règle dure — le combiner avec la vue d'ensemble (ex. un seul `less_like_this` sur une petite niche peut être du bruit ; trois sur la même entreprise ne le sont pas).

## Notes

- La skill est **en lecture seule**. Les écritures n'ont lieu que depuis le navigateur via POST `/api/positions/{legacy_id}/feedback`.
- Le bearer token vient de `cloud.json` ; pas de variable d'environnement séparée nécessaire.
- Timeout de 10s par appel. Si vous traitez beaucoup de positions en lot, attendez-vous à ~50-200ms par appel. Pour les traitements en lot, intégrer dans la boucle avec les pauses de throttle habituelles.
