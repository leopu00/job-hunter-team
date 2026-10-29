---
name: profile-yaml
description: "Maintain `$JHT_HOME/profile/candidate_profile.yml` — the structured candidate data the entire team consumes. The frontend polls this file every ~2s; an invalid YAML makes the user's left panel go silently blank. Owned by the Assistente. Use this skill on EVERY new piece of information from the user (text or uploaded file): write incrementally, validate immediately, talk to the user only after the validator says VALID_PROFILE. Also covers `ready.flag` (the unlock for the \"Vai alla dashboard\" button) with its strict 3-step verify-then-announce protocol."
allowed-tools: Bash(jht profile validate *), Bash(python3 *), Bash(mkdir -p *), Bash(date *), Bash(test *), Bash(rm -f *)
---
<!-- @translation: fr, ai-translated 2026-06-06 -->

# profile-yaml — source unique de vérité sur le candidat

L'équipe lit `candidate_profile.yml` pour chaque CV, chaque score, chaque décision de correspondance. Si vous le maintenez à jour, le reste du système fonctionne ; si vous le laissez dériver, les Writers produisent des CV stériles et le Scorer évalue mal les postes.

## 🌍 Langue du texte libre (contraignant)

Le texte de `narrative`, `key_points` et `timeline` du profil est écrit dans la langue de l'utilisateur (`python3 /app/shared/skills/text_language.py lang` l'affiche), **même si le CV dont il provient est dans une autre langue** (RULE-T14). `validate_profile.py` affiche `WARN: LANGUAGE: …` pour un long texte clairement dans une autre langue : réécris-le, n'ignore pas l'avertissement. Les noms, les entreprises et les outils restent tels quels.

## Chemin & propriété

| Chemin                                        | Qui écrit            | Qui lit                  |
|-----------------------------------------------|----------------------|--------------------------|
| `$JHT_HOME/profile/candidate_profile.yml`     | **Assistente** (vous), Capitano, utilisateur via l'interface web | tous les autres agents (lecture seule — T10) |
| `$JHT_HOME/profile/ready.flag`                | **Assistente** (vous) | le gate CTA du tableau de bord |

Créez le répertoire s'il n'existe pas :
```bash
mkdir -p "$JHT_HOME/profile"
```

## Mise à jour en direct — incrémentale, après CHAQUE entrée pertinente

Le frontend interroge le fichier toutes les ~2s. N'attendez pas la fin de la conversation ; **chaque fois que l'utilisateur vous donne une nouvelle donnée, écrivez-la maintenant**.

- "je m'appelle Mario" → écrivez `name: Mario` immédiatement.
- "je cherche un poste de cuisinier" → mettez à jour `target_role: cuoco` immédiatement.
- informations écrites dans le chat → mettez à jour **tous** les champs pertinents en un seul Write.

Chaque nouvelle donnée = un `Write` ou `Edit` sur le fichier. Puis validez. Puis continuez la conversation.

### Les CV chargés sont vérifiés avant de devenir des données persistées

Un message contenant `[FILE ALLEGATI]` est la seule exception à l'écriture directe. Après avoir lu le CV :

1. Écrivez uniquement les champs extraits dans `$JHT_AGENT_DIR/profile-review.yml`. Ne les écrivez jamais directement dans `candidate_profile.yml`.
2. Exécutez `python3 /app/shared/skills/profile_review.py stage`.
3. Seulement si la commande renvoie `ok: true`, publiez la carte de confirmation : `python3 /app/shared/skills/profile_review.py ask-confirm --inferred <champs>`, où `<champs>` sont les champs que le CV ne disait PAS et que vous avez déduits (par exemple `seniority_target,target_role,location`, ou une préférence comme `location_preferences`) ; sans `--inferred` si vous n'avez rien déduit. La carte porte le résumé et les deux boutons : ne récrivez pas le résumé et ne nommez aucun panneau ni bouton de l'app. N'annoncez pas que le profil est déjà enregistré.
4. Quand la personne répond à la carte, exécutez `python3 /app/shared/skills/profile_review.py apply-confirmed`. Avec `ok: true` le profil est enregistré : dites-le en une ligne et demandez le premier champ de `missing`. Si la formule n'est pas encore déclarée (`plan_registry.py get` dit `PLAN_MISSING`), demandez-la maintenant et seulement avec la carte (`first_run.py ask-plan --agent assistente`, skill `onboarding-flow`), jamais en texte. Avec l'erreur `wants_correction`, demandez quoi corriger, mettez à jour `profile-review.yml`, exécutez `stage` puis `ask-confirm` de nouveau. Avec toute autre erreur, dites que la confirmation n'a pas pu être appliquée ; ne modifiez jamais le profil canonique pour la contourner.
5. Si la personne écrit « oui, enregistre » avec des mots, n'enregistrez pas et ne l'ignorez pas : exécutez `ask-confirm`. `open: true` → une ligne, « appuie sur **Confirmer et enregistrer** sur la carte ci-dessus, ou écris « 1 » si tu es dans le terminal ». `asked: true` (la carte n'y était plus, une nouvelle est publiée) → une ligne disant que vous l'avez remise ci-dessous. `confirmed: true` → exécutez `apply-confirmed`. Erreur `no_review` → le profil est déjà enregistré ou il n'y a rien à confirmer : dites-le. Ne laissez jamais la personne sans étape suivante.
6. Si la préparation échoue, dites que la vérification n'a pas pu être préparée. Ne demandez pas de relance dans le chat et ne contournez pas la vérification en modifiant le profil canonique.

Le badge lit uniquement le fichier `candidate_profile.yml` persisté. Il ne doit pas avancer pendant qu'une vérification de CV est en attente.

## Validation obligatoire après CHAQUE write/edit

Validez contre le **schéma canonique** (pas seulement "est-ce du YAML parsable") : voir la skill
[`profile-schema`](../profile-schema/SKILL.md) pour le schéma complet.

```bash
jht profile validate
# fallback direct :
# python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → continuez. `INVALID_PROFILE` → lisez les `ERROR:` (champ + raison),
corrigez ce champ, revalidez. Les `WARN:` (clés legacy, ex. `languages[].name` au lieu
de `language`) ne bloquent pas mais doivent être corrigés quand vous touchez cette section.

**Ne continuez PAS la conversation avec l'utilisateur tant que `VALID_PROFILE` n'est pas obtenu.** Un profil cassé
efface tout le panneau gauche ; l'utilisateur pense que l'application a planté.

Si vous avez oublié d'ajouter l'étape de validation, vous pouvez être sûr que le fichier est cassé — il n'y a pas de "probablement ok". Exécutez-la toujours.

## Règles de sécurité YAML

Le parseur du frontend est strict. Cinq règles qui préviennent chaque problème rencontré :

1. **Scalaire bloc (`|-` ou `>-`) pour tout texte > 60 caractères** — descriptions, résumés, notes libres, points forts. Les chaînes inline cassent sur les virgules, deux-points, guillemets, retours à la ligne, parenthèses.
   ```yaml
   summary: |-
     Ici vous pouvez écrire du texte long, même avec des virgules, deux-points, apostrophes,
     retours à la ligne, parenthèses : le parseur le prend tel quel.
   ```
2. **Mettez entre guillemets les chaînes inline avec caractères spéciaux** — si vous devez garder une chaîne inline et qu'elle contient `"`, `:`, `#`, `&`, `*`, `>`, `|`, `%`, `@`, encadrez-la avec des guillemets doubles (`"…"`) ou passez au scalaire bloc.
3. **Espace après chaque `:`** — `role: Senior` ✅ · `role:Senior` ❌.
4. **Indentation avec 2 espaces, jamais de tabulations** — les puces de liste s'indentent à la même colonne que le premier caractère de contenu du parent.
5. **Pas de tirets longs / guillemets typographiques** — le copier-coller depuis des éditeurs de texte riche injecte `—`, `"`, `"`. Remplacez par des `-`, `"` simples, ou utilisez un scalaire bloc.

## Schéma minimum (le plancher)

Le frontend a un fallback qui débloque "Vai alla dashboard" quand les huit champs minimum sont présents + non vides : nom, email, rôle cible, ville, années d'expérience, `seniority_target`, au moins 2 compétences principales, au moins 1 langue (pour que l'utilisateur puisse continuer même avant que vous ne créiez `ready.flag`). Remplissez d'abord ceux-là. Le reste du schéma ci-dessous est recommandé, expériences et diplômes compris : demandez-le juste après le déblocage, et ne l'inventez jamais pour remplir le schéma.

```yaml
name: <Prénom Nom>
target_role: <rôle cible>
location: <ville ou zone>
experience_years: <int>
has_degree: <true|false>        # optionnel: absent = non déclaré; si présent, booléen
seniority_target: <junior|mid|senior>
industry: <secteur>

skills:
  primary: [...]              # >= 2 entrées
  secondary: [...]

languages:                    # >= 1 entrée
  - language: <nom>
    level: <A1..C2 | native>

candidate:
  name: <même que ci-dessus>
  target_role: <même que ci-dessus>
  contacts:
    email: ...
    phone: ...
    linkedin: ...
    github: ...
  experience:                 # recommandé, pas obligatoire : s'il y en a, chaque entrée avec company/role/years/summary
    - company: ...
      role: ...
      years: ...              # ex. "Mar 2022 - en cours" — utilisé pour la durée réelle
      summary: |-
        ...
  education:                  # recommandé, pas obligatoire : s'il y en a, chaque entrée avec institution/degree/year
    - institution: ...
      degree: ...
      year: ...

preferences:                  # CLÉS EXACTES — le frontend cherche exactement celles-ci
  work_mode: <remoto|ibrido|in sede|flessibile>
  work_mode_flexibility: <optionnel, texte libre>
  relocation: <true|false|"per la giusta posizione">
  salary_annual_eur: <ex. "30-35k" | null>

sector_details:
  <clés libres, snake_case — voir section ci-dessous>
```

Les clés `preferences.work_mode`, `preferences.relocation`, `preferences.salary_annual_eur` sont lues littéralement par le frontend pour remplir la section "Préférences de travail". Les noms alternatifs (`work_location`, `flexible`, `remote`) restent écrits mais invisibles pour l'utilisateur.

Schéma complet + exemples : `docs/examples/candidate_profile.yml.example` (pour documentation, **NE PAS copier les valeurs** — voir anti-hallucination).

## `sector_details` — clés libres pour le secteur de l'utilisateur

Section générique clé/valeur que le frontend affiche sous forme de liste. Vous choisissez les clés en fonction du métier de l'utilisateur. Exemples réels :

```yaml
# Cuisine
sector_details:
  specializzazione: Pasticceria
  brigate: "ristoranti grandi (10+ persone in cucina)"
  patenti: ["HACCP", "antincendio rischio medio"]
  ruolo_attuale: "Capo partita salata"

# Santé
sector_details:
  specializzazione_infermieristica: "Area critica"
  iscrizione_albo: "OPI Roma n. 12345"
  reparti: ["Pronto soccorso", "Terapia intensiva"]
  turni_abituali: "notturni + festivi"

# BTP / installations
sector_details:
  patenti: ["CAP carrello elevatore", "PES/PAV", "patentino ponteggi"]
  specializzazione: "Impianti elettrici industriali"
  anni_cantiere: 12

# Enseignement
sector_details:
  classe_concorso: "A-12 (Italiano, Storia)"
  anni_ruolo: 8
  specializzazione_sostegno: true
```

Règles :
- Clés en `snake_case`, courtes et lisibles.
- N'insérez que des clés avec une valeur réelle du candidat. Si vous ne savez pas → omettez (jamais `null` / `""`).
- Valeurs : chaîne, nombre, booléen, tableau de chaînes.
- Secteur pas dans la liste → inventez les clés appropriées vous-même, en vous basant sur ce qui est important dans ce métier. Ex. chauffeur routier : `patente: CE+CQC`, `anni_alla_guida: 15`, `tratte_abituali: [...]`.

## `ready.flag` — déblocage "Vai alla dashboard"

Le bouton est désactivé par défaut. Le frontend l'active SI :
- `$JHT_HOME/profile/ready.flag` existe (le flag explicite que VOUS créez), **OU**
- le backend détecte que le schéma minimum est déjà complet (fallback automatique).

Donc souvent le bouton est déjà débloqué par le fallback quand le profil est complet — **n'annoncez pas le déblocage si ce n'est pas vous qui avez créé le flag**.

### Quand créer le flag (3 étapes STRICTES, ne jamais les sauter, ne jamais changer l'ordre)

```bash
# 1. Créez le flag avec un horodatage UTC
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$JHT_HOME/profile/ready.flag"

# 2. VÉRIFIEZ que le fichier existe vraiment (peut échouer silencieusement :
#    permissions, répertoire manquant, quota disque, etc.)
test -f "$JHT_HOME/profile/ready.flag" && echo FLAG_OK || echo FLAG_MISSING

# 3. SEULEMENT si l'étape 2 = FLAG_OK → envoyez le message dans le chat.
#    Si FLAG_MISSING → corrigez (ex. mkdir -p) et recommencez à l'étape 1.
#    N'annoncez JAMAIS le déblocage sans FLAG_OK à l'étape précédente.
```


### 4. Prévenez le Capitano — c'est de là que l'équipe démarre

Seulement après `FLAG_OK`, et une seule fois :

```bash
jht-tmux-send CAPITANO "[@assistente -> @capitano] [PROFILO-PRONTO] profil du candidat complet et validé — l'équipe peut démarrer."
```

Le Capitano ne regarde pas le fichier de profil : tant que personne ne le lui dit,
au premier démarrage il laisse l'utilisateur devant un bureau presque à l'arrêt. Ce
message est le déclencheur de sa skill `first-run-burst` (effectif complet tout de
suite au lieu de la montée par paliers). Sans lui, le premier jour l'utilisateur
voit une position toutes les dix minutes et en conclut que l'application est cassée.

### Anti-hallucination de l'étape 2

Il est connu qu'un LLM tend à écrire "j'ai fait X" même quand l'appel d'outil n'a pas été émis. Le `test -f` existe précisément pour vous interrompre si vous avez sauté la création : vous voyez `FLAG_MISSING` et vous vous souvenez de revenir en arrière. **Ne faites pas confiance à votre mémoire, faites confiance uniquement à la sortie de `test -f`.**

### Quand supprimer le flag

Si pendant la conversation il apparaît qu'un champ de la checklist de blocage est erroné ou manquant (ex. l'utilisateur dit "ah non, cette expérience n'était pas vraiment la mienne") :

```bash
rm -f "$JHT_HOME/profile/ready.flag"
```

Et informez l'utilisateur : "j'ai remis le bouton en attente — revoyons ce point avant de continuer".

### NE PAS créer le flag si

- la dernière validation du profil a affiché `INVALID_PROFILE` (même une seule fois après le dernier Write) ;
- il manque (les huit champs minimum) : nom, email, rôle cible, ville, années d'expérience, `seniority_target`, compétences (≥2), langues (≥1).

Expériences et diplômes sont recommandés : ils ne bloquent pas le flag. Demandez-les juste après l'avoir créé.

## 🎓 `has_degree` — d'après les études, jamais comme valeur d'attente

`has_degree` est facultatif : absent veut dire « non déclaré », jamais « non ». C'est un fait sur le candidat, pas une valeur par défaut ; tu peux le demander (il fait partie des champs optionnels), mais il ne bloque ni le profil ni le déblocage :
- `true` quand `education` (CV ou chat) contient un diplôme : licence, master, doctorat ou équivalent.
- `false` seulement après que l'utilisateur t'a dit qu'il n'en a pas.
- Si tu ne le sais pas, laisse la clé de côté : pas de `false` par prudence, pas de valeur vide, pas de texte (`"oui"`) : quand la clé est là, elle doit valoir `true` ou `false`. Jamais `false` pour combler un vide : le Scorer le compare aux exigences de diplôme de chaque poste.

## ⚠️ Anti-hallucination — la règle critique

**NE JAMAIS lire `docs/examples/candidate_profile.yml.example` ou `docs/examples/candidate_profile.hr.yml.example` comme source de valeurs.** Ces fichiers documentent la *structure*, pas le candidat. Si vous les lisez, vous risquez d'écrire "Mario Rossi" / "mario.rossi@example.com" dans le profil réel.

Utilisez UNIQUEMENT :
- ce que l'utilisateur vous a dit en chat
- ce que vous avez extrait d'un CV / fichier uploadé

Si vous ne connaissez pas un champ : **laissez `""` ou omettez**, n'inventez jamais une valeur plausible.

## Anti-patterns

- ❌ Écrire le profil dans votre cwd `$JHT_AGENT_DIR` au lieu de `$JHT_HOME/profile/` — le frontend ne le trouve pas.
- ❌ Sauter la validation "c'était juste une petite modification" — chaque Write peut casser le YAML, toujours.
- ❌ Montrer du YAML / JSON / des chemins dans le chat — l'utilisateur est non-technique (voir `assistente.md` section langage utilisateur).
- ❌ Annoncer le déblocage sans le `test -f` — c'est l'hallucination classique "j'ai fait X" sans l'avoir fait.
- ❌ Append (Edit) dans des sections existantes sans revoir le contexte — le YAML doit être réécrit de manière cohérente, pas patché au hasard.

## Voir aussi

- `profile-summaries` — les 4 MD narratifs écrits en parallèle du YAML.
- `onboarding-flow` — le protocole conversationnel qui décide quand mettre à jour quoi.
- `chat-web` — comment communiquer la confirmation à l'utilisateur (1 ligne, pas de chemin, pas de jargon).
- `agents/_team/team-rules.md` T10 — le profil est en lecture seule pour les autres agents, citation verbatim.
