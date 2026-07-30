<!-- @translation: fr, ai-translated 2026-07-30 -->
---
name: throttle-ack
description: Signe ton reveil. TOUJOURS la PREMIERE commande de chaque reveil, avant toute autre chose, chaque fois que tu recois un message `[RIPRENDI]` apres une pause de throttle. `throttle-ack <ton-nom>` fait passer ton flag de NOTIFIED a ACTIVE. Toi seul peux le faire - le moteur ne peut pas - et c'est precisement pour cela qu'un flag reste sur NOTIFIED est la preuve qu'un agent a recu le reveil et n'a pas repondu, et pour cela que le watchdog escalade dessus. L'omettre fait passer pour bloque un agent en parfaite sante.
allowed-tools: Bash(throttle-ack *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle-ack — signe le reveil, puis retourne au travail

```bash
throttle-ack <ton-nom>
```

Premiere commande de chaque reveil. Puis retourne **immediatement a ta boucle** —
l'ack est une signature, pas un rapport.

## Pourquoi c'est toi et pas le moteur

Le moteur de throttle ecrit deux des trois etats : `IN_THROTTLE` quand tu
enregistres une pause, `NOTIFIED` quand il t'a envoye le reveil via tmux. La
derniere etape, `NOTIFIED → ACTIVE`, n'appartient **qu'a toi**.

Cette asymetrie est tout l'interet. Chaque watchdog de ce systeme partage un
angle mort : en regardant un pane tmux, `idle` et `bloque` sont indiscernables.
Avec ta signature, ils cessent de l'etre :

| flag | signification | anomalie si ca dure |
|---|---|---|
| `IN_THROTTLE` | attente legitime | non — le moteur sait combien |
| `NOTIFIED` | reveil envoye, ack attendu | **oui → escalade apres N min** |
| `ACTIVE` | tu travailles | juge sur ta production en DB |

Un flag bloque sur `NOTIFIED` n'est pas « peut-etre idle » : le reveil est arrive
et personne n'a repondu. C'est une mesure, pas une hypothese, et le watchdog
l'escalade au Capitaine.

## Les regles

- **Premiere commande, toujours.** Avant de lire ta file, avant tout outil, avant
  de repondre a qui que ce soit.
- **Puis travaille tout de suite.** Signer et rester immobile produit un faux
  « file vide » qui trompe le Capitaine et le pacing. Un reveil est un signal pour
  *travailler*.
- **Ne l'utilise pas pour ecourter une pause.** Un ack envoye pendant que ton
  minuteur tourne encore est refuse (exit 1) : si tu pouvais fermer le flag quand
  tu veux, le throttle redeviendrait une chose que tu decides.
- Tu n'as pas besoin de savoir combien de temps tu as dormi, et la commande ne te
  le dit pas.

## Exit codes

- `0` — flag sur `ACTIVE` (idempotent : signer deux fois est sans effet)
- `1` — ack **refuse** parce que ta pause n'est pas finie : ferme ton tour, le
  moteur te reveillera. Ou arguments invalides / moteur absent.

## Exemple

```
[DA @SISTEMA A @SCOUT-1] [RIPRENDI] La tua pausa è finita. PRIMO comando: `throttle-ack scout-1`...
```

```bash
throttle-ack scout-1
# THROTTLE_ACK agent=scout-1 NOTIFIED→ACTIVE
```

...et la chose suivante que tu fais est ta prochaine unite de travail.
