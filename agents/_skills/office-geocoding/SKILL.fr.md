<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: office-geocoding
description: Géocoder le bâtiment de bureau précis (lat/lon/adresse) pour une position APRÈS que location-enrichment a rempli loc_city/loc_country. Utiliser la recherche web de manière agressive (3+ tentatives) pour trouver l'adresse du HQ/bureau de l'entreprise, puis résoudre les coordonnées via Nominatim/Photon. Sauter UNIQUEMENT après un échec exhaustif de la recherche ou quand il y a plusieurs bureaux ambigus. Définit office_lat, office_lon, office_address, office_geocoded, office_verified.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch, WebFetch
---

# office-geocoding — coordonnées précises du bureau

Exécuter **après** `location-enrichment`. Prérequis : `loc_city` et/ou `loc_country` remplis (depuis R12-15). Si la position est full-remote sans city, skip immédiat (pas de bureau à géocoder).

## 5 colonnes à remplir

```
office_lat        numeric  latitude WGS84 (ex. 41.8933203)
office_lon        numeric  longitude WGS84 (ex. 12.4829321)
office_address    text     adresse complète du bureau
office_geocoded   bool     true si vous avez exécuté le géocodage
office_verified   bool     true si vous êtes SÛR que c'est le bon bureau ;
                           false si fallback niveau ville / multi-ambigu
```

## Règle d'or : vérification web obligatoire

**NE sauvegardez JAMAIS une adresse street-level sans l'avoir d'abord vérifiée via le web** comme bureau réel de l'entreprise. La séquence correcte est **recherche web D'ABORD, géocodage APRÈS** — pas l'inverse.

### Séquence canonique (toujours dans cet ordre)

1. **Tentative 1 — Recherche web HQ de l'entreprise dans la ville**
   - Requête : `"<Company> headquarters <city> address"`, `"<Company> sede <city>"`, `"<Company> office <city>"`, `"<Company> contact"`
   - Sources acceptables comme preuve : site officiel de l'entreprise, LinkedIn "About", Crunchbase, registres d'entreprises (partitaiva.it, cerved.com pour IT), résultat Google Maps de l'entreprise.
   - **Extraire l'adresse** de la source trouvée.

2. **Tentative 2 — Extraction du JD**
   - Chercher les patterns "Visit us at...", "Sede operativa:", "Our office", adresse en pied de page du JD.

3. **Tentative 3 — Webfetch d'une source suspecte**
   - Si la recherche web montre un titre mais pas de snippet avec adresse, `WebFetch` de la page officielle pour extraire.

4. **Géocodage via Nominatim/Photon** **UNIQUEMENT après** avoir trouvé l'adresse. Nominatim/Photon convertissent texte→coordonnées, **ce n'est pas de la vérification**. Pas d'adresse du web → pas de `office_verified=true`.

5. **Fallback niveau ville** quand toutes les tentatives ci-dessus échouent : géocoder le **nom de la ville** (ex. `"Roma, Italy"`), sauvegarder avec `office_verified=false` et `office_address = <city>, <country>`. **NE JAMAIS laisser NULL si la position a une city/country du location-enrichment** — utiliser le fallback ville.

### Quand skip avec TOUT NULL

Uniquement si la position est full-remote sans loc_city/loc_country (pas de bureau physique à géocoder). Voir section "Quand SKIP" ci-dessous.

## Quand remplir avec `office_verified=true`

Vous êtes **vraiment sûr** que cette adresse est le bon bureau :

- Le site de l'entreprise confirme explicitement le siège dans cette ville
- L'offre inclut explicitement une adresse rue + numéro
- LinkedIn "About" de l'entreprise liste cette ville avec adresse
- Registre d'entreprises / chambre de commerce pour les entreprises Italy/EU

## Quand remplir avec `office_verified=false`

Vous avez des coordonnées mais avec incertitude :

- Vous avez trouvé le siège principal mais le JD dit "we have multiple offices in <city>, candidate works from one of them"
- Vous avez géocodé au niveau ville (centroïde ville) comme fallback
- L'adresse est approximée (ex. seulement nom de quartier sans rue)

## Quand SKIP (laisser tout NULL)

```
office_lat = NULL
office_lon = NULL
office_address = NULL
office_geocoded = false
office_verified = false
```

- Full remote : position entièrement distribuée sans ville spécifique
- Multi-location ambiguë : "Roma o Milano o Torino" + work_mode=remote
- 3+ tentatives échouées, rien de concret trouvé
- Entreprise extrêmement générique (agence/recruteur sans bureau propre pour cette position)

## Workflow commandes

### Étape 1 — Recherche web HQ entreprise

```bash
# Chercher le siège principal de l'entreprise dans cette ville
# Essayer 2-3 requêtes différentes si la première ne clarifie pas
```

Utiliser l'outil `WebSearch` avec des requêtes du type :
- `"<Company> headquarters <city> address"`
- `"<Company> office <city> via OR street"` (italien : via)
- `"<Company> sede legale OR sede operativa <city>"` (italien)
- `"<Company> contact us <city>"` (contient souvent l'adresse)

Pour les JD italiens en particulier, chercher aussi :
- `"<Company> Roma sede"` / `"<Company> Milano via"` / etc.
- Sur des registres comme `partitaiva.it`, `easy.it`, `cerved.com`, `infoimprese.it` pour les entreprises italiennes

### Étape 2 — Géocodage via Nominatim (rate limit 1 req/sec)

```bash
# URL-encode la requête
Q=$(jq -nr --arg s "<adresse trouvée> <city>" '$s | @uri')

python3 /app/shared/skills/safe_fetch.py \
  --user-agent 'jht-analyst/1.0 (+https://github.com/leopu00/job-hunter-team)' \
  "https://nominatim.openstreetmap.org/search?q=${Q}&format=json&limit=1"
```

Réponse JSON : `[{"lat": "...", "lon": "...", "display_name": "..."}]`.
Extraire `lat`, `lon`, `display_name` (= `office_address`).

**Rate limit** : sleep 1.2 sec entre requêtes Nominatim. Si 429 : switch à Photon.

### Étape 3 — Fallback Photon (komoot, pas de rate limit visible)

```bash
Q=$(jq -nr --arg s "<Company> <City>" '$s | @uri')
python3 /app/shared/skills/safe_fetch.py \
  --user-agent 'jht-analyst/1.0' \
  "https://photon.komoot.io/api?q=${Q}&limit=1"
```

GeoJSON : `features[0].geometry.coordinates = [lon, lat]` (NB ordre inversé ! Photon = `[lon, lat]`, Nominatim = `{"lat","lon"}`).

### Étape 4 — UPDATE Supabase via wrapper

```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --office-lat 41.8933203 \
  --office-lon 12.4829321 \
  --office-address "Via Roma 1, 00100 Roma, Italy" \
  --office-geocoded true \
  --office-verified true \
  --action geocode --outcome updated
```

Pour skip après 3 tentatives :
```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --office-geocoded false --office-verified false \
  --action geocode --outcome failed
# (lat/lon/address restent NULL)
```

## Cas typiques résolus

### Cas 1 — Entreprise italienne avec siège unique clair

```
"Bending Spoons" + "Milano"
→ recherche web : "Bending Spoons via Nino Bonnet 10, 20154 Milano"
→ Nominatim : 45.4870, 9.1908
→ office_address = "Bending Spoons Spa, Via Nino Bonnet, Milano"
→ office_verified = TRUE
```

### Cas 2 — Multi-sièges dans la même ville (TBD explicite)

```
"ION Group" + "Roma" → a 3 bureaux à Roma (Eur, Centro, Tiburtina)
→ Le JD ne précise pas lequel → office_verified = FALSE
→ Utiliser la coordonnée du siège principal (HQ Roma)
→ office_address = "ION Trading Italy, Viale dell'Aeronautica 100, Roma"
```

### Cas 3 — Le JD inclut l'adresse dans le texte

```
JD : "...vieni a trovarci in Via Tagliamento 45, Roma..."
→ Extraire directement l'adresse du jd_text
→ Géocoder celle-ci → office_verified = TRUE
```

### Cas 4 — Skip pour ambiguïté

```
"IBM" + "Roma" + remote-eligible
→ IBM a 4 sièges à Roma, le JD ne précise pas
→ office_geocoded=true, office_verified=false, coordonnée siège HQ Roma
→ location_notes contient déjà "IBM Roma multi-sede"
```

### Cas 5 — Skip pour full remote

```
work_mode = remote, loc_city = NULL
→ La position n'a pas de bureau physique → tout NULL
→ office_geocoded = false, office_verified = false
```

## Politique de rate limit

- Nominatim : 1 req/sec, sleep 1.2s entre requêtes. Jamais plus de 6 req en 10s.
- Photon : pas de rate limit visible, quand même sleep 0.5s par courtoisie.
- Recherche web : paresseuse, uniquement quand le géocodage direct échoue.
- Si 429 de Nominatim : sleep 30s, switch à Photon, NE PAS retenter Nominatim pendant les 5 prochaines minutes.

## Interdits

- ❌ Inventer des coordonnées plausibles sans vérification web
- ❌ Mettre `office_verified=true` si vous avez utilisé le centroïde ville
- ❌ Abandonner après UNE seule tentative Nominatim vide
- ❌ Géocoder du full-remote (pas de bureau physique)
- ❌ Laisser `office_geocoded=NULL` (doit être `true` ou `false` explicite)
- ❌ Sauvegarder une adresse Nominatim "trouvée" sans l'avoir d'abord ancrée à une source web (site entreprise / LinkedIn / registre d'entreprises) → risque de géocoder un nom similaire dans une autre ville
- ❌ Laisser `office_address=NULL` pour les positions qui ONT city/country : fallback obligatoire `office_address = "<city>, <country>"` avec `office_verified=false`
