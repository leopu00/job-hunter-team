<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: liveness-check
description: "Diagnostiquer si la session tmux d'un agent de l'équipe est vivante, dans un long tour, ou silencieusement morte — et la respawner en préservant le contexte si morte. Propriété du Dottore (l'agent de vérification de santé itinérant de l'équipe), pas du Capitano. Le mode de défaillance principal que cette skill attrape : `jht-tmux-send` retourne `exit 0` même quand le CLI cible a planté (le message est écrit dans un bash nu, puis perdu). Sans vérifications de vivacité périodiques, l'équipe continue de \"parler à un cadavre\" et le Capitano compte sur des actions qui n'arriveront jamais."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *)
---

# liveness-check — garder l'équipe honnête

Une session tmux peut survivre à son CLI. Quand le TUI Codex / Kimi plante, tmux retombe sur un prompt bash nu ; les messages continuent d'y être écrits (`exit 0` depuis `jht-tmux-send`), personne ne les lit, l'agent est un zombie. Cette skill détecte l'état et récupère.

## Quand exécuter une vérification

- 👨‍⚕️ **Tour de routine** — chaque réveil du Dottore (~30 min) parcourt chaque session d'équipe en séquence (voir `agents/dottore/dottore.md` pour le cycle de vie complet one-shot).
- 🚨 **Transfert du Capitano** — quand le Capitano rapporte un agent silencieux > 10 min alors qu'il devrait travailler (pas de REPORT du Scout, pas d'ACK du Scrittore au Critico).
- 🔁 **Post-URG** — 10-30s après un `[URG]` / `[MSG]` du Capitano pour confirmer l'ACK + que le CLI est encore vivant.
- ⚖️ **Pré-scaling** — avant un spawn/kill qui dépend de l'état d'un agent existant (ne pas spawner l'Analista si le Scout dont il dépend est mort).

## Ordre de priorité — agents orientés utilisateur EN PREMIER

Avant tout parcours, trier les cibles pour que les agents orientés utilisateur longue durée soient vérifiés en premier. Ils sont en haut de la chaîne — s'ils meurent, **personne ne les respawne** (le Capitano spawne les workers, pas lui-même / l'Assistente / le Mentor / la Sentinella). Le post-mortem de la nuit zombie du 2026-05-18 avait 6-8h de Capitano mort parce que les Dottori vérifiaient les workers en premier, n'atteignaient jamais le Capitano, et s'auto-détruisaient.

```
PRIORITÉ 1 (toujours vérifier en premier) :
  ASSISTENTE, CAPITANO, MENTOR, SENTINELLA
PRIORITÉ 2 (workers, le Capitano peut les respawner) :
  SCOUT-N, SCRITTORE-N, CRITICO-S*, ANALISTA-N, SCORER-N
```

Si vous n'avez que 10 min de budget pour le tour, **toujours terminer la PRIORITÉ 1 avant de toucher la PRIORITÉ 2**. Un worker mort 30 min est récupérable ; un Capitano mort 30 min signifie que tout le pipeline est silencieux.

## Étape 0 — `pane_current_command` (pré-vérification bon marché)

Avant le capture-pane, faire la vérification bon marché :

```bash
cmd=$(tmux list-panes -t <SESSION> -F '#{pane_current_command}' | head -1)
```

Si `$cmd` n'est pas `Kimi` / `kimi` / `claude` / `codex` / `node` / `python*` → le CLI LLM est **déjà mort**, le panneau est du bash résiduel. Sauter le ping (il se perdrait dans le bash et `jht-tmux-send` retournerait `exit 0` trompeusement), aller directement à l'Étape 3 RESPAWN.

Cette seule vérification aurait attrapé le Capitano zombie du 2026-05-18 — le panneau était en bash (PID 663, `/proc/663/exe → /usr/bin/bash`) avec kimi planté. `tmux has-session` retournait True, mentant au watchdog pendant 11 heures.

## Étape 1 — capturer, ne pas faire confiance

Toujours lire le panneau d'abord ; ne pas agir à l'aveugle :

```bash
tmux capture-pane -t <SESSION> -p -S -200
```

Les 200 lignes de scroll-back donnent assez de contexte pour (a) juger l'état, (b) reconstruire ce que l'agent faisait pour le kick-off de reprise s'il doit être respawné.

## Étape 2 — tableau de diagnostic

Faire correspondre les **20 dernières lignes** avec :

| Pattern dans `tmux capture-pane -t <SESSION> -p \| tail -20`        | Diagnostic          | Action              |
|----------------------------------------------------------------------|---------------------|---------------------|
| Réponse concrète à un ping récent (ex. "writing CV on #281")        | ✅ vivant, travaille | loguer `status=alive`, agent suivant |
| `Working...` depuis > 5 min sur le même tour, mais sortie de tokens visible | 🟡 long tour   | loguer `status=long_turn`, NE PAS respawner |
| Panneau inchangé depuis avant le ping                                | 🔴 bloqué / inerte | RESPAWN (Étape 3)    |
| Spinner `Whirlpooling...` > 10 min, zéro sortie                     | 🔴 blocage silencieux | RESPAWN             |
| Dernière ligne = `jht@<host>:~/agents/<role>$` (prompt shell nu)    | 💀 CLI quitté       | RESPAWN             |
| `Permission denied: …/.kimi/sessions/.../context.jsonl`             | 💀 kimi planté sur IO contexte | RESPAWN  |
| `Run kimi export and send the exported data to support`             | 💀 bannière crash kimi | RESPAWN            |
| `To resume this session: kimi -r <id>`                              | 💀 session orpheline | RESPAWN             |
| `Killed by timeout (60s)` (Kimi)                                    | 🟡 appel outil tué, CLI vivant | PAS un cas de respawn — l'agent a oublié de passer `timeout: N+30` à son appel outil shell (voir `agents/_skills/throttle/DESIGN-NOTES.md`). Diagnostiquer avec `jht-throttle-check <agent>`. |
| `command not found` pour `kimi` / `claude` / `codex`               | 💀 lanceur contourné | RESPAWN            |
| Panneau immobile > 5 min, pas de spinner, pas d'entrée              | 🟡 idle ambigu      | capture étendue (`-S -100`) pour contexte complet |

En cas de doute : **ne pas respawner**. Loguer `status=ambiguous`. Un faux positif (respawn inutile) coûte 1-2 min de reboot + contexte perdu. Un faux négatif (zombie manqué) coûte au plus 30 min jusqu'au prochain tour Dottore.

## Étape 3 — respawner avec contexte (uniquement sur 🔴 / 💀)

Séquence atomique :

a) **Utiliser le panneau déjà capturé** à l'Étape 1 comme "mémoire" de l'agent. Extraire :
   - dernière tâche en cours (ex. "writing CV on position #281")
   - dernier message du Capitano (chercher les marqueurs `[@capitano -> @<role>]`)
   - toute erreur récente

b) **Identifier le rôle + répertoire de travail**.
   - Singletons (`capitano | critico | sentinella | assistente | mentor | dottore`) → `/jht_home/agents/<role>/`
   - Multi-instances (`scout | scrittore | scorer | analista`) → `/jht_home/agents/<role>-<N>/` où `<N>` est le numéro final dans la session tmux (ex. `SCRITTORE-2` → `/jht_home/agents/scrittore-2/`).

c) **Tuer la session cassée, respawner via le lanceur** (utiliser la sémantique de la skill `spawn-agent` — jamais de `tmux new-session` + `send-keys "kimi ..."` bruts) :

```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
sleep 12
```

d) **Injecter le contexte de reprise** comme corps du kick-off (ne pas juste dire "resume" — dire *quoi* et *où*) :

```bash
jht-tmux-send <SESSION> "[@dottore -> @<role>] [MSG] Resume: <tâche en cours avant le crash>. Last Captain order: <cité du panneau>. Pick up from there, do NOT restart from scratch. Acknowledge with [@<role> -> @capitano] [RESUME] <description d'une ligne>."
```

Si le panneau montre que l'agent avait une ligne de base de données revendiquée (ex. `status=writing` sur une position), l'inclure dans le contexte de reprise pour qu'il ne duplique pas le travail. **Ne jamais respawner à l'aveugle** : lire `db_query.py` d'abord si nécessaire.

## Exceptions strictes "ne pas respawner"

NE JAMAIS respawner :
- Une session avec **activité de sortie de tokens dans les 60 dernières secondes** — l'agent travaille, même s'il semble lent.
- Le `CAPITANO` pendant une rotation de fenêtre Codex (session_id qui change dans la sentinelle) — attendre la stabilisation.
- Les longs tours (> 5 min) AVEC sortie de tokens visible (parsing, éditions de fichiers) — long ≠ mort.
- Vous-même (`DOTTORE*`) ou `DOCTOR-WATCHDOG`.

## Idempotence

Si le panneau capturé montre déjà un marqueur `[RESUME]` récent (dans les ~5 min), un autre tour Dottore vient de respawner l'agent. Loguer `status=alive` et passer — ne pas le respawner à nouveau.

## Logging

Chaque action atterrit dans `/jht_home/logs/dottore-actions.jsonl` (ajout uniquement, un JSON par ligne) :

```json
{"ts": "ISO-UTC", "round_id": "uuid-ou-epoch", "session": "SCRITTORE-1",
 "role": "scrittore-1", "event": "diagnosis",
 "status": "alive|long_turn|stallo|cli_dead|ambiguous",
 "evidence": "1-2 dernières lignes du panneau"}
{"ts": "ISO-UTC", "round_id": "...", "session": "SCRITTORE-1", "role": "scrittore-1",
 "event": "respawn", "context_recovered": "...", "new_pid": null}
```

Générer `round_id` une fois par tour Dottore (ex. secondes epoch au début du tour). Ajouter avec `>>`, jamais écraser.

## Anti-patterns

- ❌ Faire confiance au code de sortie 0 de `jht-tmux-send` comme preuve de livraison. Livraison ≠ exécution. Toujours l'accompagner d'un capture-pane sur un message critique.
- ❌ Tuer une session sans capture-pane d'abord — elle pourrait être dans un long appel d'outil, pas morte.
- ❌ Respawner à l'aveugle (pas de contexte de reprise) — le nouvel agent repart de zéro, duplique le travail, perd les lignes DB revendiquées.
- ❌ Parcourir les sessions en parallèle — séquentiel uniquement, un ping à la fois. Les pings parallèles surchargent tmux sur les grandes équipes.
- ❌ Passer > 10 min au total sur un seul tour — si un tour s'allonge, abréger ; le prochain Dottore arrive dans ~30 min.

## Voir aussi

- `agents/dottore/dottore.md` — le cycle de vie complet one-shot du Dottore (boot → tour → auto-destruction).
- `spawn-agent` (Capitano) — le contrat lanceur + kick-off que cette skill réutilise pour les respawns.
- `agents/_skills/throttle/DESIGN-NOTES.md` — le cas `Killed by timeout (60s)` (PAS un respawn).
- `agents/_team/team-rules.md` T01 — ne jamais tuer la session d'un autre agent **sauf** dans le flux de respawn explicite ci-dessus.
