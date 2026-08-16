<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: position-insert
description: "A sequência de 5 portas que o Scout executa para CADA posição candidata antes do INSERT em `positions`: dedup → verificação de link → fetch do JD → filtros permissivos → INSERT. Pular qualquer porta enche o DB com duplicados, links mortos ou linhas fora de escopo que o Analista depois tem de descartar — orçamento Sonnet desperdiçado a jusante. Pertence ao papel Scout; combinar com `circles-and-sources` (decide ONDE procurar) e `scout-coord` (decide QUEM procura onde)."
allowed-tools: Bash(python3 *), Bash(grep *)
---

# position-insert — 5 portas por posição

Uma posição vale a pena inserir apenas se todas as cinco portas passarem. A ordem importa: as verificações mais baratas vêm primeiro para que as caras (fetch completo do JD + filtragem) executem apenas em candidatos viáveis.

## Porta 1 — Dedup (barata, obrigatória primeiro)

```bash
python3 /app/shared/skills/db_query.py check-url <linkedin_id_or_url>
```

- Output `TROVATA` → **SKIP** (já no DB, possivelmente com status diferente — nunca re-inserir).
- Output `NON TROVATA` → prosseguir para Porta 2.

A chave de dedup é o URL canónico (ou LinkedIn job ID para LinkedIn). Se o mesmo posting vem de duas fontes diferentes (ex. página de carreiras da empresa E um cross-listing LinkedIn), `check-url` deduplica.

## Porta 2 — Verificação de link (HTTP + URL)

Verificação em dois passos para detetar postings mortos E redirects silenciosos para uma página genérica `/careers` (= vaga removida mas página retorna 200).

### Passo 2a — status code + URL final

```bash
python3 /app/shared/skills/safe_fetch.py --status '<URL>'
```

| Resultado                                     | Ação                                          |
|-----------------------------------------------|------------------------------------------------|
| `HTTP:404` / `HTTP:410`                       | SKIP (link morto)                              |
| `HTTP:301/302` para um `/careers` ou `/jobs` genérico | SKIP (posição removida, redirect genérico) |
| `HTTP:200/301/302` URL final = página do posting | prosseguir para Passo 2b                    |

### Passo 2b — sinais de conteúdo

```bash
python3 /app/shared/skills/safe_fetch.py '<URL>' \
  | grep -i 'no longer accepting\|closed-job\|position has been filled\|expired\|job not found'
```

- Match → SKIP (vaga fechada)
- Sem match → prosseguir para Porta 3

### Nota Workable

Para ATS alojados em Workable: existem **dois** URLs por posting. Usar o correto:
- `apply.workable.com/...` → formulário de candidatura: retorna `302` quando a vaga está fechada (parece link morto, falso positivo).
- `jobs.workable.com/...` → página canónica do JD: HTTP 200 + JSON-LD válido se a posição está ativa.

Sempre verificar a página **canónica** (`jobs.workable.com`), não o formulário de candidatura. Mesmo princípio para Greenhouse, Lever, Ashby.

## Porta 3 — Fetch do JD COMPLETO

O contrato do DB requer que `--jd-text` e `--requirements` sejam COMPLETOS — scrapes parciais quebram o Analista a jusante.

```bash
# nível 1 — fetch verificado com UA de browser (maioria dos casos)
python3 /app/shared/skills/safe_fetch.py '<URL>' > $JHT_AGENT_DIR/tmp/jd-raw.html

# nível 2 — páginas JS-heavy (Wellfound, algumas carreiras custom): usar playwright MCP
# nível 3 — fallback: WebFetch / WebSearch
```

> `safe_fetch.py` substitui o `curl -L` de propósito: verifica **cada**
> salto dos redirects e recusa endereços internos à rede do contentor.
> Não voltes ao `curl` simples — uma página de anúncio que redireciona
> para `169.254.169.254` não é uma página de anúncio.

Extrair o **corpo completo do texto** (não apenas o título) e a **secção de requisitos** (competências, anos de experiência, idiomas). Se a página tem uma secção clara "Requirements" / "Must have" / "What you'll bring", copiar verbatim para `--requirements`.

Sites bloqueados (NÃO usar `fetch` MCP, bloqueado por robots.txt):
- `linkedin.com` → usar `linkedin_check.py` (autenticado) ou `safe_fetch.py`
- `wellfound.com` → usar `playwright` ou `safe_fetch.py`

## Porta 4 — Filtros permissivos ao nível do Scout

Aplicar APENAS os quatro filtros totalmente fora de escopo (tabela completa na skill `circles-and-sources`). Pular se:

- Título contém explicitamente: `senior`, `lead`, `staff`, `principal`, `head of`, `director`
- Work-auth geográfico incompatível (`US-only` / `Canada-only` e candidato não tem visto)
- Domínio completamente fora de IT/coding (e candidato está em IT)
- Requisito rígido de `> anos_reais + 3` anos de experiência

Tudo o resto: passar para a Porta 5. **Não fazer o trabalho do Analista** — stacks adjacentes, quase-fits, lacunas ligeiras são todos material `checked`; o Scorer aplica a penalidade de lacuna.

## Porta 5 — INSERT

```bash
python3 /app/shared/skills/db_insert.py position \
  --title "<TÍTULO>" \
  --company "<EMPRESA>" \
  --url "<URL canónico, NÃO formulário de candidatura>" \
  --location "<localização real do JD>" \
  --remote-type <full_remote|hybrid|on_site> \
  --source <slug fonte: linkedin|greenhouse|lever|indeed|wellfound|remoteok|...> \
  --found-by $MY_ID \
  --jd-text "<TEXTO COMPLETO DO JD>" \
  --requirements "<stack + requisitos extraídos do JD>"
```

**Todas as flags são obrigatórias** — `--jd-text` vazio ou `--url` em falta significa que o Analista não pode fazer o seu trabalho. O script `db_insert.py` impõe valores não-vazios; se rejeitar a sua chamada, corrija o input — nunca contornar com SQL direto.

## Fronteira de escrita no DB (T05 + papel)

O Scout escreve APENAS:
- `positions` (INSERT, nunca UPDATE exceto para o caso de recuperação de duplicado abaixo)

NUNCA toca:
- `companies` (território do Analista)
- `scores` (Scorer)
- `applications` (Scrittore)
- `position_highlights` (Analista)
- posições com `status != 'new'` (já movidas a jusante, mãos fora)

### Recuperação de duplicado (o único UPDATE permitido)

Se inseriu acidentalmente um duplicado (Porta 1 estava errada, ex. um URL normalizado passou), pode marcar o duplicado como excluído — mas nunca DELETE:

```bash
python3 /app/shared/skills/db_update.py position <DUP_ID> --status excluded \
  --notes "DUPLICATA di #<ORIGINAL_ID>"
```

`DELETE` / `DROP` SQL é proibido (T02 + segurança DB). Reversões via notas `excluded` são auditáveis; eliminações não.

## Após o INSERT — notificar Analistas

Após cada lote de 3-5 inserts, pingar as sessões do Analista com o range de IDs. Eles recolhem `status=new` do DB de qualquer forma, mas o ping reduz a latência:

```bash
jht-tmux-send ANALISTA-1 "[@$MY_ID -> @analista-1] [INFO] Batch 5 posizioni inserite (IDs: X-Y)"
```

Se tem 2 Analistas, alternar o alvo do ping para balancear carga (Analistas também têm coordenação de reivindicação `last_checked` por isso nunca está errado, mas a notificação tmux ajuda a responsividade).

## Anti-padrões

- ❌ Pular Porta 1 "porque parecia nova" — `check-url` é barato, executar sempre.
- ❌ Inserir com `--jd-text` vazio "preencho depois" — não há depois, o Analista processa-o a seguir.
- ❌ Ficar pelo primeiro estado sem seguir os redirects — um 302 para um `/careers` genérico parece vivo; `safe_fetch.py --status` segue-os, verificando cada salto.
- ❌ Verificar o formulário de candidatura no Workable em vez da página canónica do JD — links mortos falso-positivos.
- ❌ Usar `fetch` MCP em `linkedin.com` / `wellfound.com` — bloqueado, obtém um banner 403 em vez do JD.
- ❌ Contornar o wrapper com `python3 -c "import sqlite3; INSERT ..."` — quebra invariantes de dedup e rastreamento `found-by`, e agora a DB também o recusa: `positions.url` é UNIQUE. `UNIQUE constraint failed: positions.url` significa que o anúncio já está na DB — volta ao Gate 1, não tentes de novo com um URL retocado.
- ❌ Definir `--status` para algo diferente do padrão `new` (o Scout nunca define status manualmente; o wrapper trata disso).

## Ver também

- `circles-and-sources` — o que procurar ONDE (esta skill é o que fazer DEPOIS de encontrar um posting candidato).
- `scout-coord` — partição no boot (esta skill é por posição, a jusante da partição).
- `db-insert` — internos do wrapper + schema de `position`.
- `agents/_manual/anti-collision.md` — contrato de coordenação Scout mais amplo.
- `agents/scout/scout.md` — o prompt orquestrador que chama esta skill no loop principal.
