---
name: first-run-burst
description: "La primera media hora en la que un usuario recién llegado ve trabajar al equipo. Abre esta skill cuando recibas `[PROFILO-PRONTO]` del Assistente, o al despertar si `first_run.py status` informa de la fase `awaiting_profile` / `burst`. Deroga la calibración gradual (C-02) solo durante la primera ventana, y define el éxito como posiciones CON PUNTUACIÓN en pantalla — no como posiciones encontradas."
allowed-tools: Bash(python3 /app/shared/skills/first_run.py *), Bash(python3 /app/shared/skills/plan_registry.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(/app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *), Bash(jht-send *)
---
<!-- @translation: es, ai-translated 2026-08-03 -->

# first-run-burst — la demostración de la que depende que el usuario se quede

Un usuario nuevo termina el setup, enciende el equipo y se queda mirando. Diez minutos después ha
visto aparecer **una** posición en bruto. Nada le permite distinguir un equipo que se está dosificando
de una aplicación rota — así que concluye que está rota, y no le falta razón.

Tu calibración normal (C-02: un worker, observa 30 minutos, sube un escalón) es la regla correcta
**en régimen estacionario**, donde equivocarse cuesta una ventana de presupuesto. En el primer
arranque cuesta el usuario. Esta skill es la excepción documentada, y vale **solo para la primera
ventana**.

## Trigger

- `[@assistente -> @capitano] [PROFILO-PRONTO]` — el perfil acaba de volverse utilizable
- al despertar, si `python3 /app/shared/skills/first_run.py status` informa de
  `phase: awaiting_profile` o `phase: burst`

## Qué significa tener éxito aquí

**Posiciones con una puntuación, en pantalla.** No posiciones encontradas. Una ejecución que recoge
50 ofertas y puntúa 3 de ellas (medido, 2026-07-26) no ha producido casi nada visible para el
usuario: la shortlist es el producto, el scraping es fontanería. Todo lo que sigue se deriva de esa
única frase.

## El procedimiento

**1. Abre el burst y lee el roster.**

```bash
python3 /app/shared/skills/first_run.py begin-burst
```

Te devuelve el `roster` (cuántos Scout / Analista / Scorer), el
`scout_cap_first_pass` y el `target_scored`, todos derivados de la suscripción
que el usuario declaró. Si rechaza (`ok: false`, «plan de suscripción no
seleccionado»), aún no hay plan declarado: **no adivines** un roster, una
sobreestimación le quema la ventana el primer día. Pregúntaselo con `python3 /app/shared/skills/first_run.py ask-plan`: es la única forma, porque publica la tarjeta en la app, con los planes y el que indica la línea `Codex reports:` marcado como sugerido — una sugerencia, nunca tu elección. Una pregunta escrita como texto en tu panel no llega a nadie: el usuario mira la app, no tu panel. Cuando el usuario responda, escribe exactamente su elección con `python3 /app/shared/skills/plan_registry.py set <provider>:<id>` (sirve el id de la tarjeta: `pro_max` es `pro-max`) y vuelve a lanzar `begin-burst`. Si responde «no lo sé», detente y díselo; vuelve a preguntar en tu próximo despertar.

**Mientras corre el burst, el plan puede desaparecer** (la configuración se reinició, cambió el proveedor, se
editó el archivo). `first_run.py status` y `begin-burst` llevan entonces `plan_missing: true` con un `hint`: no
leas «burst already in progress» como «todo bien». El burst continúa y el plan se declara igual: pregúntalo con `python3 /app/shared/skills/first_run.py ask-plan` (la tarjeta, nunca texto simple) y escribe exactamente su elección con `python3 /app/shared/skills/plan_registry.py set <provider>:<id>`. El Asistente lo pregunta también cuando el
usuario habla con él.

**El plan se pregunta una sola vez.** Mientras tu pregunta sobre el plan siga sin respuesta en el chat, no la repitas, ni siquiera con otras palabras: un nuevo mensaje «perfil listo», otro despertar o `plan_missing` en el próximo `status` no cambian lo que esperas. Mira primero el chat: si ya preguntaste y el usuario no ha respondido, espera. Vuelve a preguntar solo después de que el usuario haya respondido «no lo sé». `ask-plan` no publica una segunda tarjeta mientras la primera no tenga respuesta: si dice que la pregunta está abierta, espera. Si no preguntas, la tarjeta la publica el sistema pocos minutos después de importar el perfil. Tras «no lo sé» vuelve a publicar la tarjeta solo pasada una hora, y nunca más de tres veces en total: si lo dice, espera y no preguntes con texto.

**Nunca antes del perfil, y la tarjeta va donde está el usuario.** `ask-plan` no publica nada mientras el perfil no esté guardado (`wait_for_profile: true`): no preguntes el plan en la bienvenida ni mientras se construye el perfil, y espera el mensaje de perfil listo. Mientras el usuario confirma su perfil con el Assistente, la tarjeta va al chat del Assistente, sea quien sea quien lance `ask-plan` (`agent` e `in_your_chat` en la respuesta dicen dónde está). Cuando le hables de ella, nombra el chat que la tiene — «el chat con el Assistente» — nunca «este chat» si `in_your_chat` es `false`.

**El plan sale solo de la configuración o del usuario.** No lo escribas nunca tú a partir del diario, de una nota, de la memoria o de una conversación anterior: «el usuario confirmó Pro» en una nota es lo que el usuario dijo entonces, no una declaración de ahora (la configuración puede haberse reiniciado y el plan puede haber cambiado). Mientras haya `plan_missing`, el plan falta: pregunta, una sola vez, y escribe solo lo que el usuario responda.

**Preguntar con botones.** Si preguntas con `jht-notify-user --oggetto … --option id=etiqueta`, el id de una opción admite solo `a-z`, `0-9` y `_` (hasta 24 caracteres, nunca empezando por `_`): el plan `pro-max` es el id `pro_max`, y cuando llegue la respuesta escribes el id del registro, `plan_registry.py set <provider>:pro-max`.

**2. Spawnea todo el roster, escalonado unos ~60 segundos.**

No un worker cada diez minutos: toda la formación, una detrás de otra, siempre a través de
`start-agent.sh` (C-03). Esta es la excepción deliberada a C-02.

**Tras un reinicio, arranca solo lo que falta.** Cuando despiertas en un burst ya abierto (los contenedores se reiniciaron, así que todas las sesiones han desaparecido), `first_run.py status` y `begin-burst` llevan `roster_alive` y `roster_missing` por rol. Arranca solo los roles de `roster_missing`, escalonados igual, y deja en paz los que ya están en marcha, hagan lo que hagan: una sesión ocupada está viva (C-08 bis). No vuelvas a lanzar toda la formación ni vuelvas a dar instrucciones a un worker que ya está trabajando. Si `roster_check` es `unavailable`, mira tú las sesiones de tmux antes de lanzar nada.

**3. No esperes colas llenas para encender el downstream.**

Spawnea el Analista en cuanto exista **una** posición, el Scorer en cuanto **una** posición esté
checked. La costumbre de "primero recojo, luego evalúo" es exactamente lo que deja al usuario
delante de un montón de filas sin puntuar.

**4. Pon un techo a la primera pasada de sourcing.**

Comunica a cada Scout su cuota de `scout_cap_first_pass` y dile que informe cuando la alcance, en
vez de buscar hasta agotar el presupuesto. Las posiciones más allá de ese techo todavía no valen
nada: se acumulan detrás de las que nadie ha puntuado.

**5. Informa pronto, no con el trabajo terminado.**

En cuanto las primeras ~3 posiciones tengan una puntuación, manda al usuario un `jht-send` breve
diciendo qué son: es el momento en el que la aplicación deja de parecer rota. Después sigue hasta
`target_scored`.

**6. Cierra el burst.**

```bash
python3 /app/shared/skills/first_run.py check
```

Ejecútalo en cada `[HEARTBEAT]`. Cuando pase a `steady` has vuelto bajo las reglas ordinarias,
calibración C-02 incluida.

## La velocidad aquí también la gestionas tú — el bridge solo aconseja

`pace_guard` mide el consumo contra la curva de la ventana en cada muestreo del bridge y te escribe
en el pane una línea `[PACE-GUARD]` con el throttle que recomendaría. **No** lo aplica: no lo aplica
nadie hasta que ejecutes tú `throttle-config.py`. Por lo tanto:

- **Nunca** `freeze_team.py` durante el burst. Un equipo congelado es exactamente el silencio que
  esta skill existe para evitar.
- Lee una línea `[PACE-GUARD]` como una decisión que tomar, no como una notificación. Trae el
  comando ya escrito para los workers vivos — adáptalo a quién está haciendo qué y ejecútalo. Si la
  ignoras, el ritmo no cambia: ningún script va a tocar el throttle en tu lugar.
- Si te llega como `LOCKOUT-IMMINENTE`, el freno recomendado ya está en el techo de 1h — frenar ya
  no basta, y la palanca es el **roster**: mata un Scout (nunca el Analista ni el Scorer: sin ellos
  no se puntúa nada).
- La ventana debe llegar al 100% **en el reset**, no antes. Estar al 100% a mitad de camino
  significa dejar al usuario con un equipo mudo durante dos horas; estar al 40% en el reset significa
  presupuesto dejado sobre la mesa. Son dos fracasos, y el primero es mucho peor.

## Antipatrones

- ❌ Spawnear solo Scout, "primero el material, luego las puntuaciones" — el resultado medido es 50
  encontradas / 3 puntuadas, que para el usuario es una app rota.
- ❌ Esperar un `[BRIDGE TICK]` antes del primer spawn: el trigger **es** el perfil listo.
- ❌ Subir la escalera de C-02 durante el burst — esa regla gobierna el régimen estacionario, esta
  ventana es la excepción.
- ❌ Congelar el equipo para proteger el presupuesto. Lo lento se recupera, lo mudo no.
- ❌ Anunciar el burst al usuario con el lenguaje de la infraestructura ("spawneados 4 workers,
  throttle 300s"). Informa de posiciones, empresas, puntuaciones.

## Véase también

- `spawn-agent` — el lanzamiento propiamente dicho, sin cambios.
- `pipeline-triage` — qué rol desatasca el cuello de botella, una vez en régimen estacionario.
- `scaling-calc` / **C-02** — la calibración gradual que esta skill suspende.
- `chat-web` — cómo formular el primer informe al usuario.
