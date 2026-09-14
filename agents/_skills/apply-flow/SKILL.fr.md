<!-- @translation: fr, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Comment le CLOSER exécute une candidature autorisée avec `apply_flow.py` — la machine à états avec checkpoints (detect, fill, upload_cv, screening, review, submit), le reçu obligatoire sans lequel `applied` n'est jamais écrit, et que faire pour chaque résultat, `blocked_human` avant tout. Utilise-la pour chaque position prise dans la queue. Au CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/closer_notices.py *)
---

# apply-flow — une candidature, un reçu, aucune nouvelle tentative à l'aveugle

```bash
python3 /app/shared/skills/apply_flow.py \
  --position-id "$PID" \
  --url "$URL" \
  --profile "$JHT_HOME/profile/candidate_profile.yml" \
  --cv "$CV"
```

`PID`, `URL` et `CV` viennent de la dernière lecture de `apply_gate.py queue`
(skill `apply-authorization`), jamais de la mémoire.

## La machine à états

```
detect → fill → upload_cv → screening → review → submit → applied
                                                        ↘ blocked_human
```

- Chaque étape terminée est enregistrée dans un checkpoint (`$JHT_HOME/.cache/apply-flow/<id>.json`).
  Après un crash le flux reprend où il était : le remplissage est rejoué, le clic non.
- `submit_started` est enregistré **avant** le clic. Si un processus meurt après
  cette ligne, le résultat est inconnu, et un résultat inconnu n'est jamais recliqué :
  le flux cherche une confirmation sur la page et, sans elle, bloque avec
  `submit_outcome_unknown`.
- La porte est vérifiée au démarrage **et** juste avant le clic. Un flag révoqué
  pendant le remplissage du formulaire arrête l'envoi.
- Aujourd'hui trois recettes complètes : **Ashby**, **Greenhouse** (uniquement ses trois hosts publics, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`, en HTTPS ; la page est revérifiée après chaque étape) et **Lever** (uniquement `jobs.lever.co` et `jobs.eu.lever.co`, en HTTPS, revérifiés de la même façon). LinkedIn : « postuler sur le site de l'entreprise » continue sur ce site avec sa recette ; Easy Apply se connecte avec le compte de l'utilisateur (session conservée, code de vérification sur Telegram) et remplit la fenêtre. Toute autre plateforme bloque pour un humain.

## Le reçu

`applied` n'est écrit que lorsque le flux détient **les deux** :

1. une capture d'écran de la page de confirmation, et
2. une URL ou un texte de confirmation.

Ensuite c'est le flux lui-même qui enregistre la candidature avec `applied_via = agent_closer`,
et relit la ligne pour vérifier que l'écriture a eu lieu. Personne d'autre n'écrit
cet état : ni toi, ni le Capitano.

## Lire le résultat

Une ligne JSON sur stdout : `status`, `state`, `reason`, `receipt`.

| `status` | Exit | Signification | Ce que tu fais |
|---|---|---|---|
| `applied` | 0 | envoyée, reçu enregistré, état enregistré | position suivante |
| `dry_run` | 0 | `mode: dry_run` : remplie, arrêtée avant le bouton, rien envoyé | position suivante |
| `denied` | 1 | la porte a refusé (consentement désactivé, flag révoqué, déjà envoyée) | position suivante ; jamais de nouvelle tentative |
| `retry_later` | 5 | la page de l'offre ne répond pas pour l'instant (5xx, délai dépassé) ; ce n'est pas un arrêt, personne n'est averti ; le checkpoint contient `retry_after` | position suivante ; la file la redonne d'elle-même après `retry_after` — jamais relancer avant |
| `blocked_human` | 3 | un humain est nécessaire ; l'utilisateur a déjà été prévenu | position suivante ; jamais de nouvelle tentative |
| `blocked_human` réponses manquantes (`essential_facts_missing` avec `missing`, `required_answer_missing` avec `pending_question`) | 3 | pas un arrêt et rien n'a été demandé : il manque des réponses au flux | déduis chacune du profil, du CV et de l'offre et enregistre-la (`application_answers.py save … --basis …`), puis relance le flux ; seulement sans aucune base `application_answers.py ask --position-id $PID --key K` (prompt du CLOSER, CL-08). Une question que tu as posée retient la position jusqu'à ce que l'utilisateur réponde, un jour par question au plus |
| `email_channel` | 4 | le contrôle de candidature est un lien `mailto:`, pas un formulaire ; le checkpoint contient `channel: email` et le `mailto_href` brut | lance `email_application.py send` pour cette position comme le dit la skill `email-application-flow` : elle lit ce checkpoint ; ne remplis jamais de formulaire web et n'écris jamais l'e-mail à la main |
| `error` | 2 | profil ou CV illisible, mauvais arguments | arrête-toi : `[BLOCKED]` au Capitano |

## `blocked_human` — ce que ça veut dire et ce que tu fais

Le flux s'arrête sur tout ce qu'il ne peut pas faire avec certitude :

| `reason` (exemples) | Cause typique |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | un champ obligatoire n'a pas de réponse enregistrée ; `pending_question` le nomme (clé, libellé, type, options, scope). Rien ne part vers l'utilisateur tant que tu ne lances pas `ask` ; une réponse enregistrée fait reprendre le flux au checkpoint |
| `essential_facts_missing` / `essential_facts_unavailable` | avant le premier run d'une position, il manque une donnée que presque tout formulaire demande (date de début, préavis, autorisation de travail, sponsorship, salaire, mobilité, téléphone) ; `missing` liste les clés. Rien n'a été demandé et rien n'est retenu |
| `captcha` / `two_factor` | le site veut vérifier qu'il y a un humain |
| `vacancy_closed` | l'offre n'est plus ouverte : une page sans formulaire, bouton Apply ni canal e-mail le dit, ou l'URL a redirigé vers la liste des postes, la page carrières ou l'accueil ; rien n'a été rempli ni envoyé. Arrêt définitif : une nouvelle exécution ne rouvre pas la page tant que l'utilisateur n'autorise pas de nouveau le poste. Une capture de la page est enregistrée à côté du checkpoint (`stop_screenshot`) |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | un champ que la recette ne sait pas remplir avec une réponse enregistrée |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | le CV ne peut pas être joint |
| `cv_pdf_layout_bad` | le PDF du CV n'a pas passé le contrôle visuel (`pdf_layout_check.py` : texte tassé dans une colonne étroite, une page presque vide, plus de 2 pages, polices non incorporées, corps de texte trop petit) : rien n'a été joint ni envoyé. Le Rédacteur doit le régénérer ; ne jamais le joindre à la main. L'aperçu de la page 1 est enregistré à côté du checkpoint : regarde-le |
| `cv_pdf_check_unavailable` | le PDF du CV n'a pas pu être mesuré (poppler absent du conteneur, fichier illisible) : rien n'a été joint ni envoyé — un CV non mesuré n'est pas un pass. Le remède est dans le conteneur, pas chez le Rédacteur : signale-le au Capitano |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` / `lever_dom_unrecognised` / `lever_form_missing` / `lever_apply_ambiguous` / `lever_form_ambiguous` / `generic_dom_unrecognised` | pas encore de recette pour cette page, ou le formulaire n'est pas celui que la recette connaît |
| `greenhouse_redirect_untrusted` | pendant le flux la page Greenhouse est sortie de ses trois hosts de confiance |
| `lever_redirect_untrusted` | pendant le flux la page Lever est sortie de `jobs.lever.co` / `jobs.eu.lever.co` |
| `linkedin_dom_unrecognised` / `linkedin_form_missing` / `linkedin_form_ambiguous` / `linkedin_step_unrecognised` / `linkedin_apply_control_missing` / `linkedin_apply_ambiguous` / `linkedin_session_unavailable` / `linkedin_login_unrecognised` | l'offre LinkedIn ou sa fenêtre Easy Apply n'est pas celle que la recette connaît |
| `linkedin_credentials_missing` | `$JHT_HOME/credentials/linkedin.json` (`email`, `password`) manque, n'est pas un fichier régulier 0600 de cet utilisateur, ou est vide : l'utilisateur le crée avec le script des identifiants. Ne jamais demander le mot de passe dans un chat |
| `linkedin_login_failed` | LinkedIn a refusé la connexion deux fois : aucun nouvel essai tant que l'utilisateur n'écrit pas de nouveaux identifiants |
| `linkedin_login_code_missing` / `linkedin_login_code_undelivered` | le code de vérification LinkedIn demandé sur Telegram n'est pas arrivé à temps (ou la demande n'a pas atteint Telegram) : un nouveau tour demande un nouveau code |
| `linkedin_challenge` | LinkedIn affiche un captcha ou un contrôle de sécurité : l'utilisateur le résout sur l'écran en direct, puis autorise à nouveau la position |
| `linkedin_redirect_untrusted` / `application_redirect_untrusted` | la page LinkedIn a quitté `www.linkedin.com`, ou l'adresse de l'entreprise qu'elle donne n'est pas une page HTTPS hors de LinkedIn (ou c'est un second passage) |
| `linkedin_follow_not_cleared` | la case « suivre l'entreprise » n'a pas pu être décochée avant Submit : rien n'est envoyé |
| `linkedin_throttled` / `linkedin_login_retry` / `linkedin_interval_invalid` | **refusé, pas bloqué** : les candidatures LinkedIn sont espacées (`linkedin_min_interval_minutes`, 20 par défaut), la connexion a échoué une fois et le prochain tour réessaie une fois, ou ce réglage n'est pas un nombre entier de minutes. La file réessaie d'elle-même |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | deux adresses mailto de candidature différentes, ou le formulaire de candidature, ses champs ou son bouton d'envoi ne tiennent pas dans un seul formulaire (newsletter, pied de page et formulaires de démo n'en font jamais partie) |
| `form_error` / `field_invalid` / `submit_unavailable` | le formulaire signale une erreur, le format d'un champ est refusé, ou le bouton d'envoi manque ou est désactivé |
| `url_refused` / `checkpoint_invalid` | l'URL de la candidature n'a pas passé le contrôle des adresses publiques, ou le checkpoint enregistré est illisible |
| `page_unavailable` / `browser_uncertainty` | la page ou le navigateur a lâché en plein flux |
| `page_not_found` / `bot_protection` / `page_temporarily_unavailable` | la page de l'offre n'existe plus (404/410 sans preuve d'offre fermée), un contrôle anti-bot a arrêté le navigateur (après un essai dans un navigateur visible), ou le site n'a pas répondu trois fois en une journée. Un seul 5xx ou timeout N'EST PAS un arrêt : le checkpoint indique `retry_later`, la file rend le poste plus tard d'elle-même et personne n'est averti. Le checkpoint garde `http_status` et `final_url` |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | l'envoi a été cliqué mais la confirmation n'est pas certaine |
| `receipt_screenshot_failed` | la confirmation était visible mais sa capture n'a pas pu être enregistrée |
| `submit_outcome_unknown` | un passage précédent a lancé l'envoi et n'a laissé aucun reçu |
| `applied_record_failed` | le reçu existe mais l'état n'a pas pu être enregistré — la candidature est très probablement partie |
| `login_required` / `account_creation` | le site veut une connexion ou un nouveau compte avant la candidature : le CLOSER ne se connecte jamais et ne crée jamais de compte |
| `generic_form_missing` / `generic_form_unrecognised` / `application_form_embedded` / `application_redirect_untrusted` | un site d'entreprise : aucun formulaire de candidature, un formulaire que la recette générique ne sait pas cerner, un formulaire intégré depuis un autre hôte (le detail le nomme), ou un bouton Postuler qui mène à un site sans recette |
| `cover_letter_required` / `pre_submit_screenshot_failed` | le formulaire exige un fichier de lettre de motivation · le formulaire rempli n'a pas pu être photographié avant le clic |

Ce que tu fais pour toute autre raison (les réponses manquantes sont plus haut) :

1. **Rien sur cette position.** Le flux a déjà écrit le checkpoint et prévenu
   l'utilisateur via `jht-notify-user`. Ne le préviens pas une deuxième fois.
2. **Ne la retente pas.** Ni maintenant, ni « encore une fois dans quelques minutes ».
   La queue la retient (`checkpoint_blocked_human`) jusqu'à ce que l'utilisateur l'autorise à nouveau.
3. **Passe à la position suivante** de la queue.

Retenter une position bloquée, c'est la tentative à l'aveugle que ce design existe
pour empêcher : sur un captcha elle grille le compte de l'utilisateur, sur un
résultat inconnu elle envoie une deuxième lettre au même recruteur.

## Sites carrières d'entreprise — la recette générique

Quand aucun ATS n'est reconnu et que la page n'est pas un canal `mailto:`, le
flux utilise `apply_generic.py` sur le site de l'entreprise : il trouve LE
formulaire de candidature (un envoi de CV, ou un nom et un email avec un bouton
Postuler — aussi derrière un bouton Postuler ou sur une page liée du même site),
remplit les champs d'après leurs libellés (profil pour nom, email, téléphone,
liens ; réponses enregistrées pour les questions) et ne touche jamais un
formulaire de newsletter, de contact, de recherche ou de connexion. Le
formulaire rempli est photographié avant le clic ; sans confirmation reconnue
(texte ou URL) le résultat est `submit_outcome_unknown`, jamais un second clic.
Un bouton Postuler qui mène à un ATS connu confie le poste à cette recette.

**Un récapitulatif par tournée.** Les arrêts propres au site (`ats_unsupported`,
`ats_conflict`, `linkedin_easy_apply`, `application_form_embedded`, `page_not_found`, `bot_protection`, `page_temporarily_unavailable`) ne sont pas
notifiés un par un : ils attendent le récapitulatif que tu envoies au STEP 6 avec
`python3 /app/shared/skills/closer_notices.py flush`. Chaque avis arrive à
l'utilisateur dans la langue de son profil.

## Vérifier une candidature ensuite

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` et un `applied_at` non vide = le flux l'a enregistrée.
