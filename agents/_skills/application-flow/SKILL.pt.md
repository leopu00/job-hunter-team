<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: application-flow
description: Contrato de DB + sistema de arquivos que todo Scrittore segue ao levar uma posição de `scored` (≥50) para `ready`/`excluded`. Três portas ANTES de escrever uma única linha de CV (anti-reescrita, anti-colisão, verificação de link), um caminho canônico para os entregáveis, uma porta final após a 3ª rodada do Critico. Pular qualquer uma dessas portas produz trabalho duplicado, sobrescreve a reivindicação de outro Scrittore, ou — pior — empurra um CV de grau `excluded` para o utilizador como `ready`. Pertence ao Scrittore.
allowed-tools: Bash(python3 *), Bash(mkdir -p *), Bash(find *), Bash(test *)
---

# application-flow — reivindicar, escrever, validar

O Scrittore toca apenas duas áreas do DB:
- `positions.status` (writing → ready | excluded)
- `applications` (INSERT + UPDATE via UPSERT)

Tudo o resto está fora dos limites: nunca `scores`, `companies`, `position_highlights`, `positions.notes` (território do Analista), `positions.applied` (apenas Capitano/utilizador). T09 + fronteira de papel do scrittore.

## Passo 1 — Puxar a próxima posição

```bash
python3 /app/shared/skills/db_query.py next-for-scrittore
```

Prioridade: `score ≥ 70` primeiro, depois `50-69` decrescente. O script já ordena.

## Passo 2 — Porta anti-reescrita (DEVE ser executada antes da reivindicação)

Uma posição cujo veredito do Critico já está definido é FINAL — nunca re-avaliar.

```bash
if python3 /app/shared/skills/db_query.py application "$ID" >/dev/null; then
  : # exit 0 → application inexistente, OU application sem veredito → prossiga
else
  : # exit 1 → critic_verdict já valorizado → SKIP ABSOLUTO
  continue
fi
```

Códigos de saída:
- `0` → sem application ainda, ou application sem veredito → prossiga para o Passo 3.
- `1` → `critic_verdict` já definido → **SKIP ABSOLUTO**, o voto do Critico é final.

> ⚠️ `sqlite3` CLI NÃO está instalado no container. Use sempre `db_query.py`. Nunca contornos `python3 -c "import sqlite3 ..."` — eles ignoram as invariantes do script.

## Passo 3 — Reivindicação anti-colisão

Verificar que a posição não está já reivindicada por outro Scrittore, depois reivindicá-la atomicamente mudando o status.

```bash
# Verificar estado atual
python3 /app/shared/skills/db_query.py position "$ID"

# Se o status já for `writing` → outro Scrittore a tem, SKIP
# Caso contrário reivindicar:
python3 /app/shared/skills/db_update.py position "$ID" --status writing
```

Opcional mas recomendado: anunciar a reivindicação aos pares via tmux para que nem comecem a sequência de portas no mesmo ID.

```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -E '^SCRITTORE-[0-9]+$' | grep -v "^${MY_SESSION}$"); do
  jht-tmux-send "$s" "[@$MY_ID -> @${s,,}] [INFO] Sto prendendo position #$ID"
done
```

Detalhes do contrato anti-colisão: `agents/_manual/anti-collision.md`.

## Passo 4 — Verificação de link

Um JD que morreu entre a Fase 2 (Analista) e agora NÃO DEVE consumir orçamento do Critico. Verificação em dois níveis:

```bash
# Nível 1 — fetch verificado com UA de browser
python3 /app/shared/skills/safe_fetch.py "<JD-URL>" \
  | grep -i 'no longer accepting\|closed-job\|position has been filled\|expired\|job not found'
```

Se coincidir → marcar como excluída e sair:
```bash
python3 /app/shared/skills/db_update.py position "$ID" --status excluded \
  --notes "ESCLUSA: [LINK_MORTO] verificato dallo Scrittore prima di scrivere"
```

Nível 2 (apenas se o Nível 1 for inconclusivo) — fetch MCP, procurar "No longer accepting" / "applications closed" no DOM renderizado.

## Passo 5 — INSERT da linha de application + escrever o CV

Após o link ser válido, criar a linha de application. **Sempre via `db_update.py application` (UPSERT)** — nunca `python3 -c "import sqlite3 ... INSERT INTO applications ..."` diretamente.

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id "$ID" \
  --cv-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md" \
  --cv-pdf-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf" \
  --written-by "$MY_ID" --written-at now
```

> ⚠️ Nunca passe a string literal `'now'` como valor de timestamp para SQL feito à mão — fica armazenada como a string `"now"` em vez de um timestamp ISO. O wrapper trata `--written-at now` corretamente; o wrapper é o único caminho seguro.

Depois escreva o CV (skill `cv-structure`) → gere PDF → execute `critic-loop`.

## Passo 6 — Disciplina de caminhos (T11) + nomeação única (bug #25)

Os entregáveis finais DEVEM estar sob `$JHT_USER_DIR`, NUNCA sob `$JHT_AGENT_DIR`. **O nome do arquivo deve incluir `position_id`** para que 2+ vagas na mesma empresa não se sobrescrevam:

| Artefacto                      | Caminho                                                                                |
|--------------------------------|--------------------------------------------------------------------------------------|
| CV markdown                    | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.md`         |
| CV PDF                         | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.pdf`        |
| Carta de apresentação (apenas se solicitada) | `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<position_id>_<CompanySlug>.{md,pdf}` |

- `<Candidato>` = `Nome_Cognome` do perfil.
- `<position_id>` = `positions.id` (inteiro, monotónico, único).
- `<CompanySlug>` = empresa em minúsculas, não-alfanumérico → `-`. Ex. `canonical`, `bending-spoons`.
- `<TitleSlug>` = título em minúsculas + truncado até ~30 chars. Ex. `observability`, `junior-ubuntu`.

Exemplo para 2 vagas na Canonical (caso do bug #25):
```
CV_MarioRossi_28_canonical_observability.pdf
CV_MarioRossi_62_canonical_junior-ubuntu.pdf
```

Antes da correção do bug #25, ambos eram guardados como `CV_MarioRossi_Canonical.pdf` → o segundo sobrescrevia o primeiro → o DB tinha 2 linhas de application apontando para o mesmo arquivo → corrupção silenciosa de dados visível apenas quando o utilizador abria o PDF e lia o conteúdo da *outra* application.

Ao gravar o caminho no DB (`--cv-path`, `--cv-pdf-path`), grave o caminho `$JHT_USER_DIR/...`. Nunca um caminho sob `$JHT_AGENT_DIR` (esse é rascunho — veja workspace abaixo).

## Passo 7 — Porta final (após `critic-loop` atingir a rodada 3)

A skill `critic-loop` regista a pontuação de cada rodada; aqui persiste o veredito, altera o status da application e alinha o status da posição.

> ⚠️ **Regra de escritor único (bug #21).** `applications.status='ready'` é definido **apenas aqui, por si, após PASS do Critico**. O Critico nunca escreve `applications.status` diretamente — a sua única saída é `critic_verdict` + `critic_score`. Você é o dono da transição final.

**`--critic-notes` É VISÍVEL PARA O UTILIZADOR** — é renderizado sob o cartão de Candidatura do candidato com o **mesmo markdown que a fundamentação do Scorer**, por isso escreve-o assim (scorer RULE-09), nunca a linha telegráfica abaixo:
- **No idioma do utilizador** (RULE-T14 lista "critic feedback" como conteúdo user-locale). O ficheiro de review está em inglês — reformula-o para o candidato; não o deixes em inglês quando o idioma da equipa não o é.
- **Markdown que fala AO candidato**: começa com o veredito e como a pontuação se moveu ao longo das 3 rodadas *em palavras*, depois `**negrito**` nos pontos decisivos, um par de pontos prós/contras, um emoji com parcimónia. Dois parágrafos curtos — sem muro de texto, sem lista de palavras-chave.
- **Sem jargão interno** — nunca códigos de regras (`T10`, `RULE-*`), nomes de ferramentas (`WeasyPrint`/`pandoc`/`typst`) ou ids de sessão.
- Quebras de linha reais via `$'...\n...'` (um `\n` literal é impresso como texto). Constrói-o uma vez antes da porta:

```bash
CRITIC_NOTES=$'**PASS · 7.5/10** — estável nas três rodadas, um encaixe honesto e sólido.\n\n**Pontos fortes**\n- ✅ <força concreta: CV vs este cargo>\n- ✅ <outra força real>\n\n**A ter em conta**\n- ⚠️ <uma lacuna real, dita com clareza>\n\n<uma frase de fecho>'
# NEEDS_WORK/REJECT: mesma forma, mas indica o que falta e o que o elevaria.
```

```bash
# UPSERT final na application — veredito + pontuação + promoção ready/draft
# `--reviewed-by` deve ser definido para o ID de sessão do ÚLTIMO Critico que spawnou
# (ex. CRITICO-S3 se a rodada 3 foi a final). Sem isso, `reviewed_by`
# permanece NULL — observado 95% nulo pré-2026-05-22 (vps1-run-postmortem #1).
LAST_CRITIC="${LAST_CRITIC:-CRITICO-S3}"   # definido por critic-loop ao spawnar rodada

if [[ <final_verdict> == "PASS" ]]; then
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict PASS \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$LAST_CRITIC" \
    --status ready
else
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict <NEEDS_WORK|REJECT> \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$LAST_CRITIC"
  # status permanece 'draft' — a application não está pronta para o utilizador.
fi

# Status da posição — automático a partir da pontuação final
if [[ <final_score>_int >= 5 ]]; then
  python3 /app/shared/skills/db_update.py position "$ID" --status ready
else
  python3 /app/shared/skills/db_update.py position "$ID" --status excluded
fi
```

A promoção `applications.status='ready'` é o que torna o CV visível no dashboard `/ready` do utilizador. Pular isso deixa a linha em `'draft'` para sempre — o Capitano reporta uma contagem de ready com a qual o DB e o dashboard não concordam.

Depois notifique o Capitano com um `[REPORT]` (skill `tmux-send`).

## Workspace — `tools/` + `tmp/`, manutenção no boot (T12)

O seu `$JHT_AGENT_DIR` tem 2 subdiretórios canónicos criados pelo launcher:

| Subdir                       | O quê                                                              | Tempo de vida                           |
|------------------------------|-------------------------------------------------------------------|------------------------------------------|
| `$JHT_AGENT_DIR/tools/`      | scripts auxiliares que escreveu para si (parsers de JD avulsos, etc.) | enquanto úteis; auditar a cada boot     |
| `$JHT_AGENT_DIR/tmp/`        | rascunho: JDs descarregados, revisões de CV entre rodadas          | limpos no boot se mais antigos que 7 dias |

**Manutenção no boot (PRIMEIRO passo no seu loop, antes do Passo 1):**

```bash
mkdir -p "$JHT_AGENT_DIR/tools" "$JHT_AGENT_DIR/tmp"
find "$JHT_AGENT_DIR/tmp" -type f -mtime +7 -delete 2>/dev/null || true
```

Repetir a cada ~6h de execução contínua ou a cada ~50 iterações do loop principal. NÃO dentro de um loop apertado — custa chamadas ao FS.

> 🚫 **Fora dos limites:** nunca `find -delete` fora de `$JHT_AGENT_DIR/tmp/`. Nunca limpar `$JHT_USER_DIR` (entregáveis), nunca limpar workspaces de agentes irmãos. T12.

## Regras rígidas

- **Anti-reescrita antes da reivindicação, sempre.** Pular o Passo 2 significa re-executar o Critico numa application finalizada = tokens Opus desperdiçados e possivelmente sobrescrever um veredito final.
- **Reivindicar antes de escrever.** Um CV escrito sem reivindicação arrisca dois Scrittori a produzir CVs paralelos para a mesma posição.
- **Caminho sob `$JHT_USER_DIR/cv/`, nunca `$JHT_AGENT_DIR/`.** O utilizador procura sob `$JHT_USER_DIR`; CVs espalhados em workspaces de agentes são invisíveis para ele. T11.
- **Sem SQL direto.** Sempre `db_query.py` / `db_update.py` / `db_insert.py`. Os wrappers impõem invariantes das quais a equipa depende.
- **Sem git.** Sem `git add`, sem `git commit`, sem `git push` (T02).

## Anti-padrões

- ❌ Pular o Passo 2 (anti-reescrita) "porque a posição parece fresca" — exit 1 significa que o Critico já votou, nunca invisível.
- ❌ Reivindicar uma posição e depois escrever o CV sob `$JHT_AGENT_DIR/cv/` — o utilizador não consegue vê-lo; o caminho no DB está errado; violação T11.
- ❌ `python3 -c "import sqlite3; INSERT INTO applications ..."` — ignora a lógica de UPSERT, dados inválidos no DB.
- ❌ Passar `'now'` como string literal sem usar o wrapper — armazenado como string em vez de timestamp ISO.
- ❌ Tocar em `positions.notes` (coluna do Analista) — violação de fronteira de papel, quebra os campos estruturados do Analista.
- ❌ Definir `positions.applied` a partir daqui — apenas o Capitano ou o utilizador podem alterar essa flag.

## Ver também

- `cv-structure` — o que escrever entre o Passo 5 e `critic-loop`.
- `critic-loop` — a revisão de 3 rodadas que produz a pontuação final para o Passo 7.
- `agents/_manual/anti-collision.md` — contrato completo de coordenação multi-Scrittore.
- `agents/_manual/db-schema.md` — colunas de `applications` + fronteiras de papel.
- `agents/_team/team-rules.md` T11 (caminho dos entregáveis) + T12 (manutenção do workspace).
