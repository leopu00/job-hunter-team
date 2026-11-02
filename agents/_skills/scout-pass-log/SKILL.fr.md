---
name: scout-pass-log
description: "Mesure tes recherches pour que l'équipe sache si une source est épuisée ou si la recherche est mal faite. Après chaque recherche sur une source, note combien de candidats sont revenus ; quand un candidat sort des gates, note où il a fini. Deux commandes courtes, vocabulaire fermé, jamais de texte libre."
allowed-tools: Bash(python3 /app/shared/skills/scout_pass_log.py *)
---
<!-- @translation: fr, ai-translated 2026-11-02 -->

# scout-pass-log — mesurer ce que renvoient tes recherches

De l'extérieur, personne ne peut dire si les sources d'un profil sont épuisées ou si le Scout cherche mal : un candidat écarté avant l'INSERT (lien mort, un filtre, une langue vue dans l'annonce) ne laissait aucune trace. Ces deux commandes laissent chacune une courte ligne. Elles ne coûtent rien et n'arrêtent jamais ton travail.

## Quand

- **Après chaque recherche sur une source** (une liste de candidats est revenue) : la commande `pass`.
- **Quand chaque candidat sort des gates** (inséré, ou écarté et pourquoi) : la commande `candidate`. Ajoute `--opened` si tu as récupéré la JD complète (l'étape coûteuse).

## Commandes

```bash
python3 /app/shared/skills/scout_pass_log.py pass --source greenhouse --country nl --returned 25 \
    --query-kind role --query "<the query you searched>"
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome language --opened
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome inserted --opened
```

## Vocabulaire fermé

`--source` : le même slug que pour `--source` de l'INSERT (`linkedin`, `greenhouse`, ...). `--country` : deux lettres (`nl`), ou `multi` / `remote`. `--query-kind` : `role` · `role_language` · `broad` · `synonym` · `level` · `city` · `company` · `generic` · `other`. `--outcome` : `inserted` · `duplicate` · `dead_link` · `closed_ad` · `seniority` · `work_auth` · `domain` · `experience` · `language` · `role` · `area` · `other`.

## Règles

- Le texte libre est refusé (sortie 2, rien d'écrit) : jamais un titre, une entreprise, un nom ni rien du profil dans un champ. La requête cherchée va dans `--query` seulement pour être réduite à un hash ; son texte n'est jamais stocké.
- S'il est refusé, corrige la valeur et rappelle. Ne saute jamais la recherche ou le candidat à cause de cela.
- `language` est le résultat d'un candidat que tu écartes parce que l'annonce exige une langue que l'utilisateur ne parle pas, vue dans la liste ou dans la JD.
- Un appel par recherche et un par candidat, dans le même appel shell que le gate qui a décidé, quand tu peux.
- Chaque annonce que tu écartes en local après avoir lu une liste a son motif dans le journal, jamais le silence : titre hors des rôles du profil → `role`, lieu hors de ses zones → `area`, et les autres (`seniority`, `language`, `experience`, `domain`, `work_auth`). Pour beaucoup d'annonces au même motif ne fais PAS un appel par annonce : `candidate --source S --country CC --outcome role --count 640` est UNE ligne qui en vaut 640 (de 1 à 100000 ; jamais avec `inserted` ni avec `--opened`, qui est une ligne chacune). Un portail qui répond 403, un mur de connexion ou 410 : `pass ... --returned 0 --status closed` (`gone` pour le 410, `empty` pour une liste vide). La colonne `unexpl` du rapport est ce que le portail a renvoyé et que personne n'a expliqué : elle doit tomber à 0.
