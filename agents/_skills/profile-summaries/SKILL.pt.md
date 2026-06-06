<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: profile-summaries
description: Escrever os 4 resumos narrativos Markdown em `$JHT_HOME/profile/summaries/` que complementam o YAML estruturado. Os Scrittori a jusante PRECISAM destes — um YAML sozinho produz CVs estéreis porque não tem voz, narrativa nem posicionamento. Pertence ao Assistente. Os nomes de ficheiro são FIXOS (o frontend ignora qualquer outro); sempre escritos na primeira pessoa do utilizador ("sou um programador…"); sempre reescritos por inteiro (Write, não Edit append) — são snapshots do presente, não logs append-only.
allowed-tools: Bash(mkdir -p *)
---

# profile-summaries — a voz do candidato em disco

O YAML estruturado é ótimo para filtros e correspondências mas não diz nada sobre *quem* o candidato é. Os 4 ficheiros MD em `summaries/` carregam a narrativa que os Scrittori precisam para produzir CVs que leem como uma pessoa, não uma lista de checkboxes.

## Os 4 ficheiros (nomes de ficheiro são FIXOS)

| Ficheiro         | Título UI mostrado ao utilizador | O que contém                                                            | Limite de comprimento |
|------------------|----------------------------|-----------------------------------------------------------------------------|-----------|
| `about.md`       | **Quem és**                 | Resumo pessoal: papel atual/alvo, anos, setor, traço distintivo             | ~400 char |
| `preferences.md` | **Preferências contadas**   | Modalidade de trabalho, relocation, retribuição, horários, ambiente         | ~400 char |
| `goals.md`       | **Objetivos e dream job**   | O que procura nos próximos 1-3 anos, contexto/empresa dos sonhos            | ~500 char |
| `strengths.md`   | **Pontos fortes**           | 2-4 qualidades concretas com exemplo breve para cada                        | ~500 char |

Caminho: `$JHT_HOME/profile/summaries/<file>.md`. Criar o diretório se faltar:
```bash
mkdir -p "$JHT_HOME/profile/summaries"
```

Nomes de ficheiro diferentes (ex. `about-mario.md`, `goals_v2.md`) são **silenciosamente ignorados** pelo frontend.

## Restrições de estilo (vinculativas)

- **Markdown simples**: parágrafos separados por linha vazia, `**negrito**` para sublinhar, listas apenas se ajudarem a legibilidade.
- **Nenhuma tabela, nenhum header `#`** — estes MDs vivem em cards UI já titulados.
- **Comprimento**: respeitar o limite. Nada de muros de texto.
- **Primeira pessoa do utilizador**: `"sou um programador…"`, `"prefiro trabalhar remotamente…"`. Nunca terceira pessoa (`"Mario é…"`).
- **Tom**: natural, como se o utilizador falasse de si a um amigo especialista do setor.
- **Nunca caminhos / nomes de ficheiro / jargão** no texto — o utilizador lê "o resumo", não "about.md".

## Regra de atualização — reescrever por inteiro, nunca append

Quando chega uma informação que muda o sentido de um MD existente, **reescrever o ficheiro do zero** (tool `Write`, NÃO `Edit` append). São snapshots do presente, não logs cronológicos. Um append arrisca deixar parágrafos obsoletos ao lado do novo.

## Trigger — quando escrever cada ficheiro

| Ficheiro          | Quando escrevê-lo pela primeira vez / atualizá-lo                                                                                                                                                     |
|-------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `about.md`        | Tem papel + anos + ≥1 experiência. Reescrevê-lo sempre que muda algo substancial (papel, seniority, setor).                                                                                            |
| `preferences.md`  | Discutiu com o utilizador pelo menos uma de: modalidade de trabalho, relocation, retribuição. Atualizar sempre que uma destas muda.                                                                     |
| `goals.md`        | O utilizador contou aspirações / contexto ideal / dream job (mesmo parcial). Não forçar a mão: se não emergir espontaneamente, **perguntar uma só vez** "há algum tipo de contexto ou empresa onde te verias particularmente bem?". |
| `strengths.md`    | Recolheu **2+ experiências ou projetos relevantes**. Extrair 2-4 qualidades recorrentes do padrão.                                                                                                     |

## Regra de boot — primeiro CV carregado

Quando o utilizador carrega um CV, após ter populado o YAML escrever MÍNIMO **`about.md` + `strengths.md`** no mesmo turno. Tem dados suficientes (papel, anos, experiências, competências, tom) para fazê-lo imediatamente; não adiar. Saltar este passo significa que o Scrittore CV a jusante nunca terá o contexto narrativo do candidato → produzirá CVs estéreis. Você é o único ponto em que essa narrativa é capturada.

`preferences.md` e `goals.md` virão nos turnos seguintes (após a discussão específica).

## Exemplos

### `about.md` (setor tech)
```markdown
Sou um programador backend com 4 anos de experiência em **Python** e
sistemas distribuídos, ultimamente concentrado em pipelines ETL e APIs
de alto throughput. Venho de um percurso híbrido entre **data engineering**
e backend "clássico", e movo-me bem quando o problema está no meio:
modelação do dado + serviço que o expõe.

Procuro um papel backend ou data senior em que possa trazer ownership
end-to-end do serviço, não apenas "ticket".
```

### `strengths.md` (setor não-tech, exemplo cozinha)
```markdown
**Resistência nos picos.** Geri brigada de 12 pessoas num
restaurante com 200 cobertos à noite: aprendi a manter ritmo e
qualidade mesmo quando aquece a sério.

**Custo de matéria-prima.** Nos últimos 3 anos reduzi o food cost
da partida salgada de 34% para 28% trabalhando no menu e na relação
com os fornecedores, sem tocar na qualidade.

**Mentoria de equipa.** Formei 2 sous-chefs que agora gerem
autonomamente as suas brigadas.
```

## Anti-padrões

- ❌ Escrever em terceira pessoa ("Mario é um programador…") — o frontend renderiza o texto como voz direta do candidato, terceira pessoa soa alienante.
- ❌ Append via `Edit` em vez de `Write` — acaba com duas intros contraditórias no mesmo ficheiro.
- ❌ Tabelas / headers `#` / listas numeradas verbosas — o card UI tem o seu próprio chrome.
- ❌ Saltar `about.md` / `strengths.md` após upload de CV "porque já está escrito no YAML" — o YAML não tem tom, os scrittori produzem CVs estéreis.
- ❌ Inserir caminhos ou nomes de ficheiro (`/jht_home/profile/summaries/about.md`) no texto — o utilizador não sabe o que são.
- ❌ Escrever além do limite de comprimento — o card UI trunca / faz scroll horizontal, a mensagem perde-se.

## Ver também

- `profile-yaml` — skill irmã: dado estruturado que se atualiza em paralelo a estes MDs.
- `onboarding-flow` — quando na conversa recolher os dados que alimentam estes MDs.
- `agents/scrittore/scrittore.md` — o agente a jusante que lê estes MDs para escrever CVs com voz.
