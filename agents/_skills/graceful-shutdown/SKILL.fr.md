<!-- @translation: fr, ai-translated 2026-07-30 -->
---
name: graceful-shutdown
description: Clôture la journée de travail à la demande de l'utilisateur. Déclenchée par un message `[SHUTDOWN]` de @utente. L'utilisateur ferme l'application et chaque agent est sur le point d'être arrêté en pleine tâche ; avant que cela n'arrive, chacun doit noter où il en est, pour que demain l'équipe reprenne au lieu de repartir de zéro. Arrête les agents un par un, puis crée le flag qui permet à l'application de se fermer. N'utilise JAMAIS ceci pour des décisions de pacing courantes — cela met fin à toute l'équipe.
allowed-tools: Bash(jht-tmux-send *), Bash(node /app/cli/bin/jht.js team *), Bash(touch /jht_home/.shutdown-ready.flag), Bash(python3 /app/shared/skills/captain_diary.py *)
---

# graceful-shutdown — clôturer la journée quand l'utilisateur s'en va

L'utilisateur ferme l'application. Sans toi, les agents seraient coupés en plein
travail : un Scout au milieu d'un tour de boards, un Scrittore avec un CV à
moitié écrit. **Ton rôle est que personne ne perde le point où il en était.**

Le jeu t'a envoyé `[@utente -> @capitano] [SHUTDOWN] …` et **attend maintenant un
flag de ta part** : tant que tu ne le crées pas, la fenêtre reste ouverte et
montre à l'utilisateur combien d'agents travaillent encore.

## Procédure

1. **Demande à tout le monde de noter où il en est et de s'arrêter.** À chaque
   session vivante, envoie :

   ```bash
   jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [SHUTDOWN] Fermeture demandée par l'utilisateur. Écris dans ton agenda où tu en es (dernière board, dernière position enregistrée, ce qu'il reste à faire), puis arrête-toi. Ne commence aucun travail nouveau."
   ```

   Une ligne par agent, avec son vrai nom. Celui qui est en train d'écrire sur
   disque termine le fichier en cours : interrompre une écriture est pire que
   d'attendre quelques secondes.

2. **Note toi-même la journée** dans le journal, pour que le Capitano de demain
   reprenne le fil :

   ```bash
   python3 /app/shared/skills/captain_diary.py append "Fermeture demandée par l'utilisateur : <qui faisait quoi>"
   ```

3. **Arrête les agents** une fois qu'ils ont confirmé (ou après une attente
   raisonnable : ne fais pas patienter l'utilisateur plus de deux minutes pour un
   agent qui ne répond pas) :

   ```bash
   node /app/cli/bin/jht.js team stop --all
   node /app/cli/bin/jht.js team stop assistente
   ```

4. **Crée le flag.** C'est la dernière chose que tu fais : il dit au jeu qu'il
   peut éteindre le conteneur et quitter.

   ```bash
   touch /jht_home/.shutdown-ready.flag
   ```

## Règles

- **Le flag doit TOUJOURS être créé**, même si quelque chose s'est mal passé. Si
  tu ne le crées pas, l'utilisateur reste devant une fenêtre qui t'attend — et il
  finira par forcer la fermeture, ce que cette skill sert précisément à éviter.
- **Ne négocie pas la fermeture.** L'utilisateur a décidé : ton rôle est de la
  rendre ordonnée, pas de la discuter ni de la repousser.
- **Aucun travail nouveau** à partir du moment où tu reçois `[SHUTDOWN]` : aucun
  spawn, aucun nouveau tour, aucune montée en charge.
- Si un agent ne répond pas, note-le dans le journal et continue : mieux vaut
  perdre le point de reprise d'UN agent que de bloquer la fermeture pour tous.
