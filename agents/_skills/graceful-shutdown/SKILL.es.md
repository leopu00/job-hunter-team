<!-- @translation: es, ai-translated 2026-07-30 -->
---
name: graceful-shutdown
description: Cierra la jornada de trabajo a petición del usuario. Se activa con un mensaje `[SHUTDOWN]` de @utente. El usuario está cerrando la aplicación y todos los agentes están a punto de ser terminados a mitad de tarea; antes de que eso ocurra cada uno debe anotar hasta dónde ha llegado, para que mañana el equipo retome en lugar de empezar de cero. Detén los agentes uno por uno y luego crea el flag que permite salir de la aplicación. NUNCA uses esto para decisiones rutinarias de pacing — termina con todo el equipo.
allowed-tools: Bash(jht-tmux-send *), Bash(node /app/cli/bin/jht.js team *), Bash(touch /jht_home/.shutdown-ready.flag), Bash(python3 /app/shared/skills/captain_diary.py *)
---

# graceful-shutdown — cerrar la jornada cuando el usuario se va

El usuario está cerrando la aplicación. Sin ti los agentes quedarían cortados a
mitad del trabajo: un Scout en medio de una ronda de boards, un Scrittore con un
CV a medias. **Tu tarea es que nadie pierda el punto al que había llegado.**

El juego te ha enviado `[@utente -> @capitano] [SHUTDOWN] …` y ahora **espera un
flag de tu parte**: hasta que no lo crees, la ventana sigue abierta y muestra al
usuario cuántos agentes siguen trabajando.

## Procedimiento

1. **Pide a todos que anoten dónde están y se detengan.** A cada sesión viva
   manda:

   ```bash
   jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [SHUTDOWN] Cierre solicitado por el usuario. Escribe en tu agenda hasta dónde has llegado (última board, última posición guardada, qué queda pendiente), y luego detente. No empieces trabajo nuevo."
   ```

   Una línea por agente, con su nombre real. Quien esté escribiendo en disco
   termina el archivo actual: interrumpir una escritura es peor que esperar unos
   segundos.

2. **Anota tú la jornada** en el diario, para que el Capitano de mañana retome el
   hilo:

   ```bash
   python3 /app/shared/skills/captain_diary.py append "Cierre solicitado por el usuario: <quién estaba haciendo qué>"
   ```

3. **Detén a los agentes** cuando hayan confirmado (o tras una espera razonable:
   no tengas al usuario esperando más de un par de minutos por un agente que no
   responde):

   ```bash
   node /app/cli/bin/jht.js team stop --all
   node /app/cli/bin/jht.js team stop assistente
   ```

4. **Crea el flag.** Es lo último que haces: le dice al juego que puede apagar el
   contenedor y salir.

   ```bash
   touch /jht_home/.shutdown-ready.flag
   ```

## Reglas

- **El flag hay que crearlo SIEMPRE**, aunque algo haya salido mal. Si no lo
  creas, el usuario se queda delante de una ventana esperándote — y acabará
  forzando el cierre, que es exactamente lo que esta skill evita.
- **No negocies el cierre.** El usuario lo ha decidido: tu tarea es hacerlo
  ordenado, no discutirlo ni aplazarlo.
- **Nada de trabajo nuevo** desde el momento en que recibes `[SHUTDOWN]`: ningún
  spawn, ninguna ronda nueva, ningún escalado.
- Si un agente no responde, anótalo en el diario y sigue adelante: mejor perder
  el punto de retorno de UN agente que bloquear el cierre para todos.
