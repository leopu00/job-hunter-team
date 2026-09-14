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
- Hoje três receitas completas: **Ashby**, **Greenhouse** (só os seus três hosts públicos, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`, em HTTPS; a página é verificada outra vez depois de cada passo) e **Lever** (só `jobs.lever.co` e `jobs.eu.lever.co`, em HTTPS, verificados da mesma forma). LinkedIn: «candidatar-se no site da empresa» continua nesse site com a sua receita; Easy Apply inicia sessão com a conta do utilizador (sessão guardada, código de verificação no Telegram) e preenche a janela. Qualquer outra plataforma bloqueia para uma pessoa.

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
| `blocked_human` respostas em falta (`essential_facts_missing` com `missing`, `required_answer_missing` com `pending_question`) | 3 | não é uma paragem e nada foi perguntado: faltam respostas ao fluxo | deduz cada uma do perfil, do CV e da vaga e guarda-a (`application_answers.py save … --basis …`), depois relança o fluxo; só sem nenhuma base `application_answers.py ask --position-id $PID --key K` (prompt do CLOSER, CL-08). Uma pergunta que fizeste retém a posição até o utilizador responder, no máximo um dia por pergunta |
| `email_channel` | 4 | o controlo de candidatura é um link `mailto:`, não um formulário; o checkpoint guarda `channel: email` e o `mailto_href` em bruto | executa `email_application.py send` para esta posição como diz a skill `email-application-flow`: ela lê este checkpoint; nunca preenchas um formulário web nem escrevas o email à mão |
| `error` | 2 | perfil ou CV ilegível, argumentos errados | para: `[BLOCKED]` ao Capitano |

## `blocked_human` — o que significa e o que fazes

O fluxo para em tudo o que não consegue fazer com certeza:

| `reason` (exemplos) | Causa típica |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | um campo obrigatório não tem resposta guardada; `pending_question` nomeia-o (chave, rótulo, tipo, opções, scope). Nada é enviado ao utilizador até correres `ask`; uma resposta guardada retoma o fluxo a partir do checkpoint |
| `essential_facts_missing` / `essential_facts_unavailable` | antes do primeiro run de uma posição falta um dado que quase todos os formulários pedem (data de início, pré-aviso, autorização de trabalho, sponsorship, salário, mudança, telefone); `missing` lista as chaves. Nada foi perguntado e nada fica retido |
| `captcha` / `two_factor` | o site quer verificar que há uma pessoa |
| `vacancy_closed` | a vaga já não está aberta: uma página sem formulário, botão Apply nem canal de email diz isso, ou o URL redirecionou para a lista de vagas, a página de carreiras ou a página inicial; nada foi preenchido nem enviado. Paragem definitiva: uma nova execução não reabre a página até o utilizador autorizar de novo a posição. Uma captura da página é guardada ao lado do checkpoint (`stop_screenshot`) |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | um campo que a receita não sabe preencher com uma resposta guardada |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | o CV não se consegue anexar |
| `cv_pdf_layout_bad` | o PDF do CV falhou o controlo visual (`pdf_layout_check.py`: texto espremido numa coluna estreita, uma página quase vazia, mais de 2 páginas, fontes não incorporadas, corpo de texto demasiado pequeno): nada foi anexado nem enviado. O Escritor tem de o gerar de novo; nunca o anexes à mão. A pré-visualização da página 1 fica guardada junto ao checkpoint: olha para ela |
| `cv_pdf_check_unavailable` | o PDF do CV não pôde ser medido (poppler ausente no contentor, ficheiro ilegível): nada foi anexado nem enviado — um CV não medido não é um pass. O remédio está no contentor, não no Escritor: sinaliza ao Capitano |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` / `lever_dom_unrecognised` / `lever_form_missing` / `lever_apply_ambiguous` / `lever_form_ambiguous` | ainda não há receita para esta página, ou o formulário não é o que a receita conhece |
| `greenhouse_redirect_untrusted` | durante o fluxo a página do Greenhouse saiu dos seus três hosts de confiança |
| `lever_redirect_untrusted` | durante o fluxo a página do Lever saiu de `jobs.lever.co` / `jobs.eu.lever.co` |
| `linkedin_dom_unrecognised` / `linkedin_form_missing` / `linkedin_form_ambiguous` / `linkedin_step_unrecognised` / `linkedin_apply_control_missing` / `linkedin_apply_ambiguous` / `linkedin_session_unavailable` / `linkedin_login_unrecognised` | a vaga do LinkedIn ou a sua janela Easy Apply não é a que a receita conhece |
| `linkedin_credentials_missing` | `$JHT_HOME/credentials/linkedin.json` (`email`, `password`) falta, não é um ficheiro regular 0600 deste utilizador ou está vazio: o utilizador cria-o com o script das credenciais. Nunca peças a palavra-passe num chat |
| `linkedin_login_failed` | o LinkedIn recusou o início de sessão duas vezes: nenhuma nova tentativa até o utilizador escrever credenciais novas |
| `linkedin_login_code_missing` / `linkedin_login_code_undelivered` | o código de verificação do LinkedIn foi pedido no Telegram e não chegou a tempo (ou o pedido não chegou ao Telegram): uma nova volta pede um código novo |
| `linkedin_challenge` | o LinkedIn mostra um captcha ou uma verificação de segurança: o utilizador resolve-a no ecrã ao vivo e volta a autorizar a posição |
| `linkedin_redirect_untrusted` / `application_redirect_untrusted` | a página do LinkedIn saiu de `www.linkedin.com`, ou o endereço da empresa que indica não é uma página HTTPS fora do LinkedIn (ou é uma segunda passagem) |
| `linkedin_follow_not_cleared` | não foi possível desmarcar a caixa «seguir a empresa» antes de Submit: nada é enviado |
| `linkedin_throttled` / `linkedin_login_retry` / `linkedin_interval_invalid` | **negado, não bloqueado**: as candidaturas no LinkedIn são espaçadas (`linkedin_min_interval_minutes`, por omissão 20), o início de sessão falhou uma vez e a próxima volta tenta mais uma vez, ou essa definição não é um número inteiro de minutos. A fila tenta de novo sozinha |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | dois endereços mailto de candidatura diferentes, ou o formulário de candidatura, os seus campos ou o seu botão de envio não cabem num único formulário (newsletter, rodapé e formulários de demo nunca fazem parte) |
| `form_error` / `field_invalid` / `submit_unavailable` | o formulário assinala um erro, o formato de um campo é recusado, ou o botão de envio falta ou está desativado |
| `url_refused` / `checkpoint_invalid` | o URL da candidatura não passou o controlo de endereços públicos, ou o checkpoint guardado não se lê |
| `page_unavailable` / `browser_uncertainty` | a página ou o browser falharam a meio do fluxo |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | o envio foi clicado mas a confirmação não é certa |
| `receipt_screenshot_failed` | a confirmação estava visível mas a captura não pôde ser guardada |
| `submit_outcome_unknown` | uma passagem anterior iniciou o envio e não deixou recibo |
| `applied_record_failed` | o recibo existe mas o estado não pôde ser registado — a candidatura quase certamente saiu |

O que fazes em qualquer outro motivo (as respostas em falta estão acima):

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
