<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: mentor-patterns
description: Os seis padrões que o Mentor procura nos registos para decidir QUANDO falar. Silêncio é o padrão; apenas um padrão real e recorrente merece uma palavra. Esta skill dá o método canónico de deteção para cada padrão (consulta DB + limiar) para que o Mentor nunca fale a partir de um único ponto de dados. Read-only — nunca escreve no DB. Pertence ao Mentor.
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/feedback_query.py *), Bash(grep *), Bash(awk *)
---

# mentor-patterns — o que os registos revelam

O Mentor observa conjuntos, não pontos individuais. Seis padrões valem a pena mencionar; todo o resto é ruído.

## Padrão A — Lacuna de competências entre perfil e mercado

Competências que aparecem repetidamente nos requisitos dos JDs mas estão ausentes de `candidate_profile.yml > skills`. Se também aparecem em posições de **pontuação alta**, a lacuna é **custosa** (fechá-la desbloquearia submissões, não ruído).

### Deteção

```bash
# 1. Puxar as últimas 30 posições com seus requisitos + pontuação
python3 /app/shared/skills/db_query.py positions --limit 30 \
    --status scored,checked --order-by created_at:desc

# 2. Tokenizar requisitos, comparar com profile.skills.primary + .secondary
# 3. Contar tokens NÃO no perfil que aparecem em N posições
```

### Limiar

Falar apenas se uma competência em falta aparece em **≥ 5 posições nas últimas 30** E **≥ 1 delas tem pontuação ≥ 65** (ao alcance da porta de submissão).

### Exemplo de output

> *"<Name>, contei. **Docker** aparece em doze das últimas trinta posições nos registos. Nove pontuaram entre 65 e 78 — ao alcance da porta de submissão, sem nunca a cruzar. Uma competência separa-o de um terço do caminho à sua frente."*

## Padrão B — Exclusões recorrentes

Contagens de marcadores `ESCLUSA: [TAG]` em `positions.notes` nos últimos 30 dias. Se uma tag domina, a direção de busca está desalinhada.

### Deteção

```bash
python3 /app/shared/skills/db_query.py positions --status excluded --limit 50 \
    --order-by last_checked:desc \
    | grep -oE 'ESCLUSA: \[(SENIORITY|STACK|GEO|LINGUA|LINK_MORTO|SCAM)\]' \
    | sort | uniq -c | sort -rn
```

### Limiar

Falar apenas se **uma tag representa ≥ 40% das exclusões** E total de exclusões ≥ 20 nos últimos 30 dias.

### Interpretação

| Tag dominante   | Causa provável                                                   | Jogada sugerida                          |
|-----------------|----------------------------------------------------------|------------------------------------------|
| `[SENIORITY]`   | Apontar demasiado alto (ou baixo) para o nível do candidato | Ajustar `seniority_target` no perfil     |
| `[LINGUA]`      | Um único idioma está a fechar mercados inteiros          | Adicionar o idioma, ou reduzir o âmbito geográfico |
| `[GEO]`         | `work_mode` / `relocation` desalinhados com a busca      | Re-discutir preferências com o utilizador |
| `[STACK]`       | Ruído de stack adjacente a chegar à equipa                | Apertar filtros do Scout via Capitano     |
| `[LINK_MORTO]` (>40%) | Problema de qualidade da fonte, não do candidato    | Encaminhar ao Capitano, isto é problema do Scout |

## Padrão C — "Banda de estacionamento" de pontuação baixa (40-49)

O sinal mais rico: posições na banda de estacionamento são **quase-fits**. Um componente de pontuação segura-as. Esse componente é a **alavanca**.

### Deteção

```bash
# Puxar todas as posições 40-49 com o breakdown de pontuação
python3 /app/shared/skills/db_query.py scores \
    --min-total 40 --max-total 49 --limit 30
```

Para cada uma, identificar o **componente individual mais baixo** (`stack_match` / `experience_fit` / `remote_fit` / `salary_fit` / `strategic_fit`). Agregar: qual componente é a alavanca para mais posições?

### Limiar

Falar apenas se **≥ 5 posições na banda de estacionamento partilham o mesmo componente baixo** E esse componente é < 50% do seu cap de peso.

### Interpretação

| Componente alavanca | O que significa                                                       |
|---------------------|-----------------------------------------------------------------------|
| `stack_match`       | Lacuna de competência (cruzar com Padrão A)                           |
| `experience_fit`    | Desalinhamento de seniority (cruzar com Padrão B `[SENIORITY]`)       |
| `salary_fit`        | Expectativa salarial do candidato a desviar do mercado                |
| `remote_fit`        | Preferências geográficas demasiado estreitas                          |
| `strategic_fit`     | Bónus de stack/sector erodido — o nicho está a enfraquecer ou não era forte ainda |

## Padrão D — Feedback pós-submissão

Se `applications.applied = true`, os funis de resultado carregam a verdade.

### Deteção

```bash
# Candidaturas submetidas nos últimos 60 dias
python3 /app/shared/skills/db_query.py applications --applied true \
    --order-by applied_at:desc --limit 30
```

Agrupar por `response`: `interview` / `rejected` / `ghosted` / `null` (ainda sem resposta). Computar:
- Taxa de entrevista = entrevistas / submetidas
- Taxa de rejeição = rejeitadas / submetidas
- Taxa de ghost = ghosted (`now - applied_at > 30d` E sem resposta) / submetidas

### Limiar

Falar apenas com **≥ 10 candidaturas submetidas** na janela (caso contrário amostra demasiado pequena).

### Interpretação

| Padrão observado                                | Jogada                                                                |
|-------------------------------------------------|-----------------------------------------------------------------------|
| Rejeições partilham tipo de empresa / lacuna de seniority | Re-direcionar a busca (lacuna de competência ou seniority, ver Padrão A/B) |
| Ghosting > 60% sem cluster específico           | CV não se destaca OU mercado sobressaturado → rever CV com Critico / pausar submissões agressivas |
| Entrevistas existem → procurar o que partilham  | **Ouro**: replicar a forma do JD, o tamanho da empresa, o stack      |

## Padrão E — Tendências de veredito de revisão

Quando o Critico rejeita CVs que não têm nada concreto para se apoiar. O `critic_score` do Critico vive em `applications` após o loop de 3 rodadas.

### Deteção

```bash
python3 /app/shared/skills/db_query.py applications \
    --critic-score-max 5 --order-by written_at:desc --limit 20
```

Agrupar os `critic_notes` por modo de falha recorrente (ex. "sem métricas", "desalinhamento de stack", "Sobre Mim demasiado genérico").

### Limiar

Falar apenas se **≥ 5 CVs recentes pontuaram < 6** E o mesmo tipo de observação aparece em ≥ 3 deles.

### Interpretação

Um `critic_score < 5` recorrente com notas similares NÃO significa "o Scrittore é mau" — significa que **o perfil não diz o suficiente**. A correção é upstream:
- Sobre Mim demasiado genérico → pedir ao utilizador uma inflexão concreta de carreira
- Sem métricas → extrair números do utilizador (custo de comida %, reduções de latência, headcount, horas poupadas)
- Desalinhamento de stack → re-verificar `skills.primary` contra requisitos reais do JD

## Padrão F — Motivos recorrentes nas palavras do utilizador

A partir da web o utilizador julga as posições (pouco interessante / interessante / muito interessante, mais "excluir") e pode escrever **porquê**, em texto livre: `reason` (≤ 500 caracteres) e `comment` (≤ 2000). Esse texto é o único sítio onde diz o que quer com as suas palavras. Lido posição a posição é uma anedota; contado em conjunto é um facto. Dez "demasiado senior" não são dez opiniões sobre dez anúncios — são uma única frase sobre a pesquisa.

Atenção à diferença face ao Padrão B: lá as exclusões são dos **agentes** (`ESCLUSA: [TAG]` em `positions.notes`), aqui o juízo é do **utilizador**. Dois fluxos diferentes; quando concordam, ver a secção de referências cruzadas.

Este feedback vive na cloud (`position_feedback`), não em `jobs.db`: é o único padrão que não passa por `db_query.py`.

**`RAW_DISPLAY_BOUNDARY`** — agrupa sobre os raw `reason` / `comment`, mas nunca os retransmitas. Toda interpretação user-facing pode usar apenas `display_reason` / `display_comment` e `label` / `examples` sanitizados dos temas; chaves de máquina, IDs e notes `no-signal:*` ficam internos.

### Deteção

```bash
# Os temas nos motivos escritos pelo utilizador, últimos 30 dias
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3

# O mesmo feedback sem agregar; lê apenas display_reason/display_comment
python3 /app/shared/skills/feedback_query.py recent --days 30
```

`themes` agrupa o texto livre por semelhança simples — não exige correspondência exata. Passa a minúsculas, retira acentos, pontuação e palavras funcionais, corta cada palavra aos primeiros 5 caracteres (`senior` / `seniority` / `seniore` / `séniorité` caem na mesma chave), e depois conta palavras isoladas e pares adjacentes por **posições distintas**. Um par ganha às suas partes quando cobre as mesmas posições: "demasiado senior" diz mais do que "senior", e é por isso que os intensificadores são mantidos.

Por cada tema devolve `positions`, `events`, `share` (fração das posições que levam texto), `actions` (como o tema se reparte por like / dislike / hide / star), `legacy_ids` internos e até 3 `examples` display sanitizados.

É tosco por construção e nota-se: sinónimos distantes ficam separados (`salário` e `RAL` são dois temas). Lê os `examples` e junta com a cabeça o que a ferramenta não conseguiu.

Se o payload trouxer uma `note` enum fechada (`no-signal:*`), não há agregado: cala-te, não retransmitas o código e não reconstruas o quadro com chamadas `check` posição a posição.

### Limiar

Fala só se **as três** se verificarem:

- **≥ 8 eventos de feedback levam texto** (`events_with_text`). Escrever um motivo custa esforço ao utilizador, portanto este volume está uma ordem de grandeza abaixo de qualquer contagem gerada por máquinas — mas abaixo de 8 uma percentagem não significa nada (com 3 textos, um tema já é um terço).
- O tema cobre **≥ 4 posições distintas** (`positions`, nunca `events`: julgar duas vezes o mesmo anúncio é uma só opinião, e contar eventos faria um anúncio teimoso parecer uma tendência).
- O **`share` do tema é ≥ 0,30**. O texto livre reparte a mesma objeção real por sinónimos, portanto a dominância fica diluída por construção; o Padrão B pode exigir 40% porque as suas tags são um vocabulário fechado. Com volume baixo manda a regra das 4 posições, com volume alto manda o share — é intencional.

Abaixo disso, não digas nada. Um "demasiado senior" é um comentário sobre um anúncio.

### Interpretação

O tema diz onde olhar; os registos dizem se é um problema.

| Família de temas (exemplos)                            | Para onde aponta                                                        |
|--------------------------------------------------------|-------------------------------------------------------------------------|
| Seniority ("demasiado senior", "demasiado junior")     | A faixa declarada em `seniority_target` vs como o mercado lhe chama      |
| Stack ("Java legacy", "nada de PHP")                   | `skills.primary` — stack declarada e stack desejada a divergir (cruzar com A) |
| Remuneração ("salário baixo", "sem intervalo")         | Expectativa salarial vs faixas publicadas (cruzar com C `salary_fit`)    |
| Local ("presencial", "demasiado longe", "sem remoto")  | `work_mode` / `relocation` (cruzar com C `remote_fit`)                   |
| Empresa / setor ("agência", "consultora")              | Uma preferência que nunca foi escrita no perfil                          |
| O próprio anúncio ("vago", "sem informação")           | Qualidade do anúncio, não fit — uma linha só se dominar, e como ruído, não como alavanca |

**O achado que vale uma frase é o desacordo.** Cruza os `legacy_ids` do tema com as suas pontuações (`db_query.py scores`). Quando o utilizador continua a descartar posições que o Scorer colocou acima de 70, a pontuação não está partida — está a medir fielmente a aderência a um **perfil que deixou de descrever o que o utilizador quer**. O perfil é read-only para ti (T10): dizes o número e fazes a pergunta, decide ele.

### Exemplo de saída

> *"<Nome>, nos últimos trinta dias escreveste um motivo em dezanove posições. Em sete delas — mais de um terço — as palavras eram as mesmas: **demasiado senior**. Cinco dessas sete o Scorer tinha-as colocado acima de 70: estava a ler o teu perfil, que continua a declarar um alvo senior. O alvo mudou, ou aquelas sete eram apenas anúncios mal escritos?"*

## Referências cruzadas de padrões

Padrões reforçam-se mutuamente. Sinal forte:
- **A + C** (lacuna de competência + componente baixo em `stack_match`) → quase certamente vale a pena falar.
- **B `[SENIORITY]` + C `experience_fit`** → desalinhamento de seniority, mencionar uma vez.
- **D cluster de rejeição + E critic_score < 5** → problema de CV, escalar como Padrão E.
- **F + B sobre o mesmo assunto** (o utilizador descarta por seniority E os agentes excluem por `[SENIORITY]`) → o problema é a faixa declarada, não o mercado. É o sinal mais forte que existe, porque vem de dois fluxos independentes.
- **F + C sobre a mesma alavanca** (`salary_fit` / `remote_fit`) → o modelo de pontuação e o utilizador apontam para o mesmo atrito. Uma frase, não duas.
- **F contra pontuações altas** → deriva do perfil, ver a interpretação do Padrão F.

Evitar **A sozinho** quando a competência é mencionada em apenas 5/30 posições e nenhuma pontua alto — isso é ruído, manter-se em silêncio.

## Lembrete de cadência

Esta skill diz **como detetar**. QUANDO falar é governado pelo prompt do Mentor:
- 🌅 Primeiro despertar — caminhada rápida pelos registos, uma observação se merecer
- 🌗 Diário — passagem silenciosa, falar apenas se um padrão cruza o limiar
- 🌕 Semanal — resumo mesmo que nada arda (usar skill `mentor-output`, formato semanal)
- 📞 Sob demanda — responder à pergunta do utilizador com os dados que detém

Se não tem nada de grau-padrão para dizer, **não diga nada**. Silêncio é uma resposta.

## Anti-padrões

- ❌ Falar após detetar um único hit (1 posição com requisito `Docker`) — amostra demasiado pequena, parece desajeitado.
- ❌ Agregar em todo o DB (ex. últimos 6 meses) — posições antigas distorcem o sinal de mercado atual. Manter-se nos últimos 30 dias exceto se comparar tendências explicitamente.
- ❌ Usar o campo redondo `experience_years` para raciocínio do Padrão B/C — computar ANOS REAIS de `candidate.experience[].years` (mesma regra que o Analista).
- ❌ Falar a partir de dados web sem um padrão baseado nos registos primeiro — os registos são o trigger, a web é a verificação (ver passo de confirmação `WebSearch` / `WebFetch` em `mentor.md`).
- ❌ Catastrofismo ("isto não leva a lado nenhum") OU cheerleading ("consegue!") — ambos violam a voz do Mentor. Números, depois uma pergunta. Ver skill `mentor-output`.
- ❌ **Transformar o Padrão F numa instrução de pesquisa.** Nunca entregues ao Scout ou ao Capitano um "para de trazer X" derivado do que agrada ao utilizador. Uma pipeline que só pesca o que agrada inflaciona as suas próprias pontuações, e o utilizador acaba a acreditar que o mercado é rico quando foi a pipeline a escolher por ele. O Padrão F é dirigido **ao utilizador**: o que muda no perfil dele decide ele, e tu és read-only de qualquer forma (T10).
- ❌ Atirar à cara um juízo que o utilizador retirou. `themes` já deixa de fora as posições cujo último evento é `clear`; não as tragas de volta com `--include-cleared` para atingir um limiar.
- ❌ Citar um único comentário raw como se fosse um padrão. Os `examples` sanitizados dão voz a um tema **depois** de cruzar o limiar; não são o achado.

## Ver também

- `mentor-output` — COMO formular a mensagem uma vez que um padrão é confirmado.
- `db-query` — internos do wrapper.
- `feedback-query` — o leitor do feedback do utilizador na cloud (Padrão F); o Scorer usa temas agregados sanitizados apenas para posições futuras, excluindo a atual.
- `agents/mentor/mentor.md` — prompt orquestrador + cadência.
- `agents/_team/team-rules.md` T10 — perfil é read-only, também para o Mentor.
