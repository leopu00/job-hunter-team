<!-- @translation: pt, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Como o CLOSER executa uma candidatura autorizada com `apply_flow.py` — a máquina de estados com checkpoints (detect, fill, upload_cv, screening, review, submit), o recibo obrigatório sem o qual `applied` nunca é escrito, e o que fazer em cada resultado, `blocked_human` antes de tudo. Usa-a para cada posição tomada da queue. Do CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# apply-flow — uma candidatura, um recibo, nenhuma repetição às cegas

```bash
python3 /app/shared/skills/apply_flow.py \
  --position-id "$PID" \
  --url "$URL" \
  --profile "$JHT_HOME/profile/candidate_profile.yml" \
  --cv "$CV"
```

`PID`, `URL` e `CV` vêm da última leitura de `apply_gate.py queue` (skill
`apply-authorization`), nunca da memória.

## A máquina de estados

```
detect → fill → upload_cv → screening → review → submit → applied
                                                        ↘ blocked_human
```

- Cada passo concluído é guardado num checkpoint (`$JHT_HOME/.cache/apply-flow/<id>.json`).
  Depois de um crash o fluxo retoma onde estava: o preenchimento repete-se, o clique não.
- `submit_started` é guardado **antes** do clique. Se um processo morrer depois dessa
  linha, o resultado é desconhecido, e um resultado desconhecido nunca é clicado
  outra vez: o fluxo procura uma confirmação na página e, sem ela, bloqueia com
  `submit_outcome_unknown`.
- A porta é verificada no arranque **e** mesmo antes do clique. Um flag revogado
  enquanto o formulário era preenchido para o envio.
- Hoje duas receitas completas: **Ashby** e **Greenhouse** (só os seus três hosts públicos, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`, em HTTPS; a página é verificada outra vez depois de cada passo). Qualquer outra plataforma bloqueia para uma pessoa.

## O recibo

`applied` só é escrito quando o fluxo tem **ambos**:

1. uma captura de ecrã da página de confirmação, e
2. um URL ou texto de confirmação.

Depois é o próprio fluxo que regista a candidatura com `applied_via = agent_closer`,
e relê a linha para verificar que a escrita aconteceu. Mais ninguém escreve esse
estado: nem tu, nem o Capitano.

## Ler o resultado

Uma linha JSON no stdout: `status`, `state`, `reason`, `receipt`.

| `status` | Exit | Significado | O que fazes |
|---|---|---|---|
| `applied` | 0 | enviada, recibo guardado, estado registado | posição seguinte |
| `dry_run` | 0 | `mode: dry_run`: preenchida, parada antes do botão, nada enviado | posição seguinte |
| `denied` | 1 | a porta recusou (consentimento desligado, flag revogado, já enviada) | posição seguinte; nunca repetir |
| `blocked_human` | 3 | é preciso uma pessoa; o utilizador já foi avisado | posição seguinte; nunca repetir |
| `email_channel` | 4 | o controlo de candidatura é um link `mailto:`, não um formulário; o checkpoint guarda `channel: email` e o `mailto_href` em bruto | executa `email_application.py send` para esta posição como diz a skill `email-application-flow`: ela lê este checkpoint; nunca preenchas um formulário web nem escrevas o email à mão |
| `error` | 2 | perfil ou CV ilegível, argumentos errados | para: `[BLOCKED]` ao Capitano |

## `blocked_human` — o que significa e o que fazes

O fluxo para em tudo o que não consegue fazer com certeza:

| `reason` (exemplos) | Causa típica |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | um campo obrigatório não tem resposta guardada — o utilizador foi questionado uma vez (primeiro no Telegram, também no dashboard); a resposta é guardada em `jobs.db` e o fluxo retoma a partir do checkpoint |
| `essential_facts_missing` / `essential_facts_unavailable` | antes do primeiro run de uma posição falta um dado que quase todos os formulários pedem (data de início, pré-aviso, autorização de trabalho, sponsorship, salário, mudança, telefone); cada um foi perguntado uma vez e nada fica retido: a posição volta a correr quando as respostas existirem |
| `captcha` / `two_factor` | o site quer verificar que há uma pessoa |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | um campo que a receita não sabe preencher com uma resposta guardada |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | o CV não se consegue anexar |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` | ainda não há receita para esta página, ou o formulário não é o que a receita conhece |
| `greenhouse_redirect_untrusted` | durante o fluxo a página do Greenhouse saiu dos seus três hosts de confiança |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | dois endereços mailto de candidatura diferentes, ou o formulário de candidatura, os seus campos ou o seu botão de envio não cabem num único formulário (newsletter, rodapé e formulários de demo nunca fazem parte) |
| `form_error` / `field_invalid` / `submit_unavailable` | o formulário assinala um erro, o formato de um campo é recusado, ou o botão de envio falta ou está desativado |
| `url_refused` / `checkpoint_invalid` | o URL da candidatura não passou o controlo de endereços públicos, ou o checkpoint guardado não se lê |
| `page_unavailable` / `browser_uncertainty` | a página ou o browser falharam a meio do fluxo |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | o envio foi clicado mas a confirmação não é certa |
| `receipt_screenshot_failed` | a confirmação estava visível mas a captura não pôde ser guardada |
| `submit_outcome_unknown` | uma passagem anterior iniciou o envio e não deixou recibo |
| `applied_record_failed` | o recibo existe mas o estado não pôde ser registado — a candidatura quase certamente saiu |

O que fazes, sempre igual:

1. **Nada nessa posição.** O fluxo já escreveu o checkpoint e avisou o
   utilizador com `jht-notify-user`. Não o avises outra vez.
2. **Não a repitas.** Nem agora, nem «mais uma vez daqui a uns minutos». A queue
   retém-na (`checkpoint_blocked_human`) até o utilizador a autorizar outra vez.
3. **Passa à posição seguinte** da queue.

Repetir uma posição bloqueada é a tentativa às cegas que este design existe para
impedir: num captcha queima a conta do utilizador, num resultado desconhecido
envia uma segunda carta ao mesmo recrutador.

## Verificar uma candidatura depois

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` e um `applied_at` não vazio = o fluxo registou-a.
