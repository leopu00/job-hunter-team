<!-- @translation: pt, ai-translated 2026-09-13 -->
---
name: email-application-flow
description: Como o CLOSER envia por email uma candidatura autorizada com `email_application.py` quando `apply_flow.py` responde `email_channel` (o controlo Apply é um link `mailto:`) — inspect, preflight, draft, send, status; o gate verificado de novo logo antes do transporte; `send_started` antes do comando irreversível; o recibo sem o qual `applied` nunca é escrito. Usa-a para cada posição cujo fluxo termina em `email_channel`. Do CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/email_application.py *)
---

# email-application-flow — um email, um recibo, nenhuma tentativa às cegas

Usa-a **só** para uma posição da última queue cujo `apply_flow.py` respondeu
`email_channel` (exit 4). O fluxo do browser deixou o `mailto_href` em bruto no seu
checkpoint; esta skill lê-o. Nunca abres um cliente de email, nunca escreves um
email à mão, nunca copias o endereço para outro lado.

```bash
python3 /app/shared/skills/email_application.py send --position-id "$PID" --json
```

`send` executa tudo por ordem e pára no primeiro problema. Os outros comandos
servem para ler, não para contornar uma paragem:

| Comando | O que faz |
|---|---|
| `inspect` | lê e interpreta o link mailto (To, CC, assunto, corpo) |
| `preflight` | inspect + gate + limite diário + transporte + CV + carta de apresentação + dados obrigatórios |
| `draft` | preflight + o rascunho determinístico; nada é enviado |
| `send` | draft + de novo o gate + `send_started` + transporte + recibo + `applied` |
| `status` | a última tentativa e o seu estado, só leitura |

`--dry-run` pára antes do transporte e não altera nada na candidatura.

## O que o comando garante

- **O flag é a autorização.** O gate decide no preflight e de novo logo antes do
  transporte. Um flag revogado ou um limite atingido entretanto significa que nada
  sai (`denied`).
- **Nada é inventado.** Os destinatários vêm só do link. Nome, email de contacto e
  qualquer dado que a vaga peça (disponibilidade, pretensão salarial) vêm só do
  perfil do candidato; se faltar um é `required_fact_missing`.
- **O CV é sempre anexado**, depois de verificar tamanho, PDF e hash. A carta de
  apresentação só é anexada se a vaga a pedir; se não existir, é pedida ao Scrittore
  pelo pedido de escrita normal e o fluxo pára.
- **No máximo uma carta.** `send_started` é registado antes de o servidor receber a
  mensagem. Depois disso, um timeout ou uma resposta pouco clara é
  `send_outcome_unknown`: nunca se repete, nem numa nova passagem.
- **`applied` só depois da aceitação**, com `applied_via = agent_closer_email`,
  escrito pelo próprio comando depois de guardar o recibo.

## Ler o resultado

Uma linha JSON: `state`, `reason`, `detail`, mais os dados.

| `state` | Exit | Significado | O que fazes |
|---|---|---|---|
| `sent` | 0 | aceite pelo servidor, recibo guardado, candidatura registada | posição seguinte |
| `draft_ready` | 0 | dry run: rascunho e anexos válidos, nada saiu | posição seguinte |
| `denied` | 1 | o gate recusou (`flag_revoked`, `gate_mode_changed`, `daily_cap_reached`, `duplicate_attempt`) | posição seguinte; nunca repetir |
| `blocked_human` | 1 | é precisa uma pessoa; a paragem está no resumo da volta | posição seguinte; nunca repetir |
| `send_outcome_unknown` | 3 | o email pode ter saído | posição seguinte; nunca repetir |
| `receipt_incomplete` | 3 | aceite, mas o recibo ou o registo está incompleto; com alguns destinatários recusados a carta provavelmente chegou | posição seguinte; nunca repetir |
| `error` | 2 | base de dados, perfil ou checkpoint ilegíveis | paragem: `[BLOCKED]` ao Capitano |

⚠️ Estes exit codes **não** são os de `apply_flow.py` (lá `denied` é 1 e
`blocked_human` é 3). Decide pelo `state`, nunca pelo número.

## Motivos de `blocked_human`

| `reason` | Causa típica |
|---|---|
| `transport_missing` | nenhum transporte de email configurado, ou o ficheiro do segredo falta ou não é 0600 |
| `auth_failed` | o servidor de email recusou as credenciais |
| `sender_unverified` | o endereço remetente não é a conta autenticada nem um remetente verificado |
| `mailto_missing` | nenhum checkpoint do browser em `email_channel` para esta posição: executa primeiro `apply_flow.py`; a página nunca é lida à procura de um endereço |
| `recipient_ambiguous` / `mailto_invalid` | zero ou vários destinatários, um cabeçalho proibido, CR/LF num cabeçalho; também local parts entre aspas e endereços internacionais (IDN), não suportados |
| `recipient_refused` | o servidor recusou os destinatários antes de sair alguma coisa: uma nova tentativa, depois de o utilizador agir, não é um duplicado |
| `required_fact_missing` | a vaga pede um dado que o perfil não indica |
| `cv_missing` | nenhum CV PDF legível para esta candidatura |
| `cover_letter_required` | a vaga pede uma carta de apresentação; foi pedida ao Scrittore |

O que fazes, sempre igual:

1. **Nada nessa posição.** O comando pôs a paragem no resumo da volta (`closer_notices.py flush` no STEP 6).
2. **Não a repitas.** A queue retém-na (`email_blocked_human`,
   `email_send_outcome_unknown`, ...) até o utilizador agir.
3. **Passa à posição seguinte** da queue.

## Nunca

- enviar um email de outra forma que não este comando;
- executar `send` numa posição que não está na última leitura da queue;
- repetir depois de `send_started`, `send_outcome_unknown` ou `receipt_incomplete`;
- escrever tu `applied`, `applied_via` ou `apply_requested`;
- colar a password SMTP, ou pedi-la ao utilizador no chat.

## Verificar depois

```bash
python3 /app/shared/skills/email_application.py status --position-id "$PID" --json
```

`state: sent` com um `message_id` = o comando registou o envio por email.
