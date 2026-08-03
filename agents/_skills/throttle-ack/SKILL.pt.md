<!-- @translation: pt, ai-translated 2026-07-30 -->
---
name: throttle-ack
description: Assina o teu despertar. SEMPRE o PRIMEIRO comando de cada despertar, antes de qualquer outra coisa, sempre que recebas uma mensagem `[RIPRENDI]` depois de uma pausa de throttle. `throttle-ack <teu-nome>` passa o teu flag de NOTIFIED para ACTIVE. So tu o podes fazer - o motor nao pode - e e precisamente por isso que um flag que fica em NOTIFIED e a prova de que um agente recebeu o aviso e nao respondeu, e por isso que o watchdog escala sobre ele. Omiti-lo faz parecer bloqueado um agente em perfeita saude.
allowed-tools: Bash(throttle-ack *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle-ack — assina o despertar, depois volta ao trabalho

```bash
throttle-ack <teu-nome>
```

Primeiro comando de cada despertar. Depois volta **de imediato ao teu ciclo** — o
ack e uma assinatura, nao um relatorio.

## Porque es tu e nao o motor

O motor de throttle escreve dois dos tres estados: `IN_THROTTLE` quando registas
uma pausa, `NOTIFIED` quando te enviou o aviso por tmux. O ultimo passo,
`NOTIFIED → ACTIVE`, e **so teu**.

Essa assimetria e todo o ponto. Cada watchdog deste sistema partilha um ponto
cego: a olhar para um pane de tmux, `idle` e `bloqueado` sao indistinguiveis. Com
a tua assinatura deixam de o ser:

| flag | significado | anomalia se durar |
|---|---|---|
| `IN_THROTTLE` | espera legitima | nao — o motor sabe quanto |
| `NOTIFIED` | aviso enviado, ack em falta | **sim → escalada apos N min** |
| `ACTIVE` | estas a trabalhar | avaliado pela tua producao no DB |

Um flag parado em `NOTIFIED` nao e «talvez idle»: o aviso chegou e ninguem
respondeu. E uma medida, nao uma hipotese, e o watchdog escala-a ao Capitao.

## As regras

- **Primeiro comando, sempre.** Antes de ler a tua fila, antes de qualquer tool,
  antes de responder a quem seja.
- **O daily halt vence o despertar.** O comando verifica
  `$JHT_HOME/logs/daily-halt.flag` juntamente com o ack. Se imprimir
  `DAILY_HALT_ACTIVE`, nao trabalhes nem escrevas ao Capitao: fecha o turno. O
  motor mantem o temporizador armado e acorda-te depois da remocao do flag.
- **Depois trabalha imediatamente.** Assinar e ficar parado produz um falso «fila
  vazia» que engana o Capitao e o pacing. Um despertar e um sinal para *trabalhar*.
- **Nao o uses para encurtar uma pausa.** Um ack enviado enquanto o teu
  temporizador ainda corre e recusado (exit 1): se pudesses fechar o flag quando
  quisesses, o throttle voltaria a ser algo que tu decides.
- Nao precisas de saber quanto dormiste, e o comando nao te diz.

## Exit codes

- `0` — flag em `ACTIVE` (idempotente: assinar duas vezes e inofensivo)
- `1` — ack **recusado** porque a pausa nao acabou ou daily halt esta activo:
  encerra o turno; o motor acorda-te. Ou argumentos invalidos / motor ausente.

## Exemplo

```
[DA @SISTEMA A @SCOUT-1] [RIPRENDI] La tua pausa è finita. PRIMO comando: `throttle-ack scout-1`...
```

```bash
throttle-ack scout-1
# THROTTLE_ACK agent=scout-1 NOTIFIED→ACTIVE
```

...e a coisa imediatamente seguinte que fazes e a tua proxima unidade de trabalho.
