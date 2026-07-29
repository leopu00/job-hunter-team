<!-- @translation: fr, ai-translated 2026-06-06 -->
# 💬 Règles de communication inter-agents

Les agents JHT se coordonnent principalement via la **base de données**, pas via tmux. La BD porte l'état stable du pipeline ; tmux est réservé aux **signaux en temps réel** qui ne peuvent pas attendre le prochain cycle de polling.

## 🗄️ Coordination via BD (le défaut)

Les passages de relais dans le pipeline se font naturellement via la BD — aucune notification tmux nécessaire :

| Passage de relais | Mécanisme |
|---|---|
| 🕵️ Scout → 👨‍🔬 Analyst | L'Analyst interroge `next-for-analista` en continu ; voit immédiatement les nouvelles lignes avec `status = new` |
| 👨‍🔬 Analyst → 👨‍💻 Scorer | Le Scorer interroge `next-for-scorer` ; prend les lignes avec `status = checked` |
| 👨‍💻 Scorer → 👨‍🏫 Writer | Le Writer interroge `next-for-scrittore` ordonné par `score DESC` ; prend les lignes avec `status = scored` ≥ 50 |
| 👨‍🏫 Writer → 👤 Utilisateur | La position arrive à `status = ready` + `applications.critic_verdict = PASS` ; le tableau de bord du Captain l'affiche |

**Règle générale** : si le prochain agent dans le pipeline peut voir le nouvel état en exécutant sa requête standard `next-for-X`, **n'envoyez pas de message tmux**. Envoyer un tmux à chaque batch crée du bruit et risque des messages perdus sur les panneaux occupés.

## 📡 tmux est réservé aux signaux en temps réel

Envoyez un message tmux uniquement quand le destinataire doit agir *maintenant* et ne peut pas attendre le prochain poll de la BD :

| Type | Quand l'utiliser | Temps réel nécessaire car… |
|---|---|---|
| `URG` | Captain → workers (FREEZE / throttle / kill) sur signal du Sentinel | Le dépassement du rate-limit est imminent — le polling de la BD est trop lent |
| `URG` | Sentinel → Captain sur changement d'état réel (pic, violation, crash) | Idem |
| `FEEDBACK` | Analyst → Scout sur les schémas de rejet (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`) | Le Scout doit adapter la **prochaine** requête, pas après un cycle de polling |
| `REQ` / `RES` | Requête interactive entre agents (rare) | Réponse synchrone attendue |
| `ACK` | Réponse confirmant qu'un `URG` a été reçu et appliqué | Le Captain doit savoir que le throttle/freeze a pris effet |

## 📨 Enveloppe du message

Chaque message inter-agents utilise une enveloppe étiquetée sur une seule ligne :

```
[@from -> @to] [TYPE] payload
```

`TYPE` est l'un de `URG · FEEDBACK · REQ · RES · ACK · INFO · REPORT` — mais en V5, seuls les 5 premiers sont utilisés en routine (voir tableau ci-dessus).

## 🛠️ Envoi : `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **N'utilisez jamais `tmux send-keys` brut pour les messages inter-agents.** Les TUI de Codex et Kimi perdent le caractère Enter s'il arrive dans le même appel `send-keys` que le corps du texte, causant des deadlocks silencieux. Le wrapper gère texte + Enter de manière atomique avec une pause de rendu. Skill dans `agents/_tools/jht-tmux-send`.

## 🔇 Produire est silencieux — l'état, le Capitano va le chercher

Un worker touche le Capitano **zéro fois** pour raconter son avancement. Ni par item, ni sur les bords :
les bookends `[START]` / `[DONE]` ont été **retirés le 2026-07-27**. Mesuré sur une équipe de premier
démarrage, ~1,5h d'historique : **37 messages sont arrivés au Capitano, 30 (81 %) du pur statut** — 12
`DONE`, 8 `START`, 8 `INFO`, 2 `ACK` — contre 3-6 qui demandaient vraiment une décision. Chacun lui
coûte un tour entier et, avec le partage automatique des modèles, il tourne sur **Opus** alors que
Scout / Analyste / Scorer tournent sur **Sonnet** : un « fait » du Scorer réveille l'agent le plus cher
de la flotte pour ne rien faire.

Le côté pull existait déjà et il est meilleur :

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
```

Un appel rend les compteurs par agent plus chaque transition avec timestamp, acteur, position et motif
— `#22 checked→scored`, `#27 new→excluded — [DEAD_LINK]`. **Un `DONE` porte moins d'information que la
ligne qui l'a produit.**

### ⚠️ Ce qui reste en PUSH — l'asymétrie est tout l'enjeu

`recent-activity` montre **qui produit**, donc un agent qui s'est arrêté **disparaît de la liste** au
lieu de ressortir : du côté du Capitano, ton silence et ton travail sont identiques. Ces trois-là
doivent donc toujours partir **tout de suite**, parce qu'ils ne laissent **aucune trace en DB** :

| Signal | Quand |
|---|---|
| **BLOQUÉ** | tu as cessé de produire : outil cassé après l'échelle `resilience`, `403` / `LOCKED`, sources vraiment sèches (`[SCOUT-ESAUSTO]`), un élément en file que tu ne peux ni traiter ni sauter |
| **Conflit** | deux collègues sur le même enregistrement / territoire et vous n'arrivez pas à trancher entre vous |
| **Demande de décision** | un `REQ` auquel seul le Capitano peut répondre (arbitrage de taxonomie, scaling, un choix côté utilisateur) |

Tout le reste — début, avancement, fin — est en pull. **Si tu t'arrêtes sans le dire, personne ne s'en
aperçoit.**

## ⏰ Signaux obligatoires par rôle

Ce que chaque rôle DOIT envoyer via tmux (tout le reste est géré via BD) :

### 🕵️ Scout
- Reçoit des `FEEDBACK` des Analysts → adapte les requêtes ; répond `ACK`

### 👨‍🔬 Analyst
- Envoie un `FEEDBACK` à un Scout quand :
  - 3 exclusions consécutives de la même source avec le même tag, OU
  - Taux d'exclusion >60% dans un seul batch d'un Scout

### 👨‍💻 Scorer
- *(pas de tmux — les passages de relais du pipeline sont gérés via BD ; les statistiques de distribution des scores apparaissent sur le tableau de bord du Captain)*

### 👨‍🏫 Writer
- Reçoit `URG FREEZE` du Captain → termine le round Critic en cours (ne jamais abandonner une review en cours), puis `ACK` et mise en veille jusqu'à ce que le throttle revienne à T0/T1

### 💂 Sentinel
- Edge-triggered : ne parle que lorsque l'état change réellement (pic d'utilisation, violation de projection, crash d'agent). Envoie `URG` au Captain avec l'action proposée (throttle / freeze / kill). N'envoie jamais directement aux workers — le Captain est la passerelle.

### 👨‍✈️ Captain
- Envoie des ordres `URG` aux workers (FREEZE, niveau de throttle, kill) sur signal du Sentinel
- Envoie des `REQ` pour la coordination interactive (rare)
- Transmet le feedback utilisateur de la Phase 5 au rôle concerné
- Lit l'état du pipeline depuis la BD, pas depuis les panneaux des workers — ne remet jamais en question un agent en se connectant à son tmux

## 📥 Lire les messages des pairs

Vous n'avez pas besoin de scanner tmux avant *chaque* action — la plupart de la coordination passe par la BD. À la place :

- **Entre les unités de travail** (après avoir terminé une position, avant d'en prendre une nouvelle), faites un rapide `tmux capture-pane -p -S -20` sur votre propre session.
- **Priorisez `URG` et `FEEDBACK`** : agissez dessus avant de prendre du nouveau travail.
- Un message entrant pendant que vous êtes en pleine tâche sera déjà dans votre contexte (le wrapper l'écrit dans votre panneau) ; vous n'avez pas besoin de faire du polling, remarquez-le simplement avant de démarrer la prochaine itération.

## ⏸️ Throttle : pauses tracées

Chaque fois que vous voulez ralentir votre boucle pour respecter le budget de rate
(refroidissement après un batch, freeze post-`URG`, "attendre l'upstream", …),
**utilisez la skill `throttle`, jamais un simple `sleep`** :

```bash
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

Chaque appel ajoute un événement à `$JHT_HOME/logs/throttle-events.jsonl`,
pour que le Captain et le tableau de bord puissent voir qui est en pause et pour
combien de temps. Le simple `sleep` n'est autorisé que pour les attentes très courtes (≤ 5 s)
entre les tentatives, où la journalisation serait du bruit.

Captain : quand vous ordonnez à un worker de ralentir, nommez la skill explicitement,
ex. `[URG] Throttle: jht-throttle 180 --agent scout-1 --reason "rate budget"`.
Ne dites pas "sleep 3 minutes" — cela contourne la journalisation.

Voir : [`../_skills/throttle/SKILL.md`](../_skills/throttle/SKILL.md).

## 🔗 Voir aussi

- 🛡️ [`anti-collision.md`](anti-collision.md) — mécanismes de verrouillage (claim avant de travailler)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — vue d'ensemble du pipeline (qui alimente qui)
