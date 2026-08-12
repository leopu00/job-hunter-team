<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: chat-web
description: Responder al usuario cuando te escribe desde el chat web de JHT. El usuario te llega con el prefijo `[@utente -> @capitano] [CHAT] <cuerpo>`; responde SOLO con `jht-send` — nunca escribas en `chat.jsonl` a mano (el escape de shell rompe la línea JSON y el frontend silenciosamente descarta el mensaje, el usuario no ve nada mientras tú crees que has respondido). Usa esta skill en cada mensaje `[CHAT]`; NO la uses para tráfico entre agentes (eso es `tmux-send`).
allowed-tools: Bash(jht-send *)
---

# chat-web — protocolo usuario ↔ Captain

El usuario **no** está sentado en una sesión tmux. Escribe desde la UI web. El frontend etiqueta el mensaje y lo deja caer en tu panel tmux. Para responder, escribes una sola línea JSON en `$JHT_AGENT_DIR/chat.jsonl`; el frontend hace tail de ese archivo y renderiza burbujas en el panel de chat.

No escribes el JSON. El wrapper `jht-send` lo hace por ti, con timestamp + flag `done` + validación post-escritura. Úsalo. Siempre.

## Cómo reconocer un `[CHAT]` entrante

```
[@utente -> @capitano] [CHAT] <lo que escribió el usuario>
```

- El sobre es idéntico a los mensajes inter-agentes (misma forma `[@from -> @to]`) pero el tipo `[CHAT]` y el autor `@utente` lo hacen inequívoco.
- El usuario es **un humano, el dueño del perfil** — no un agente. No hay `tmux send-keys` que puedas usar para responder: su sesión no existe.
- Responde al **cuerpo**, no al sobre. El usuario no escribió el prefijo; el frontend lo añadió.

> ⚠️ Modo de fallo común la primera vez que ves esto: lees el prefijo y piensas "déjame responder vía `jht-tmux-send` al usuario". `jht-tmux-send UTENTE ...` devuelve `exit 2` (sesión inexistente). No empieces a depurar — solo recuerda que `[CHAT]` ⇒ `jht-send`. Siempre.

## ⚠️ El usuario NO es técnico — sin terminal, sin CLI, sin slash-commands

Un mensaje `[CHAT]` llega desde la **app de escritorio** (o Telegram). El usuario
**no** tiene terminal, ni la CLI de Claude Code, ni `/mcp`, ni slash-commands, ni
acceso a archivos. No es desarrollador. **NUNCA** le digas que:

- ejecute `/mcp`, `/config` o cualquier slash-command,
- abra una terminal / ejecute un comando CLI / edite un archivo / "autorice una herramienta",
- haga algo que podrías hacer tú.

Decirle a un usuario de escritorio "escribe `/mcp` en la terminal" es un callejón
sin salida — no puede. Si una tarea requiere una capacidad que no tienes cableada,
**resuélvela tú mismo con código** en vez de devolverle el trabajo al usuario. Tú
eres el equipo; el usuario es el cliente. Ingéniatelas.

### Ejemplo: enviar un email — NO necesitas una herramienta MCP/Gmail
El equipo ya tiene las credenciales de email en
`$JHT_HOME/credentials/email_monitor.json` (una app-password de Gmail — válida
también para SMTP). Escribe un pequeño script de Python y envíalo:

```python
import os, json, smtplib, ssl
from email.message import EmailMessage
c = json.load(open(os.path.join(os.environ["JHT_HOME"], "credentials", "email_monitor.json")))
m = EmailMessage()
m["From"], m["To"], m["Subject"] = c["user"], "<destinatario>", "<asunto>"
m.set_content("<cuerpo>")
# Gmail: smtp.gmail.com:465. Para otro proveedor deriva smtp.<dominio> o mapéalo.
with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context()) as s:
    s.login(c["user"], c["password"]); s.send_message(m)
```

Luego responde "Hecho, enviado ✅" — nunca "ve a autorizar Gmail".

### Si realmente necesitas un slash-command / herramienta en TU sesión
Puedes manejar tu propia sesión — no se lo pidas al usuario:

- **Autoinyéctalo** en tu propia sesión tmux:
  `jht-tmux-send <TU_SESIÓN> '/mcp'` (luego un Enter aparte), o
- **pide a otro agente** que lo inyecte por ti: p. ej. el Asistente le pide al
  Capitán (`jht-tmux-send CAPITANO '...inyecta /mcp en ASSISTENTE...'`) y el
  Capitán ejecuta `jht-tmux-send ASSISTENTE '/mcp'`. El usuario nunca se involucra.

## Comandos de respuesta

```bash
jht-send 'Respuesta final que cierra el turno.'
jht-send --partial 'Trabajando en ello…'   # checkpoint a mitad de turno, mantiene el turno abierto
```

Reglas:
- **Un `[CHAT]` ⇒ al menos un `jht-send`. Sin excepciones.** No escribir nada deja al usuario mirando un chat que parece congelado.
- **El mensaje de cierre del turno NO tiene `--partial`.** Si lo olvidas, el frontend mantiene los puntos de escritura para siempre (hasta un timeout de respaldo ~10 min después).
- **Comillas**: pasa el cuerpo como un solo argumento posicional. Las comillas simples preservan `$`, `"`, emoji, acentos literalmente. Para un cuerpo que contiene una `'` literal, usa comillas dobles (`jht-send "non c'è problema"`) — pero dentro de `"..."` el shell expandirá `$var`, así que ten cuidado.
- **Multi-línea**: bash `$'linea1\nlinea2'`, o usa `\n` dentro de la cadena y deja que Python lo preserve.

## Cuándo usar `--partial`

Úsalo cuando una operación orientada al usuario tomará más de ~3 segundos y aún no tienes la respuesta. Sin `--partial` entre el mensaje del usuario y la respuesta final, el frontend oculta los puntos de escritura y el chat parece muerto.

Patrón:
```
[CHAT] llega
   ↓
jht-send --partial 'Investigando — dame un momento…'
   ↓
(hacer el trabajo: db_query, capture-pane, análisis, …)
   ↓
jht-send 'Esto es lo que encontré: …'   ← sin --partial = cierra el turno
```

Si una sola operación pasa de ~30-45s sin señal, envía otro checkpoint `--partial`. El usuario nunca debe estar en silencio más que eso.

## Ejemplos (Captain ↔ usuario)

```bash
# Responder una pregunta sobre el estado del pipeline — rápido, tiro único
jht-send 'Pipeline en 132 posiciones: 18 nuevas, 47 verificadas, 31 puntuadas, 28 listas. Dos writers activos.'

# Análisis de larga duración — checkpoint, luego cerrar
jht-send --partial 'Obteniendo estadísticas y las últimas 50 revisiones — un momento…'
# (ejecutar db_query.py stats, db_query.py applications --critic-score-max 5)
jht-send $'Aquí está la imagen:\n\n• Pipeline saludable en el lado de descubrimiento.\n• Writers atascados en 4 posiciones con promedio de puntuación 3.2 → los estoy pausando y reabriendo el triage.'

# Cerrando el turno después de aplicar una solicitud del usuario
jht-send 'Hecho. Generado un Analyst extra, configuración de throttle volcada al log.'
```

## Anti-patrones (qué NO hacer)

- ❌ `echo '{"text":"...","ts":'$(date +%s.%N)'}' >> $JHT_AGENT_DIR/chat.jsonl` — explota con comillas/`$`/emoji, produce JSON inválido, el frontend silenciosamente descarta la línea.
- ❌ `cat << 'EOF' >> chat.jsonl ... EOF` — desactiva la interpolación `$`, el timestamp termina como cadena literal.
- ❌ `python3 -c "import json; ..."` ad-hoc — misma fragilidad que el heredoc del shell.
- ❌ Responder vía `jht-tmux-send UTENTE ...` — no hay sesión `UTENTE`. El usuario vive en el frontend web.
- ❌ Responder al `[CHAT]` con `jht-send` **y** reenviar el mismo contenido con `jht-notify-user`. Desde que el carril de chat está unificado escriben en la MISMA conversación: el usuario lee tu respuesta dos veces, y aguas abajo no la quita nadie — el carril no distingue un duplicado de dos turnos que coinciden por casualidad. Un mensaje, una sola herramienta.
- ❌ Enviar una respuesta final con `--partial` — puntos de escritura atascados en la pantalla del usuario.
- ❌ Múltiples llamadas a `jht-send` (sin `--partial`) para lo que debería ser un mensaje — cada llamada no-partial aparece como una burbuja separada.

## Enviar a un canal no predeterminado (raro)

```bash
jht-send --agent capitano 'nota a nivel de sistema enrutada vía mi canal'
```

Útil cuando quieres registrar un mensaje de sistema en tu propio canal de chat (ej. una automatización anotando que ha actuado en nombre del usuario). Para respuestas del día a día nunca necesitas este flag.

## Por qué `jht-send` y no shell crudo

Historia (no repetir): los agentes probaron `echo`-into-jsonl y heredocs `cat <<EOF`. Ambos terminaron en modos frágiles — el primero explota con comillas/`$`, el segundo congela el timestamp como cadena literal. Resultado: JSON inválido que el frontend salta. El usuario no ve nada; tú crees que has respondido. `jht-send` elimina el modo de fallo por completo — el cuerpo nunca re-entra a un parser de shell después del primer nivel de quoting.

## Ver también

- `tmux-send` — para mensajes a **otros agentes** (protocolo diferente, canal diferente).
- `agents/assistente/assistente.md` — el Assistente tiene la versión más profunda de este protocolo (flujo de onboarding multi-paso con checkpoints obligatorios); lee solo si alguna vez heredas funciones del Assistente.
