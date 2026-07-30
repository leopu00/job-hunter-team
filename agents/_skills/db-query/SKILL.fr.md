<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: db-query
description: Interroger la DB SQLite JHT (positions, applications, statistiques). À utiliser chaque fois que vous avez besoin du statut d'une position, des files d'attente par agent, des scores, du taux de correspondance ou du nombre d'enregistrements. Chemin DB depuis $JHT_DB, fallback /jht_home/jobs.db.
allowed-tools: Bash(python3 *)
---

# db-query — consultations de la DB JHT

La base de données principale est `$JHT_DB` (défaut `/jht_home/jobs.db`). Tous les wrappers de requête résident dans `/app/shared/skills/db_query.py`. Cette skill expose les invocations les plus courantes.

## Statistiques et tableau de bord

```bash
# Comptages agrégés par statut + taux de correspondance (vue d'ensemble de l'utilisateur)
python3 /app/shared/skills/db_query.py dashboard

# Statistiques numériques (totaux par table)
python3 /app/shared/skills/db_query.py stats
```

## Positions

```bash
# Lister par statut
python3 /app/shared/skills/db_query.py positions --status new
python3 /app/shared/skills/db_query.py positions --status checked
python3 /app/shared/skills/db_query.py positions --status excluded

# Filtrer par score minimum
python3 /app/shared/skills/db_query.py positions --min-score 70

# Détail d'une position (tous les champs)
python3 /app/shared/skills/db_query.py position 42

# URL/ID en double ? (utile au SCOUT avant INSERT)
python3 /app/shared/skills/db_query.py check-url 4361788825
```

## Activité de l'équipe — qui a produit, et qui s'est tu

```bash
# Chaque transition de position des N dernières minutes + compteurs par agent
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
python3 /app/shared/skills/db_query.py recent-activity --minutes 30 --json
```

Sortie : `per-agent: analista-1=9, scorer-1=7`, puis une ligne par transition —
`14:22:07 scorer-1 #22 checked→scored`, `14:19:51 analista-1 #27 new→excluded — [DEAD_LINK]`
(heures en UTC). **Remplace** les messages `[START]`/`[DONE]` des workers, retirés le 2026-07-27 :
sur une équipe de premier démarrage ces bookends représentaient 30 des 37 messages reçus par le
Capitano en ~1,5h, pour un état déjà présent en DB.

⚠️ **Elle liste qui PRODUIT.** Un agent qui s'est arrêté n'apparaît pas du tout — il ne ressort pas,
il **disparaît**. Pour distinguer un stall d'un idle légitime, croise avec `tmux list-sessions`
(vivant ?) et la file `next-for-*` du rôle (avait-il quelque chose à faire ?) : **vivant + file non
vide + zéro transition = stall** ; vivant + file vide + zéro transition = idle, laisse-le tranquille.

## Files d'attente par agent (pipeline)

```bash
python3 /app/shared/skills/db_query.py next-for-analista
python3 /app/shared/skills/db_query.py next-for-scorer
python3 /app/shared/skills/db_query.py next-for-scrittore
python3 /app/shared/skills/db_query.py next-for-critico   # ⚠️ legacy — en V5 le Critico est spawné par le Scrittore par tour, pas tiré d'une file
```

Chacun retourne le prochain lot prêt pour ce rôle, suivant le flux de statut V5 : `new → checked → scored → writing → ready → applied → response` (avec `excluded` comme sortie de secours à chaque étape).

## Quand l'utiliser

- Avant les décisions de scaling (le Capitano doit savoir s'il y a ≥ 3 enregistrements `checked` avant de spawner un SCORER)
- Avant les INSERTs (le Scout doit vérifier les doublons d'URL)
- En réponse aux questions de l'utilisateur comme "combien de scouts actifs / combien d'applications en attente / score le plus élevé"
- Avant toute mise à jour — voir la skill `db-update` : toujours lire l'enregistrement d'abord pour éviter d'écraser l'écriture de quelqu'un d'autre

## Ne pas l'utiliser pour

- Écritures : utiliser **`db-update`** / **`db-insert`** à la place
- Changements de schéma : géré par `db_migrate.py` — non exposé comme skill (opération de l'utilisateur)
