<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: scout-web-access
description: "Couche web-access cross-provider pour les Scout (F-2). 5 composants coordonnes — anti-bot robust scrape, LinkedIn session + search, email IMAP poll, multi-Scout workspace claim, freshness focus. Utilise comme stack de base pour chaque sweep : le Scout choisit le niveau d'acces le plus leger qui fonctionne, et monte uniquement lorsqu'il est bloque."
allowed-tools: Bash(python3 /app/shared/skills/web_scrape_robust.py *), Bash(python3 /app/shared/skills/linkedin_access.py *), Bash(python3 /app/shared/skills/email_monitor.py *), Bash(python3 /app/shared/skills/scout_workspace.py *), Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/db_insert.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# scout-web-access — sources de donnees robustes pour les Scout

## Pourquoi ca existe

Session 17 mai — 3 sweep Scout-2 sur LinkedIn (canonical/yo/mbg) tous
bloques par cookie wall + login form, budget Kimi gaspille. Pattern
cross-provider verifie :

- **Claude** (precedent) : LinkedIn source principale par defaut ✅
- **Codex** : y accede mais pas spontanement 🟡
- **Kimi** (actuel) : cookie wall ❌

Cette skill comble le gap **sans login** en exploitant l'endpoint guest
de LinkedIn (`jobs-guest/jobs/api/seeMoreJobPostings/search`) et l'URL
publique `/jobs/view/<ID>` (tous deux re-confirmes 2026-05-17, deja
documentes dans le repo legacy `job-hunter/scout-3/`). Fonctionne de la meme
facon sur n'importe quel provider car elle travaille au niveau shell HTTP, pas LLM browser.

## Les 5 composants

### 🌐 A. `linkedin_access.py` — LinkedIn sans login (methode legacy re-confirmee)

**Pas de Playwright, pas de login.** Methode documentee dans le repo legacy
(`job-hunter/scout-3/FRIK.md:71`, `docs/architettura.md:89-90`) et re-verifiee 2026-05-17 :

```
/comm/jobs/view/<ID>   →  /jobs/view/<ID>   = endpoint PUBLIC
```

Recherche via guest endpoint `linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`
(aucune authentification requise) qui retourne des cards HTML avec `data-entity-urn="urn:li:jobPosting:<ID>"`.

```bash
# Chercher des offres des 7 derniers jours
python3 /app/shared/skills/linkedin_access.py search \
    --keywords "python junior" --location "Italy" \
    --limit 25 --posted-within-days 7
# → stdout JSONL, 1 offre par ligne {job_id, url, title, company, location, source}

# Recuperer le detail JD (accepte URL complete, /comm/jobs/view/<ID>, ou juste <ID>)
python3 /app/shared/skills/linkedin_access.py fetch-job 4402474915
# → {"job_id":"...","title":"Python Developer (Data-Focused)",
#    "company":"ManpowerGroup Talent Solutions",
#    "location":"Genoa, Liguria, Italy",
#    "jd_text":"...1863 chars...",
#    "seniority":"Associate","employment_type":"Full-time",
#    "job_function":"Analyst","industries":"...",
#    "deadline":"" (rempli si trouve dans le JD via F-4 deadline_extract)}

# Convertit URL email → URL publique
python3 /app/shared/skills/linkedin_access.py convert-url \
    "https://www.linkedin.com/comm/jobs/view/4402474915?utm=email"
# → https://www.linkedin.com/jobs/view/4402474915
```

**Quand l'offre a expire** : LinkedIn redirige vers une SERP generique
("476 Python jobs in Italy"). La skill detecte le pattern et retourne
`{"expired": true, "note": "redirect a SERP — job expire"}` — utilisez
ce flag pour marquer la position `excluded` avec le tag `[LINK_MORTO]`.

### 🛡️ B. `web_scrape_robust.py` — cascade anti-bot

3 niveaux, escalade automatique au premier `blocked:true` detecte :

- **L1** : `requests` + UA realiste en rotation + cookie jar. Rapide, faible cout.
- **L2** : Playwright headless + stealth tweaks (navigator.webdriver=undefined,
  plugins, languages). Gere les SPA + certains challenge Cloudflare.
- **L3** : Playwright **persistent context** (reutilise la session utilisateur). Pour
  les domaines qui necessitent un login (LinkedIn contenu complet, Glassdoor Premium).

```bash
python3 /app/shared/skills/web_scrape_robust.py "https://board.com/jobs/123" --level 2
# → JSON avec level, status, blocked, text_chars, html_path, title
```

Patterns de detection automatiques : "Just a moment...", "Cloudflare", "Access
Denied", "Please verify you are a human", "g-recaptcha", "Authwall".
Quand l'un se declenche, `blocked:true` dans le resultat → l'appelant marque la source
comme "blacklist temporaire" et change de cible.

### 📧 C. `email_monitor.py` — polling IMAP pour les alertes d'offres

L'utilisateur cree un email dedie (ex. `jobs+jht@gmail.com`) + configure
des regles de transfert sur le client principal (`from: jobs-listings@linkedin.com →
forward to: jobs+jht@`). Le Scout interroge toutes les 30 min et extrait les liens.

```bash
# Config : ~/.jht/credentials/email_monitor.json (cree par le wizard)
# {"imap_host":"imap.gmail.com","user":"...","password":"...","from_filters":[...]}

python3 /app/shared/skills/email_monitor.py status
python3 /app/shared/skills/email_monitor.py poll --since-days 1
# → stdout JSONL: {"url":"https://linkedin.com/jobs/view/...","source":"linkedin-email"}
```

Idempotence : etat dans `$JHT_HOME/state/email_monitor_seen.json` avec un set
de `Message-ID` deja traites. Re-run sur toutes les 30 min sans doublons.

Avantage principal : les offres sont deja **pre-filtrees selon le profil utilisateur**
par les regles d'alerte. Contourne le cookie wall de LinkedIn sans identifiants
LinkedIn cote Scout — la boite mail suffit.

### 🤝 D. `scout_workspace.py` — claim/release source

Etat partage dans `$JHT_HOME/agents/_team/scout_workspace.json` avec
claim au niveau **source** (pas `position_id`, ca c'est
`scout_coord.py`). Taxonomie `<provider>:<keyword>:<location>`.

```bash
# Avant le sweep
python3 /app/shared/skills/scout_workspace.py available "linkedin:python:IT" --agent scout-1
# exit 0 = libre → claim
python3 /app/shared/skills/scout_workspace.py claim scout-1 "linkedin:python:IT"
# ... effectuer le sweep ...
python3 /app/shared/skills/scout_workspace.py release scout-1 "linkedin:python:IT"
```

TTL par defaut 30 min : si un Scout meurt sans release, apres le TTL le
claim expire automatiquement et un autre Scout peut le prendre.

### 🆕 E. Focus fraicheur (SC-07)

Filtres "publie dans les 7 derniers jours" par defaut. Re-sweep de la meme source toutes les
6h, pas plus frequent. Suivi last_scan_at dans `scout_workspace.history`.

## Flux operationnel Scout recommande

```bash
MY_ID="scout-1"
SOURCE="linkedin:python:IT"

# 1. Coord — claim source
if ! python3 /app/shared/skills/scout_workspace.py available "$SOURCE" --agent "$MY_ID"; then
  echo "source reclamee par un autre Scout, on passe"
  exit 0
fi
python3 /app/shared/skills/scout_workspace.py claim "$MY_ID" "$SOURCE" >/dev/null

# 2. Recherche LinkedIn (sans login, guest endpoint, fraicheur 7j)
python3 /app/shared/skills/linkedin_access.py search \
    --keywords "python junior" --location "Italy" \
    --limit 25 --posted-within-days 7 > /tmp/scout_results.jsonl

# 3. Pour chaque resultat : dedup (SC-05) + fetch JD public + INSERT
while IFS= read -r line; do
  jid=$(echo "$line" | python3 -c "import sys,json;print(json.load(sys.stdin)['job_id'])")
  detail=$(python3 /app/shared/skills/linkedin_access.py fetch-job "$jid")
  expired=$(echo "$detail" | python3 -c "import sys,json;print(json.load(sys.stdin).get('expired',False))")
  if [ "$expired" = "True" ]; then
    echo "[scout] $jid expired (redirect SERP), skip" >&2
    continue
  fi
  title=$(echo "$detail"   | python3 -c "import sys,json;print(json.load(sys.stdin)['title'])")
  company=$(echo "$detail" | python3 -c "import sys,json;print(json.load(sys.stdin)['company'])")
  jd=$(echo "$detail"      | python3 -c "import sys,json;print(json.load(sys.stdin)['jd_text'])")
  loc=$(echo "$detail"     | python3 -c "import sys,json;print(json.load(sys.stdin).get('location',''))")
  deadline=$(echo "$detail"| python3 -c "import sys,json;print(json.load(sys.stdin).get('deadline',''))")
  python3 /app/shared/skills/db_insert.py position \
    --title "$title" --company "$company" \
    --url "https://www.linkedin.com/jobs/view/$jid" \
    --location "$loc" --jd-text "$jd" \
    --source linkedin --found-by "$MY_ID" \
    ${deadline:+--deadline "$deadline"}
done < /tmp/scout_results.jsonl

# 4. Release
python3 /app/shared/skills/scout_workspace.py release "$MY_ID" "$SOURCE"
```

## Anti-patterns

- ❌ Sauter `scout_workspace.claim` parce que "de toute facon je suis seul" — des que
  tu passes a 4 Scout, c'est la que tu decouvres les doublons Canonical.
- ❌ Fetch L1 → bloque → retenter L1 avec le meme UA : la cascade
  L1→L2→L3 existe pour ca. Jamais boucler sur le meme niveau.
- ❌ Telecharger le HTML L3 (persistent context avec cookies utilisateur) et
  commiter le PDF/HTML dans le repo — ce sont des cookies de session utilisateur,
  ils vivent uniquement dans `$JHT_HOME/.cache/`.
- ❌ Polling email plus frequent que 30 min — rate-limit IMAP cote serveur
  + aucune nouvelle alerte a analyser.
- ❌ Ignorer `deadline` retourne par `fetch-job` — le suivi
  d'expiration F-4 fonctionne uniquement si vous remplissez `positions.deadline`.

## Voir aussi

- `shared/skills/web_scrape_robust.py`
- `shared/skills/linkedin_access.py`
- `shared/skills/email_monitor.py`
- `shared/skills/scout_workspace.py`
- `agents/scout/scout.md` § SC-05/SC-06/SC-07
- `agents/_skills/expiration-tracking/SKILL.md` (F-4 deadline)
