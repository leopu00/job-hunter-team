<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: scout-coord
description: Protocole de coordination au démarrage entre plusieurs Scouts. Sans cette skill, deux scouts parcourent le même cercle (Remote EU) sur le même tier (LinkedIn) et produisent 100% de doublons que la porte de dédup doit ensuite éliminer — budget gaspillé et équipe plus lente. Utilisez-la comme PREMIÈRE action dans votre boucle, avant toute autre chose. Appartient au rôle Scout ; SCOUT-1 arbitre généralement si plusieurs scouts démarrent simultanément.
allowed-tools: Bash(python3 /app/shared/skills/scout_coord.py *), Bash(tmux *), Bash(jht-tmux-send *)
---

# scout-coord — partitionner le territoire

Plusieurs Scouts s'exécutent en parallèle (max 2 instances selon la politique d'équipe). L'équipe ne fonctionne que s'ils s'accordent sur une **partition sans chevauchement** de :
- quels **cercles** chacun possède (1 = préférence primaire, 2 = voisins géographiques, 3 = relocalisation, 4 = satellite, 5 = frontière)
- quels **tiers de sources** chacun possède (LinkedIn / agrégateurs ATS / niche / WebSearch)

L'état réside dans la **base de données SQLite partagée** gérée par `scout_coord.py` ; les scouts négocient via tmux au démarrage et y persistent l'accord.

**Une seule base, ou aucune coordination.** Tous les Scouts doivent être sur le même fichier — deux Scouts sur deux fichiers ne se coordonnent pas, ils le croient seulement. `scout_coord.py` résout le chemin depuis l'environnement (`JHT_SCOUT_COORD_DB` si l'opérateur en a déclaré un, sinon `$JHT_HOME/data/`) et le crée s'il manque. S'il sort en **3**, la base est inutilisable : rapporte le message affiché et ARRÊTE-TOI. Ne crée jamais ta propre base, ne pointe jamais l'outil vers un autre chemin.

```bash
# Sur quelle base suis-je vraiment ?
python3 /app/shared/skills/scout_coord.py doctor
```

## Step 1 — Découvrir les pairs

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}' | grep -E '^SCOUT-[0-9]+$'
```

Si vous êtes le seul scout listé → aucune négociation nécessaire, revendiquez tout ce que vous pouvez gérer. Passez au Step 4.

Si d'autres sont listés → vous devez négocier (Steps 2-3) avant tout scraping.

## Step 2 — Réinitialiser l'état obsolète

Si l'équipe de scouts précédente a planté en plein loop, `scout_coord.py` peut contenir des assignations obsolètes référençant des sessions mortes. Effacez-les :

```bash
python3 /app/shared/skills/scout_coord.py reset
```

C'est une étape coordonnée : le **SCOUT avec le numéro le plus bas actif** (généralement `SCOUT-1`) fait le reset, les autres attendent. Annoncez-le sur tmux :

```bash
jht-tmux-send SCOUT-2 "[@$MY_ID -> @scout-2] [INFO] resetto scout_coord, attendi 5s prima di assign"
```

## Step 3 — Négocier via tmux

Ouvrez une courte conversation (3-5 messages max) avec chaque pair. Proposez un découpage :

```
[@scout-1 -> @scout-2] [REQ] proposta: io prendo cerchi 1+2 + tier 1-2 (LinkedIn, ATS).
Tu cerchi 3+4 + tier 3-4 (niche board + WebSearch). OK?
```

Le pair répond avec `[ACK]` (accepte) ou `[COUNTER]` (contre-proposition). Restez bref — si vous ne parvenez pas à un accord en 3 allers-retours, escaladez au Capitano.

**Heuristiques pour un bon découpage** :

| Situation                                       | Découpage suggéré                                                  |
|-------------------------------------------------|--------------------------------------------------------------------|
| 2 Scouts, profil `work_mode = remote`           | S1 : cercles 1-2 + LinkedIn/ATS · S2 : cercles 1 + niche remote board (RemoteOK, WeWorkRemotely) — les deux dans le cercle 1, sources complémentaires |
| 2 Scouts, profil `work_mode = on-site`          | S1 : ville de base + cercle 2 régional · S2 : relocalisation (cercle 3) |
| 2 Scouts, mixte `work_mode = flessibile`        | S1 : cercles 1-2 (full mode) · S2 : cercles 3-5 (relocalisation + satellite + frontière) |

Quel que soit le découpage choisi, la règle est : **jamais deux scouts sur la même combinaison (cercle, set_tier) en même temps.**

**Découpage volume vs curé — données empiriques du run VPS1 2026-05-21 (vps1-run-postmortem #14) :**

> Scout-1 trouvait 130 positions avec score avg 63.1 (40% high-score)
> Scout-2 trouvait 76 positions avec score avg 68.4 (54% high-score)
>
> → Scout-2 était 1.4× plus qualitatif que Scout-1 sur le même candidat.

Pattern recommandé quand on a la liberté de choisir le tier pour les 2 scouts :

| Scout    | Tier assigné                                            | Justification                                  |
|----------|---------------------------------------------------------|------------------------------------------------|
| SCOUT-1  | LinkedIn (haut volume, bruyant)                         | Capture le flux, accepte le score moyen bas    |
| SCOUT-2  | Ashby / Greenhouse / Lever / company-careers (curé)     | Peu mais pertinents, score moyen plus élevé    |

Le `next-for-analista` reçoit ensuite un mix équilibré de volume + qualité, et le filtre hard-requirements de l'Analyste (RULE-06) se concentre sur le flux de Scout-1 (où il y a le plus de bruit). Ce n'est pas une règle rigide — adapter au `work_mode` selon le tableau ci-dessus.

## Step 4 — Consolider l'assignation

Une fois que vous et vos pairs êtes d'accord, persistez la partition :

```bash
python3 /app/shared/skills/scout_coord.py assign $MY_ID \
    --cerchi "<cercles qui vous sont assignés, ex. 1,2>" \
    --fonti "<slugs de sources assignées, séparés par virgule, ex. linkedin,greenhouse,lever>"
```

Chaque scout écrit sa propre ligne. Le script empêche le chevauchement sur les slugs de sources, donc si deux scouts tentent de revendiquer `linkedin` simultanément le second échoue — le perdant doit renégocier.

## Step 5 — Vérifier

```bash
python3 /app/shared/skills/scout_coord.py show
```

Sortie attendue : une ligne par scout actif avec ses `cerchi` et `fonti`. Si votre ligne est absente, votre `assign` a échoué silencieusement — répétez le Step 4.

Vérification croisée : l'union de toutes les `fonti` devrait couvrir les tiers que l'équipe veut réellement scraper aujourd'hui. Si un tier a zéro scout (ex. personne sur `niche-remote`), notifiez le Capitano :

```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [INFO] scout-coord: tier 'niche-remote' senza scout, considera spawn aggiuntivo o riassegnamento."
```

## Anti-patterns

- ❌ Sauter le Step 1 ("je suis seul") sans vérifier — un pair pourrait avoir été tout juste respawné par le Dottore.
- ❌ Reset effectué par chaque scout en parallèle — condition de course, la base finit corrompue. Seul le scout avec le numéro le plus bas.
- ❌ Négocier puis oublier le Step 4 — la base est vide, les pairs ne peuvent pas voir votre revendication, deux scouts tapent sur la même source.
- ❌ Revendiquer à la fois `linkedin` ET `greenhouse` ET `lever` ET `remoteok` ET `weworkremotely` ET `webresearch` "pour être sûr" — rien à partager avec le pair, il n'a rien à faire.
- ❌ Renégocier en plein loop sans déclencheur — la partition se fait au démarrage. Si un pair meurt le Dottore le respawne avec le même rôle ; seul le SCOUT lui-même relit ses `cerchi`/`fonti` au démarrage.

## Quand renégocier

Uniquement sur ces déclencheurs :
- Un nouveau SCOUT vient de démarrer (vous voyez `SCOUT-N+1` dans `tmux list-sessions` qui n'était pas là à votre démarrage)
- Un SCOUT est mort et N'a PAS été respawné (la capacité a baissé, redistribuez son tier)
- Le Capitano ordonne explicitement une repartition (rare, ex. après un `[FEEDBACK]` de l'Analyste indiquant qu'un tier produit systématiquement des liens morts)

Dans les trois cas : bref échange tmux, puis re-`assign` avec de nouveaux paramètres. Pas besoin de `reset` sauf si le JSON est visiblement corrompu.

## Voir aussi

- `circles-and-sources` — la définition réelle des 5 cercles + 4 tiers de sources (cette skill est COMMENT partitionner ; celle-là est QUOI partitionner).
- `position-insert` — ce que fait chaque Scout une fois qu'il a son assignation.
- `agents/_manual/anti-collision.md` — le contrat anti-collision plus large que cette skill implémente pour le rôle Scout.
- `tmux-send` — format de l'enveloppe de messages pour la négociation.
