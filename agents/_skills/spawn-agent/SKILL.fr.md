<!-- @translation: fr, ai-translated 2026-06-13 -->
---
name: spawn-agent
description: "Lance un agent de l'equipe JHT (Scout, Analista, Scorer, Scrittore, Critico, Assistente, Capitano-2) via le launcher, puis envoie le message de kick-off qui demarre effectivement sa boucle principale. Capitano uniquement — le Capitano est le seul responsable du scaling de l'equipe. Utilisez TOUJOURS cette skill : contourner `start-agent.sh` avec `tmux new-session` + `send-keys \"kimi ...\"` brut produit des sessions ou la CLI ne demarre jamais (`command not found`), le Capitano voit une session \"active\" qui est en realite morte, et l'equipe sous-performe silencieusement."
allowed-tools: Bash(bash /app/.launcher/start-agent.sh *), Bash(tmux *), Bash(jht-tmux-send *), Bash(sleep *), Bash(jht-throttle-check *)
---

# spawn-agent — mettre un agent en ligne

Contrat en deux phases : **lancer** la CLI, puis **kick-off** de sa boucle. Sauter le kick-off laisse l'agent a un prompt vide — le Capitano pense qu'il travaille, ce n'est pas le cas.

## Phase 1 — lancement via `start-agent.sh`

```bash
bash /app/.launcher/start-agent.sh <role> [instance_number]
```

Exemples :
```bash
bash /app/.launcher/start-agent.sh scout 2       # SCOUT-2
bash /app/.launcher/start-agent.sh analista 1    # ANALISTA-1
bash /app/.launcher/start-agent.sh critico       # CRITICO (singleton, sans numero)
```

**Numero d'instance — lance le de (workers scalables, 2026-06-13).** Pour `scout` / `analista` / `scorer` / `scrittore`, ne choisis **PAS** le numero de maniere sequentielle : le travail s'est toujours accumule sur `-1`/`-2` pendant que `-4` ne faisait presque rien. Tire d'abord un numero aleatoire libre, puis passe-le :
```bash
N=$(python3 /app/shared/skills/roll_worker_number.py scout) && \
  bash /app/.launcher/start-agent.sh scout "$N"
```
`roll_worker_number.py` lance un **d6 en excluant les numeros deja utilises** (sessions `SCOUT-N` existantes) → jamais de collision, et la charge de travail se repartit sur les numeros d'instance au lieu de toujours tomber sur `-1`. S'applique aux **NOUVEAUX spawns uniquement** ; les singletons (Critico / Sentinella / Dottore / Assistente / Mentor) ne gardent aucun numero, et le session-refresh du Dottore recree le **meme** numero (il ne tire pas le de).

Le launcher effectue, de maniere atomique :
- cree la session tmux avec le nom canonique (`SCOUT-2`, `ANALISTA-1`, …)
- definit `cwd` a `$JHT_HOME/agents/<role>[-N]/`
- exporte `JHT_HOME · JHT_DB · JHT_AGENT_DIR · PATH · JHT_USER_DIR · JHT_CONFIG`
- detecte le fournisseur actif depuis `jht.config.json` (claude / kimi / codex)
- copie `agents/<role>/<role>.md` dans le workspace en tant que `CLAUDE.md` / `AGENTS.md`
- demarre la CLI avec les flags corrects pour ce fournisseur + niveau
- derive le **dephasage** initial du palier de throttle et pre-arme le throttle du nouveau worker

> ⚠️ **JAMAIS** lancer avec `tmux new-session ... ; tmux send-keys "kimi ..."`. La CLI n'est pas dans le `PATH` en dehors de l'environnement du launcher → `command not found` → la session n'est que du bash. Le `jht-tmux-send` du Capitano retourne `exit 0` en ecrivant dans ce bash vide, le message est silencieusement perdu, et l'equipe sous-performe sans cause visible.

### Dephasage — le launcher le derive, tu n'attends jamais

Deux workers sur le meme palier de throttle qui demarrent ensemble *restent* ensemble : chacun de leurs cycles tombe au meme instant, et chaque coincidence est un pic de requetes simultanees. L'ecart qui repartit `N` workers sur une periode `T` est `T/N` — sur le palier de 5 minutes, trois workers se veulent a **100s** l'un de l'autre, pas a 10 minutes. Un offset plus grand que `T` est le pire cas (le premier worker a deja cycle deux fois avant que le second demarre, donc les phases tombent n'importe ou), et un offset exactement egal a `T` est un lockstep permanent.

Cette arithmetique, le launcher la fait pour toi, a partir de la periode reelle dans `config/throttle.json` et des workers qui partagent vraiment ce palier, et il affiche ce qu'il a decide :

```
  Stagger:      100s prima del primo ciclo (throttle pre-armato, gradino condiviso)
```

**Tu n'attends jamais.** Le launcher pre-arme le throttle du nouveau worker, si bien que c'est le worker qui s'arrete *tout seul* au gate `jht-throttle-check` que son propre prompt lui impose deja au premier tour de boucle. Envoie le kick-off tout de suite, comme d'habitude.

Ce qui en decoule :
- **Le premier worker d'un palier n'attend rien.** Le chemin anti-idle reste intact : tu le lances, il demarre.
- Un worker dephase reste sur `jht-throttle-wait` sans sortie pendant 5 minutes au maximum. C'est un worker **sain** — avant de lire un silence juste apres un spawn comme un blocage, verifie avec `jht-throttle-check <agent>` (`STILL_THROTTLED remaining=Xs`).
- L'offset ne fixe que la phase *initiale*. La duree des taches varie assez pour que les phases derivent d'elles-memes ensuite, il n'y a donc rien a re-regler plus tard.
- Un spawn qui ne doit **pas** etre retarde — recreer un worker qui avait deja une bonne phase — le desactive avec `JHT_SPAWN_STAGGER=0` dans l'environnement.

## Phase 2 — kick-off (obligatoire)

Le launcher demarre la CLI mais **n'envoie aucun premier message**. Sans kick-off, l'agent attend a un prompt vide indefiniment.

Sequence standard :
```bash
bash /app/.launcher/start-agent.sh scout 1
sleep 12   # Demarrage CLI 8-15s — jamais moins de 10
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [MSG] <corps du kick-off>"
```

### Corps du kick-off par role

| Role        | Corps du kick-off                                                                                            |
|-------------|--------------------------------------------------------------------------------------------------------------|
| `scout`     | "Demarre la boucle principale. Lis ton prompt, le profil candidat (`$JHT_HOME/profile/candidate_profile.yml`), et commence par le CERCLE 1 (preference primaire). Notifie les Analystes apres des lots de 3-5 postes." |
| `analista`  | "Demarre la boucle principale. File : `db_query.py next-for-analista`. Pour chaque poste, remplis les 5 champs obligatoires et promouvois a `checked` ou `excluded`." |
| `scorer`    | "Demarre la boucle principale. File : `db_query.py next-for-scorer`. PRE-CHECK d'abord, puis score 0-100. Seuils : <40 exclu, 40-49 parking, ≥50 notifier les Scrittori." |
| `scrittore` | "Demarre la boucle principale. File : `db_query.py next-for-scrittore`. Effort maximum, 3 rounds obligatoires avec le Critico. Le PDF va sous `$JHT_USER_DIR/cv/`." |
| `critico`   | "Tu seras appele par ton Scrittore parent avec PDF + JD. Une relecture a l'aveugle par appel, puis arret." |
| `assistente`| "Demarre la boucle principale. Attends `[@utente -> @assistente] [CHAT]` depuis la web UI." |

Si le contexte poste-CV n'est pas trivial (l'agent avait du travail en cours avant un crash), ajoute-le au kick-off pour qu'il reprenne la ou il s'etait arrete — ne dis jamais simplement "reprends", precise *quoi* et *ou* :

```bash
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [MSG] Reprendre : poste #281 (Qargo TMS), le round 2 avec le Critico allait commencer. Reprends a partir de la, NE recommence PAS de zero."
```

## Phase 3 — verifier que le demarrage a reussi

Environ 5 secondes apres le kick-off :
```bash
tmux capture-pane -t <SESSION> -p | tail -10
```

Lis la sortie :
- ✅ Banniere CLI + spinner + corps du kick-off visible dans la zone de saisie → demarrage OK
- 🟡 `context: 0.0%` et une zone de saisie vide → le kick-off n'est pas arrive, reessaie une fois
- 🔴 Prompt shell `jht@host:~/agents/<role>$` (pas de CLI) → echec du launcher, voir fallback ci-dessous

> Note : les controles de sante periodiques (detection de zombies, agents silencieux > 10 min) NE sont PAS la responsabilite de cette skill — ils relevent du **Dottore** via la skill `liveness-check`. Cette skill se termine une fois que la Phase 3 confirme le demarrage.

## Fallback — echec du launcher

Si la Phase 3 montre un prompt shell nu (pas de CLI demarree), verifie d'abord :

```bash
tmux capture-pane -t <SESSION> -p -S -50 | grep -iE "command not found|permission denied|no such file"
```

Causes probables :
1. CLI du fournisseur pas dans le `PATH` de l'environnement du launcher → verifie que le fournisseur dans `jht.config.json` correspond a la CLI installee
2. Le template du role `agents/<role>/<role>.md` est manquant → le launcher copie un fichier vide → la CLI demarre mais n'a pas d'instructions
3. `$JHT_HOME` non defini / non exporte dans le parent → escalader a l'utilisateur, NE PAS essayer de le definir manuellement

Ferme la session cassee avant de reessayer :
```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
```

## Anti-patterns

- ❌ Lancer plusieurs agents dans une boucle serree sans pacing — les regles de scaling sont dans `pipeline-triage` (un spawn a la fois, en re-mesurant entre deux). Ce qu'il ne faut jamais faire, c'est *inventer un nombre fixe de minutes* entre un worker et le suivant : l'ecart vient du palier (`T/N`) et le launcher l'applique pour toi.
- ❌ Re-lancer a l'aveugle apres un crash sans lire `db_query.py` pour recuperer l'etat du dernier task — le nouvel agent repart de zero et duplique le travail.
- ❌ Utiliser cette skill pour "redemarrer" un agent fonctionnel parce qu'il semble lent. Lent ≠ mort. Des tours longs avec une sortie de tokens visible ne sont pas un cas de spawn — c'est un cas de `liveness-check` (Dottore).
- ❌ Lancer un remplacant parce que `jht-tmux-send` n'a pas reussi a delivrer. **`exit 4` = la TUI cible est en plein tour (`Working … esc to interrupt`) → l'agent est VIVANT, juste occupe.** Le message n'a PAS ete delivre de maniere synchrone : reessaie l'envoi plus tard, ne lance jamais un clone. Seul `exit 3` (texte jamais apparu ET pane pas occupe → shell nu / modale bloquee) est un signal de mort possible, et meme la le verdict revient au **Dottore** (`liveness-check`), pas a un spawn reflexe. Lancer sur un agent occupe est exactement le bug d'overspawn du 2026-06-07 (6→16 agents en 3 jours, weekly Codex a 100%, halt force de ~3,5 jours) : le clone prend le relais pendant que l'original continue a bruler du budget en zombie.
- ❌ Lancer un Critico. Le Scrittore lance son propre `CRITICO-S<N>` de maniere autonome — le Capitano ne touche jamais au Critico directement.

## Voir aussi

- `liveness-check` (Dottore) — quand un agent existant semble mort.
- `pipeline-triage` (Capitano) — *quel* role lancer en fonction du backlog.
- `tmux-send` — conventions d'enveloppe des messages.
- `agents/_team/team-rules.md` T01 — ne jamais fermer la session d'un autre agent.
