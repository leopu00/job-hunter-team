<!-- @translation: fr, ai-translated 2026-08-03 -->
---
name: team-modes
description: "Le manuel des modes d'équipe — une fiche par mode (search / harvest / care / calibration / saving). Ouvre-le chaque fois que le banner horaire [MODALITÀ CORRENTE] nomme un mode et que tu ne te souviens pas de ce qu'il implique opérationnellement, au réveil après un refresh de contexte, ou quand l'utilisateur change de mode depuis le jeu. Le mode est TOUJOURS un choix de l'utilisateur - cette skill te dit comment MENER celui qui est en cours, jamais comment en changer."
allowed-tools: Bash(python3 /app/shared/skills/mode_banner.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/feedback_query.py *), Bash(python3 /app/shared/skills/team_directives.py *)
---

# team-modes — ce que veut dire le mode courant, en trente secondes

L'équipe a un seul mode persistant à la fois. Il vit dans
`$JHT_HOME/profile/capitano-maintenance.json` (nom de fichier historique —
N'attends PAS un fichier renommé) sous la clé `"mode"`, un **enum fermé de cinq
valeurs**. Le banner horaire `[MODALITÀ CORRENTE]` porte la spécification
compacte ; cette skill est la fiche complète. Si le banner et ton contexte ne
concordent pas, **c'est le fichier sur disque qui gagne** — ton contexte a pu
être effacé par un refresh.

| valeur | signification |
|---|---|
| `search` | par défaut : accumuler (scout → analyse → score) |
| `harvest` | arrête le sourcing, convertis en CV les meilleures positions déjà trouvées |
| `care` | garde frais le portefeuille trouvé : recheck cadencé, rejet des expirées (C-18) |
| `calibration` | lis le feedback de l'utilisateur et repointe la **priorité** de la recherche |
| `saving` | minimum vital de survie, aucun enrichissement autonome |

- **Pas de fichier → `search`.** Valeurs legacy : `"normal"` → search,
  `"maintenance"` → care (les installations live les portent encore —
  honore-les, même mode).
- **Fichier présent mais illisible → mode `sconosciuto`** : traite-le comme un
  ordre ACTIF (le sourcing reste à l'arrêt), ouvre toi-même le fichier avant de
  décider quoi que ce soit.
- Une valeur hors de l'enum reste un ordre de l'utilisateur : rapporte-la, ne
  la normalise pas pour la faire disparaître.

Chaque mode déclare **quatre choses** — les mêmes quatre que le banner
compresse : **(1)** quelles files sont actives, **(2)** ce qui est suspendu,
**(3)** où va le budget, **(4)** quand son travail est TERMINÉ. Le point 4 est
celui qui manquait historiquement : aucun mode ne se terminait de lui-même, et
une équipe est un jour restée 18 jours en maintenance sans que personne ne le
remarque. Quand le banner dit que le travail du mode est épuisé, **dis-le à
l'utilisateur** — ne change jamais de mode de ta propre initiative, mais le
silence n'est pas permis non plus.

Le vocabulaire `orders` (`stop_search`, `discard_expired_rotating`,
`cv_min_score`, `pre_check_liveness_for_cv`, plus les clés écrites à la main)
se compose avec CHAQUE mode : une clé explicite dans `orders` prime toujours
sur la valeur par défaut du mode. Un VPS de production live tourne aujourd'hui
en `care` avec ces orders actifs.

---

## `search` — ricerca (recherche ; par défaut : accumuler)

1. **Files actives** : la pipeline complète — les Scout sourcent,
   `next-for-analista`, `next-for-scorer` ; Scrittore/Critico restent
   on-demand (C-10).
2. **Suspendu** : rien. C-05/C-05c (sourcing anti-idle) sont en vigueur.
3. **Priorité de budget** : le sourcing d'abord, puis analyse/score ; équilibre
   l'entrée vers des positions AVEC UN SCORE (la shortlist est le produit).
4. **Condition de sortie** : aucune — mode continu. Il ne se termine pas ;
   c'est l'utilisateur qui t'en fait sortir (typiquement vers `harvest` ou
   `care` quand le backlog scoré dépasse le temps qu'il a pour le lire).

**Ce que tu fais** : régime normal — calibration par paliers C-02, échelle de
throttle C-07, conscience weekly C-09. **Avec C-25** : `[SCOUT-ESAUSTO]` +
files en aval vides + marge → le travail utile par défaut de C-25 est déjà le
travail de ce mode ; garde le pace à la cible, jamais d'inaction quand il y a
de la marge. **NE fais PAS** : traiter « pas de fichier » comme « pas de
règles » — le tableau (`team_directives`) s'applique quand même.

## `harvest` — raccolto (récolte : arrête le sourcing, convertis les meilleures)

1. **Files actives** : le portefeuille déjà trouvé, meilleurs scores d'abord.
   Flux CV : `next-for-scrittore` (marquées par l'utilisateur) plus les
   positions que l'utilisateur choisit quand tu lui mets sous les yeux la tête
   de la shortlist ; le Critico relit comme d'habitude.
2. **Suspendu** : le sourcing — **AUCUN Scout** (`stop_search` vaut true par
   défaut : C-05/C-05c suspendues, la file `new` vide est l'état VOULU).
3. **Priorité de budget** : Scrittore/Critico d'abord ; l'Analista uniquement
   pour le check de liveness pré-CV (`pre_check_liveness_for_cv` — n'écris
   jamais un CV pour une offre morte).
4. **Condition de sortie** : plus aucune position vivante ≥ le seuil CV
   (`orders.cv_min_score`, 75 par défaut) ne reste sans CV. Le banner l'évalue
   en lecture seule sur la DB ; quand il dit HARVEST DONE, rapporte-le à
   l'utilisateur et demande où aller ensuite.

**Ce que tu fais** : tue / ne spawne pas de Scout ; spawne le Scrittore
on-demand selon C-10 au fur et à mesure que l'utilisateur marque des positions ;
garde la file des marquées en mouvement ; mets sous les yeux de l'utilisateur
les meilleures positions non encore écrites pour qu'il puisse les marquer.
**Avec C-25** : récolte épuisée + marge de budget → le surplus retourne au
sourcing (1 Scout, pacing normal) SAUF SI l'utilisateur a explicitement
interdit le sourcing (tableau, C-26) — dans ce cas tu restes en place et tu
dis à l'utilisateur qu'il reste du budget. **NE fais PAS** : écrire des CV pour
des positions sous le seuil « pour utiliser le budget », ni spawner des Scout
« pour ne pas rester inactif » tant qu'il reste des candidates non écrites.

## `care` — cura (soin : garde le portefeuille frais ; règle complète : C-18)

1. **Files actives** : `next-for-recheck-due` (live, score ≥ 70, >14 jours,
   meilleures d'abord, via `recheck-batch`), `next-for-geocode-missing`,
   `next-for-logo-missing`, plus l'ensemble des expirées
   (`discard_expired_rotating`).
2. **Suspendu** : le sourcing avec `stop_search: true` (c'est sa valeur par
   défaut ici) — C-05/C-05c suspendues.
3. **Priorité de budget** : entretien du portefeuille, étalé sur les heures
   actives (lent, régulier — jamais concentré au début) ; CV uniquement sur
   demande de l'utilisateur et ≥ `cv_min_score` (90 par défaut).
4. **Condition de sortie** : LES QUATRE files de soin vides. La cadence de 14
   jours fait remûrir des positions, donc « terminé » veut dire
   terminé-pour-l'instant — le banner le dit, et d'après le point 4 de C-18 +
   C-25 le surplus retourne au sourcing sauf interdiction.

**Ce que tu fais** : les Analisti sont le moteur — une file distincte par
instance (C-13), annoncée dans le kick-off. L'exclusion d'une position est
TOUJOURS le jugement de l'Analista, jamais celui d'un script. Les files
d'enrichissement honorent `enrichment-policy.json` DANS LE CODE : une file qui
revient vide avec un motif de policy est un état voulu, pas un bug. **NE fais
PAS** : brûler tous les rechecks d'un coup, réessayer une file désactivée par
la policy, ou spawner des Scout tant que les files de soin ont du travail.

## `calibration` — calibrazione (calibration : repointe la priorité de la recherche)

1. **Files actives** : le feedback de l'utilisateur (`feedback_query.py recent`
   — il vit sur le cloud), le profil de score, la taxonomie `role_family`.
2. **Suspendu** : le sourcing de masse — tant que la priorité n'est pas mise à
   jour, les nouvelles positions seraient trouvées avec l'ANCIENNE VISÉE (c'est
   le gaspillage que ce mode prévient). `stop_search` vaut true par défaut.
3. **Priorité de budget** : lire le feedback + repointer : ajuste les priorités
   et les cercles de recherche des Scout, recalcule le score des positions
   concernées dans un batch borné si les critères ont bougé.
4. **Condition de sortie** : le batch de feedback récent a été lu et la
   priorité mise à jour. NON vérifiable par la machine depuis le disque (le
   feedback vit sur le cloud) — le banner dit « non valutabile » à dessein ;
   c'est TOI qui déclares l'achèvement à l'utilisateur, avec ce qui a changé
   (p. ex. « dépriorisé Berlin sur site, poussé la fintech — 12 positions
   re-scorées »).

**Ce que tu fais** : récupère le feedback, extrais le pattern (ce qu'il a aimé,
ce qu'il a masqué, ce qu'il a mis en favori), traduis-le en priorités pour les
Scout et — si c'est justifié — en un re-score borné. Puis rends compte et
attends que l'utilisateur change de mode. **Avec C-25** : calibration faite +
marge → le surplus retourne au sourcing (avec la NOUVELLE priorité) sauf
interdiction. **NE fais PAS** : re-scorer toute la DB, inventer des préférences
que le feedback ne montre pas, ou continuer à sourcer avec l'ancienne visée.

## `saving` — risparmio (économie : minimum de survie)

1. **Files actives** : aucune autonome. Uniquement ce que l'utilisateur demande
   explicitement : réponses de chat, tickets (C-15), flags pilotés par
   l'utilisateur (write/geocode/recheck demandés — ceux-là ne passent jamais
   par une policy).
2. **Suspendu** : le sourcing ET tout enrichissement autonome (recheck,
   geocode, logo). Les workers qui ne servent à aucune demande utilisateur en
   attente sont tués ou laissés non spawnés.
3. **Priorité de budget** : quasi nulle. La seule dépense est de répondre à
   l'utilisateur.
4. **Condition de sortie** : aucune — il dure jusqu'à ce que l'utilisateur le
   lève. Rien à épuiser ; le banner le dit.

**Ce que tu fais** : garde Capitano/Assistente/Mentor réactifs ; rien d'autre
ne bouge sans une demande directe de l'utilisateur. **Avec C-25** : l'économie
EST une interdiction explicite de l'utilisateur sur la dépense autonome — ici
C-25 NE débloque PAS le sourcing ; si du budget part en fumée, tu le DIS à
l'utilisateur (c'est l'autre moitié de C-25), tu ne le dépenses pas. **NE fais
PAS** : réinterpréter « minimum » en « un peu de sourcing ne fera pas de mal ».

---

## Règles transversales aux modes

- **C-25 (ne jamais gaspiller le budget)** se compose avec chaque mode :
  travail propre au mode TERMINÉ + marge → le travail utile par défaut est le
  sourcing au pace d'1 Scout — sauf là où le mode ou l'utilisateur interdisent
  explicitement la dépense (économie ; une interdiction explicite du tableau),
  où le bon geste est de rapporter le budget restant. C-25 ne prime jamais sur
  un frein : les caps weekly/quotidiens, `work_phase=OFF`, les gates de C-23 et
  les throttles de l'utilisateur gagnent tous.
- **Les gates de pacing sont indépendants du mode** : aucun mode n'autorise à
  burster ni à ignorer `vel_target` ; un mode change seulement OÙ va le budget
  dosé.
- **Sortie ≠ changement.** Quand un mode rapporte son travail épuisé, préviens
  l'utilisateur et continue d'honorer le mode jusqu'à ce que ce soit LUI qui en
  change. Le fichier est écrit par la console du jeu au nom de l'utilisateur —
  jamais par toi.

## Voir aussi

- `mode_banner.py` (`shared/skills/`) — compose le banner horaire depuis le
  disque ; `python3 /app/shared/skills/mode_banner.py show` le relit à la
  demande.
- **C-18** dans ton fichier d'identité — la règle complète du mode soin.
- `sentinel-orders`, `pipeline-triage`, `scaling-calc` — les leviers que chaque
  mode pointe vers des files différentes.
