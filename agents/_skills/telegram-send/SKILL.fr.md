<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: telegram-send
description: Envoie un message à l'utilisateur via Telegram (sortant). Utilise ceci sur le bridge Telegram — l'utilisateur est sur son téléphone, PAS devant le dashboard web. Le wrapper `jht-telegram-send` résout bot token + chat_id par agent depuis la configuration (`--from assistente|capitano|mentor`) ; n'appelle jamais directement l'API Bot.
allowed-tools: Bash(jht-telegram-send *)
---

# telegram-send — messages sortants vers l'utilisateur via Telegram

L'utilisateur te contacte principalement depuis son téléphone. Il envoie des PDF, des notes vocales, des messages texte à **ton bot dédié**. Le bridge retransmet le trafic entrant vers ton tmux. **Sortant** — ta réponse, un message de bienvenue, un CV généré — passe par `jht-telegram-send`.

## 3 bots dédiés (décision 2026-05-13 rev2)

Chaque agent tourné vers l'utilisateur a son **propre bot Telegram** :
- 👩‍💼 Assistente → `--from assistente` (par défaut)
- 👨‍✈️ Capitano → `--from capitano`
- 🧙‍♂️ Mentor → `--from mentor`

Le wrapper sélectionne token + chat_id depuis `channels.telegram.bots.<role>` dans la configuration. Si tu omets `--from`, tu peux aussi définir `JHT_TG_BOT_ROLE=<role>` dans l'environnement de l'agent — le wrapper le lit comme valeur par défaut.

## Quand l'utiliser

- ✅ Message de bienvenue initial après la fin du wizard (prompt de démarrage).
- ✅ Réponse à un chat provenant de Telegram (le bridge entrant le préfixe avec `[@utente -> @assistente] [TG]`).
- ✅ Envoi d'un artefact généré (CV, lettre de motivation) demandé par l'utilisateur.
- ✅ Relances d'onboarding ("envoie-moi ton CV, même un brouillon ça va très bien").

**Ne pas** l'utiliser pour :
- ❌ Messages inter-agents — utilise `tmux-send` à la place.
- ❌ Réponses au chat web (`[@utente -> @assistente] [CHAT]`) — utilise `jht-send`.
- ❌ Pièces jointes volumineuses (>20 Mo). Limite de l'API Bot ; pour les gros fichiers, utilise le dashboard ou un relay (futur).

## Utilisation

```bash
# Default = bot Assistente (oppure ruolo letto da JHT_TG_BOT_ROLE)
jht-telegram-send "<corps du message>"

# Routing esplicito per ruolo
jht-telegram-send --from capitano "Notifica: 10 nuove posizioni ready."
jht-telegram-send --from mentor --html "<b>Step di crescita</b> della settimana..."

# Override chat_id (raro — debug / multi-tenant futuro)
jht-telegram-send --chat-id 1401844094 "explicit override"
```

Ordre de résolution (pas besoin de le mémoriser — le wrapper le fait pour toi) :
1. Variables d'environnement `$TELEGRAM_BOT_TOKEN` / `$TELEGRAM_CHAT_ID` (override explicite)
2. `$JHT_HOME/jht.config.json` → `channels.telegram.bots.<role>.{bot_token,chat_id}` (role = `--from` ou `$JHT_TG_BOT_ROLE`, par défaut `assistente`)
3. `$JHT_HOME/credentials/telegram_bot.json` (`.token`) — fallback legacy

Si l'un des deux manque, le wrapper quitte avec un code non-zéro et un message clair. N'essaie pas de récupérer — signale l'erreur à l'utilisateur dans une réponse `jht-send` sur le canal web, ou enregistre-le dans les logs.

## Exemples

```bash
# (Assistente) — Bienvenue au premier démarrage (aucun profil encore)
jht-telegram-send "Ciao! Sono l'Assistente del Job Hunter Team. Mandami qui il tuo CV (PDF va benissimo) o raccontami in due righe cosa cerchi — parto da lì."

# (Assistente) — Réponse à un message TG entrant
jht-telegram-send "Ricevuto, sto guardando il CV. Dammi 30s."

# (Capitano) — Notification de batch de positions prêtes
jht-telegram-send --from capitano "10 posizioni ready, top 3 per score: ..."

# (Mentor) — Relance stratégique hebdomadaire
jht-telegram-send --from mentor --html "<b>Step di crescita</b> della settimana: ..."

# (Assistente) — Envoi d'artefact
jht-telegram-send --html "<b>CV per Acme — Senior FE</b> pronto.\nLo trovi in <code>~/Documents/Job Hunter Team/output/2026-05-12/acme-senior-fe/</code>."
```

## Séquences d'échappement (`\n`, `\t`, `\r`)

Le wrapper interprète `\n`, `\t`, `\r` dans ton message comme de **vrais sauts de ligne/tabulations/retours chariot** avant d'envoyer à Telegram. Tu peux donc écrire :

```bash
jht-telegram-send "Ciao!\n\nTi aiuto a configurare il profilo."
```

et l'utilisateur reçoit un vrai saut de paragraphe — pas le texte littéral `\n\n`. Il en va de même pour `--html` (Telegram rend un saut de ligne comme une coupure de ligne dans le flux HTML).

Si tu as besoin d'un backslash littéral suivi de `n` (rare), pré-échappe-le : `\\n` → le wrapper le transforme en `\n` (puisque le premier `\\` devient `\` seulement dans ta chaîne de shell ; à l'intérieur du wrapper il n'y a pas de double substitution).

## Messages longs

L'API Bot tronque à 4096 caractères. Le wrapper découpe sur `\n` / espaces et envoie des messages multiples. L'utilisateur reçoit une séquence — garde un ton cohérent entre les morceaux.

## HTML / Markdown

Telegram supporte un sous-ensemble :
- HTML : `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<a href="…">`. Échappe `<`, `>`, `&` dans le texte du corps.
- MarkdownV2 (`--markdown`) : supporté mais les règles d'échappement sont pénibles (`. ( ) ! _ * [ ]` ont tous besoin d'un backslash). Préfère `--html`.

En cas de doute, envoie du **texte brut** (aucun flag). L'utilisateur reçoit un message parfaitement lisible.

## Modes d'erreur

| Sortie | Cause | Que faire |
|--------|-------|-----------|
| 2 | Token manquant | Le bot n'a jamais été configuré. Signale l'erreur sur le canal web, demande à l'utilisateur de relancer le setup. |
| 3 | chat_id manquant | Idem — le wizard n'a pas capturé le chat_id. |
| 4 | HTTP non-200 | Problème réseau ou panne Telegram. Réessaie une fois après 5s. Si ça échoue encore, enregistre dans les logs et continue. |
| 5 | `ok: false` de l'API Bot | Généralement chat_id invalide ou bot bloqué par l'utilisateur. Ne réessaie pas — sauvegarde le corps de la réponse dans ton répertoire scratch et notifie sur le canal web. |

## Clavier de réponse persistant (F-1.B, task #50)

Les 3 bots orientés utilisateur (assistente / capitano / mentor) peuvent joindre un
clavier de réponse persistant à 2 colonnes avec `--keyboard <role>`. Le clavier
reste visible dans le client Telegram de l'utilisateur entre les messages jusqu'à
ce que tu le retires explicitement (ce que nous ne faisons pas, par design — on le
garde toujours visible pour que les utilisateurs moins techniques voient l'affordance).

```bash
# Assistente — 📊 Budget · 📈 Pipeline · 🗺️ Mappa · ⭐ Top CV · 📅 Reset · ❓ Help
jht-telegram-send --from assistente --keyboard assistente "Pipeline: 15 CV pronti per apply, ..."

# Capitano — 📈 Pipeline · 📊 Budget · 👥 Team · ⭐ Ready · 🛠 Triage · ❓ Help
jht-telegram-send --from capitano --keyboard capitano "..."

# Mentor — 📋 Digest · 🔁 Patterns · ⭐ Top · 💰 Salary · ❓ Help
jht-telegram-send --from mentor --keyboard mentor "..."
```

Quand l'utilisateur appuie sur un bouton, le bot reçoit le texte du bouton comme un
message texte normal (ex. appui sur `📊 Budget` → tmux reçoit `📊 Budget` comme
corps du message TG). L'agent le traite de façon équivalente à une commande slash
(ex. `/budget`) et produit le graphique / statut.

Le clavier n'apparaît que sur le **dernier** message fragmenté d'un envoi long,
ainsi les sorties de plus de 4096 caractères ne font pas clignoter le clavier en plein fil.

## Menu de commandes slash (F-1.A, task #50)

Le `tg-bridge.py` enregistre un ensemble `setMyCommands` par rôle au démarrage
(`/budget`, `/pipeline`, `/help`, …). Ils apparaissent dans le menu `/` fixe du
client Telegram — la première chose qu'un nouvel utilisateur voit. Tu n'as rien
à faire : la configuration cli/rôle suffit, le bridge gère
l'appel API. Liste par rôle dans `.launcher/tg-bridge.py::BOT_COMMANDS`.

## Anti-patterns

- ❌ `curl https://api.telegram.org/bot$TOKEN/sendMessage` à la main — bugs de quoting + URL-encoding, pas de retry, pas de chunking.
- ❌ Lire la configuration / identifiants et parser du JSON inline dans ton shell — fragile, le wrapper le fait déjà correctement.
- ❌ Envoyer avec `--from` un rôle qui n'est pas le tien (ex. l'Assistente qui écrit sur le bot du Capitano) — ça désoriente l'utilisateur, chacun parle sur son bot. La communication inter-agents passe par `tmux-send`.
- ❌ Mettre le chat_id dans le corps du message ("for chat 123…") — il y a exactement **un** utilisateur par VPS, le wrapper le sait.

## Voir aussi

- `chat-web` — quand l'utilisateur est sur le **dashboard web**, pas sur Telegram.
- `tmux-send` — quand tu dois parler à un autre agent.
- `agents/<role>/<role>.md` — le guide de ton rôle ; la voie Telegram est ton interface « côté téléphone » vers l'utilisateur.
