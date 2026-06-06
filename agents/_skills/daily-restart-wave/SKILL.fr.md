<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: daily-restart-wave
description: "Redémarrage préventif de masse de chaque agent de l'équipe une fois par 24h pour la fraîcheur de contexte. Propriété du Dottore. S'exécute uniquement dans une fenêtre quotidienne étroite (défaut 03:00 UTC ± 30 min) et uniquement si aucune vague n'a été lancée dans les dernières 23h. Chaque agent est tué + respawné via la même séquence atomique de `liveness-check` Étape 3, ordonné tier 3 → tier 2 → tier 1 pour que les workers cyclent en premier et les coordinateurs (Capitano/Sentinella/Mentor/Assistente) en dernier. Contexte : les sessions longue durée Codex/Kimi accumulent du \"bruit\" — anciennes décisions, faits périmés, dérive du prompt — et deviennent mesurément moins lucides après des heures. Preuve empirique du Case Study #1 (run Codex 2026-05-19/21) : le redémarrage de masse manuel a restauré la qualité de décision. Cette skill comble ce gap sans intervention manuelle."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *), Bash(cat *), Bash(mkdir *), Bash(date *)
---

# daily-restart-wave — redémarrage préventif pour la fraîcheur de contexte

Le travail normal du Dottore (`liveness-check`) est **conservateur** : ne redémarrer que les morts silencieux. Cette skill est l'opposé : **redémarrer tout le monde, volontairement, une fois par jour**, parce que les sessions d'agents longue durée dérivent même quand ils ne meurent pas. Même primitive de respawn atomique (`liveness-check` Étape 3), déclencheur et ordre différents.

## Pourquoi cela existe

Empirique : dans le Case Study #1 (run Codex 2026-05-19/21, voir `docs/about/RESULTS.md`) le mainteneur a remarqué une dégradation de la qualité de décision après ~12-24h d'uptime continu des agents — erreurs répétées, références à des faits périmés, ignorance occasionnelle d'ordres explicites de l'utilisateur. Une instruction manuelle "redémarrer tout le monde" à l'heure ~30 a visiblement restauré la netteté. Codex n'affiche pas de fenêtre de contexte comme Claude/Kimi, donc la dérive est invisible jusqu'à ce qu'on compare avant/après.

Théorique : chaque session LLM est une longue conversation. À mesure que les tokens s'accumulent, le modèle :
- S'ancre sur des décisions précoces qui ont pu être erronées
- Raisonne sur des faits périmés (une offre d'emploi fermée, une stratégie révisée)
- Devient plus lent par tour (plus de cache KV à parcourir)
- Dérive de son prompt système sous la pression utilisateur ("le balayage des règles d'équipe")

Un démarrage frais relit le prompt + l'état récent de la DB + les snapshots de transfert et décide depuis un terrain propre. Coût : ~2 min/agent de "je me mets à jour". Bénéfice : des heures de sortie de basse qualité évitées.

## Quand déclencher — les 3 conditions de garde

LES TROIS doivent être vraies. Sauter avec `status=skipped` et un champ `reason` dans le log sinon.

1. **Dans la fenêtre quotidienne**. Défaut : 03:00 UTC ± 30 min (c.-à-d. 02:30–03:30 UTC). Justification : fenêtre de faible activité utilisateur réel pour les utilisateurs de jour européens/US ; si l'utilisateur dort, le défilé de ~10 min de redémarrage est invisible. Lire l'heure actuelle :

   ```bash
   now_h=$(date -u +%H)
   now_m=$(date -u +%M)
   # 02:30 ≤ now ≤ 03:30
   in_window=$([ "$now_h" = "02" -a "$now_m" -ge "30" ] || [ "$now_h" = "03" -a "$now_m" -le "30" ] && echo yes || echo no)
   ```

2. **Aucune vague lancée dans les dernières 23h** (anti-thrash). Lire `/jht_home/logs/daily-restart-wave-state.json` :

   ```json
   { "last_wave_at": "2026-05-30T03:11:42Z", "agents_restarted": 9, "duration_sec": 612 }
   ```

   Si le fichier n'existe pas → traiter comme "jamais lancé" → condition vraie.
   Si `now - last_wave_at < 23h` → sauter avec `reason=anti_thrash`.

3. **L'équipe n'est pas en `.team-halted.flag` ou `.weekly-halt.flag`**. Si l'un des drapeaux existe, l'utilisateur a explicitement mis l'équipe en pause — redémarrer serait hostile.

   ```bash
   [ -f /jht_home/.jht/.team-halted.flag ] && skip
   [ -f /jht_home/.jht/.weekly-halt.flag ] && skip
   ```

Si les 3 passent → procéder. Le bloc complet des 3 vérifications prend `<2s`, s'exécute à chaque réveil du Dottore, ne coûte rien hors fenêtre.

## Ordre de redémarrage — tier 3 → tier 2 → tier 1

Inverse de `liveness-check` (qui vérifie en premier les agents orientés utilisateur pour qu'ils ne meurent pas inaperçus). Pour une vague préventive, nous voulons l'opposé : **workers en premier, coordinateurs en dernier**, pour que le Capitano soit le dernier à perdre son fil et puisse observer (dans son panneau) que tous ses workers sont revenus frais, puis lui-même est recyclé et commence la nouvelle journée avec une ardoise propre.

```
TIER 3 (workers, redémarrer EN PREMIER) :
  SCOUT-*, SCRITTORE-*, CRITICO-*, ANALISTA-*, SCORER-*

TIER 2 (semi-coordinateurs) :
  (aucun aujourd'hui — réservé pour de futurs "coordinateurs subordonnés")

TIER 1 (orientés utilisateur, longue durée, redémarrer EN DERNIER) :
  ASSISTENTE, MENTOR, SENTINELLA, CAPITANO   (Capitano dernier des derniers)
```

Les sessions vides du tier 3 (ex. `SCRITTORE-*` quand aucun CV n'est en cours selon Writer-on-demand V6) → sauter silencieusement, pas de kill, pas de respawn. Le prochain spawn-on-demand du Capitano sera frais de toute façon.

## Notification au Capitano — 10 minutes avant

Le Capitano coordonne spawn/scaling. S'il est sur le point de spawner un burst de Scrittore et qu'on le tue 30s plus tard, le spawn meurt en cours de route. Donc :

1. **Au t=0 de la vague** (décision de lancer prise), AVANT de toucher un agent, envoyer un avertissement au Capitano via `tmux-send` :

   ```
   [HEADS-UP DOTTORE → CAPITANO] Daily restart wave parte fra 10 min.
   Non spawnare nuovi worker fino a NEW DAY. Termina task <5min in corso.
   Quando arriva il tuo turno (ultimo), ti riavvio io.
   ```

2. **Attendre 10 min**. Donner au Capitano le temps de drainer l'état de courte durée.

3. **Puis commencer le défilé** dans l'ordre tier 3 → tier 1.

Si le Capitano est déjà un zombie (bash nu), sauter l'avertissement et aller directement au défilé — il n'y a rien à coordonner.

## La primitive de respawn — réutiliser l'Étape 3 de liveness-check

Pour chaque session cible, quel que soit l'état de vivacité :

```
a. tmux capture-pane -t <SESSION> -S -200 -p > /tmp/$session-pre-restart.log
b. python3 /app/shared/skills/db_query.py <agent-role> --recent-context   (optionnel)
c. tmux kill-session -t <SESSION>
d. bash /app/.launcher/start-agent.sh <agent-role> [<instance-num>]
e. sleep 8s   (laisser le CLI démarrer)
f. tmux send-keys -t <SESSION> "RESUME: daily restart wave. Riprendi dai recenti log DB (db-query) + tuo prompt di identità. Nessuna task short-lived persa: il Capitano ha dranato la coda 10 min fa." Enter
g. log event=agent_restarted, agent=<role-N>, duration_ms=<X>
```

Notes :
- La capture du panneau va dans `/tmp/` pour que la nouvelle instance puisse la lire si elle veut inspecter "que faisais-je".
- Nous N'écrivons PAS `~/.jht/<agent>-pre-respawn-snapshot.txt` ici (c'est un transfert structuré demandé dans le suivi BACKLOG mais qui nécessite que le prompt de chaque agent sache comment écrire+lire — hors scope pour MVP, suivi séparément).
- Le message de démarrage `RESUME:` est générique ; il dit à l'agent de regarder ses propres traces DB plutôt que de s'appuyer sur un snapshot interne.

## Espacement inter-redémarrage

Attendre **15-20s entre les agents** du même tier. Pourquoi :
- Des appels `start-agent.sh` rapides dos à dos peuvent créer une course sur les écritures partagées `~/.jht/.local/` (RULE-T13 magazzino python).
- Donne à chaque nouveau CLI d'agent ~10s pour se stabiliser (handshake, listing d'outils, évaluation du prompt système) avant que le suivant n'inonde le serveur tmux.

Temps total pour une équipe saine (8-10 sessions) :
- 1 min avertissement + 10 min sommeil Capitano
- 7 agents tier-3 × ~20s = ~2.5 min (la plupart sont absents en régime stable)
- 4 agents tier-1 × ~30s (prompts plus lourds) = ~2 min
- **Budget total : ~15 min**, confortablement sous les 30 min dans le pire cas que le Dottore pourrait être vivant pour la vague.

## Logging de fin de vague

Ajouter à `/jht_home/logs/dottore-actions.jsonl` :

```json
{"ts":"2026-05-31T03:08:11Z","event":"daily_restart_wave_done","agents_restarted":9,"agents_skipped_empty":3,"duration_sec":612,"capitano_ack":"yes"}
```

Mettre à jour le fichier d'état `/jht_home/logs/daily-restart-wave-state.json` :

```json
{ "last_wave_at": "2026-05-31T03:08:11Z", "agents_restarted": 9, "duration_sec": 612 }
```

Notifier le Capitano (maintenant frais) en une ligne :

```
[DA DOTTORE A CAPITANO] Daily restart wave completed at 03:08 UTC.
9 agents restarted, 0 errors. Team back online — riprendi la pipeline.
```

## Modes de défaillance — que faire

| Défaillance | Action |
|---|---|
| `start-agent.sh` exit ≠ 0 pour un agent | Loguer `event=agent_restart_failed`, passer au suivant, NE PAS abandonner la vague. Le prochain tour routinier `liveness-check` remarquera l'absence et réessayera. |
| Serveur `tmux` non répondant (rare) | Abandonner la vague, loguer `event=tmux_dead`, NE PAS mettre à jour `last_wave_at` (pour que le prochain Dottore réessaye). |
| Vague abandonnée à mi-chemin (timeout budget 10 min du Dottore) | Loguer `event=daily_restart_wave_partial`, NE PAS mettre à jour `last_wave_at`. Le prochain Dottore dans la fenêtre reprendra (la re-vérification anti-thrash échouera jusqu'à 23h, mais c'est la même vague — accepter le rare double-tap). |
| Le Capitano n'ACK jamais l'avertissement | Attendre les 10 min quand même. S'il est silencieux à t=10, le défilé le tue aussi — le nouveau Capitano reprendra proprement. |

## Ce que cette skill NE FAIT PAS

- ❌ **Redémarrage à la demande** en dehors de la fenêtre quotidienne. Si l'utilisateur veut "redémarrer tout le monde maintenant", il message l'Assistente / Capitano, et l'un d'eux appelle `spawn-agent` par cible ou demande au Dottore de sauter la garde (un futur paramètre explicite, pas dans le MVP).
- ❌ **Snapshot de la tâche en cours** de chaque agent. Aujourd'hui le respawn s'appuie sur l'agent relisant la DB + capture-pane dans `/tmp/`. Un vrai transfert (chaque agent écrit "ce que je faisais + prochaine étape" avant de sortir) nécessite des changements de prompt sur les 10 agents — suivi comme suivi BACKLOG séparé.
- ❌ **Lire `~/.jht/preferences.json`** pour un réglage par utilisateur de l'heure/fenêtre. Le MVP code en dur 03:00 UTC ± 30 min, anti-thrash 23h. Si l'utilisateur est dans un fuseau non-UE et veut une fenêtre différente, il modifie ce fichier de skill (ou attend le hook preferences.json de suivi).
- ❌ **Outrepasser `.team-halted.flag`**. Si l'utilisateur a arrêté l'équipe, pas de vague. Point.
