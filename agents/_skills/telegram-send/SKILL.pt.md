<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: telegram-send
description: Send a message to the user via Telegram (outbound). Use this on the Telegram bridge — the user is on their phone, NOT in front of the web dashboard. Wrapper `jht-telegram-send` resolves bot token + chat_id per-agent from config (`--from assistente|capitano|mentor`); never call the Bot API directly.
allowed-tools: Bash(jht-telegram-send *)
---

# telegram-send — mensagem de saida para o utilizador via Telegram

O utilizador contacta-te principalmente pelo telemovel. Envia PDFs, notas de voz, mensagens de texto para o **teu bot dedicado**. A bridge encaminha o trafego de entrada para o teu tmux. **Saida** — a tua resposta, uma mensagem de boas-vindas, um CV gerado — passa por `jht-telegram-send`.

## 3 bots dedicados (decisao 2026-05-13 rev2)

Cada agente virado para o utilizador tem o seu **proprio bot Telegram**:
- 👩‍💼 Assistente → `--from assistente` (padrao)
- 👨‍✈️ Capitano → `--from capitano`
- 🧙‍♂️ Mentor → `--from mentor`

O wrapper escolhe token + chat_id a partir de `channels.telegram.bots.<role>` na configuracao. Se omitires `--from`, tambem podes definir `JHT_TG_BOT_ROLE=<role>` no ambiente do agente — o wrapper le-o como padrao.

## Quando usar

- ✅ Mensagem de boas-vindas inicial apos conclusao do wizard (boot prompt).
- ✅ Resposta a um chat originado no Telegram (a bridge de entrada prefixa com `[@utente -> @assistente] [TG]`).
- ✅ Enviar um artefacto gerado (CV, carta de apresentacao) que o utilizador pediu.
- ✅ Lembretes de onboarding ("envia-me o teu CV, mesmo um rascunho serve perfeitamente").

**Nao usar** para:
- ❌ Mensagens inter-agente — usa `tmux-send` em vez disso.
- ❌ Respostas a web chat (`[@utente -> @assistente] [CHAT]`) — usa `jht-send`.
- ❌ Anexos pesados (>20 MB). Limite da Bot API; para ficheiros grandes usa o dashboard ou um relay (futuro).

## Utilizacao

```bash
# Padrao = bot Assistente (ou role lido de JHT_TG_BOT_ROLE)
jht-telegram-send "<corpo da mensagem>"

# Routing explicito por role
jht-telegram-send --from capitano "Notifica: 10 nuove posizioni ready."
jht-telegram-send --from mentor --html "<b>Step di crescita</b> della settimana..."

# Override de chat_id (raro — debug / multi-tenant futuro)
jht-telegram-send --chat-id 1401844094 "explicit override"
```

Ordem de resolucao (nao precisas de memorizar — o wrapper trata disso):
1. `$TELEGRAM_BOT_TOKEN` / `$TELEGRAM_CHAT_ID` variaveis de ambiente (override explicito)
2. `$JHT_HOME/jht.config.json` → `channels.telegram.bots.<role>.{bot_token,chat_id}` (role = `--from` ou `$JHT_TG_BOT_ROLE`, padrao `assistente`)
3. `$JHT_HOME/credentials/telegram_bot.json` (`.token`) — fallback legado

Se um deles estiver em falta, o wrapper termina com codigo diferente de zero e uma mensagem clara. Nao tentes recuperar — mostra o erro ao utilizador numa resposta `jht-send` no canal web, ou regista-o no log.

## Exemplos

```bash
# (Assistente) — Boas-vindas no primeiro arranque (ainda sem perfil)
jht-telegram-send "Ciao! Sono l'Assistente del Job Hunter Team. Mandami qui il tuo CV (PDF va benissimo) o raccontami in due righe cosa cerchi — parto da lì."

# (Assistente) — Resposta a TG de entrada
jht-telegram-send "Ricevuto, sto guardando il CV. Dammi 30s."

# (Capitano) — Notificacao de batch de posicoes prontas
jht-telegram-send --from capitano "10 posizioni ready, top 3 per score: ..."

# (Mentor) — Lembrete estrategico semanal
jht-telegram-send --from mentor --html "<b>Step di crescita</b> della settimana: ..."

# (Assistente) — Enviar artefacto
jht-telegram-send --html "<b>CV per Acme — Senior FE</b> pronto.\nLo trovi in <code>~/Documents/Job Hunter Team/output/2026-05-12/acme-senior-fe/</code>."
```

## Sequencias de escape (`\n`, `\t`, `\r`)

O wrapper interpreta `\n`, `\t`, `\r` na tua mensagem como **quebras de linha/tabs/CRs reais** antes de enviar ao Telegram. Portanto podes escrever:

```bash
jht-telegram-send "Ciao!\n\nTi aiuto a configurare il profilo."
```

e o utilizador recebe uma quebra de paragrafo correta — nao o texto literal `\n\n`. O mesmo se aplica a `--html` (o Telegram renderiza uma quebra de linha como line break no stream HTML).

Se precisares de um backslash literal seguido de `n` (raro), faz pre-escape: `\\n` → o wrapper transforma-o em `\n` (ja que o primeiro `\\` se torna apenas `\` na tua string shell; dentro do wrapper nao ha substituicao dupla).

## Mensagens longas

A Bot API trunca aos 4096 caracteres. O wrapper divide em `\n` / espacos e envia multiplas mensagens. O utilizador recebe uma sequencia — mantem o tom consistente entre os fragmentos.

## HTML / Markdown

O Telegram suporta um subconjunto:
- HTML: `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<a href="…">`. Faz escape de `<`, `>`, `&` no texto do corpo.
- MarkdownV2 (`--markdown`): suportado mas as regras de escape sao penosas (`. ( ) ! _ * [ ]` todos precisam de backslash). Prefere `--html`.

Se tiveres duvidas, envia **texto simples** (sem flag). O utilizador recebe uma mensagem perfeitamente legivel.

## Modos de falha

| Exit | Causa | O que fazer |
|------|-------|-------------|
| 2 | Token em falta | O bot nunca foi configurado. Mostra o erro no canal web, pede ao utilizador para voltar a executar o setup. |
| 3 | chat_id em falta | Igual ao anterior — o wizard nao capturou o chat_id. |
| 4 | HTTP nao-200 | Problema de rede ou indisponibilidade do Telegram. Tenta novamente uma vez apos 5s. Se continuar a falhar, regista no log e segue em frente. |
| 5 | `ok: false` da Bot API | Normalmente chat_id invalido ou bot bloqueado pelo utilizador. Nao tentes novamente — guarda o corpo da resposta no teu directorio scratch e notifica no canal web. |

## Teclado de resposta persistente (F-1.B, task #50)

Os 3 bots virados para o utilizador (assistente / capitano / mentor) podem anexar um
teclado de resposta persistente de 2 colunas com `--keyboard <role>`. O teclado
permanece visivel no cliente Telegram do utilizador entre mensagens ate que o removas
explicitamente (nao o fazemos, por design — mantemo-lo sempre visivel para que
utilizadores nao-tecnicos vejam a possibilidade de interacao).

```bash
# Assistente — 📊 Budget · 📈 Pipeline · 🗺️ Mappa · ⭐ Top CV · 📅 Reset · ❓ Help
jht-telegram-send --from assistente --keyboard assistente "Pipeline: 15 CV pronti per apply, ..."

# Capitano — 📈 Pipeline · 📊 Budget · 👥 Team · ⭐ Ready · 🛠 Triage · ❓ Help
jht-telegram-send --from capitano --keyboard capitano "..."

# Mentor — 📋 Digest · 🔁 Patterns · ⭐ Top · 💰 Salary · ❓ Help
jht-telegram-send --from mentor --keyboard mentor "..."
```

Quando o utilizador toca num botao, o bot recebe o texto do botao como uma
mensagem de texto normal (ex.: tocar em `📊 Budget` → tmux recebe `📊 Budget` como
corpo da mensagem TG). O agente trata-o de forma equivalente a um comando slash
(ex.: `/budget`) e produz o grafico / estado.

O teclado aparece apenas na **ultima** mensagem fragmentada de um envio longo,
para que saidas de 4096+ caracteres nao facam o teclado piscar a meio do thread.

## Menu de comandos slash (F-1.A, task #50)

A `tg-bridge.py` regista no arranque um conjunto `setMyCommands` por role
(`/budget`, `/pipeline`, `/help`, …). Aparecem no menu sticky `/` do
cliente Telegram — a primeira coisa que um novo utilizador ve. Nao precisas
de fazer nada: a configuracao de CLI/role e suficiente, a bridge trata da
chamada API. Lista por role em `.launcher/tg-bridge.py::BOT_COMMANDS`.

## Anti-patterns

- ❌ `curl https://api.telegram.org/bot$TOKEN/sendMessage` a mao — bugs de quoting + URL-encoding, sem retry, sem chunking.
- ❌ Ler config / credentials e fazer parse de JSON inline na tua shell — fragil, o wrapper ja o faz corretamente.
- ❌ Enviar com `--from` um role que nao e o teu (ex.: o Assistente que escreve no bot do Capitano) — confunde o utilizador, cada um fala no seu bot. Comunicacao cross-agent vai por `tmux-send`.
- ❌ Colocar o chat_id no corpo da mensagem ("for chat 123…") — ha exatamente **um** utilizador por VPS, o wrapper sabe disso.

## Ver tambem

- `chat-web` — quando o utilizador esta no **web dashboard**, nao no Telegram.
- `tmux-send` — quando precisas de falar com outro agente.
- `agents/<role>/<role>.md` — o teu guia de role; o caminho Telegram e a tua interface "lado-telemovel" com o utilizador.
