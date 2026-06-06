<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: scout-web-access
description: "Camada web-access cross-provider para os Scout (F-2). 5 componentes coordenados — anti-bot robust scrape, LinkedIn session + search, email IMAP poll, multi-Scout workspace claim, freshness focus. Usado como stack base para cada sweep: o Scout escolhe o nivel de acesso mais leve que funciona, e escala somente quando bloqueado."
allowed-tools: Bash(python3 /app/shared/skills/web_scrape_robust.py *), Bash(python3 /app/shared/skills/linkedin_access.py *), Bash(python3 /app/shared/skills/email_monitor.py *), Bash(python3 /app/shared/skills/scout_workspace.py *), Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/db_insert.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# scout-web-access — fontes de dados robustas para os Scout

## Por que existe

Sessao 17 mai — 3 sweep Scout-2 no LinkedIn (canonical/yo/mbg) todos
bloqueados por cookie wall + login form, orcamento Kimi desperdicado. Padrao
cross-provider verificado:

- **Claude** (anterior): LinkedIn fonte principal por padrao ✅
- **Codex**: acessa mas nao espontaneamente 🟡
- **Kimi** (atual): cookie wall ❌

Esta skill fecha a lacuna **sem login** aproveitando o endpoint guest
do LinkedIn (`jobs-guest/jobs/api/seeMoreJobPostings/search`) e a URL
publica `/jobs/view/<ID>` (ambos re-confirmados 2026-05-17, ja
documentados no repo legacy `job-hunter/scout-3/`). Funciona igualmente em
qualquer provider porque trabalha no nivel shell HTTP, nao LLM browser.

## Os 5 componentes

### 🌐 A. `linkedin_access.py` — LinkedIn sem login (metodo legacy re-confirmado)

**Sem Playwright, sem login.** Metodo documentado no repo legacy
(`job-hunter/scout-3/FRIK.md:71`, `docs/architettura.md:89-90`) e re-verificado 2026-05-17:

```
/comm/jobs/view/<ID>   →  /jobs/view/<ID>   = endpoint PUBLICO
```

Busca via guest endpoint `linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search`
(sem autenticacao necessaria) que retorna cards HTML com `data-entity-urn="urn:li:jobPosting:<ID>"`.

```bash
# Buscar vagas dos ultimos 7 dias
python3 /app/shared/skills/linkedin_access.py search \
    --keywords "python junior" --location "Italy" \
    --limit 25 --posted-within-days 7
# → stdout JSONL, 1 vaga por linha {job_id, url, title, company, location, source}

# Obter detalhe JD (aceita URL completa, /comm/jobs/view/<ID>, ou apenas <ID>)
python3 /app/shared/skills/linkedin_access.py fetch-job 4402474915
# → {"job_id":"...","title":"Python Developer (Data-Focused)",
#    "company":"ManpowerGroup Talent Solutions",
#    "location":"Genoa, Liguria, Italy",
#    "jd_text":"...1863 chars...",
#    "seniority":"Associate","employment_type":"Full-time",
#    "job_function":"Analyst","industries":"...",
#    "deadline":"" (preenchido se encontrado no JD via F-4 deadline_extract)}

# Converte URL email → URL publica
python3 /app/shared/skills/linkedin_access.py convert-url \
    "https://www.linkedin.com/comm/jobs/view/4402474915?utm=email"
# → https://www.linkedin.com/jobs/view/4402474915
```

**Quando a vaga expirou**: o LinkedIn redireciona para uma SERP generica
("476 Python jobs in Italy"). A skill detecta o padrao e retorna
`{"expired": true, "note": "redirect a SERP — job expirado"}` — use
este flag para marcar a position `excluded` com tag `[LINK_MORTO]`.

### 🛡️ B. `web_scrape_robust.py` — cascata anti-bot

3 niveis, escalacao automatica ao primeiro `blocked:true` detectado:

- **L1**: `requests` + UA realista rotacionado + cookie jar. Rapido, baixo custo.
- **L2**: Playwright headless + stealth tweaks (navigator.webdriver=undefined,
  plugins, languages). Lida com SPA + alguns challenge Cloudflare.
- **L3**: Playwright **persistent context** (reutiliza sessao do usuario). Para
  dominios que exigem login (LinkedIn conteudo completo, Glassdoor Premium).

```bash
python3 /app/shared/skills/web_scrape_robust.py "https://board.com/jobs/123" --level 2
# → JSON com level, status, blocked, text_chars, html_path, title
```

Padroes de deteccao automaticos: "Just a moment...", "Cloudflare", "Access
Denied", "Please verify you are a human", "g-recaptcha", "Authwall".
Quando um dispara, `blocked:true` no resultado → o chamador marca a source
como "blacklist temporaria" e muda de alvo.

### 📧 C. `email_monitor.py` — polling IMAP para alertas de vagas

O usuario cria um email dedicado (ex. `jobs+jht@gmail.com`) + configura
regras de encaminhamento no cliente principal (`from: jobs-listings@linkedin.com →
forward to: jobs+jht@`). O Scout consulta a cada 30 min e extrai os links.

```bash
# Config: ~/.jht/credentials/email_monitor.json (criado pelo wizard)
# {"imap_host":"imap.gmail.com","user":"...","password":"...","from_filters":[...]}

python3 /app/shared/skills/email_monitor.py status
python3 /app/shared/skills/email_monitor.py poll --since-days 1
# → stdout JSONL: {"url":"https://linkedin.com/jobs/view/...","source":"linkedin-email"}
```

Idempotencia: estado em `$JHT_HOME/state/email_monitor_seen.json` com set
de `Message-ID` ja processados. Re-run seguro a cada 30 min sem duplicatas.

Vantagem principal: as vagas ja estao **pre-filtradas segundo o perfil do usuario**
pelas regras de alerta. Contorna o cookie wall do LinkedIn sem credenciais
LinkedIn do lado Scout — basta a caixa de correio.

### 🤝 D. `scout_workspace.py` — claim/release fonte

Estado compartilhado em `$JHT_HOME/agents/_team/scout_workspace.json` com
claim no nivel **fonte** (nao `position_id`, isso e
`scout_coord.py`). Taxonomia `<provider>:<keyword>:<location>`.

```bash
# Antes do sweep
python3 /app/shared/skills/scout_workspace.py available "linkedin:python:IT" --agent scout-1
# exit 0 = livre → claim
python3 /app/shared/skills/scout_workspace.py claim scout-1 "linkedin:python:IT"
# ... fazer o sweep ...
python3 /app/shared/skills/scout_workspace.py release scout-1 "linkedin:python:IT"
```

TTL padrao 30 min: se um Scout morre sem release, apos o TTL o
claim expira automaticamente e outro Scout pode assumi-lo.

### 🆕 E. Foco em frescor (SC-07)

Filtros "publicado nos ultimos 7 dias" por padrao. Re-sweep da mesma fonte a cada
6h, nao mais frequente. Rastreamento de last_scan_at em `scout_workspace.history`.

## Fluxo operacional Scout recomendado

```bash
MY_ID="scout-1"
SOURCE="linkedin:python:IT"

# 1. Coord — claim fonte
if ! python3 /app/shared/skills/scout_workspace.py available "$SOURCE" --agent "$MY_ID"; then
  echo "fonte reivindicada por outro Scout, pulando"
  exit 0
fi
python3 /app/shared/skills/scout_workspace.py claim "$MY_ID" "$SOURCE" >/dev/null

# 2. Busca LinkedIn (sem login, guest endpoint, frescor 7 dias)
python3 /app/shared/skills/linkedin_access.py search \
    --keywords "python junior" --location "Italy" \
    --limit 25 --posted-within-days 7 > /tmp/scout_results.jsonl

# 3. Para cada resultado: dedup (SC-05) + fetch JD publico + INSERT
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

## Anti-padroes

- ❌ Pular `scout_workspace.claim` porque "afinal sou so eu" — assim que
  voce escala para 4 Scout, e quando descobre duplicatas Canonical.
- ❌ Fetch L1 → bloqueado → retentar L1 com o mesmo UA: a cascata
  L1→L2→L3 existe para isso. Nunca repetir no mesmo nivel.
- ❌ Baixar o HTML L3 (persistent context com cookies do usuario) e
  commitar o PDF/HTML no repo — sao cookies de sessao do usuario,
  vivem apenas em `$JHT_HOME/.cache/`.
- ❌ Polling de email mais frequente que 30 min — rate-limit IMAP do lado servidor
  + nenhum novo alerta para analisar.
- ❌ Ignorar `deadline` retornado por `fetch-job` — o rastreamento de
  expiracao F-4 funciona apenas se voce preencher `positions.deadline`.

## Veja tambem

- `shared/skills/web_scrape_robust.py`
- `shared/skills/linkedin_access.py`
- `shared/skills/email_monitor.py`
- `shared/skills/scout_workspace.py`
- `agents/scout/scout.md` § SC-05/SC-06/SC-07
- `agents/_skills/expiration-tracking/SKILL.md` (F-4 deadline)
- `docs/internal/_archive/2026-05-17-team-strategy-bugs.md` §F-2
