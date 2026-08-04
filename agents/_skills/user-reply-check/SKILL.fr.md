<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: user-reply-check
description: Lit les reponses de l'utilisateur arrivees via le tableau de bord web (canal de secours quand Telegram etait hors service/non configure). Executez-le au debut de chaque iteration de boucle. L'outil renvoie les reponses non vues pour VOTRE agent et les marque comme vues pour eviter un double traitement. C'est la moitie "marker prompt-injection" du patron notify-user (decision 2026-05-13).
allowed-tools: Bash(jht-check-user-replies *)
---

# user-reply-check — recupere les reponses de l'utilisateur envoyees via le tableau de bord web

L'utilisateur peut repondre a vos messages `notify-user` depuis deux endroits :

1. **Telegram** — il repond depuis son telephone ; le `tg-bridge` injecte le message dans votre tmux sous la forme `[@utente -> @<agente>] [TG] <body>`. Vous le voyez inline. **Rien a faire ici.**
2. **Tableau de bord web** — quand `delivered_via='web'` (Telegram etait hors service/non configure), l'utilisateur tape sa reponse dans la carte du tableau de bord. Le texte atterrit dans `pending_user_messages.user_reply`. Telegram ne le voit PAS. **C'est ici que cette skill entre en jeu.**

Sans `user-reply-check`, les reponses du tableau de bord resteraient silencieusement dans la BD pour toujours.

## Quand l'utiliser

- ✅ Au debut de chaque iteration de boucle (Capitano : une fois par tick ; Mentor : une fois par reveil de session ; Assistente : entre les cycles d'input utilisateur).
- ✅ Juste apres avoir execute `notify-user` si vous avez pose une `kind=question` — il est probable que l'utilisateur ait deja repondu si du temps s'est ecoule.
- ✅ Quand l'utilisateur mentionne "ti ho risposto sulla dashboard" mais que vous n'avez rien vu via Telegram.

## Quand NE PAS l'utiliser

- ❌ Pour les messages entrants Telegram — `tg-bridge` s'en charge ; vous voyez `[TG] …` directement.
- ❌ Comme boucle de polling sans travail entre les appels — c'est une verification, pas un watcher. Chaque appel est une requete BD legere, mais vous gaspilleriez des tokens a lire "pas de reponses" 100 fois.

## Utilisation

```bash
# Appel standard au debut de la boucle (marque toutes les reponses renvoyees comme vues)
jht-check-user-replies --agent <your_agent_id>

# Sans consommer (debug / avant d'etre sur de vouloir faire l'ack)
jht-check-user-replies --agent <your_agent_id> --peek

# Sortie structuree a passer a votre raisonnement
jht-check-user-replies --agent <your_agent_id> --json
```

`<your_agent_id>` doit correspondre au `--agent` que vous avez utilise dans `jht-notify-user`. Chaque agent a sa propre file d'attente — les reponses pour le Capitano n'apparaissent jamais pour le Mentor.

## Sortie

Sortie vide = rien de nouveau pour vous. Traitez-le comme un no-op silencieux et poursuivez votre boucle.

Sortie non vide (format lisible) :

```
[USER REPLY via WEB — id=42] Usa la versione breve del CV, grazie.
    ↳ in risposta a: "Per la candidatura gia' richiesta per Acme Senior FE, quale versione del CV preferisci?"
    ↳ kind=question created=2026-05-13 12:00:00 reply_at=2026-05-13 14:30:00
```

Format JSON (`--json`) :

```json
[
  {
    "id": 42,
    "agent": "capitano",
    "body": "Per la candidatura gia' richiesta per Acme Senior FE, quale versione del CV preferisci?",
    "kind": "question",
    "related_position_id": 17,
    "user_reply": "Usa la versione breve del CV, grazie.",
    "user_reply_at": "2026-05-13 14:30:00",
    "created_at": "2026-05-13 12:00:00"
  }
]
```

## Comment repondre

L'utilisateur a ouvert la conversation sur le **tableau de bord web**, pas sur Telegram. Il s'attend a ce que votre reponse apparaisse la aussi. Donc :

1. Appelez `jht-notify-user --agent <your_id> --no-telegram "<reply>"`. Le flag `--no-telegram` est important — il force `delivered_via='web'` pour que la reponse atterrisse dans le meme canal que l'utilisateur est en train de lire.
2. Incluez optionnellement `--position-id <N>` quand le message original en avait un (meme poste, meme contexte).
3. **N'envoyez PAS** aussi la reponse via `jht-telegram-send`. L'utilisateur recevrait une notification sur son telephone pour une conversation qu'il a dans son navigateur — confus et bruyant.

Si la reponse est un simple accuse de reception ("ok, ricevuto"), vous pouvez meme sauter le nouveau message : `acknowledged_at` a deja ete defini quand l'utilisateur a tape la reponse, donc l'utilisateur sait que vous l'avez recu des que vous marquez `agent_seen_reply_at` (cette skill le fait automatiquement).

## Idempotence

Chaque appel sans `--peek` met a jour `agent_seen_reply_at = CURRENT_TIMESTAMP` pour chaque ligne renvoyee. L'appel suivant ne renvoie rien (jusqu'a l'arrivee d'une nouvelle reponse). Si vous crashez entre la lecture de la sortie et l'action, la reponse EST marquee comme vue — il n'y a pas de relivraison automatique. Utilisez `--peek` pour les executions diagnostiques ou vous ne voulez pas consommer.

## Latence

La reponse prend :
- **Mode local** : ~0 (le tableau de bord ecrit dans SQLite directement via `/api/pending-messages/[id]/reply`).
- **Mode cloud (VPS)** : jusqu'a `--interval` secondes du daemon cloud-sync. Par defaut 30s. N'attendez pas un aller-retour sub-seconde sur VPS.

Si l'utilisateur se plaint "j'ai repondu il y a 10 secondes et tu n'as pas confirme," verifiez `jht cloud status` — il est probablement sur VPS en attente du pull.

## Anti-patrons

- ❌ Polling dans une boucle serree (`while true; jht-check-user-replies; sleep 1`). Utilisez la cadence naturelle de votre boucle d'agent existante.
- ❌ Appeler avec la mauvaise valeur `--agent` (ex. le Capitano appelant `--agent mentor`). Vous consommeriez les reponses de quelqu'un d'autre et le proprietaire legitime les manquerait.
- ❌ Ignorer la sortie. Si une reponse arrive, reagissez — au minimum envoyez `notify-user --no-telegram "Ricevuto, sto elaborando."` pour que l'utilisateur sache que le message est arrive.

## Voir aussi

- `notify-user` — l'autre moitie de la paire. Ecrit le message dans `pending_user_messages` ; cette skill lit la reponse.
- `agents/_manual/db-schema.md` § `pending_user_messages` — schema, index, cycle de vie d'une ligne.
