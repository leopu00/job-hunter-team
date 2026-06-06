<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: mentor-patterns
description: Os cinco padrões que o Mentor procura nos registos para decidir QUANDO falar. Silêncio é o padrão; apenas um padrão real e recorrente merece uma palavra. Esta skill dá o método canónico de deteção para cada padrão (consulta DB + limiar) para que o Mentor nunca fale a partir de um único ponto de dados. Read-only — nunca escreve no DB. Pertence ao Mentor.
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(grep *), Bash(awk *)
---

# mentor-patterns — o que os registos revelam

O Mentor observa conjuntos, não pontos individuais. Cinco padrões valem a pena mencionar; todo o resto é ruído.

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

## Referências cruzadas de padrões

Padrões reforçam-se mutuamente. Sinal forte:
- **A + C** (lacuna de competência + componente baixo em `stack_match`) → quase certamente vale a pena falar.
- **B `[SENIORITY]` + C `experience_fit`** → desalinhamento de seniority, mencionar uma vez.
- **D cluster de rejeição + E critic_score < 5** → problema de CV, escalar como Padrão E.

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

## Ver também

- `mentor-output` — COMO formular a mensagem uma vez que um padrão é confirmado.
- `db-query` — internos do wrapper.
- `agents/mentor/mentor.md` — prompt orquestrador + cadência.
- `agents/_team/team-rules.md` T10 — perfil é read-only, também para o Mentor.
