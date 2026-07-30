<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: position-insert
description: "La séquence à 5 portes que le Scout exécute pour CHAQUE position candidate avant d'INSÉRER dans `positions` : dédup → vérification de lien → fetch JD → filtres permissifs → INSERT. Sauter une porte remplit la DB de doublons, liens morts ou lignes hors périmètre que l'Analista doit ensuite supprimer — budget Sonnet gaspillé en aval. Propriété du rôle Scout ; à associer avec `circles-and-sources` (décide OÙ chercher) et `scout-coord` (décide QUI cherche où)."
allowed-tools: Bash(curl *), Bash(python3 *), Bash(grep *)
---

# position-insert — 5 portes par position

Une position vaut la peine d'être insérée uniquement si les cinq portes passent. L'ordre compte : les vérifications les moins coûteuses viennent d'abord pour que les coûteuses (fetch JD complet + filtrage) ne s'exécutent que sur les candidates viables.

## Porte 1 — Dédup (bon marché, obligatoire en premier)

```bash
python3 /app/shared/skills/db_query.py check-url <linkedin_id_or_url>
```

- Sortie `TROVATA` → **SKIP** (déjà en DB, possiblement avec un statut différent — ne jamais ré-insérer).
- Sortie `NON TROVATA` → passer à la Porte 2.

La clé de dédup est l'URL canonique (ou l'ID de job LinkedIn pour LinkedIn). Si la même offre vient de deux sources différentes (ex. page carrière de l'entreprise ET un cross-listing LinkedIn), `check-url` déduplique.

## Porte 2 — Vérification de lien (HTTP + URL)

`curl` en deux étapes pour détecter les offres mortes ET les redirections silencieuses vers une page `/careers` générique (= job supprimé mais la page retourne 200).

### Étape 2a — code de statut + URL finale

```bash
curl -s -o /dev/null -w "HTTP:%{http_code} URL_FINALE:%{url_effective}" \
  -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' '<URL>'
```

| Résultat                                      | Action                                         |
|-----------------------------------------------|------------------------------------------------|
| `HTTP:404` / `HTTP:410`                       | SKIP (lien mort)                               |
| `HTTP:301/302` vers un `/careers` ou `/jobs` générique | SKIP (position supprimée, redirection générique) |
| `HTTP:200/301/302` URL finale = page d'offre  | passer à l'Étape 2b                            |

### Étape 2b — signaux de contenu

```bash
curl -s -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' '<URL>' \
  | grep -i 'no longer accepting\|closed-job\|position has been filled\|expired\|job not found'
```

- Correspondance → SKIP (offre fermée)
- Pas de correspondance → passer à la Porte 3

### Note Workable

Pour les ATS hébergés sur Workable : il y a **deux** URLs par offre. Utilisez la bonne :
- `apply.workable.com/...` → formulaire de candidature : retourne `302` quand l'offre est fermée (ressemble à un lien mort, faux positif).
- `jobs.workable.com/...` → page JD canonique : HTTP 200 + JSON-LD valide si la position est vivante.

Toujours vérifier la page **canonique** (`jobs.workable.com`), pas le formulaire de candidature. Même principe pour Greenhouse, Lever, Ashby.

## Porte 3 — Fetch du JD COMPLET

Le contrat DB exige que `--jd-text` et `--requirements` soient COMPLETS — les scrapes partiels cassent l'Analista en aval.

```bash
# niveau 1 — curl avec UA navigateur (la plupart des cas)
curl -s -L -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' '<URL>' > $JHT_AGENT_DIR/tmp/jd-raw.html

# niveau 2 — pages JS-heavy (Wellfound, certaines pages carrières custom) : utiliser playwright MCP
# niveau 3 — fallback : WebFetch / WebSearch
```

Extraire le **corps de texte complet** (pas seulement le titre) et la **section exigences** (compétences, années d'expérience, langues). Si la page a une section "Requirements" / "Must have" / "What you'll bring" claire, la scraper verbatim dans `--requirements`.

Sites bloqués (NE PAS utiliser `fetch` MCP, bloqué par robots.txt) :
- `linkedin.com` → utiliser `linkedin_check.py` (authentifié) ou `curl` avec UA navigateur
- `wellfound.com` → utiliser `playwright` ou `curl`

## Porte 4 — Filtres permissifs au niveau Scout

Appliquer UNIQUEMENT les quatre filtres totalement hors périmètre (tableau complet dans la skill `circles-and-sources`). Sauter si :

- Le titre contient explicitement : `senior`, `lead`, `staff`, `principal`, `head of`, `director`
- Autorisation de travail géographique incompatible (`US-only` / `Canada-only` et le candidat n'a pas de visa)
- Domaine complètement hors IT/coding (et le candidat est en IT)
- Exigence stricte de `> années_réelles + 3` ans d'expérience

Tout le reste : passer à la Porte 5. **Ne pas faire le travail de l'Analista** — les stacks adjacents, quasi-correspondances, légers écarts sont tous du matériel `checked` ; le Scorer applique la pénalité de gap.

## Porte 5 — INSERT

```bash
python3 /app/shared/skills/db_insert.py position \
  --title "<TITRE>" \
  --company "<ENTREPRISE>" \
  --url "<URL canonique, PAS le formulaire de candidature>" \
  --location "<localisation réelle du JD>" \
  --remote-type <full_remote|hybrid|on_site> \
  --source <slug source: linkedin|greenhouse|lever|indeed|wellfound|remoteok|...> \
  --found-by $MY_ID \
  --jd-text "<TEXTE COMPLET DU JD>" \
  --requirements "<stack + exigences extraites du JD>"
```

**Tous les flags sont obligatoires** — `--jd-text` vide ou `--url` manquant signifie que l'Analista ne peut pas faire son travail. Le script `db_insert.py` impose des valeurs non-vides ; s'il rejette votre appel, corrigez l'entrée — ne jamais contourner avec du SQL brut.

## Périmètre d'écriture DB (T05 + rôle)

Le Scout écrit UNIQUEMENT :
- `positions` (INSERT, jamais UPDATE sauf le cas de récupération de doublons ci-dessous)

NE touche JAMAIS :
- `companies` (territoire de l'Analista)
- `scores` (Scorer)
- `applications` (Scrittore)
- `position_highlights` (Analista)
- positions avec `status != 'new'` (déjà en aval, ne pas toucher)

### Récupération de doublons (le seul UPDATE autorisé)

Si vous avez accidentellement inséré un doublon (la Porte 1 s'est trompée, ex. une URL normalisée a glissé), vous pouvez marquer le doublon comme exclu — mais jamais DELETE :

```bash
python3 /app/shared/skills/db_update.py position <DUP_ID> --status excluded \
  --notes "DUPLICATA di #<ORIGINAL_ID>"
```

`DELETE` / `DROP` SQL est interdit (T02 + sécurité DB). Les retours arrière via les notes `excluded` sont auditables ; les suppressions ne le sont pas.

## Après l'INSERT — notifier les Analystes

Après chaque lot de 3-5 inserts, pinguer les sessions Analista avec la plage d'ID. Ils récupèrent `status=new` depuis la DB de toute façon, mais le ping raccourcit la latence :

```bash
jht-tmux-send ANALISTA-1 "[@$MY_ID -> @analista-1] [INFO] Batch 5 posizioni inserite (IDs: X-Y)"
```

Si vous avez 2 Analystes, alterner la cible du ping pour équilibrer la charge (les Analystes ont aussi la coordination de revendication `last_checked` donc ce n'est jamais faux, mais la notification tmux aide la réactivité).

## Anti-patterns

- ❌ Sauter la Porte 1 "parce que ça semblait nouveau" — `check-url` est bon marché, toujours l'exécuter.
- ❌ Insérer avec `--jd-text` vide "je le remplirai plus tard" — il n'y a pas de plus tard, l'Analista le traite ensuite.
- ❌ Vérifier avec `curl` sans `-L` — un 302 vers un `/careers` générique semble vivant sans suivi de redirection ; vous inséreriez un JD mort.
- ❌ Vérifier le formulaire de candidature sur Workable au lieu de la page JD canonique — liens morts faux positifs.
- ❌ Utiliser `fetch` MCP sur `linkedin.com` / `wellfound.com` — bloqué, vous obtenez une bannière 403 au lieu du JD.
- ❌ Contourner le wrapper avec `python3 -c "import sqlite3; INSERT ..."` — casse les invariants de dédup et le suivi `found-by`, et la DB le refuse désormais : `positions.url` est UNIQUE. `UNIQUE constraint failed: positions.url` veut dire que l'annonce est déjà dans la DB — retour au Gate 1, ne pas réessayer avec une URL retouchée.
- ❌ Définir `--status` à autre chose que le défaut `new` (le Scout ne définit jamais le statut manuellement ; le wrapper s'en charge).

## Voir aussi

- `circles-and-sources` — quoi chercher OÙ (cette skill est quoi faire APRÈS avoir trouvé une offre candidate).
- `scout-coord` — partition au démarrage (cette skill est par position, en aval de la partition).
- `db-insert` — mécanismes internes du wrapper + schéma `position`.
- `agents/_manual/anti-collision.md` — contrat de coordination Scout plus large.
- `agents/scout/scout.md` — le prompt orchestrateur qui appelle cette skill dans la boucle principale.
