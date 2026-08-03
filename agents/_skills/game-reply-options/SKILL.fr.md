<!-- @translation: fr, ai-translated 2026-08-03 -->
---
name: game-reply-options
description: "Propose 2 à 5 boutons de réponse cliquables, propres au contexte, dans le chat du jeu JHT quand ils facilitent vraiment la prochaine décision de l'utilisateur. À réserver à un choix restreint et limité ; sinon, réponds normalement avec jht-send. Ne t'en sers jamais comme d'un arbre d'onboarding figé."
allowed-tools: Bash(jht-reply-options *)
---

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
