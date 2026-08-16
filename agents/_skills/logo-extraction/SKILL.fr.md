<!-- @translation: fr, ai-translated 2026-07-18 -->
---
name: logo-extraction
description: Extrais le logo d'entreprise pour une société de la table companies et enregistre-le comme petit data-URI base64 (max ~35KB, min 32px). La voie primaire est entièrement automatisée via logo_fetch.py sur le site officiel (apple-touch-icon → icon → og:image → favicon) ; quand le site bloque les bots ou n'a pas d'icône exploitable, trouve l'URL directe d'une image du logo via recherche web et passe-la avec --from-url. Vérifie que le site appartient VRAIMENT à l'entreprise AVANT le fetch. Renseigne companies.logo, logo_source, logo_fetched.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch, WebFetch
---

# logo-extraction — logo d'entreprise pour la page de position

Le web affiche le logo de l'entreprise sur la page de détail de la
position. Le logo vit sur la ligne `companies` (UNE par entreprise :
1000 positions Wizz Air = 1 logo) comme petit data-URI base64, et
voyage avec le sync companies existant. Aucun upload, aucun stockage
externe.

## 3 colonnes à renseigner (écrites par `logo_fetch.py`, JAMAIS à la main)

```
logo          text  data-URI base64 (png/jpeg/webp/ico), <= ~35KB raw
logo_source   text  URL d'où le logo a été extrait (audit/refresh)
logo_fetched  bool  true = extraction TENTÉE (même échouée) —
                    patron office_geocoded : l'entreprise sort de la
                    file next-for-logo-missing, pas de retry à chaque
                    passage
```

## RÈGLE d'or : bonne entreprise, bon site

**Un mauvais logo est pire que pas de logo.** Avant de lancer le fetch,
vérifie que `companies.website` appartient VRAIMENT à l'entreprise de
la position (pas un homonyme, pas l'agrégateur qui a publié l'annonce,
pas le mauvais groupe parent). En cas de doute : recherche web
`"<Company> official site"` et compare avec le secteur/pays de la ligne.

- Annonce publiée par une agence/recruteur (Manpower, Randstad, ...)
  MAIS pour le compte d'un hôtel/entreprise nommée → le logo est celui
  de l'entreprise de la ligne `companies` liée à la position.
- Chaîne vs propriété (ex. « CARDO ROMA, Autograph Collection ») :
  utilise le logo de la marque qui figure comme `companies.name`.

## Workflow

### Étape 0 — La file

```bash
python3 /app/shared/skills/db_query.py next-for-logo-missing
```

Liste les entreprises avec positions vivantes et logo jamais tenté,
triées par nombre de positions (les plus visibles d'abord). `NO
WEBSITE (cercalo prima)` = fais d'abord l'Étape 1.

### Étape 1 — Website manquant ? Trouve-le et enregistre-le

```bash
# après recherche web "<Company> official website" :
python3 /app/shared/skills/db_update.py company "<Company>" \
  --website https://www.wizzair.com
```

### Étape 2 — Fetch automatique (la voie normale)

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>"
```

Le script : télécharge la homepage, essaie `apple-touch-icon` → `icon`
grands → `og:image` → `/favicon.*`, valide le format (png/jpeg/webp/
ico, JAMAIS svg), le poids (200B–35KB) et le côté minimal (>=32px),
enregistre le data-URI et marque `logo_fetched=1`. Sortie JSON sur
stdout. `--dry-run` pour essayer sans écrire, `--force` pour remplacer
un logo existant.

### Étape 3 — Site anti-bot ou sans icône exploitable → `--from-url`

Si l'Étape 2 donne `NO_CANDIDATE` (des sites comme marriott.com
bloquent les bots) :

1. Recherche web `"<Company> logo png"` / `"<Company> press kit logo"` /
   page Wikipédia de l'entreprise (les fichiers Wikimedia ont des URL
   directes).
2. Trouve l'**URL directe de l'image** (doit finir en .png/.jpg/.webp/
   .ico ou servir l'image brute, pas une page HTML).
3. ```bash
   python3 /app/shared/skills/logo_fetch.py "<Company>" \
     --from-url "https://upload.wikimedia.org/.../Wizz_Air_logo.png"
   ```
   La même validation (poids/format/dimensions) s'applique : si l'image
   est trop lourde, cherche une variante plus légère (thumbnail
   Wikimedia : remplace dans le path `/1200px-` par `/240px-`).

### Étape 4 — Rien d'exploitable après 3 tentatives → marque et passe

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>" --mark-attempted
```

`logo_fetched=1` avec logo NULL : la page web affiche le fallback à
initiales, l'entreprise sort de la file. NE PAS insister au-delà de 3
tentatives.

## Policy d'économie (enrichment-policy)

Le fetch autonome respecte `$JHT_HOME/profile/enrichment-policy.json`
(vérifie avec `python3 /app/shared/skills/enrichment_policy.py show`).
Réponses possibles de `logo_fetch.py` :

- `POLICY_DISABLED` — économie active (`economy=true`) ou
  `logo.enabled=false` : N'extrais PAS, ce n'est pas une erreur. Passe.
- `POLICY_SCORE_GATE` — l'entreprise n'a pas encore de position vivante
  avec score ≥ `logo.min_score` : N'insiste PAS. Ne marque pas
  `logo_fetched` : quand le Scorer dépasse le seuil, l'entreprise
  rentre toute seule dans la file.

`--force` contourne la policy : utilise-le SEULEMENT sur demande
explicite de l'utilisateur, jamais de ta propre initiative.

## Qualité attendue

- **Préfère** des icônes carrées 96–256px (apple-touch-icon est
  l'idéal).
- 32–48px (favicon) est acceptable en dernier recours : le carré web
  est petit. Sous 32px le script refuse tout seul.
- Le plafond de 35KB est **rigide** (protège DB et sync) : ne le
  contourne pas, cherche une variante plus légère.

## Interdits

- ❌ Logo d'une entreprise HOMONYME ou du mauvais groupe (vérifie web !)
- ❌ Logo de l'agrégateur/job-board (LinkedIn, Indeed) à la place de
  l'entreprise
- ❌ Écrire `logo`/`logo_source`/`logo_fetched` à la main avec
  db_update : passe TOUJOURS par `logo_fetch.py` (le seul qui valide)
- ❌ SVG, images >35KB, icônes <32px (le script les refuse : n'essaie
  pas de le contourner)
- ❌ Captures d'écran de la homepage ou recadrages : seulement de vrais
  fichiers-logo
- ❌ Plus de 3 tentatives par entreprise : marque `--mark-attempted` et
  passe à la suivante
