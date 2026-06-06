<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: profile-summaries
description: Écrire les 4 résumés narratifs Markdown sous `$JHT_HOME/profile/summaries/` qui complètent le YAML structuré. Les Scrittore en aval en ONT BESOIN — un YAML seul produit des CV stériles car il n'a pas de voix, pas de narration, pas de positionnement. Propriété de l'Assistente. Les noms de fichiers sont FIXES (le frontend ignore tout le reste) ; toujours écrits à la première personne de l'utilisateur ("je suis un développeur…") ; toujours réécrits entièrement (Write, pas Edit append) — ce sont des snapshots du présent, pas des logs en ajout.
allowed-tools: Bash(mkdir -p *)
---

# profile-summaries — la voix du candidat sur disque

Le YAML structuré est excellent pour les filtres et les correspondances mais ne dit rien sur *qui* est le candidat. Les 4 fichiers MD dans `summaries/` portent la narration dont les Scrittore ont besoin pour produire des CV qui ressemblent à une personne, pas à une liste de cases à cocher.

## Les 4 fichiers (noms de fichiers FIXES)

| Fichier          | Titre UI montré à l'utilisateur | Contenu                                                             | Limite de longueur |
|------------------|----------------------------|-----------------------------------------------------------------------------|-----------|
| `about.md`       | **Qui vous êtes**           | Résumé persona : rôle actuel/cible, années, secteur, trait distinctif       | ~400 car |
| `preferences.md` | **Préférences racontées**   | Modalité de travail, déménagement, rémunération, horaires, environnement    | ~400 car |
| `goals.md`       | **Objectifs et job idéal**  | Ce que la personne cherche dans les 1-3 prochaines années, contexte/entreprise de rêve | ~500 car |
| `strengths.md`   | **Points forts**            | 2-4 qualités concrètes avec un bref exemple pour chacune                    | ~500 car |

Chemin : `$JHT_HOME/profile/summaries/<fichier>.md`. Créer le répertoire si manquant :
```bash
mkdir -p "$JHT_HOME/profile/summaries"
```

Des noms de fichiers différents (ex. `about-mario.md`, `goals_v2.md`) sont **silencieusement ignorés** par le frontend.

## Contraintes de style (contraignantes)

- **Markdown simple** : paragraphes séparés par une ligne vide, `**gras**` pour souligner, listes seulement si elles aident la lisibilité.
- **Pas de tableau, pas de header `#`** — ces MD vivent dans des cartes UI déjà titrées.
- **Longueur** : respecter la limite. Pas de murs de texte.
- **Première personne de l'utilisateur** : `"je suis un développeur…"`, `"je préfère travailler à distance…"`. Jamais la troisième personne (`"Mario est…"`).
- **Ton** : naturel, comme si l'utilisateur parlait de lui à un ami expert du secteur.
- **Jamais de chemin / noms de fichier / jargon** dans le texte — l'utilisateur lit "le résumé", pas "about.md".

## Règle de mise à jour — réécrire intégralement, jamais ajouter

Quand arrive une information qui change le sens d'un MD existant, **réécrire le fichier de zéro** (outil `Write`, PAS `Edit` append). Ce sont des snapshots du présent, pas des logs chronologiques. Un append risque de laisser des paragraphes obsolètes à côté du nouveau.

## Déclencheur — quand écrire chaque fichier

| Fichier           | Quand l'écrire pour la première fois / le mettre à jour                                                                                                                                               |
|-------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `about.md`        | Vous avez rôle + années + ≥1 expérience. Le réécrire chaque fois que quelque chose de substantiel change (rôle, seniority, secteur).                                                                  |
| `preferences.md`  | Vous avez discuté avec l'utilisateur d'au moins un de : modalité de travail, déménagement, rémunération. Mettre à jour chaque fois qu'un de ceux-ci change.                                           |
| `goals.md`        | L'utilisateur a raconté des aspirations / contexte idéal / dream job (même partiellement). Ne pas forcer : si ça n'émerge pas spontanément, **demander une seule fois** "y a-t-il un type de contexte ou d'entreprise dans lequel vous vous verriez particulièrement bien ?". |
| `strengths.md`    | Vous avez collecté **2+ expériences ou projets pertinents**. Extraire 2-4 qualités récurrentes du pattern.                                                                                            |

## Règle de démarrage — premier CV uploadé

Quand l'utilisateur uploade un CV, après avoir rempli le YAML, écrire MINIMUM **`about.md` + `strengths.md`** dans le même tour. Vous avez assez de données (rôle, années, expériences, compétences, ton) pour le faire immédiatement ; ne pas remettre à plus tard. Sauter cette étape signifie que le Scrittore CV en aval n'aura jamais le contexte narratif du candidat → il produira des CV stériles. Vous êtes le seul point où cette narration est capturée.

`preferences.md` et `goals.md` arriveront dans les tours suivants (après la discussion spécifique).

## Exemples

### `about.md` (secteur tech)
```markdown
Je suis un développeur backend avec 4 ans d'expérience en **Python** et
systèmes distribués, dernièrement concentré sur les pipelines ETL et les API
à haut débit. Je viens d'un parcours hybride entre **data engineering**
et backend "classique", et je me sens bien quand le problème est au milieu :
modélisation du donné + service qui l'expose.

Je cherche un rôle backend ou data senior où je peux apporter de l'ownership
end-to-end du service, pas juste du "ticket".
```

### `strengths.md` (secteur non-tech, exemple cuisine)
```markdown
**Résistance dans les pics.** J'ai géré une brigade de 12 personnes dans un
restaurant de 200 couverts le soir : j'ai appris à tenir le rythme et
la qualité même quand ça chauffe vraiment.

**Coût matière première.** Ces 3 dernières années j'ai réduit le food cost
de la partie salée de 34% à 28% en travaillant sur le menu et le rapport
avec les fournisseurs, sans toucher à la qualité.

**Mentorat d'équipe.** J'ai formé 2 sous-chefs qui gèrent maintenant
leurs brigades de manière autonome.
```

## Anti-patterns

- ❌ Écrire à la troisième personne ("Mario est un développeur…") — le frontend rend le texte comme voix directe du candidat, la troisième personne sonne aliénant.
- ❌ Append (`Edit`) au lieu de `Write` — finit avec deux intros contradictoires dans le même fichier.
- ❌ Tableaux / headers `#` / listes numérotées verbeuses — la carte UI a déjà son propre chrome.
- ❌ Sauter `about.md` / `strengths.md` après un upload CV "parce que de toute façon c'est écrit dans le YAML" — le YAML n'a pas de ton, les scrittore produisent des CV stériles.
- ❌ Insérer des chemins ou noms de fichiers (`/jht_home/profile/summaries/about.md`) dans le texte — l'utilisateur ne sait pas ce que c'est.
- ❌ Écrire au-delà de la limite de longueur — la carte UI tronque / scrolle horizontalement, le message se perd.

## Voir aussi

- `profile-yaml` — skill sœur : données structurées qui se mettent à jour en parallèle de ces MD.
- `onboarding-flow` — quand en conversation collecter les données qui alimentent ces MD.
- `agents/scrittore/scrittore.md` — l'agent en aval qui lit ces MD pour écrire des CV avec de la voix.
