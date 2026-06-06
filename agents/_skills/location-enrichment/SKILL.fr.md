<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: location-enrichment
description: Standardiser le texte libre positions.location en colonnes structurées loc_*/work_*/role_family AVANT de marquer toute position comme `checked`. Couvre 10 cas spéciaux (Europe Remote, Italy+remote, multi-location, entité US en UE). Impose un traitement une-position-à-la-fois, vocabulaire aligné entre pairs, work_country jamais NULL. À utiliser chaque fois que l'Analista est sur le point de définir status=checked sur une position.
allowed-tools: Bash(python3 *), Bash(curl *), Bash(jq *), WebSearch
---

# location-enrichment — playbook structuration location + role_family

L'Analista remplit **11 colonnes** de la table `positions` AVANT de marquer `status=checked`. Ne jamais laisser une position `checked` sans location enrichment.

## Les 11 colonnes à remplir

```
role_family         text   catégorie sémantique du rôle
loc_city            text   ville du bureau (NULL si seulement pays)
loc_region          text   région/état (optionnel)
loc_country         text   pays physique du bureau (NULL si seulement continent)
loc_country_code    text   ISO-3166 alpha-2: IT, IE, HU, ...
loc_continent       text   Europe | Asia | Americas | Africa | Oceania
work_mode           text   onsite | hybrid | remote
work_country        text   pays contractuel (entité qui signe) — JAMAIS NULL
work_country_code   text   ISO-2 du work_country
is_multi_location   bool   true si le JD liste plusieurs villes/pays
location_notes      text   notes libres de l'analista
```

## RÈGLES comportementales (CRITIQUES — sim 1-2 a trouvé des problèmes ici)

### R1 — Une position à la fois (PAS DE BATCH)

Traitez votre range une position par tour : lire JD → raisonner → db-update → status=checked → suivante. RIEN charger 20+ JD dans un seul tour LLM. Exception : 3-5 cas banals sans recherche web (ex. "Dublin, Ireland" + hybrid).

**Pourquoi** : les batchs de 17k+ tokens (sim 1) génèrent des réponses génériques ("multi-location + remote + EU") au lieu de données spécifiques pour chaque enregistrement. Et les autres analystes tournent à vide pendant votre méga-tour.

### R2 — Consultation de la taxonomie des pairs dans la DB (tous les 5-10 enregistrements)

AVANT de choisir une valeur `role_family`, vérifiez ce que les collègues ont utilisé :

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n FROM positions
   WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

Si vous trouvez une family **sémantiquement équivalente**, ALIGNEZ-VOUS sur leur nom. Exemples erronés vus en sim 1 :

```
✗ "Translation / Localization" vs "Localization / Language Quality"
  vs "Language / Localization"           → un seul
✗ "Customer Support" vs "Customer Success / Technical"
  vs "Technical Support"                 → un seul
✗ "Technical Engineering" pour un Technical Writer  → faux
```

Si la position est vraiment une nouvelle catégorie, annotez dans `location_notes` pourquoi.

### R3 — Fallback work_country (JAMAIS NULL sur checked)

Si après 2 tentatives de recherche web vous ne trouvez pas `work_country` avec certitude, NE le laissez PAS NULL. Procédez :

1. Pays du **board de publication** (ex. linkedin.it → IT) + note `"work_country inferred from posting board (low confidence)"`
2. Pays cité dans le JD comme "region" / "office" même si ce n'est pas le siège social
3. En dernier recours : le `loc_continent` comme placeholder + note `"work_country=Europe placeholder, entity unverified"`

## Standard d'écriture

| Oui ✓ | Non ✗ |
|---|---|
| `Italy` | `Italia`, `IT`, `Italie` |
| `United Kingdom` | `UK`, `Great Britain`, `England` |
| `Czechia` | `Czech Republic` |
| `Netherlands` | `Holland`, `The Netherlands` |
| `Székesfehérvár` | `Szekesfehervar` (toujours préserver les diacritiques) |
| ISO-2 `IT, IE, HU, NL, DE, GB, US, ES` | ISO-3, minuscules |

## Cas spéciaux (décision standard)

### A — "Europe Remote" / "EMEA - Flexible" / "Remote"

```
loc_city          = NULL
loc_country       = NULL          # pas de pays physique contraint
loc_continent     = "Europe"      # seulement si la zone est explicite
work_mode         = "remote"
work_country      = <recherche web HQ entreprise → fallback R3>
is_multi_location = false
location_notes    = "Remote within EU"
```

### B — "Italy" / "Spain" + full_remote (pays + remote)

```
loc_country       = "Italy"
loc_country_code  = "IT"
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Italy"       # même pays, contrat IT
work_country_code = "IT"
```

### C — "Dublin, Ireland" + hybrid (ville+pays propre)

```
loc_city          = "Dublin"
loc_region        = "Leinster"    # optionnel
loc_country       = "Ireland"
loc_country_code  = "IE"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Ireland"
work_country_code = "IE"
```

### D — Multi-location même pays ("Barcelona / Malaga")

```
loc_city          = NULL
loc_country       = "Spain"
loc_country_code  = "ES"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Spain"
is_multi_location = true
location_notes    = "Barcelona or Málaga (candidato sceglie)"
```

### E — Multi-pays ("Amsterdam, Berlin, London, Remote-Europe")

```
loc_city          = NULL
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "hybrid"      # ou remote
work_country      = <HQ entreprise via web>
is_multi_location = true
location_notes    = "EU multi-country: NL, DE, GB + remote option"
```

### F — Zone métropolitaine vague ("Greater Bologna Metropolitan Area")

```
loc_city          = "Bologna"     # promouvoir à la ville principale
loc_country       = "Italy"
location_notes    = "Area metropolitana Bologna (raggio ~30km)"
```

### G — Entreprise US avec entité UE qui recrute en Espagne

```
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Spain"       # entité locale qui signe
location_notes    = "US company (X Inc.), assume tramite entity ES"
```

### H — Le JD précise une ville que le scout avait généralisée

Le Scout avait écrit "Italy" → le JD dans le texte spécifie "Milano HQ" : **promouvoir à la ville**.

```
loc_city          = "Milan"
loc_country       = "Italy"
location_notes    = "JD specifica HQ Milano (scout aveva 'Italy')"
```

### I — Ville abrégée ("Dublin 2")

```
loc_city          = "Dublin"
loc_region        = "Dublin 2"    # district dans region
```

### J — Entreprise uniquement job board (Railsware, Top Remote Talent, etc.)

Quand l'entreprise est une société distribuée sans HQ clair : appliquer le fallback R3 (pays du board de publication) + annoter.

## Interdits absolus

- ❌ `loc_country = "Europe"` ou `"EMEA"` — c'est continent, pas country
- ❌ Mapper "EMEA" comme "Europe" sans vérification (inclut Moyen-Orient + Afrique)
- ❌ `work_country = NULL` sur une position `checked` (casse l'UI salaire)
- ❌ Inventer une role_family si les collègues en ont déjà utilisé de similaires → voir R2
- ❌ Charger le batch entier de son range → voir R1
- ❌ **`loc_city = "Remote" / "Anywhere" / "Distributed"`** — ce ne sont PAS des villes. Si la position est full-remote sans ville spécifique, `loc_city = NULL`. Bug observé en sim 4 : A2 a écrit `loc_city='Remote'` pour 8 enregistrements (Canonical, Miratech, Link Group, etc.). Corriger toujours avec `db_update --loc-city ""` (chaîne vide = NULL).

## Commandes types

### Sauvegarde structure location complète

```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --loc-city "Dublin" \
  --loc-region "Leinster" \
  --loc-country "Ireland" --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" --work-country-code "IE" \
  --is-multi-location false \
  --role-family "Technical Writing" \
  --location-notes ""
```

### Consultation taxonomie des pairs (exécuter tous les 5-10 enregistrements)

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n
   FROM positions WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

### Promotion en checked (UNIQUEMENT après enrichment complet)

```bash
python3 /app/shared/skills/db_update.py position <ID> --status checked \
  --notes "ESPERIENZA: ... \\n LINGUA: ... \\n SENIORITY: ..."
```

## Références

- `docs/internal/2026-05-23-location-playbook.md` — version longue avec appendice country→continent
- `docs/internal/2026-05-23-sim-1-location-enrichment-report.md` — anti-patterns et findings sim 1
