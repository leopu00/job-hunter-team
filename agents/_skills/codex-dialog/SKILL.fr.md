---
name: codex-dialog
description: Distinguer un dialogue de la CLI Codex gérée d'un worker mort avant de le récupérer ou de le remplacer.
---
<!-- @translation: fr, ai-translated 2026-11-07 -->

Utilise cette compétence uniquement pour les agents de la **CLI terminal Codex**, pas du runtime API.
Une notification `[CODEX-DIALOG]` indique un état distinct, pas la mort du worker.
Le watchdog reconnaît le rappel de modèle affiché, conserve le modèle actuel
et indique si la récupération a réussi. Il ne remplace pas la session, n'accepte
pas les demandes de confiance, ne change pas de modèle, ne met pas la CLI à jour et n'accorde aucun accès.

Lis la dernière observation enregistrée sans envoyer de saisie :

```bash
python3 /app/shared/skills/codex_dialog.py status SCORER-1
```

`last_observation` et `at` décrivent le dernier contrôle, sans garantir que
l'agent est toujours actif. `codex_dialog_recovered` signifie que le même volet
est revenu à la zone de saisie ou au travail ; `codex_dialog_ready` enregistre une
observation saine ultérieure sans l'attribuer à une récupération automatique.
`pending`, `timeout`, `changed`, `unrecognized` et `io_error` nécessitent une
inspection. Les codes complets commencent par `codex_dialog_`.

Informe l'utilisateur de cet état avant de décider une récupération manuelle ou un remplacement.
Ne clone, n'arrête et ne remplace pas le worker en silence. Pour un dialogue non
résolu, demande un diagnostic au Dottore et explique l'action proposée. N'envoie
jamais Enter à l'aveugle et ne choisis pas de modèle suggéré. Les messages ordinaires
utilisent toujours `tmux-send` et ses contrôles de disponibilité. Un quota réellement
épuisé, une connexion ou une demande de confiance ne constituent pas une récupération réussie.
