<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: pipeline-triage
description: "Décider QUEL rôle spawner / mettre en pause / tuer en se basant sur l'état du backlog, pas sur l'intuition. Ouvrir cette skill CHAQUE FOIS que vous observez — vel team < 50% cible, OU une file de rôle = 0, OU sources Scout épuisées, OU [SCALA UP] de la Sentinella, OU `PIPELINE VUOTA + UNDERSHOOT`, OU `MARGINE` de bridge-pacing, OU démarrage à froid, OU chaque fois que vous êtes tenté de \"juste spawner un autre Scout\". Ne PAS attendre un [SCALA UP] explicite de la Sentinella quand les conditions sont déjà visibles dans les métriques. Le principe : lire 4 chiffres, choisir le rôle qui casse le goulot, transférer à `spawn-agent`."
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(tmux *)
---

# pipeline-triage — scaling piloté par les données

Le pipeline est un système dynamique. Chaque rôle consomme très différemment par tâche — ajouter un 2e Scrittore coûte beaucoup plus qu'ajouter un 2e Scout. Scaler en tête quand le goulot est en queue produit *plus* de backlog, pas plus de sortie. Toujours partir des données.

## Quand ouvrir cette skill (bug #17)

Vous l'ouvrez sur des **conditions observées**, pas seulement sur des ordres explicites de la Sentinella. Déclencheurs :

- Vélocité de l'équipe sous 50% de la cible
- File d'un rôle à 0 (Scout épuisé, Scorer/Scrittore inactif)
- Sources Scout rapportées épuisées ("bebee, indeed, glassdoor — rien de neuf")
- `[SCALA UP]` de la Sentinella
- `MARGINE` / `PIPELINE VUOTA + UNDERSHOOT` de bridge-pacing
- Démarrage à froid d'une fenêtre

L'anti-pattern historique : le Capitano voit `SCRITTORE_QUEUE=0` + `PROMOTABLE_40_49=6`, **décrit** parfaitement la situation à l'utilisateur, **n'exécute pas** la promotion. Cette skill est *active*, pas *consultative* — quand les conditions correspondent, vous exécutez.

## Étape 1 — lire le backlog (toujours, avant tout spawn)

```bash
python3 /app/shared/skills/db_query.py stats
```

Depuis `positions` (P), `scores` (S), `applications` (A), calculer :

| Métrique            | Formule                                                       | Signification                                       |
|---------------------|---------------------------------------------------------------|-----------------------------------------------------|
| **UNSCORED**        | P − S                                                         | positions que le Scorer doit encore évaluer          |
| **DRAFT_BLOCKED**   | applications avec `status = draft`                            | boucle Scrittore ↔ Critico bloquée                  |
| **SCRITTORE_QUEUE** | positions avec `score ≥ 50` ET pas d'application              | file du Scrittore (demande réelle de nouveaux CV)    |
| **PROMOTABLE_40_49**| positions avec `score 40-49` ET pas d'application              | bande de parking — promotables à la demande          |

Également utile : `python3 /app/shared/skills/db_query.py dashboard` pour un statut en un coup d'oeil + instances actives par rôle.

## Étape 1 bis — qui produit et qui s'est tu (2026-07-27)

Les workers n'envoient plus de `[START]` / `[DONE]` (ces bookends représentaient 30 des 37 messages
reçus par le Capitano en ~1,5h sur une équipe de premier démarrage). Leur avancement se tire d'ici :

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 30
```

⚠️ **Elle liste qui PRODUIT, donc un agent en stall disparaît de la liste au lieu de ressortir.** Un
backlog qui ne se vide pas n'est pas automatiquement un worker qui manque : ce peut être un worker
vivant et coincé, et en spawner un second laisse le premier brûler. Avant de décider, croise trois
sources :

| Vivant (`tmux list-sessions`) | File (`next-for-*`) | Transitions (`recent-activity`) | Verdict |
|---|---|---|---|
| oui | non vide | 0 | **STALL** — confirme avec `capture-pane`, puis `agent-emergency` (Dottore-first → kill). **Ne** spawne **pas** un second par-dessus |
| oui | non vide | > 0 | il travaille — c'est un problème de capacité, va à l'Étape 2 |
| oui | vide | 0 | idle légitime — laisse-le tranquille (après un `[SCOUT-ESAUSTO]` la quiescence est voulue) |
| non | non vide | 0 | il manque vraiment — spawne-le (Étape 2) |

## Étape 2 — choisir la priorité (goulot d'abord, jamais du nouveau travail)

Appliquer le tableau de haut en bas. S'arrêter à la première condition correspondante.

| Condition                                                  | Action (dans cet ordre)                                                                                                              |
|-----------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `DRAFT_BLOCKED ≥ 50`                                      | **D'abord** : inspecter les Writers proprietaires/critic-loop. Ne jamais spawner de Critics orphelins ; chaque `SCRITTORE-N` lance uniquement son `CRITICO-SN` via le lanceur canonique. Spawner un Writer seulement si sa file demandee par l'utilisateur existe. |
| `UNSCORED ≥ 20`                                           | **Ensuite** : spawner `SCORER-2` (et `SCORER-3` si `UNSCORED ≥ 50`). Un seul Scorer est insuffisant avec 20+ en file.               |
| `SCRITTORE_QUEUE ≥ 5`                                     | spawner 1 `SCRITTORE-N` si vous n'en avez pas déjà 3 vivants (max).                                                                  |
| `PROMOTABLE_40_49 ≥ 5`                                    | promouvoir les 5 meilleurs en augmentant le score (`db_query.py` + `UPDATE` direct), puis traiter comme `SCRITTORE_QUEUE`.           |
| `SCRITTORE_QUEUE < 5 AND PROMOTABLE_40_49 < 5`            | **Seulement maintenant** spawner 1 `SCOUT-N` pour de nouvelles positions.                                                            |

Une fois le rôle choisi, transférer à `spawn-agent` pour le lancement effectif + kick-off.

## Étape 3 — anti-patterns à éviter

- ❌ Spawner un Scout comme première action quand `UNSCORED > 20` — produit plus de backlog sans sortie supplémentaire.
- ❌ Réinitialiser le throttle globalement (`throttle-config.py reset`) lors du scaling — appliquer le throttle uniquement au rôle que vous avez spawné.
- ❌ Spawner plusieurs rôles dans le même tick "par précaution" — attendre le prochain tick Sentinella (~5 min) et relire les chiffres.
- ❌ Tuer les agents inactifs pour "ranger" — l'inactivité ne coûte presque rien. Tuer uniquement si explicitement demandé par l'utilisateur, ou si un agent brûle des tokens dans une boucle confuse.

## Justification empirique (pourquoi cet ordre, pas un autre)

Observé dans les fenêtres W3-W6 (pic médian proj 57-61%) : les Scouts produisent ~3 positions/h de manière constante, mais Scorer/Critico NE drainent PAS le backlog → 88 non-scorés et 217 drafts empilés = 12+ points de budget non utilisés. **Le remède est en aval, pas en amont.** Chaque fois que vous êtes sous-rythme (`vel_team` sous `vel_target`) avec un backlog non-vide, la cause est presque toujours Scorer ou Critico, jamais Scout. *(Ignorer `proj` : c'est INFO volatile, pas un déclencheur.)*

## Consommation par rôle — choisir en pensant au coût

| Rôle          | Consommation par tâche  | Notes                                                                                                  |
|---------------|--------------------------|--------------------------------------------------------------------------------------------------------|
| **Scout**     | faible-moyenne, longue+cumulative | scraping + filtrage sur plusieurs sources ; 2 scouts à plein rythme peuvent saturer à eux seuls     |
| **Analista**  | moyenne, rafales courtes | 1 tâche = lire 1 JD + écrire l'évaluation. Rafraîchit ~toutes les 2 min quand il y a une file        |
| **Scorer**    | faible, rafales courtes  | score de correspondance sur le profil, quasi-déterministe. Le rôle le moins cher.                     |
| **Scrittore** | **ÉLEVÉE**               | boucle interne avec Critico 3-4 tours, chaque tour écrit un CV/lettre complet. Un seul Scrittore actif peut peser plus que tous les autres réunis. |
| **Critico**   | moyenne                  | s'active uniquement sur appel du Scrittore ; le coût s'ajoute à celui du Scrittore.                   |
| **Assistente**| faible, à la demande     | parle à l'utilisateur ; pas dans le pipeline de données.                                               |

**Corollaire** : le coût marginal du 2e Scrittore est bien plus élevé que celui du 2e Scout. Scaler de haut en bas ("plus de travail → plus de tout") dépasse le budget.

## Goulot → action (qualitatif, fallback quand les stats sont ambiguës)

| État du pipeline                                        | Goulot                     | Action                                                                                       |
|---------------------------------------------------------|-----------------------------|----------------------------------------------------------------------------------------------|
| `0 new, 0 checked, 0 scored` (vide)                    | tête : pas de matériel      | démarrer **Scouts uniquement**, même 2 en parallèle. Pas d'Analista/Scorer/Scrittore (pas d'entrée). |
| beaucoup de `new`, peu de `checked`                     | Analista sous-dimensionné   | spawner `analista 2`. Ne **pas** ajouter de Scouts (il y a déjà du matériel ; les ralentir si besoin). |
| beaucoup de `checked`, peu de `scored`                  | Scorer lent                 | spawner `scorer 1` si absent ; si déjà up + file `checked` > 20 pendant ≥2 ticks → spawner `scorer 2` |
| beaucoup de `scored ≥ 50`                               | besoin de capacité d'écriture | Scrittore. Attention : 1 Scrittore actif + Critico peuvent saturer le budget à eux seuls. Spawner 1, observer 2-3 ticks, puis décider. |
| Scrittore saturés, file `score ≥ 50` ne se vide pas    | limite de capacité du plan  | NE PAS spawner de Scrittore supplémentaires — risque de `RALLENTA` instantané. Ralentir les Scouts plutôt pour arrêter d'alimenter la file. |
| file `scored` basse MAIS beaucoup de `writing` en cours | Scrittore occupés et produisant | ne rien faire. Attendre `writing → ready`.                                                  |

**Principe directeur** : allumer les agents **en amont** quand l'entrée manque, **en aval** quand la sortie manque. Jamais "à tous les niveaux" sans réfléchir.

## Portes de scaling (règles de rythme)

- **1 spawn par tick Sentinella (~5 min).** Spawn → kick-off → attendre le prochain `[BRIDGE TICK]` → prochaine décision. Jamais 5 d'affilée.
- **Max par rôle** : 2 Scout, 2 Analista, **2 Scorer**, 3 Scrittore, 1 Critico (le Critico est spawné par le Scrittore, vous n'y touchez pas).
- **Vérification pré-spawn** : `tmux has-session -t <SESSION> 2>/dev/null && echo ATTIVO` — ne jamais spawner à l'aveugle sur une session existante.
- **Ordre de démarrage** : Scouts + Analista *d'abord*, Scorer + Scrittore *après*. Jamais en parallèle.

## Checklist pré-spawn (exécuter mentalement avant chaque spawn)

1. `db_query.py stats` — où est le backlog ?
2. `db_query.py dashboard` — combien d'instances par rôle déjà vivantes ?
3. Le rôle que vous êtes sur le point de spawner — dissout-il le **vrai** goulot, ou êtes-vous en train de "compléter l'équipe" ? Si le second : **ne pas spawner** (budget inutilisé vaut mieux que dépassement).

## Triage des sessions pré-existantes

Avant tout `start-agent.sh`, lister ce qui est déjà là :

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}'
tmux capture-pane -t <SESSION> -p -S -40 2>/dev/null | tail -20
```

| État dans capture-pane                                                       | Action                                          |
|------------------------------------------------------------------------------|-------------------------------------------------|
| 🟢 CLI actif, contexte < 40%, boucle récente                                | garder, ne pas respawner                        |
| 🟡 CLI actif, contexte > 80% ou inactif > 10 min                            | juger : travail précieux → laisser ; boucle confuse → tuer + respawner |
| 🔴 `command not found` / shell nu / panneau vide > 5 min                    | `tmux kill-session` + respawner (utiliser `spawn-agent`) |

Pour un diagnostic de vivacité plus approfondi (procédures zombie, symptômes de mort CLI), c'est le travail du **Dottore** via la skill `liveness-check` — ne pas le dupliquer ici.

## Voir aussi

- `spawn-agent` — lancement effectif + kick-off après la décision de rôle.
- `sentinel-orders` — ce qui a déclenché ce triage (`SCALA UP`, `PIPELINE VUOTA`).
- `bridge-pacing` — quand MARGINE signifie "spawner un de plus au goulot".
- `liveness-check` (Dottore) — diagnostics de santé d'agent plus approfondis.
- `agents/_team/architettura.md` — diagramme complet du pipeline et notes de coordination par phase.
