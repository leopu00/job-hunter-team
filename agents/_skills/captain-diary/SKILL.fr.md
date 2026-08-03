<!-- @translation: fr, ai-translated 2026-08-03 -->
---
name: captain-diary
description: "Journal de passation quotidien pour le Capitano. Le Capitano est redémarré souvent (context-refresh, nouvelle fenêtre de travail, reboot) et perd sinon les leçons de pacing durement acquises dans la journée — répétant les mêmes erreurs (p. ex. 3 Scout d'un coup → un pic impossible à freiner → 5 h au ralenti pour rembourser la dette). Au démarrage, lis les notes de la veille (handoff) et AJOUTE une note d'une ligne chaque fois que quelque chose de significatif se produit dans la journée (une décision de scaling, un pic, un kill, une leçon). Un fichier append-only par jour."
allowed-tools: Bash(python3 /app/shared/skills/captain_diary.py *)
---

# captain-diary — la passation entre Capitanos

Un fichier par jour dans `$JHT_HOME/logs/captain-diary-YYYY-MM-DD.md`, en append-only.
Son rôle est de t'empêcher de **repartir de zéro à chaque redémarrage** : les leçons
de pacing d'aujourd'hui sont transmises au Capitano de demain.

## Au réveil (TOUJOURS, avant de travailler)

Lis les notes laissées par le Capitano de la veille :

```bash
python3 /app/shared/skills/captain_diary.py handoff
```

La commande affiche les notes d'**hier** (ou celles du dernier jour travaillé)
ainsi que ce qui est déjà consigné **aujourd'hui**. Tu hérites des leçons →
**ne répète pas les mêmes erreurs**. S'il n'y a rien, tu es le premier :
commence à consigner.

## Pendant la journée — consigne les événements SIGNIFICATIFS

Une ligne, chaque fois qu'il se passe quelque chose qui porte une leçon. PAS un
journal de tout : seulement ce dont le Capitano de demain aurait besoin.

```bash
python3 /app/shared/skills/captain_diary.py add "20:05 — 3 Scout d'un coup : pic impossible \
à freiner en 15 min, 5 h au ralenti pour rembourser la dette. Leçon : max 1 Scout puis \
30 min d'observation (C-02)."
```

Ce qui vaut la peine d'être consigné :
- les décisions de scaling qui ont mal tourné (ou bien tourné) — combien de workers, quel throttle, ce qui s'est passé ;
- un pic que tu n'as pas pu freiner et comment tu t'en es sorti ;
- un kill et pourquoi ;
- un pattern qui s'est dégagé (p. ex. « le Scout sur le site X consomme deux fois plus ») ;
- tout ce qui, si tu le savais demain, éviterait une erreur.

## Revoir uniquement aujourd'hui

```bash
python3 /app/shared/skills/captain_diary.py today
```

## Règle

- Le journal est le **témoin** que l'on se passe : lis-le au démarrage, alimente-le dans la journée.
- Les notes doivent être **courtes et actionnables** (un fait + la leçon), pas un log verbeux.
- L'horodatage est ajouté par l'outil : tu n'écris que le fait et la leçon.
