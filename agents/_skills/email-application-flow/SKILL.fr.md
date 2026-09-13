<!-- @translation: fr, ai-translated 2026-09-13 -->
---
name: email-application-flow
description: Comment le CLOSER envoie par e-mail une candidature autorisée avec `email_application.py` quand `apply_flow.py` répond `email_channel` (le contrôle Apply est un lien `mailto:`) — inspect, preflight, draft, send, status ; le gate revérifié juste avant le transport ; `send_started` avant la commande irréversible ; le reçu sans lequel `applied` n'est jamais écrit. Utilise-la pour chaque position dont le flux se termine en `email_channel`. Appartient au CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/email_application.py *)
---

# email-application-flow — un e-mail, un reçu, aucun nouvel essai à l'aveugle

Utilise-la **uniquement** pour une position de la dernière queue dont
`apply_flow.py` a répondu `email_channel` (exit 4). Le flux navigateur a laissé le
`mailto_href` brut dans son checkpoint ; cette skill le lit. Tu n'ouvres jamais de
client mail, tu n'écris jamais d'e-mail à la main, tu ne copies l'adresse nulle part.

```bash
python3 /app/shared/skills/email_application.py send --position-id "$PID" --json
```

`send` exécute tout dans l'ordre et s'arrête au premier problème. Les autres
commandes servent à lire, pas à contourner un arrêt :

| Commande | Ce qu'elle fait |
|---|---|
| `inspect` | lit et analyse le lien mailto (To, CC, objet, corps) |
| `preflight` | inspect + gate + plafond quotidien + transport + CV + lettre de motivation + faits obligatoires |
| `draft` | preflight + le brouillon déterministe ; rien n'est envoyé |
| `send` | draft + gate à nouveau + `send_started` + transport + reçu + `applied` |
| `status` | la dernière tentative et son état, en lecture seule |

`--dry-run` s'arrête avant le transport et ne change rien sur la candidature.

## Ce que la commande garantit

- **Le flag est l'autorisation.** Le gate décide au preflight et à nouveau juste
  avant le transport. Un flag révoqué ou un plafond atteint entre-temps signifie
  que rien ne part (`denied`).
- **Rien n'est inventé.** Les destinataires viennent uniquement du lien. Le nom,
  l'e-mail de contact et tout fait demandé par l'annonce (disponibilité,
  prétentions salariales) viennent uniquement du profil du candidat ; s'il en manque
  un, c'est `required_fact_missing`.
- **Le CV est toujours joint**, après contrôle de la taille, du PDF et du hash. Une
  lettre de motivation n'est jointe que si l'annonce la demande ; s'il n'y en a pas,
  elle est demandée au Scrittore par la demande d'écriture habituelle et le flux
  s'arrête.
- **Une lettre au plus.** `send_started` est enregistré avant que le serveur ne
  reçoive le message. Ensuite, un timeout ou une réponse peu claire devient
  `send_outcome_unknown` : jamais retenté, pas même par un nouveau passage.
- **`applied` seulement après acceptation**, avec `applied_via = agent_closer_email`,
  écrit par la commande elle-même après l'enregistrement du reçu.

## Lire le résultat

Une ligne JSON : `state`, `reason`, `detail`, plus les données.

| `state` | Exit | Signification | Ce que tu fais |
|---|---|---|---|
| `sent` | 0 | accepté par le serveur, reçu enregistré, candidature enregistrée | position suivante |
| `draft_ready` | 0 | dry run : brouillon et pièces jointes valides, rien n'est parti | position suivante |
| `denied` | 1 | le gate a refusé (`flag_revoked`, `gate_mode_changed`, `daily_cap_reached`, `duplicate_attempt`) | position suivante ; ne jamais retenter |
| `blocked_human` | 1 | un humain est nécessaire ; l'utilisateur a été prévenu | position suivante ; ne jamais retenter |
| `send_outcome_unknown` | 3 | l'e-mail est peut-être parti | position suivante ; ne jamais retenter |
| `receipt_incomplete` | 3 | accepté, mais le reçu ou l'enregistrement est incomplet ; avec certains destinataires refusés, la lettre est probablement arrivée | position suivante ; ne jamais retenter |
| `error` | 2 | base de données, profil ou checkpoint illisible | arrêt : `[BLOCKED]` au Capitano |

⚠️ Ces exit codes ne sont **pas** ceux de `apply_flow.py` (là-bas `denied` vaut 1 et
`blocked_human` vaut 3). Décide d'après `state`, jamais d'après le nombre.

## Motifs de `blocked_human`

| `reason` | Cause typique |
|---|---|
| `transport_missing` | aucun transport e-mail configuré, ou le fichier du secret manque ou n'est pas en 0600 |
| `auth_failed` | le serveur mail a refusé les identifiants |
| `sender_unverified` | l'adresse d'expéditeur n'est ni le compte authentifié ni un expéditeur vérifié |
| `mailto_missing` | aucun checkpoint navigateur en `email_channel` pour cette position : lance d'abord `apply_flow.py` ; la page n'est jamais lue pour y chercher une adresse |
| `recipient_ambiguous` / `mailto_invalid` | zéro ou plusieurs destinataires, un en-tête interdit, CR/LF dans un en-tête ; aussi les local parts entre guillemets et les adresses internationales (IDN), non prises en charge |
| `recipient_refused` | le serveur a refusé les destinataires avant tout envoi : une nouvelle tentative, après action de l'utilisateur, n'est pas un doublon |
| `required_fact_missing` | l'annonce demande un fait que le profil n'indique pas |
| `cv_missing` | aucun CV PDF lisible pour cette candidature |
| `cover_letter_required` | l'annonce demande une lettre de motivation ; le Scrittore a été sollicité |

Ce que tu fais, toujours pareil :

1. **Rien sur cette position.** La commande a déjà prévenu l'utilisateur une fois.
2. **Ne la retente pas.** La queue la retient (`email_blocked_human`,
   `email_send_outcome_unknown`, ...) jusqu'à ce que l'utilisateur agisse.
3. **Passe à la position suivante** de la queue.

## Jamais

- envoyer un e-mail autrement qu'avec cette commande ;
- lancer `send` sur une position qui n'est pas dans la dernière lecture de la queue ;
- retenter après `send_started`, `send_outcome_unknown` ou `receipt_incomplete` ;
- écrire toi-même `applied`, `applied_via` ou `apply_requested` ;
- coller le mot de passe SMTP, ou le demander à l'utilisateur dans le chat.

## Vérifier ensuite

```bash
python3 /app/shared/skills/email_application.py status --position-id "$PID" --json
```

`state: sent` avec un `message_id` = la commande a enregistré l'envoi par e-mail.
