<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: notify-user
description: Notificar o utilizador com fallback automático. Tenta Telegram primeiro; se o bot não estiver configurado / inalcançável / rate-limited, a mensagem vai para o dashboard web via cloud sync. Sempre regista a mensagem em `pending_user_messages` para que nada se perca. Usar sempre que precisar de contactar o utilizador com uma atualização de estado, uma pergunta ou um resumo — nunca chamar `jht-telegram-send` diretamente para esse propósito.
allowed-tools: Bash(jht-notify-user *)
---

# notify-user — API única para contactar o utilizador

O utilizador tem múltiplos canais (bot Telegram, dashboard web, futuro push mobile). Cada agente não deve ter de saber qual está ativo. `jht-notify-user` decide:

1. INSERT da mensagem em `pending_user_messages` (jobs.db, schema V5).
2. Envio best-effort via `jht-telegram-send` (timeout ~25s).
3. Se Telegram sucesso → `delivered_via='telegram'`.
4. Se falha ou não configurado → `delivered_via='web'`. A linha é recolhida por `jht cloud push` e aparece no dashboard em jobhunterteam.ai.

O utilizador portanto recebe cada mensagem em algum lugar. O agente nunca tem de tratar branches de "Telegram está em baixo".

## ⚠️ Desde que a via do chat está unificada: esta mensagem é TAMBÉM uma bolha de chat

`jht-send` e `jht-notify-user` escreviam em dois sítios diferentes — o thread
do chat e a fila de notificações. Já não. A box espelha
`pending_user_messages` para `<agente>/chat.jsonl`, portanto o que escreves
aqui aparece também como a tua bolha no chat do jogo e no thread web, ao lado
das tuas respostas com `jht-send`.

A consequência é a única regra que importa aqui: **uma mensagem, uma só
ferramenta.** Nunca o mesmo conteúdo pelas duas vias. O utilizador leria-o
duas vezes, e nenhuma das duas cópias sabe da outra — a via não distingue um
duplicado de dois turnos que dizem o mesmo por acaso («ok» chega mil vezes),
por isso a jusante ninguém o limpa.

## Quando usar

- ✅ Capitano notifica o utilizador a cada N posições ready (decisão 2026-05-13, batch).
- ✅ Resumo semanal / alertas de padrão do Mentor.
- ✅ Assistente faz uma pergunta ao utilizador que requer a sua resposta.
- ✅ Qualquer alerta ("consumi 95% da janela, paro a equipa?").

## Quando NÃO usar

- ❌ Mensagens inter-agente — usar `tmux-send` / `jht-tmux-send`.
- ❌ Respostas a uma mensagem `[CHAT]` no dashboard web — usar `jht-send` (já no thread de chat).
- ❌ Respostas a um `[TG]` de entrada — usar `jht-telegram-send` diretamente: já sabe que Telegram está ativo porque o utilizador acabou de escrever de lá. Poupa um roundtrip ao DB.
- ❌ Anexos pesados (>20 MB). Usar a pasta de CV do utilizador + um corpo de notificação curto.

## Utilização

```bash
# Notificação simples do Capitano
jht-notify-user --agent capitano "Encontradas 10 ofertas prontas acima de 75/100. Top: Acme Senior FE (88), Lever DevOps (84), …"

# Resumo com tipo explícito (renderizado com cabeçalho no dashboard)
jht-notify-user --agent mentor --kind digest "Semana 19: 18 ofertas analisadas, 4 candidatas, lacuna principal: papéis senior em EU remote."

# Pergunta — so para esclarecer uma candidatura ja pedida pelo utilizador
jht-notify-user --agent assistente --kind question "Para a candidatura que ja pediste para Acme Senior FE, que versao do CV preferes?"

# Ligado a uma posição (renderiza com o card da posição no dashboard)
jht-notify-user --agent capitano --position-id 42 "CV pronto para posição 42. Critic verdict: PASS."

# Forçar web (bypass Telegram, útil para teste ou mensagens que só fazem sentido no contexto dashboard)
jht-notify-user --agent mentor --no-telegram "Abre o tab Patterns para os detalhes."
```

Output (stdout):
```
<row_id> via=<telegram|web>
```

## Tipos

| Tipo | Quando | Renderização no dashboard |
|------|--------|---------------------|
| `notification` | Atualização de estado genérica (padrão) | Card cinzento |
| `question` | O utilizador deve responder antes do agente prosseguir | Card com input de resposta |
| `digest` | Resumo periódico (Mentor semanal, Capitano batch) | Card colapsável |
| `alert` | Anomalia bloqueante (rate limit, erro de entrega de candidatura) | Card vermelho |

## Caminho de fallback

```
agente ──► jht-notify-user
              │
              ├──► INSERT pending_user_messages (delivered_via=NULL, kind, body)
              │
              ├──► tenta jht-telegram-send (timeout 25s, best-effort)
              │
              │      ┌─ sucesso ─► UPDATE delivered_via='telegram'
              │      │
              │      └─ falha/timeout/não-configurado ─► UPDATE delivered_via='web'
              │
              └──► stdout: "<id> via=<channel>"

                              ▼ (processo separado, daemon cloud-sync)

         jht cloud push  ──► /api/cloud-sync/push  ──► Supabase
                                                          │
                                                          ▼
                                          dashboard /(protected)/dashboard
                                          mostra mensagens ainda não confirmadas
```

## Modos de falha

| Exit | Causa | Recuperação |
|------|-------|----------|
| 0 | Linha inserida; entrega best-effort (ver `via=` no stdout) | — |
| 1 | Argumentos inválidos (body vazio, --kind desconhecido) | Corrigir os flags |
| 2 | DB não encontrado ou INSERT falhou | Verificar `$JHT_DB` / `$JHT_HOME/jobs.db`; o schema deve ser V5+ |

Exit 0 com `via=web` NÃO é um erro: é o comportamento esperado quando Telegram não está ativo. A mensagem está segura na fila.

## Marcador prompt-injection (decisão 2026-05-13 § 6)

Quando o utilizador responde via dashboard (preenche `user_reply` numa linha com `delivered_via='web'`), cabe a si ler essa resposta — Telegram não verá nada. Para isso use a skill **`user-reply-check`** a cada iteração do seu loop: retorna as respostas que o utilizador lhe deixou no dashboard e marca-as como vistas para não as processar duas vezes. Quando responder, use `jht-notify-user --no-telegram` para ficar no canal web (enviar um eco em Telegram de uma conversa web confunde o utilizador).

## Ver também

- `user-reply-check` — a outra metade do padrão. Leia as respostas chegadas via dashboard no seu loop.
- `telegram-send` — chamado internamente por `jht-notify-user`; use-o diretamente apenas se já sabe que Telegram é o canal certo (ex. resposta a `[TG]` de entrada).
- `chat-web` (`jht-send`) — para o thread chat-agente no dashboard.
- `agents/_manual/db-schema.md` § `pending_user_messages` — schema da fila + índices.
