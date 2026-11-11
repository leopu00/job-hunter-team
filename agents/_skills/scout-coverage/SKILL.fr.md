---
name: scout-coverage
description: "Cherche les portails nationaux core des langues du profil AVANT toute source mineure et sache combien du plan est fait. `next` indique le portail, le pays à journaliser et le type de requête ; un portail est couvert avec 3 passes et 3 requêtes différentes, et «épuisé» exige les portails core couverts. Lance `next` au début de chaque recherche."
allowed-tools: Bash(python3 /app/shared/skills/scout_coverage.py *) Bash(python3 /app/shared/skills/scout_pass_log.py *) Bash(python3 /app/shared/skills/profile_version.py *) Bash(python3 /app/shared/skills/linkedin_access.py *)
---

# scout-coverage — où chercher d'abord, et combien est fait

Cherche D'ABORD là où sont les marchés propres du profil, et sache combien en est fait. Un vrai run a interrogé 105 sources une fois chacune et n'a jamais ouvert les plus grands portails nationaux de la langue de l'utilisateur : «épuisé» a été déclaré avec le marché d'origine intact. Cette skill donne la liste (portails nationaux de chaque langue que parle le profil, d'abord les core, puis les English-first et remote) et le compteur sur ton propre journal des passes.

## 1. Demande ce qui vient ensuite, à chaque recherche

`next` imprime une ligne JSON : le portail (`source`, `country`, `tier`), le TYPE de requête (`query_kind` : `broad` = une requête LARGE, toujours la première : la famille du rôle ou un mot d'entrée seul (dans `broad_terms`), sans titre complet et sans lieu dans les mots-clés ; conserve le filtre géographique du profil, `role_language` = le titre dans la langue du portail, `role` = le titre en anglais, `synonym` = un titre voisin, `level` = le titre avec un mot de niveau de la langue, listés dans `level_terms`, `city` = le titre avec un lieu, listés dans `cities`), ce que tu as (`have`) contre ce qu'il faut (`need`) et la ligne `log` à utiliser ensuite. Cherche exactement cela, puis journalise la passe avec le même `--query-kind`. `plan_done: true` veut dire plan terminé : passe aux autres sources. `avoid`, s'il est présent, liste des sources qui échouent à coup sûr (fermées, mur anti-bot, page que seul JavaScript remplit, ou trouvées mortes sur cette exécution par un collègue) : ne les ouvre pas et ne les consigne pas.

`next` dit aussi, avec ton id, si le profil a changé depuis que tu as construit tes cercles : `"profile": {"changed": true, "groups": [...]}`. Relis le profil, refais les cercles des groupes qui ont changé, garde tes positions et tes passes, puis `profile_version.py ack`.

```bash
# the next thing to search: portal, country to log, kind of query, and the line to log it with
python3 /app/shared/skills/scout_coverage.py next

# avec ton id : dit aussi si le profil a changé depuis que tu as construit tes cercles (alors relis-le, refais les cercles et fais ack)
python3 /app/shared/skills/scout_coverage.py next --agent $MY_ID
python3 /app/shared/skills/profile_version.py ack --agent $MY_ID

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
- Pour les autres pays, `next` (et `plan`) donne, quand la table les a, `api` et `hint` : l'adresse publique qui répond en JSON ou en open data sans clé (Allemagne : Arbeitnow) et l'adresse de recherche de chaque portail. Interroge CELLE-LÀ, pas la page d'accueil, avec un mot LARGE, et lis toutes les pages. Les tableaux d'entreprises de FR, DE, ES, PT, NL, BE, CH et AT : `python3 /app/shared/skills/scout_coverage.py boards --country <cc>`.
- Un tableau d'entreprise (Greenhouse, Lever, Teamtailor) se lit EN ENTIER avec `python3 /app/shared/skills/ats_board_search.py --provider greenhouse --board truecaller --country se --log --query-kind broad` : il reconnaît le pays sous toutes les formes de lieu, donne la séniorité lue dans le titre et dit combien d'annonces chaque motif a retirées (`counts`, `dropped`). Lis `dropped` avant de dire qu'un tableau est vide ; `--drop-seniority senior,lead` et `--title-any` sont à toi, rien n'est retiré sans que tu le demandes.
- Les core d'abord, les mineurs ensuite : aucune source mineure tant que `next` nomme un portail core.
- Un portail est COUVERT avec 3 passes et 3 requêtes DIFFÉRENTES (une dans la langue du portail si ce n'est pas l'anglais). La même requête trois fois compte une fois : change le type, pas les mots.
- Un portail qui répond 403, 410, un mur de connexion ou un challenge est FERMÉ avec UNE passe journalisée `--status closed` (ou `gone` pour le 410) : dis-le et continue, n'insiste pas.
- `exhausted` (`scout_exhaustion.py check`) exige CHAQUE portail du plan couvert dans les dernières 24 heures (core et mineurs, chaque pays) en plus des sources, requêtes et minutes : `uncovered` dit où tu dois encore aller (`core_missing` en est la partie core). Une source à sec alors que d'autres ne sont pas couvertes n'est pas un marché à sec : continue avec `next`. Un portail qui a répondu par une erreur est `blocked` (`--status blocked`) : il se repose environ 3 heures puis est réinterrogé, et il n'est ni couvert ni à sec.
- Rien du profil n'est jamais écrit : le journal a des slugs, des codes pays, des types et des comptes.

## Zone géographique et résultats explicites

Les lieux cibles et préférences du profil déterminent la zone. `broad` élargit seulement les mots du poste : conserve le filtre géographique sur chaque page. Pays du portail et villes suggérées n'autorisent aucun déménagement. Pour LinkedIn utilise cette commande (QUERY est la famille du poste ; COUNTRY et KIND viennent de `next`) :

```bash
python3 /app/shared/skills/linkedin_access.py search --profile "$JHT_HOME/profile/candidate_profile.yml" --keywords "$QUERY" --log --country "$COUNTRY" --query-kind "$KIND" --agent "$MY_ID" --posted-within-days 7
```

La commande journalise le résultat réel : ne le journalise pas encore manuellement. Sortie 4 et dernière ligne JSON `search_outcome` indiquent une erreur de source, profil ou zone : suis `status` (`blocked`, `closed`, `gone`) et passe à une source compatible en conservant les candidats reçus. Sortie 3 conserve rate limit/cooldown. Seule une liste vide réussie est `empty`. `scope_match` compare les noms, ce n'est pas un géocodeur : `unmatched` ou `unknown` ne prouvent PAS une exclusion. Vérifie le lieu complet/JD face au profil avec tous les gates ; n'insère pas une offre prouvée hors zone. `scout_search_geo_mismatch` signifie qu'aucun nom ne correspond : diagnostique la zone de la source ou change de source, sans déclarer vide le marché local. Aucun ID géographique inventé ni pays déduit d'une langue parlée. Sans shell, conserve la zone du profil dans la requête native et vérifie les preuves ; ne lance pas les commandes du conteneur sur l'hôte.
