<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: bridge-mailbox
description: Vider les verdicts du bridge en attente au DÉBUT de chaque tour du Capitano — action OBLIGATOIRE avant toute autre chose. Pendant un long tour, `jht-tmux-send` depuis le bridge peut échouer avec rc=3 (texte jamais apparu dans le panneau) et un verdict `[BRIDGE PACING]` ou `PIPELINE STALLED` est silencieusement perdu. Le bridge ajoute CHAQUE verdict dans une boîte aux lettres JSONL pour que vous puissiez les récupérer. Ne pas vider signifie agir sur des mesures obsolètes alors qu'un verdict plus récent est en attente de lecture.
allowed-tools: Bash(python3 /app/shared/skills/bridge_mailbox.py *)
---

# bridge-mailbox — récupérer les verdicts manqués

Le bridge vous parle via tmux, mais la livraison tmux peut échouer silencieusement pendant un long tour (problèmes de rendu TUI Codex / Kimi, vous étiez dans un long appel d'outil, etc.). Pour s'assurer qu'aucun verdict n'est perdu, le bridge **ajoute également** chaque tick dans une boîte aux lettres JSONL à `$JHT_HOME/logs/bridge-mailbox.jsonl`. Vous la videz au début de chaque tour.

## L'action obligatoire en premier

Avant *toute autre chose* — avant de lire les messages, avant de décider des actions, avant d'ouvrir une autre skill — exécutez :

```bash
python3 /app/shared/skills/bridge_mailbox.py drain
```

Sorties possibles :
- `no pending verdicts` → boîte aux lettres vide, procéder normalement avec le tour.
- une ou plusieurs lignes formatées comme des ticks tmux en direct (`[BRIDGE PACING] ...`, `PIPELINE STALLED ...`, `[BRIDGE ALERT] ...`).

`drain` consomme les entrées (elles sont marquées comme lues en cas de succès) — le relancer retourne `no pending verdicts` jusqu'à ce que le bridge en ajoute de nouvelles.

## Comment appliquer les verdicts vidés

Traitez TOUTES les lignes, mais **n'agissez que sur la dernière**. Les précédentes sont déjà obsolètes — les métriques ont bougé depuis. Deux exceptions où une ligne antérieure compte encore :

1. **`PIPELINE STALLED` récent (< 30 min) et toujours pertinent** (proj est toujours bas, team_kt est toujours bas maintenant). Agissez sur le playbook (relancer le pipeline en amont) même si un `[BRIDGE PACING]` valide plus récent est arrivé après. Les stalls sont un état, pas des événements — ils nécessitent une résolution, pas simplement une mesure.
2. **Un `[PAUSA TEAM]` / `[HARD FREEZE]` que vous avez manqué**. Si un se trouve dans la file et que vous n'avez pas encore envoyé `[RIPRENDI]`, l'équipe est toujours gelée — gérez-le avec `sentinel-orders` *avant* le dernier pacing.

Pour le cas courant (une ou plusieurs lignes `[BRIDGE PACING]`) :
- lisez chaque ligne pour garder le contexte temporel (vous pouvez voir comment la tendance a évolué pendant que vous étiez occupé)
- ouvrez la skill `bridge-pacing` une fois et appliquez uniquement la calibration du **dernier** verdict

## Autres commandes (debug / inspection)

```bash
python3 /app/shared/skills/bridge_mailbox.py status   # combien en attente vs total
python3 /app/shared/skills/bridge_mailbox.py peek     # lire sans consommer
```

Utilisez `peek` quand vous suspectez quelque chose de louche et voulez regarder sans vous engager — cela ne marque PAS les entrées comme lues.

## Anti-patterns

- ❌ Sauter le vidage "parce que le tour semble court" — les échecs rc=3 arrivent de manière imprévisible ; un tick manqué pendant un long tour est le cas typique.
- ❌ Agir sur chaque ligne vidée en séquence — vous rejoueriez des changements de throttle obsolètes, combattriez vos propres calibrations passées, et feriez osciller l'équipe.
- ❌ Exécuter `drain` en milieu de tour juste pour "voir ce qui est arrivé" — drain consomme ; si vous n'êtes pas prêt à agir sur les lignes, utilisez `peek` à la place.
- ❌ Traiter la sortie de `peek` comme faisant autorité — `peek` montre les entrées en attente, mais le panneau tmux en direct peut déjà contenir des entrées plus récentes que le JSONL n'a pas encore rattrapées. Le vidage en début de tour est ce qui vous donne l'image cohérente.

## Voir aussi

- `sentinel-orders` — route `[PAUSA TEAM]` / `[HARD FREEZE]` / `[RIPRENDI]` une fois vidés.
- `bridge-pacing` — formule à appliquer sur la dernière ligne `[BRIDGE PACING]`.
- `pipeline-triage` — playbook pour `PIPELINE STALLED` (relancer le pipeline en amont).
