<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: user-reply-check
description: Le as respostas do usuario que chegaram pelo dashboard web (canal de fallback quando o Telegram estava fora/nao configurado). Execute no inicio de cada iteracao do loop. A ferramenta retorna as respostas nao vistas para o SEU agente e as marca como vistas para que voce nao as processe duas vezes. Esta e a metade "marker prompt-injection" do padrao notify-user (decisao 2026-05-13).
allowed-tools: Bash(jht-check-user-replies *)
---

# user-reply-check — recolhe as respostas do usuario enviadas pelo dashboard web

O usuario pode responder as suas mensagens `notify-user` de dois lugares:

1. **Telegram** — ele responde pelo telefone; o `tg-bridge` injeta a mensagem no seu tmux como `[@utente -> @<agente>] [TG] <body>`. Voce ve inline. **Nada a fazer aqui.**
2. **Dashboard web** — quando `delivered_via='web'` (Telegram estava fora/nao configurado), o usuario digita a resposta no cartao do dashboard. O texto vai para `pending_user_messages.user_reply`. O Telegram NAO o ve. **E aqui que esta skill entra em acao.**

Sem `user-reply-check`, as respostas do dashboard ficariam silenciosamente no BD para sempre.

## Quando usar

- ✅ No inicio de cada iteracao do loop (Capitano: uma vez por tick; Mentor: uma vez por despertar de sessao; Assistente: entre ciclos de input do usuario).
- ✅ Logo apos executar `notify-user` se voce fez uma `kind=question` — e provavel que o usuario ja tenha respondido se passou algum tempo.
- ✅ Quando o usuario menciona "ti ho risposto sulla dashboard" mas voce nao viu nada via Telegram.

## Quando NAO usar

- ❌ Para mensagens de entrada do Telegram — o `tg-bridge` trata delas; voce ve `[TG] …` diretamente.
- ❌ Como loop de polling sem trabalho entre chamadas — e uma verificacao, nao um watcher. Cada chamada e uma consulta BD leve, mas voce desperdicaria tokens lendo "sem respostas" 100 vezes.

## Uso

```bash
# Chamada padrao no inicio do loop (marca todas as respostas retornadas como vistas)
jht-check-user-replies --agent <your_agent_id>

# Sem consumir (debug / antes de ter certeza de que quer fazer o ack)
jht-check-user-replies --agent <your_agent_id> --peek

# Saida estruturada para alimentar o seu raciocinio
jht-check-user-replies --agent <your_agent_id> --json
```

`<your_agent_id>` deve corresponder ao `--agent` que voce usou em `jht-notify-user`. Cada agente tem a sua propria fila — respostas para o Capitano nunca aparecem para o Mentor.

## Saida

Saida vazia = nada novo para voce. Trate como um no-op silencioso e continue o seu loop.

Saida nao vazia (formato legivel):

```
[USER REPLY via WEB — id=42] Usa la versione breve del CV, grazie.
    ↳ in risposta a: "Per la candidatura gia' richiesta per Acme Senior FE, quale versione del CV preferisci?"
    ↳ kind=question created=2026-05-13 12:00:00 reply_at=2026-05-13 14:30:00
```

Formato JSON (`--json`):

```json
[
  {
    "id": 42,
    "agent": "capitano",
    "body": "Per la candidatura gia' richiesta per Acme Senior FE, quale versione del CV preferisci?",
    "kind": "question",
    "related_position_id": 17,
    "user_reply": "Usa la versione breve del CV, grazie.",
    "user_reply_at": "2026-05-13 14:30:00",
    "created_at": "2026-05-13 12:00:00"
  }
]
```

## Como responder

O usuario abriu a conversa no **dashboard web**, nao no Telegram. Ele espera que a sua resposta apareca la tambem. Portanto:

1. Chame `jht-notify-user --agent <your_id> --no-telegram "<reply>"`. O flag `--no-telegram` e importante — forca `delivered_via='web'` para que a resposta va para o mesmo canal que o usuario esta a ler.
2. Opcionalmente inclua `--position-id <N>` quando a mensagem original tinha um (mesma posicao, mesmo contexto).
3. **NAO** envie a resposta tambem via `jht-telegram-send`. O usuario receberia uma notificacao no telefone sobre uma conversa que esta a ter no navegador — confuso e ruidoso.
4. **NAO** envie a resposta tambem via `jht-send`. Desde que a via do chat esta unificada, o que escreves aqui JA E uma bolha no chat do jogo e no thread web — a box espelha `pending_user_messages` para `<agente>/chat.jsonl`. Envia-la duas vezes significa que o utilizador le a mesma resposta duas vezes, e a jusante ninguem remove a segunda copia: a via nao distingue um duplicado de dois turnos que coincidem por acaso. Uma mensagem, uma so ferramenta.

Se a resposta e um simples acuse de recebimento ("ok, ricevuto"), pode ate saltar a nova mensagem: `acknowledged_at` ja foi definido quando o usuario digitou a resposta, portanto o usuario sabe que voce a recebeu assim que marca `agent_seen_reply_at` (esta skill faz isso automaticamente).

## Idempotencia

Cada chamada sem `--peek` atualiza `agent_seen_reply_at = CURRENT_TIMESTAMP` para cada linha retornada. A proxima chamada nao retorna nada (ate que uma nova resposta chegue). Se voce crashar entre ler a saida e agir sobre ela, a resposta ESTA marcada como vista — nao ha reentrega automatica. Use `--peek` para execucoes diagnosticas onde nao quer consumir.

## Latencia

A resposta demora:
- **Modo local**: ~0 (o dashboard escreve no SQLite diretamente via `/api/pending-messages/[id]/reply`).
- **Modo cloud (VPS)**: ate `--interval` segundos do daemon cloud-sync. Padrao 30s. Nao espere tempos sub-segundo no VPS.

Se o usuario reclamar "respondi ha 10 segundos e voce nao confirmou," verifique `jht cloud status` — ele provavelmente esta no VPS a espera do pull.

## Anti-padroes

- ❌ Polling num loop apertado (`while true; jht-check-user-replies; sleep 1`). Use a cadencia natural do seu loop de agente existente.
- ❌ Chamar com o valor `--agent` errado (ex. o Capitano chamando `--agent mentor`). Consumiria as respostas de outro e o proprietario legitimo perderia-as.
- ❌ Ignorar a saida. Se uma resposta chega, reaja — no minimo envie `notify-user --no-telegram "Ricevuto, sto elaborando."` para que o usuario saiba que a mensagem chegou.

## Ver tambem

- `notify-user` — a outra metade do par. Escreve a mensagem em `pending_user_messages`; esta skill le a resposta.
- `agents/_manual/db-schema.md` § `pending_user_messages` — schema, indices, ciclo de vida de uma linha.
