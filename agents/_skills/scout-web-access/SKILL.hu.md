<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: scout-web-access
description: "Cross-provider web-access reteg a Scout-ok szamara (F-2). 5 koordinalt komponens — anti-bot robust scrape, LinkedIn session + search, email IMAP poll, multi-Scout workspace claim, freshness focus. Minden sweep alap stack-jekent hasznalva: a Scout a legkonnyebb mukodo hozzaferesi szintet valasztja, es csak blokkolas eseten eszkalal."
allowed-tools: Bash(python3 /app/shared/skills/web_scrape_robust.py *), Bash(python3 /app/shared/skills/linkedin_access.py *), Bash(python3 /app/shared/skills/email_monitor.py *), Bash(python3 /app/shared/skills/scout_workspace.py *), Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/db_insert.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# scout-web-access — robosztus adatforrasok a Scout-ok szamara

## Miert letezik

Munkamenet maj. 17 — 3 Scout-2 sweep a LinkedIn-en (canonical/yo/mbg) mind
blokkolva cookie wall + login form altal, Kimi-koltsegvetes elpazarolva. Ellenorzott
cross-provider minta:

- **Claude** (elozo): LinkedIn fo forras alapertelmezetten ✅
- **Codex**: hozzafer, de nem onszantabol 🟡
- **Kimi** (jelenlegi): cookie wall ❌

Ez a skill bezarja a rest **bejelentkezes nelkul** a LinkedIn guest endpoint-janak
(`jobs-guest/jobs/api/seeMoreJobPostings/search`) es a
nyilvanos URL `/jobs/view/<ID>` kihasznalasaval (mindketto ujra megerositett 2026-05-17,
mar dokumentalva a legacy repoban `job-hunter/scout-3/`). Ugyanugy mukodik
barmely provider-en, mert shell HTTP szinten dolgozik, nem LLM bongeszovel.

## Az 5 komponens

### 🌐 A. `linkedin_access.py` — LinkedIn bejelentkezes nelkul (ujra megerositett legacy modszer)

**Nincs Playwright, nincs bejelentkezes.** A legacy repoban dokumentalt modszer
(`job-hunter/scout-3/FRIK.md:71`, `docs/architettura.md:89-90`) es ujra ellenorizve 2026-05-17:

```
/comm/jobs/view/<ID>   →  /jobs/view/<ID>   = NYILVANOS endpoint
```

Kereses a guest endpoint-on `linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`
(nincs szukseg hitelesitesre), ami HTML card-okat ad vissza `data-entity-urn="urn:li:jobPosting:<ID>"` tartalommal.

```bash
# Allasok keresese az elmult 7 napbol
python3 /app/shared/skills/linkedin_access.py search \
    --keywords "python junior" --location "Italy" \
    --limit 25 --posted-within-days 7
# → stdout JSONL, 1 allas soronkent {job_id, url, title, company, location, source}

# JD reszletek lekerese (elfogad teljes URL-t, /comm/jobs/view/<ID>-t, vagy csak <ID>-t)
python3 /app/shared/skills/linkedin_access.py fetch-job 4402474915
# → {"job_id":"...","title":"Python Developer (Data-Focused)",
#    "company":"ManpowerGroup Talent Solutions",
#    "location":"Genoa, Liguria, Italy",
#    "jd_text":"...1863 chars...",
#    "seniority":"Associate","employment_type":"Full-time",
#    "job_function":"Analyst","industries":"...",
#    "deadline":"" (kitoltve ha megtalalhato a JD-ben F-4 deadline_extract altal)}

# Email URL → nyilvanos URL konvertalasa
python3 /app/shared/skills/linkedin_access.py convert-url \
    "https://www.linkedin.com/comm/jobs/view/4402474915?utm=email"
# → https://www.linkedin.com/jobs/view/4402474915
```

**Amikor az allas lejart**: a LinkedIn egy altalanos SERP-re iranyit at
("476 Python jobs in Italy"). A skill eszleli a mintat es visszaadja:
`{"expired": true, "note": "redirect a SERP — job lejart"}` — hasznald
ezt a flag-et a position `excluded` jelolesehez `[LINK_MORTO]` taggel.

### 🛡️ B. `web_scrape_robust.py` — anti-bot kaszkad

3 szint, automatikus eszkalalas az elso eszlelt `blocked:true` eseten:

- **L1**: `requests` + realisztikus rotalt UA + cookie jar. Gyors, alacsony koltsegu.
- **L2**: Playwright headless + stealth tweaks (navigator.webdriver=undefined,
  plugins, languages). Kezeli az SPA-kat + nehany Cloudflare challenge-t.
- **L3**: Playwright **persistent context** (felhasznaloi munkamenet ujrahasznalasa). Olyan
  domain-ekhez amelyek bejelentkezest igenyelnek (LinkedIn teljes tartalom, Glassdoor Premium).

```bash
python3 /app/shared/skills/web_scrape_robust.py "https://board.com/jobs/123" --level 2
# → JSON a kovetkezokkel: level, status, blocked, text_chars, html_path, title
```

Automatikus eszlelesi mintak: "Just a moment...", "Cloudflare", "Access
Denied", "Please verify you are a human", "g-recaptcha", "Authwall".
Amikor valamelyik aktivizalodik, `blocked:true` az eredmenyben → a hivo megjeloli a source-ot
mint "ideiglenes tiltolista" es celt valt.

### 📧 C. `email_monitor.py` — IMAP polling allas-ertesitesekhez

A felhasznalo dedikalt emailt hoz letre (pl. `jobs+jht@gmail.com`) + tovabbitasi
szabalyokat allit be az elso szamu kliensen (`from: jobs-listings@linkedin.com →
forward to: jobs+jht@`). A Scout 30 percenkent lekerdez es kinyeri a linkeket.

```bash
# Config: ~/.jht/credentials/email_monitor.json (a wizard hozza letre)
# {"imap_host":"imap.gmail.com","user":"...","password":"...","from_filters":[...]}

python3 /app/shared/skills/email_monitor.py status
python3 /app/shared/skills/email_monitor.py poll --since-days 1
# → stdout JSONL: {"url":"https://linkedin.com/jobs/view/...","source":"linkedin-email"}
```

Idempotencia: allapot a `$JHT_HOME/state/email_monitor_seen.json`-ban a mar
feldolgozott `Message-ID`-k halmazaval. Biztonsagos ujrafuttas 30 percenkent duplikaciok nelkul.

Fo elony: az allasok mar **eloszurtek a felhasznaloi profil alapjan**
az ertesitesi szabalyok altal. Megkerulik a LinkedIn cookie wall-jat LinkedIn
hitelesito adatok nelkul a Scout oldalon — eleg a postafok.

### 🤝 D. `scout_workspace.py` — claim/release forras

Megosztott allapot a `$JHT_HOME/agents/_team/scout_workspace.json`-ban
claim-mel **forras** szinten (nem `position_id`, az a
`scout_coord.py`). Taxonoomia `<provider>:<keyword>:<location>`.

```bash
# A sweep elott
python3 /app/shared/skills/scout_workspace.py available "linkedin:python:IT" --agent scout-1
# exit 0 = szabad → claim
python3 /app/shared/skills/scout_workspace.py claim scout-1 "linkedin:python:IT"
# ... vegezd el a sweep-et ...
python3 /app/shared/skills/scout_workspace.py release scout-1 "linkedin:python:IT"
```

Alapertelmezett TTL 30 perc: ha egy Scout meghal release nelkul, a TTL utan a
claim automatikusan lejar es egy masik Scout atveheti.

### 🆕 E. Frisesseg-fokusz (SC-07)

Szurok "az elmult 7 napban kozzeteve" alapertelmezetten. Ugyanazon forras ujra-sweep-je 6 orankent,
nem surubb. last_scan_at nyomonkovetese a `scout_workspace.history`-ban.

## Javasolt Scout operativ folyamat

```bash
MY_ID="scout-1"
SOURCE="linkedin:python:IT"

# 1. Coord — forras lefoglalasa
if ! python3 /app/shared/skills/scout_workspace.py available "$SOURCE" --agent "$MY_ID"; then
  echo "forras masik Scout altal lefoglalva, kihagyas"
  exit 0
fi
python3 /app/shared/skills/scout_workspace.py claim "$MY_ID" "$SOURCE" >/dev/null

# 2. LinkedIn kereses (nincs bejelentkezes, guest endpoint, frisesseg 7 nap)
python3 /app/shared/skills/linkedin_access.py search \
    --keywords "python junior" --location "Italy" \
    --limit 25 --posted-within-days 7 > /tmp/scout_results.jsonl

# 3. Minden eredmenyhez: dedup (SC-05) + nyilvanos JD lekerese + INSERT
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

## Anti-mintak

- ❌ `scout_workspace.claim` kihagyasa mert "ugyis egyedul vagyok" — amint
  4 Scout-ra skalazol, akkor jonnek elo a Canonical duplikaciok.
- ❌ Fetch L1 → blokkolva → L1 ujraprobalasa ugyanazzal az UA-val: a kaszkad
  L1→L2→L3 pontosan ezert letezik. Soha ne ismeteld ugyanazon a szinten.
- ❌ L3 HTML letoltese (persistent context felhasznaloi cookie-kkal) es
  a PDF/HTML commitolasa a repoba — ezek felhasznaloi munkamenet cookie-k,
  csak a `$JHT_HOME/.cache/`-ben elnek.
- ❌ Email polling 30 percnel surubben — szerver oldali IMAP rate-limit
  + nincsenek uj ertesitesek az elemzeshez.
- ❌ A `fetch-job` altal visszaadott `deadline` figyelmen kivul hagyasa — az F-4
  lejarati nyomonkovetes csak akkor mukodik, ha kitoltod a `positions.deadline`-t.

## Lasd meg

- `shared/skills/web_scrape_robust.py`
- `shared/skills/linkedin_access.py`
- `shared/skills/email_monitor.py`
- `shared/skills/scout_workspace.py`
- `agents/scout/scout.md` § SC-05/SC-06/SC-07
- `agents/_skills/expiration-tracking/SKILL.md` (F-4 deadline)
- `docs/internal/_archive/2026-05-17-team-strategy-bugs.md` §F-2
