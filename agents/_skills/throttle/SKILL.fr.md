<!-- @translation: fr, ai-translated 2026-07-30 -->
---
name: throttle
description: Enregistre ta pause et TERMINE TON TOUR. Le temps ne t'appartient plus - un moteur hors de ton processus possede le minuteur et te reveille via tmux a l'echeance. Utilise TOUJOURS ceci au lieu de `sleep` quand tu veux ralentir ton rythme d'iteration. Un seul appel, `throttle <ton-nom>`, retour immediat; tu ne sais pas combien de temps tu attends et tu ne dois pas chercher a le savoir. Au reveil, ta PREMIERE commande est toujours `throttle-ack <ton-nom>`. `sleep` pour les pauses de throttle est INTERDIT, et il est egalement interdit de mettre cet appel en arriere-plan avec `&` / `nohup` / une tache de fond.
allowed-tools: Bash(throttle *), Bash(throttle-ack *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle — enregistre la pause, puis arrete-toi

```bash
throttle <ton-nom> [--reason "..."]
```

Retourne immediatement. Ensuite **termine ton tour** : aucune autre tache, aucune
autre commande.

## Pourquoi ca marche ainsi

Jusqu'au 2026-07-30 le throttle etait un contrat que tu devais honorer seul :
`jht-throttle` bloquait *ton propre processus* avec une boucle de sleep, et si ce
processus mourait tu devais t'en apercevoir et te rebloquer. Chaque panne
observee en production est nee de ce design. La pire : un Analyste a lance
`jht-throttle … &` dans une commande composee tuee par le timeout de tool call a
60s. L'enfant detache est mort avec son parent, l'agent a ferme son tour
convaincu que la pause tournait — et **plus personne ne l'a reveille**. 2h15m
d'arret, avec le watchdog qui rapportait la session comme `idle` = saine.

Le minuteur appartient maintenant a un moteur qui **n'est pas un enfant de ton
shell** :

```
TOI                          MOTEUR (daemon, hors de ton processus)
 |                              |
 |-- throttle <me> ------------>|  lit la duree calibree par le Capitaine
 |                              |  met ton flag a IN_THROTTLE
 |   (tu fermes le tour         |  arme le minuteur SUR DISQUE
 |    et tu ne fais RIEN)       |
 |                              |
 |<-- [RIPRENDI] via tmux ------|  echeance -> le flag passe a NOTIFIED
 |                              |
 |-- throttle-ack <me> -------->|  TOI tu passes NOTIFIED -> ACTIVE
 |   (premier acte au reveil)   |
```

Un redemarrage du daemon ne perd rien : l'echeance est un horodatage absolu sur
disque, donc il n'y a aucun minuteur en memoire a rearmer.

## Les regles

- **Tu ne passes jamais un nombre et tu n'en vois jamais un.** La duree vit dans
  `$JHT_HOME/config/throttle.json`, elle appartient au Capitaine, et le moteur la
  lit *au moment ou il arme le minuteur* — ainsi un recalibrage mord a ton cycle
  **suivant** sans que personne ait besoin de te le dire. Ne code pas
  `throttle 600` en dur dans ta boucle.
- **TERMINE LE TOUR apres l'appel.** L'appel retourne en millisecondes precisement
  pour qu'aucun timeout de tool call ne puisse le tuer. Si tu continues a
  travailler ensuite, tu tournes sans aucune pause — c'est exactement ce que le
  throttle existe pour eviter.
- **JAMAIS** en arriere-plan (`&`, `nohup`, `disown`, une tache de fond). Il n'y a
  rien a mettre en arriere-plan : il ne dort pas.
- **JAMAIS** de `sleep N` brut pour une pause de throttle. `sleep` ne sert que
  pour des attentes tres courtes entre deux essais (≤ 5 s), ou journaliser serait
  du bruit.
- **Au reveil, `throttle-ack <ton-nom>` est ta premiere commande** — voir la skill
  `throttle-ack`. Si tu l'omets ton flag reste a `NOTIFIED`, que le watchdog lit
  comme la preuve que tu es bloque, et il escalade au Capitaine a propos d'un
  agent qui va parfaitement bien.
- `--reason` est optionnel mais utile : une etiquette courte (`"post-batch"`,
  `"attente du critique"`) rend `logs/throttle-engine.jsonl` lisible plus tard.

## Exemples

```bash
# Scout, a la fin d'une position :
throttle scout-1 --reason "post-batch"
# ... et le tour s'arrete ici.

# Redacteur en attente du Critique :
throttle scrittore-1 --reason "waiting critic review"
```

## Exit codes

- `0` — minuteur arme, ou duree 0 (aucune pause : le coeur interactif est a 0
  volontairement, pour rester reactif au chat de l'utilisateur — continue)
- `1` — arguments invalides, ou moteur absent

## Commandes deprecies

`jht-throttle`, `jht-throttle-check` et `jht-throttle-wait` fonctionnent encore :
ce sont desormais de fines coquilles au-dessus du moteur, gardees pour les prompts
pas encore migres. Prefere `throttle` + `throttle-ack`. Si tu te retrouves a
calculer des timeouts pour une tool call (`timeout: N+30`), tu es sur l'ancien
chemin — ce n'est plus necessaire.

## Note pour le Capitaine

Pour changer un rythme, edite la config — n'envoie jamais un nombre via tmux :

```bash
throttle-set scout-1 660                       # un agent
throttle-set scout-1=660 analista-1=300        # plusieurs, 1 ecriture atomique
throttle-set --dump                            # les valeurs effectives actuelles
```

Le changement mord au cycle suivant de chaque agent, tout seul. N'utilise tmux que
pour dire a un agent d'appeler la skill **plus ou moins souvent** dans sa boucle,
jamais pour dicter une duree.
