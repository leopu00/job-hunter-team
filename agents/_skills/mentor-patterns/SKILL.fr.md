<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: mentor-patterns
description: Les six patterns que le Mentor chasse dans les dossiers pour décider QUAND parler. Le silence est le comportement par défaut ; seul un pattern réel et récurrent mérite un mot. Cette skill donne la méthode de détection canonique pour chaque pattern (requête DB + seuil) pour que le Mentor ne parle jamais à partir d'un seul point de données. Lecture seule — n'écrit jamais dans la DB. Propriété du Mentor.
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/feedback_query.py *), Bash(grep *), Bash(awk *)
---

# mentor-patterns — ce que les dossiers révèlent

Le Mentor observe des ensembles, pas des points isolés. Six patterns méritent d'en parler ; tout le reste est du bruit.

## Pattern A — Écart de compétences entre profil et marché

Compétences qui apparaissent de manière répétée dans les exigences des JD mais sont absentes de `candidate_profile.yml > skills`. Si elles apparaissent aussi dans des positions à **score élevé**, l'écart est **coûteux** (le combler débloquerait des soumissions, pas du bruit).

### Détection

```bash
# 1. Récupérer les 30 dernières positions avec leurs exigences + score
python3 /app/shared/skills/db_query.py positions --limit 30 \
    --status scored,checked --order-by created_at:desc

# 2. Tokeniser les exigences, comparer avec profile.skills.primary + .secondary
# 3. Compter les tokens NON présents dans le profil qui apparaissent dans N positions
```

### Seuil

Parler uniquement si une compétence manquante apparaît dans **≥ 5 positions des 30 dernières** ET **≥ 1 d'entre elles a un score ≥ 65** (à portée de la porte de soumission).

### Exemple de sortie

> *"<Nom>, j'ai compté. **Docker** apparaît dans douze des trente dernières positions dans les dossiers. Neuf ont un score entre 65 et 78 — à portée de la porte de soumission, sans jamais la franchir. Un savoir-faire vous sépare d'un tiers du chemin devant vous."*

## Pattern B — Exclusions récurrentes

Comptages de marqueurs `ESCLUSA: [TAG]` dans `positions.notes` sur les 30 derniers jours. Si un tag domine, la direction de recherche est mal alignée.

### Détection

```bash
python3 /app/shared/skills/db_query.py positions --status excluded --limit 50 \
    --order-by last_checked:desc \
    | grep -oE 'ESCLUSA: \[(SENIORITY|STACK|GEO|LINGUA|LINK_MORTO|SCAM)\]' \
    | sort | uniq -c | sort -rn
```

### Seuil

Parler uniquement si **un tag représente ≥ 40% des exclusions** ET le total des exclusions ≥ 20 dans les 30 derniers jours.

### Interprétation

| Tag dominant    | Cause probable                                               | Mouvement suggéré                        |
|-----------------|--------------------------------------------------------------|------------------------------------------|
| `[SENIORITY]`   | Viser trop haut (ou trop bas) pour le niveau du candidat     | Ajuster `seniority_target` dans le profil |
| `[LINGUA]`      | Une seule langue ferme des marchés entiers                   | Ajouter la langue, ou réduire la portée géographique |
| `[GEO]`         | `work_mode` / `relocation` en décalage avec la recherche     | Rediscuter les préférences avec l'utilisateur |
| `[STACK]`       | Bruit de stacks adjacents atteignant l'équipe                | Resserrer les filtres Scout via le Capitano |
| `[LINK_MORTO]` (>40%) | Problème de qualité de source, pas du candidat         | Transférer au Capitano, c'est un problème de Scout |

## Pattern C — "Bande de parking" à score bas (40-49)

Le signal le plus riche : les positions dans la bande de parking sont des **quasi-correspondances**. Une composante de score les retient. Cette composante est le **levier**.

### Détection

```bash
# Récupérer toutes les positions 40-49 avec leur décomposition de score
python3 /app/shared/skills/db_query.py scores \
    --min-total 40 --max-total 49 --limit 30
```

Pour chacune, identifier la **composante la plus basse** (`stack_match` / `experience_fit` / `remote_fit` / `salary_fit` / `strategic_fit`). Agréger : quelle composante est le levier pour le plus de positions ?

### Seuil

Parler uniquement si **≥ 5 positions dans la bande de parking partagent la même composante basse** ET cette composante est < 50% de son plafond de poids.

### Interprétation

| Composante levier | Ce que ça signifie                                                   |
|-------------------|-----------------------------------------------------------------------|
| `stack_match`     | Écart de compétences (croiser avec le Pattern A)                      |
| `experience_fit`  | Décalage de seniority (croiser avec le Pattern B `[SENIORITY]`)       |
| `salary_fit`      | Attente salariale du candidat en décalage avec le marché              |
| `remote_fit`      | Préférences géographiques trop étroites                               |
| `strategic_fit`   | Bonus stack/secteur érodé — la niche s'estompe ou n'était pas encore forte |

## Pattern D — Retours post-soumission

Si `applications.applied = true`, les entonnoirs de résultats portent la vérité.

### Détection

```bash
# Applications soumises dans les 60 derniers jours
python3 /app/shared/skills/db_query.py applications --applied true \
    --order-by applied_at:desc --limit 30
```

Grouper par `response` : `interview` / `rejected` / `ghosted` / `null` (pas encore de réponse). Calculer :
- Taux d'entretien = entretiens / soumis
- Taux de rejet = rejetés / soumis
- Taux de ghosting = ghostés (`now - applied_at > 30d` ET pas de réponse) / soumis

### Seuil

Parler uniquement sur **≥ 10 applications soumises** dans la fenêtre (sinon échantillon trop petit).

### Interprétation

| Pattern observé                                 | Mouvement                                                             |
|-------------------------------------------------|-----------------------------------------------------------------------|
| Rejets partagent un type d'entreprise / écart de seniority | Re-cibler la recherche (écart de compétences ou de seniority, voir Pattern A/B) |
| Ghosting > 60% sans cluster spécifique          | Le CV ne se distingue pas OU marché sursaturé → réviser le CV avec le Critico / mettre en pause les soumissions agressives |
| Des entretiens existent → chercher ce qu'ils partagent | **Or** : répliquer la forme du JD, la taille d'entreprise, le stack |

## Pattern E — Tendances des verdicts de revue

Quand le Critico renvoie des CV qui n'ont rien de concret sur quoi s'appuyer. Le `critic_score` du Critico réside dans `applications` après la boucle 3 tours.

### Détection

```bash
python3 /app/shared/skills/db_query.py applications \
    --critic-score-max 5 --order-by written_at:desc --limit 20
```

Regrouper les `critic_notes` par mode de défaillance récurrent (ex. "no metrics", "stack mismatch", "About too generic").

### Seuil

Parler uniquement si **≥ 5 CV récents ont un score < 6** ET le même type de remarque apparaît dans ≥ 3 d'entre eux.

### Interprétation

Un `critic_score < 5` récurrent avec des notes similaires ne signifie PAS "le Scrittore est mauvais" — cela signifie **le profil n'en dit pas assez**. Le correctif est en amont :
- About trop générique → demander à l'utilisateur une inflexion de carrière concrète
- Pas de métriques → chercher des chiffres chez l'utilisateur (food cost %, réductions de latence, effectif, heures économisées)
- Stack mismatch → revérifier `skills.primary` contre les exigences réelles des JD

## Pattern F — Raisons récurrentes dans les mots de l'utilisateur

Depuis le web l'utilisateur juge les positions (peu intéressante / intéressante / très intéressante, plus "exclure") et peut écrire **pourquoi**, en texte libre : `reason` (≤ 500 caractères) et `comment` (≤ 2000). Ce texte est le seul endroit où il dit ce qu'il veut avec ses propres mots. Lu position par position, c'est une anecdote ; compté ensemble, c'est un fait. Dix "trop senior" ne sont pas dix opinions sur dix annonces — c'est une seule phrase sur la recherche.

Attention à la différence avec le Pattern B : là-bas les exclusions sont celles des **agents** (`ESCLUSA: [TAG]` dans `positions.notes`), ici le jugement est celui de l'**utilisateur**. Deux flux différents ; quand ils concordent, voir la section de croisement.

Ces retours vivent dans le cloud (`position_feedback`), pas dans `jobs.db` : c'est le seul pattern qui ne passe pas par `db_query.py`.

**`RAW_DISPLAY_BOUNDARY`** — regroupe sur les raw `reason` / `comment`, mais ne les relaie jamais. Toute interprétation user-facing utilise seulement `display_reason` / `display_comment` et les `label` / `examples` sanitizés des thèmes ; clés machine, IDs et notes `no-signal:*` restent internes.

### Détection

```bash
# Les thèmes dans les raisons écrites par l'utilisateur, 30 derniers jours
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3

# Les mêmes retours non agrégés ; lis uniquement display_reason/display_comment
python3 /app/shared/skills/feedback_query.py recent --days 30
```

`themes` regroupe le texte libre par similarité simple — aucune correspondance exacte exigée. Il met en minuscules, retire accents, ponctuation et mots outils, coupe chaque mot à ses 5 premiers caractères (`senior` / `seniority` / `seniore` / `séniorité` tombent sur la même clé), puis compte les mots seuls et les paires adjacentes par **positions distinctes**. Une paire l'emporte sur ses parties quand elle couvre les mêmes positions : "trop senior" dit plus que "senior", et les intensificateurs sont conservés exprès pour cela.

Pour chaque thème il retourne `positions`, `events`, `share` (fraction des positions qui portent du texte), `actions` (comment le thème se répartit entre like / dislike / hide / star), des `legacy_ids` internes et jusqu'à 3 `examples` display sanitizés.

C'est grossier par construction et cela se voit : les synonymes éloignés restent séparés (`salaire` et `RAL` sont deux thèmes). Lis les `examples` et rapproche avec ta tête ce que l'outil n'a pas pu.

Si le payload porte une `note` enum fermée (`no-signal:*`), l'agrégat n'existe pas : tais-toi, ne relaie pas le code et ne reconstruis pas le tableau à coups de `check` position par position.

### Seuil

Ne parle que si **les trois** sont vraies :

- **≥ 8 événements de retour portent du texte** (`events_with_text`). Écrire une raison coûte un effort à l'utilisateur, donc ce volume est un ordre de grandeur sous n'importe quel comptage produit par les machines — mais sous 8, un pourcentage ne veut rien dire (avec 3 textes, un thème fait déjà un tiers).
- Le thème couvre **≥ 4 positions distinctes** (`positions`, jamais `events` : juger deux fois la même annonce reste un seul avis, et compter les événements ferait passer une annonce obstinée pour une tendance).
- Le **`share` du thème est ≥ 0,30**. Le texte libre éclate la même objection réelle entre synonymes, donc la dominance est diluée par construction ; le Pattern B peut exiger 40% parce que ses tags sont un vocabulaire fermé. À faible volume c'est la règle des 4 positions qui contraint, à fort volume c'est le share — c'est voulu.

En dessous, ne dis rien. Un "trop senior" est une remarque sur une annonce.

### Interprétation

Le thème dit où regarder ; les dossiers disent si c'est un problème.

| Famille de thèmes (exemples)                          | Où cela pointe                                                          |
|-------------------------------------------------------|--------------------------------------------------------------------------|
| Seniority ("trop senior", "trop junior")              | La tranche déclarée dans `seniority_target` vs le nom que lui donne le marché |
| Stack ("Java legacy", "pas de PHP")                   | `skills.primary` — stack déclarée et stack voulue qui divergent (croiser avec A) |
| Rémunération ("salaire trop bas", "pas de fourchette")| Attente salariale vs fourchettes publiées (croiser avec C `salary_fit`)  |
| Lieu ("sur site", "trop loin", "pas de télétravail")  | `work_mode` / `relocation` (croiser avec C `remote_fit`)                 |
| Entreprise / secteur ("agence", "conseil")            | Une préférence jamais écrite dans le profil                              |
| L'annonce elle-même ("vague", "aucune info")          | Qualité de l'annonce, pas d'adéquation — une ligne seulement si cela domine, et comme du bruit, pas comme un levier |

**Le constat qui vaut une phrase, c'est le désaccord.** Croise les `legacy_ids` du thème avec leurs scores (`db_query.py scores`). Quand l'utilisateur continue d'écarter des positions que le Scorer a mises au-dessus de 70, le score n'est pas cassé — il mesure fidèlement l'adéquation à un **profil qui a cessé de décrire ce que l'utilisateur veut**. Le profil est en lecture seule pour toi (T10) : tu donnes le chiffre et tu poses la question, c'est lui qui décide.

### Exemple de sortie

> *"<Nom>, ces trente derniers jours vous avez écrit une raison sur dix-neuf positions. Sur sept d'entre elles — plus d'un tiers — les mots étaient les mêmes : **trop senior**. Cinq de ces sept, le Scorer les avait mises au-dessus de 70 : il lisait votre profil, qui déclare toujours une cible senior. La cible a-t-elle bougé, ou ces sept-là étaient-elles simplement des annonces mal écrites ?"*

## Croisement des patterns

Les patterns se renforcent mutuellement. Signal fort :
- **A + C** (écart de compétences + composante basse sur `stack_match`) → presque certainement digne d'en parler.
- **B `[SENIORITY]` + C `experience_fit`** → désalignement de seniority, mentionner une fois.
- **D cluster rejeté + E critic_score < 5** → problème de CV, escalader comme Pattern E.
- **F + B sur le même sujet** (l'utilisateur écarte pour seniority ET les agents excluent pour `[SENIORITY]`) → le problème est la tranche déclarée, pas le marché. Le signal le plus fort qui soit, parce qu'il vient de deux flux indépendants.
- **F + C sur le même levier** (`salary_fit` / `remote_fit`) → le modèle de score et l'utilisateur désignent la même friction. Une phrase, pas deux.
- **F contre des scores élevés** → dérive du profil, voir l'interprétation du Pattern F.

Éviter **A seul** quand la compétence est mentionnée dans seulement 5/30 positions et qu'aucune ne score haut — c'est du bruit, rester silencieux.

## Rappel de cadence

Cette skill dit **comment détecter**. QUAND parler est gouverné par le prompt du Mentor :
- 🌅 Premier réveil — parcours rapide des dossiers, une observation si elle le mérite
- 🌗 Quotidien — passe silencieuse, parler uniquement si un pattern franchit le seuil
- 🌕 Hebdomadaire — digest même si rien ne brûle (utiliser la skill `mentor-output`, format hebdomadaire)
- 📞 À la demande — répondre à la question de l'utilisateur avec les données détenues

Si vous n'avez rien de niveau pattern à dire, **ne dites rien**. Le silence est une réponse.

## Anti-patterns

- ❌ Parler après avoir détecté un seul hit (1 position avec exigence `Docker`) — échantillon trop petit, donne l'impression de s'agiter.
- ❌ Agréger sur toute la DB (ex. les 6 derniers mois) — les anciennes positions déforment le signal du marché actuel. S'en tenir aux 30 derniers jours sauf comparaison explicite de tendances.
- ❌ Utiliser le champ arrondi `experience_years` pour le raisonnement Pattern B/C — calculer les années RÉELLES depuis `candidate.experience[].years` (même règle que l'Analista).
- ❌ Parler depuis des données web sans un pattern ancré dans les dossiers d'abord — les dossiers sont le déclencheur, le web est la vérification (voir l'étape de confirmation `WebSearch` / `WebFetch` dans `mentor.md`).
- ❌ Catastrophisme ("ça ne mène nulle part") OU pom-pom ("vous pouvez le faire !") — les deux violent la voix du Mentor. Des chiffres, puis une question. Voir la skill `mentor-output`.
- ❌ **Transformer le Pattern F en instruction de recherche.** Ne remets jamais au Scout ou au Capitano un "arrête de ramener X" tiré de ce qui plaît à l'utilisateur. Une pipeline qui ne pêche que ce qui plaît gonfle ses propres scores, et l'utilisateur finit par croire que le marché est riche alors que c'est la pipeline qui a choisi pour lui. Le Pattern F s'adresse **à l'utilisateur** : ce qui change dans son profil, c'est lui qui le décide, et tu es de toute façon en lecture seule (T10).
- ❌ Renvoyer à l'utilisateur un jugement qu'il a retiré. `themes` laisse déjà dehors les positions dont le dernier événement est `clear` ; ne les ramène pas avec `--include-cleared` pour atteindre un seuil.
- ❌ Citer un seul commentaire raw comme s'il s'agissait d'un pattern. Les `examples` sanitizés donnent une voix à un thème **après** qu'il a franchi le seuil ; ils ne sont pas le constat.

## Voir aussi

- `mentor-output` — COMMENT formuler le message une fois qu'un pattern est confirmé.
- `db-query` — mécanismes internes du wrapper.
- `feedback-query` — le lecteur des retours utilisateur dans le cloud (Pattern F) ; le Scorer interroge la même source position par position.
- `agents/mentor/mentor.md` — prompt orchestrateur + cadence.
- `agents/_team/team-rules.md` T10 — le profil est en lecture seule, aussi pour le Mentor.
