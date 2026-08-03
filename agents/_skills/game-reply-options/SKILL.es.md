<!-- @translation: es, ai-translated 2026-08-03 -->
---
name: game-reply-options
description: "Ofrece de 2 a 5 botones de respuesta clicables, específicos del contexto, en el chat del juego JHT cuando de verdad le faciliten al usuario la siguiente decisión. Úsalos solo para una elección pequeña y acotada; en el resto de casos responde normalmente con jht-send. No los uses nunca como un árbol de onboarding fijo."
allowed-tools: Bash(jht-reply-options *)
---

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
