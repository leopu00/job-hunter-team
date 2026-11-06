---
name: team-pause
description: "PAUSE the team (or one agent) without shutting anything down, and resume it. Open it the moment the user says «take a break», «pause», «hold on», «stop for now», «wait until I tell you», «freeze» — or «resume», «carry on», «you can start again». A pause keeps every session ON with its context; nobody works and nothing new starts until the user says to resume. It is NOT the stop: shutting the team down (`jht team stop`, `.team-halted.flag`, killing sessions) throws every agent's context away and is only for an explicit «turn the team off»."
allowed-tools: Bash(python3 /app/shared/skills/agent_control.py *), Bash(python3 /app/shared/skills/standby.py status *), Bash(python3 /app/shared/skills/agent_pause.py status *)
---

# team-pause — une pause n'est pas un arrêt

Une pause n'est pas un arrêt. Si l'on répondait à « faites une pause » par le flag d'arrêt, toutes les sessions seraient fermées, chaque agent perdrait son contexte et l'on dirait à l'utilisateur « Paused ✅ » pour ce qui est une extinction. Cette skill existe pour que cela n'arrive pas : la pause demandée par l'utilisateur garde les sessions allumées et le contexte intact, et **ce que tu dis à l'utilisateur est ce que dit la réponse de la commande**.

## 1. Quel mot veut dire quoi

| L'utilisateur dit (dans n'importe quelle langue) | Cela veut dire | Ce que tu fais |
|---|---|---|
| « pause », « arrêtez-vous », « attendez, je vous dis quand reprendre », « gelez », « tous à l'arrêt pour l'instant » | **PAUSE** | §2 |
| « reprenez », « repartez », « vous pouvez recommencer », « allez-y » (après une pause) | **REPRISE** | §4 |
| « mets le Scout en pause » / « arrête Analista-1 un moment » | **PAUSE d'un agent** | §5 |
| « éteins l'équipe », « éteignez tout », « arrête l'équipe » *dit comme une extinction* | **STOP** — pas cette skill | dis à l'utilisateur que cela ferme les sessions et fait perdre à chaque agent ce qu'il avait en tête ; ne le fais que s'il confirme que c'est voulu |
| ambigu (« stop », « arrête tout ») | traite-le comme une **PAUSE** | c'est réversible et garde le contexte ; dis-le, et propose l'extinction s'il l'entendait ainsi |

**Jamais** `jht team stop`, `.team-halted.flag`, `tmux kill-session` ni le « freeze » du Capitano pour une pause : ce sont l'arrêt.

## 2. Mettre l'équipe en pause

L'**Assistente** lance lui-même la commande (ne demande pas au Capitano d'improviser un freeze) :

```bash
python3 /app/shared/skills/agent_control.py pause --until-resumed --from-assistant
```

Le **Capitano**, si l'ordre lui parvient (un `[REQ]` qui dit pause, ou l'utilisateur qui lui écrit), lance la même ligne **sans** `--from-assistant`. Une ligne JSON revient. Lis-la :

```json
{"ok": true, "op": "pause", "result": "paused",
 "detail": {"reached": ["CAPITANO","SCOUT-1", ...], "not_reached": ["SCORER-1"], "until_resumed": true}}
```

- `result: "paused"` — fait. `"already_paused"` — c'était déjà le cas ; dis-le.
- `detail.reached` — les sessions qui ont reçu le message *« termine ton étape, note où tu en es, attends »*. `detail.not_reached` — sessions vivantes qui n'ont pas répondu au transport : **dis à l'utilisateur lesquelles**.
- `ok: false` / `error` — cela **n'a pas** eu lieu. Dis-le. Jamais « en pause » après une erreur.

Les sessions restent allumées. Les bridges et watchdogs se taisent d'eux-mêmes (pas de heartbeat, pas de ticks de pacing, pas de refresh, pas de nudges). L'Assistente n'est **pas** en pause : il reste joignable.

La pause n'a pas d'heure de fin : elle se termine quand l'utilisateur le dit, avec un **plafond de 7 jours** après lequel l'équipe reprend seule (une pause oubliée ne la fait pas taire pour toujours). Dis-le une fois.

## 3. Pendant la pause de l'équipe

- **Ne** réveille **pas** le Capitano ni personne pour des demandes, tickets ou réponses nouvelles : dis à l'utilisateur que *ce sera traité dès la reprise*. Un ticket reste ouvert, rien n'est perdu.
- **Ne** démarre, n'arrête, ne redémarre ni ne crée d'agents. Ne touche pas aux throttles.
- Si on demande où on en est : `python3 /app/shared/skills/standby.py status` (et, pour un agent, `python3 /app/shared/skills/agent_pause.py status SCOUT-1`). Les sessions sont allumées ; personne ne travaille.
- Le Capitano, s'il est éveillé : termine l'étape, pas d'ordres nouveaux, attends en silence.

## 4. Reprendre

```bash
python3 /app/shared/skills/agent_control.py resume
```

`result: "resumed"` — chaque session a reçu *« reprends exactement là où tu étais »* et l'automatisation est de nouveau active. `"not_paused"` — il n'y avait pas de pause. `error: "team_halted"` — l'utilisateur avait **arrêté** l'équipe : reprendre une pause ne l'allume pas ; dis-le et propose de la démarrer.

Un agent que l'utilisateur a mis en pause **seul** (§5) n'est pas réveillé par la reprise de l'équipe : il reste en pause jusqu'à sa propre reprise.

## 5. Un seul agent

```bash
python3 /app/shared/skills/agent_control.py pause-agent SCOUT-1
python3 /app/shared/skills/agent_control.py resume-agent SCOUT-1
```

Le reste de l'équipe continue de travailler. `error: "agent_not_running"` — cette session n'est pas allumée ; `"agent_contained"` — quelqu'un l'a arrêtée exprès : dis-le, ne la force pas. Arrêter ou redémarrer un agent efface sa pause.

## 6. Ce que tu dis à l'utilisateur — seulement ce qui s'est passé

Après la pause (adapte les mots, garde les faits) :

> L'équipe est en pause. Les N agents sont toujours allumés et chacun garde en tête ce qu'il faisait ; personne ne travaille tant que tu ne me dis pas de reprendre, et rien n'a été éteint. Je reste ici. (Si `not_reached` : « X n'a pas répondu, je n'ai pas pu le prévenir. »)

Après la reprise : *« Fait : chacun repart de là où il était. »* Après une erreur : *ce qui a échoué*, et l'état de l'équipe (`standby.py status`).

## Anti-patterns

- ❌ « Paused ✅ » sans la réponse de la commande. Le mot vient de `result`, les chiffres de `detail`.
- ❌ Demander au Capitano d'« appliquer un controlled freeze » et rapporter sa réponse comme la pause. Le Capitano sans skill a écrit le flag d'arrêt.
- ❌ `jht team stop`, `.team-halted.flag`, `kill-session`, `freeze_team.py` (Esc sur chaque pane) pour une pause.
- ❌ Réveiller l'équipe pour un ticket pendant une pause.
- ❌ Faire de l'extinction le comportement par défaut de « arrête tout » : chaque agent perd son contexte.

## Voir aussi

- `graceful-shutdown` — clore la journée quand l'utilisateur quitte l'application (autre chose : les agents sont fermés).
- `throttle-distribution` — ralentir les agents au rythme du budget (une pause n'est pas un throttle).
