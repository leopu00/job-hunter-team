---
name: game-reply-options
description: "Propose 2 à 5 boutons de réponse cliquables, propres au contexte, dans le chat du jeu JHT quand ils facilitent vraiment la prochaine décision de l'utilisateur. À réserver à un choix restreint et limité ; sinon, réponds normalement avec jht-send. Ne t'en sers jamais comme d'un arbre d'onboarding figé."
allowed-tools: Bash(jht-reply-options *)
---
<!-- @translation: fr, ai-translated 2026-08-03 -->

# Options de réponse générées dans le jeu

Quand le message de l'utilisateur ouvre sur quelques suites évidentes, termine ton
tour par une question et 2 à 5 réponses générées pour ce contexte précis :

```bash
jht-reply-options --prompt 'Par quoi veux-tu commencer ?' \
  'Revoyons mes rôles cibles' 'Vérifions les lacunes de mon profil' 'Montre-moi les meilleures positions'
```

Le jeu affiche ces choix sous forme de boutons, tout en laissant la saisie libre
disponible. Un clic renvoie le texte du bouton comme un message utilisateur ordinaire.

Règles :

- Les choix sont facultatifs, propres à la conversation en cours et jamais copiés
  depuis l'onboarding rédigé hors ligne.
- Utilise 2 à 5 choix concis et complémentaires. N'offre pas un faux choix dont tu
  ne peux pas réaliser le résultat.
- `jht-reply-options` est la réponse finale de ce tour. Ne le fais pas suivre d'un
  `jht-send`, sinon les boutons disparaîtraient — à juste titre — sous la réponse plus récente.
- Pour une question ouverte ou une réponse directe, utilise `jht-send` comme d'habitude.

## Un `$` dans le texte : apostrophes simples ou stdin

Entre guillemets doubles, le shell lit `$1` et `$2` comme ses propres arguments et les remplace par rien **avant que l'outil ne démarre** : « Plus — $20/month ; Pro — $200/month » arrive chez l'utilisateur comme « Plus — 0/month ; Pro — 00/month », et personne en aval ne peut rendre les chiffres. Si le texte contient un `$` (prix, montants), écris-le entre apostrophes simples ou passe-le par stdin.

```bash
# Single quotes for the labels; the prompt from stdin: "-" reads it, the quoted delimiter keeps every $
jht-reply-options --prompt - 'Plus — $20/month' 'Pro — $100/month' <<'TXT'
Which plan do you want? Plus — $20/month; Pro — $100/month
TXT
```

Écris le `TXT` de fermeture en première colonne, seul sur sa ligne, sans espaces devant (si tu copies le retrait, le heredoc ne se ferme jamais : un texte qui finit par une ligne `TXT` est refusé, rien n'est envoyé).
