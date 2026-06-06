<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: chat-web
description: Responder ao utilizador quando envia mensagem pelo chat web do JHT. O utilizador chega até si com o prefixo `[@utente -> @capitano] [CHAT] <corpo>`; responda APENAS com `jht-send` — nunca escreva em `chat.jsonl` à mão (as aspas do shell quebram a linha JSON e o frontend silenciosamente descarta a mensagem, o utilizador não vê nada enquanto pensa que respondeu). Use esta skill em cada mensagem `[CHAT]`; NÃO a use para tráfego inter-agente (para isso use `tmux-send`).
allowed-tools: Bash(jht-send *)
---

# chat-web — protocolo utilizador ↔ Capitano

O utilizador **não** está numa sessão tmux. Escreve a partir da interface web. O frontend marca a mensagem e coloca-a no seu painel tmux. Para responder, escreve uma única linha JSON em `$JHT_AGENT_DIR/chat.jsonl`; o frontend monitoriza esse ficheiro e renderiza balões no painel de chat.

Não escreva o JSON. O wrapper `jht-send` fá-lo por si, com timestamp + flag `done` + validação pós-escrita. Use-o. Sempre.

## Como reconhecer um `[CHAT]` recebido

```
[@utente -> @capitano] [CHAT] <o que o utilizador escreveu>
```

- O envelope é idêntico às mensagens inter-agente (mesmo formato `[@from -> @to]`) mas o tipo `[CHAT]` e o autor `@utente` tornam-no inequívoco.
- O utilizador é **uma pessoa, o dono do perfil** — não um agente. Não existe nenhum `tmux send-keys` que possa usar para responder: a sessão deles não existe.
- Responda ao **corpo**, não ao envelope. O utilizador não escreveu o prefixo; o frontend adicionou-o.

> ⚠️ Modo de falha comum na primeira vez que vê isto: lê o prefixo e pensa "vou responder via `jht-tmux-send` ao utilizador". `jht-tmux-send UTENTE ...` retorna `exit 2` (sessão não existe). Não comece a depurar — lembre-se apenas que `[CHAT]` ⇒ `jht-send`. Sempre.

## Comandos de resposta

```bash
jht-send 'Resposta final que fecha o turno.'
jht-send --partial 'A trabalhar nisso…'   # checkpoint a meio do turno, mantém o turno aberto
```

Regras:
- **Um `[CHAT]` ⇒ pelo menos um `jht-send`. Sem exceções.** Não escrever nada deixa o utilizador a olhar para um chat aparentemente congelado.
- **A mensagem de fecho do turno NÃO tem `--partial`.** Se esquecer, o frontend mantém os pontos de digitação para sempre (até um timeout de fallback ~10 min depois).
- **Aspas**: passe o corpo como um único argumento posicional. Aspas simples preservam `$`, `"`, emoji, acentos literalmente. Para um corpo que contenha um `'` literal, use aspas duplas (`jht-send "não há problema"`) — mas dentro de `"..."` o shell vai expandir `$var`, por isso tenha cuidado.
- **Multi-linha**: bash `$'linha1\nlinha2'`, ou use `\n` dentro da string e deixe o Python preservar.

## Quando usar `--partial`

Use sempre que uma operação visível ao utilizador demorar mais de ~3 segundos e ainda não tiver a resposta. Sem `--partial` entre a mensagem do utilizador e a resposta final, o frontend esconde os pontos de digitação e o chat parece morto.

Padrão:
```
[CHAT] chega
   ↓
jht-send --partial 'A verificar — dê-me um momento…'
   ↓
(fazer o trabalho: db_query, capture-pane, análise, …)
   ↓
jht-send 'Aqui está o que encontrei: …'   ← sem --partial = fecha o turno
```

Se uma única operação ultrapassar ~30-45s sem sinal, envie outro checkpoint `--partial`. O utilizador nunca deve ficar em silêncio por mais tempo que isso.

## Exemplos (Capitano ↔ utilizador)

```bash
# Responder a uma pergunta sobre estado do pipeline — rápido, tiro único
jht-send 'Pipeline com 132 posições: 18 novas, 47 verificadas, 31 pontuadas, 28 prontas. Dois scrittori ativos.'

# Análise longa — checkpoint, depois fechar
jht-send --partial 'A puxar estatísticas e as últimas 50 revisões — um momento…'
# (executar db_query.py stats, db_query.py applications --critic-score-max 5)
jht-send $'Aqui está o panorama:\n\n• Pipeline saudável no lado da descoberta.\n• Scrittori presos em 4 posições com média de pontuação 3.2 → estou a pausá-los e a reabrir a triagem.'

# Fechar o turno após aplicar um pedido do utilizador
jht-send 'Feito. Gerado um Analista extra, config de throttle registada no log.'
```

## Anti-padrões (o que NÃO fazer)

- ❌ `echo '{"text":"...","ts":'$(date +%s.%N)'}' >> $JHT_AGENT_DIR/chat.jsonl` — explode com aspas/`$`/emoji, produz JSON inválido, frontend silenciosamente descarta a linha.
- ❌ `cat << 'EOF' >> chat.jsonl ... EOF` — desativa a interpolação de `$`, timestamp fica como string literal.
- ❌ `python3 -c "import json; ..."` ad-hoc — mesma fragilidade que o heredoc do shell.
- ❌ Responder via `jht-tmux-send UTENTE ...` — não existe sessão `UTENTE`. O utilizador vive no frontend web.
- ❌ Enviar uma resposta final com `--partial` — pontos de digitação ficam presos no ecrã do utilizador.
- ❌ Múltiplas chamadas `jht-send` (sem `--partial`) para o que deveria ser uma mensagem — cada chamada não-partial aparece como um balão separado.

## Enviar para um canal não-padrão (raro)

```bash
jht-send --agent capitano 'nota de nível sistema encaminhada pelo meu canal'
```

Útil quando quer registar uma mensagem de sistema no seu próprio canal de chat (ex. uma automação a notar que agiu em nome do utilizador). Para respostas do dia-a-dia nunca precisa desta flag.

## Porquê `jht-send` e não shell direto

Histórico (não repetir): agentes tentaram `echo`-em-jsonl e heredocs `cat <<EOF`. Ambos terminaram em modos frágeis — o primeiro explode com aspas/`$`, o segundo congela o timestamp como string literal. Resultado: JSON inválido que o frontend pula. O utilizador não vê nada; você pensa que respondeu. `jht-send` remove completamente o modo de falha — o corpo nunca reentra num parser de shell após o primeiro nível de aspas.

## Ver também

- `tmux-send` — para mensagens a **outros agentes** (protocolo diferente, canal diferente).
- `agents/assistente/assistente.md` — o Assistente tem a versão mais profunda deste protocolo (fluxo de onboarding multi-passo com checkpoints obrigatórios); leia apenas se alguma vez herdar responsabilidades do Assistente.
