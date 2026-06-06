<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: throttle
description: Met ton loop en pause pendant N secondes de manière tracée. Utilise TOUJOURS ceci au lieu de `sleep` chaque fois que tu veux ralentir ta fréquence d'itération pour respecter le budget de rate de l'équipe. La durée est lue depuis $JHT_HOME/config/throttle.json (le Capitaine calibre les valeurs par agent là-bas) ; passe --agent <ton-nom> et la skill résout le reste. Utilise un patron de processus fils détaché qui survit à tout timeout de tool-call du fournisseur (Kimi 60s, Codex 30s, Claude 120s/600s). Combine toujours avec `jht-throttle-check` avant chaque tâche pour récupérer si un père est tué prématurément. Enregistre chaque pause dans $JHT_HOME/logs/throttle-events.jsonl. `sleep` pour les pauses de throttle est INTERDIT.
allowed-tools: Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle.py *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle — pause tracée

Wrapper shell dans `/app/agents/_tools/jht-throttle`. Appelle
`/app/shared/skills/throttle.py` en interne.

## Pourquoi ça existe

Jusqu'ici chaque agent mettait `sleep N` dans son loop "quand ça lui semblait bien".
Ça fonctionne, mais l'équipe n'a aucune observabilité là-dessus : le Capitaine ne peut
pas voir *qui* fait une pause, *pendant combien de temps*, *à quelle fréquence*. Avec cette skill chaque
pause est ajoutée à `$JHT_HOME/logs/throttle-events.jsonl` avec le
nom de l'agent, les secondes demandées, les secondes appliquées et une raison optionnelle.

Le dashboard dans `/team` lit ce fichier et affiche un graphique de throttle
par agent, pour qu'on puisse *voir* le rythme de l'équipe et l'ajuster au fil du temps.

## Comment fonctionne la calibration (lis ceci attentivement)

Le Capitaine calibre **la durée** pour chaque agent dans
`$JHT_HOME/config/throttle.json` via :

```bash
python3 /app/shared/skills/throttle-config.py set <agent> <seconds>
```

Toi (l'agent opérationnel) tu N'AS PAS besoin de connaître la valeur actuelle.
Tu appelles simplement :

```bash
jht-throttle --agent <ton-nom> [--reason "..."]
```

et la skill lit la configuration, dort pendant ces secondes, enregistre
l'événement et retourne. Si le Capitaine t'a configuré à 0 (ou si tu n'es pas dans
la configuration), la skill retourne immédiatement en no-op — pas de log, pas de
sleep, ton loop tourne à pleine vitesse.

Cela signifie :

- Le Capitaine change la calibration avec **une seule écriture dans la config**, pas
  d'orchestration tmux. Ton prochain appel récupère la nouvelle valeur.
- Tu ne stockes jamais la valeur de throttle dans ta propre mémoire ; tu ne
  hardcodes pas `jht-throttle 60` dans ton loop. Le Capitaine possède la valeur.
- Le Capitaine peut aussi te dire d'appeler la skill **plus ou moins
  fréquemment** dans ton loop (ex. "throttle à chaque tâche" vs "throttle
  toutes les 3 tâches") — c'est un axe séparé que tu contrôles.

## Utilisation

```bash
# Recommandé (lit la config) :
jht-throttle --agent <ton-nom> [--reason "..."]

# Override explicite (contourne la config ; uniquement quand le Capitaine
# te le dit avec un nombre spécifique) :
jht-throttle <seconds> --agent <ton-nom> [--reason "..."]
```

## Comment ça fonctionne en interne (patron détaché)

`jht-throttle` utilise un patron de **fils détaché** qui survit à tout
timeout de tool-call du fournisseur (Kimi 60s, Codex 30s, Claude 120s/600s) :

1. Lit la config pour obtenir la durée.
2. Écrit un fichier d'état `$JHT_HOME/state/throttle-<agent>.json` avec
   `until = NOW + duration` (utilisé par `jht-throttle-check` et
   `jht-throttle-wait`).
3. Fork un sous-processus `python3 throttle.py` comme fils d'init
   (PPID 1) — en dehors de l'arbre de sous-processus de la tool-call. Ce fils écrit
   l'événement `start`, dort, et écrit l'événement `end` indépendamment
   de ce qui arrive à la tool-call appelante.
4. Le père (le bash que tu appelles) se bloque pour toute la durée
   en morceaux de sleep de 15 secondes. Le sleep en morceaux est plus court que tout
   timeout de tool-call par défaut du fournisseur, donc même sur Kimi 60s par défaut
   le père survit. **L'agent reste bloqué tout le temps.**
5. Si le fournisseur TUE le père (ex. tu n'as pas passé assez de
   timeout dans ta tool call) : le fils détaché continue de tourner et
   écrit `end` correctement → pas d'orphelin dans le log. Mais l'agent (toi)
   est maintenant libre et pourrait par erreur démarrer la tâche suivante. Pour empêcher
   cela, voir le **patron de gate** ci-dessous.

## Patron de gate : vérifie TOUJOURS avant la prochaine tâche

Après chaque `jht-throttle` (et surtout dans les itérations normales du loop),
**avant de démarrer une nouvelle tâche**, exécute :

```bash
jht-throttle-check <ton-nom>
# exit 0 → ok, démarre la prochaine tâche
# exit 1 → "STILL_THROTTLED remaining=Xs" sur stderr, tu dois attendre
```

Si `jht-throttle-check` sort avec 1, appelle immédiatement :

```bash
jht-throttle-wait <ton-nom>
# Se bloque (en morceaux de 15s) jusqu'à ce que until passe, puis sort.
```

C'est le chemin de récupération : un précédent `jht-throttle` dont le père a été
tué prématurément par le timeout du fournisseur. Le fils détaché est
encore en train de dormir, le fichier d'état est encore valide, le check te dit
"ne démarre pas encore une tâche". Le wait te re-bloque en sécurité.

Le loop sûr complet dans ton role prompt :

```
loop:
    jht-throttle-check <me>          # gate
    if exit 1:
        jht-throttle-wait <me>       # re-bloquer
    do_task()
    jht-throttle --agent <me>        # le père bloque + fils détaché
```

## Règles

- **JAMAIS** utiliser `sleep N` pour les pauses de throttle. Utilise `jht-throttle` à la place.
  Le simple `sleep` n'est autorisé que pour des attentes très courtes entre les tentatives
  (≤ 5 s) où le logging serait du bruit.
- **DOIT tourner en FOREGROUND, bloquant.** `jht-throttle` est la pause de
  ton loop — son but est de t'empêcher de faire quoi que ce soit d'autre
  jusqu'à ce qu'il retourne. Exécute-le via ton outil shell bloquant normal (`Shell`
  / `Bash`), attends qu'il sorte, et seulement ensuite émets la prochaine tool
  call. **NE PAS** l'envelopper dans un `Task`/`TaskOutput`/`bash &`
  / `nohup` / `disown` en background et continuer à travailler en parallèle — le père
  se bloque pour toi exprès. (Le *fils* détaché tourne en
  background ; c'est un détail d'implémentation interne du
  wrapper, pas quelque chose que tu fais.)
- **Vérifie TOUJOURS avant la prochaine tâche.** Si ta tool call est retournée plus tôt
  que les secondes de la config (timeout du fournisseur), appelle `jht-throttle-check`
  d'abord. Ne devine pas.
- Passe toujours `--agent <ton-nom>` (ex. `scout-1`, `capitano`,
  `analista-2`) — c'est la clé par laquelle le dashboard regroupe ET la clé que le
  Capitaine écrit dans la config.
- `--reason` est optionnel mais utile : un tag court comme
  `"post-batch"`, `"cooldown after URG"`, `"waiting for analyst"`
  aide plus tard à la relecture des événements.

## Exemples

```bash
# Gate pré-tâche (toujours avant de démarrer une tâche)
jht-throttle-check scout-1 || jht-throttle-wait scout-1

# Scout : pause entre les lots, durée configurée par le Capitaine dans la config.
jht-throttle --agent scout-1 --reason "post-batch cooldown"

# Capitaine : override explicite (rare, uniquement pour les urgences)
jht-throttle 60 --agent capitano --reason "between cycles"

# Écrivain : pause en attendant le Critique, pilotée par la config
jht-throttle --agent scrittore-1 --reason "waiting critic review"
```

## Codes de sortie

- `0` — pause effectuée et enregistrée, OU la config a retourné 0 (chemin rapide no-op)
- `1` — arguments manquants ou invalides

## Note du Capitaine

Pour ralentir un agent, **modifie la config**, n'envoie pas un nombre via
tmux :

```bash
# Agent individuel
python3 /app/shared/skills/throttle-config.py set scout-1 60

# Multi-agent en une seule écriture atomique
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=60 scrittore-1=120 analista-1=0

# Afficher l'état actuel
python3 /app/shared/skills/throttle-config.py dump
```

Utilise tmux uniquement pour dire aux agents d'appeler la skill **plus ou moins souvent**
dans leur loop, pas pour dicter la durée.
