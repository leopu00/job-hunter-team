<!-- @translation: fr, ai-translated 2026-07-30 -->
---
name: throttle-set
description: La SEULE facon dont les rythmes de l'equipe sont ecrits. Capitaine uniquement. `throttle-set <agent> <secondes>` modifie la config de throttle par agent; le moteur la relit quand il arme chaque minuteur, donc le changement mord au cycle SUIVANT de cet agent tout seul - aucun message tmux, aucun agent n'a rien a relire, et le cycle deja en cours n'est pas perturbe. Utilise-le au lieu d'envoyer des nombres aux workers. Aussi `throttle-set a=N b=M ...` pour une ecriture multiple atomique, `--dump` pour les valeurs effectives, `--get <agent>`, `--reset`.
allowed-tools: Bash(throttle-set *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle-set — gouverne les rythmes sans toucher aux agents

```bash
throttle-set <agent> <secondes>             # un agent
throttle-set scout-1=660 analista-1=300     # plusieurs, une ecriture atomique
throttle-set --dump                         # les valeurs EFFECTIVES maintenant
throttle-set --get <agent>                  # la valeur effective d'un seul
throttle-set --reset                        # supprime tous les overrides
```

## Pourquoi tu n'envoies jamais un nombre via tmux

Le moteur de throttle lit la config **au moment ou il arme chaque minuteur**.
Donc :

- une valeur que tu changes ici mord au cycle **suivant** de cet agent, seule ;
- le cycle **en cours** n'est pas touche — son echeance etait deja calculee, et la
  deplacer serait une surprise que personne n'a demandee ;
- les workers ne voient jamais un nombre et ne savent pas combien ils attendent.
  Ils appellent `throttle <leur-nom>` et s'arretent. La duree n'appartient qu'a toi.

C'est toute la raison d'etre de cet outil : cinq messages tmux portant un nombre
sont cinq occasions d'entrer en course avec un agent en pleine pause. Une ecriture
atomique, aucune.

## Ce qui te revient est l'EFFECTIF, pas ce que tu as demande

Deux corrections automatiques s'appliquent a la lecture, donc le nombre que
l'agent subit peut differer de celui que tu as ecrit :

- **Worker floor, 5 min.** Les workers (Scout/Analyste/Scorer/Redacteur/Critique)
  ne descendent jamais sous 300s, `0` compris. Cela vient d'un incident mesure —
  un Scout sans pause a brule ~308kT pour 3 positions de donnees sales. Le coeur
  interactif (Capitaine/Sentinelle/Assistant/Mentor) n'a **pas** de floor : il doit
  rester reactif pour le chat de l'utilisateur, donc la `0` reste `0`.
- **Echelle coprime.** Toute valeur > 0 s'accroche a un barreau en minutes
  premieres (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60). Les barreaux
  multiples de 5 resynchronisaient les workers *par construction* : 5+10
  coincidaient toutes les 10 minutes. Les barreaux coprimes rendent les collisions
  rares au lieu de periodiques.

Donc `throttle-set scout-1 120` se relit `300`. Ce n'est pas l'outil qui t'ignore —
c'est la valeur que l'agent subira, et c'est ce que `--dump` montre.

Les deux s'effacent tant que la derogation a duree limitee de l'utilisateur est
vivante, et reviennent d'elles-memes a son expiration. Tu n'as pas a penser a les
restaurer.

## Pour CONSOMMER plus, le levier est le parallelisme, pas un throttle plus court

Les workers ne descendent pas sous 5 min, donc « mets le throttle a 0 » n'existe
pas pour eux. Si l'equipe est sous le rythme cible, ajoute des workers **par
etapes** ; n'essaie pas de rattraper en rognant la pause. Un throttle sature est
un signal, pas une destination : quand un agent est deja haut sur l'echelle et
depasse encore, le levier devient de le tuer, pas une nouvelle poussee.

## Exit codes

- `0` — ecrit / lu
- `1` — arguments invalides, valeur hors plage (0..3600), ou config absente

## Exemple

```bash
throttle-set --dump
# default = 0s
# scout-1        = 660s
# analista-1     = 300s

throttle-set scout-1 1380
# scout-1=1380s

# scout-1 est en pleine pause : il garde ses 660s, et subira 1380s au prochain
# cycle. Personne ne lui a rien dit.
```
