<!-- @translation: fr, ai-translated 2026-09-13 -->
---
name: apply-authorization
description: Les deux portes entre l'équipe et la boîte d'un recruteur, et comment lire leurs refus. Une candidature part UNIQUEMENT si l'utilisateur a donné son consentement général (`applications.auto_apply` dans la config utilisateur) ET a marqué cette position précise. Les deux sont fail-closed et vérifiées dans le code par `apply_gate.py`. Utilise-la au boot et avant chaque position pour lire la queue du CLOSER, et chaque fois que tu dois expliquer pourquoi une position n'est pas partie. Au CLOSER ; le Capitano lit la même queue pour décider s'il le spawne.
allowed-tools: Bash(python3 /app/shared/skills/apply_gate.py *)
---

# apply-authorization — ce qui peut partir, et pourquoi le reste non

Une candidature ne quitte la box que lorsque **deux** conditions sont réunies.
Absent, cassé ou non reconnu vaut **non**, à chaque fois.

| # | Condition | Où elle vit | Qui la pose |
|---|---|---|---|
| 1 | consentement général | `applications.auto_apply.enabled = true` dans `$JHT_HOME/jht.config.json` | l'utilisateur, à l'activation |
| 2 | autorisation par position | `positions.apply_requested = 1` avec `apply_requested_at` et `apply_requested_by` = `user_web` / `user_local` | l'utilisateur, sur cette position |

Le flag de l'utilisateur **est** l'autorisation d'envoyer. Il n'y a pas de deuxième question.

## La queue — une commande, lue par deux rôles

```bash
python3 /app/shared/skills/apply_gate.py queue --json
```

Exit `0` seulement quand quelque chose peut partir maintenant ; exit `1` sinon. Le JSON :

| Champ | Signification |
|---|---|
| `ready` | `true` = au moins une position peut être prise maintenant |
| `reason` | token stable, voir plus bas |
| `mode` | `authorised` (envoie) ou `dry_run` (diagnostic, remplit et s'arrête avant le bouton) |
| `max_per_day` / `sent_today` / `remaining_today` | les envois du jour du CLOSER, et le plafond quotidien si l'utilisateur en a fixé un (null = pas de plafond, rien n'est refusé pour le nombre) |
| `positions` | ce que tu peux prendre, dans l'ordre d'autorisation : `position_id`, `url`, `cv_pdf_path` |
| `held` | positions autorisées à NE PAS prendre maintenant, chacune avec son `reason` |

Le CLOSER prend la première entrée de `positions`. Le Capitano ne spawne le
CLOSER que lorsque la commande sort avec `0`.

## Pourquoi la queue est fermée (`reason`)

| Token | Signification | Que faire |
|---|---|---|
| `config_missing` / `config_unreadable` / `config_malformed` | la config utilisateur est illisible | rien : aucun consentement ne peut être établi |
| `consent_absent` / `consent_disabled` | l'utilisateur n'a pas consenti | rien. Ne jamais suggérer de l'activer (RULE-T18) |
| `consent_mode_unknown` / `consent_cap_invalid` | le bloc existe mais une valeur n'est pas reconnue | rien : la porte refuse au lieu de deviner |
| `db_unavailable` / `queue_unreadable` | la base de données locale est illisible | `[BLOCKED]` au Capitano |
| `queue_empty` | aucune position autorisée ne peut être prise | sors |
| `daily_cap_reached` | l'utilisateur a fixé `max_per_day` et le CLOSER en a déjà envoyé autant aujourd'hui (jamais sans plafond) | sors ; la queue rouvre demain |

## Pourquoi une position est retenue (`held[].reason`)

| Token | Signification |
|---|---|
| `already_submitted` | la candidature est déjà partie (statut `applied`/`response`, ou la ligne application dit applied). Le flag reste allumé après l'envoi : ce n'est pas une nouvelle demande |
| `position_not_authorised` | le flag est éteint (l'utilisateur l'a révoqué) |
| `authorisation_undated` | le flag n'a pas de timestamp |
| `authorisation_not_from_user` | le flag n'a pas été posé par un canal utilisateur. Un flag posé par un processus n'est pas une autorisation |
| `url_missing` / `cv_pdf_missing` | il n'y a rien pour remplir le formulaire |
| `checkpoint_blocked_human` | le flux s'est déjà arrêté sur cette position et a demandé à l'utilisateur. Elle revient seulement quand l'utilisateur l'autorise à nouveau |
| `checkpoint_dry_run` | déjà remplie en mode diagnostic |
| `checkpoint_unreadable` | le checkpoint du flux est illisible : incertitude, donc non |

## Une position, un verdict

```bash
python3 /app/shared/skills/apply_gate.py position <ID> --json
```

`allowed: true` seulement avec `reason: apply_allowed`. C'est la même vérification
que `apply_flow.py` fait au démarrage et à nouveau juste avant le clic. Inutile de
la lancer avant le flux ; utilise-la pour expliquer un refus.

## Règles

- **N'écris jamais l'autorisation.** `apply_requested*` appartient à l'utilisateur.
- **Ne contourne jamais un refus.** Une porte fermée est la réponse, pas un obstacle.
- **Ne demande jamais à l'utilisateur d'autoriser davantage.** L'équipe est complète
  même sans une seule candidature (RULE-T18).
