<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: critic-loop
description: "Executar o loop obrigatório de revisão de CV de 3 rodadas com o Critico — autonomamente, sem passar pelo Capitano. Para cada rodada, gera uma sessão FRESCA `CRITICO-S<N>` (mesmo N que a sua sessão Scrittore: SCRITTORE-2 → CRITICO-S2), envia PDF + JD, espera pelo veredito estruturado, elimina o Critico, corrige o CV, regenera o PDF e inicia a próxima rodada com outra instância fresca. Três rodadas são inegociáveis — nem 1 nem 2. Após a 3ª rodada, porta: `critic_score ≥ 5` → `ready`, senão `excluded`. Pertence ao Scrittore."
allowed-tools: Bash(bash /app/.launcher/start-agent.sh *), Bash(tmux *), Bash(jht-tmux-send *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 *)
---

# critic-loop — 3 rodadas frescas, sem atalhos

O protocolo de 3 rodadas apanha o que um Critico sozinho não consegue:
- Um Critico fresco não carrega **nenhum viés de ancoragem** da pontuação da rodada anterior — lê o CV corrigido com olhos novos e tende a ser mais honesto, não mais brando.
- Após 3 rodadas a pontuação estabilizou: se converge alta o CV aguenta, se fica baixa o CV não é o fit certo (ou o candidato não é — `excluded`).

**Você gere o loop sozinho. O Capitano não.** Você gera o Critico, fala com ele, elimina-o, repete — três vezes — e apenas no final notifica o Capitano com o veredito final.

## Variáveis de configuração (já no seu env)

```bash
MY_SESSION=$(tmux display-message -p '#S')          # ex. SCRITTORE-2
MY_NUMBER=$(echo "$MY_SESSION" | grep -o '[0-9]*$') # ex. 2
MY_ID=$(echo "$MY_SESSION" | tr '[:upper:]' '[:lower:]')
CRITICO_SESSION="CRITICO-S${MY_NUMBER}"             # ex. CRITICO-S2
```

A ligação `MY_NUMBER` garante um Critico por Scrittore — `SCRITTORE-2` usa sempre `CRITICO-S2`, nunca colide com `CRITICO-S1` do `SCRITTORE-1`.

## Sequência por rodada (repetir 3 vezes)

### Passo 1 — Gerar um Critico FRESCO

O Critico da rodada anterior deve já estar morto (eliminado no final da rodada anterior). Para a rodada 1 a sessão ainda não existe.

```bash
tmux kill-session -t "$CRITICO_SESSION" 2>/dev/null
bash /app/.launcher/start-agent.sh critico "$MY_NUMBER"
```

O launcher e a **unica** fronteira de provider. Le `jht.config.json`, escolhe
CLI/modelo/flags, prepara o workspace e falha fechado se a configuracao faltar
ou for invalida. Qualquer diretiva ou prompt que nomeie provider, modelo, CLI
ou caminho executavel e invalido para este passo (RULE-T19). Nunca leias
`active_provider` nem construas tu o comando de arranque.

### Passo 3 — Esperar o Critico arrancar

8 segundos é um limite inferior seguro para o TUI estar pronto. `sleep` é aceitável aqui (apenas boot):

```bash
sleep 8
```

### Passo 4 — Enviar PDF + JD via `jht-tmux-send`

O Critico é agora um agente ativo — use `jht-tmux-send`, não `send-keys` direto:

```bash
jht-tmux-send "$CRITICO_SESSION" "[@$MY_ID -> @critico] [REQ] Review cieca: PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf — JD: <JD-URL> — Local JD file: $JHT_AGENT_DIR/tmp/jd-<position-id>.txt — Read your CLAUDE.md/AGENTS.md and produce an honest verdict."
```

Forneça o caminho do ficheiro JD local para que o Critico tenha um fallback se o URL ao vivo estiver bloqueado.

### Passo 5 — Sondar o veredito (NUNCA `sleep` puro)

Use a skill `throttle` para que a espera seja registada no dashboard. `sleep` puro aqui tornaria a espera invisível para a análise de pacing do Capitano.

```bash
jht-throttle-check "$MY_ID" || jht-throttle-wait "$MY_ID"
jht-throttle --agent "$MY_ID" --reason "wait critico round <n> #<position_id>"
tmux capture-pane -t "$CRITICO_SESSION" -p -S -50
```

**OBRIGATÓRIO** — passe um `timeout: <duração>+30` explícito na chamada da ferramenta shell ao invocar `jht-throttle <N>`. Sem isso o bash pai morre no timeout padrão de 60s do CLI (Kimi) e o throttle é executado incorretamente. Veja `agents/_skills/throttle/DESIGN-NOTES.md`.

Repita o ciclo throttle+capture até o Critico ter publicado a sua revisão (procure o bloco estruturado `## SCORE: X.X/10` no painel / ficheiro).

### Passo 6 — Ler a revisão

O Critico guarda a revisão em `$JHT_USER_DIR/critiche/review-<company>-<date>.md` (skill dele, ver `agents/critico/critico.md`). Leia com `Read`. Extraia:
- Pontuação numérica `X.X/10`
- Pontos "What does NOT work"
- Lista "Concrete actions (prioritized)"

Estes três alimentam o Passo 8 (correção).

### Passo 7 — Persistir a pontuação da rodada no DB

```bash
python3 /app/shared/skills/db_update.py application <POSITION_ID> \
  --critic-score <X.X> --critic-round <N> --reviewed-by "$CRITICO_SESSION"
```

`<POSITION_ID>` é o ID da posição, NÃO o ID da application — o `db_update.py application` é um UPSERT que encontra a linha por posição.

`--reviewed-by "$CRITICO_SESSION"` rastreia qual instância do Critico produziu cada rodada; sem isso `applications.reviewed_by` fica NULL (observado 95% nulo pré-2026-05-22 — vps1-run-postmortem #1). Passe sempre.

### Passo 8 — Eliminar o Critico (obrigatório)

```bash
tmux kill-session -t "$CRITICO_SESSION"
```

Se reutilizar a mesma instância para a rodada 2, a pontuação carrega o viés de ancoragem da rodada 1 e o protocolo quebra. **Sempre eliminar, sempre gerar fresco.**

### Passo 9 — Corrigir o CV entre rodadas

Aplique as ações do Passo 6 ao markdown do CV. Regenere o PDF (`pandoc input.md -o output.pdf --pdf-engine=typst`). Valide que o PDF abre antes da rodada N+1.

Uma pontuação que cai entre as rodadas 1 e 2 é **normal** — um Critico fresco é mais honesto que o anterior. Continue a corrigir com base no *conteúdo* da revisão, não no número.

## Após a 3ª rodada — porta final

Duas escritas na linha de application: veredito + pontuação (sempre), e a
promoção de status para `ready` (apenas em PASS). A promoção é o que o
dashboard `/ready` do utilizador lê; pulá-la deixa a linha em `draft`
e o CV invisível (bug #21).

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
if [[ "<final_verdict>" == "PASS" ]]; then
  # PASS → application torna-se visível ao utilizador
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict PASS \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$CRITICO_SESSION" \
    --status ready
else
  # FAIL → dados do critico persistem, status fica 'draft'
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict FAIL \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$CRITICO_SESSION"
fi
```

Status da posição:
- `critic_score ≥ 5` → `db_update.py position <POSITION_ID> --status ready`
- `critic_score < 5` → `db_update.py position <POSITION_ID> --status excluded`

Depois notifique o Capitano:
```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [REPORT] Position #<id> — 3 rounds done. Final score: X.X/10 (PASS|FAIL). PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf"
```

## Regras rígidas

- **3 rodadas. Não 1, não 2.** Uma pontuação "boa" na rodada 1 não é razão para parar.
- **Um Critico por rodada.** Sempre eliminar após a revisão; sempre gerar fresco.
- **Correção obrigatória entre rodadas.** Se não alterar o CV, o próximo Critico vê a mesma entrada → mesma revisão → orçamento desperdiçado. Edite o markdown + regenere o PDF antes da rodada N+1.
- **Não ter medo de uma pontuação a cair.** Rodada 2 < Rodada 1 é honesto, não mau. A pontuação que importa é a da rodada 3.
- **Passe `timeout: N+30`** a cada chamada shell `jht-throttle <N>`. Caso contrário o bash pai morre aos 60s.

## Anti-padrões

- ❌ Reutilizar a mesma instância do Critico para múltiplas rodadas — viés de pontuação quebra o protocolo.
- ❌ Hardcodar `claude` no script de spawn — crasha o loop em instalações Codex/Kimi.
- ❌ `sleep N` puro enquanto sonda — invisível para o dashboard de throttle do Capitano, quebra a análise de pacing.
- ❌ Gravar `--critic-verdict` após apenas 1 ou 2 rodadas — a porta é final, sem rollback.
- ❌ Tratar o Capitano como o orquestrador — este loop é totalmente seu, o Capitano só vê o REPORT final.

## Ver também

- `cv-structure` — o que escrever antes de invocar este loop, e como aplicar as correções do Critico no Passo 9.
- `application-flow` — verificação anti-reescrita + reivindicação antes de começar a escrever para uma posição.
- `throttle` (e `agents/_skills/throttle/DESIGN-NOTES.md`) — internos do wrapper + o design `timeout: N+30`.
- `agents/critico/critico.md` — o prompt de revisão cega do Critico com o qual este loop fala.
