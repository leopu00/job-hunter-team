---
name: scout-coverage
description: "Cherche les portails nationaux core des langues du profil AVANT toute source mineure et sache combien du plan est fait. `next` indique le portail, le pays à journaliser et le type de requête ; un portail est couvert avec 3 passes et 3 requêtes différentes, et «épuisé» exige les portails core couverts. Lance `next` au début de chaque recherche."
allowed-tools: Bash(python3 /app/shared/skills/scout_coverage.py *) Bash(python3 /app/shared/skills/scout_pass_log.py *)
---

# scout-coverage — où chercher d'abord, et combien est fait

Cherche D'ABORD là où sont les marchés propres du profil, et sache combien en est fait. Un vrai run a interrogé 105 sources une fois chacune et n'a jamais ouvert les plus grands portails nationaux de la langue de l'utilisateur : «épuisé» a été déclaré avec le marché d'origine intact. Cette skill donne la liste (portails nationaux de chaque langue que parle le profil, d'abord les core, puis les English-first et remote) et le compteur sur ton propre journal des passes.

## 1. Demande ce qui vient ensuite, à chaque recherche

`next` imprime une ligne JSON : le portail (`source`, `country`, `tier`), le TYPE de requête (`query_kind` : `broad` = une requête LARGE, toujours la première : la famille du rôle ou un mot d'entrée seul (dans `broad_terms`), sans titre complet et sans lieu, `role_language` = le titre dans la langue du portail, `role` = le titre en anglais, `synonym` = un titre voisin, `level` = le titre avec un mot de niveau de la langue, listés dans `level_terms`, `city` = le titre avec un lieu, listés dans `cities`), ce que tu as (`have`) contre ce qu'il faut (`need`) et la ligne `log` à utiliser ensuite. Cherche exactement cela, puis journalise la passe avec le même `--query-kind`. `plan_done: true` veut dire plan terminé : passe aux autres sources.

```bash
# the next thing to search: portal, country to log, kind of query, and the line to log it with
python3 /app/shared/skills/scout_coverage.py next

# the whole plan for this profile (once), and how much of it is done (any time)
python3 /app/shared/skills/scout_coverage.py plan
python3 /app/shared/skills/scout_coverage.py status

# after the search: the same portal, country and kind that `next` named
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --query-kind role_language --query "<the query you ran>" --returned 12
# a portal that answers 403 / a login wall / a challenge (closed) or 410 (gone): ONE pass closes it
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --returned 0 --status closed
```

## Règles

- La PREMIÈRE question sur un portail est toujours `broad` : un mot de `broad_terms` ou la famille du rôle, SEUL. Un portail qui met les mots en AND répond 0 à «junior project coordinator» + une ville et des centaines à «praktik». Lis TOUS les résultats, chaque page, et filtre-les toi-même contre le profil. Un portail n'est couvert qu'avec une passe `broad`, en plus des 3 requêtes différentes et de celle dans sa langue.
- Platsbanken (Suède) a une API publique, sans clé : `python3 /app/shared/skills/platsbanken_search.py --q "praktik" --city stockholm --no-experience --query-kind broad --log`. Les tableaux d'entreprises d'un pays : `python3 /app/shared/skills/scout_coverage.py boards --country se`.
- Pour les autres pays, `next` (et `plan`) donne, quand la table les a, `api` et `hint` : l'adresse publique qui répond en JSON ou en open data sans clé (Allemagne : Arbeitnow et la recherche de jobs.ch ; Belgique : Le Forem ; Portugal : Landing.jobs) et l'adresse de recherche de chaque portail. Interroge CELLE-LÀ, pas la page d'accueil, avec un mot LARGE, et lis toutes les pages. Les tableaux d'entreprises de FR, DE, ES, PT, NL, BE, CH et AT : `python3 /app/shared/skills/scout_coverage.py boards --country <cc>`.
- Un tableau d'entreprise (Greenhouse, Lever, Teamtailor) se lit EN ENTIER avec `python3 /app/shared/skills/ats_board_search.py --provider greenhouse --board truecaller --country se --log --query-kind broad` : il reconnaît le pays sous toutes les formes de lieu, donne la séniorité lue dans le titre et dit combien d'annonces chaque motif a retirées (`counts`, `dropped`). Lis `dropped` avant de dire qu'un tableau est vide ; `--drop-seniority senior,lead` et `--title-any` sont à toi, rien n'est retiré sans que tu le demandes.
- Les core d'abord, les mineurs ensuite : aucune source mineure tant que `next` nomme un portail core.
- Un portail est COUVERT avec 3 passes et 3 requêtes DIFFÉRENTES (une dans la langue du portail si ce n'est pas l'anglais). La même requête trois fois compte une fois : change le type, pas les mots.
- Un portail qui répond 403, 410, un mur de connexion ou un challenge est FERMÉ avec UNE passe journalisée `--status closed` (ou `gone` pour le 410) : dis-le et continue, n'insiste pas.
- `exhausted` (`scout_exhaustion.py check`) exige les portails core couverts en plus des sources, requêtes et minutes : `core_missing` dit où tu dois encore aller.
- Rien du profil n'est jamais écrit : le journal a des slugs, des codes pays, des types et des comptes.
