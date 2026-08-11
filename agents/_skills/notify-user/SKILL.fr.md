<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: notify-user
description: Notifier l'utilisateur avec fallback automatique. Essaie Telegram d'abord ; si le bot n'est pas configuré / inaccessible / rate-limité, le message atterrit sur le tableau de bord web via la synchronisation cloud. Enregistre toujours le message dans `pending_user_messages` pour que rien ne soit perdu. Utilisez ceci chaque fois que vous devez contacter l'utilisateur avec une mise à jour de statut, une question ou un digest — n'appelez jamais `jht-telegram-send` directement pour cet usage.
allowed-tools: Bash(jht-notify-user *)
---

# notify-user — API unique pour contacter l'utilisateur

L'utilisateur a plusieurs canaux (bot Telegram, tableau de bord web, futur push mobile). Chaque agent ne devrait pas avoir à savoir lequel est actif. `jht-notify-user` décide :

1. INSÈRE le message dans `pending_user_messages` (jobs.db, schéma V5).
2. Tentative best-effort d'envoi via `jht-telegram-send` (timeout ~25s).
3. Si Telegram réussit → `delivered_via='telegram'`.
4. Si ça échoue ou n'est pas configuré → `delivered_via='web'`. La ligne est récupérée par `jht cloud push` et apparaît sur le tableau de bord à jobhunterteam.ai.

L'utilisateur reçoit donc chaque message quelque part. L'agent n'a jamais à gérer les branches "Telegram est down".

## ⚠️ Depuis que la voie du chat est unifiée : ce message est AUSSI une bulle de chat

`jht-send` et `jht-notify-user` écrivaient à deux endroits différents — le fil
de discussion et la file des notifications. Ce n'est plus le cas. La box
recopie `pending_user_messages` dans `<agent>/chat.jsonl` : ce que tu écris
ici apparaît donc aussi comme ta bulle dans le chat du jeu et dans le fil web,
à côté de tes réponses envoyées avec `jht-send`.

La conséquence est la seule règle qui compte ici : **un message, un seul
outil.** Jamais le même contenu par les deux voies. L'utilisateur le lirait
deux fois, et aucune des deux copies ne connaît l'autre — la voie ne sait pas
distinguer un doublon de deux tours qui disent la même chose par hasard
(« ok » arrive mille fois), donc personne ne fera le ménage en aval.

## Quand l'utiliser

- ✅ Le Capitano notifie l'utilisateur tous les N positions prêtes (décision 2026-05-13, batch).
- ✅ Digest hebdomadaire / alertes de pattern du Mentor.
- ✅ L'Assistente pose une question à l'utilisateur qui nécessite sa réponse.
- ✅ Toute alerte ("j'ai consommé 95% de la fenêtre, j'arrête l'équipe ?").

## Quand NE PAS l'utiliser

- ❌ Messages inter-agents — utiliser `tmux-send` / `jht-tmux-send`.
- ❌ Réponses à un message `[CHAT]` sur le tableau de bord web — utiliser `jht-send` (déjà dans le fil de chat).
- ❌ Réponses à un `[TG]` entrant — utiliser `jht-telegram-send` directement : vous savez déjà que Telegram est actif parce que l'utilisateur vient de vous écrire de là. Économise un aller-retour DB.
- ❌ Pièces jointes lourdes (>20 Mo). Utiliser le dossier CV de l'utilisateur + un corps de notification court.

## Utilisation

```bash
# Notification simple du Capitano
jht-notify-user --agent capitano "Trovate 10 offerte pronte sopra 75/100. Top: Acme Senior FE (88), Lever DevOps (84), …"

# Digest avec type explicite (rendu avec un en-tête sur le tableau de bord)
jht-notify-user --agent mentor --kind digest "Settimana 19: 18 offerte analizzate, 4 candidate, gap principale: ruoli senior in EU remote."

# Question — uniquement pour preciser une candidature deja demandee par l'utilisateur
jht-notify-user --agent assistente --kind question "Pour la candidature que vous avez deja demandee pour Acme Senior FE, quelle version du CV preferez-vous ?"

# Lié à une position (rendu avec la carte de position sur le tableau de bord)
jht-notify-user --agent capitano --position-id 42 "CV pronto per posizione 42. Critic verdict: PASS."

# Forcer web (contourner Telegram, utile pour les tests ou messages qui n'ont de sens que dans le contexte du tableau de bord)
jht-notify-user --agent mentor --no-telegram "Apri il tab Patterns per i dettagli."
```

Sortie (stdout) :
```
<row_id> via=<telegram|web>
```

## Types

| Type | Quand | Rendu tableau de bord |
|------|--------|---------------------|
| `notification` | Mise à jour de statut générique (défaut) | Carte grise |
| `question` | L'utilisateur doit répondre avant que l'agent ne procède | Carte avec input de réponse |
| `digest` | Résumé périodique (Mentor hebdomadaire, Capitano batch) | Carte repliable |
| `alert` | Anomalie bloquante (rate limit, erreur de livraison de candidature) | Carte rouge |

## Chemin de fallback

```
agent ──► jht-notify-user
              │
              ├──► INSERT pending_user_messages (delivered_via=NULL, kind, body)
              │
              ├──► try jht-telegram-send (timeout 25s, best-effort)
              │
              │      ┌─ succès ─► UPDATE delivered_via='telegram'
              │      │
              │      └─ échec/timeout/non-configuré ─► UPDATE delivered_via='web'
              │
              └──► stdout: "<id> via=<channel>"

                              ▼ (processus séparé, daemon cloud-sync)

         jht cloud push  ──► /api/cloud-sync/push  ──► Supabase
                                                          │
                                                          ▼
                                          dashboard /(protected)/dashboard
                                          affiche les messages pas encore ack
```

## Modes de défaillance

| Exit | Cause | Récupération |
|------|-------|----------|
| 0 | Ligne insérée ; livraison best-effort (voir `via=` sur stdout) | — |
| 1 | Arguments invalides (body vide, --kind inconnu) | Corriger les flags |
| 2 | DB non trouvée ou INSERT échoué | Vérifier `$JHT_DB` / `$JHT_HOME/jobs.db` ; le schéma doit être V5+ |

Exit 0 avec `via=web` N'EST PAS une erreur : c'est le comportement attendu quand Telegram n'est pas actif. Le message est en sécurité dans la file.

## Marqueur prompt-injection (décision 2026-05-13 § 6)

Quand l'utilisateur répond via le tableau de bord (remplit `user_reply` sur une ligne avec `delivered_via='web'`), c'est à vous de lire cette réponse — Telegram ne verra rien. Pour cela utilisez la skill **`user-reply-check`** à chaque itération de votre boucle : elle retourne les réponses que l'utilisateur vous a laissées dans le tableau de bord et les marque comme vues pour que vous ne les traitiez pas deux fois. Quand vous répondez, utilisez `jht-notify-user --no-telegram` pour rester dans le canal web (envoyer un écho sur Telegram d'une conversation web confond l'utilisateur).

## Voir aussi

- `user-reply-check` — l'autre moitié du pattern. Lire les réponses arrivées via le tableau de bord dans votre boucle.
- `telegram-send` — appelé sous le capot par `jht-notify-user` ; l'utiliser directement uniquement si vous savez déjà que Telegram est le bon canal (ex. réponse à un `[TG]` entrant).
- `chat-web` (`jht-send`) — pour le fil chat-agent sur le tableau de bord.
- `agents/_manual/db-schema.md` § `pending_user_messages` — schéma de la file + index.
