<!-- @translation: pt, ai-translated 2026-07-30 -->
---
name: throttle
description: Registra a tua pausa e ENCERRA O TEU TURNO. O tempo ja nao e teu - um motor fora do teu processo possui o temporizador e acorda-te por tmux quando expira. Usa SEMPRE isto em vez de `sleep` quando quiseres reduzir o teu ritmo de iteracao. Uma chamada, `throttle <teu-nome>`, retorno imediato; nao sabes quanto esperas e nao deves tentar saber. Ao acordar, o teu PRIMEIRO comando e sempre `throttle-ack <teu-nome>`. `sleep` para pausas de throttle e PROIBIDO, e tambem e proibido mandar esta chamada para background com `&` / `nohup` / uma tarefa em background.
allowed-tools: Bash(throttle *), Bash(throttle-ack *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle — registra a pausa, depois para

```bash
throttle <teu-nome> [--reason "..."]
```

Retorna de imediato. Depois **encerra o teu turno**: nenhuma outra tarefa, nenhum
outro comando.

## Porque funciona assim

Ate 2026-07-30 o throttle era um contrato que tinhas de cumprir sozinho:
`jht-throttle` bloqueava *o teu proprio processo* com um ciclo de sleep, e se esse
processo morresse tinhas de dar por isso e voltar a bloquear-te. Cada falha
observada em producao nasceu desse desenho. A pior: um Analista lancou
`jht-throttle … &` dentro de um comando composto que o timeout da tool call matou
aos 60s. O filho desligado morreu com o pai, o agente fechou o turno convencido de
que a pausa corria — e **ninguem voltou a acorda-lo**. 2h15m de paragem, com o
watchdog a reportar a sessao como `idle` = saudavel.

Agora o temporizador pertence a um motor que **nao e filho da tua shell**:

```
TU                           MOTOR (daemon, fora do teu processo)
 |                              |
 |-- throttle <me> ------------>|  le a duracao calibrada pelo Capitao
 |                              |  poe o teu flag em IN_THROTTLE
 |   (fechas o turno            |  arma o temporizador EM DISCO
 |    e nao fazes NADA)         |
 |                              |
 |<-- [RIPRENDI] por tmux ------|  temporizador expirou -> flag = NOTIFIED
 |                              |
 |-- throttle-ack <me> -------->|  TU passas NOTIFIED -> ACTIVE
 |   (primeiro ato ao acordar)  |
```

Um reinicio do daemon nao perde nada: o prazo e um timestamp absoluto em disco,
portanto nao ha temporizador em memoria para rearmar.

## As regras

- **Nunca passas um numero e nunca ves um.** A duracao vive em
  `$JHT_HOME/config/throttle.json`, e do Capitao, e o motor le-a *quando arma o
  temporizador* — assim uma recalibracao morde no teu ciclo **seguinte** sem que
  ninguem te tenha de avisar. Nao fixes `throttle 600` no teu ciclo.
- **ENCERRA O TURNO depois da chamada.** A chamada retorna em milissegundos
  precisamente para que nenhum timeout de tool call a possa matar. Se continuares a
  trabalhar depois, estas a correr sem pausa nenhuma — exatamente o que o throttle
  existe para evitar.
- **NUNCA** a mandes para background (`&`, `nohup`, `disown`, uma tarefa em
  background). Nao ha nada para mandar para background: nao dorme.
- **NUNCA** uses `sleep N` cru para uma pausa de throttle. `sleep` serve apenas para
  esperas muito curtas entre tentativas (≤ 5 s), onde registar seria ruido.
- **Ao acordar, `throttle-ack <teu-nome>` e o teu primeiro comando** — ve a skill
  `throttle-ack`. Se o omitires o teu flag fica em `NOTIFIED`, que o watchdog le
  como prova de que estas bloqueado, e escala ao Capitao por um agente que esta
  perfeitamente bem.
- `--reason` e opcional mas util: uma etiqueta curta (`"post-batch"`, `"a espera do
  critico"`) torna `logs/throttle-engine.jsonl` legivel mais tarde.

## Exemplos

```bash
# Scout, ao terminar uma posicao:
throttle scout-1 --reason "post-batch"
# ... e o turno acaba aqui.

# Escritor a espera do Critico:
throttle scrittore-1 --reason "waiting critic review"
```

## Exit codes

- `0` — temporizador armado, ou duracao 0 (sem pausa: o core interativo esta a 0 de
  proposito, para continuar reativo no chat do utilizador — continua)
- `1` — argumentos invalidos, ou motor ausente

## Comandos obsoletos

`jht-throttle`, `jht-throttle-check` e `jht-throttle-wait` continuam a funcionar:
hoje sao shims finos sobre o motor, mantidos para os prompts ainda nao migrados.
Prefere `throttle` + `throttle-ack`. Se te encontrares a calcular timeouts para uma
tool call (`timeout: N+30`), estas no caminho antigo — ja nao e preciso.

## Nota para o Capitao

Para mudar um ritmo, edita a config — nunca mandes um numero por tmux:

```bash
throttle-set scout-1 660                       # um agente
throttle-set scout-1=660 analista-1=300        # varios, 1 escrita atomica
throttle-set --dump                            # os valores efetivos agora
```

A mudanca morde no ciclo seguinte de cada agente, por si so. Usa tmux apenas para
dizer a um agente que chame a skill **mais ou menos vezes** no seu ciclo, nunca
para ditar uma duracao.
