---
name: game-reply-options
description: "Ofrece de 2 a 5 botones de respuesta clicables, específicos del contexto, en el chat del juego JHT cuando de verdad le faciliten al usuario la siguiente decisión. Úsalos solo para una elección pequeña y acotada; en el resto de casos responde normalmente con jht-send. No los uses nunca como un árbol de onboarding fijo."
allowed-tools: Bash(jht-reply-options *)
---
<!-- @translation: es, ai-translated 2026-08-03 -->

# Opciones de respuesta generadas en el juego

Cuando el mensaje del usuario admite unas pocas jugadas claras, cierra tu turno con
una pregunta y de 2 a 5 respuestas generadas para ese contexto exacto:

```bash
jht-reply-options --prompt '¿Por qué parte empezamos?' \
  'Revisemos mis roles objetivo' 'Veamos los huecos de mi perfil' 'Muéstrame las mejores posiciones'
```

El juego muestra esas opciones como botones sin quitar la posibilidad de escribir
texto libre. Al pulsar un botón, su texto se envía como un mensaje normal del usuario.

Reglas:

- Las opciones son opcionales, específicas de la conversación en curso y nunca
  copiadas del onboarding escrito offline.
- Usa de 2 a 5 opciones concisas y útiles entre sí. No ofrezcas una opción falsa
  cuyo resultado no puedas cumplir.
- `jht-reply-options` es la respuesta final de ese turno. No lo acompañes después
  con `jht-send`: los botones desaparecerían, y con razón, bajo la respuesta más reciente.
- Para preguntas abiertas o una respuesta directa, usa `jht-send` como siempre.

## Un `$` en el texto: comillas simples o stdin

Entre comillas dobles la shell lee `$1` y `$2` como argumentos suyos y los sustituye por nada **antes de que arranque la herramienta**: «Plus — $20/month; Pro — $200/month» llega al usuario como «Plus — 0/month; Pro — 00/month», y nadie más adelante puede devolver las cifras. Si el texto lleva un `$` (precios, importes), escríbelo entre comillas simples o pásalo por stdin.

```bash
# Single quotes for the labels; the prompt from stdin: "-" reads it, the quoted delimiter keeps every $
jht-reply-options --prompt - 'Plus — $20/month' 'Pro — $100/month' <<'TXT'
Which plan do you want? Plus — $20/month; Pro — $100/month
TXT
```

Escribe el `TXT` de cierre en la primera columna, solo en su línea, sin espacios delante (si copias la sangría el heredoc nunca se cierra: un texto que acaba en una línea `TXT` se rechaza, no se envía nada).
