---
name: scout-language-gate
description: "Choisis pays et requêtes d'après les langues du profil et écarte un candidat dont l'annonce exige une langue que l'utilisateur ne parle pas AVANT de récupérer l'annonce complète. `plan` une fois, `screen` sur chaque candidat avec titre et extrait. Cas réel : 100 candidats sur 100 d'un portail écartés pour la langue après la récupération complète."
allowed-tools: Bash(python3 /app/shared/skills/scout_language.py *)
---
<!-- @translation: fr, ai-translated 2026-11-02 -->

# scout-language-gate — la langue d'abord, la récupération ensuite

La langue est la coupe qui tue le plus souvent un candidat APRÈS que la recherche, la récupération de l'annonce complète et parfois l'INSERT ont déjà été payés. Cette skill l'applique en code, avant la récupération, d'après ce que la liste montre déjà. Elle n'invente rien : elle n'écarte que sur preuve, et une langue que le profil parle, une annonce en anglais ou un texte trop court pour trancher ne sont jamais écartés.

## 1. Planifier la recherche

`plan` donne à chaque pays un mode. `local` : le profil y parle une langue de travail. `english_friendly` : les postes en anglais y sont courants et le profil parle anglais : cherche-y, avec les qualificatifs qu'il imprime (`English-speaking`, `international team`, `English required`). `english_only` : seules les annonces en anglais valent d'être ouvertes. Rien n'est exclu (priorité oui, exclusion non, SC-04) : pars de l'`order` imprimé et ne dépense pas les premières passes sur les pays `english_only`. Il liste aussi les `portals` : les portails d'emploi écrits dans la langue de leur pays que le profil ne sait pas lire (jobs.ch, jobup, jobnet, stepstone-de...) sont `skip`, comme EURES dans un pays dont le profil ne parle pas la langue (`eures`) : ne les cherche pas (`portal --source S --country CC` répond pour un seul, sortie 10 = skip). Les listes ATS ne sont jamais exclues ici.

## 2. Contrôler chaque candidat avant la récupération

Donne à `screen` le titre et, si la source en montre un, l'extrait. `skip_language` (sortie 10) : ne le récupère pas ; avec `--log` il laisse déjà sa ligne dans le journal des passes (résultat `language`, non ouvert). `ok` ou `unknown` : continue par les gates comme d'habitude. Il ne lit que le texte de la liste : après la récupération complète, l'annonce passe par les filtres du Gate 4 et par l'Analista comme avant.

```bash
# once, before choosing countries and queries: the plan for THIS profile's languages
python3 /app/shared/skills/scout_language.py plan

# for each candidate, from what the LIST shows, BEFORE you fetch the full ad (exit 10 = drop it)
python3 /app/shared/skills/scout_language.py screen --title "<title>" --snippet "<the list's snippet, if any>" \
    --country nl --source greenhouse --log

# one job board in one country (exit 10 = it is in the language of its country and the profile cannot read it: skip it)
python3 /app/shared/skills/scout_language.py portal --source jobs.ch --country ch
```

## 3. Mets en dernier le niveau qui n'est pas celui du profil (ne l'écarte jamais)

`screen` répond aussi `"seniority": "above"` ou `"below"` quand le TITRE nomme un niveau (Senior, Principal, Head of, Junior, Trainee...) qui n'est pas celui de CE profil : son `seniority_target`, sinon ses années d'expérience. Pour un profil senior `Senior` et `Principal` ne donnent aucun code : ils sont sa cible. C'est un ORDRE, pas un verdict : dans la même passe insère d'abord les candidats sans `seniority` et ensuite ceux qui en ont, et n'en écarte jamais un pour cela (l'écart de séniorité, c'est le Scorer qui le décide ; règle SC-04). Au premier démarrage, chacun de ceux que l'Analista a dû exclure pour leur niveau a coûté une récupération et un INSERT et a repoussé le 20e score.

## Règles

- Ne saute jamais un candidat que `screen` n'a pas écarté en devinant sa langue : l'outil écarte sur preuve, pas toi.
- Passe le texte tel qu'il est dans la liste. La réponse ne contient que des codes (`required_language`, `ad_language`, `title_language`) et rien de l'annonce n'est enregistré.
- Aucune langue lisible dans le profil : `screen` répond `unknown` à tout et n'écarte rien.
