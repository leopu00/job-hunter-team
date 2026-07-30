<!-- @translation: pt, ai-translated 2026-07-30 -->
---
name: agent-unblock
description: "Apenas para o Dottore. Fase UNBLOCK, corre ANTES do refresh em cada ronda do Dottore. Deteta as quatro formas de bloqueio que param uma equipa inteira — texto pendente no pane de um coordenador, um agente em retry-loop contra um par mudo, todos os operativos parados num prompt vazio com quota por gastar, um coordenador em silêncio para além do limiar — e RESOLVE-AS. Nunca envia nem apaga texto escrito pelo utilizador: contorna-o (pergunta ao Assistente, `prossegue entretanto` ao coordenador através da mailbox, arranque direto dos workers). Um bloqueio que sobreviva à ronda torna a ronda FALHADA, não completa."
allowed-tools: Bash(python3 /app/shared/skills/agent_unblock.py *), Bash(python3 /app/shared/skills/doctor_analytics.py *), Bash(tmux *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# agent-unblock — não reportas um bloqueio, dissolve-lo

> **O princípio, acima de tudo o resto nesta skill.** O Dottore **não reporta um
> bloqueio: dissolve-o.** Se uma ação exigir uma decisão humana, encaminha-a para o
> Assistente **e põe a equipa de novo em movimento entretanto**, levando a informação de
> que a decisão está pendente. **Um bloqueio que sobrevive à ronda do Dottore é uma ronda
> falhada.**

Uma equipa com quota de sobra (weekly 19%, abaixo do pace) e uma máquina ociosa
(load 0.12) esteve uma vez parada **onze horas**. Uma linha, escrita no pane do Capitano
e nunca submetida, tornou esse pane não recetivo; o `jht-tmux-send` leu-o como busy; o
coordenador ficou mudo; ninguém atribuiu trabalho; cada agente terminou o seu turno e
estacionou num prompt vazio. Um Scorer estava há horas em retry-loop ("décima tentativa,
busy"). O Dottore dessa noite inspecionou nove sessões em 416s, escreveu um diagnóstico
impecável no seu journal — e ficou em standby. A equipa ficou em baixo mais seis horas.

O diagnóstico nunca foi o problema. Esta skill é o mandato.

---

## Dois estados que parecem idênticos e precisam de curas opostas

Ambos mostram um prompt com algum texto lá dentro e nenhuma atividade.

| estado | sintoma | cura |
|---|---|---|
| **texto pendente** | um `Enter` sozinho é ignorado, mas `Space` **depois** `Enter` funciona | desbloquear através do input |
| **TUI congelada** | não aceita **nada**: nem `Enter`, nem `C-m`, nem um envio para o `%pane_id` | só kill + recriar |

**O detalhe que torna o desbloqueio implementável**: um `Enter` "a frio" não é processado
por uma TUI Ink (Codex, Kimi, Claude Code) — a submissão tem de chegar *depois* de o
texto ter sido renderizado. Por isso envias primeiro um caráter (`Space`) e só depois
`Enter`. Salta isto e uma implementação que tenta `Enter` sozinho **falha em silêncio** e
conclui que o pane é irrecuperável.

Com ele, uma única sonda separa os dois: **`Space`+`Enter`, uma vez**. O pane reage → era
texto pendente, desbloqueado. Nada se mexe → TUI congelada → recriar. (Um coordenador
congelado desta forma tinha um processo vivo a 2,8% de CPU e uma sessão de 15,3 horas;
`Enter`, `C-m` e um envio direto para o `%pane_id` não fizeram nada. Recriá-lo foi a
única saída — que é também a razão pela qual o TTL de 12h da sessão não é opcional: é a
única defesa sistemática contra este segundo estado.)

---

## 🚫 A única coisa que nunca podes fazer

**Nunca envies, e nunca apagues, texto escrito pelo utilizador.** Não podes saber se essa
linha está completa ou se é intencional. A sonda acima **submete o composer**, por isso
só é permitida **quando** o conteúdo do composer for atribuível a um agente — um envelope
`[@x -> @y] …` ou `[BRIDGE …]` / `[SENTINELLA …]` que já estava destinado a ser enviado.

O `agent_unblock.py probe` impõe-te isto: perante texto não atribuível recusa com
`verdict=refused`, exit 3, tendo primeiro copiado a linha para `logs/pending-input.jsonl`
para que não se possa perder mais tarde. **Não contornes a recusa.** Contorna antes o
bloqueio (§ input pendente do utilizador).

---

## Passo 0 — scan (determinístico, zero LLM, ~2s)

```bash
python3 /app/shared/skills/agent_unblock.py scan > /tmp/unblock_scan.json
cat /tmp/unblock_scan.json
```

Devolve `blocks_found` mais uma entrada por bloqueio, cada uma com a sua `cure`:

| `kind` | significado |
|---|---|
| `pending_user_input` | o composer de um coordenador contém texto em que não podes tocar |
| `pending_agent_input` | um envelope de agente preso num composer, nunca submetido |
| `bare_shell` | a CLI morreu, o pane caiu para uma shell |
| `retry_loop` | N tentativas de X para Y na janela, zero respostas de Y |
| `all_operatives_idle` | todos os operativos num prompt vazio |
| `mute_coordinator` | nenhuma mensagem do Capitano para além do limiar |

**Regista `blocks_found` agora.** Vais precisar dele no fim da ronda.

> Porque é que o `retry_loop` é de confiança: o `messages.jsonl` regista a *tentativa*
> (o `jht-tmux-send` regista antes de escrever), por isso um Scorer a martelar um
> Capitano mudo aparece mesmo que nunca nada tenha sido entregue. Este é também o sinal
> objetivo que separa **"estacionado porque não há trabalho"** de **"preso porque a
> coordenação está partida"**: *um agente que insiste com o Capitano sem resposta não
> está estacionado, está bloqueado.* Não lhe apliques a regra PARKED.

## Passo 1 — resolvê-los, um por tipo

### `pending_agent_input` · `bare_shell` — a sonda

```bash
python3 /app/shared/skills/agent_unblock.py probe <SESSION>   # exit 0 unblocked · 2 frozen · 3 refused · 4 busy
```
- `unblocked` → resolvido, conta-o.
- `frozen` → **não repitas a sonda.** Escala para a recriação: captura primeiro o pane
  (`session-refresh` Passo 2 — o pane é a memória do agente), depois
  `tmux kill-session` → `bash /app/.launcher/start-agent.sh <role> <SAME-N>` → `[RESUME]`.
- `busy` → o agente está vivo, a meio de um turno. Não é um bloqueio. Deixa-o.

### `pending_user_input` — contorna-o, nunca passes por ele

Três ações, todas obrigatórias, nenhuma delas toca na linha:

1. **Pergunta ao utilizador, através do Assistente** — o Assistente é o papel que fala com
   o utilizador. Envia-lhe a pergunta do coordenador para que a encaminhe pelo canal
   in-app:
   ```bash
   jht-tmux-send ASSISTENTE "[@dottore -> @assistente] [UNBLOCK] O CAPITANO tem uma pergunta pendente para o utilizador e o seu pane está parado numa linha escrita e nunca enviada: «<pergunta>». Encaminha-a pelo canal in-app e leva a resposta ao Capitano. A linha está guardada em logs/pending-input.jsonl — NÃO foi enviada nem apagada."
   ```
2. **Desbloqueia o coordenador na mesma** — diz-lhe que a pergunta foi encaminhada e que
   tem de prosseguir. Escrever nesse pane concatenaria com a linha do utilizador e
   submeter enviá-la-ia, por isso usa o canal que não precisa de pane nenhum: a mailbox
   que o Capitano esvazia no início de cada turno (`bridge-mailbox`).
   ```bash
   python3 /app/shared/skills/agent_unblock.py relay CAPITANO "[@dottore -> @capitano] [UNBLOCK] A tua pergunta ao utilizador foi encaminhada ao Assistente e está a ser tratada. NÃO fiques parado à espera dela: prossegue entretanto com o resto do trabalho e reatribui as filas. No teu composer está uma linha do utilizador por enviar: não lhe toco e não lhe toques até ser ele a decidir."
   ```
   O `relay` escreve em `bridge-mailbox.jsonl` **e** em `messages.jsonl`, por isso a
   mensagem é ao mesmo tempo entregável e auditável. Um coordenador nunca pode ficar à
   espera de uma resposta humana.
3. **Reinicia os workers sem esperar pelo coordenador** — ver abaixo. É isto que
   realmente recupera as onze horas.

### `retry_loop` — desbloqueia o destinatário, ou liberta o remetente

Resolve primeiro o alvo (sonda / recriação). Se o alvo não puder ser resolvido nesta
ronda, **o remetente não pode continuar à espera**: reatribui-o ou diz-lhe que prossiga.
```bash
jht-tmux-send SCORER-5 "[@dottore -> @scorer-5] [UNBLOCK] O CAPITANO está inacessível e o teu pedido foi encaminhado por outra via. PARA de tentar: pega na próxima da tua fila (db_query.py next-for-<ruolo>) e prossegue em autonomia."
```
Um retry-loop só conta como resolvido quando ao remetente foi dito que pare de tentar.

### `all_operatives_idle` · `mute_coordinator` — arrancar sem o coordenador

Quota disponível e toda a gente estacionada não é uma pausa, é uma paragem. **Arranca
diretamente os papéis operativos, não esperes pelo Capitano**, e escala o silêncio do
coordenador ao Assistente. Depois envia a cada operativo parado a sua própria fila:
```bash
jht-tmux-send SCOUT-1 "[@dottore -> @scout-1] [UNBLOCK] A coordenação está parada e há quota disponível. Recomeça do loop principal sem esperar pelo Capitano: CÍRCULO 1 do perfil, notifica os Analisti em lotes de 3-5."
jht-tmux-send ANALISTA-1 "[@dottore -> @analista-1] [UNBLOCK] Recomeça do loop principal sem esperar pelo Capitano: fila de db_query.py next-for-analista."
```
(Mesma forma para `scorer` / `scrittore` com a sua própria fila `next-for-*`.)

## Passo 2 — fechar a ronda honestamente

```bash
python3 /app/shared/skills/agent_unblock.py record-round \
  --round-id "$ROUND_ID" --found <blocks_found> --cleared <blocks_cleared>
```
Acrescenta a `/jht_home/logs/dottore-actions.jsonl` com `blocks_found`, `blocks_cleared`,
`blocks_open`, e escolhe o evento por ti: `round_complete` apenas quando
`cleared >= found`, caso contrário **`round_failed`** (exit 1). Não disfarces um
sobrevivente: uma ronda que deixa um bloqueio vivo é uma ronda falhada, e o log tem de o
dizer — o próximo Dottore lê esse log.

---

## Regras

- **Desbloqueia ANTES de fazer refresh.** Um refresh numa equipa paralisada limita-se a
  recriar a paralisia com uma janela de contexto limpa.
- **Uma sonda por pane, para sempre.** Duas sondas não te dizem mais do que uma, e a
  segunda é a forma como te convences a submeter a linha de um utilizador.
- **`busy` não é um bloqueio.** `esc to interrupt` significa vivo e a meio de um turno.
  Nunca envies teclas para dentro de um turno em curso, nunca faças spawn de um
  substituto para um agente ocupado.
- **PARKED não se aplica a um agente bloqueado.** "idade ≥ 40min E produced == 0 E
  nenhuma mensagem recente do Capitano" descreve uma equipa paralisada exatamente tão bem
  como uma deliberadamente estacionada. Se o agente aparece num `retry_loop`, ou se todos
  os operativos estão parados com quota por gastar, está bloqueado — age.
- **Nunca adivinhes a intenção do utilizador.** Nada de enviar, nada de apagar, nada de
  editar, nada de "só um espaço para o acordar" sobre texto do utilizador. A linha fica
  onde está; a cópia em `logs/pending-input.jsonl` é a rede de segurança.

## Anti-padrões

- ❌ Escrever o bloqueio no journal e seguir em frente. É essa a falha das onze horas.
- ❌ Tentar `Enter` sozinho, ver que nada acontece, e declarar o pane morto.
- ❌ Escrever a tua mensagem num composer que já contém a linha do utilizador — concatena,
  e a submissão envia o texto do utilizador.
- ❌ Recriar um coordenador só para limpar um pane *pendente* (não congelado). Sonda
  primeiro.
- ❌ Registar `round_complete` com `blocks_cleared < blocks_found`.

## Ver também

- `session-refresh` — a ronda de refresh que corre *depois* desta fase, mais o TTL de 12h da sessão.
- `tmux-send` — convenções de envelope e o que significam os exit codes (4 = busy = vivo).
- `liveness-check` — veredito a pedido sobre um único agente suspeito de estar morto.
