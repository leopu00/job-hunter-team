---
name: scout-language-gate
description: "Escolhe países e pesquisas pelas línguas do perfil e descarta um candidato cujo anúncio exige uma língua que o utilizador não fala ANTES de descarregar o anúncio completo. `plan` uma vez e `screen` em cada candidato com título e excerto. Caso real: 100 de 100 candidatos de um portal descartados por língua depois do download completo."
allowed-tools: Bash(python3 /app/shared/skills/scout_language.py *)
---
<!-- @translation: pt, ai-translated 2026-11-02 -->

# scout-language-gate — primeiro a língua, depois o download

A língua é o corte que mais vezes mata um candidato DEPOIS de a pesquisa, o download do anúncio completo e por vezes o INSERT já terem sido pagos. Esta skill aplica-o em código, antes do download, com o que a lista já mostra. Não inventa: só descarta com provas, e uma língua que o perfil fala, um anúncio em inglês ou um texto curto demais nunca são descartados.

## 1. Planear a pesquisa

`plan` dá a cada país um modo. `local`: o perfil fala lá uma língua de trabalho. `english_friendly`: as vagas em inglês são comuns e o perfil fala inglês: pesquisa lá, com os qualificadores que imprime (`English-speaking`, `international team`, `English required`). `english_only`: só vale a pena abrir anúncios em inglês. Nada é excluído (prioridade sim, exclusão não, SC-04): começa pela `order` impressa e não gastes as primeiras passagens em países `english_only`.

## 2. Verificar cada candidato antes do download

Dá ao `screen` o título e, se a fonte o mostrar, o excerto. `skip_language` (saída 10): não o descarregues; com `--log` já deixa a sua linha no log das passagens (resultado `language`, não aberto). `ok` ou `unknown`: segue pelos gates como sempre. Só lê o texto da lista: depois do download completo o anúncio passa pelos filtros do Gate 4 e pelo Analista como antes.

```bash
# once, before choosing countries and queries: the plan for THIS profile's languages
python3 /app/shared/skills/scout_language.py plan

# for each candidate, from what the LIST shows, BEFORE you fetch the full ad (exit 10 = drop it)
python3 /app/shared/skills/scout_language.py screen --title "<title>" --snippet "<the list's snippet, if any>" \
    --country nl --source greenhouse --log
```

## Regras

- Nunca saltes um candidato que o `screen` não descartou por adivinhares a língua: a ferramenta descarta com provas, tu não.
- Passa o texto como está na lista. A resposta só tem códigos (`required_language`, `ad_language`, `title_language`) e nada do anúncio é guardado.
- Sem línguas legíveis no perfil: o `screen` responde `unknown` a tudo e não descarta nada.
