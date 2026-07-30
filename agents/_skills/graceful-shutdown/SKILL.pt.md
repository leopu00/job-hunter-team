<!-- @translation: pt, ai-translated 2026-07-30 -->
---
name: graceful-shutdown
description: Encerra o dia de trabalho a pedido do utilizador. Acionada por uma mensagem `[SHUTDOWN]` de @utente. O utilizador está a fechar a aplicação e todos os agentes estão prestes a ser terminados a meio da tarefa; antes que isso aconteça, cada um deve registar até onde chegou, para que amanhã a equipa retome em vez de recomeçar. Para os agentes um a um e depois cria o flag que permite à aplicação sair. NUNCA uses isto para decisões de pacing de rotina — termina a equipa inteira.
allowed-tools: Bash(jht-tmux-send *), Bash(node /app/cli/bin/jht.js team *), Bash(touch /jht_home/.shutdown-ready.flag), Bash(python3 /app/shared/skills/captain_diary.py *)
---

# graceful-shutdown — encerrar o dia quando o utilizador sai

O utilizador está a fechar a aplicação. Sem ti, os agentes seriam cortados a meio
do trabalho: um Scout a meio de uma ronda de boards, um Scrittore com um CV a
meio. **A tua tarefa é que ninguém perca o ponto onde estava.**

O jogo enviou-te `[@utente -> @capitano] [SHUTDOWN] …` e agora **espera um flag
da tua parte**: enquanto não o criares, a janela continua aberta e mostra ao
utilizador quantos agentes ainda estão a trabalhar.

## Procedimento

1. **Pede a todos que anotem onde estão e parem.** A cada sessão viva envia:

   ```bash
   jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [SHUTDOWN] Encerramento pedido pelo utilizador. Escreve na tua agenda até onde chegaste (última board, última posição guardada, o que falta), depois para. Não comeces trabalho novo."
   ```

   Uma linha por agente, com o seu nome real. Quem estiver a escrever em disco
   termina o ficheiro atual: interromper uma escrita é pior do que esperar alguns
   segundos.

2. **Regista tu o dia** no diário, para que o Capitano de amanhã retome o fio:

   ```bash
   python3 /app/shared/skills/captain_diary.py append "Encerramento pedido pelo utilizador: <quem estava a fazer o quê>"
   ```

3. **Para os agentes** assim que tiverem confirmado (ou após uma espera razoável:
   não deixes o utilizador à espera mais do que uns dois minutos por um agente
   que não responde):

   ```bash
   node /app/cli/bin/jht.js team stop --all
   node /app/cli/bin/jht.js team stop assistente
   ```

4. **Cria o flag.** É a última coisa que fazes: diz ao jogo que pode desligar o
   contentor e sair.

   ```bash
   touch /jht_home/.shutdown-ready.flag
   ```

## Regras

- **O flag tem de ser criado SEMPRE**, mesmo que algo tenha corrido mal. Se não o
  criares, o utilizador fica à frente de uma janela à tua espera — e acabará por
  forçar o fecho, que é exatamente o que esta skill evita.
- **Não negoceies o encerramento.** O utilizador decidiu: a tua tarefa é torná-lo
  ordenado, não discuti-lo nem adiá-lo.
- **Nada de trabalho novo** a partir do momento em que recebes `[SHUTDOWN]`:
  nenhum spawn, nenhuma ronda nova, nenhum escalamento.
- Se um agente não responder, anota-o no diário e segue em frente: melhor perder
  o ponto de retoma de UM agente do que bloquear o encerramento de todos.
