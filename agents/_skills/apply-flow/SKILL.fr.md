<!-- @translation: fr, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Comment le CLOSER exécute une candidature autorisée avec `apply_flow.py` — la machine à états avec checkpoints (detect, fill, upload_cv, screening, review, submit), le reçu obligatoire sans lequel `applied` n'est jamais écrit, et que faire pour chaque résultat, `blocked_human` avant tout. Utilise-la pour chaque position prise dans la queue. Au CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *)
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
- Aujourd'hui deux recettes complètes : **Ashby** et **Greenhouse** (uniquement ses trois hosts publics, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`, en HTTPS ; la page est revérifiée après chaque étape). Toute autre plateforme bloque pour un humain.

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
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | un champ que la recette ne sait pas remplir avec une réponse enregistrée |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | le CV ne peut pas être joint |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` | pas encore de recette pour cette page, ou le formulaire n'est pas celui que la recette connaît |
| `greenhouse_redirect_untrusted` | pendant le flux la page Greenhouse est sortie de ses trois hosts de confiance |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | deux adresses mailto de candidature différentes, ou le formulaire de candidature, ses champs ou son bouton d'envoi ne tiennent pas dans un seul formulaire (newsletter, pied de page et formulaires de démo n'en font jamais partie) |
| `form_error` / `field_invalid` / `submit_unavailable` | le formulaire signale une erreur, le format d'un champ est refusé, ou le bouton d'envoi manque ou est désactivé |
| `url_refused` / `checkpoint_invalid` | l'URL de la candidature n'a pas passé le contrôle des adresses publiques, ou le checkpoint enregistré est illisible |
| `page_unavailable` / `browser_uncertainty` | la page ou le navigateur a lâché en plein flux |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | l'envoi a été cliqué mais la confirmation n'est pas certaine |
| `receipt_screenshot_failed` | la confirmation était visible mais sa capture n'a pas pu être enregistrée |
| `submit_outcome_unknown` | un passage précédent a lancé l'envoi et n'a laissé aucun reçu |
| `applied_record_failed` | le reçu existe mais l'état n'a pas pu être enregistré — la candidature est très probablement partie |

Ce que tu fais pour toute autre raison (les réponses manquantes sont plus haut) :

1. **Rien sur cette position.** Le flux a déjà écrit le checkpoint et prévenu
   l'utilisateur via `jht-notify-user`. Ne le préviens pas une deuxième fois.
2. **Ne la retente pas.** Ni maintenant, ni « encore une fois dans quelques minutes ».
   La queue la retient (`checkpoint_blocked_human`) jusqu'à ce que l'utilisateur l'autorise à nouveau.
3. **Passe à la position suivante** de la queue.

Retenter une position bloquée, c'est la tentative à l'aveugle que ce design existe
pour empêcher : sur un captcha elle grille le compte de l'utilisateur, sur un
résultat inconnu elle envoie une deuxième lettre au même recruteur.

## Vérifier une candidature ensuite

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` et un `applied_at` non vide = le flux l'a enregistrée.
