<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: cv-structure
description: Escrever o markdown do CV que será convertido em PDF e revisado pelo Critico. Seis secções fixas, máximo 2 páginas, cada afirmação rastreável até `candidate_profile.yml` (zero invenções — T10). Bullets seguem o padrão "métrica em negrito + tech entre parênteses"; tom corresponde ao tipo de empresa do JD (startup/corporativa/fintech); Carta de Apresentação apenas se o JD pedir explicitamente. Pertence ao Scrittore. Combinar com `application-flow` (reivindicação + caminho) e `critic-loop` (iterações de revisão).
allowed-tools: Bash(pandoc *)
---

# cv-structure — o layout canónico do CV

A saída vai para `$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md` (depois PDF via pandoc/typst). Regra de caminho: skill `application-flow` — nunca escrever o CV final sob `$JHT_AGENT_DIR` (é apenas rascunho, T11).

`<Candidato>` = `Nome_Cognome` do perfil. `<Company>` = nome da empresa normalizado PascalCase, sem espaços ou barras (ex. `Acme_Corp` → `AcmeCorp`).

## As 6 secções (ordem fixa, máximo 2 páginas)

| # | Secção             | Comprimento   | Conteúdo                                                                                         |
|---|--------------------|---------------|--------------------------------------------------------------------------------------------------|
| 1 | **Cabeçalho**      | 4-6 linhas    | Nome, título do papel alinhado ao JD, contactos (email/telefone/LinkedIn/GitHub), idiomas (CEFR) |
| 2 | **Sobre Mim**      | 2-3 linhas    | Credibilidade concreta. **NUNCA** frases genéricas ("apaixonado por", "orientado a resultados")  |
| 3 | **Experiência**    | 4-5 sub       | Cada sub = uma experiência, mapeada a **um requisito específico do JD**. Bullets: métrica + tech |
| 4 | **Competências Técnicas** | 1 tabela | Corresponde a palavras-chave do JD. Apenas tech realmente documentada no perfil.                |
| 5 | **Educação**       | 2-4 linhas    | Títulos exatos do perfil. Não se desculpar por graus em falta.                                   |
| 6 | **Projetos Pessoais** | 0-3 sub    | Apenas se reforçarem o fit com o JD. Pular a secção inteiramente se nada encaixar.              |

## Secção 1 — Cabeçalho

```markdown
# <Nome Cognome>
**<Título do papel alinhado ao JD>** · <Cidade, País>
✉️ <email> · 📱 <telefone> · 🔗 linkedin.com/in/<handle> · 💻 github.com/<handle>
🗣 <Idioma1 (nível)>, <Idioma2 (nível)>
```

Adaptar o título do papel: se o JD diz "Backend Engineer (Python)" use isso, não o alvo genérico do perfil. Manter-se verdadeiro — nunca reivindicar uma seniority que não tem.

## Secção 2 — Sobre Mim

2-3 linhas. O utilizador é uma pessoa real que fez coisas reais; mostre isso em 30-50 palavras. Frases proibidas:

| ❌ Proibido                            | ✅ Substituir por                                            |
|----------------------------------------|--------------------------------------------------------------|
| "Apaixonado por <X>"                   | um facto: "5 anos a construir <X> em produção"               |
| "Profissional orientado a resultados"  | um número: "Reduziu latência p95 de 320ms → 110ms em 3 serviços" |
| "À procura de oportunidade para crescer" | eliminar inteiramente; a candidatura em si sinaliza isso   |
| "Jogador de equipa orientado a detalhes" | dar um exemplo ou omitir                                   |

## Secção 3 — Experiência

A secção mais difícil. Cada sub-bloco é **uma experiência** mapeada a **um requisito do JD**.

```markdown
### <Papel> @ <Empresa> — <Mar 2022 – presente>
- **Reduziu tempo de cold-start de 4.2s → 0.8s** reescrevendo a camada de bootstrap (Python, asyncio, uvloop)
- **Enviou 3 produtos de dados orientados ao cliente** gerindo todo o stack (FastAPI, Postgres, dbt, Airflow)
- **Mentorizou 2 engenheiros backend juniores** nos seus primeiros incidentes de produção
```

Regras dos bullets:
- **Métrica em negrito** no início (número, %, tempo, escala)
- **Tech entre parênteses** no final do bullet
- **Verbo de ação** como primeira palavra (ver lista proibidos/permitidos abaixo)
- Uma linha por bullet. Se quebra linha, está a meter demasiado.
- 3-5 bullets por experiência. Menos = a experiência parece fraca; mais = ruído.

### Verbos de ação

| ✅ Usar                                               | ❌ Proibido                    |
|-------------------------------------------------------|---------------------------------|
| Built, Architected, Shipped, Engineered, Reduced,     | learned, studied, assisted,     |
| Migrated, Designed, Owned, Mentored, Scaled, Cut       | helped, was involved in,        |
|                                                       | participated in, was responsible for |

Verbos proibidos sinalizam uma voz júnior/incerta. Use a lista ativa mesmo quando o papel era júnior — foque-se no que *entregou*, não no que *fez*.

## Secção 4 — Competências Técnicas

Uma tabela markdown de 2 colunas que espelha a lista de palavras-chave do JD. **Apenas tech que o perfil realmente documenta.** Inventar uma ferramenta que não conhece é um falhanço instantâneo na revisão do Critico (e um kill de recrutador na vida real).

```markdown
| Área              | Stack                                                  |
|-------------------|--------------------------------------------------------|
| Linguagens        | Python, Go, Bash                                       |
| Backend           | FastAPI, Django, gRPC                                  |
| Dados             | PostgreSQL, Redis, dbt, Airflow                        |
| Infra             | Docker, GitHub Actions, AWS (EC2, S3, RDS)             |
```

As categorias devem corresponder ao que o JD enfatiza. Se o JD nunca menciona infra, eliminar ou comprimir essa linha.

## Secção 5 — Educação

```markdown
### <Grau>, <Instituição> — <Ano>
<nota de uma linha: GPA apenas se > 28/30 ≈ 3.5/4, título da tese apenas se relevante para o JD>
```

Se o candidato não tem grau:
- **Não se desculpar** ("atualmente a frequentar", "autodidata em vez de"). Desculpar-se sinaliza fraqueza.
- Listar certificações relevantes, bootcamps, programas online como entradas próprias.
- Apoiar-se na secção Experiência para carregar peso.

## Secção 6 — Projetos Pessoais (opcional)

Incluir APENAS se um projeto claramente reforça o fit com o JD. Mesmo padrão de bullets que Experiência.

```markdown
### <Nome do projeto> — <link github>
- **<métrica / resultado>** (<stack técnico>)
- Descrição de uma linha do que faz e porquê é relevante
```

Se nada encaixar, **pular a secção inteiramente**. Preenchimento vazio sinaliza falta de substância.

## Tom por tipo de empresa (dos sinais do JD)

| Tipo de empresa | Tom                                           | Sinais no JD                                                 |
|--------------|-----------------------------------------------|--------------------------------------------------------------|
| Startup      | Confiante, focado em ownership, direto, verbos de ação primeiro | "ritmo rápido", "vestir muitos chapéus", "early-stage", equipa pequena |
| Corporativa  | Profissional, estruturado, ciente de processos | "stakeholders", "cross-functional", equipa maior, processo bem definido |
| Fintech / regulada | Ciente de compliance, preciso, citar frameworks (PCI-DSS, SOC 2, ISO 27001) | menções a auditorias, reguladores, equipas de compliance |
| Agência      | Versátil, orientado ao cliente, amplitude sobre profundidade | "projetos variados", "orientado ao cliente", "delivery"     |

Não exagerar — tom é uma cor, não um disfarce. Os bullets mantêm-se factuais de qualquer forma.

## Carta de Apresentação (apenas se o JD pedir)

Padrão: **não escrever uma**. Token + tempo poupado. Escrever APENAS se o JD mencionar explicitamente ("por favor inclua uma carta de apresentação", "diga-nos porque quer este papel").

Comprimento: 250-400 palavras. Caminho: `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<Company>.{md,pdf}`.

```markdown
Abertura (direta, NÃO "Escrevo para expressar o meu interesse"):
"Candidato-me para <papel> porque <3-4 provas concretas que correspondem ao JD>."

Meio (1-2 parágrafos):
- Uma conquista passada específica que mapeia a dor principal do JD
- Uma coisa que notou sobre a empresa que vai além da landing page

Fecho:
- Uma linha orientada ao futuro: o que gostaria de fazer nos primeiros 90 dias
- "Disponível para discutir em mais detalhe."
```

Proibido em cartas de apresentação:
- "Escrevo para expressar o meu interesse…" → começa com esforço e termina sem nada
- "Por favor encontre em anexo o meu CV…" → é uma candidatura, é claro que está em anexo
- "Teria a honra…" → clichê corporativo

## Geração de PDF — engine + escrita atómica + UPDATE DB (W-03, bug #26)

### Engine: `wkhtmltopdf` (NÃO typst, NÃO fpdf2)

Decisão técnica de 2026-05-18 após investigação "estética CV simplificada":

- **`wkhtmltopdf 0.12.6` (Qt 5.15.8)** → engine oficial, já instalado
  no container. Produz CVs profissionais HTML+CSS, 2 páginas, ~30 KB
  (output idêntico aos CVs "bonitos" de 16 de maio).
- ❌ **NÃO usar `--pdf-engine=typst`**: typst não está disponível no
  pandoc 2.17 do container (exigiria pandoc 3.x). Erro
  histórico na skill, reportado 2026-05-18.
- ❌ **NÃO usar `pdf_gen.py` (fpdf2)** para CVs: é apenas fallback
  minimalista 80% dos casos simples. Para CVs user-facing produz layout
  espartano 1 página, sem CSS, sem espaçamento fino.

O anti-padrão histórico: gerar o PDF diretamente em
`$JHT_USER_DIR/cv/`, depois executar `db_update.py application --cv-pdf-path
...` separadamente. Se a Sentinella eliminasse o Scrittore entre os dois
passos (EMERGÊNCIA freeze 2026-05-17 04:43), o PDF ficava em disco mas
o DB tinha `cv_pdf_path=NULL`. Sisal 7.5/10 PASS tornou-se *"CV por
escrever"* no dashboard do utilizador — oportunidade top invisível.

Correção: tempfile + porta de tamanho + mv atómico + UPDATE single-shot. Se o
UPDATE falhar, remover o ficheiro final para não deixar um órfão.

```bash
# Nome final inclui position_id para que 2 vagas na mesma empresa não colidam (bug #25)
SRC_MD="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.md"
FINAL_PDF="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.pdf"
TMP_PDF="$(mktemp -t cv_${POSITION_ID}.XXXXXX.pdf)"

# ── PREFLIGHT ─────────────────────────────────────────────────────────
# Verificação explícita de que o engine está disponível ANTES do pandoc.
# Sem isso, em caso de skill obsoleta (typst que não existe, pandoc 3.x que
# falta, …) o Scrittore executava o comando, falhava, improvisava
# fallback aleatório → CVs feios de 2026-05-18 de manhã.
if ! command -v wkhtmltopdf >/dev/null 2>&1; then
  echo "[cv-structure] ABORT preflight: wkhtmltopdf não disponível."
  echo "  Engines alternativos aceitáveis: weasyprint (pandoc --pdf-engine=weasyprint)."
  echo "  NUNCA fallback para pdf_gen.py / fpdf2 para CVs (output feio)."
  echo "  Reportar o problema ao Capitano via [REPORT] e ABORT."
  exit 2
fi

# 1. Render via pandoc → html → wkhtmltopdf (engine vencedor, 32 KB / 2 pág).
#    --metadata title=... evita o warning do wkhtmltopdf "no title element".
pandoc "$SRC_MD" -o "$TMP_PDF" \
       --pdf-engine=wkhtmltopdf \
       --metadata title="CV $CANDIDATO"

# ── PORTA PÓS-RENDER: tamanho + Producer ─────────────────────────────
# DOIS checks obrigatórios. NENHUM dos dois é opcional.
#
# Check A) tamanho: < 20 KB indica engine errado (fpdf2 ~22 KB mas 1 pág
# espartana, wkhtmltopdf ≥30 KB com HTML+CSS completo). Limiar 20 KB OK para
# distinguir.
size=$(stat -c%s "$TMP_PDF" 2>/dev/null || stat -f%z "$TMP_PDF")
if [ ! -s "$TMP_PDF" ] || [ "$size" -lt 20000 ]; then
  echo "[cv-structure] ABORT pós-render: PDF $size B suspeito (esperado ≥20 KB)."
  echo "  Provável engine errado (fpdf2 minimalista em vez de wkhtmltopdf)."
  rm -f "$TMP_PDF"
  exit 3
fi

# Check B) Producer: deve ser wkhtmltopdf (= 'Qt 5.15.8' ou similar).
# Se é 'fpdf2' / vazio / '?', o engine NÃO era wkhtmltopdf — o PDF
# sairá de qualquer forma mas será feio. ABORT loud para o Capitano ver.
producer=$(python3 -c "
from pypdf import PdfReader
import sys
try:
    r = PdfReader('$TMP_PDF')
    m = r.metadata or {}
    print(m.get('/Producer', ''))
except Exception as e:
    print('?'); sys.exit(1)
" 2>/dev/null)
case "$producer" in
  *Qt*)
    : # OK, wkhtmltopdf trabalhou
    ;;
  *)
    echo "[cv-structure] ABORT pós-render: Producer='$producer' (esperado 'Qt 5.x.x')."
    echo "  O engine real NÃO era wkhtmltopdf — output não profissional."
    rm -f "$TMP_PDF"
    exit 4
    ;;
esac

# 3. Move atómico + UPDATE em sequência; rollback se UPDATE falhar
mv "$TMP_PDF" "$FINAL_PDF"
if ! python3 /app/shared/skills/db_update.py application "$POSITION_ID" \
        --cv-pdf-path "$FINAL_PDF" --written-at now; then
  echo "[cv-structure] UPDATE DB falhou, removo PDF para não deixar órfãos"
  rm -f "$FINAL_PDF"
  exit 1
fi
```

Códigos de saída:
- `0` → CV OK, DB atualizado, pronto para critic-loop
- `2` → preflight FAIL (engine não disponível) — sinalizar ao Capitano
- `3` → pós-render FAIL (tamanho < 20 KB, output minimalista) — engine errado
- `4` → pós-render FAIL (Producer != Qt) — engine errado
- `1` → DB UPDATE FAIL (rollback do ficheiro)

O Dottore via `cv-disk-audit` healthcheck (bug #18) reconecta eventuais
órfãos disco↔DB; adicionalmente agora sinaliza também os CVs com Producer não-Qt como
"engine errado — regenerar".

## Porta de status pré-geração (W-04, bug #26)

Antes de executar pandoc, verificar que a posição ainda é de grau scoring.
Por vezes o Analista marca `excluded` *depois* do Scrittore ter reivindicado
a posição (condição de corrida) e o Scrittore continua a escrever — 3 CVs
desperdiçados em Canonical ContainerImages / K8s / Deloitte nos dumps de
2026-05-17.

```bash
status=$(python3 /app/shared/skills/db_query.py position "$POSITION_ID" --field status)
case "$status" in
  excluded|rejected)
    echo "[cv-structure] position #$POSITION_ID é $status, a pular geração de CV"
    exit 0
    ;;
esac
```

## Regras rígidas

- **Zero invenções.** Cada métrica, cada tech, cada projeto deve ser rastreável até `candidate_profile.yml` ou as fontes fornecidas pelo utilizador. Inventar falha no Critico e é motivo de despedimento na vida real. T10.
- **Personalizar por JD.** O mesmo candidato recebe um CV diferente por papel: diferente Sobre Mim, diferente ênfase em Experiência, diferente ordem de Competências. CVs genéricos falham a porta de pontuação.
- **Um requisito → um bloco de experiência.** Se o JD tem 5 requisitos e a sua secção Experiência mapeia 2, não está a contar a história certa.
- **Máximo 2 páginas.** Recrutadores fazem leitura rápida. Se a página 3 existe, corte.

## Anti-padrões

- ❌ Sobre Mim genérico ("programador apaixonado com competências fortes") — kill instantâneo na revisão do Critico.
- ❌ Tabela de Competências com tech não documentada no perfil — invenção, violação T10.
- ❌ Desculpar-se por grau / anos em falta — sinaliza fraqueza.
- ❌ Mesmo CV para múltiplos JDs — a porta de pontuação penaliza CVs genéricos.
- ❌ Carta de apresentação quando não pedida — tokens desperdiçados, ciclo de revisão mais longo, sem valor.
- ❌ Mais de 5 bullets por experiência — recrutadores fazem leitura rápida, perde o impacto do bullet principal.

## Ver também

- `application-flow` — reivindicação + caminho + UPSERT ANTES de escrever uma única linha de CV.
- `critic-loop` — a revisão cega de 3 rodadas que se segue. Aplicar as suas `Concrete Actions` entre rodadas.
- `agents/_team/team-rules.md` T10 (perfil read-only) + T11 (entregáveis em `$JHT_USER_DIR`).
- `agents/scrittore/scrittore.md` — o prompt orquestrador que chama esta skill no loop principal.
