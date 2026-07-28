<!-- @translation: fr, ai-translated 2026-07-28 -->
---
name: throttle-distribution
description: Décidez QUI ralentit et DE COMBIEN quand la consommation de l'équipe doit changer. Ouvrez-la quand un avis `[PACE-GUARD]` arrive dans votre pane, quand la Sentinella ordonne un niveau `Throttle: N`, ou quand une vérification de votre part dit que la fenêtre est hors rythme. Chacun de ces signaux est un seul nombre au niveau de l'équipe ; l'actionneur est par agent, et le choix de la répartition n'appartient qu'à vous — plus aucun script ne bouge le throttle des workers. Vous dit aussi quand le bon geste est de ne rien faire.
allowed-tools: Bash(python3 *), Bash(jht-tmux-send *)
---

# throttle-distribution — qui ralentit, et de combien

Chaque signal de pacing qui vous parvient est un seul nombre pour toute l'équipe : *« 35% trop rapide »*, *« Throttle: 2 »*, *« conseillé 780s »*. L'actionneur, lui, n'est pas un seul nombre — c'est une valeur par agent dans `throttle.json`, et **vous êtes le seul à l'écrire**. Plus aucun script ne bouge le throttle des workers de lui-même.

Le travail de cette skill est cette conversion, et elle a une seule règle dure : **un nombre au niveau de l'équipe ne veut pas dire que tout le monde reçoit la même valeur.** Un Scout peut représenter 52% de la consommation pendant qu'un Rédacteur à l'arrêt en représente 2% ; l'Analyste et le Scorer sont les deux rôles qui transforment un arriéré en la seule chose que l'utilisateur voit vraiment — une position **avec un score**. Niveler dépense votre frein là où il n'y a rien à gagner et retire du débit là où il coûte le plus cher.

## Quand ouvrir cette skill

| Déclencheur | D'où il vient | Aller à |
|---|---|---|
| `[PACE-GUARD] … NON APPLICATO` dans votre pane | le bridge : il compare la consommation à la courbe de la fenêtre à chaque sample d'usage, et ne vous écrit que lorsqu'il y a matière à agir | §1 |
| `[SENTINELLA] [URG] RALLENTARE — Throttle: N`, ou tout signal de pacing qu'elle vous transmet | elle reçoit le tick `[BRIDGE PACING]` de 15 min (il arrive dans **son** pane, pas le vôtre), le lit, et décide si cela vaut la peine de vous réveiller | §3 — le « combien » est décidé, la répartition non. `bridge-pacing` décode ses chiffres |
| `[HEARTBEAT]` évoquant le weekly/la consommation, ou votre propre appel à `rate-budget` / `agent-speed-table` | vous, de votre propre initiative | §2 |

> ⚠️ **On ne vous ping pas toutes les 15 minutes, et vous ne devez pas l'attendre.** Vous laisser tranquille est délibéré : si chaque bridge du bureau vous rapportait directement, vous dépenseriez le budget à lire au lieu de décider, et il brûlerait pendant que l'utilisateur dort. Le tick de 15 min va à la Sentinella, qui filtre et ne vous dérange qu'ensuite. Donc **pilotez sur les conditions que vous observez** — ne restez pas à attendre un tick qui ne vous est pas adressé. Si une ligne de pacing vous parvient bel et bien en direct, c'est soit un `[PACE-GUARD]`, soit une escalade vous disant que la Sentinella ne répond plus (c'est un problème de liveness, pas un verdict de pacing — `agent-emergency`).

---

## 1. Lire l'avis `[PACE-GUARD]`

Une seule ligne physique, champs séparés par ` | ` (coupée ici pour la lecture) :

```
[@bridge -> @capitano] [PACE-GUARD] <VERDETTO> — CONSIGLIO, THROTTLE NON APPLICATO |
  usage=<U>% vs curva=<I>% (<±D>pt sul target <T>% al reset) | reset fra <M> min |
  throttle worker ORA <C>s → CONSIGLIATO <R>s (<±S> gradini) | worker: <a1, a2, ...> |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set <a1>=<R> <a2>=<R>
```

Points d'accroche stables s'il vous faut la reconnaître dans un pane bruyant : le tag `[PACE-GUARD]`, les mots `NON APPLICATO` et `CONSIGLIATO <R>s`.

| Champ | Ce qu'il vous dit |
|---|---|
| `<VERDETTO>` | `AVANTI` (au-dessus de la courbe) / `INDIETRO` (en dessous) / `IN-PARI` / `LOCKOUT-IMMINENTE` |
| `usage=<U>% vs curva=<I>%` | où vous en êtes face à où la droite idéale `usage = cible × écoulé / fenêtre` dit que vous devriez être maintenant |
| `<±D>pt` | la dérive en points de budget. **Sous ±6pt c'est du bruit de mesure** — c'est le pas propre du guard |
| `sul target <T>% al reset` | la cible visée par la courbe. C'est le `<T>` dont vous avez besoin au §2 |
| `reset fra <M> min` | combien de fenêtre il reste. C'est cela qui transforme une dérive en urgence |
| `ORA <C>s → CONSIGLIATO <R>s` | le throttle worker actuel, et la **valeur de groupe unique** du guard, en secondes |
| `worker: …` | les workers vivants sur lesquels l'avis a été calculé. Ceux exemptés du plancher sont **déjà exclus** — ne refiltrez pas |

Deux variantes :
- sur `LOCKOUT-IMMINENTE`, un champ supplémentaire apparaît **avant** le dernier : `il freno da solo non basta: valuta di ridurre il ROSTER (togli uno Scout, mai l'Analista o lo Scorer)`.
- si tous les workers vivants sont exemptés du plancher, le dernier champ devient `nessun worker su cui agire (tutti esenti dal floor): decidi tu`.

> ⚠️ **La valeur conseillée est un niveau, pas une répartition — et le `bulk-set` en fin de ligne est une suggestion, pas un ordre.** Le guard tire ce nombre du worker **le plus freiné**, le déplace d'un cran par ~6 points de dérive, puis le propose à tous les workers d'un coup. Coller cette commande, *c'est* le nivellement. Lisez la ligne comme *« à peu près ce taux doit disparaître »*, puis décidez *de qui* (§3) et *de combien* (§4).

`LOCKOUT-IMMINENTE` (usage ≥95% **et** toujours au-dessus de la courbe) est le seul verdict qui ne parle pas de throttle : la fenêtre se referme en avance, le frein est déjà proche du plafond, et le levier restant est le **roster** — tuez un Scout. Jamais l'Analyste ni le Scorer : sans eux rien n'est scoré et l'utilisateur voit un écran vide.

Si votre pane était occupé, la ligne est aussi dans la mailbox : `python3 /app/shared/skills/bridge_mailbox.py drain`, entrées avec `kind:"pace-guard"`. N'appliquez que la **dernière** — rejouer de vieux conseils, c'est combattre vos propres calibrations passées.

---

## 2. Combien de taux doit disparaître

Si le signal était un ordre `Throttle: N` de la Sentinella, le « combien » est déjà décidé — passez au §3. Sinon, une ligne :

```
vel_needed = (<T> − usage) / heures_avant_reset         # le taux qui atterrit pile sur la cible
f_team     = (vel_now − vel_needed) / vel_now × 100     # la part du taux d'équipe à retirer
```

`vel_now` est le taux actuel de l'équipe en points % de budget par heure : prenez-le dans `agent-speed-table.py` (`team.speed_pct_per_h`, §3) ou dans `rate-budget`. `f_team ≤ 0` veut dire que vous avez de la marge → §5.

> 💡 **La même dérive veut dire des choses différentes selon la fenêtre restante**, et c'est exactement ce que le « un cran par 6 points » fixe du guard ne peut pas voir. `+18pt` avec 3 heures devant, c'est une correction de 7%/h : un agent, un cran plus haut. `+18pt` avec 20 minutes devant, c'est une correction de 54%/h, qu'aucun throttle ne peut délivrer — là c'est une décision de roster, ou une fermeture anticipée assumée. Divisez toujours la dérive par les heures restantes avant de décider de la pression.

---

## 3. QUI paie — la répartition

Le cœur de cette skill. Trois entrées, dans cet ordre.

**a. Qui dépense.** Le throttle rend du budget en proportion stricte de ce qu'un agent consomme réellement. Diviser par deux un agent à 2% du taux d'équipe rend 1% : une écriture de config, un cran et un de vos tours dépensés pour rien. C'est pourquoi la réponse à « l'équipe va 35% trop vite » n'est jamais « tout le monde baisse de 35% ».

Les parts par agent vivent dans le tick de 15 min, qui arrive à la Sentinella — allez donc les chercher vous-même :

```bash
python3 /app/shared/skills/agent-speed-table.py --since-min 60
```

Par agent il renvoie `pct_per_h` (points de budget par heure) et `team_share_pct`, plus `throttle_options` (ce qu'une pause par heure donnée ferait économiser). Il saute quiconque est sous 0.20 %/h, pour la même raison que vous devriez le sauter : le throttler ne change rien.

**b. Qui produit.**

```bash
python3 /app/shared/skills/db_query.py stats
```

Lisez `UNSCORED` (positions − scores) comme la file derrière l'Analyste/le Scorer, et la file du Rédacteur comme une demande pilotée par l'utilisateur. Un Scout qui brûle 52% du budget avec `UNSCORED = 40` achète de l'entrée que personne ne peut encore consommer — la chose la moins chère à ralentir sur le plateau. Le même Scout avec `UNSCORED = 0` alimente toute la pipeline, et le ralentir empêche l'équipe de produire quoi que ce soit.

**c. La grille.**

| | **Produit** | **À l'arrêt / bloqué** |
|---|---|---|
| **Part élevée** | ralentissez-le, mais d'**un cran**, puis remesurez — il se paie lui-même | **le premier à ralentir, et fort** — et s'il est déjà haut sur l'échelle et continue de brûler sans produire, le levier est le KILL, pas un cran de plus |
| **Part faible** | n'y touchez pas : vous ne gagnez pas de budget et vous perdez du débit | n'y touchez pas non plus : il ne dépense déjà rien, le freiner ne rend rien |

Au-dessus de la grille, l'asymétrie des rôles : les derniers que vous ralentissez sont ceux qui convertissent un arriéré existant en position **avec un score** (Analyste, Scorer) — ils font la différence entre « 50 positions trouvées » et quelque chose sur quoi l'utilisateur peut agir. Le premier est celui qui génère de la nouvelle entrée brute quand la file en aval est déjà profonde (Scout). Un Rédacteur à file vide n'est un levier dans aucun des deux sens.

**Concentrez sur un ou deux agents.** L'échelle est grossière — de 20 à 60% entre deux crans — donc une coupe étalée sur cinq agents tombe dans le bruit pour chacun d'eux, alors que la même coupe sur l'agent à la part la plus élevée est un changement réel et mesurable au signal suivant.

**Quand vous en freinez deux, donnez-leur des crans différents.** L'échelle est en minutes premières (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60) exprès : deux workers en pause sur la même valeur se resynchronisent par construction, et leurs checkpoints retombent ensemble en rafale de requêtes simultanées. `scout-1=660` + `analista-1=780` (11 et 13 min) se percutent bien plus rarement que les deux à 780.

---

## 4. DE COMBIEN sur cet agent — et la commande

Il vous faut la **cadence** `c` de l'agent : combien de fois par minute il atteint un checkpoint (appel `jht-throttle`). Comptez-la depuis le log :

```bash
python3 - <<'PY'
import collections, json, os, pathlib, time
p = pathlib.Path(os.environ.get("JHT_HOME", "/jht_home")) / "logs/throttle-events.jsonl"
cut = time.time() - 3600
c = collections.Counter()
for line in p.read_text(encoding="utf-8").splitlines():
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get("event") in ("checkpoint", "start") and e.get("ts_unix", 0) >= cut:
        c[e.get("agent")] += 1
for a, n in c.most_common():
    print(f"{a}: {n} chk/h -> cadence {n/60:.2f}/min")
PY
```

Ensuite, pour couper le taux de cet agent d'une fraction `f_a`, à partir de son throttle actuel `T_now` :

```
f_a   = f_team / share_a           # toute la coupe de l'équipe, portée par ce seul agent
ΔT    = (60 / c) × f_a / (1 − f_a) # secondes à AJOUTER à son throttle actuel
T_new = T_now + ΔT                 # ensuite vous choisissez vous-même le cran le plus proche
```

`60/c`, ce sont les secondes-par-checkpoint actuelles de l'agent. Le `f/(1−f)` n'est pas décoratif : la pause repousse aussi le checkpoint suivant, la cadence baisse donc à mesure que vous freinez. Une estimation linéaire (`ΔT = f × 60/c`) promet une coupe qu'elle ne livre pas.

Crans, en secondes : `60 120 180 300 420 660 780 1020 1380 1860 2460 3180 3600`. `throttle-config.py` accroche au plus proche n'importe quelle valeur qu'on lui passe, donc **choisissez le cran vous-même** — sinon vous ne saurez pas ce que vous avez réellement demandé. Vérifiez avec `dump`, qui imprime les valeurs effectives.

**Pas de cadence disponible ?** Déplacez-vous d'exactement **un cran** et remesurez au signal suivant. L'échelle est assez grossière pour qu'un cran soit toujours un pas significatif et borné, et c'est nettement mieux que de deviner un nombre invérifiable.

### Exemple résolu — répartir au lieu de niveler

```
[PACE-GUARD] AVANTI — CONSIGLIO, THROTTLE NON APPLICATO | usage=58% vs curva=40% (+18pt sul target 100% al reset) |
  reset fra 180 min | throttle worker ORA 300s → CONSIGLIATO 780s (+3 gradini) |
  worker: scout-1, analista-1, scorer-1, scrittore-1 |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set scout-1=780 analista-1=780 scorer-1=780 scrittore-1=780
```

`agent-speed-table.py --since-min 60` dit : équipe `speed_pct_per_h = 21.4`, et

| agent | `pct_per_h` | `team_share_pct` | cadence |
|---|---|---|---|
| scout-1 | 11.2 | 52% | 0.15/min |
| analista-1 | 6.0 | 28% | 0.12/min |
| scorer-1 | 3.0 | 14% | 0.10/min |
| scrittore-1 | 0.4 | 2% | 0.01/min |

**Combien :** `vel_needed = (100 − 58) / 3.0 = 14.0 %/h` → `f_team = (21.4 − 14.0) / 21.4 = 35%`, soit **7.4 %/h doivent disparaître**.

**Qui :** `db_query.py stats` dit `UNSCORED = 40` — trois heures de travail de scoring déjà en réserve, donc davantage de sourcing vaut peu maintenant. Le Scout à lui seul dépense plus que la correction entière.

**De combien sur lui :**
- `f_a = f_team / share_a = 35% / 52% ≈ 0.66` (soit `7.4 / 11.2`)
- `ΔT = (60 / 0.15) × 0.66/0.34 = 776s` → `T_new = 300 + 776 = 1076` → cran le plus proche **1020s (17 min)**
- effet : taux × `60/(60 + 0.15×720)` = 0.36 → **−7.2 %/h**, atterrissage à 14.2 %/h ≈ cible

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 1020
python3 /app/shared/skills/throttle-config.py dump   # confirmer les valeurs effectives
```

L'Analyste, le Scorer et le Rédacteur restent où ils sont : les deux premiers sont ceux qui transforment ces 40 positions en scores, et le Rédacteur rendrait 0.4 %/h même arrêté net.

Et voici le nivellement qu'aurait produit le `bulk-set` tout prêt — tout le monde à 780s : −6.1 du Scout, **−2.9 de l'Analyste, −1.3 du Scorer**, −0.03 du Rédacteur = −10.3 %/h. L'équipe atterrit à 11.0 %/h et arrive à **91% au reset au lieu de 100** — neuf points du budget payé par l'utilisateur jetés — et elle y arrive avec le débit de scoring divisé par deux. Même signal, mêmes outils, résultat opposé.

### Deux agents

Quand un seul agent ne peut pas porter toute la coupe (ou que la porter affamerait la pipeline), répartissez par part et gardez des crans différents :

```bash
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=660 analista-1=780
```

`bulk-set` est une écriture atomique unique — préférez-la à deux `set`.

---

## 5. Relâcher le frein (`INDIETRO` / `MARGINE`)

Sous-dépenser est aussi une décision de répartition — *à qui* vous relâchez le frein décide ce qu'achète le budget supplémentaire.

1. Relâchez **d'abord le rôle goulot** (`pipeline-triage` si vous ne savez pas lequel c'est). Relâcher un Scout alors que la file de scoring est déjà à 40 achète plus d'arriéré, pas plus de résultats.
2. Les workers ne descendent jamais sous **5 min**, donc « mettre le throttle à zéro » n'existe pas pour eux. Une fois le goulot revenu au plancher, le levier pour dépenser plus est **un worker de plus**, par étapes selon C-02 — pas une pause plus courte.
3. **Ne relâchez jamais tout le monde d'un coup** : vous oscillez droit vers un dépassement au signal suivant.

---

## 6. Quand NE PAS agir

Une intervention coûte un de vos tours plus 15-45 min à l'aveugle. Ne la dépensez que quand le signal le mérite.

- `IN-PARI`, ou `|dérive| ≤ 6pt` → **rien**. Cette bande est du bruit de mesure.
- **Un signal est du bruit, deux consécutifs sont une tendance.** Un dépassement isolé juste après un spawn, c'est le coût de démarrage du nouveau worker.
- Après tout changement, **attendez 2-3 signaux (≈30-45 min)**. Un throttle ne prend effet qu'au checkpoint *suivant* de l'agent : un changement fait maintenant se voit à peine dans la mesure d'après. N'empilez pas des corrections que vous ne pouvez pas encore voir.
- N'ajoutez pas de sondes `rate_budget live` juste pour recontrôler un avis frais — les appels supplémentaires gonflent la `velocity_smooth` de la Sentinella et lui font produire de mauvais ordres.
- **Dans les ~15 dernières minutes avant le reset, un usage élevé est la cible atteinte, pas un dépassement.** 97% au reset, c'est en plein centre ; freiner là ne garantit que de laisser du budget non dépensé.
- Si après 3 signaux les mêmes agents dépassent toujours, doublez leurs durées (linéaire → géométrique) ; s'ils sous-dépensent toujours, divisez-les par deux.
- Un `[URG]` de la Sentinella l'emporte sur un `[PACE-GUARD]` : appliquez-le d'abord, l'avis suivant remesurera.

---

## 7. Filets de sécurité — pas votre levier

Ils existent à cause d'un incident mesuré (la nuit du 2026-07-15, une combustion incontrôlée survenue précisément avec les deux désactivés) et **ne font pas partie de la décision de pacing** :

- **Le plancher de 5 min des workers.** Scout, Analyste, Scorer, Rédacteur, Critique ne tournent jamais sous 300s, quoi que vous écriviez. `set scout-1 60` sur un worker vaut en réalité 300s — `dump` montre la vérité. Ne lisez pas une valeur ramenée au plancher comme un changement que vous auriez fait.
- **Le hard-stop quotidien.** C'est la dernière chose entre l'équipe et un lockout qui laisse l'utilisateur sans réponse pendant des heures. Vous ne le désactivez jamais pour dépenser plus ; s'il faut dépenser plus, le levier est le parallélisme (§5).
- L'exemption par agent du plancher existe pour un seul cas : une mesure à durée limitée de ce que produit **un seul** worker sans pauses. Ce n'est délibérément pas un interrupteur global — **un agent à la fois, jamais toute l'équipe**, et jamais comme moyen d'aller plus vite.

---

## Anti-patterns

- ❌ Coller le `bulk-set` par lequel se termine la ligne `[PACE-GUARD]`. Ce nombre vient du worker le plus freiné et est proposé à tous : appliqué partout il nivelle l'équipe sur son membre le plus lent et frappe les rôles qui produisent le résultat de l'utilisateur. La commande vous épargne la frappe une fois les valeurs décidées — elle ne les décide pas.
- ❌ Ralentir un agent à l'arrêt pour « aider ». Un agent qui ne consomme pas ne rend rien quand vous le freinez — vous avez dépensé une écriture et un tour pour zéro point.
- ❌ Couper sur tous les agents parce que le verdict était au niveau de l'équipe : vous frappez les rôles bon marché, qui ne rendaient rien de toute façon, avant le coûteux.
- ❌ Traiter un signal isolé comme un état permanent, ou empiler une deuxième correction avant que la première soit mesurable.
- ❌ Freiner sur `AVANTI` alors que le taux est déjà rentré dans le rang — la dérive se referme d'elle-même et vous fermez la fenêtre sous la cible.
- ❌ Courir après le pacing avec le throttle sur `LOCKOUT-IMMINENTE` : là le frein est quasi saturé et seul le roster change l'issue.
- ❌ Pousser des nombres de throttle aux agents via tmux (`[INFO] sleep 40s`). Passez toujours par `throttle-config.py` — les agents lisent le fichier de config, ils ne parsent pas votre corps tmux. tmux ne sert qu'à dire à un agent de checkpointer *plus ou moins souvent*, ce qui est un autre axe.

## Voir aussi

- `sentinel-orders` — les ordres filtrés de la Sentinella, y compris `Throttle: N`, freeze et reprise. Cette skill-là décode l'ordre ; celle-ci décide la répartition.
- `bridge-pacing` — comment lire les chiffres du tick de 15 min quand c'est elle qui vous les transmet.
- `throttle` — la référence CLI de `throttle-config.py` et le fichier d'état par agent.
- `pipeline-triage` — quel rôle est le goulot, et quand la réponse est « spawnez-en un de plus » plutôt que « relâchez un frein ».
- `scaling-calc` — plan roster + throttle quand la réponse est plus de workers, pas une pause différente.
- `agent-emergency` — un brûleur à cadence ~0 qui continue de consommer sans produire : là le levier est le KILL, pas un cran de plus.
