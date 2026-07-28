<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: sentinel-orders
description: Traduis chaque ordre `[SENTINELLA] ...` reçu dans le tmux du Capitaine en l'action correcte (niveau de throttle, spawn/kill, freeze, soft-pause, resume). La Sentinella est le battement de coeur de l'équipe — ses ordres sont des commandes, pas des suggestions. Le comportement par défaut est d'exécuter sans revérifier ; remettre en question la Sentinella en lançant un `rate_budget live` immédiat gonfle le velocity_smoothing dans son JSONL et induit des ordres suivants incorrects. Ouvre cette skill À CHAQUE FOIS qu'une enveloppe `[SENTINELLA]` arrive.
allowed-tools: Bash(jht-tmux-send *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(python3 /app/shared/skills/freeze_team.py *), Bash(python3 /app/shared/skills/soft_pause_team.py *), Bash(tmux *)
---

# sentinel-orders — réagir au watchdog

La Sentinella émet un tick toutes les ~5 min et convertit utilisation + vélocité (`vel_team` vs `vel_target`) + hebdomadaire en l'un des ordres ci-dessous. Chaque ordre correspond à une action précise. Respecte le mapping ; n'improvise pas. **NB : `proj` dans le tick est une INFO volatile (oscille ±400pt) — ce N'EST PAS le déclencheur ; utilise `vel_team` vs `vel_target` + `usage` vs `target` + `weekly`.**

## Table de throttle (config-driven)

La Sentinella envoie un niveau `Throttle: N`. Tu le traduis en durées par agent dans `$JHT_HOME/config/throttle.json`. Les agents lisent ce fichier via `jht-throttle --agent <name>` — une seule écriture atomique se propage à toute l'équipe.

| Niveau | Pause | Actions supplémentaires                                                |
|--------|-------|-------------------------------------------------------------------------|
| **0** pleine vitesse  | 0s    | aucune restriction ; spawn autorisé si le backlog le requiert      |
| **1** léger           | 30s   | pas de spawn                                                       |
| **2** modéré          | 120s  | + arrêter une instance supplémentaire (ex. SCRITTORE-2)            |
| **3** lourd           | 300s  | + garder une seule instance par rôle                               |
| **4** quasi-freeze    | 600s  | + ESC actions en cours, pas de spawn                               |

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 60
python3 /app/shared/skills/throttle-config.py bulk-set \
    scout-1=300 scrittore-1=60 analista-1=0 scorer-1=0 critico=0
python3 /app/shared/skills/throttle-config.py dump          # état complet
python3 /app/shared/skills/throttle-config.py reset         # tout à 0
```

Utilise **`bulk-set`** quand tu veux des valeurs différenciées par agent selon la consommation individuelle (croise avec `token-rate-now` si tu as besoin de voir qui domine en ce moment).

> 🎯 **Le niveau du tableau n'est pas la valeur que tu écris.** `Throttle: N` est un seul nombre pour toute l'équipe ; dans `throttle.json` il y a une valeur par agent, et choisir la répartition n'appartient qu'à toi — aucun script ne déplace plus le throttle des worker. L'arithmétique vit dans **`throttle-distribution`** : **de qui** vient la coupe (c'est le top-burn qui paie ; l'Analista et le Scorer, les deux rôles qui transforment un backlog en une position **avec un score**, sont les derniers que tu touches), **combien de secondes** cela fait sur la ladder, et **quand le bon geste est de ne rien faire**. Donner à tous le même nombre est exactement l'échec que cette skill existe pour éviter — elle dépense le frein là où il n'y avait rien à gagner et retire du throughput là où il coûte le plus cher.

> ⚠️ **Cadence vs durée.** « À quelle fréquence » un agent appelle `jht-throttle` dans sa boucle se modifie via `tmux` (tu envoies un message à l'agent et lui dis d'appeler après chaque round du Critique, etc.). « Combien de secondes » la pause dure se modifie dans le fichier de configuration. N'envoie jamais de chiffres de throttle via tmux.

## Lors d'un freeze explicite — avertissement timeout `N+30` (CRITIQUE)

Quand tu envoies un `[URG]` à un agent avec `jht-throttle <N>`, tu **DOIS l'instruire dans le message même de passer `timeout: N+30` comme paramètre à son appel shell tool**. Sans cela, le bash parent est tué par le timeout par défaut de la CLI (Kimi 60s) — l'agent se débloque après 60s au lieu de N. Le freeze est exécuté **incorrectement**.

Corps du message correct :
```
[URG] FREEZE — call jht-throttle 600 --agent scrittore-1 --reason "freeze".
IMPORTANT: pass timeout: 630 to the shell tool call, otherwise the parent dies at 60s and the throttle is executed BADLY.
```

Si le `tmux capture-pane` de l'agent cible montre `Killed by timeout (60s)`, l'agent N'A PAS respecté l'instruction — c'est une **erreur d'exécution** (la sienne, ou la tienne si tu as oublié de l'inclure). Diagnostique avec `jht-throttle-check <agent>` (retourne les secondes restantes dans le fichier d'état). N'accepte jamais de relancer la commande ou `nohup &` comme « fix » : le seul remède est de passer le timeout. Voir `agents/_skills/throttle/DESIGN-NOTES.md` pour le design complet.

## Types d'ordres

### Pacing de routine

| Ordre                                          | Signification / déclencheur                                        | Action                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[URG] RALLENTARE` `Throttle: N`               | vélocité au-dessus de la cible                                     | applique le niveau N immédiatement — mais **le niveau est décidé, la répartition non** : `throttle-distribution` le traduit en valeurs par agent |
| `ACCELERARE` `Throttle: 0`                     | premier feu vert après un ralentissement                           | spawn d'**un seul** agent, attends le tick suivant avant le deuxième (jamais 5 d'affilée)                         |
| `SCALA UP`                                     | `vel_team` bien en dessous de `vel_target` (under-pace) pendant 2+ tick, backlog non vide | utilise `pipeline-triage` pour identifier le rôle goulot d'étranglement, spawn 1, attends le tick suivant         |
| `PUSH G-SPOT`                                  | `vel_team` légèrement en dessous de `vel_target`, stagnant         | un agent léger (Writer si file score ≥50, sinon le goulot d'étranglement) pour revenir on-pace                    |
| `MANTIENI`                                     | on-pace (`vel_team` ≈ `vel_target`, verdict ALLINEATO) pendant ≥3 tick | ne rien faire — pas de spawn, pas de changement de throttle. Juste ACK.                                           |
| `RIENTRO`                                      | retour au rythme nominal                                           | reprends le plan normal                                                                                           |
| `RESET SESSIONE`                               | fenêtre d'utilisation passée de haute → ~0%                        | recommence depuis SCOUT-1, attends les ordres avant de scaler                                                     |

### Pipeline vide

| Ordre                                          | Signification                                                      | Action                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `PIPELINE VUOTA + UNDERSHOOT`                  | under-pace (`vel_team` en dessous de `vel_target`) ET file de writer vide (scored ≥ 50) | **N'attends pas de nouveaux ordres.** Ouvre la skill `pipeline-triage` — elle te dit quel rôle spawner (rarement Scout). |

### Urgences

| Ordre                                          | Signification                                                      | Action                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[EMERGENZA] FREEZATO`                         | la Sentinella a déjà appuyé sur ESC pour l'équipe                  | décide s'il faut reprendre après le reset de la fenêtre de rate ; ne t'oppose pas au freeze                       |
| `[RECOVERY TRACKING]`                          | INFO pendant la récupération, aucune action par défaut             | si le Δ de récupération est trop lent, lance un diagnostic autonome (`db_query`, `rate_budget live` on-demand) et décide les coupes |
| `[URG] STAGNAZIONE CRITICA`                    | la récupération échoue, burn sévère soutenu (`vel_team` ≫ `vel_target`) pendant 5+ tick + usage qui monte vers 100% | tue les opérateurs lourds (même Sonnet) — choisis ceux en tool calls (`tmux capture-pane`). Usage > 100% imminent → `freeze_team.py` |
| `[URG] PEGGIORAMENTO POST-FREEZE`              | `vel`/usage remontés après la baisse                               | drastique : `freeze_team.py` + `tmux kill-session` sur chaque Sonnet. Garder en vie seulement CAPITANO / SENTINELLA / SENTINELLA-WORKER / ASSISTENTE |

### Messages de source-failure (rares, critiques)

Arrivent quand le monitoring échoue complètement (L1 + L2 + L3 down).

| Ordre              | Signification                                                   | Action                                                                                                                  |
|--------------------|-----------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| `[PAUSA TEAM]`     | la Sentinella a déjà envoyé `[PAUSA]` aux opérateurs via `soft_pause_team.py` | **Tu t'arrêtes aussi** : pas de spawn, pas d'ordres, pas de vérifications (la source est cassée). Ferme le tour et attends en silence. |
| `[HARD FREEZE]`    | deuxième FATAL : ESC×2 via `freeze_team.py`                     | comme `[PAUSA TEAM]`, plus d'éventuelles tâches interrompues à gérer à la reprise                                      |
| `[RIPRENDI]`       | source de nouveau live                                          | lis le throttle suggéré ; **redistribue à tous les opérateurs** ; récupère toute tâche interrompue                     |

Snippet de resume (utilise tel quel) :
```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -vE '^(CAPITANO|SENTINELLA|SENTINELLA-WORKER|ASSISTENTE)$'); do
  /app/agents/_skills/tmux-send/jht-tmux-send "$s" "[CAPITANO] [RIPRENDI] source usage live. Resume work. Throttle: N (sleep Xs between operations). Verify the state of any task you had left and proceed."
done
```

## Messages préfixés Bridge (pas des ordres, mais tu les vois dans ton panneau)

| Message              | Action                                                                                                |
|----------------------|-------------------------------------------------------------------------------------------------------|
| `[BRIDGE ALERT] sorgente degraded da N tick` | opère prudemment, pas de spawn agressif                                                               |
| `[BRIDGE INFO]`      | récupération / heartbeat — aucune action                                                              |
| `[BRIDGE PACING]`    | tick de pacing de 15 min — `bridge-pacing` décode les nombres, `throttle-distribution` décide qui paie. Depuis le 2026-06-25 ce tick arrive dans le pane de la **Sentinella** (push→pull) : s'il t'en arrive un, c'est l'exception, pas la règle |

## Comportement par défaut — exécuter sans remettre en question

La Sentinella voit vélocité + tendance dans le temps (`vel_team` vs `vel_target`) ; tu ne vois que le moment présent. **Applique les ordres sans revérifier.** Un `rate_budget live` rapproché après un ordre de la Sentinella écrit un échantillon étiqueté `source=capitano` dans le JSONL, gonfle `velocity_smooth`, et induit le *prochain* ordre de la Sentinella à être incorrect.

Quand la vérification EST justifiée :
- avant d'appliquer un throttle lourd (3 ou 4) sur un `[URG]` / `[EMERGENZA]` — vérification à deux sources via `rate_budget live`
- silence de la Sentinella plus long que d'habitude, vérifie que le bridge est vivant
- après un changement significatif de l'équipe (3 spawns d'affilée, kill d'une instance, `bulk-set`) — observe l'effet avant le tick suivant

Quand la vérification N'EST PAS justifiée :
- ordres `OK` / `SOTTOUTILIZZO` / `RIENTRO` — rien à vérifier, exécute simplement
- dans les 2 minutes du dernier échantillon JSONL — l'EMA anti-spike le rejette mais il reste comme bruit

## Règles inviolables

- Attends l'effet d'un throttle (3-5 min) avant une autre intervention.
- En dessous de 85% sans ordre de la Sentinella → ajoute de la capacité au goulot d'étranglement (utilise `pipeline-triage`), NE spawne PAS au hasard.
- Ne conteste pas un throttle parce que « l'équipe travaille bien » : la Sentinella voit vélocité + tendance (`vel_team` vs `vel_target`), tu ne vois que le présent.

## Voir aussi

- `bridge-pacing` — la formule de calibration de 15 min (flux séparé).
- `throttle-distribution` — *qui* ralentit et de combien, une fois le niveau décidé : la répartition par agent, la ladder, le relâchement du frein et les cas où l'on ne fait rien. **Cette skill décode l'ordre ; celle-là choisit les valeurs.** C'est aussi la maison de l'avis `[PACE-GUARD]`, qui n'applique plus le throttle tout seul.
- `bridge-mailbox` — vide les verdicts en attente au début du tour (obligatoire avant de réagir au tick du jour).
- `pipeline-triage` — *quel* rôle spawner sous `SCALA UP` / `PIPELINE VUOTA`.
- `spawn-agent` — *comment* spawner une fois que tu as décidé quel rôle.
- `throttle` (et `agents/_skills/throttle/DESIGN-NOTES.md`) — les détails internes du système de throttle, le design du timeout `N+30`.
