<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: feedback-query
description: Lire les retours utilisateur (like/dislike/hide/star) depuis le cloud — une position à la fois, ou agrégés sur une fenêtre. Utilisé par le Scorer pour appliquer un multiplicateur sur le score final et pour porter la raison de l'utilisateur dans la note, par le Mentor pour compter les raisons récurrentes (Pattern F) et par le Scout comme signal contextuel. Retourne un payload neutre "no signal" quand le cloud est désactivé ou inaccessible, pour que les appelants n'échouent jamais de manière dure.
allowed-tools: Bash(python3 *)
---

# feedback-query — Retours utilisateur par position

L'utilisateur peut cliquer like/dislike/hide/star sur n'importe quelle position depuis le tableau de bord web. Ces clics sont stockés dans Supabase `position_feedback` (mig 019 base + mig 028 étendue) et surfacés aux agents via cette skill. Schéma :

| Colonne              | Type    | Signification |
|---------------------|---------|---------|
| `position_legacy_id`| TEXT    | Le `legacy_id` (chaîne) de la position dans `positions` |
| `action`            | TEXT    | Un de `like`, `dislike`, `hide`, `star`, `clear` (mig 059 — l'utilisateur retire son jugement ; le dernier événement l'emporte, donc un `clear` en fin de liste signifie "aucun jugement") |
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

## Lecture agrégée (fenêtre sur toutes les positions)

Un seul appel HTTP au lieu de N : `GET /api/positions/feedback?days=&limit=`, même bearer token, même repli neutre.

```bash
# Tous les événements de retour dans la fenêtre, du plus récent
python3 /app/shared/skills/feedback_query.py recent --days 30

# Les raisons écrites par l'utilisateur, regroupées par similarité
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3
```

Sortie de `themes` :

```json
{"ok": true, "window_days": 30, "field": "both",
 "events_total": 31, "events_with_text": 19,
 "positions_with_text": 17, "positions_cleared": 2,
 "by_action": {"like": 6, "dislike": 21, "hide": 3, "star": 1},
 "min_positions": 3,
 "themes": [
   {"key": "tropp senio", "label": "troppo senior",
    "positions": 7, "events": 8, "share": 0.412,
    "actions": {"dislike": 6, "hide": 2},
    "legacy_ids": ["42", "51", "63"],
    "examples": ["troppo senior", "richiesta troppo seniore — Lead role"]}
 ]}
```

Comment fonctionne le regroupement (aucune correspondance exacte exigée, aucune dépendance nouvelle) : minuscules → accents retirés → ponctuation retirée → mots outils retirés → chaque mot coupé à ses 5 premiers caractères (`senior` / `seniority` / `seniore` / `séniorité` tombent sur une seule clé) → on compte les mots seuls et les **paires adjacentes**, par **positions distinctes**, pas par événements. Une paire absorbe ses parties quand elle couvre ≥ 80% des mêmes positions, ainsi "trop senior" l'emporte sur "senior" ; les intensificateurs restent dans le flux exprès. `reason` et `comment` sont tokenisés séparément, donc aucune paire n'est inventée à cheval sur les deux.

Limites voulues, déclarées pour que personne ne lise dans les chiffres plus qu'il n'y a :
- Les synonymes éloignés restent séparés (`salaire` et `RAL` sont deux thèmes) — c'est du comptage de mots, pas de la sémantique. Lis les `examples` (verbatim, 3 max) et fais le rapprochement avec ta tête.
- Les positions dont le **dernier** événement est `clear` restent dehors (le jugement a été retiré) ; `--include-cleared` les remet.
- `share` = positions du thème / `positions_with_text`.
- `--field reason|comment|both` (défaut `both`), `--top N`, `--days 0` pour tout l'historique.
- Repli quand l'endpoint agrégé ne répond pas : `--legacy-ids 12,13,14` lit ces positions une à une (plus lent, même format de sortie).

Options : `--days` (défaut 30, `0` = tout), `--limit` (défaut 500 événements), `--min-positions` (défaut 3), `--text-chars` sur `recent` (défaut 300, tronque les longs commentaires).

Quand le payload porte une `note` (`no-signal (...)`), il n'y a pas d'agrégat : cloud éteint, endpoint absent ou réseau coupé. Traite-le comme "aucune donnée", jamais comme "aucun retour".

## Comment les agents l'utilisent

**Scorer** (obligatoire au moment du scoring) :
1. Après avoir calculé le score de base (somme des composantes pondérées), appeler `feedback_query check <legacy_id>`.
2. Appliquer le multiplicateur basé sur `latest_action` :
   - `like` → final_score = round(base * 1.10), ajouter note `feedback:like+10%`
   - `star` → final_score = round(base * 1.15), ajouter note `feedback:star+15%`
   - `dislike` → final_score = round(base * 0.85), ajouter note `feedback:dislike-15%`
   - `hide` → status=`excluded`, note `feedback:hide`, sauter l'écriture du score
   - `clear` / `null` → aucun changement (un jugement retiré n'est pas un jugement)
3. **Porte la raison dans la note**, quand l'utilisateur en a écrit une. Prends `reason` (ou, s'il est vide, `comment`) du **même événement** que `latest_action` — `actions[0]` — cite-la telle quelle, coupe à ~80 caractères et ajoute-la à la note :

   ```
   feedback:dislike-15% — "trop senior"
   feedback:star+15% — "exactement la stack que je veux"
   ```

   Aucun texte sur cet événement → la note reste telle quelle. La raison ne vaut que **pour cette position** : ne la reporte jamais sur une autre, n'en fais pas une règle, ne la réécris pas et ne la résume pas — ce sont les mots de l'utilisateur et il les relit. Agréger les raisons à travers les positions est le travail du Mentor (Pattern F), pas du Scorer.
4. Plafonner le score final à 100 après multiplicateur.

**Mentor** (Pattern F, lecture seule) : `themes` sur les 30 derniers jours pour compter les raisons que l'utilisateur écrit. Les seuils et l'interprétation vivent dans la skill `mentor-patterns`. Le Mentor parle **à l'utilisateur** — il n'émet jamais d'instruction de recherche à partir de cette donnée.

**Scout** (signal contextuel optionnel) :
- Pas pour le skip par position — c'est déjà géré par la dédup (SC-05).
- L'utiliser avec parcimonie lors de la réévaluation d'une position connue (ex. logique de promotion) : si l'utilisateur l'a explicitement disliké, ne pas la resurfacer même si la dédup la rescorerait normalement.
- **Signal de pattern via `direction`** (mig 028) : quand `latest_direction='less_like_this'` sur une position, l'utilisateur demande moins de positions COMME celle-ci (même entreprise / role_family / localisation). Déprioriser cette source/pattern dans les recherches suivantes. Quand `latest_direction='more_like_this'`, prioriser la réplication du pattern. C'est un indice contextuel, pas une règle dure — le combiner avec la vue d'ensemble (ex. un seul `less_like_this` sur une petite niche peut être du bruit ; trois sur la même entreprise ne le sont pas).

## Notes

- La skill est **en lecture seule**. Les écritures n'ont lieu que depuis le navigateur via POST `/api/positions/{legacy_id}/feedback`.
- Le bearer token vient de `cloud.json` ; pas de variable d'environnement séparée nécessaire.
- Timeout de 10s sur `check`, 20s sur l'appel agrégé. Si vous traitez beaucoup de positions avec `check`, attendez-vous à ~50-200ms par appel — c'est exactement ce que `recent` / `themes` existent pour éviter.
- L'agrégat est restreint à l'utilisateur côté serveur : il retourne les retours de cet utilisateur et rien d'autre.
