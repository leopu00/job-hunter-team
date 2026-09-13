<!-- @translation: pt, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Como o CLOSER executa uma candidatura autorizada com `apply_flow.py` — a máquina de estados com checkpoints (detect, fill, upload_cv, screening, review, submit), o recibo obrigatório sem o qual `applied` nunca é escrito, e o que fazer em cada resultado, `blocked_human` antes de tudo. Usa-a para cada posição tomada da queue. Do CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/db_query.py *)
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
- Hoje a única receita completa é **Ashby**. Qualquer outra plataforma bloqueia para uma pessoa.

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
| `error` | 2 | perfil ou CV ilegível, argumentos errados | para: `[BLOCKED]` ao Capitano |

## `blocked_human` — o que significa e o que fazes

O fluxo para em tudo o que não consegue fazer com certeza:

| `reason` (exemplos) | Causa típica |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | um campo obrigatório não tem resposta guardada — o utilizador tem de a acrescentar em `application_answers` |
| `captcha` / `two_factor` | o site quer verificar que há uma pessoa |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | um campo que a receita não sabe preencher com uma resposta guardada |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | o CV não se consegue anexar |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` | ainda não há receita para esta página |
| `page_unavailable` / `browser_uncertainty` | a página ou o browser falharam a meio do fluxo |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | o envio foi clicado mas a confirmação não é certa |
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
