<!-- @translation: pt, ai-translated 2026-06-06 -->
# 🧭 Job Hunter — Arquitetura da equipa

---

## 🧠 Como os agentes sao classificados por nivel

O JHT atribui cada funcao a um de **quatro niveis**, listados do mais alto ao mais baixo. O nivel indica o modelo + o esforco de raciocinio que o launcher passa a CLI do provider ativo.

| Nivel | Agentes | Claude | Codex | Kimi | O que faz |
|---|---|---|---|---|---|
| 🥇 **very smart** | 👨‍✈️ Captain | `opus-4-7` · effort `high` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Decisoes criticas e irreversiveis — profundidade maxima de raciocinio |
| 🥈 **expert** | 👨‍🏫 Writer · 👨‍⚖️ Critic · 🧙‍♂️ Mentor | `opus-4-7` · effort `medium` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Pattern-matching contra templates conhecidos (CV, revisao cega, analise de lacunas) |
| 🥉 **smart** | 🕵️ Scout · 👨‍🔬 Analyst · 👨‍💻 Scorer · 👩‍💼 Assistant | `sonnet-4-6` · effort `high` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Pesquisa, scraping, scoring, chat com o utilizador |
| 🎖️ **medium** | 💂 Sentinel | `sonnet-4-6` · effort `medium` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Watchdog leve — regras if-then, sem raciocinio profundo |

**Niveis de effort disponiveis (para referencia):**

- **Claude** — `low · medium · high · xhigh · max` (Opus 4.7, Apr 2026). `xhigh`/`max` nao utilizados por agora — compromisso de custos.
- **Codex** — `minimal · low · medium · high · xhigh` (GPT-5.5). Default `medium`.
- **Kimi** — a CLI ainda nao expoe niveis de effort, portanto todos os niveis convergem numa unica chamada.

---

## 🗺️ Pipeline de relance

```
   👤 User
     │
     ▼
   👨‍✈️ Captain ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──────► Phase 5 ──► 👤 User
                  🕵️ Discover  👨‍🔬 Verify  👨‍💻 Score   👨‍🏫 👨‍⚖️ Write+Review   📲 Notify
```

Cada fase abaixo corresponde a uma funcao de agente especializado. O Captain decide **quantas instancias** lancar por funcao em cada momento — o numero de agentes e dinamico, nao esta fixo na arquitetura.

---

## 1️⃣ Phase 1 — Discovery 🔍 🕵️

```
        👤 candidate_profile.yml ──┐
                                    │ circles, filters, work_mode
                                    ▼
        ┌──────────────────────────────────────┐
        │ 🕵️ Scout pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (no overlap on       │
        │ circles / sources / URLs)             │
        └────────────────────┬─────────────────┘
                             │ INSERT positions  (status = new)
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │ ──► Phase 2
                       └──────────────┘
                             ▲
                             │ [FEEDBACK]
                             │ (rejection patterns:
                             │  SENIORITY · STACK · GEO · LINGUA)
                             └── from 👨‍🔬 Analyst / 👨‍💻 Scorer
```

**O que os Scout fazem.** Extraem ofertas de emprego de job boards e ATSs, deduplicam contra `jobs.db` e inserem as novas posicoes com `status = new`. Param quando o Captain ordena.

### 🤝 Coordenacao multi-scout

Varios Scouts correm em paralelo sem nunca obter a mesma oferta duas vezes:

- 🗺️ **Particao no boot** — os peers descobrem-se mutuamente via `tmux list-sessions`, depois negoceiam territorio atraves de `scout_coord.py` (quais **circles** e **sources** cada um possui).
- 🎯 **Circles** — ambitos concentricos, esgotados de dentro para fora: ① preferencia primaria → ② vizinhos geograficos → ③ relocalizacao dirigida → ④ satelite → ⑤ fronteira (funcoes adjacentes).
- 📚 **Source tiers** — drenados por ordem: LinkedIn → agregadores ATS (Greenhouse/Lever/Indeed/Wellfound) → boards de nicho (PyJobs, RemoteOK, regionais) → WebSearch + paginas de carreiras.
- ⚖️ **Anti-bias** — se mais de 30% das posicoes de um batch vierem do mesmo empregador, o Scout muda source/query para o batch seguinte. Sem este mecanismo, uma scaleup que publica 12 funcoes num unico board inundaria o pool, sufocando a diversidade.
- 🛡️ **Anti-collision** — verificacao de deduplicacao em `positions.url` antes de cada `INSERT` ([`anti-collision.md`](../_manual/anti-collision.md)).

### 🔁 Escuta do feedback

Os Scout recebem mensagens `[FEEDBACK]` dos Analyst (e indiretamente dos Scorer via o Captain) etiquetados com `[SENIORITY] · [STACK] · [GEO] · [LINGUA]`, e ajustam queries/sources para o batch seguinte. Vieses sistemicos sao escalados ao Captain.

### 🛠️ Skills

Disponiveis em `/app/shared/skills/`:

- **`scout_coord.py`** — particao de territorio no boot (qual Scout possui quais circle/source); usado para negociar propriedade e verificar a atribuicao.
- **`db_query.py check-url`** — gate de deduplicacao. Executado antes de cada insert; retorna `TROVATA` (skip) ou `NON TROVATA` (prosseguir).
- **`db_insert.py position`** — escreve uma oferta verificada em `positions`. Campos obrigatorios: title, company, URL, location, texto JD, requisitos.
- **`db_update.py position`** — usado para marcar registos ja inseridos como `excluded` quando um duplicado escapa. Nunca DELETE.
- **`linkedin_check.py`** — enriquecimento autenticado no LinkedIn (job IDs → metadados completos da oferta) sem acionar o bloqueio robots do `fetch` MCP.

### 🌐 MCP tools

- **`jobspy`** — scraper multi-source para job boards (LinkedIn, Indeed, ZipRecruiter, Glassdoor) encapsulado como MCP. Descoberta rapida em massa, saida normalizada.
- **`linkedin`** — MCP dedicado ao LinkedIn para pesquisa + obtencao de ofertas.
- **`fetch`** — fetch HTTP generico para paginas de agregadores ATS (Greenhouse, Lever, Wellfound). ⚠️ Bloqueado pelo robots.txt do LinkedIn — os Scout recorrem a `curl` com user-agent de browser la.
- **`playwright`** — browser headless para paginas de carreiras JS-heavy onde o simples `fetch` nao renderiza o DOM.
- **`WebSearch`** *(built-in)* — fallback de nivel 4 quando ATSs/boards de nicho estao esgotados.

---

## 2️⃣ Phase 2 — Verification ✅ 👨‍🔬

```
                       📦 jobs.db
                       (status = new)
                              │
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍🔬 Analyst pool                      │
        │ N instances · Captain-managed         │
        │ peer-coordinated (last_checked        │
        │ timestamp prevents double-work)       │
        └────────────────────┬─────────────────┘
                             │ UPDATE positions
                             │   status = checked   → Phase 3
                             │   status = excluded  → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
                             │
                             │ [FEEDBACK]
                             │ (rejection patterns:
                             │  SENIORITY · STACK · GEO · LINGUA …)
                             ▼
                        🕵️ Scout pool
```

**O que os Analyst fazem.** Pegam as posicoes com `status = new`, obtem a JD ao vivo, validam o link, analisam 5 campos estruturados (`ESPERIENZA_RICHIESTA · ESPERIENZA_TIPO · LAUREA · LINGUA_RICHIESTA · SENIORITY_JD`), e promovem-nas a `checked` ou marcam como `excluded`. Os anos reais sao calculados a partir das entradas datadas no perfil, nao do campo arredondado `experience_years`. O candidato e tratado como **adaptavel** — stacks adjacentes nao sao excluidos, o Scorer aplica uma penalizacao proporcional de lacuna a jusante.

### 🚫 Tags de exclusao

As notas de exclusao comecam com `ESCLUSA: [TAG]` — `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` (`req > real+3` ou JD senior/lead) · `[STACK]` (fora de dominio). Quando ha incerteza → `checked`: os falsos negativos custam mais que os falsos positivos.

### 🤝 Coordenacao multi-analyst

- 🕒 **Watermark `last_checked`** — os Analyst saltam registos atualizados recentemente por um peer.
- 🛡️ **Contrato anti-collision** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Feedback aos Scout

Quando 3 exclusoes consecutivas atingem a mesma source com a mesma tag, ou um batch de um Scout excede 60% de taxa de rejeicao, o Analyst envia um `[FEEDBACK]` a esse Scout — especifico (source + tag + IDs), acionavel (alternativa sugerida), idempotente (um por padrao).

### 🛠️ Skills

- **`db_query.py next-for-analista`** — obtem a proxima posicao `status=new` respeitando o watermark `last_checked`.
- **`db_query.py position <ID>`** — obtem JD completa + metadados para a analise.
- **`db_update.py position <ID>`** — escreve o novo status (`checked` ou `excluded`) + notas estruturadas.
- **`linkedin_check.py`** — verificacao autenticada no LinkedIn (ativo / expirado / info da empresa).

### 🌐 MCP tools

- **`fetch`** — GET da JD ao vivo com `-L` + browser UA; deteta marcadores "expired / closed-job".
- **`playwright`** — fallback para paginas ATS JS-heavy que `fetch` nao consegue renderizar (Workable/Lever/Ashby).
- **`linkedin`** — contornado: as verificacoes do LinkedIn passam por `linkedin_check.py` (autenticado).

---

## 3️⃣ Phase 3 — Scoring 🎯 👨‍💻

```
                       📦 jobs.db
                       (status = checked)
                              │
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍💻 Scorer pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (last_checked < 5min │
        │ = peer claimed → skip)                │
        └────────────────────┬─────────────────┘
                             │ INSERT scores · UPDATE positions
                             │   score ≥ 50  → status = scored   → Phase 4
                             │   score 40-49 → status = scored   (parking)
                             │   score < 40  → status = excluded → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
                             │
                             │ score distribution
                             │ (high-score zones → Scout queries)
                             ▼
                        🕵️ Scout pool  (via 👨‍✈️ Captain)
```

**O que os Scorer fazem.** Executam um **pre-check** (anos de experiencia, localizacao, grau obrigatorio sem "ou equivalente") para filtrar posicoes nao avaliaveis, depois atribuem uma pontuacao 0-100 contra o perfil do candidato. `< 40` → `excluded`. `40-49` → `scored` (parking, o Captain decide depois). `≥ 50` → `scored` + notificacao aos Writer.

### 🧮 Formula de scoring (0-100)

| Componente | Peso | Coluna DB | O que mede |
|---|---|---|---|
| Stack match | 35 | `stack_match` | Skills requeridas vs stack do candidato |
| Seniority fit | 25 | `experience_fit` | Anos requeridos vs anos reais do candidato |
| Remote / location | 20 | `remote_fit` | Compatibilidade com as preferencias de localizacao do perfil |
| Salary fit | 10 | `salary_fit` | Faixa oferecida vs objetivo |
| Stack bonus | 10 | `strategic_fit` | Bonus tecnologico (AI · cybersec · fintech, se areas fortes do candidato) |

Penalizacoes aplicadas adicionalmente: `−10` grau obrigatorio sem "ou equivalente" · `−15` lingua obrigatoria nao falada · `−5` JD vaga sem requisitos concretos.

### 🤝 Coordenacao multi-scorer

- 🕒 **Claim `last_checked`** — o Scorer marca o timestamp antes de avaliar; os peers saltam registos reclamados nos ultimos 5 minutos.
- 🛡️ **Limite de escrita DB** — o Scorer escreve `scores` (INSERT) e apenas `positions.status`. Nunca toca em `applications`, `companies` ou `positions.notes` (territorio do Analyst).
- 🛡️ **Contrato anti-collision** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Feedback aos Scout (via Captain)

A distribuicao ao vivo das pontuacoes do Scorer (por source / funcao / geo / stack) e lida pelo Captain e retransmitida aos Scout, para que os proximos batches se concentrem nas zonas de alta pontuacao do candidato.

### 🛠️ Skills

- **`db_query.py next-for-scorer`** — obtem a proxima posicao `status=checked` respeitando `last_checked`.
- **`db_query.py position <ID>`** — registo completo + notas estruturadas do Analyst (as entradas da formula).
- **`db_insert.py score`** — escreve o detalhe (5 componentes + total).
- **`db_update.py position <ID>`** — define `status = scored | excluded`.

### 🌐 MCP tools

- **`fetch`** — re-valida o link antes do scoring (as ofertas morrem depressa — a Phase 2 pode ter sido ha algum tempo).

---

## 4️⃣ Phase 4 — Writing + Review ✍️ 👨‍🏫 👨‍⚖️

```
                       📦 jobs.db
                       (status = scored, score ≥ 50)
                              │  selection: ≥70 first, then 50-69 desc
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍🏫 Writer pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (status=writing      │
        │ claim prevents double-work)           │
        └────────────────────┬─────────────────┘
                             │ for each position:
                             │   3× rounds with a fresh Critic
                             ▼
        ┌──────────────────────────────────────┐
        │ 👨‍⚖️ Critic (CRITICO-S<N>)            │
        │ spawned fresh per round, killed after │
        │ blind review — no profile access      │
        └────────────────────┬─────────────────┘
                             │ critic_score 1-10
                             │ after round 3:
                             │   score ≥ 5 → status = ready    → Phase 5
                             │   score < 5 → status = excluded → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
```

**O que os Writer fazem.** Pegam as posicoes `status = scored` em ordem decrescente de pontuacao (primeiro as ≥70, depois as 50-69), reclamam-nas definindo `status = writing`, geram um CV personalizado (Cover Letter so se a JD pedir), e executam **3 rondas obrigatorias** com o Critic. Entre rondas o Writer corrige o CV e regenera o PDF. Gate final: `critic_score ≥ 5` → `ready`, caso contrario `excluded`. **Zero invenzioni** — cada afirmacao no CV deve ser rastreavel ate `candidate_profile.yml`.

**O que o Critic faz.** Criado de raiz para cada ronda (`CRITICO-S<N>`), recebe o caminho do PDF + URL da JD, executa uma **revisao cega** (sem acesso ao perfil — apenas a pagina que tem a frente), devolve um veredicto estruturado: nota X/10 + analise de estrutura/relevancia/impacto + tabela requisitos-vs-CV + acoes priorizadas. Eliminado apos cada revisao — nunca reutilizado. Usa a escala completa 1-10; sem notas de cortesia.

O loop Writer ↔ Critic e a fase com maior consumo de tokens. Ambos estao no nivel **expert** (modelo top + effort medio) — a tarefa esta bem definida, nao requer raciocinio exploratorio.

### 🤝 Coordenacao multi-writer

- 🛡️ **Claim `status = writing`** — os Writer mudam o status antes de escrever; os peers saltam registos ja reclamados.
- 🚫 **Anti-rewriting** — se `critic_verdict` ja esta definido, **skip absoluto** (o veredicto e final, sem re-revisao).
- 📡 **Limite de escrita DB** — o Writer toca apenas em `positions.status` e `applications`; nunca em `scores`, `companies`, `positions.notes`.

### 🛑 Captain freeze

Quando o Sentinel sinaliza saturacao de rate-limit, o Captain envia `[URG] FREEZE` aos Writer. Completam a ronda atual se estiverem a meio do loop (nunca abandonam um Critic a meio da revisao), depois dormem ate o throttle voltar a T0/T1.

### 🛠️ Skills

- **`db_query.py next-for-scrittore`** — obtem a proxima posicao em ordem decrescente de pontuacao.
- **`db_update.py position`** — muda `status = writing | ready | excluded`.
- **`db_insert.py application`** — regista a candidatura + caminhos CV/PDF.
- **`db_update.py application`** — guarda `critic_score · critic_verdict · critic_round · critic_notes` por ronda.
- **`pandoc`** — converte o CV markdown em PDF via motor Typst.

### 🌐 MCP tools

- **`fetch`** — re-valida o link da JD antes de escrever; o Critic usa o mesmo MCP para ler a JD ao vivo.
- **`WebFetch`** / **`WebSearch`** — fallback quando `fetch` nao consegue alcancar a JD (bloqueios LinkedIn / robots.txt).

---

## 5️⃣ Phase 5 — Notify 📲

```
                       📦 jobs.db
                       (status = ready)
                              │
                              ▼
                    👨‍✈️ Captain receives [RES]
                    from Writer (PDF + verdict)
                              │
                              ▼
                       📲 Telegram bot
                    (position · CV PDF · job link)
                              │
                              ▼
                         👤 User
                          ① reads the CV
                          ② sends feedback to 👨‍✈️ Captain
                          ③ applies manually using the link
                              │
                              ▼
                       📦 jobs.db
                       (status = applied — set by user)
```

**O que acontece.** Quando um Writer fecha a Phase 4 com `verdict = PASS` e `status = ready`, o Captain recebe uma mensagem `[RES]` com o PDF e o veredicto. Uma mensagem Telegram e enviada ao utilizador com o titulo da posicao, a empresa, o CV PDF gerado e o link para a oferta.

**Porque o passo de candidatura e totalmente manual.** O utilizador le o CV, avalia a compatibilidade por si mesmo, envia feedback ao Captain (`o tom nao bate` · `falta esta experiencia` · `bem — vou candidatar-me` · ...), e **so entao decide se se candidata** — usando o link que ja tem. Este checkpoint humano e intencional: mantem o JHT como um coach para o trabalhador, nao um canhao que dispara candidaturas de baixo esforco contra recrutadores. O volume do lado do recrutador so faz sentido se o trabalhador o escolheu.

**Atualizacao de status.** Quando o utilizador se candidata, a posicao e marcada `status = applied` manualmente (resposta Telegram ou botao "Candidatei-me" no web dashboard), com `applied_via = telegram | web | manual`. O ciclo opcional `response` (`interview` · `rejected` · `ghosted`) tambem e rastreado pelo utilizador.

### 🛠️ Skills / tools

- **`.launcher/tg-bridge.py`** — bridge de Telegram (Python): notificações de saída e feedback / atualizações de status do utilizador de entrada, um bot por papel user-facing.
- **`positions.applied`** — flag DB alterada pelo utilizador (nunca automaticamente pela equipa).

---

## 🎮 Orquestracao da pipeline

A pipeline nao e uma configuracao estatica de N instancias por funcao: e um **loop guiado por feedback** que o Captain gere dinamicamente com base no fluxo, na profundidade das filas e no orcamento do utilizador. Os numeros abaixo sao ilustrativos, nao normativos.

### 🥾 Cold start — encher o funil

Quando a pipeline arranca do zero, a prioridade e alimentar as filas a jusante rapidamente:

```
   T=0       →  3× 🕵️ Scout                                    (flood the funnel)
   T+ a bit  →  2× 🕵️ Scout · 1× 👨‍🔬 Analyst                    (first offers to verify)
   T+ more   →  2× 🕵️ Scout · 1× 👨‍🔬 Analyst · 1× 👨‍💻 Scorer    (first verified ready to score)
```

Se o Analyst ficar atrasado em relacao aos Scout, o Captain reequilibra em tempo real: `+1 Analyst · −1 Scout`. A mesma logica flui a jusante.

### 🔁 Feedback loop — pesquisa auto-afinada

O primeiro batch processado por cada funcao a jusante e **ouro** — sao os dados que o agente a jusante usa para instruir o que esta a montante:

- **👨‍🔬 Analyst → 🕵️ Scout** — apos um primeiro batch significativo, o Analyst sinaliza padroes de rejeicao (empresas que fecham ofertas rapido, boards fraudulentos, formas de JD que falham sempre na verificacao). Os Scout saltam-nos a montante.
- **👨‍💻 Scorer → 🕵️ Scout** — uma vez que o Scorer viu uma amostra, sabe quais funcoes/stacks/geografias pontuam alto. Retransmite a distribuicao para que os Scout procurem mais perto das zonas de alta pontuacao.

Resultado: a cada ciclo, os Scout encontram melhores ofertas, os Analyst rejeitam menos ofertas boas, os Scorer veem distribuicoes de pontuacao mais altas. A equipa torna-se um **sistema auto-afinado**.

### 🎯 Gate de ativacao do Writer

Os loops Writer + Critic sao a parte mais cara da pipeline (modelo top-tier, revisao iterativa). **Alternam** — o Writer espera enquanto o Critic revisa e vice-versa — portanto um par Writer + Critic custa aproximadamente **um agente continuo**, nao dois.

Para evitar gastar esses tokens em ofertas mediocres, o Captain condiciona a ativacao dos Writer a profundidade da fila com alta pontuacao:

1. Ordena as posicoes na fila por pontuacao decrescente.
2. Espera ate que se tenham acumulado ofertas de alta pontuacao suficientes (ex. **10+ ofertas com score ≥ 75**).
3. Lanca os Writer — comecam sempre pela posicao com a pontuacao mais alta na fila.

### 💰 Throttling budget-aware

Todas as contagens de instancias e limiares de gate adaptam-se ao orcamento mensal do utilizador e ao sinal de utilizacao ao vivo do side-channel [📡 Bridge → 💂 Sentinel](#-side-channel--usage-monitoring). Um bootstrap agressivo com um orcamento apertado e abrandado antes de comecar a escrita de qualidade — melhor saltar algumas ofertas do que queimar o orcamento na Discovery e nao ter nada para a Writing.

---

## 📡 Side-channel — Monitorizacao de utilizacao

Fora da pipeline. Corre continuamente em paralelo.

```
   ┌────────────┐  every tick  ┌────────────┐  notify on edge  ┌────────────┐
   │ 📡 Bridge  │ ───────────► │ 💂 Sentinel│ ───────────────► │ 👨‍✈️ Captain│
   │ (process,  │ usage + proj │ tier:      │  only on real    │            │
   │  not Claude│              │  medium    │  state changes   │            │
   │  agent)    │              │ event-     │                  │            │
   └────────────┘              │ driven     │                  └────────────┘
                               └────────────┘
```

**Bridge.** Um processo nao-IA que consulta a CLI de cada agente para a utilizacao atual e o esgotamento projetado. Envia um tick ao Sentinel.
**Sentinel.** Edge-triggered: ingere cada tick mas fala com o Captain *apenas* quando algo muda realmente (pico de utilizacao, violacao da projecao, crash de um agente).
**Captain.** Reage — abranda, congela a equipa, termina sessoes problematicas — com base no sinal do Sentinel.

---

## 🤝 Side-channel — Ajudantes orientados ao utilizador

```
                        👤 User
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
       👩‍💼 Assistant  👨‍✈️ Captain   🧙‍♂️ Mentor
       platform      team commander  career coach
       copilot                       (always-on)
```

- **👩‍💼 Assistant** — `tier: smart`. Traduz pedidos nao tecnicos do utilizador em ordens para o Captain. Esconde detalhes de implementacao do chat orientado ao utilizador.
- **🧙‍♂️ Mentor** — `tier: expert`, **ativo** (basico ja entregue, otimizacao em curso). Career coach: analisa a lacuna perfil/resultados, produz um plano de acao, check-ins estrategicos. Orientado ao utilizador, sempre ativo, criado no boot. Pasta: `agents/mentor/`.

---

## 🩺 Side-channel — Saude & manutencao

Fora da pipeline. Agentes **agendados one-shot**: o watchdog cria cada um no seu slot diario; executam uma varredura, reportam ao Captain e depois auto-destroem-se.

```
   ┌────────────┐  daily slot  ┌──────────────┐  report  ┌────────────┐
   │ watchdog   │ ───────────► │ 🩺 Dottore   │ ───────► │ 👨‍✈️ Captain│
   │ (scheduler)│              │ 👷‍♂️ Mantenitore│  findings │            │
   └────────────┘              └──────────────┘          └────────────┘
                                  one-shot → self-destruct
```

- **🩺 Dottore** — **saude dos agentes**. Refresh periodico de contexto + retrospetiva: deteta sessoes de agentes presas/zombie e reinicia-as com contexto fresco (threads de longa duracao que queimam contexto causam colapso silencioso do throughput). Pasta: `agents/dottore/`.
- **👷‍♂️ Mantenitore** — **saude da infra**. Varredura de manutencao diaria no container/VPS: smoke-test das ferramentas criticas para a missao (canary browser/Playwright), padronizacao de dependencias (`jht-install`), tendencia de disco/RAM, GC de orfaos. Uma ferramenta crucial avariada e um P1. Pasta: `agents/mantenitore/`.

---

## 💬 Comunicacao

```
   ┌──────────┐   tmux send-keys    ┌──────────┐
   │ Captain  │ ◄─────────────────► │ Agents   │
   │          │   [@from -> @to]     │ (one     │
   │          │   MSG / REQ / RES /  │  tmux    │
   │          │   URG                │  session │
   └────┬─────┘                      │  each)   │
        │                            └──────────┘
        │  Telegram bot
        ▼
    📲 User
```

As mensagens inter-agente usam um envelope etiquetado (`[@scout-1 -> @capitano] [REQ] ...`). Protocolo completo: [`agents/_manual/communication-rules.md`](../_manual/communication-rules.md).

---

## 🔗 Relacionado

- 📋 [`agents/_manual/`](../_manual/) — documentos de referencia operacional consumidos em runtime (esquema DB, protocolo de comunicacao, contrato anti-collision)
- 📜 [`docs/adr/`](../../docs/adr/) — decisoes arquiteturais (CLIs suportadas, single-writer, subscription-only)
