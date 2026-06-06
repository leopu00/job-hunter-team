<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: scout-web-access
description: "Cross-Provider web-access Schicht fuer die Scout (F-2). 5 koordinierte Komponenten — anti-bot robust scrape, LinkedIn session + search, email IMAP poll, multi-Scout workspace claim, freshness focus. Wird als Basis-Stack fuer jeden Sweep verwendet: der Scout waehlt die leichteste Zugangsebene die funktioniert, und eskaliert nur wenn blockiert."
allowed-tools: Bash(python3 /app/shared/skills/web_scrape_robust.py *), Bash(python3 /app/shared/skills/linkedin_access.py *), Bash(python3 /app/shared/skills/email_monitor.py *), Bash(python3 /app/shared/skills/scout_workspace.py *), Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/db_insert.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# scout-web-access — robuste Datenquellen fuer die Scout

## Warum es existiert

Sitzung 17. Mai — 3 Sweep Scout-2 auf LinkedIn (canonical/yo/mbg) alle
blockiert durch Cookie Wall + Login-Formular, Kimi-Budget verschwendet. Verifiziertes
Cross-Provider-Pattern:

- **Claude** (vorheriger): LinkedIn als Hauptquelle standardmaessig ✅
- **Codex**: greift zu, aber nicht von sich aus 🟡
- **Kimi** (aktueller): Cookie Wall ❌

Diese Skill schliesst die Luecke **ohne Login** durch Nutzung des Guest-Endpoints
von LinkedIn (`jobs-guest/jobs/api/seeMoreJobPostings/search`) und der
oeffentlichen URL `/jobs/view/<ID>` (beide re-bestaetigt 2026-05-17, bereits
dokumentiert im Legacy-Repo `job-hunter/scout-3/`). Funktioniert gleich auf
jedem Provider, da sie auf Shell-HTTP-Ebene arbeitet, nicht LLM-Browser.

## Die 5 Komponenten

### 🌐 A. `linkedin_access.py` — LinkedIn ohne Login (re-bestaetigte Legacy-Methode)

**Kein Playwright, kein Login.** Methode dokumentiert im Legacy-Repo
(`job-hunter/scout-3/FRIK.md:71`, `docs/architettura.md:89-90`) und re-verifiziert 2026-05-17:

```
/comm/jobs/view/<ID>   →  /jobs/view/<ID>   = OEFFENTLICHER Endpoint
```

Suche ueber Guest-Endpoint `linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`
(keine Authentifizierung erforderlich), der HTML-Cards mit `data-entity-urn="urn:li:jobPosting:<ID>"` zurueckgibt.

```bash
# Stellenangebote der letzten 7 Tage suchen
python3 /app/shared/skills/linkedin_access.py search \
    --keywords "python junior" --location "Italy" \
    --limit 25 --posted-within-days 7
# → stdout JSONL, 1 Stelle pro Zeile {job_id, url, title, company, location, source}

# JD-Details abrufen (akzeptiert vollstaendige URL, /comm/jobs/view/<ID>, oder nur <ID>)
python3 /app/shared/skills/linkedin_access.py fetch-job 4402474915
# → {"job_id":"...","title":"Python Developer (Data-Focused)",
#    "company":"ManpowerGroup Talent Solutions",
#    "location":"Genoa, Liguria, Italy",
#    "jd_text":"...1863 chars...",
#    "seniority":"Associate","employment_type":"Full-time",
#    "job_function":"Analyst","industries":"...",
#    "deadline":"" (befuellt wenn im JD gefunden via F-4 deadline_extract)}

# Konvertiert Email-URL → oeffentliche URL
python3 /app/shared/skills/linkedin_access.py convert-url \
    "https://www.linkedin.com/comm/jobs/view/4402474915?utm=email"
# → https://www.linkedin.com/jobs/view/4402474915
```

**Wenn die Stelle abgelaufen ist**: LinkedIn leitet auf eine generische SERP um
("476 Python jobs in Italy"). Die Skill erkennt das Muster und gibt
`{"expired": true, "note": "redirect a SERP — job abgelaufen"}` zurueck — verwende
diesen Flag um die Position als `excluded` mit Tag `[LINK_MORTO]` zu markieren.

### 🛡️ B. `web_scrape_robust.py` — Anti-Bot-Kaskade

3 Ebenen, automatische Eskalation beim ersten erkannten `blocked:true`:

- **L1**: `requests` + realistischer rotierter UA + Cookie-Jar. Schnell, guenstig.
- **L2**: Playwright headless + Stealth-Tweaks (navigator.webdriver=undefined,
  plugins, languages). Behandelt SPA + einige Cloudflare-Challenges.
- **L3**: Playwright **persistent context** (nutzt Benutzer-Session wieder). Fuer
  Domains die Login erfordern (LinkedIn vollstaendiger Inhalt, Glassdoor Premium).

```bash
python3 /app/shared/skills/web_scrape_robust.py "https://board.com/jobs/123" --level 2
# → JSON mit level, status, blocked, text_chars, html_path, title
```

Automatische Erkennungsmuster: "Just a moment...", "Cloudflare", "Access
Denied", "Please verify you are a human", "g-recaptcha", "Authwall".
Wenn eines ausloest, `blocked:true` im Ergebnis → der Aufrufer markiert die Source
als "temporaere Blacklist" und wechselt das Ziel.

### 📧 C. `email_monitor.py` — IMAP-Polling fuer Stellen-Alerts

Der Benutzer erstellt eine dedizierte E-Mail (z.B. `jobs+jht@gmail.com`) + richtet
Weiterleitungsregeln im primaeren Client ein (`from: jobs-listings@linkedin.com →
forward to: jobs+jht@`). Der Scout fragt alle 30 Min ab und extrahiert die Links.

```bash
# Config: ~/.jht/credentials/email_monitor.json (erstellt vom Wizard)
# {"imap_host":"imap.gmail.com","user":"...","password":"...","from_filters":[...]}

python3 /app/shared/skills/email_monitor.py status
python3 /app/shared/skills/email_monitor.py poll --since-days 1
# → stdout JSONL: {"url":"https://linkedin.com/jobs/view/...","source":"linkedin-email"}
```

Idempotenz: Zustand in `$JHT_HOME/state/email_monitor_seen.json` mit Set
von bereits verarbeiteten `Message-ID`. Sicherer Re-run alle 30 Min ohne Duplikate.

Hauptvorteil: die Stellen sind bereits **nach dem Benutzerprofil vorgefiltert**
durch die Alert-Regeln. Umgeht die Cookie-Wall von LinkedIn ohne LinkedIn-Zugangsdaten
auf Scout-Seite — die Mailbox genuegt.

### 🤝 D. `scout_workspace.py` — Claim/Release Quelle

Geteilter Zustand in `$JHT_HOME/agents/_team/scout_workspace.json` mit
Claim auf **Quell**-Ebene (nicht `position_id`, das ist
`scout_coord.py`). Taxonomie `<provider>:<keyword>:<location>`.

```bash
# Vor dem Sweep
python3 /app/shared/skills/scout_workspace.py available "linkedin:python:IT" --agent scout-1
# exit 0 = frei → Claim
python3 /app/shared/skills/scout_workspace.py claim scout-1 "linkedin:python:IT"
# ... Sweep durchfuehren ...
python3 /app/shared/skills/scout_workspace.py release scout-1 "linkedin:python:IT"
```

Standard-TTL 30 Min: wenn ein Scout ohne Release stirbt, laeuft der
Claim nach dem TTL automatisch ab und ein anderer Scout kann ihn uebernehmen.

### 🆕 E. Frische-Fokus (SC-07)

Filter "veroeffentlicht in den letzten 7 Tagen" standardmaessig. Re-Sweep derselben Quelle alle
6h, nicht haeufiger. Tracking von last_scan_at in `scout_workspace.history`.

## Empfohlener operativer Scout-Ablauf

```bash
MY_ID="scout-1"
SOURCE="linkedin:python:IT"

# 1. Coord — Quelle beanspruchen
if ! python3 /app/shared/skills/scout_workspace.py available "$SOURCE" --agent "$MY_ID"; then
  echo "Quelle von anderem Scout beansprucht, ueberspringe"
  exit 0
fi
python3 /app/shared/skills/scout_workspace.py claim "$MY_ID" "$SOURCE" >/dev/null

# 2. LinkedIn-Suche (kein Login, Guest-Endpoint, Frische 7 Tage)
python3 /app/shared/skills/linkedin_access.py search \
    --keywords "python junior" --location "Italy" \
    --limit 25 --posted-within-days 7 > /tmp/scout_results.jsonl

# 3. Fuer jedes Ergebnis: Dedup (SC-05) + oeffentliche JD abrufen + INSERT
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

## Anti-Patterns

- ❌ `scout_workspace.claim` ueberspringen weil "ich bin ja allein" — sobald
  du auf 4 Scout skalierst, entdeckst du Canonical-Duplikate.
- ❌ Fetch L1 → blockiert → L1 mit demselben UA erneut versuchen: die Kaskade
  L1→L2→L3 existiert genau dafuer. Nie auf derselben Ebene wiederholen.
- ❌ HTML von L3 herunterladen (persistent context mit Benutzer-Cookies) und
  PDF/HTML ins Repo committen — das sind Session-Cookies des Benutzers,
  die leben nur in `$JHT_HOME/.cache/`.
- ❌ E-Mail-Polling haeufiger als 30 Min — serverseitiges IMAP-Rate-Limit
  + keine neuen Alerts zum Analysieren.
- ❌ `deadline` von `fetch-job` ignorieren — das F-4-Ablauftracking
  funktioniert nur wenn du `positions.deadline` befuellst.

## Siehe auch

- `shared/skills/web_scrape_robust.py`
- `shared/skills/linkedin_access.py`
- `shared/skills/email_monitor.py`
- `shared/skills/scout_workspace.py`
- `agents/scout/scout.md` § SC-05/SC-06/SC-07
- `agents/_skills/expiration-tracking/SKILL.md` (F-4 deadline)
- `docs/internal/_archive/2026-05-17-team-strategy-bugs.md` §F-2
