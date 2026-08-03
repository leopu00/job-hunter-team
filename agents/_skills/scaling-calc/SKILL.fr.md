<!-- @translation: fr, ai-translated 2026-08-03 -->
---
name: scaling-calc
description: "Calibrage progressif du roster — mesure le burn d'1 worker, calcule combien de workers et quel throttle il faut pour atteindre la vitesse cible, et spawne par paliers (jamais en sixième)."
---

# 🎚️ scaling-calc — monte les rapports un cran à la fois, ne démarre pas en sixième

Quand l'équipe ouvre la fenêtre de travail (ou que tu dois consommer davantage), ne pars
**PAS** en sixième (« du budget à revendre → spawner 5 scouts / throttle à 0 ») : tu ne sais
pas encore ce qu'un worker consomme vraiment dans CE cycle-ci. Tu te calibres par paliers.

## Procédure

**1. Commence par 1 SEUL worker** au floor (5min, le minimum pour les workers).

**2. Observe pendant ~30 min** pour mesurer le burn réel. Lis le burn du worker :
```
python3 /app/shared/skills/rate_budget.py            # vitesse cible soutenable (S)
# burn par agent : depuis le tableau que la Sentinella te transmet, ou :
python3 /app/shared/skills/agent-speed-table.py
```
Prends : **S** = vitesse soutenable (p. ex. `sustainable_burn` %weekly/h) et **b** = le burn
mesuré du worker (même unité).

**3. Calcule** roster + throttle :
```
python3 /app/agents/_skills/scaling-calc/scaling_calc.py --target <S> --measured <b>
# si tu as observé N workers au throttle T :
python3 .../scaling_calc.py --target <S> --measured <b_total> --workers <N> --throttle <T>
```
Il te donne : **combien de workers**, **quel throttle**, et un **plan par paliers**.

**4. Spawne PAR PALIERS** en suivant le plan : **un à la fois**, en **remesurant** avant le
suivant (~10 min suffisent pour voir le burn du nouveau venu). Ne spawne JAMAIS tout le bloc
d'un coup.

> Ces 10 minutes sont une **fenêtre d'observation**, pas un déphasage : la distance de phase
> entre deux workers d'un même palier vaut `T/N` (la période divisée par le nombre de workers
> qui se la partagent) et le launcher l'applique de lui-même au moment du spawn. Ce n'est pas
> un nombre à décider ici, et ce n'est pas une constante : sur un palier de 5 minutes, trois
> workers veulent être à 100s les uns des autres.

## Les deux leviers
- **Worker sous la cible** (1 worker brûle moins que la cible) → le levier est le **nombre de
  workers** (parallélisme), tous **au floor**. Ajoute-les par paliers.
- **Worker au-dessus de la cible** (1 worker brûle déjà plus que la cible) → le levier est le
  **throttle** : garde 1 worker et **augmente** son throttle (l'outil te donne la valeur
  exacte). Ne mets JAMAIS le throttle à zéro (les workers ont de toute façon un floor de 5min).

## Ce qu'il ne faut PAS faire
- ❌ « Équipe ON, du budget à revendre → ON ACCÉLÈRE TOUT » — c'est la frénésie qui brûle une
  fenêtre de budget en 25 min pour zéro output. **ACCÉLÉRER = monter d'UN cran** (un worker de
  plus, ou un cran de throttle en moins **jusqu'au floor**), puis remesurer.
- ❌ Spawner 2-3 workers ensemble. Toujours **échelonnés**.
- ❌ Throttle à 0 sur un worker (impossible : floor de 5min ; et de toute façon c'est de ça que sont faits les marathons).

## Exemple
1 scout au floor (5min) a brûlé **1.4%/h**, cible soutenable **0.7%/h** :
```
scaling_calc.py --target 0.7 --measured 1.4
→ 1 worker @ 600s (10min) → burn ≈ 0.7/h   (il suffit d'augmenter le throttle, aucun spawn)
```
Si au contraire 1 scout ne brûle que **0.3%/h** avec une cible de 0.7 :
```
→ 2 workers @ 300s (floor), par paliers : spawne le #1, observe 10min, remesure, puis le #2.
```
