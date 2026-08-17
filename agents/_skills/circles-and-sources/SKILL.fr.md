<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: circles-and-sources
description: Carte stratégique de quoi chercher OÙ, dérivée entièrement du profil candidat. Les 5 cercles concentriques (work_mode + relocation) vous indiquent la portée géographique ; les 4 niveaux de sources (LinkedIn → agrégateurs ATS → niche → web) vous indiquent quelles plateformes drainer dans l'ordre. Un scout qui cherche au mauvais niveau dans le mauvais cercle gaspille son quota et sa partition `scout-coord`. Ouvrez cette skill au démarrage (après `scout-coord`) et à chaque fois qu'un cercle est épuisé ou qu'un `[FEEDBACK]` de l'Analista suggère de changer de source.
allowed-tools: Bash(python3 /app/shared/skills/safe_fetch.py *), Bash(python3 /app/shared/skills/linkedin_check.py *)
---

# circles-and-sources — lire le profil, construire la carte

Deux axes orthogonaux :
- **Cercles** = OÙ (portée géographique / mode de travail)
- **Niveaux** = QUELLES plateformes (par ordre de priorité)

Les deux proviennent de `$JHT_HOME/profile/candidate_profile.yml`. **Ne supposez pas** : lisez `preferences.work_mode`, `location`, `preferences.relocation`, puis construisez les cercles en fonction de ce que le candidat veut réellement.

## Les 5 cercles concentriques

Épuisez chaque cercle de l'intérieur vers l'extérieur avant de passer au suivant.

| # | Cercle                       | Ce que c'est                                                                                                | Quand y entrer                                                           |
|---|------------------------------|-------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | 🎯 **Préférence principale** | Le mode + la géographie que le candidat a déclaré comme priorité.                                           | Toujours commencer ici. L'épuiser en premier.                            |
| 2 | 🗺️ **Voisins géographiques** | Zones immédiatement extensibles depuis le cercle 1.                                                         | Uniquement si `relocation` le permet OU si le cercle 1 est épuisé.       |
| 3 | ✈️ **Relocation ciblée**     | Villes / pays listés dans `preferences.relocation` (ou inférés de `"ovunque"` / `"Europa"`).               | Uniquement si `relocation` est non-vide (true / liste / `"ovunque"`).    |
| 4 | 🛰️ **Satellite**            | Géographie hors de la cible principale, probabilité plus faible.                                            | Uniquement si les cercles 1-3 sont épuisés.                              |
| 5 | 🌗 **Frontière**             | Rôles **adjacents** au stack principal du candidat (sous-domaines de la même langue, cross-fonctionnel, automatisation, ML adjacent, etc.). Le candidat est considéré comme adaptable ; le Scorer applique la pénalité de gap en aval. | Uniquement après que les cercles 1-4 sont épuisés pour la journée. |

### Comment matérialiser le cercle 1 depuis le profil

```yaml
preferences:
  work_mode: <remoto|ibrido|in sede|flessibile>
  ...
location: <city/area>
preferences:
  relocation: <true|false|"per la giusta posizione"|list>
```

| `work_mode`   | Cercle 1 = QUOI chercher                                                                                |
|---------------|---------------------------------------------------------------------------------------------------------|
| `remote`      | Rôles remote compatibles avec le fuseau horaire / pays du candidat (ex. `Remote (EU only)` pour basé en UE)   |
| `on-site`     | Rôles dans `location` (ville de base) uniquement                                                        |
| `hybrid`      | Rôles dans la ville de `location`, tagués hybrid ou rayon de trajet                                     |
| `flessibile`  | Union des trois ci-dessus — épuiser dans l'ordre remote → ville → hybrid                                |

### Cercle 2 — voisins géographiques

| Type cercle 1    | Extension cercle 2                                                                            |
|------------------|------------------------------------------------------------------------------------------------|
| Remote (national)| Remote régional / continental compatible avec le fuseau horaire + autorisation de travail du candidat |
| On-site          | Région / zone métropolitaine du pays de base                                                  |
| Hybrid           | Identique à on-site (élargissement du rayon de trajet)                                        |

### Cercle 3 — relocation ciblée

Uniquement si `preferences.relocation` est non-vide :

| Valeur `relocation`    | Extension cercle 3                                                                          |
|------------------------|---------------------------------------------------------------------------------------------|
| Liste (`["Berlin", "Lisbon"]`) | Uniquement ces villes                                                                |
| `"ovunque"`            | Hubs mondiaux **pour le domaine du candidat** (finance → Londres, NYC, Zurich, Francfort, Singapour, Dublin, Luxembourg ; tech → SF, Berlin, Amsterdam, Lisbonne, Tel Aviv…). **Alterner entre eux en round-robin — NE PAS drainer le hub le plus dense (ex. Londres pour la finance) en premier**, sinon la liste finale sera dominée par un seul hub (voir règle anti-biais, garde location). |
| `"Europa"`             | Hubs tech UE (Berlin, Londres, Amsterdam, Lisbonne, Dublin, Madrid, Paris, Stockholm, ...)  |
| `"per la giusta posizione"` | Sauter le cercle 3, marquer les candidats limites du cercle 4 avec le drapeau relocation dans les notes |

## Les 4 niveaux de sources

Épuiser un niveau complètement avant de passer au suivant.

| Niveau | Type                                | Sources                                                                                                       | Notes                                                                                          |
|--------|-------------------------------------|--------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| 1    | **LinkedIn**                        | `linkedin_check.py` (profil authentifié), `safe_fetch.py`                                          | Universel : couvre remote, on-site, hybrid. Première étape obligatoire pour chaque cercle. **JAMAIS `fetch` MCP** — bloqué par robots.txt. |
| 2    | **Agrégateurs ATS**                 | Boards Greenhouse, boards Lever, Indeed, Wellfound (ex AngelList)                                            | Fonctionne pour tout work_mode. Couvre beaucoup d'entreprises en un seul scrape.               |
| 3    | **Boards niche (spécifiques au profil)** | Choisir par `work_mode` ET domaine                                                                     | (voir tableau ci-dessous)                                                                      |
| 4    | **WebSearch + pages carrières**     | Requêtes `WebSearch` + scrape de pages carrières d'entreprises                                              | Dernier recours uniquement après avoir drainé les niveaux 1-3.                                 |

### Niveau 3 — choisir par work_mode + domaine

| `work_mode` du candidat | Boards niche à considérer                                                                                     |
|-------------------------|--------------------------------------------------------------------------------------------------------------------|
| `remote`                | Remote.co, WeWorkRemotely, RemoteOK, EURemoteJobs (ou équivalents régionaux)                                      |
| `on-site` / `hybrid`    | Boards locaux / nationaux (InfoJobs, Glassdoor régional, Stepstone, Welcome to the Jungle FR, ...)                |
| `flessibile`            | Combiner remote + local                                                                                           |
| Spécifique au domaine (tout)   | Niche par stack : PyJobs (Python), GoJobs (Go), Djinni (Europe de l'Est / dev), 4dayweek.io (semaine 4 jours), ... |

> ⚠️ **N'apportez pas de boards spécifiques remote dans une recherche non-remote**, et inversement. WeWorkRemotely pour un candidat qui veut du on-site à Milan est du scraping gaspillé.

## Règle anti-biais (obligatoire) — sur **entreprise ET localisation**

Deux gardes indépendantes, toutes deux en fin de lot :

1. **Entreprise** : si **> 30% des positions d'un seul lot proviennent d'une seule entreprise**, changez de source/requête pour le lot suivant. Une scale-up qui déverse 12 rôles sur un board inonde le pool — la diversité compte plus que le volume.
2. **Localisation** (ville/zone) : si **> 40% d'un seul lot provient d'une seule ville**, le lot suivant DOIT cibler une *autre* ville du cercle. Sans cela, un candidat ouvert à un cercle multi-villes (ex. relocation `"ovunque"`/`"Europa"`) obtient un pool dominé par le seul hub qui a le plus d'offres pour son domaine — finance → **Londres**, tech → SF/Berlin. Incident réel (beta tester #2) : un candidat finance a reçu une liste presque exclusivement londonienne parce que Londres surpasse toutes les autres villes d'un facteur ~10×. Alterner entre les villes du cercle en round-robin ; ne pas drainer le hub le plus dense en premier.

```python
# pseudocode pour la vérification en fin de lot
from collections import Counter
batch = [...]
n = len(batch)

# garde 1 — entreprise
top_company, c_count = Counter(p.company for p in batch).most_common(1)[0]
if c_count / n > 0.30:
    log(f"anti-bias company: {top_company} = {c_count}/{n} >30% → switch source/query")

# garde 2 — localisation (ville), CUMULATIF sur tout le run (PAS seulement ce lot)
# La garde par lot ne suffit pas : un hub (Londres pour la finance) reste sous le seuil
# dans chaque lot individuel et pourtant accumule 60% de la DB au fil du temps (vu en live sur
# le beta : London=57/97=59%). Mesurer sur le TOTAL de la DB.
db_by_city = dict(db.execute(
    "SELECT COALESCE(loc_city, TRIM(SUBSTR(location,1,INSTR(location||',',',')-1))), COUNT(*) "
    "FROM positions GROUP BY 1"))
db_total = sum(db_by_city.values()) or 1
top_city, top_n = max(db_by_city.items(), key=lambda kv: kv[1])
if top_n / db_total > 0.35:                       # plafond SOUPLE : aucune ville > ~35% du run
    log(f"anti-bias location CUMULATIF: {top_city}={top_n}/{db_total} (>35%) → "
        f"STOP requêtes sur {top_city}, prochain sweep sur villes prioritaires sous-desservies")
```

**Règle d'équilibrage géographique (cumulative, soft-cap) — incite à la répartition, n'impose pas la parité :**

1. **Lire le profil** : les `priority cities` (champ `location` / `preferences.relocation`) sont la cible. Il est normal et juste que les villes avec plus de fit pèsent davantage — NE PAS forcer un split uniforme.
2. **Mesurer sur tout le run** avant chaque nouveau sweep : `SELECT loc_city, COUNT(*) FROM positions GROUP BY loc_city ORDER BY 2 DESC`.
3. **Soft-cap ~35%** : si UNE seule ville dépasse ~35% du total DB, **arrêter de l'interroger** pour les prochains sweeps et rediriger l'effort. Un hub (ex. Londres pour la finance surpasse toutes les autres villes ~10×) : le laisser courir produit une liste dominée par le hub, inutile pour qui a des priorités multi-villes.
4. **Quota de couverture priorités** : les priority-city du profil à **0 ou sous-desservies** ont la priorité dans les prochains sweeps — dédier des requêtes ciblées (`<provider>:<keyword>:<city>`) jusqu'à ce qu'elles aient une présence minimale, avant de revenir sur les hubs déjà pleins.
5. **Ville hors-profil comme hub = double alarme** : si la ville dominante N'EST PAS parmi les priorités du profil, c'est du hub-bias + off-target → rééquilibrer d'urgence.

### ⚠️ Autorisation de travail comme filtre AVANT l'équilibrage (Brexit, visas)

Équilibrer les localisations ne sert à rien si les offres ne sont pas **accessibles** par l'utilisateur. Avant d'accepter un hub, vérifier la compatibilité de permis de travail avec le profil (citoyenneté / visas déclarés) :

- 🇬🇧 **UK post-Brexit** : un citoyen **UE sans visa UK** NE PEUT PAS travailler à Londres/UK sans **sponsorship** (Skilled Worker visa). Donc pour un profil uniquement UE, les offres UK ne valent **que si** le JD mentionne explicitement *visa sponsorship* ; sinon elles sont incompatibles en autorisation de travail → SKIP (voir "Filtres permissifs", règle géo).
- 🇨🇭 **Suisse / hors-UE** : même logique — vérifier le permis de travail.
- Règle pratique : si le hub dominant est dans un pays qui exige un permis que l'utilisateur n'a pas (et que les JD n'offrent pas de sponsorship), ce volume est **fantôme** — il ne compte pas comme couverture et doit être exclu du pool, pas simplement équilibré.

### 🗣️ Sourcing conscient de la langue — ne pas collecter ce qui sera exclu pour raison linguistique

Même principe que l'autorisation de travail, côté linguistique. Si les **langues de l'utilisateur** (`languages`, avec niveau) NE COUVRENT PAS la **langue de travail locale** d'une ville cible, les rôles qui l'exigent seront écartés en aval par l'Analista (`[LANGUAGE]`) — les collecter est du gaspillage. Cas réel (beta) : candidat avec anglais C1 + allemand conversationnel seulement + pas d'IT/ES/FR → sur 18 exclues, 11 l'étaient pour langue locale obligatoire (M&A en allemand à Munich/Zurich, IB en italien à Milan, etc.).

**Règle :** avant d'interroger une ville dont l'idiome local n'est pas maîtrisé par l'utilisateur au niveau business, **biaiser les requêtes vers des rôles English-first / internationaux** :
- Ajouter des qualificateurs à la requête : `"English-speaking"`, `"international team"`, `"English required"`, noms de multinationales/firmes globales (Big4, bulge-bracket, scale-up internationales) qui travaillent en anglais même sur des marchés non-anglophones.
- Pour les rôles qui **exigent** la langue locale (et l'utilisateur ne la maîtrise pas au niveau business) : les traiter comme les UK-sans-sponsor — ne pas les insérer, ou les insérer uniquement si le JD dit explicitement que la langue locale n'est pas requise.
- Anglais comme langue de travail ≠ pays anglophone : à Amsterdam, Zurich, Luxembourg, Lisbonne beaucoup de rôles finance tournent en anglais. Ce sont le **sweet spot** pour qui parle uniquement anglais mais veut l'Europe continentale.

Résultat : le pool qui survit à l'Analista est plus petit mais **à haut rendement** (accessible par langue ET par autorisation de travail), au lieu de se gonfler de rôles qui seront écartés.

## Filtres permissifs au niveau SCOUT

Le Scout ne pré-filtre que les cas **totalement hors périmètre**. **Ne faites pas le travail de l'Analista** — le candidat est traité comme adaptable aux rôles adjacents. Sauter une offre uniquement si :

- 🚫 Le titre contient explicitement : `senior`, `lead`, `staff`, `principal`, `head of`, `director` → SKIP (écart de seniority trop large)
- 🚫 Autorisation de travail géographique incompatible avec le profil (ex. `US-only` / `Canada-only` et le candidat n'a pas de visa) → SKIP
- 🚫 Domaine complètement hors IT/coding (ex. pâtissier, comptable, commercial) quand le candidat est en IT → SKIP
- 🚫 Exigence stricte de `> années_réelles + 3` ans d'expérience → SKIP (un écart modéré est acceptable, le Scorer décide)

Tout le reste : **l'insérer**. Les stacks adjacents (data, devops, platform, frontend, automatisation, ML adjacent, etc.) passent tous ; le Scorer attribue un score proportionnel au fit et l'utilisateur les voit.

## Écouter les feedbacks de l'Analista

Quand l'Analista envoie `[FEEDBACK]` avec un tag récurrent (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`) :

1. ACK le message
2. Ajuster les requêtes / sources du prochain lot selon la suggestion
3. Prioriser la source/filtre alternatif suggéré pour la prochaine rotation
4. Notifier le Capitano uniquement si un biais systémique émerge (non résolvable par changement de source)

Exemple : l'Analista dit "4 des 5 derniers inserts de greenhouse.io exigent senior+, changez de source". Au prochain lot, vous sautez greenhouse.io, essayez un board Lever ou une source niche junior-friendly.

## Anti-patterns

- ❌ Chercher dans le cercle 2 avant d'épuiser le cercle 1 — gaspille la portée, dilue les résultats.
- ❌ Aller au niveau 4 (WebSearch) avant d'avoir drainé les niveaux 1-3 — `WebSearch` est la source la plus bruyante, la garder pour la fin.
- ❌ Inférer `relocation = "ovunque"` pour un candidat dont le profil dit `false` — lire le profil, ne pas projeter.
- ❌ Utiliser LinkedIn via `fetch` MCP — bloqué par robots.txt ; toujours `linkedin_check.py` (authentifié) ou `safe_fetch.py`.
- ❌ Inclure des JD titrés senior en espérant que le Scorer les filtrera — gaspille le budget du Scorer, ajoute du bruit. Les 4 filtres niveau SCOUT ci-dessus sont le bon endroit.
- ❌ Vérification anti-biais oubliée — une entreprise gourmande submerge votre lot.

## Voir aussi

- `scout-coord` — partition au démarrage entre scouts (COMMENT répartir cette carte entre instances).
- `position-insert` — quoi faire pour chaque position candidate une fois que vous avez décidé OÙ chercher.
- `agents/scout/scout.md` — le prompt orchestrateur du Scout qui appelle cette skill.
- `agents/_team/architettura.md` Phase 1 — vue d'ensemble de la Découverte dans le pipeline.
