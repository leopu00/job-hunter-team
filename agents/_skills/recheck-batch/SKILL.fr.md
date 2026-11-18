---
name: recheck-batch
description: Recheck cadencé du MODE SOIN à coût minimal. Le script fait le travail mécanique sur un batch (vérification par paliers de chaque URL, met à jour last_checked pour les OPEN vérifiées) ; toi, tu juges SEULEMENT les cas ambigus. Mesuré à 78-86kT par position avec le tour manuel — avec le batch tu dépenses un tour pour 10 positions, pas 10 tours. L'exclusion reste TOUJOURS ta décision, jamais celle du script.
allowed-tools: Bash(python3 /app/shared/skills/recheck_batch.py *), Bash(python3 /app/shared/skills/db_update.py *), Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-batch — le recheck du mode soin, sans gaspiller un tour par position

## Pourquoi elle existe
Revérifier une position DÉJÀ analysée ne coûte qu'une fraction du check d'une
nouvelle position : pas de réanalyse, pas de relecture de la JD, pas de
métadonnées. Le tour manuel (file → une position → recheck-liveness →
db_update → recommencer) coûtait 78-86kT par position parce que chaque étape
était un tour LLM. Ce batch comprime toute la partie mécanique en UNE seule
commande.

## Comment l'utiliser (UN tour par batch)
```sh
python3 /app/shared/skills/recheck_batch.py            # batch di 10 dalla coda
python3 /app/shared/skills/recheck_batch.py --limit 5
```
Elle prend les positions de la file `next-for-recheck-due` (vivantes,
score ≥ policy, non vérifiées depuis > 14 jours, SCORE DESC : les meilleures
d'abord) et pour chacune exécute la vérification par paliers de
`recheck_liveness.py` (curl → navigateur, jamais de faux ouvert).

Le rapport a trois issues :
- **OK ouvertes et mises à jour** — vérifiées `OPEN` : `last_checked` est
  déjà mis à jour, elles sortent de la file pour 14 jours. **N'y touche pas,
  ne les relis pas, zéro travail pour toi.**
- **À JUGER** — indice de fermeture (404/410, closed-marker, ou
  `expires_at` dépassée). C'est là que TU interviens.
- **NON VÉRIFIABLES** — hôte JS/authwall et navigateur non concluant. C'est
  là que TU interviens (one-shot).

## Le jugement t'appartient — le script n'exclut JAMAIS (ordre de l'utilisateur 2026-07-30)
Un script statique peut se tromper et jeter une position encore vivante.
Pour chaque position **À JUGER** : regarde l'indice rapporté ; si besoin,
UN seul coup d'œil direct à la page. Si tu es sûr à 100 % qu'elle est
expirée/fermée :
```sh
python3 /app/shared/skills/db_update.py position <ID> --status excluded \
  --is-open false --last-open-check now --notes "[SCADUTO] <evidenza>"
```
Si au contraire elle est encore vivante (faux positif du script) :
```sh
python3 /app/shared/skills/db_update.py position <ID> --is-open true --last-checked now
```
Pour chaque **NON VÉRIFIABLE** : one-shot avec le navigateur sur l'URL ;
puis décide comme ci-dessus. Si elle reste non vérifiable →
`--last-checked now` + note `[OPEN_UNVERIFIED]`, `is_open` inchangé (ne
jamais la faire passer pour ouverte).

## Discipline de coût (le but de la skill)
- **Un batch = un tour.** Ne fais pas un tour par position, ne réanalyse
  pas, ne relis pas la JD ni l'entreprise : le recheck décide seulement
  « encore ouverte ? ».
- Batch borné (par défaut 10) : NE relève PAS la limite pour « finir la
  file d'un coup » — la cadence étale le travail, le Capitano donne le
  rythme (C-09/C-18).
- File OFF par enrichment-policy = état voulu : arrête-toi, ne la contourne
  pas.
