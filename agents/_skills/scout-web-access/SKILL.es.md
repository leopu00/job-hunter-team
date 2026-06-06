<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: scout-web-access
description: "Capa web-access cross-provider para los Scout (F-2). 5 componentes coordinados — anti-bot robust scrape, LinkedIn session + search, email IMAP poll, multi-Scout workspace claim, freshness focus. Usado como stack base para cada sweep: el Scout elige el nivel de acceso mas ligero que funciona, y escala solo cuando esta bloqueado."
allowed-tools: Bash(python3 /app/shared/skills/web_scrape_robust.py *), Bash(python3 /app/shared/skills/linkedin_access.py *), Bash(python3 /app/shared/skills/email_monitor.py *), Bash(python3 /app/shared/skills/scout_workspace.py *), Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/db_insert.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# scout-web-access — fuentes de datos robustas para los Scout

## Por que existe

Sesion 17 may — 3 sweep Scout-2 en LinkedIn (canonical/yo/mbg) todos
bloqueados por cookie wall + login form, presupuesto Kimi desperdiciado. Patron
cross-provider verificado:

- **Claude** (anterior): LinkedIn fuente principal por defecto ✅
- **Codex**: accede pero no espontaneamente 🟡
- **Kimi** (actual): cookie wall ❌

Esta skill cierra la brecha **sin login** aprovechando el endpoint guest
de LinkedIn (`jobs-guest/jobs/api/seeMoreJobPostings/search`) y la URL
publica `/jobs/view/<ID>` (ambos re-confirmados 2026-05-17, ya
documentados en el repo legacy `job-hunter/scout-3/`). Funciona igual en
cualquier provider porque trabaja a nivel shell HTTP, no LLM browser.

## Los 5 componentes

### 🌐 A. `linkedin_access.py` — LinkedIn sin login (metodo legacy re-confirmado)

**Sin Playwright, sin login.** Metodo documentado en el repo legacy
(`job-hunter/scout-3/FRIK.md:71`, `docs/architettura.md:89-90`) y re-verificado 2026-05-17:

```
/comm/jobs/view/<ID>   →  /jobs/view/<ID>   = endpoint PUBLICO
```

Busqueda via guest endpoint `linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`
(sin autenticacion requerida) que retorna cards HTML con `data-entity-urn="urn:li:jobPosting:<ID>"`.

```bash
# Buscar ofertas de los ultimos 7 dias
python3 /app/shared/skills/linkedin_access.py search \
    --keywords "python junior" --location "Italy" \
    --limit 25 --posted-within-days 7
# → stdout JSONL, 1 oferta por linea {job_id, url, title, company, location, source}

# Obtener detalle JD (acepta URL completa, /comm/jobs/view/<ID>, o solo <ID>)
python3 /app/shared/skills/linkedin_access.py fetch-job 4402474915
# → {"job_id":"...","title":"Python Developer (Data-Focused)",
#    "company":"ManpowerGroup Talent Solutions",
#    "location":"Genoa, Liguria, Italy",
#    "jd_text":"...1863 chars...",
#    "seniority":"Associate","employment_type":"Full-time",
#    "job_function":"Analyst","industries":"...",
#    "deadline":"" (poblado si se encuentra en el JD via F-4 deadline_extract)}

# Convierte URL email → URL publica
python3 /app/shared/skills/linkedin_access.py convert-url \
    "https://www.linkedin.com/comm/jobs/view/4402474915?utm=email"
# → https://www.linkedin.com/jobs/view/4402474915
```

**Cuando la oferta ha expirado**: LinkedIn redirige a una SERP generica
("476 Python jobs in Italy"). La skill detecta el patron y retorna
`{"expired": true, "note": "redirect a SERP — job expirado"}` — usa
este flag para marcar la position `excluded` con tag `[LINK_MORTO]`.

### 🛡️ B. `web_scrape_robust.py` — cascada anti-bot

3 niveles, escalacion automatica al primer `blocked:true` detectado:

- **L1**: `requests` + UA realista rotado + cookie jar. Rapido, bajo costo.
- **L2**: Playwright headless + stealth tweaks (navigator.webdriver=undefined,
  plugins, languages). Gestiona SPA + algunos challenge Cloudflare.
- **L3**: Playwright **persistent context** (reutiliza sesion de usuario). Para
  dominios que requieren login (LinkedIn contenido completo, Glassdoor Premium).

```bash
python3 /app/shared/skills/web_scrape_robust.py "https://board.com/jobs/123" --level 2
# → JSON con level, status, blocked, text_chars, html_path, title
```

Patrones de deteccion automaticos: "Just a moment...", "Cloudflare", "Access
Denied", "Please verify you are a human", "g-recaptcha", "Authwall".
Cuando uno se activa, `blocked:true` en el resultado → el llamador marca la source
como "blacklist temporal" y cambia de objetivo.

### 📧 C. `email_monitor.py` — polling IMAP para alertas de ofertas

El usuario crea un email dedicado (ej. `jobs+jht@gmail.com`) + configura
reglas de reenvio en el cliente primario (`from: jobs-listings@linkedin.com →
forward to: jobs+jht@`). El Scout consulta cada 30 min y extrae los links.

```bash
# Config: ~/.jht/credentials/email_monitor.json (creado por el wizard)
# {"imap_host":"imap.gmail.com","user":"...","password":"...","from_filters":[...]}

python3 /app/shared/skills/email_monitor.py status
python3 /app/shared/skills/email_monitor.py poll --since-days 1
# → stdout JSONL: {"url":"https://linkedin.com/jobs/view/...","source":"linkedin-email"}
```

Idempotencia: estado en `$JHT_HOME/state/email_monitor_seen.json` con set
de `Message-ID` ya procesados. Re-run seguro cada 30 min sin duplicados.

Ventaja principal: las ofertas ya estan **pre-filtradas segun el perfil del usuario**
por las reglas de alerta. Evita el cookie wall de LinkedIn sin credenciales
LinkedIn del lado Scout — basta con el buzon de correo.

### 🤝 D. `scout_workspace.py` — claim/release fuente

Estado compartido en `$JHT_HOME/agents/_team/scout_workspace.json` con
claim a nivel **fuente** (no `position_id`, eso es
`scout_coord.py`). Taxonomia `<provider>:<keyword>:<location>`.

```bash
# Antes del sweep
python3 /app/shared/skills/scout_workspace.py available "linkedin:python:IT" --agent scout-1
# exit 0 = libre → claim
python3 /app/shared/skills/scout_workspace.py claim scout-1 "linkedin:python:IT"
# ... haz el sweep ...
python3 /app/shared/skills/scout_workspace.py release scout-1 "linkedin:python:IT"
```

TTL por defecto 30 min: si un Scout muere sin hacer release, tras el TTL el
claim expira automaticamente y otro Scout puede tomarlo.

### 🆕 E. Enfoque en frescura (SC-07)

Filtros "publicado en los ultimos 7 dias" por defecto. Re-sweep de la misma fuente cada
6h, no mas frecuente. Seguimiento last_scan_at en `scout_workspace.history`.

## Flujo operativo Scout recomendado

```bash
MY_ID="scout-1"
SOURCE="linkedin:python:IT"

# 1. Coord — claim fuente
if ! python3 /app/shared/skills/scout_workspace.py available "$SOURCE" --agent "$MY_ID"; then
  echo "fuente reclamada por otro Scout, salto"
  exit 0
fi
python3 /app/shared/skills/scout_workspace.py claim "$MY_ID" "$SOURCE" >/dev/null

# 2. Busqueda LinkedIn (sin login, guest endpoint, frescura 7 dias)
python3 /app/shared/skills/linkedin_access.py search \
    --keywords "python junior" --location "Italy" \
    --limit 25 --posted-within-days 7 > /tmp/scout_results.jsonl

# 3. Por cada resultado: dedup (SC-05) + fetch JD publico + INSERT
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

## Anti-patrones

- ❌ Saltarse `scout_workspace.claim` porque "total soy el unico" — en cuanto
  escalas a 4 Scout, es cuando te encuentras duplicados Canonical.
- ❌ Fetch L1 → bloqueado → reintentar L1 con el mismo UA: la cascada
  L1→L2→L3 existe para eso. Nunca repetir en el mismo nivel.
- ❌ Descargar el HTML L3 (persistent context con cookies de usuario) y
  commitear el PDF/HTML en el repo — son cookies de sesion de usuario,
  viven solo en `$JHT_HOME/.cache/`.
- ❌ Polling email mas frecuente de 30 min — rate-limit IMAP del lado servidor
  + ningun alert nuevo que analizar.
- ❌ Ignorar `deadline` retornado por `fetch-job` — el seguimiento de
  expiracion F-4 funciona solo si pueblas `positions.deadline`.

## Ver tambien

- `shared/skills/web_scrape_robust.py`
- `shared/skills/linkedin_access.py`
- `shared/skills/email_monitor.py`
- `shared/skills/scout_workspace.py`
- `agents/scout/scout.md` § SC-05/SC-06/SC-07
- `agents/_skills/expiration-tracking/SKILL.md` (F-4 deadline)
- `docs/internal/_archive/2026-05-17-team-strategy-bugs.md` §F-2
