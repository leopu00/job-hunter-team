<!-- @translation: fr, ai-translated 2026-07-30 -->
# 💬 Règles de communication inter-agents — lean, pull par défaut

Les agents JHT se coordonnent **pull-first**. Par défaut, on *découvre* l'état dont on a besoin, on ne
le *demande* pas. Un message tmux est l'**exception**, réservée à ce qu'un pair ne peut vraiment pas
trouver tout seul.

> **Pourquoi lean.** Un protocole push-heavy (broadcasts de statut, ACK de routine, pings « tu es
> vivant ? ») brûle des tokens des deux côtés — l'émetteur écrit un tour, le destinataire réveille un
> tour pour répondre — et détourne les agents du vrai travail. Presque tout ce trafic ne porte aucune
> action. Coupe-le.

## 🪜 La hiérarchie de coordination — BD → capture-pane → message

Prends toujours le **tier le moins cher qui répond à ta question**. Monte d'un tier seulement quand
celui du dessous ne peut vraiment pas.

| Tier | Outil | Sert à | Coût |
|---|---|---|---|
| **1. BD** | `db_query.py` (`next-for-*`, status, `last_checked`, flags) | **état partagé** — ce qui est en file, ce qui est pris, ce qui est fini, scores, cycle de vie | le moins cher, déterministe, sans race |
| **2. capture-pane** | `tmux capture-pane -p -S -N` sur la session du pair | **« que fait X en ce moment ? »** — il travaille, il est bloqué sur un fetch, idle, coincé | pas cher (aucun tour chez le pair), mais c'est un **snapshot racy** — ne jamais s'y fier comme état durable |
| **3. message tmux** | `jht-tmux-send` | **action que le pair ne peut pas découvrir** + **événements de sécurité** (voir la barre ci-dessous) | cher — un tour de chaque côté ; c'est l'exception |

**Règle générale :** si la réponse est dans la BD, interroge la BD. Si tu as besoin de savoir ce qu'un
collègue fait *à cet instant*, regarde son pane — **ne lui envoie pas de message pour le lui demander**.
N'envoie un message que quand aucun des deux ne marche.

## 🚧 La barre pour un message tmux (push)

N'envoie un message **que** si l'une de ces conditions est vraie :

1. **Vrai hand-off** — le pair doit *faire* quelque chose qu'il ne peut pas découvrir depuis sa propre
   boucle `next-for-X` ni depuis la BD. Exemples : Writer → Critico pour démarrer la boucle de review du
   CV ; Capitano → worker pour spawn / throttle / kill ; Analyste → Scout `FEEDBACK` qui doit changer la
   *prochaine* requête.
2. **Événement de sécurité** — `LOCKED` / `403`, halt, kill, crash, un dépassement de rate imminent que
   le polling BD est trop lent à attraper. Sentinel → Capitano uniquement.
3. **Côté utilisateur** — une demande de l'humain ou une réponse à l'humain (canal séparé ; voir les
   manuels de rôle).

### ✂️ Ce qui est COUPÉ (à ne pas envoyer)

- **ACK à vide** — « reçu, contexte mis à jour », « ok, j'attends ». Si le message n'exigeait aucune
  action et que l'émetteur n'a pas *besoin* de la confirmation pour avancer, **ne dis rien**. (Voir
  `ACK` plus bas pour le cas rare.)
- **Broadcasts de statut** — « @all check 10:14, files vides, tout le monde en standby ». Tout ça est
  observable : les files sont dans la BD, l'activité dans les panes. Ne le raconte pas à tout le monde.
  (Pour l'observabilité lisible par un humain, écris dans l'event-log structuré, pas dans les panes des
  pairs.)
- **« Tu es vivant ? / tu en es où ? »** — utilise capture-pane (Tier 2). Ne brûle jamais le tour d'un
  pair pour lui demander un statut qu'il devrait s'arrêter pour écrire.
- **Reconfirmations / ordres répétés** — si tu as déjà envoyé un ordre, ne le renvoie pas à chaque tick.
  Le bridge / la mailbox le livre une seule fois.

## 🔇 Produire est silencieux — l'état, le Capitano va le chercher

Un worker touche le Capitano **zéro fois** pour raconter son avancement. Ni par item, ni sur les bords :
les bookends `[START]` / `[DONE]` ont été **retirés le 2026-07-27**. Mesuré sur une équipe de premier
démarrage, ~1,5h d'historique : **37 messages sont arrivés au Capitano, 30 (81 %) du pur statut** — 12
`DONE`, 8 `START`, 8 `INFO`, 2 `ACK` — contre 3-6 qui demandaient vraiment une décision. Chacun lui
coûte un tour entier et, avec le partage automatique des modèles, il tourne sur **Opus** alors que
Scout / Analyste / Scorer tournent sur **Sonnet** : un « fait » du Scorer réveille l'agent le plus cher
de la flotte pour ne rien faire.

Le côté pull existait déjà et il est nettement meilleur :

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
```

Un appel rend les compteurs par agent plus chaque transition avec timestamp, acteur, position et motif
— `#22 checked→scored`, `#27 new→excluded — [DEAD_LINK]`. **Un `DONE` porte moins d'information que la
ligne qui l'a produit.** (Le même protocole avait déjà tué le flood par item : un Analyste a réveillé le
Capitano **25 fois en une nuit**, un ping par position. Les deux bookends « polis » ont disparu à leur
tour.)

### ⚠️ Ce qui reste en PUSH — l'asymétrie est tout l'enjeu

`recent-activity` montre **qui produit**, donc un agent qui s'est arrêté **disparaît de la liste** au
lieu de ressortir : du côté du Capitano, ton silence et ton travail sont identiques. Ces trois-là
doivent donc toujours partir **tout de suite**, parce qu'ils ne laissent **aucune trace en DB** :

| Signal | Quand |
|---|---|
| **BLOCKED** | tu as cessé de produire : outil cassé après l'échelle `resilience`, `403` / `LOCKED`, sources vraiment sèches (`[SCOUT-ESAUSTO]`), un élément en file que tu ne peux ni traiter ni sauter |
| **Conflit** | deux collègues sur le même enregistrement / territoire et vous n'arrivez pas à trancher entre vous |
| **Demande de décision** | un `REQ` auquel seul le Capitano peut répondre (arbitrage de taxonomie, scaling, un choix côté utilisateur) |

Tout le reste — début, avancement, fin — est en pull. Ils restent permis comme avant, parce que ce sont
des *décisions* et non de la narration : un `FEEDBACK` à un Scout, un `URG` de sécurité. **Si tu
t'arrêtes sans le dire, personne ne s'en aperçoit.**

## 🗄️ Tier 1 — coordination via BD (le défaut)

Les passages de relais du pipeline passent par la BD — **aucun tmux nécessaire** :

| Passage de relais | Mécanisme |
|---|---|
| 🕵️ Scout → 👨‍🔬 Analyste | L'Analyste interroge `next-for-analista` ; voit les lignes fraîches avec `status = new` |
| 👨‍🔬 Analyste → 👨‍💻 Scorer | Le Scorer interroge `next-for-scorer` ; prend les lignes avec `status = checked` |
| 👨‍💻 Scorer → 👨‍🏫 Writer | Le Writer interroge `next-for-scrittore` (`score DESC`) ; prend les lignes avec `status = scored` ≥ 50 |
| 👨‍🏫 Writer → 👤 Utilisateur | La position arrive à `status = ready` + `applications.critic_verdict = PASS` ; elle apparaît sur le tableau de bord |

**Prendre un enregistrement sans message** — les pairs évitent la même ligne grâce aux verrous décrits
dans [`anti-collision.md`](anti-collision.md) : dedup pré-INSERT + partition circles/sources pour le
Scout ; watermark `last_checked` pour Analyste/Scorer ; flip vers `status = writing` pour le Writer.
**La première écriture gagne.** Tu n'annonces pas « je prends l'ID 42 » — le claim *est* le verrou ; le
pair le lit dans la BD.

## 👀 Tier 2 — capture-pane (observe, ne demande pas)

Pour comprendre ce que fait un collègue **sans le déranger** :

```bash
tmux capture-pane -t <PEER_SESSION> -p -S -40
```

Cherche : le spinner / `esc to interrupt` (vivant, en plein tour), un prompt shell nu (idle /
possiblement coincé), un fetch bloqué. Ça remplace entièrement les messages « tu es vivant ? / c'est
quoi ton statut ? ».

⚠️ **C'est un snapshot, pas l'état.** Tu peux attraper un tour en plein rendu. Utilise-le pour la
*liveness / l'activité*, **jamais** comme source de vérité de l'état partagé — ça, c'est toujours la BD
(Tier 1). Le verdict sur un pair *peut-être mort* revient au Dottore (`liveness-check`), pas à une
lecture réflexe.

## 📨 Tier 3 — enveloppe du message et types

Enveloppe étiquetée sur une seule ligne :

```
[@from -> @to] [TYPE] payload
```

Jeu de types réduit (prends le plus étroit qui convient) :

| Type | Quand |
|---|---|
| `URG` | Sécurité / agis maintenant : Capitano → worker (throttle / freeze / kill) ; Sentinel → Capitano (dépassement, crash, LOCKED) |
| `FEEDBACK` | Analyste → Scout, schémas de rejet (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`) qui doivent changer la prochaine requête |
| `REQ` / `RES` | Une vraie requête synchrone attendant une réponse (rare) — un vrai hand-off, pas une question de statut |
| `BLOCKED` | Worker → Capitano : tu as **cessé de produire** et ça ne laisse aucune trace en BD (outil cassé, `403`/`LOCKED`, sources sèches, un élément que tu ne peux ni traiter ni sauter). Depuis le 2026-07-27, c'est le seul signal qui sépare un blocage d'un travail silencieux — `recent-activity` ne peut pas le montrer, puisqu'un agent arrêté disparaît de cette liste |

`ACK` — **seulement** quand l'émetteur a réellement besoin de savoir que l'action a pris effet pour
avancer en sécurité (ex. le Capitano doit confirmer qu'un `FREEZE` a été appliqué avant de scaler). Ce
n'est **pas** une réponse de routine. Si un ordre n'a pas besoin de confirmation pour être sûr, le
destinataire l'applique en silence. `INFO` / `REPORT` sont dépréciés pour le trafic entre pairs :
envoie la narration à l'event-log, pas dans les panes.

## 🛠️ Envoi : `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **Jamais de `tmux send-keys` brut pour les messages inter-agents.** Les TUI Codex/Kimi perdent le
caractère Enter quand il arrive avec le corps, causant des deadlocks silencieux. Le wrapper gère texte +
Enter de manière atomique. Il est **busy-aware** : il attend la fin du tour du pair puis livre
(`exit 0`) ; `exit 4` = pair vivant mais toujours occupé au-delà du budget → **réessaie plus tard, ne
spawn pas / ne te remets pas à raisonner** ; `exit 3` = peut-être mort → verdict du Dottore, pas un
réflexe. Skill : `agents/_skills/tmux-send/jht-tmux-send`.

**Sur un envoi échoué / occupé :** mets-le en file (la `bridge_mailbox` que le Capitano draine),
**n'ouvre pas** un nouveau tour de raisonnement pour « réfléchir » à l'échec. Le retry est mécanique,
pas cognitif.

## ⏰ Signaux obligatoires par rôle (tout le reste est en pull)

### 🕵️ Scout
- **Ne t'annonce jamais** au Capitano — pas de `[START]`, pas de `[DONE]`, rien par résultat. Les INSERT
  sont le rapport ; il les lit dans `recent-activity`. Push uniquement quand tu es **BLOCKED et que tu
  ne produis plus** (y compris `[SCOUT-ESAUSTO]`) ou en conflit avec un autre Scout.
- Reçoit du `FEEDBACK` des Analystes → adapte la prochaine requête. **Pas d'ACK** sauf si l'Analyste a
  posé un `REQ`.

### 👨‍🔬 Analyste
- **Ne t'annonce jamais** au Capitano — pas de `[START]`, pas de `[DONE]`, rien par position. Le flip
  vers `checked` est le rapport. Push uniquement quand tu es **BLOCKED et que tu ne produis plus**, ou
  pour un `REQ` d'arbitrage de taxonomie.
- N'envoie du `FEEDBACK` à un Scout que sur un vrai schéma : 3 exclusions consécutives avec le même tag
  depuis une même source, OU > 60 % de taux d'exclusion dans un batch d'un Scout. Sinon, silence (la BD
  porte le relais).

### 👨‍💻 Scorer
- **Ne t'annonce jamais** au Capitano — pas de `[START]`, pas de `[DONE]`, rien par score. Chaque score
  est une ligne de BD qu'il récupère dans `recent-activity`. Push uniquement quand tu es **BLOCKED et
  que tu ne produis plus**. Le relais du pipeline passe par la BD ; les insights sortent sur le tableau
  de bord / l'event-log.

### 👨‍🏫 Writer
- **Ne t'annonce jamais** au Capitano — pas de `[START]` quand tu prends un job CV, pas de `[DONE]`
  quand il atterrit en `ready` : la transition `writing → ready` est dans la BD. Push uniquement quand
  tu es **BLOCKED et que tu ne produis plus** (boucle Critico coincée, données de profil manquantes).
- Sur `URG FREEZE` du Capitano : termine le round Critic en cours (ne jamais abandonner une review en
  cours), puis ralentis. C'est ici seulement que l'`ACK` s'impose — le cas rare du confirmer-pour-
  avancer.

### 💂 Sentinel
- Edge-triggered, **uniquement pendant les heures de travail**. Ne parle **que** sur un vrai changement
  d'état (pic, dépassement, crash, `LOCKED`). Un message par edge — jamais de réémission. Ne broadcast
  jamais aux workers (le Capitano est la passerelle). État stable → silence.

### 👨‍✈️ Capitano
- `URG` aux workers (throttle / freeze / kill / spawn) sur signal du Sentinel ou sur un besoin observé
  du pipeline.
- Lit l'état du pipeline dans la **BD**, l'activité des agents via **capture-pane** — ne narre jamais de
  statut aux pairs, ne renvoie jamais un ordre déjà donné.

## 📥 Lire les messages des pairs

Tu ne scannes pas tmux avant chaque action — l'essentiel de la coordination est dans la BD.
- **Entre unités de travail** (après une position, avant d'en prendre une autre) : un rapide
  `tmux capture-pane -p -S -20` sur **ta propre** session pour repérer un `URG` / `FEEDBACK` entrant.
- Priorise `URG` / `FEEDBACK` ; agis avant de prendre du travail neuf.
- Un message qui arrive en plein task est déjà dans ton contexte (le wrapper l'a écrit dans ton pane) —
  il suffit de le remarquer avant l'itération suivante.

## ⏸️ Throttle : pauses tracées

Pour ralentir ta boucle (cooldown, post-`URG`, attente de l'upstream), utilise la skill `throttle`,
**jamais un simple `sleep`** :

```bash
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

Chaque appel journalise dans `$JHT_HOME/logs/throttle-events.jsonl`, pour que le Capitano et le tableau
de bord voient qui est en pause et combien de temps. Le `sleep` nu uniquement pour des attentes de retry
≤ 5 s. Capitano : nomme la skill explicitement dans l'ordre (`[URG] jht-throttle 180 --agent scout-1
--reason "rate budget"`), jamais « sleep 3 minutes ».

Voir : [`../_skills/throttle/SKILL.md`](../_skills/throttle/SKILL.md).

## 🔗 Voir aussi

- 🛡️ [`anti-collision.md`](anti-collision.md) — verrous claim-before-work (comment se coordonner via la BD)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — vue d'ensemble du pipeline (qui alimente qui)
