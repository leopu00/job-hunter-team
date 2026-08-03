<!-- @translation: fr, ai-translated 2026-08-03 -->
---
name: first-run-burst
description: "La première demi-heure pendant laquelle un utilisateur tout nouveau regarde l'équipe travailler. Ouvre cette skill quand tu reçois `[PROFILO-PRONTO]` de l'Assistente, ou au réveil si `first_run.py status` indique la phase `awaiting_profile` / `burst`. Elle déroge à la calibration progressive (C-02) pour la première fenêtre uniquement, et définit le succès comme des positions AVEC UN SCORE à l'écran — pas comme des positions trouvées."
allowed-tools: Bash(python3 /app/shared/skills/first_run.py *), Bash(python3 /app/shared/skills/plan_registry.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(/app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *), Bash(jht-send *)
---

# first-run-burst — la démonstration dont dépend le fait que l'utilisateur reste

Un nouvel utilisateur termine le setup, allume l'équipe et regarde. Dix minutes plus tard, il a vu
apparaître **une** position brute. Rien ne lui permet de distinguer une équipe qui se dose d'une
application cassée — il conclut donc qu'elle est cassée, et il ne raisonne pas mal.

Ta calibration habituelle (C-02 : un worker, observer 30 minutes, monter d'un cran) est la bonne
règle **en régime établi**, où se tromper coûte une fenêtre de budget. Au tout premier lancement,
cela coûte l'utilisateur. Cette skill est l'exception documentée, et elle vaut **pour la première
fenêtre uniquement**.

## Trigger

- `[@assistente -> @capitano] [PROFILO-PRONTO]` — le profil vient de devenir exploitable
- au réveil, si `python3 /app/shared/skills/first_run.py status` indique
  `phase: awaiting_profile` ou `phase: burst`

## Ce que réussir veut dire, ici

**Des positions avec un score, à l'écran.** Pas des positions trouvées. Un run qui collecte 50
offres et en score 3 (mesuré, 2026-07-26) n'a produit presque rien que l'utilisateur puisse voir : la
shortlist est le produit, le scraping est de la plomberie. Tout ce qui suit découle de cette seule
phrase.

## La procédure

**1. Ouvre le burst et lis le roster.**

```bash
python3 /app/shared/skills/first_run.py begin-burst
```

Il te renvoie le `roster` (combien de Scout / Analista / Scorer), le `scout_cap_first_pass` et le
`target_scored`, tous dérivés de l'abonnement que l'utilisateur a déclaré pendant le setup. S'il
répond `piano non dichiarato` (plan non déclaré), l'étape de setup est incomplète : dis-le à
l'utilisateur dans le chat et arrête-toi — ne **devine pas** un roster, une surestimation lui brûle
sa fenêtre dès le premier jour.

**2. Spawne tout le roster, échelonné d'environ ~60 secondes.**

Pas un worker toutes les dix minutes : toute la formation, à la suite, toujours via `start-agent.sh`
comme d'habitude (C-03). C'est l'exception délibérée à C-02.

**3. N'attends pas des files pleines pour allumer l'aval.**

Spawne l'Analista dès qu'**une** position existe, le Scorer dès qu'**une** position est checked.
L'habitude du « je collecte d'abord, j'évalue ensuite » est exactement ce qui laisse l'utilisateur
devant un tas de lignes sans score.

**4. Plafonne la première passe de sourcing.**

Communique à chaque Scout sa part de `scout_cap_first_pass` et demande-lui de faire remonter
l'information quand il l'atteint, au lieu de sourcer jusqu'à épuisement du budget. Les positions
au-delà de ce plafond ne valent encore rien : elles s'empilent derrière celles que personne n'a
scorées.

**5. Rends compte tôt, pas une fois que tout est terminé.**

Dès que les ~3 premières positions portent un score, envoie à l'utilisateur un `jht-send` court
disant ce qu'elles sont — c'est le moment où l'application cesse d'avoir l'air cassée. Puis continue
jusqu'à `target_scored`.

**6. Ferme le burst.**

```bash
python3 /app/shared/skills/first_run.py check
```

Exécute-le à chaque `[HEARTBEAT]`. Quand il bascule sur `steady`, tu es de retour sous les règles
ordinaires — calibration C-02 comprise.

## La vitesse aussi, c'est toi qui la gères — le bridge ne fait que conseiller

`pace_guard` mesure la consommation par rapport à la courbe de la fenêtre à chaque échantillon du
bridge et t'écrit dans le pane une ligne `[PACE-GUARD]` avec le throttle qu'il recommanderait. Il ne
l'applique **pas** : personne ne l'applique tant que tu n'exécutes pas `throttle-config.py`. Donc :

- **Jamais** de `freeze_team.py` pendant le burst. Une équipe gelée, c'est exactement le silence que
  cette skill existe pour éviter.
- Lis une ligne `[PACE-GUARD]` comme une décision à prendre, pas comme une notification. Elle porte
  la commande déjà écrite pour les workers vivants — adapte-la à qui fait quoi et exécute-la. Si tu
  l'ignores, le rythme ne change pas : aucun script n'ira toucher au throttle à ta place.
- Si elle t'arrive en `LOCKOUT-IMMINENTE`, le frein recommandé est déjà au plafond d'1h — freiner ne
  suffit plus, et le levier est le **roster** : tue un Scout (jamais l'Analista ni le Scorer, sans
  eux plus rien n'est scoré).
- La fenêtre doit atteindre 100% **au reset**, pas avant. Être à 100% à mi-parcours, c'est laisser
  l'utilisateur avec une équipe muette pendant deux heures ; être à 40% au reset, c'est du budget
  laissé sur la table. Ce sont deux échecs, et le premier est bien pire.

## Anti-patterns

- ❌ Ne spawner que des Scout, « le matériau d'abord, les scores plus tard » — le résultat mesuré est
  50 trouvées / 3 scorées, ce qui, pour l'utilisateur, est une app cassée.
- ❌ Attendre un `[BRIDGE TICK]` avant le premier spawn : le trigger, c'**est** le profil prêt.
- ❌ Monter l'échelle de C-02 pendant le burst — cette règle gouverne le régime établi, cette fenêtre
  est l'exception.
- ❌ Geler l'équipe pour protéger le budget. Lent, ça se rattrape ; muet, non.
- ❌ Annoncer le burst à l'utilisateur dans la langue de l'infrastructure (« 4 workers spawnés,
  throttle 300s »). Rends compte de positions, d'entreprises, de scores.

## Voir aussi

- `spawn-agent` — le lancement à proprement parler, inchangé.
- `pipeline-triage` — quel rôle débloque le goulot d'étranglement, une fois en régime établi.
- `scaling-calc` / **C-02** — la calibration progressive que cette skill suspend.
- `chat-web` — comment formuler le premier compte rendu à l'utilisateur.
