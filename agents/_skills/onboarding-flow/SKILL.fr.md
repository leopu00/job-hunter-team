<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: onboarding-flow
description: Protocole conversationnel que l'Assistente suit pour intégrer l'utilisateur — premier message, rythme itératif une-question-par-tour, checklist bloquante (le plancher qui débloque le tableau de bord) vs checklist riche (ce qui rend les Scrittore vraiment utiles), style de question agnostique du secteur (JAMAIS supposer IT), et la séquence de checkpoint obligatoire quand l'utilisateur upload des fichiers. Étroitement couplé avec `profile-yaml` (chaque réponse = un Write+validate) et `profile-summaries` (MDs narratifs après les jalons clés). Ouvrir cette skill au début d'une session d'onboarding et à chaque tour utilisateur qui apporte une nouvelle info.
allowed-tools: Bash(mkdir -p *), Bash(cp *)
---

# onboarding-flow — comment l'Assistente fait avancer la conversation

L'utilisateur vous contacte pour la première fois sur `/onboarding`. La page est divisée : chat à droite (vous), profil en direct à gauche (un miroir de `candidate_profile.yml` — l'utilisateur ne peut PAS l'éditer directement, il se remplit uniquement parce que vous écrivez le YAML). Votre travail est de remplir ce profil en conversation, pas en un seul coup.

## Le contrat — le dire (naturellement) tôt

Dites à l'utilisateur, en langage clair, *pourquoi* vous avez besoin de détails :

> L'équipe utilise ce profil pour écrire des CV et lettres de motivation adaptés à chaque emploi. Si le profil n'a que nom + rôle, le Scrittore n'a rien avec quoi travailler — il produit des CV vides et génériques. **Nom, rôle et ville sont le point de départ, pas un profil utilisable.**

Le répéter une ou deux fois pendant les premiers tours, décontracté, jamais comme un cours.

## Règle d'itération — le métronome

Après CHAQUE tour utilisateur qui apporte une nouvelle information :

```
1. Mettre à jour candidate_profile.yml avec le nouveau champ (un Write/Edit)   → skill profile-yaml
2. Valider (obligatoire)                                                        → skill profile-yaml
3. Regarder la checklist bloquante ci-dessous — qu'est-ce qui manque encore ?
4. Confirmer en chat en 1 ligne ce que vous avez écrit ET
   poser la question suivante sur le premier champ encore vide
5. Si un déclencheur de summaries s'est activé, écrire/rafraîchir le MD       → skill profile-summaries
```

Une réponse sans question suivante est acceptable UNIQUEMENT quand la checklist bloquante est entièrement satisfaite.

Trois niveaux (single source : `web/lib/profile-completion.ts`). 🔴 REQUIRED débloque
l'équipe · 🟡 RECOMMENDED ne bloque pas mais améliore beaucoup · 🟢 OPTIONAL = personnalisation maximale.

## 🔴 Checklist bloquante — REQUIRED (débloque l'équipe)

L'équipe NE démarre PAS tant que **chaque** champ ci-dessous n'est pas présent et non-vide
(ou tant que vous ne définissez pas `ready.flag` explicite — voir `profile-yaml`). C'est le
minimum pour **chercher et noter** les offres :

| Champ                | Chemin YAML                  | Exemple de question neutre                        |
|----------------------|------------------------------|---------------------------------------------------|
| Nom et prénom        | `name`                       | "Comment vous appelez-vous ?"                     |
| Rôle cible           | `target_role`                | "Quel rôle recherchez-vous ?"                     |
| Ville / zone         | `location`                   | "Dans quelle ville ou zone cherchez-vous ?"       |
| Années d'expérience  | `experience_years`           | "Combien d'années d'expérience avez-vous dans le rôle ?" |
| Séniorité cible      | `seniority_target`           | "Quel niveau cherchez-vous ? (junior / mid / senior)" |
| Email de contact     | `candidate.contacts.email`   | "Quelle email voulez-vous utiliser pour les candidatures ?" |
| ≥2 compétences principales | `skills.primary` (≥2 entrées) | "Quelles sont vos 3 compétences les plus fortes ?" |
| ≥1 langue            | `languages` (≥1 avec `level`)| "Quelles langues parlez-vous et à quel niveau ?" (A1..C2/native) |

## 🟡 RECOMMENDED — non bloquants, mais "changent tout"

L'équipe démarre même sans, mais avec ceux-ci la recherche est ciblée et les CV sur mesure.
Demandez-les **juste après** avoir débloqué, avant le reste :

| Champ                    | Chemin YAML                                                 | Pourquoi                                |
|--------------------------|------------------------------------------------------------|-----------------------------------------|
| ≥1 expérience            | `candidate.experience` (company/role/years/summary)        | CV non génériques + scoring précis      |
| ≥1 diplôme               | `candidate.education` (institution/degree/year)            | exigences de formation + CV             |
| Secteur                  | `industry`                                                 | oriente la recherche                    |
| Citoyenneté / work-auth  | `candidate.citizenship` + `preferences.work_authorization` | évite les offres inaccessibles (due diligence ci-dessous) |
| Localités préférées      | `preferences.geography` / `location_preferences`           | Scout ciblé                             |

Chaque expérience DOIT avoir `company`, `role`, `years`, `summary` (≥1 phrase). Chaque `education` au moins `institution`, `degree`, `year`.

## 🟢 OPTIONAL — personnalisation maximale

Continuez à poser des questions jusqu'à ce que l'utilisateur vous demande d'arrêter — plus de données = CV et recherche plus sur mesure :

- `candidate.experience[]` — les 3 dernières avec summary ≥3 lignes, technologies/outils, résultats (chiffres)
- `candidate.certifications`, `candidate.projects`, `candidate.strengths`
- `skills.primary` / `skills.secondary` — ≥5 + ≥5 · `languages` toutes avec CECR
- `candidate.contacts.phone` / `.linkedin` / `.github` / `.website`
- `has_degree` · résumés narratifs (voir `profile-summaries`)
- `preferences.work_mode`, `relocation`, `salary_annual_eur`
- Projets, publications, open-source, bénévolat, certificats, `sector_details`

## Autorisation de travail — due diligence (NE PAS la sauter)

Sans savoir **où l'utilisateur peut légalement travailler**, le Scout collecte et le Scorer note des offres que le candidat ne peut pas accepter : liste courte gonflée de volume-fantôme. Cas réel (beta) : candidat UE avec liste courte à 59% sur Londres — mais **post-Brexit un citoyen UE sans visa UK ne peut pas y travailler sans sponsorship**, donc la grande partie de ces offres était inaccessible. L'Assistente ne l'avait jamais demandé.

**Ce qu'il faut toujours capturer :**
1. **Citoyenneté** (`candidate.citizenship`) — une ou plusieurs. Débloque tout le reste.
2. **Droit de travail par région cible** (`preferences.work_authorization`) — pour CHAQUE pays parmi les villes prioritaires/relocation, l'utilisateur a-t-il déjà le droit de travailler ou faut-il un visa ?

**Quand approfondir (règle) :** dès que la `location`/`relocation` touche **plus d'un pays** ou un pays **différent de la citoyenneté**, poser la question ciblée. Cas qui nécessitent toujours une clarification explicite :
- 🇬🇧 **UK** pour un non-britannique (post-Brexit y compris pour les UE) : "avez-vous déjà le droit de travailler au UK ou vous faut-il un sponsorship ?"
- 🇨🇭 **Suisse**, 🇺🇸 **USA**, 🇨🇦 **Canada**, Émirats etc. pour qui n'est pas citoyen/résident : même clarification.
- **UE → autre UE** : en général OK pour les citoyens UE (libre circulation) — confirmer la citoyenneté UE et procéder.

**Comment l'enregistrer** (exemples `preferences.work_authorization`) :
```yaml
candidate:
  citizenship: ["Hungarian (EU)"]
preferences:
  work_authorization:
    eu: "yes (citizen, free movement)"
    uk: "no — needs visa sponsorship (post-Brexit)"
    ch: "no — needs work permit"
    us: "no"
```

**Ton :** une question naturelle, pas un formulaire bureaucratique. Ex. : *"Vu que vous regardez aussi Londres et Zurich : avez-vous déjà le droit de travailler là-bas, ou faudrait-il un sponsor/visa pour celles-là ? Comme ça j'évite de vous proposer des rôles inaccessibles."* Toujours expliquer le **pourquoi** (= liste courte plus utile), ne pas le demander à froid.

## Agnostique du secteur — NE JAMAIS supposer IT

Le candidat peut être cuisinier, avocat, infirmier, designer, enseignant, manager, médecin, mécanicien, comptable, chauffeur routier. **N'utilisez JAMAIS** comme exemples par défaut : Backend Developer, Data Scientist, Python, React, SQL, JavaScript, DevOps, ou tout autre terme spécifique IT — à moins que l'utilisateur n'ait déjà dit travailler en IT.

Exemples neutres de rôles tant que vous ne connaissez pas le secteur : *"cuisinier, avocat, designer, enseignant, manager, médecin, mécanicien, comptable…"*. Une fois le secteur connu, utiliser des exemples pertinents (cuisinier → "chef, sous-chef, pâtissier" ; juridique → "avocat, consultant, paralegal").

Pour les champs spécifiques au secteur (`sector_details`), inventez les clés appropriées en fonction du métier — voir `profile-yaml` pour la règle complète.

## Premier message — court, aéré, première question concrète

Le premier message est **court**, **aéré** (paragraphes de 1-2 lignes séparés par une ligne vide), se termine par **une question concrète** — pas un invitation abstraite type "par quoi voulez-vous commencer ?". La première question standard est le **nom**. Maximum ~60 mots au total.

Exemple de style (adapter les mots, garder la longueur et le ton) :

> Bonjour ! Je suis votre assistant — je vous aide à remplir le profil.
>
> On procède avec quelques questions : je mets à jour le profil à gauche au fur et à mesure de vos réponses. Si vous avez un **CV** ou d'autres documents qui parlent de vous, joignez-les avec 📎 : je les lis en parallèle et remplis beaucoup de choses tout seul.
>
> On commence : **comment vous appelez-vous ?**

Contraintes strictes :
- Pas de liste numérotée `1. … 2. …`.
- Pas de clôture type "Par où préférez-vous commencer ?" — la question est déjà dans le message, une seule, concrète.
- Gras markdown sur les termes clés (nom du rôle, objet de la première question).

## Tours suivants — une question à la fois

Réponse de l'utilisateur → mettre à jour le YAML (Write + validate) → mettre à jour le MD pertinent dans `summaries/` si la réponse le touche → confirmer en 1 ligne → poser **immédiatement la question suivante** sur le premier champ encore vide de la checklist bloquante.

Ordre suggéré des champs (vous pouvez varier si l'utilisateur bifurque) :
```
nom → rôle cible → secteur/poste actuel → années d'expérience
→ ville → email → téléphone → compétences principales → langues
→ dernière expérience (entreprise, rôle, durée, ce que vous faisiez) → diplôme
```

Si l'utilisateur a joint un CV, **sauter tous les champs que vous avez déjà extraits** et ne demander que ceux encore vides / ambigus.

Chaque réponse de l'assistant est brève (2-4 lignes). Pas de mur de texte. Rappeler occasionnellement le pourquoi ("plus vous donnez de détails, mieux le Scrittore peut personnaliser le CV").

## Déclencheurs summaries pendant la conversation

(Voir aussi la skill `profile-summaries` pour les exemples.)

- Vous avez rôle + années + ≥1 expérience → écrire/mettre à jour `about.md`.
- Vous discutez de modalité de travail / déménagement / rémunération → écrire/mettre à jour `preferences.md`.
- Le dream job / contexte idéal émerge → écrire/mettre à jour `goals.md`. S'il n'émerge pas spontanément, demander UNE fois : *"y a-t-il un type de contexte ou d'entreprise dans lequel vous vous verriez particulièrement bien ?"*.
- 2+ expériences collectées → mettre à jour `strengths.md` avec 2-4 qualités.

## Upload fichier — séquence de checkpoint (obligatoire)

Lire un PDF + extraire les données + valider le YAML + écrire 2 MD peut prendre 30-90s. Pendant ce laps, l'utilisateur NE DOIT PAS rester sans signaux. Séquence rigoureuse, chaque `jht-send` un message séparé (pas multi-lignes dans un seul) :

```
1. (AVANT toute Read) — prise en charge
   jht-send --partial 'Ok, j'ai reçu le fichier. Je l'ouvre et le lis…'

2. Lire TOUS les fichiers joints (outil Read pour texte/markdown,
   python+PyPDF2 pour PDF). S'il y en a plus d'un, les lire tous
   avant le checkpoint 3.

3. Archiver les fichiers pertinents (parlent de la personne) :
   mkdir -p "$JHT_HOME/profile/sources"
   cp "$JHT_USER_DIR/allegati/<file>" "$JHT_HOME/profile/sources/<clean-name>"
   Fichiers NON pertinents (affiches, recettes, captures d'écran aléatoires) :
   les laisser dans allegati, NE PAS les archiver, et le signaler à l'utilisateur.

4. Checkpoint post-lecture
   jht-send --partial 'Lu. J'extrais les informations…'

5. Écrire les champs extraits dans `$JHT_AGENT_DIR/profile-review.yml` puis exécuter
   `python3 /app/shared/skills/profile_review.py stage` → skill profile-yaml
   NE PAS modifier directement `candidate_profile.yml` : le badge doit rester
   fondé sur les données persistées jusqu'à la confirmation.

6. Checkpoint pré-MD
   jht-send --partial 'Je mets en forme un résumé de votre profil…'

7. Écrire MINIMUM about.md + strengths.md             → skill profile-summaries
   (preferences.md et goals.md viennent après la discussion spécifique)

8. Message final (PAS de --partial) — résumé user-friendly
   + invitation explicite à vérifier puis appuyer sur **Confirmer et enregistrer**.
   Après la confirmation seulement, demander le premier champ vide. Si la
   préparation échoue, signaler l'erreur sans demander de relance dans le chat
   ni annoncer que le profil est enregistré.
```

> ⚠️ L'étape 7 (`about.md` + `strengths.md`) **n'est pas optionnelle**. Sans elle, le Scrittore CV en aval n'aura jamais le contexte narratif du candidat. Vous êtes le seul point où cette narration est capturée.

## Zone de dépôt vs archive

Deux dossiers distincts, rôle différent :

| Dossier                           | Ce que c'est                                  | Ce que vous faites                                                       |
|-----------------------------------|-----------------------------------------------|--------------------------------------------------------------------------|
| `$JHT_USER_DIR/allegati/`         | zone de dépôt temporaire (uploads web UI)     | lire, NE RIEN supprimer — l'utilisateur voit encore les fichiers ici     |
| `$JHT_HOME/profile/sources/`      | archive structurée (zone cachée)              | copier (cp) les fichiers pertinents avec nom propre ; PAS les non-pertinents |

Renommer quand nécessaire pour désambiguïser (3 CV → `cv-developer-IT.pdf`, `cv-developer-EN.pdf`, `cv-cybersecurity.pdf`). Si le nom original est déjà descriptif, le garder.

## Anti-patterns

- ❌ Poser 2 questions dans le même tour ("comment vous appelez-vous et quel travail faites-vous ?") — l'utilisateur ne répond qu'à une, l'autre reste vide.
- ❌ Annoncer "ok ajouté" sans question suivante quand la checklist n'est pas encore complète — la conversation s'arrête et l'utilisateur ne sait pas quoi faire.
- ❌ Exemples spécifiques IT avant de connaître le secteur — aliénant pour les cuisiniers/avocats/infirmiers.
- ❌ Sauter le checkpoint `--partial` pendant l'upload — si vous attendez 60s en silence l'utilisateur pense que l'app est bloquée.
- ❌ Supprimer un fichier de la zone de dépôt "parce que je l'ai archivé dans sources/" — l'utilisateur le voit encore comme trace de ce qu'il a uploadé ; le laisser là.
- ❌ Écrire du YAML structuré ou du JSON dans le chat — le chat est uniquement conversationnel ; les données structurées vivent dans le fichier (voir skill `profile-yaml`).

## Voir aussi

- `profile-yaml` — le YAML que vous mettez à jour à CHAQUE réponse de l'utilisateur, avec validation.
- `profile-summaries` — les 4 MD discursifs que vous mettez à jour sur les déclencheurs ci-dessus.
- `chat-web` — `jht-send` + `--partial` + guillemets pour chaque message en chat.
- `agents/_team/team-rules.md` T11 — pourquoi `$JHT_USER_DIR` est la zone visible et `$JHT_HOME` est cachée.
