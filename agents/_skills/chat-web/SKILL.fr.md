<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: chat-web
description: Répondre à l'utilisateur quand il vous écrit depuis le chat web JHT. L'utilisateur vous contacte avec le préfixe `[@utente -> @capitano] [CHAT] <corps>` ; répondez UNIQUEMENT avec `jht-send` — n'écrivez jamais dans `chat.jsonl` à la main (l'échappement shell casse la ligne JSON et le frontend supprime silencieusement le message, l'utilisateur ne voit rien tandis que vous pensez avoir répondu). Utilisez cette skill pour chaque message `[CHAT]` ; ne l'utilisez PAS pour le trafic inter-agents (c'est `tmux-send`).
allowed-tools: Bash(jht-send *)
---

# chat-web — protocole utilisateur ↔ Capitano

L'utilisateur n'est **pas** dans une session tmux. Il écrit depuis l'interface web. Le frontend tague le message et le dépose dans votre panneau tmux. Pour répondre, vous écrivez une seule ligne JSON dans `$JHT_AGENT_DIR/chat.jsonl` ; le frontend suit ce fichier et affiche des bulles dans le panneau de chat.

Vous n'écrivez pas le JSON. Le wrapper `jht-send` le fait pour vous, avec horodatage + flag `done` + validation post-écriture. Utilisez-le. Toujours.

## Comment reconnaître un `[CHAT]` entrant

```
[@utente -> @capitano] [CHAT] <ce que l'utilisateur a tapé>
```

- L'enveloppe est identique aux messages inter-agents (même format `[@from -> @to]`) mais le type `[CHAT]` et l'auteur `@utente` le rendent sans ambiguïté.
- L'utilisateur est **un humain, le propriétaire du profil** — pas un agent. Il n'y a pas de `tmux send-keys` que vous pouvez utiliser pour répondre : sa session n'existe pas.
- Répondez au **corps**, pas à l'enveloppe. L'utilisateur n'a pas tapé le préfixe ; le frontend l'a ajouté.

> ⚠️ Mode de défaillance courant la première fois que vous voyez ceci : vous lisez le préfixe et pensez "je vais répondre via `jht-tmux-send` à l'utilisateur". `jht-tmux-send UTENTE ...` retourne `exit 2` (session inexistante). Ne commencez pas à déboguer — rappelez-vous simplement que `[CHAT]` ⇒ `jht-send`. Toujours.

## ⚠️ L'utilisateur N'EST PAS technique — pas de terminal, pas de CLI, pas de slash-commands

Un message `[CHAT]` arrive depuis l'**app desktop** (ou Telegram). L'utilisateur
**n'a pas** de terminal, ni la CLI de Claude Code, ni `/mcp`, ni slash-commands, ni
accès aux fichiers. Ce n'est pas un développeur. **JAMAIS** lui dire de :

- exécuter `/mcp`, `/config` ou n'importe quelle slash-command,
- ouvrir un terminal / lancer une commande CLI / éditer un fichier / "autoriser un outil",
- faire quelque chose que tu pourrais faire toi-même.

Dire à un utilisateur desktop « tape `/mcp` dans le terminal » est une impasse — il
ne peut pas. Si une tâche requiert une capacité que tu n'as pas câblée, **résous-la
toi-même avec du code** au lieu de renvoyer le travail à l'utilisateur. Tu es
l'équipe ; l'utilisateur est le client. Débrouille-toi.

### Exemple : envoyer un e-mail — tu n'as PAS besoin d'un outil MCP/Gmail
L'équipe a déjà une boîte configurée. Envoie avec le script : il lit le compte
lui-même et n'affiche que `{"ok": true, ...}` ou un code de motif.

```bash
printf '%s\n' "<body>" > /tmp/mail-body.txt
python3 /app/shared/skills/email_monitor.py send --to "<recipient>" --subject "<subject>" --body-file /tmp/mail-body.txt
```

**N'ouvre jamais, ne fais jamais `cat` ou `json.load` et n'affiche rien sous `$JHT_HOME/credentials/`**,
et ne mets jamais de mot de passe dans un script, un chat ou un log : le script
est le seul à toucher le compte. `"reason": "not_configured"` signifie qu'aucune
boîte n'est encore configurée : dis à l'utilisateur de l'enregistrer avec
`jht mail setup` sur l'ordinateur où tourne l'équipe.

La réponse dit ce qui s'est passé :
- `"status": "pending_user_approval"` — l'email est un **brouillon** qui attend
  l'utilisateur : il ne part que quand il l'approuve (`jht mail drafts`, puis
  `jht mail approve <id>`). Dis-le-lui ainsi, avec l'id du brouillon ; ne dis
  jamais qu'il a été envoyé.
- `"status": "sent"` — seulement pour un mail vers la boîte de l'utilisateur lui-même : réponds « C'est fait, envoyé ✅ ».

Jamais « va autoriser Gmail ».

### Si tu as vraiment besoin d'une slash-command / d'un outil dans TA session
Tu peux piloter ta propre session — ne le demande pas à l'utilisateur :

- **Auto-injecte**-la dans ta propre session tmux :
  `jht-tmux-send <TA_SESSION> '/mcp'` (puis un Enter séparé), ou
- **demande à un autre agent** de l'injecter pour toi : p. ex. l'Assistant demande
  au Capitaine (`jht-tmux-send CAPITANO '...injecte /mcp dans ASSISTENTE...'`) et le
  Capitaine exécute `jht-tmux-send ASSISTENTE '/mcp'`. L'utilisateur n'est jamais impliqué.

## Commandes de réponse

```bash
jht-send 'Réponse finale qui clôt le tour.'
jht-send --partial 'Je m\'en occupe…'   # point de contrôle en cours de tour, garde le tour ouvert
```

Règles :
- **Un `[CHAT]` ⇒ au moins un `jht-send`. Sans exception.** Ne rien écrire laisse l'utilisateur face à un chat qui semble gelé.
- **Le message de clôture du tour n'a PAS de `--partial`.** Si vous l'oubliez, le frontend garde les points de saisie indéfiniment (jusqu'à un timeout de secours ~10 min plus tard).
- **Guillemets** : passez le corps comme un seul argument positionnel. Les guillemets simples préservent `$`, `"`, emoji, accents verbatim. Pour un corps contenant un `'` littéral, utilisez des guillemets doubles (`jht-send "pas de problème"`) — mais à l'intérieur de `"..."` le shell développera `$var`, donc attention.
- **Multi-ligne** : bash `$'ligne1\nligne2'`, ou utilisez `\n` dans la chaîne et laissez Python le préserver.

## Quand utiliser `--partial`

Utilisez-le chaque fois qu'une opération destinée à l'utilisateur prendra plus de ~3 secondes et que vous n'avez pas encore la réponse. Sans `--partial` entre le message utilisateur et la réponse finale, le frontend masque les points de saisie et le chat semble mort.

Pattern :
```
[CHAT] arrive
   ↓
jht-send --partial 'Je regarde — un instant…'
   ↓
(faire le travail : db_query, capture-pane, analyse, …)
   ↓
jht-send 'Voici ce que j'ai trouvé : …'   ← pas de --partial = clôture le tour
```

Si une seule opération dépasse ~30-45s sans signal, envoyez un autre point de contrôle `--partial`. L'utilisateur ne doit jamais rester sans signal plus longtemps que cela.

## Exemples (Capitano ↔ utilisateur)

```bash
# Répondre à une question sur l'état du pipeline — rapide, tir unique
jht-send 'Pipeline à 132 positions : 18 nouvelles, 47 vérifiées, 31 scorées, 28 prêtes. Deux scrittore actifs.'

# Analyse longue — point de contrôle, puis clôture
jht-send --partial 'Je récupère les stats et les 50 dernières revues — un instant…'
# (exécuter db_query.py stats, db_query.py applications --critic-score-max 5)
jht-send $'Voici la situation :\n\n• Pipeline sain côté découverte.\n• Scrittore bloqués sur 4 positions avec score moyen 3.2 → je les mets en pause et je réouvre le triage.'

# Clôturer le tour après avoir appliqué une demande utilisateur
jht-send 'Fait. Un Analista supplémentaire spawné, config de throttle enregistrée dans le log.'
```

## Anti-patterns (ce qu'il NE FAUT PAS faire)

- ❌ `echo '{"text":"...","ts":'$(date +%s.%N)'}' >> $JHT_AGENT_DIR/chat.jsonl` — explose sur les guillemets/`$`/emoji, produit du JSON invalide, le frontend supprime silencieusement la ligne.
- ❌ `cat << 'EOF' >> chat.jsonl ... EOF` — désactive l'interpolation `$`, l'horodatage finit comme chaîne littérale.
- ❌ `python3 -c "import json; ..."` ad-hoc — même fragilité que le heredoc shell.
- ❌ Répondre via `jht-tmux-send UTENTE ...` — il n'y a pas de session `UTENTE`. L'utilisateur est dans le frontend web.
- ❌ Répondre au `[CHAT]` avec `jht-send` **et** renvoyer le même contenu avec `jht-notify-user`. Depuis que la voie du chat est unifiée, les deux écrivent dans la MÊME conversation : l'utilisateur lit ta réponse deux fois, et personne ne l'enlève en aval — la voie ne sait pas distinguer un doublon de deux tours identiques par hasard. Un message, un seul outil.
- ❌ Envoyer une réponse finale avec `--partial` — les points de saisie restent bloqués sur l'écran de l'utilisateur.
- ❌ Plusieurs appels `jht-send` (sans `--partial`) pour ce qui devrait être un seul message — chaque appel non-partial apparaît comme une bulle séparée.

## Envoyer vers un canal non-défaut (rare)

```bash
jht-send --agent capitano 'note système routée via mon canal'
```

Utile quand vous voulez loguer un message système dans votre propre canal de chat (ex. une automatisation notant qu'elle a agi au nom de l'utilisateur). Pour les réponses quotidiennes, vous n'avez jamais besoin de ce flag.

## Pourquoi `jht-send` et pas du shell brut

Historique (à ne pas répéter) : les agents ont essayé `echo`-dans-jsonl et les heredocs `cat <<EOF`. Les deux ont fini en modes fragiles — le premier explose sur les guillemets/`$`, le second gèle l'horodatage comme chaîne littérale. Résultat : JSON invalide que le frontend saute. L'utilisateur ne voit rien ; vous pensez avoir répondu. `jht-send` supprime entièrement le mode de défaillance — le corps ne repasse jamais par un parseur shell après le premier niveau de guillemets.

## Voir aussi

- `tmux-send` — pour les messages vers **d'autres agents** (protocole différent, canal différent).
- `agents/assistente/assistente.md` — l'Assistente a la version la plus approfondie de ce protocole (flux d'onboarding multi-étapes avec points de contrôle obligatoires) ; à lire uniquement si vous héritez un jour des fonctions de l'Assistente.
