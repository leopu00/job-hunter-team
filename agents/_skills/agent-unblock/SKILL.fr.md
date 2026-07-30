<!-- @translation: fr, ai-translated 2026-07-30 -->
---
name: agent-unblock
description: "Réservé au Dottore. Phase UNBLOCK, s'exécute AVANT le rafraîchissement à chaque tour du Dottore. Détecte les quatre formes de blocage qui arrêtent une équipe entière — du texte en attente dans le pane d'un coordinateur, un agent en retry-loop vers un pair muet, tous les opérationnels assis devant un prompt vide avec du quota à dépenser, un coordinateur silencieux au-delà du seuil — et les LÈVE. N'envoie ni ne supprime jamais le texte tapé par l'utilisateur : il le contourne (question à l'Assistente, `procède entre-temps` au coordinateur via la mailbox, kick-off direct des workers). Un blocage qui survit au tour rend le tour ÉCHOUÉ, pas complet."
allowed-tools: Bash(python3 /app/shared/skills/agent_unblock.py *), Bash(python3 /app/shared/skills/doctor_analytics.py *), Bash(tmux *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# agent-unblock — un blocage ne se signale pas, il se dissout

> **Le principe, au-dessus de tout le reste dans cette skill.** Le Dottore **ne signale pas
> un blocage : il le dissout.** Si une action exige une décision humaine, transmets-la à
> l'Assistente **et remets l'équipe en mouvement entre-temps**, en emportant l'information
> que la décision est en attente. **Un blocage qui survit au tour du Dottore est un tour
> échoué.**

Une équipe avec du quota en abondance (weekly 19%, sous le pace) et une machine au repos
(load 0.12) est un jour restée immobile pendant **onze heures**. Une ligne, tapée dans le
pane du Capitano et jamais envoyée, a rendu ce pane non réceptif ; `jht-tmux-send` l'a lue
comme busy ; le coordinateur est devenu muet ; personne n'a assigné de travail ; chaque
agent a terminé son tour et s'est garé devant un prompt vide. Un Scorer était en retry-loop
depuis des heures ("dixième tentative, busy"). Le Dottore de cette nuit-là a inspecté neuf
sessions en 416s, a écrit un diagnostic impeccable dans son journal — et est resté en
standby. L'équipe est restée à l'arrêt six heures de plus.

Le diagnostic n'a jamais été le problème. Cette skill est le mandat.

---

## Deux états qui semblent identiques et appellent des remèdes opposés

Les deux montrent un prompt contenant du texte et aucune activité.

| état | symptôme | remède |
|---|---|---|
| **texte en attente** | un `Enter` nu est ignoré, mais `Space` **puis** `Enter` fonctionne | déblocage par l'entrée |
| **TUI gelée** | n'accepte **rien** : ni `Enter`, ni `C-m`, ni un envoi au `%pane_id` | kill + recréation uniquement |

**Le détail qui rend le déblocage implémentable** : un `Enter` "à froid" n'est pas traité
par une TUI Ink (Codex, Kimi, Claude Code) — le submit doit arriver *après* que le texte a
été rendu. Tu envoies donc d'abord un caractère (`Space`), puis `Enter`. Saute cette étape
et une implémentation qui essaie `Enter` seul **échoue en silence** et conclut que le pane
est irrécupérable.

Avec lui, une seule sonde sépare les deux : **`Space`+`Enter`, une fois**. Le pane réagit →
c'était du texte en attente, débloqué. Rien ne bouge du tout → TUI gelée → recréer. (Un
coordinateur gelé de cette façon avait un processus vivant à 2.8% de CPU et une session de
15,3 heures ; `Enter`, `C-m` et un envoi direct au `%pane_id` n'ont rien fait. Le recréer a
été la seule issue — ce qui explique aussi pourquoi le TTL de session de 12h n'est pas
optionnel : c'est la seule défense systématique contre ce second état.)

---

## 🚫 La seule chose que tu ne dois jamais faire

**N'envoie jamais, et ne supprime jamais, du texte tapé par l'utilisateur.** Tu ne peux pas
savoir si cette ligne est complète ou intentionnelle. La sonde ci-dessus **valide le
composer**, elle n'est donc autorisée **que** lorsque le contenu du composer est
attribuable à un agent — une enveloppe `[@x -> @y] …` ou `[BRIDGE …]` / `[SENTINELLA …]`
qui était déjà destinée à être envoyée.

`agent_unblock.py probe` l'impose à ta place : sur du texte non attribuable il refuse avec
`verdict=refused`, exit 3, après avoir d'abord copié la ligne dans
`logs/pending-input.jsonl` pour qu'elle ne puisse pas être perdue plus tard. **Ne contourne
pas le refus.** Contourne le blocage à la place (§ pending user input).

---

## Étape 0 — scan (déterministe, zéro LLM, ~2s)

```bash
python3 /app/shared/skills/agent_unblock.py scan > /tmp/unblock_scan.json
cat /tmp/unblock_scan.json
```

Retourne `blocks_found` plus une entrée par blocage, chacune avec sa `cure` :

| `kind` | signification |
|---|---|
| `pending_user_input` | le composer d'un coordinateur contient du texte que tu ne dois pas toucher |
| `pending_agent_input` | une enveloppe d'agent coincée dans un composer, jamais envoyée |
| `bare_shell` | la CLI est morte, le pane est retombé sur un shell |
| `retry_loop` | N tentatives de X vers Y dans la fenêtre, zéro réponse de Y |
| `all_operatives_idle` | tous les opérationnels devant un prompt vide |
| `mute_coordinator` | aucun message du Capitano au-delà du seuil |

**Note `blocks_found` tout de suite.** Tu en auras besoin à la fin du tour.

> Pourquoi `retry_loop` est digne de confiance : `messages.jsonl` enregistre la *tentative*
> (`jht-tmux-send` logue avant de taper), donc un Scorer qui matraque un Capitano muet
> apparaît même si rien n'a jamais été livré. C'est aussi le signal objectif qui sépare
> **"garé parce qu'il n'y a pas de travail"** de **"coincé parce que la coordination est
> cassée"** : *un agent qui réessaie vers le Capitano sans réponse n'est pas garé, il est
> bloqué.* Ne lui applique pas la règle PARKED.

## Étape 1 — lève-les, un par type

### `pending_agent_input` · `bare_shell` — la sonde

```bash
python3 /app/shared/skills/agent_unblock.py probe <SESSION>   # exit 0 unblocked · 2 frozen · 3 refused · 4 busy
```
- `unblocked` → levé, compte-le.
- `frozen` → **ne relance pas la sonde.** Escalade vers la recréation : capture d'abord le
  pane (`session-refresh` Étape 2 — le pane est la mémoire de l'agent), puis
  `tmux kill-session` → `bash /app/.launcher/start-agent.sh <role> <SAME-N>` → `[RESUME]`.
- `busy` → l'agent est vivant, en plein tour. Ce n'est pas un blocage. Laisse-le.

### `pending_user_input` — contourne-le, jamais à travers

Trois actions, toutes obligatoires, dont aucune ne touche à la ligne :

1. **Demande à l'utilisateur, via l'Assistente** — l'Assistente est le rôle qui parle à
   l'utilisateur. Envoie-lui la question du coordinateur pour qu'il la transmette sur le
   canal in-app :
   ```bash
   jht-tmux-send ASSISTENTE "[@dottore -> @assistente] [UNBLOCK] Le CAPITANO a une question en attente pour l'utilisateur et son pane est bloqué sur une ligne tapée et jamais envoyée : «<question>». Transmets-la sur le canal in-app et rapporte la réponse au Capitano. La ligne est sauvegardée dans logs/pending-input.jsonl — elle n'a été NI envoyée NI supprimée."
   ```
2. **Débloque quand même le coordinateur** — dis-lui que la question est transmise et qu'il
   doit avancer. Taper dans ce pane se concaténerait avec la ligne de l'utilisateur et la
   valider l'enverrait, alors utilise le canal qui n'a besoin d'aucun pane : la mailbox que
   le Capitano vide au début de chaque tour (`bridge-mailbox`).
   ```bash
   python3 /app/shared/skills/agent_unblock.py relay CAPITANO "[@dottore -> @capitano] [UNBLOCK] Ta question à l'utilisateur a été transmise à l'Assistente et elle est en cours de traitement. NE reste PAS à l'attendre : procède entre-temps avec le reste du travail et réassigne les files. Dans ton composer il y a une ligne de l'utilisateur non envoyée : je n'y touche pas et n'y touche pas non plus tant que ce n'est pas lui qui décide."
   ```
   `relay` écrit dans `bridge-mailbox.jsonl` **et** dans `messages.jsonl`, le message est
   donc à la fois livrable et auditable. Un coordinateur ne doit jamais rester à attendre
   une réponse humaine.
3. **Relance les workers sans attendre le coordinateur** — voir ci-dessous. C'est ça qui
   récupère vraiment les onze heures.

### `retry_loop` — débloque le destinataire, ou libère l'expéditeur

Lève d'abord la cible (probe / recréation). Si la cible ne peut pas être levée ce tour-ci,
**l'expéditeur ne doit pas continuer à attendre** : réassigne-le ou dis-lui d'avancer.
```bash
jht-tmux-send SCORER-5 "[@dottore -> @scorer-5] [UNBLOCK] Le CAPITANO est injoignable et ta demande a été transmise par une autre voie. ARRÊTE de réessayer : prends la suivante dans ta file (db_query.py next-for-<ruolo>) et procède en autonomie."
```
Un retry-loop ne compte comme levé que lorsque l'on a dit à l'expéditeur d'arrêter de
réessayer.

### `all_operatives_idle` · `mute_coordinator` — kick-off sans le coordinateur

Du quota disponible et tout le monde garé, ce n'est pas une pause, c'est un blocage.
**Fais le kick-off des rôles opérationnels directement, n'attends pas le Capitano**, et
escalade le silence du coordinateur à l'Assistente. Puis envoie à chaque opérationnel à
l'arrêt sa propre file :
```bash
jht-tmux-send SCOUT-1 "[@dottore -> @scout-1] [UNBLOCK] La coordination est à l'arrêt et il y a du quota disponible. Reprends la boucle principale sans attendre le Capitano : CERCLE 1 du profil, notifie les Analisti par lots de 3-5."
jht-tmux-send ANALISTA-1 "[@dottore -> @analista-1] [UNBLOCK] Reprends la boucle principale sans attendre le Capitano : file depuis db_query.py next-for-analista."
```
(Même forme pour `scorer` / `scrittore` avec leur propre file `next-for-*`.)

## Étape 2 — clôture le tour honnêtement

```bash
python3 /app/shared/skills/agent_unblock.py record-round \
  --round-id "$ROUND_ID" --found <blocks_found> --cleared <blocks_cleared>
```
Il ajoute à `/jht_home/logs/dottore-actions.jsonl` avec `blocks_found`, `blocks_cleared`,
`blocks_open`, et choisit l'événement pour toi : `round_complete` seulement quand
`cleared >= found`, sinon **`round_failed`** (exit 1). Ne maquille pas un survivant : un
tour qui laisse un blocage vivant est un tour échoué, et le log doit le dire — le prochain
Dottore lit ce log.

---

## Règles

- **Débloque AVANT de rafraîchir.** Un rafraîchissement sur une équipe paralysée ne fait
  que recréer la paralysie avec une fenêtre de contexte propre.
- **Une sonde par pane, jamais plus.** Deux sondes ne peuvent pas t'en dire plus qu'une, et
  la seconde est la façon dont tu te convaincs d'envoyer la ligne d'un utilisateur.
- **`busy` n'est pas un blocage.** `esc to interrupt` signifie vivant et en plein tour.
  N'envoie jamais de touches dans un tour en cours, ne spawne jamais un remplaçant pour un
  agent busy.
- **PARKED ne s'applique pas à un agent bloqué.** "âge ≥ 40min ET produced == 0 ET aucun
  message récent du capitaine" décrit une équipe paralysée exactement aussi bien qu'une
  équipe garée délibérément. Si l'agent apparaît dans un `retry_loop`, ou si tous les
  opérationnels sont inactifs avec du quota à dépenser, il est bloqué — agis.
- **Ne devine jamais l'intention de l'utilisateur.** Pas d'envoi, pas de suppression, pas
  d'édition, pas de "juste une espace pour le réveiller" sur du texte utilisateur. La ligne
  reste où elle est ; la copie dans `logs/pending-input.jsonl` est le filet de sécurité.

## Anti-patterns

- ❌ Écrire le blocage dans le journal et passer à autre chose. C'est l'échec des onze
  heures.
- ❌ Essayer `Enter` seul, ne rien voir se produire, et déclarer le pane mort.
- ❌ Taper ton message dans un composer qui contient déjà la ligne de l'utilisateur — ça se
  concatène, et la validation envoie le texte de l'utilisateur.
- ❌ Recréer un coordinateur juste pour libérer un pane *en attente* (pas gelé). Sonde
  d'abord.
- ❌ Loguer `round_complete` avec `blocks_cleared < blocks_found`.

## Voir aussi

- `session-refresh` — le tour de rafraîchissement qui s'exécute *après* cette phase, plus le TTL de session de 12h.
- `tmux-send` — conventions d'enveloppe et signification des codes de sortie (4 = busy = vivant).
- `liveness-check` — verdict on-demand sur un seul agent suspecté mort.
