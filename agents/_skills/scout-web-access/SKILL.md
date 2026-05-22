---
name: scout-web-access
description: Strato web-access cross-provider per gli Scout (F-2). 5 componenti coordinati — anti-bot robust scrape, LinkedIn session + search, email IMAP poll, multi-Scout workspace claim, freshness focus. Usato come stack base per ogni sweep: lo Scout sceglie il livello di accesso più leggero che funziona, e sale solo quando bloccato.
allowed-tools: Bash(python3 /app/shared/skills/web_scrape_robust.py *), Bash(python3 /app/shared/skills/linkedin_access.py *), Bash(python3 /app/shared/skills/email_monitor.py *), Bash(python3 /app/shared/skills/scout_workspace.py *), Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/db_insert.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# scout-web-access — fonti dati robuste per gli Scout

## Perché esiste

Sessione 17 mag — 3 sweep Scout-2 su LinkedIn (canonical/yo/mbg) tutti
bloccati da cookie wall + login form, budget Kimi sprecato. Pattern
cross-provider verificato:

- **Claude** (precedente): LinkedIn fonte principale by default ✅
- **Codex**: accede ma non spontaneamente 🟡
- **Kimi** (attuale): cookie wall ❌

Questa skill chiude il gap **senza login** sfruttando l'endpoint guest
di LinkedIn (`jobs-guest/jobs/api/seeCompanyJobPostings/search`) e l'URL
pubblico `/jobs/view/<ID>` (entrambi ri-confermati 2026-05-17, già
documentati nel repo legacy `job-hunter/scout-3/`). Funziona uguale su
qualsiasi provider perché lavora a livello shell HTTP, non LLM browser.

## I 5 componenti

### 🌐 A. `linkedin_access.py` — LinkedIn senza login (metodo legacy ri-confermato)

**Niente Playwright, niente login.** Metodo documentato nel repo legacy
(`job-hunter/scout-3/FRIK.md:71`, `docs/architettura.md:89-90`) e ri-verificato 2026-05-17:

```
/comm/jobs/view/<ID>   →  /jobs/view/<ID>   = endpoint PUBBLICO
```

Search via guest endpoint `linkedin.com/jobs-guest/jobs/api/seeCompanyJobPostings/search`
(no auth required) che ritorna cards HTML con `data-entity-urn="urn:li:jobPosting:<ID>"`.

```bash
# Cerca jobs ultimi 7 giorni
python3 /app/shared/skills/linkedin_access.py search \
    --keywords "python junior" --location "Italy" \
    --limit 25 --posted-within-days 7
# → stdout JSONL, 1 job per riga {job_id, url, title, company, location, source}

# Fetch dettaglio JD (accetta URL completo, /comm/jobs/view/<ID>, o solo <ID>)
python3 /app/shared/skills/linkedin_access.py fetch-job 4402474915
# → {"job_id":"...","title":"Python Developer (Data-Focused)",
#    "company":"Company 101Group Company Solutions",
#    "location":"Genoa, Liguria, Italy",
#    "jd_text":"...1863 chars...",
#    "seniority":"Associate","employment_type":"Full-time",
#    "job_function":"Analyst","industries":"...",
#    "deadline":"" (popolato se trovato nel JD via F-4 deadline_extract)}

# Converte URL email → URL pubblico
python3 /app/shared/skills/linkedin_access.py convert-url \
    "https://www.linkedin.com/comm/jobs/view/4402474915?utm=email"
# → https://www.linkedin.com/jobs/view/4402474915
```

**Quando il job è scaduto**: LinkedIn redirige a una SERP generica
("476 Python jobs in Italy"). La skill rileva il pattern e ritorna
`{"expired": true, "note": "redirect a SERP — job scaduto"}` — usa
questo flag per marcare la position `excluded` con tag `[LINK_MORTO]`.

### 🛡️ B. `web_scrape_robust.py` — anti-bot cascade

3 livelli, escalation automatica al primo `blocked:true` rilevato:

- **L1**: `requests` + UA realistico rotato + cookie jar. Veloce, low-cost.
- **L2**: Playwright headless + stealth tweaks (navigator.webdriver=undefined,
  plugins, languages). Gestisce SPA + alcune Cloudflare challenge.
- **L3**: Playwright **persistent context** (riusa sessione utente). Per
  domini che richiedono login (LinkedIn full content, Glassdoor Premium).

```bash
python3 /app/shared/skills/web_scrape_robust.py "https://board.com/jobs/123" --level 2
# → JSON con level, status, blocked, text_chars, html_path, title
```

Detection patterns auto: "Just a moment...", "Cloudflare", "Access
Denied", "Please verify you are a human", "g-recaptcha", "Authwall".
Quando uno scatta, `blocked:true` nel result → caller marca la source
come "blacklist temporanea" e cambia target.

### 📧 C. `email_monitor.py` — IMAP poll job alerts

L'utente crea un'email dedicata (es. `jobs+jht@gmail.com`) + setta
forward rules sul client primario (`from: jobs-listings@linkedin.com →
forward to: jobs+jht@`). Lo Scout polla ogni 30 min e estrae i link.

```bash
# Config: ~/.jht/credentials/email_monitor.json (creato dal wizard)
# {"imap_host":"imap.gmail.com","user":"...","password":"...","from_filters":[...]}

python3 /app/shared/skills/email_monitor.py status
python3 /app/shared/skills/email_monitor.py poll --since-days 1
# → stdout JSONL: {"url":"https://linkedin.com/jobs/view/...","source":"linkedin-email"}
```

Idempotency: state in `$JHT_HOME/state/email_monitor_seen.json` con set
di `Message-ID` già processati. Re-run sicuro ogni 30 min senza duplicati.

Vantaggio principale: i job sono già **pre-filtrati sul target utente**
dalle alert rule. Aggira il cookie wall di LinkedIn senza credenziali
LinkedIn lato Scout — basta la mailbox.

### 🤝 D. `scout_workspace.py` — claim/release source

Stato condiviso in `$JHT_HOME/agents/_team/scout_workspace.json` con
claim a livello **sorgente** (non `position_id`, quello è
`scout_coord.py`). Tassonomia `<provider>:<keyword>:<location>`.

```bash
# Prima di sweep
python3 /app/shared/skills/scout_workspace.py available "linkedin:python:IT" --agent scout-1
# exit 0 = libero → claim
python3 /app/shared/skills/scout_workspace.py claim scout-1 "linkedin:python:IT"
# ... fai il sweep ...
python3 /app/shared/skills/scout_workspace.py release scout-1 "linkedin:python:IT"
```

TTL default 30 min: se uno Scout muore senza release, dopo TTL la
claim scade automaticamente e un altro Scout può prenderla.

### 🆕 E. Freshness focus (SC-07)

Filtri "posted in last 7 days" per default. Re-sweep stessa fonte ogni
6h, non più frequente. Tracking last_scan_at in `scout_workspace.history`.

## Flow operativo Scout consigliato

```bash
MY_ID="scout-1"
SOURCE="linkedin:python:IT"

# 1. Coord — claim source
if ! python3 /app/shared/skills/scout_workspace.py available "$SOURCE" --agent "$MY_ID"; then
  echo "source claimed da altro Scout, salto"
  exit 0
fi
python3 /app/shared/skills/scout_workspace.py claim "$MY_ID" "$SOURCE" >/dev/null

# 2. Search LinkedIn (no login, guest endpoint, freshness 7gg)
python3 /app/shared/skills/linkedin_access.py search \
    --keywords "python junior" --location "Italy" \
    --limit 25 --posted-within-days 7 > /tmp/scout_results.jsonl

# 3. Per ogni risultato: dedup (SC-05) + fetch JD pubblico + INSERT
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

- ❌ Skipping `scout_workspace.claim` perché "tanto sono solo io" — appena
  scali a 4 Scout, è il momento in cui ti scopri duplicati Company 033.
- ❌ Fetch L1 → blocked → ritentare L1 con lo stesso UA: la cascade
  L1→L2→L3 esiste apposta. Mai loop sullo stesso livello.
- ❌ Scaricare l'HTML L3 (persistent context con cookies utente) e
  committare il PDF/HTML nel repo — sono cookies di sessione utente,
  vivono solo in `$JHT_HOME/.cache/`.
- ❌ Polling email più frequente di 30 min — IMAP server-side rate-limit
  + niente nuovi alert da analizzare.
- ❌ Ignorare `deadline` ritornato da `fetch-job` — F-4 expiration
  tracking funziona solo se popoli `positions.deadline`.

## See also

- `shared/skills/web_scrape_robust.py`
- `shared/skills/linkedin_access.py`
- `shared/skills/email_monitor.py`
- `shared/skills/scout_workspace.py`
- `agents/scout/scout.md` § SC-05/SC-06/SC-07
- `agents/_skills/expiration-tracking/SKILL.md` (F-4 deadline)
- `docs/internal/_archive/2026-05-17-team-strategy-bugs.md` §F-2
