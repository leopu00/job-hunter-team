<!-- @translation: fr, ai-translated 2026-07-30 -->
---
name: agent-emergency
description: "Capitano — prend en charge un agent soupçonné d'être BLOQUÉ DANS UNE BOUCLE ACTIVE (vivant et générant des tours, mais répétant le même cycle sans rien produire : ping-loop d'ACK avec un autre agent, même action/requête qui ne mène nulle part). Couvre la faille entre C-08 (mort/silencieux → Dottore) et C-12 (qui brûle à cadence 0.00/min → kill). Échelle graduée, le Dottore D'ABORD → kill+respawn propre seulement si ça persiste ou si ça brûle du budget. Détection déterministe (diff de capture-pane + 0 progrès en base), décision d'escalade laissée au LLM."
allowed-tools: Bash(tmux *), Bash(jht-agent-contain *), Bash(jht-tmux-send *), Bash(/app/.launcher/spawn-doctor.sh *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *)
---

# agent-emergency — agent bloqué dans une boucle active

## Pourquoi elle existe (la faille entre C-08 et C-12)

Les signaux existants couvrent deux cas :
- **C-08** — un agent **mort / silencieux** (pane = bash, aucun tour) → diagnostic du **Dottore**.
- **C-12** — un agent qui **brûle avec `cadenza 0.00/min`, zéro checkpoint** → candidat au kill.

Le troisième manque : **un agent VIVANT et ACTIF qui RÉPÈTE le même cycle sans rien produire**. Il
génère des tours (il n'est donc PAS « mort » et n'a PAS `cadenza 0.00`), mais il n'avance pas.
Exemples réels :
- deux sessions qui se renvoient des **ACK** à l'infini (ping-loop de coordination) ;
- un worker qui répète la **même requête / même action** sans aucun effet ;
- un agent qui retraite encore et encore le même message non délivré.

C'était invisible jusqu'ici → le Capitano n'intervenait jamais. Cette skill le rend détectable et
gérable.

## Quand l'utiliser

**Sur SOUPÇON**, pas de manière systématique ni à chaque tick. Lance cette procédure quand tu
remarques l'un de ces indices (généralement pendant que tu fais autre chose) : un agent qui
« travaille » depuis un moment mais dont la file ne se réduit pas / aucune nouvelle position ne
change d'état ; ou tu vois le même échange se répéter dans le chat/le pane.

## 1. Détection DÉTERMINISTE (pas d'estimation à l'œil)

Confirme la boucle avec deux vérifications peu coûteuses — **aucun message à l'agent** (ne le
dérange pas, c'est du pull Tier-2) :

```bash
# (a) RÉPÉTITION — le pane montre-t-il le même échange/la même sortie N fois ?
#     Deux captures espacées : si le contenu « nouveau » est identique → il se répète.
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_1.txt
sleep 20
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_2.txt
diff /tmp/ae_1.txt /tmp/ae_2.txt        # différence de « vrai travail » faible ou nulle = boucle suspectée

# (b) 0 PROGRÈS EN BASE — l'agent est-il « actif » sans rien faire bouger en base ?
#     S'il est disponible, le helper d'observabilité par agent (il réutilise
#     position_state_transitions) : 0 transition récente pour cet agent = aucune sortie.
python3 /app/shared/skills/db_query.py recent-activity   # by_agent: 0 pour la session = aucune sortie
#     Fallback générique : la file en amont de l'agent NE se réduit PAS entre deux vérifications
#     (p. ex. next-for-analista inchangée alors qu'ANALISTA-N « travaille »).
```

**Verdict BOUCLE** = (a) répétition **ET** (b) 0 progrès, sur ≥ 2-3 observations. Si en revanche le
pane affiche `Working… / esc to interrupt` avec un contenu qui continue de changer, c'est une
**tâche longue qui est VIVANTE** (C-08 bis) : ce n'est PAS une boucle, laisse-la tranquille.

## 2. Échelle graduée — le Dottore D'ABORD

### Échelon 1 — tournée extraordinaire du Dottore (PREMIÈRE intervention)

Un rafraîchissement du contexte casse souvent la boucle **sans perdre l'état**. Utilise la skill
`spawn-doctor` :

```bash
bash /app/.launcher/spawn-doctor.sh
sleep 10
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Tournée ciblée : <SESSION> semble bloquée dans une BOUCLE active (elle répète <quoi>, 0 progrès en base sur N ticks). Diagnostique-la et, si c'est confirmé, rafraîchis/répare la session. Réponds avec [RES]."
# Attends le [RES] du Dottore — pas de polling.
```

### Confinement de sécurité — ce n'est PAS un redémarrage

Si la session doit rester arrêtée, ne jamais utiliser `tmux kill-session` brut :

```bash
jht-agent-contain <SESSION> --by "$JHT_AGENT_NAME" --reason "<raison de sécurité observée>"
```

La commande capture d'abord le panneau, inscrit l'état persistant `contained`,
puis arrête la session exacte. Seul un release explicite le révoque :

```bash
jht-agent-contain <SESSION> --release --by "$JHT_AGENT_NAME" --reason "<pourquoi c'est sûr maintenant>"
```

### Échelon 2 — Kill (+ respawn) — SEULEMENT si nécessaire

Kill **seulement si** : la boucle **persiste après le Dottore**, *ou* elle **brûle sérieusement du
budget** (débit élevé + 0 sortie pendant ≥ N ticks et pas le temps pour un diagnostic).

⚠️ **GARDE-FOU contre le double spawn avec le watchdog.** `agent-watchdog.sh` fait un respawn
automatique (≤30s) **des 3 agents core uniquement** : `ASSISTENTE`, `CAPITANO`, `MENTOR`. Il ne
couvre PAS les workers. Le respawn dépend donc de la cible :

- **Cible = agent CORE (ASSISTENTE / MENTOR)** → **kill UNIQUEMENT**. Le watchdog le détecte et **le
  relance proprement tout seul** (`jht team start <role>`, idempotent, état neuf). N'exécute **PAS**
  `start-agent.sh` en plus de ton côté → ce serait un double spawn (la race qui a été signalée). Le
  « backoff » est de fait l'intervalle du watchdog (~30s). (Le CAPITANO, c'est toi : il n'est jamais
  la cible — tu ne te tues pas toi-même.)
  ```bash
  tmux kill-session -t <SESSION>     # ARRÊTE-TOI ici : le watchdog fait un respawn propre sous 30s
  ```
- **Cible = WORKER (Scout / Analista / Scorer / Scrittore / Critico)** → le watchdog NE les couvre
  PAS, donc **c'est toi qui fais kill + backoff + respawn** (pas de race) :
  ```bash
  tmux kill-session -t <SESSION>
  sleep 5                                                 # backoff : ne retombe pas aussitôt dans la boucle
  bash /app/.launcher/start-agent.sh <role> <N>          # respawn PROPRE (état neuf)
  ```

Le backoff + le respawn à état neuf empêchent qu'il redémarre exactement dans le même cycle ; ne pas
respawner les agents core évite la race avec le watchdog.

## Règles

- **Le Dottore D'ABORD, le kill APRÈS.** Ne kill jamais au premier soupçon : une tâche longue
  légitime a l'air « bloquée » mais elle est vivante (C-08 bis). Le kill est le dernier recours.
- **La détection et le kill sont déterministes ; l'escalade est ton choix (LLM).** Ne reste pas à
  fixer les panes à chaque tick : applique cette procédure quand un soupçon mûrit.
- **Ne dérange pas l'autre agent pour enquêter.** Les vérifications sont en pull (capture-pane +
  base), aucun message à l'agent suspecté (ce qui ne ferait qu'ajouter un tour de plus à la boucle).
- **Ne kill jamais les sessions de service `*-WORKER-*`** si tu ne sais pas ce qu'elles sont —
  vérifie d'abord le rôle.
