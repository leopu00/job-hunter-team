<!-- @translation: pt, ai-translated 2026-06-06 -->
# Esquema de Base de Dados — jobs.db (V6)

**Atualizado**: 2026-05-29
**Versão do esquema**: `PRAGMA user_version = 6`
**Alterações em relação a V5**: adicionadas colunas `positions.write_requested` (INTEGER DEFAULT 0) e `positions.write_requested_at` (TIMESTAMP) para Writer-on-demand. O utilizador seleciona a partir do painel web (botão "Escrever CV") ou via Telegram (`/cv <id>`) as posições para as quais deseja um CV; o Capitão gera Escritores on-demand apenas quando o flag está ativado. Migração idempotente via `_migrate_positions_write_requested()` (ALTER TABLE ADD COLUMN). Ver BACKLOG [JHT-WRITER-ON-DEMAND] (2026-05-29) e mig Supabase 024.
**Alterações V4→V5**: adicionada tabela `pending_user_messages` para o padrão fallback de notificações via cloud sync (decisão 2026-05-13 — Telegram em baixo/não configurado ⇒ escreve na DB ⇒ cloud sync ⇒ painel web). A migração é não destrutiva: `CREATE TABLE IF NOT EXISTS` + trigger touch_updated_at padrão. As DBs pré-V5 atualizam-se automaticamente no primeiro `ensure_schema()`.
**Alterações V3→V4**: adicionadas colunas `created_at` e `updated_at` uniformes em todas as 5 tabelas de dados, com `DEFAULT CURRENT_TIMESTAMP` (DBs novas) e trigger `touch_updated_at` (AFTER UPDATE) que mantém `updated_at` atualizado automaticamente a cada UPDATE. Os campos de domínio (`scored_at`, `applied_at`, `written_at`, `analyzed_at`, `found_at`, `last_checked`) permanecem para a semântica de eventos. Migração retroativa automática via `_migrate_v3_to_v4()` em `shared/skills/_db.py`: ALTER TABLE ADD COLUMN (sem DEFAULT — limite do SQLite) + UPDATE das linhas existentes com os campos de domínio `*_at` como fallback (ex. `created_at = COALESCE(found_at, CURRENT_TIMESTAMP)`).
**Alterações V2→V3**: adicionado `CHECK` constraint em `positions.status`. Migração via `_migrate_v2_to_v3()`.
**Caminho**: `$JHT_HOME/jobs.db` (canónico) ou `$JHT_DB=<ficheiro>`. Fora do contentor a cópia do repositório `shared/data/jobs.db` tem de ser PEDIDA com `JHT_DB_FALLBACK=1`: sem nenhuma destas o módulo falha em vez de adivinhar um caminho (O-26).
**Scripts de competências**: `shared/skills/`

Este ficheiro é a REFERÊNCIA OFICIAL do esquema da base de dados. Todos os agentes devem ler ESTE ficheiro para conhecer a estrutura das tabelas e os comandos disponíveis.

---

## Tabelas

### companies
| Coluna | Tipo | Predefinição | Notas |
|--------|------|--------------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| name | TEXT NOT NULL UNIQUE | | Nome da empresa (chave de correspondência) |
| website | TEXT | | URL do site empresarial |
| hq_country | TEXT | | País da sede principal |
| sector | TEXT | | Setor (fintech, ai, etc.) |
| size | TEXT | | Dimensão (startup, PME, enterprise) |
| glassdoor_rating | REAL | | Classificação Glassdoor |
| red_flags | TEXT | | Sinais de alerta encontrados |
| culture_notes | TEXT | | Notas sobre a cultura empresarial |
| analyzed_by | TEXT | | Quem analisou (analista-1, etc.) |
| analyzed_at | TIMESTAMP | CURRENT_TIMESTAMP | Quando foi analisada |
| verdict | TEXT | | GO, CAUTIOUS, NO_GO |
| logo | TEXT | | **mig 056** — data-URI base64 do logo (≤ ~35KB) — escrito SÓ pelo `logo_fetch.py` |
| logo_source | TEXT | | **mig 056** — URL fonte do logo (audit/refresh) |
| logo_fetched | INTEGER | 0 | **mig 056** — 1 = extração tentada (padrão office_geocoded); fila `next-for-logo-missing` |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserção de linha |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — atualizado automaticamente a cada UPDATE via trigger |

### positions
| Coluna | Tipo | Predefinição | Notas |
|--------|------|--------------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| title | TEXT NOT NULL | | Título da posição |
| company | TEXT NOT NULL | | Nome da empresa (texto) |
| company_id | INTEGER FK | NULL | Ligação a companies(id) — resolvido automaticamente |
| location | TEXT | | Localização unificada (Remote EU, London, etc.) |
| remote_type | TEXT | | full_remote, hybrid, onsite |
| salary_declared_min | INTEGER | | Salário declarado na JD — mínimo |
| salary_declared_max | INTEGER | | Salário declarado na JD — máximo |
| salary_declared_currency | TEXT | EUR | Moeda do salário declarado |
| salary_estimated_min | INTEGER | | Salário estimado — mínimo |
| salary_estimated_max | INTEGER | | Salário estimado — máximo |
| salary_estimated_currency | TEXT | EUR | Moeda do salário estimado |
| salary_estimated_source | TEXT | | Fonte da estimativa: glassdoor, levels.fyi, manual |
| url | TEXT | | URL da descrição da vaga |
| source | TEXT | | linkedin, indeed, glassdoor, dynamite, etc. |
| jd_text | TEXT | | Texto COMPLETO da descrição da vaga |
| requirements | TEXT | | Requisitos extraídos da JD |
| found_by | TEXT | | Quem encontrou (scout-1, etc.) |
| found_at | TIMESTAMP | CURRENT_TIMESTAMP | Quando foi encontrada |
| deadline | TEXT | | Prazo (YYYY-MM-DD ou "não presente") |
| status | TEXT | new | new → checked → scored → writing → ready → applied → response · `excluded` a partir de qualquer etapa. **V3: restringido por `CHECK` constraint** — os valores fora desta lista são rejeitados com `IntegrityError`. |
| notes | TEXT | | Notas livres |
| last_checked | TIMESTAMP | | Última verificação do link/JD |
| write_requested | INTEGER | 0 | **V6** — `1` = o utilizador pediu um CV para esta posição (via botão web ou `/cv` Telegram). O Capitão consulta esta coluna para gerar Escritores on-demand. |
| write_requested_at | TIMESTAMP | NULL | **V6** — quando o utilizador pediu o CV. Usado pelo Capitão para a ordenação FIFO ao gerar Escritores. |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserção de linha |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — atualizado automaticamente a cada UPDATE via trigger |

### position_highlights
| Coluna | Tipo | Predefinição | Notas |
|--------|------|--------------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL | | Ligação a positions(id) |
| type | TEXT NOT NULL | | pro, con |
| text | TEXT NOT NULL | | Texto do pró/contra |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserção de linha |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — atualizado automaticamente a cada UPDATE via trigger |

### scores
| Coluna | Tipo | Predefinição | Notas |
|--------|------|--------------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Ligação a positions(id) |
| total_score | INTEGER NOT NULL | | Pontuação total 0-100 |
| stack_match | INTEGER | | Sub-pontuação stack /40 |
| remote_fit | INTEGER | | Sub-pontuação remoto /25 |
| salary_fit | INTEGER | | Sub-pontuação salário /20 |
| experience_fit | INTEGER | | Sub-pontuação experiência |
| strategic_fit | INTEGER | | Sub-pontuação estratégico /15 |
| breakdown | TEXT | | Detalhe da pontuação |
| notes | TEXT | | Notas do scorer |
| scored_by | TEXT | | Quem atribuiu a pontuação |
| scored_at | TIMESTAMP | CURRENT_TIMESTAMP | Quando foi pontuado |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserção de linha |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — atualizado automaticamente a cada UPDATE via trigger |

### applications
| Coluna | Tipo | Predefinição | Notas |
|--------|------|--------------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Ligação a positions(id) |
| cv_path | TEXT | | Caminho do CV markdown |
| cl_path | TEXT | | Caminho da carta de apresentação markdown |
| cv_pdf_path | TEXT | | Caminho do CV PDF |
| cl_pdf_path | TEXT | | Caminho da carta de apresentação PDF |
| critic_verdict | TEXT | | PASS, NEEDS_WORK, REJECT |
| critic_score | REAL | | Nota do crítico (1-10) |
| critic_notes | TEXT | | Notas do crítico |
| status | TEXT | draft | draft (predefinição) — o flag operacional é `applied` (BOOLEAN). Os estados `review/approved` não são atualmente preenchidos pelos agentes. |
| written_at | TIMESTAMP | | Quando o CV foi criado |
| applied_at | TIMESTAMP | | Quando a candidatura foi enviada |
| applied_via | TEXT | | Onde foi enviada (linkedin, site, etc.) |
| response | TEXT | | Resposta recebida |
| response_at | TIMESTAMP | | Quando chegou a resposta |
| written_by | TEXT | | Quem escreveu (scrittore-1, etc.) |
| reviewed_by | TEXT | | Quem fez a revisão |
| critic_reviewed_at | TIMESTAMP | | Definido automaticamente com --critic-score |
| applied | BOOLEAN | 0 | TRUE se o utilizador enviou |
| interview_round | INTEGER | NULL | Fase da entrevista (1, 2, 3...) |
| cv_drive_id | TEXT | | ID do ficheiro Google Drive do CV PDF |
| cl_drive_id | TEXT | | ID do ficheiro Google Drive da carta PDF |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserção de linha |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — atualizado automaticamente a cada UPDATE via trigger |

### pending_user_messages

**V5** — fila de notificações para o utilizador com fallback no painel web quando o Telegram não está disponível/configurado. Cada agente que deseja comunicar com o utilizador faz uma INSERT aqui ANTES de tentar o Telegram: se o envio por Telegram tem sucesso, o agente atualiza `delivered_via='telegram'`; se falha ou o Telegram não está configurado, deixa `delivered_via='web'` e a linha é sincronizada no Supabase via `jht cloud push` → o painel web apresenta-a ao utilizador. A resposta do utilizador via web regressa nas colunas `user_reply`/`user_reply_at`; no ciclo seguinte o agente vê o marcador e responde pelo mesmo canal.

| Coluna | Tipo | Predefinição | Notas |
|--------|------|--------------|-------|
| id | INTEGER | PK AUTOINCREMENT | |
| agent | TEXT | NOT NULL | Quem escreve: `capitano`, `mentor`, `assistente`, ... |
| body | TEXT | NOT NULL | Texto da mensagem (markdown permitido) |
| kind | TEXT | 'notification' | `notification` / `question` / `digest` / `alert` |
| related_position_id | INTEGER | FK positions(id) | Opcional — para notificações ligadas a uma oferta |
| delivered_via | TEXT | NULL | `telegram` (entregue via bot) / `web` (pendente no painel) / NULL (em fila) |
| delivered_at | TIMESTAMP | | Quando foi entregue no canal escolhido |
| acknowledged_at | TIMESTAMP | | O utilizador leu/arquivou via painel |
| user_reply | TEXT | | Resposta do utilizador via painel web (opcional) |
| user_reply_at | TIMESTAMP | | Quando o utilizador respondeu |
| agent_seen_reply_at | TIMESTAMP | | Quando o agente viu a resposta — usado pelo marcador de proteção prompt-injection para evitar processamentos duplicados |
| cloud_synced_at | TIMESTAMP | | Definido por `jht cloud push` |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | Atualizado automaticamente a cada UPDATE via trigger |

---

## Índices

| Nome | Tabela | Colunas |
|------|--------|---------|
| idx_positions_status | positions | status |
| idx_positions_company | positions | company |
| idx_positions_company_id | positions | company_id |
| idx_positions_url | positions | url |
| idx_positions_write_requested | positions | write_requested (parcial WHERE = 1) |
| idx_scores_total | scores | total_score |
| idx_applications_status | applications | status |
| idx_pending_user_messages_agent | pending_user_messages | agent |
| idx_pending_user_messages_delivery | pending_user_messages | delivered_via, acknowledged_at |
| idx_pending_user_messages_unseen_reply | pending_user_messages | user_reply_at, agent_seen_reply_at |

---

## Comandos CLI

### Consultas
```bash
python3 shared/skills/db_query.py dashboard                    # Painel completo
python3 shared/skills/db_query.py stats                        # Contagens das tabelas
python3 shared/skills/db_query.py positions --status new       # Filtrar por estado
python3 shared/skills/db_query.py positions --min-score 70     # Filtrar por pontuação
python3 shared/skills/db_query.py position 42                  # Detalhe individual
python3 shared/skills/db_query.py companies --verdict GO       # Empresas por veredito
python3 shared/skills/db_query.py company "Azienda"            # Detalhe da empresa
python3 shared/skills/db_query.py check-url 4361788825         # Verificar duplicados
python3 shared/skills/db_query.py next-for-scorer              # Fila do scorer
python3 shared/skills/db_query.py next-for-scrittore           # Fila do escritor
python3 shared/skills/db_query.py next-for-critico             # ⚠️ legacy — o Crítico hoje é gerado pelo Escritor, não retira da fila
```

### Inserir
```bash
# Posição (Scout)
python3 shared/skills/db_insert.py position \
  --title "Python Developer" --company "Azienda" \
  --location "Remote EU" --remote-type full_remote \
  --salary-declared-min 40000 --salary-declared-max 65000 \
  --url "https://..." --source linkedin --found-by scout-1 \
  --jd-text "TESTO COMPLETO JD" --requirements "Python, Flask"

# Empresa (Analista)
python3 shared/skills/db_insert.py company \
  --name "Azienda" --hq-country "Italia" --sector "fintech" \
  --verdict GO --analyzed-by analista-1

# Pontuação (Scorer)
python3 shared/skills/db_insert.py score \
  --position-id 42 --total 85 --stack-match 35 --remote-fit 20 \
  --salary-fit 15 --experience-fit 5 --strategic-fit 10 --scored-by scorer

# Candidatura (Escritor)
python3 shared/skills/db_insert.py application \
  --position-id 42 --cv-path "..." --cl-path "..." \
  --cv-pdf-path "..." --cl-pdf-path "..." \
  --written-by scrittore-1 --written-at now

# Ponto forte/fraco (Analista/Scorer)
python3 shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Stack identico"
```

### Atualizar
```bash
# Estado da posição
python3 shared/skills/db_update.py position 42 --status checked

# Salário declarado
python3 shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Salário estimado
python3 shared/skills/db_update.py position 42 \
  --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Última verificação (OBRIGATÓRIO após a verificação do link)
python3 shared/skills/db_update.py position 42 --last-checked now

# Nota do crítico (critic_reviewed_at é definido automaticamente)
python3 shared/skills/db_update.py application 42 \
  --critic-verdict PASS --critic-score 8.5 --critic-notes "note"

# Candidatura enviada (applied=1 é definido automaticamente com --applied-at)
python3 shared/skills/db_update.py application 42 \
  --applied-at "2026-02-28" --applied-via linkedin

# Resposta
python3 shared/skills/db_update.py application 42 \
  --response "rejected" --response-at now

# Fase da entrevista (1=primeira entrevista, 2=segunda, etc.)
python3 shared/skills/db_update.py application 42 --interview-round 1
```

### Sincronização (armazenamento cloud opcional)
```bash
python3 shared/skills/db_to_sheets.py sync            # DB → Google Sheets
python3 shared/skills/db_to_sheets.py sync --dry-run  # Pré-visualização sem escrever

python3 shared/skills/db_to_supabase.py sync          # DB → Supabase (espelho só de leitura)
python3 shared/skills/db_to_supabase.py sync --dry-run

python3 shared/skills/db_to_drive.py sync             # CV/CL PDF → Google Drive
python3 shared/skills/db_to_drive.py sync --dry-run
```

### Migração
```bash
python3 shared/skills/db_migrate_v2.py --verify       # Verificar integridade
```

---

## Comportamentos automáticos

| Ação | Efeito automático |
|------|-------------------|
| `--critic-score X` | Define `critic_reviewed_at = NOW` |
| `--applied-at "..."` | Define `applied = 1` |
| Insert position com `--company "X"` | Resolução automática de `company_id` a partir de companies |
| Update position com `--company "X"` | Resolução automática de `company_id` a partir de companies |

---

## Pipeline de estados

```
new → checked → scored → writing → ready → applied → response
  │       │         │         │       │
  ▼       ▼         ▼         ▼       ▼
        excluded (link morto, não qualificado, score < 40, critic_score < 5, etc.)
```

**Estado por fase:**
- `new` — o Scout acabou de inserir (Fase 1)
- `checked` — o Analista verificou e promoveu (Fase 2) · `excluded` se [LINK_MORTO/SCAM/GEO/LINGUA/SENIORITY/STACK]
- `scored` — o Scorer atribuiu pontuação (Fase 3) · `excluded` se score < 40
- `writing` — o Escritor assumiu o cargo (Fase 4) — claim coordenado entre pares
- `ready` — a Ronda 3 do Crítico deu score ≥ 5 (Fase 4) · `excluded` se score < 5
- `applied` — o utilizador confirmou o envio (Fase 5) — manual, nunca pela equipa
- `response` — resposta recebida (`interview`/`rejected`/`ghosted`) — flag gerido pelo utilizador
