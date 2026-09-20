<!-- @translation: pt, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Como o CLOSER executa uma candidatura autorizada com `apply_flow.py` — a máquina de estados com checkpoints (detect, fill, upload_cv, screening, review, submit), o recibo obrigatório sem o qual `applied` nunca é escrito, e o que fazer em cada resultado, `blocked_human` antes de tudo. Usa-a para cada posição tomada da queue. Do CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/closer_notices.py *)
---

# apply-flow — uma candidatura, um recibo, nenhuma repetição às cegas

```bash
python3 /app/shared/skills/apply_flow.py \
  --position-id "$PID" \
  --url "$URL" \
  --profile "$JHT_HOME/profile/candidate_profile.yml" \
  --cv "$CV"
```

Dá a este comando um tempo limite de pelo menos **10 minutos**: um início de sessão no LinkedIn pode esperar no navegador até 5 minutos pelo código de verificação que o utilizador envia no Telegram, e um comando morto enquanto espera deixa expirar o pedido do código.

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
| `retry_later` | 5 | a página da vaga não responde por agora (5xx, tempo esgotado); não é uma paragem, ninguém é avisado; o checkpoint tem `retry_after` | posição seguinte; a fila devolve-a sozinha depois de `retry_after` — nunca a relançar antes |
| `blocked_human` | 3 | é precisa uma pessoa; a paragem está no resumo da volta | posição seguinte; nunca repetir |
| `blocked_human` respostas em falta (`essential_facts_missing` com `missing`, `required_answer_missing` com `pending_question`) | 3 | não é uma paragem e nada foi perguntado: faltam respostas ao fluxo | deduz cada uma do perfil, do CV e da vaga e guarda-a (`application_answers.py save … --basis …`), depois relança o fluxo; só sem nenhuma base `application_answers.py ask --position-id $PID --key K` (prompt do CLOSER, CL-08). Uma pergunta que fizeste retém a posição até o utilizador responder, no máximo um dia por pergunta |
| `email_channel` | 4 | o controlo de candidatura é um link `mailto:`, não um formulário; o checkpoint guarda `channel: email` e o `mailto_href` em bruto (motivo `mailto_application`); ou, sem formulário de candidatura na página, motivo `email_instruction`: o próprio texto da página indica o único endereço («Send your CV to careers@…») | executa `email_application.py send` para esta posição como diz a skill `email-application-flow`: ela lê este checkpoint; nunca preenchas um formulário web nem escrevas o email à mão |
| `error` | 2 | perfil ou CV ilegível, argumentos errados | para: `[BLOCKED]` ao Capitano |

## `blocked_human` — o que significa e o que fazes

O fluxo para em tudo o que não consegue fazer com certeza:

| `reason` (exemplos) | Causa típica |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | um campo obrigatório não tem resposta guardada; `pending_question` nomeia-o (chave, rótulo, tipo, opções, scope). Nada é enviado ao utilizador até correres `ask`; uma resposta guardada retoma o fluxo a partir do checkpoint Uma `pending_question` com `purpose: contact_form_application` é a Mensagem de um formulário de contacto da empresa para onde o Apply da vaga levou (o fluxo define o assunto na opção de candidatura, sem campo de CV): escreve uma carta curta para esta vaga que diga que o CV está disponível a pedido. |
| `essential_facts_missing` / `essential_facts_unavailable` | antes do primeiro run de uma posição falta um dado que quase todos os formulários pedem (data de início, pré-aviso, autorização de trabalho, sponsorship, salário, mudança, telefone); `missing` lista as chaves. Nada foi perguntado e nada fica retido |
| `required_answer_missing` com a chave `location search` | um campo de localização só aceita uma das suas próprias sugestões, e a location do perfil não é um lugar a procurar ("remote", "worldwide") ou não encontrou nada próximo. Guarda onde vive o candidato como `Cidade, País` a partir do perfil ou do CV (`--basis profile` ou `cv`); o fluxo escreve-a e escolhe a sugestão correspondente, ou dá-te as sugestões próximas como opções. Nunca a preferência de trabalho, nunca ao acaso |
| `captcha` / `two_factor` | o site quer verificar que há uma pessoa |
| `vacancy_closed` | a vaga já não está aberta: uma página sem formulário, botão Apply nem canal de email diz isso, ou o URL redirecionou para a lista de vagas, a página de carreiras ou a página inicial; nada foi preenchido nem enviado. Paragem definitiva: uma nova execução não reabre a página até o utilizador autorizar de novo a posição. Uma captura da página é guardada ao lado do checkpoint (`stop_screenshot`) |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | um campo que a receita não sabe preencher com uma resposta guardada |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | o CV não se consegue anexar |
| `upload_widget_unavailable` | o widget de envio do Greenhouse não arrancou (erro de script em Resume/CV, duas tentativas): o ficheiro não foi recusado; uma volta seguinte tenta de novo |
| `greenhouse_verification_failed` | o Greenhouse enviou um código de verificação depois de Submit e não foi possível usá-lo (nenhum email ou resposta no Telegram a tempo, ou código recusado): a candidatura não saiu e nunca é reenviada sozinha |
| `greenhouse_verification_lost` | o ecrã do código de um envio já iniciado desapareceu (browser novo, sessão perdida): nunca dois envios na mesma execução; após nova autorização do utilizador, só um envio que registou o ecrã do código ao vê-lo, sem código escrito, recomeça uma vez, num browser novo |
| `cv_pdf_layout_bad` | o PDF do CV falhou o controlo visual (`pdf_layout_check.py`: texto espremido numa coluna estreita, uma página quase vazia, mais de 2 páginas, fontes não incorporadas, corpo de texto demasiado pequeno): nada foi anexado nem enviado. O Escritor tem de o gerar de novo; nunca o anexes à mão. A pré-visualização da página 1 fica guardada junto ao checkpoint: olha para ela |
| `cv_pdf_check_unavailable` | o PDF do CV não pôde ser medido (poppler ausente no contentor, ficheiro ilegível): nada foi anexado nem enviado — um CV não medido não é um pass. O remédio está no contentor, não no Escritor: sinaliza ao Capitano |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` / `lever_dom_unrecognised` / `lever_form_missing` / `lever_apply_ambiguous` / `lever_form_ambiguous` / `generic_dom_unrecognised` | ainda não há receita para esta página, ou o formulário não é o que a receita conhece |
| `greenhouse_redirect_untrusted` | durante o fluxo a página do Greenhouse saiu dos seus três hosts de confiança |
| `lever_redirect_untrusted` | durante o fluxo a página do Lever saiu de `jobs.lever.co` / `jobs.eu.lever.co` |
| `linkedin_dom_unrecognised` / `linkedin_form_missing` / `linkedin_form_ambiguous` / `linkedin_step_unrecognised` / `linkedin_apply_control_missing` / `linkedin_apply_ambiguous` / `linkedin_session_unavailable` / `linkedin_login_unrecognised` | a vaga do LinkedIn ou a sua janela Easy Apply não é a que a receita conhece |
| `linkedin_credentials_missing` | `$JHT_HOME/credentials/linkedin.json` (`email`, `password`) falta, não é um ficheiro regular 0600 deste utilizador ou está vazio: o utilizador cria-o com o script das credenciais. Nunca peças a palavra-passe num chat |
| `linkedin_session_expired` | a sessão do LinkedIn que o utilizador abriu à mão (`linkedin_apply.py login --interactive`, por exemplo com Google) expirou ou o LinkedIn já não a aceita: o utilizador volta a iniciar sessão à mão e autoriza de novo a posição. Nunca tentes tu um início de sessão com Google |
| `workday_dom_unrecognised` / `workday_apply_start_unrecognised` / `workday_apply_flow_missing` / `workday_apply_control_missing` / `workday_account_form_unrecognised` | o anúncio do Workday, a sua janela "Start Your Application" ou o seu formulário de conta não é o que a receita conhece |
| `account_email_missing` / `account_email_in_use` / `account_exists` / `account_credentials_unsafe` / `account_secret_unhidden` / `workday_account_refused` / `workday_account_not_accepted` / `workday_terms_not_accepted` / `workday_account_verification_required` | a conta do candidato no portal da empresa: o perfil não tem email, o portal diz que esse email já tem conta (o CLOSER nunca faz reset de palavra-passe), já há uma conta guardada, o seu ficheiro não é um ficheiro privado 0600 deste utilizador, um campo de palavra-passe não pôde ser escondido antes de uma captura, ou o portal recusou a conta, ficou no passo da conta, não aceitou a caixa dos termos ou quer o email verificado. Só se marca a caixa dos termos do passo da conta |
| `workday_step_unsupported` | a candidatura no Workday passou o passo da conta e o CLOSER ainda não preenche os passos seguintes: não foi enviado nada |
| `linkedin_login_failed` | o LinkedIn recusou o início de sessão duas vezes: nenhuma nova tentativa até o utilizador escrever credenciais novas |
| `linkedin_login_code_missing` / `linkedin_login_code_undelivered` | o código de verificação do LinkedIn foi pedido no Telegram e não chegou a tempo (ou o pedido não chegou ao Telegram, ou o LinkedIn não aceitou o código — nunca conta como um login falhado): uma nova volta pede um código novo |
| `linkedin_challenge` | o LinkedIn mostra um captcha ou uma verificação de segurança: o utilizador resolve-a no ecrã ao vivo e volta a autorizar a posição |
| `linkedin_redirect_untrusted` / `application_redirect_untrusted` | a página do LinkedIn saiu do LinkedIn (`www.linkedin.com` ou uma página de país como `es.linkedin.com`), ou o endereço da empresa que indica não é uma página HTTPS fora do LinkedIn (ou é uma segunda passagem) |
| `linkedin_follow_not_cleared` | não foi possível desmarcar a caixa «seguir a empresa» antes de Submit: nada é enviado |
| `linkedin_throttled` / `linkedin_login_retry` / `linkedin_interval_invalid` / `linkedin_dry_run_signed_out` / `linkedin_profile_busy` | **negado, não bloqueado**: as candidaturas no LinkedIn são espaçadas (`linkedin_min_interval_minutes`, por omissão 20), o início de sessão falhou uma vez e a próxima volta tenta mais uma vez, ou essa definição não é um número inteiro de minutos. A fila tenta de novo sozinha Um dry run nunca inicia sessão: sem uma sessão do LinkedIn guardada é negado como `linkedin_dry_run_signed_out`. Outro navegador tem o perfil do LinkedIn feito à mão (`linkedin_profile_busy`): está em curso um início de sessão manual. |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | dois endereços mailto de candidatura diferentes, ou o formulário de candidatura, os seus campos ou o seu botão de envio não cabem num único formulário (newsletter, rodapé e formulários de demo nunca fazem parte) |
| `form_error` / `field_invalid` / `submit_unavailable` | o formulário assinala um erro, o formato de um campo é recusado, ou o botão de envio falta ou está desativado |
| `url_refused` / `checkpoint_invalid` | o URL da candidatura não passou o controlo de endereços públicos, ou o checkpoint guardado não se lê |
| `page_unavailable` / `browser_uncertainty` | a página ou o browser falharam a meio do fluxo |
| `page_not_found` / `bot_protection` / `page_temporarily_unavailable` | a página da vaga já não existe (404/410 sem prova de vaga fechada), um controlo anti-bot parou o navegador (após uma tentativa num navegador visível), ou o site não respondeu três vezes num dia. Um único 5xx ou timeout NÃO é uma paragem: o checkpoint diz `retry_later`, a fila devolve a posição mais tarde sozinha e ninguém é avisado. O checkpoint guarda `http_status` e `final_url` |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | o envio foi clicado mas a confirmação não é certa |
| `receipt_screenshot_failed` | a confirmação estava visível mas a captura não pôde ser guardada |
| `submit_outcome_unknown` | uma passagem anterior iniciou o envio e não deixou recibo |
| `applied_record_failed` | o recibo existe mas o estado não pôde ser registado — a candidatura quase certamente saiu |
| `login_required` / `account_creation` | o site quer uma sessão iniciada ou uma conta nova antes da candidatura: o CLOSER nunca inicia sessão nem cria contas |
| `generic_form_missing` / `generic_form_unrecognised` / `application_form_embedded` / `application_redirect_untrusted` | um site de empresa: nenhum formulário de candidatura, um formulário que a receita genérica não consegue identificar, um formulário incorporado de outro host (o detail nomeia-o), ou um botão de candidatura que leva a um site sem receita |
| `cover_letter_required` / `pre_submit_screenshot_failed` | o formulário exige um ficheiro de carta de apresentação · não foi possível fotografar o formulário preenchido antes do clique |

O que fazes em qualquer outro motivo (as respostas em falta estão acima):

1. **Nada nessa posição.** O fluxo já escreveu o checkpoint e
   pôs a paragem no resumo da volta. Não avises tu o utilizador.
2. **Não a repitas.** Nem agora, nem «mais uma vez daqui a uns minutos». A queue
   retém-na (`checkpoint_blocked_human`) até o utilizador a autorizar outra vez.
3. **Passa à posição seguinte** da queue.

Repetir uma posição bloqueada é a tentativa às cegas que este design existe para
impedir: num captcha queima a conta do utilizador, num resultado desconhecido
envia uma segunda carta ao mesmo recrutador.

## Sites de carreiras de empresas — a receita genérica

Quando nenhum ATS é reconhecido e a página não é um canal `mailto:`, o fluxo usa
`apply_generic.py` no site da empresa: encontra o ÚNICO formulário de
candidatura (um upload do CV, ou nome e email com um botão de candidatura —
também atrás de um botão de candidatura ou numa página ligada do mesmo site),
preenche os campos pelas etiquetas (perfil para nome, email, telefone, links;
respostas guardadas para as perguntas) e nunca toca num formulário de
newsletter, contacto, pesquisa ou início de sessão. O formulário preenchido é
fotografado antes do clique; sem uma confirmação reconhecível (texto ou URL) o
resultado é `submit_outcome_unknown`, nunca um segundo clique. Um botão que leva a
um ATS conhecido passa a posição a essa receita.

**Um resumo por volta.** Nenhuma paragem é avisada sozinha: cada `blocked_human`
que não é uma pergunta do formulário (sites como `ats_unsupported`, `ats_conflict`, `linkedin_easy_apply`, `application_form_embedded`, `page_not_found`, `bot_protection`, `page_temporarily_unavailable`; LinkedIn, CV, ofertas fechadas, resultados
incertos, paragens do canal de email) espera a ÚNICA mensagem que envias no STEP 6 com
`python3 /app/shared/skills/closer_notices.py flush`. Só saem logo uma pergunta
que fazes explicitamente, os dados essenciais e um código de verificação do LinkedIn.
Cada aviso chega ao utilizador na língua do seu perfil.

## Verificar uma candidatura depois

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` e um `applied_at` não vazio = o fluxo registou-a.
