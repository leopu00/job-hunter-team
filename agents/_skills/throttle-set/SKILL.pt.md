<!-- @translation: pt, ai-translated 2026-07-30 -->
---
name: throttle-set
description: A UNICA forma como os ritmos da equipa sao escritos. So o Capitao. `throttle-set <agente> <segundos>` edita a config de throttle por agente; o motor volta a le-la quando arma cada temporizador, logo a mudanca morde no ciclo SEGUINTE desse agente por si so - nenhuma mensagem tmux, nenhum agente tem de reler nada, e o ciclo ja em curso nao e perturbado. Usa-o em vez de mandar numeros aos workers. Tambem `throttle-set a=N b=M ...` para uma escrita multipla atomica, `--dump` para os valores efetivos, `--get <agente>`, `--reset`.
allowed-tools: Bash(throttle-set *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle-set — governa os ritmos sem tocar nos agentes

```bash
throttle-set <agente> <segundos>            # um agente
throttle-set scout-1=660 analista-1=300     # varios, uma escrita atomica
throttle-set --dump                         # os valores EFETIVOS agora
throttle-set --get <agente>                 # o valor efetivo de um
throttle-set --reset                        # apaga todos os overrides
```

## Porque nunca mandas um numero por tmux

O motor de throttle le a config **no momento em que arma cada temporizador**.
Portanto:

- um valor que mudes aqui morde no ciclo **seguinte** desse agente, sozinho;
- o ciclo **em curso** nao e tocado — o seu prazo ja estava calculado, e move-lo
  seria uma surpresa que ninguem pediu;
- os workers nunca veem um numero e nao sabem quanto esperam. Chamam
  `throttle <o-seu-nome>` e param. A duracao e so tua.

E toda a razao pela qual isto existe: cinco mensagens tmux a levar um numero sao
cinco oportunidades de entrar em corrida com um agente a meio da pausa. Uma escrita
atomica e nenhuma.

## O que te volta e o EFETIVO, nao o que pediste

Duas correcoes automaticas aplicam-se na leitura, portanto o numero que o agente
sofre pode diferir do que escreveste:

- **Worker floor, 5 min.** Os workers (Scout/Analista/Scorer/Escritor/Critico) nunca
  descem abaixo de 300s, `0` incluido. Nasce de um incidente medido — um Scout sem
  pausas queimou ~308kT por 3 posicoes de dados sujos. O core interativo
  (Capitao/Sentinela/Assistente/Mentor) **nao** tem floor: tem de continuar reativo
  para o chat do utilizador, logo ali `0` continua `0`.
- **Escada coprima.** Todo o valor > 0 encaixa num degrau em minutos primos
  (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60). Os degraus multiplos de 5
  ressincronizavam os workers *por construcao*: 5+10 coincidiam a cada 10 minutos.
  Degraus coprimos tornam as colisoes raras em vez de periodicas.

Portanto `throttle-set scout-1 120` le-se de volta como `300`. Nao e a ferramenta a
ignorar-te — e o valor que o agente vai sofrer, e e o que `--dump` mostra.

Ambas cedem enquanto a derrogacao temporaria do utilizador esta viva, e voltam
sozinhas quando expira. Nao precisas de te lembrar de as restaurar.

## Para CONSUMIR mais a alavanca e o paralelismo, nao um throttle menor

Os workers nao descem abaixo de 5 min, logo «poe o throttle a 0» para eles nao
existe. Se a equipa esta abaixo do ritmo alvo, acrescenta workers **por etapas**;
nao tentes recuperar a limar a pausa. Um throttle saturado e um sinal, nao um
destino: quando um agente ja esta alto na escada e continua a exceder, a alavanca
passa a ser mata-lo, nao outro empurrao.

## Exit codes

- `0` — escrito / lido
- `1` — argumentos invalidos, valor fora do intervalo (0..3600), ou config ausente

## Exemplo

```bash
throttle-set --dump
# default = 0s
# scout-1        = 660s
# analista-1     = 300s

throttle-set scout-1 1380
# scout-1=1380s

# scout-1 esta a meio da pausa: mantem os 660s que tinha, e vai sofrer 1380s no
# proximo ciclo. Ninguem lhe disse nada.
```
