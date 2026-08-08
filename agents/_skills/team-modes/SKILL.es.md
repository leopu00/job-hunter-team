<!-- @translation: es, ai-translated 2026-08-03 -->
---
name: team-modes
description: "El manual de los modos del equipo — una ficha por modo (search / harvest / care / calibration / saving). Ábrelo siempre que el banner horario [MODALITÀ CORRENTE] nombre un modo y no recuerdes qué implica operativamente, al despertar tras un refresh de contexto, o cuando el usuario cambie de modo desde el juego. El modo es SIEMPRE una elección del usuario - esta skill te dice cómo LLEVAR el actual, nunca cómo cambiarlo."
allowed-tools: Bash(python3 /app/shared/skills/mode_banner.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/feedback_query.py *), Bash(python3 /app/shared/skills/team_directives.py *)
---

# team-modes — qué significa el modo actual, en treinta segundos

El equipo tiene un solo modo persistente a la vez. Vive en
`$JHT_HOME/profile/capitano-maintenance.json` (nombre de archivo histórico — NO
esperes un archivo renombrado) bajo la clave `"mode"`, un **enum cerrado de
cinco valores**. El banner horario `[MODALITÀ CORRENTE]` lleva la
especificación compacta; esta skill es la ficha completa. Si el banner y tu
contexto no concuerdan, **gana el archivo en disco** — tu contexto puede haber
sido borrado por un refresh.

| valor | significado |
|---|---|
| `search` | por defecto: acumular (scout → análisis → score) |
| `harvest` | para el sourcing, convierte en CV las mejores posiciones ya encontradas |
| `care` | mantén fresco el portafolio encontrado: recheck cadenciado, descarte de expiradas (C-18) |
| `calibration` | lee el feedback del usuario y reapunta la **prioridad** de la búsqueda |
| `saving` | mínimo vital de supervivencia, ningún enriquecimiento autónomo |

- **Sin archivo → `search`.** Valores legacy: `"normal"` → search,
  `"maintenance"` → care (las instalaciones live aún los llevan — respétalos,
  mismo modo).
- **Archivo presente pero ilegible → modo `sconosciuto`**: trátalo como una
  orden ACTIVA (el sourcing sigue parado), abre tú mismo el archivo antes de
  decidir nada.
- Un valor fuera del enum sigue siendo una orden del usuario: repórtalo, no lo
  normalices para hacerlo desaparecer.

Cada modo declara **cuatro cosas** — las mismas cuatro que el banner comprime:
**(1)** qué colas están activas, **(2)** qué está suspendido, **(3)** adónde va
el presupuesto, **(4)** cuándo su trabajo está TERMINADO. El punto 4 es el que
faltaba históricamente: ningún modo terminaba solo, y un equipo llegó a estar
18 días en mantenimiento sin que nadie se diera cuenta. Cuando el banner diga
que el trabajo del modo está agotado, **díselo al usuario** — nunca cambies de
modo por tu cuenta, pero el silencio tampoco está permitido.

El vocabulario `orders` (`stop_search`, `discard_expired_rotating`,
`cv_min_score`, `pre_check_liveness_for_cv`, más las claves escritas a mano) se
compone con CADA modo: una clave explícita en `orders` siempre anula el valor
por defecto del modo. Un VPS de producción live corre hoy en `care` con esas
órdenes activas.

---

## `search` — ricerca (búsqueda; por defecto: acumular)

1. **Colas activas**: la pipeline completa — los Scouts hacen sourcing,
   `next-for-analista`, `next-for-scorer`; Scrittore/Critico siguen on-demand
   (C-10).
2. **Suspendido**: nada. C-05/C-05c (sourcing anti-idle) están en vigor.
3. **Prioridad de presupuesto**: primero el sourcing, luego análisis/score;
   equilibra la entrada hacia posiciones CON PUNTUACIÓN (la shortlist es el
   producto).
4. **Condición de salida**: ninguna — modo continuo. No termina; es el usuario
   quien te saca de él (típicamente hacia `harvest` o `care` cuando el backlog
   puntuado supera el tiempo que tiene para leerlo).

**Qué haces**: régimen normal — calibración por etapas C-02, escalera de
throttle C-07, conciencia weekly C-09. **Con C-25**: `[SCOUT-ESAUSTO]` + colas
aguas abajo vacías + margen → el trabajo útil por defecto de C-25 ya es el
trabajo de este modo; mantén el pace en el objetivo, nunca idle habiendo
margen. **NO hagas**: tratar "sin archivo" como "sin reglas" — el tablón
(`team_directives`) sigue aplicándose.

## `harvest` — raccolto (cosecha: para el sourcing, convierte las mejores)

1. **Colas activas**: el portafolio ya encontrado, primero las mejores
   puntuaciones. Flujo CV: `next-for-scrittore` (marcadas con flag por el
   usuario) más las posiciones que el usuario elija cuando le pongas delante la
   cabeza de la shortlist; el Critico revisa como siempre.
2. **Suspendido**: el sourcing — **NINGÚN Scout** (`stop_search` vale true por
   defecto: C-05/C-05c suspendidas, la cola `new` vacía es el estado QUERIDO).
3. **Prioridad de presupuesto**: primero Scrittore/Critico; el Analista solo
   para el check de liveness pre-CV (`pre_check_liveness_for_cv` — nunca
   escribas un CV para una oferta muerta).
4. **Condición de salida**: ninguna posición viva ≥ el umbral de CV
   (`orders.cv_min_score`, por defecto 75) se queda sin CV. El banner lo evalúa
   en solo lectura contra la DB; cuando diga HARVEST DONE, repórtaselo al
   usuario y pregunta adónde ir después.

**Qué haces**: mata / no spawnees Scouts; spawnea el Scrittore on-demand según
C-10 a medida que el usuario va marcando posiciones; mantén en movimiento la
cola de las marcadas; pon delante del usuario las mejores posiciones aún no
escritas para que pueda marcarlas. **Con C-25**: cosecha agotada + margen de
presupuesto → el excedente vuelve al sourcing (1 Scout, pacing normal) SALVO
que el usuario haya prohibido explícitamente el sourcing (tablón, C-26) — en
ese caso te quedas quieto y le dices al usuario que sobra presupuesto. **NO
hagas**: escribir CV para posiciones por debajo del umbral "para usar el
presupuesto", ni spawnear Scouts "para no quedar idle" mientras queden
candidatas sin escribir.

## `care` — cura (cuidado: mantén fresco el portafolio; regla completa: C-18)

1. **Colas activas**: `next-for-recheck-due` (live, score ≥ 70, >14 días,
   primero las mejores, vía `recheck-batch`), `next-for-geocode-missing`,
   `next-for-logo-missing`, más el conjunto de las expiradas
   (`discard_expired_rotating`).
2. **Suspendido**: el sourcing con `stop_search: true` (aquí es su valor por
   defecto) — C-05/C-05c suspendidas.
3. **Prioridad de presupuesto**: cuidado del portafolio, repartido a lo largo
   de las horas activas (lento, constante — nunca concentrado al principio); CV
   solo a petición del usuario y ≥ `cv_min_score` (por defecto 90).
4. **Condición de salida**: LAS CUATRO colas de cuidado vacías. La cadencia de
   14 días vuelve a hacer madurar posiciones, así que "terminado" es
   terminado-por-ahora — el banner lo dice, y por el punto 4 de C-18 + C-25 el
   excedente vuelve al sourcing salvo prohibición.

**Qué haces**: los Analisti son el motor — una cola distinta por instancia
(C-13), declarada en el kick-off. La exclusión de una posición es SIEMPRE
juicio del Analista, nunca de un script. Las colas de enriquecimiento honran
`enrichment-policy.json` EN CÓDIGO: una cola que vuelve vacía con un motivo de
policy es un estado querido, no un bug. **NO hagas**: quemar todos los recheck
de una tacada, reintentar una cola deshabilitada por policy, ni spawnear Scouts
mientras las colas de cuidado tengan trabajo.

## `calibration` — calibrazione (calibración: reapunta la prioridad de la búsqueda)

1. **Colas activas**: el feedback del usuario (`feedback_query.py recent` —
   vive en el cloud), el perfil de score, la taxonomía `role_family`.
2. **Suspendido**: el sourcing masivo — hasta que la prioridad no esté
   actualizada, las posiciones nuevas se encontrarían con la PUNTERÍA VIEJA (es
   el desperdicio que este modo previene). `stop_search` vale true por defecto.
3. **Prioridad de presupuesto**: leer el feedback + reapuntar: ajusta las
   prioridades y los círculos de búsqueda de los Scouts, recalcula el score de
   las posiciones afectadas en un batch acotado si los criterios se movieron.
4. **Condición de salida**: el batch de feedback reciente ha sido leído y la
   prioridad actualizada. NO verificable por máquina desde el disco (el
   feedback vive en el cloud) — el banner dice "no valutabile" a propósito;
   eres TÚ quien declara la finalización al usuario, con lo que cambió (p. ej.
   "despriorizado Berlín presencial, impulsado el fintech — 12 posiciones
   repuntuadas").

**Qué haces**: baja el feedback, extrae el patrón (qué le gustó / qué ocultó /
qué marcó como favorito), tradúcelo en prioridades para los Scouts y — si está
justificado — en un re-score acotado. Luego reporta y espera a que el usuario
cambie de modo. **Con C-25**: calibración hecha + margen → el excedente vuelve
al sourcing (ahora con la prioridad NUEVA) salvo prohibición. **NO hagas**:
repuntuar toda la DB, inventar preferencias que el feedback no muestra, ni
seguir haciendo sourcing con la puntería vieja.

## `saving` — risparmio (ahorro: mínimo de supervivencia)

1. **Colas activas**: ninguna autónoma. Solo lo que el usuario pida
   explícitamente: respuestas de chat, tickets (C-15), flags dirigidos por el
   usuario (write/geocode/recheck solicitados — esos nunca pasan por una
   policy).
2. **Suspendido**: el sourcing Y todo enriquecimiento autónomo (recheck,
   geocode, logo). Los workers que no hagan falta para peticiones de usuario
   pendientes se matan o no se spawnean.
3. **Prioridad de presupuesto**: casi cero. El único gasto es responder al
   usuario.
4. **Condición de salida**: `mode_until`, si el usuario la puso — en esa fecha
   la modalidad caduca **sola**, órdenes incluidas, y el equipo vuelve a
   `search` (el fichero sigue diciendo `saving`: gana la fecha límite, y el
   banner lo declara). Sin `mode_until` dura hasta que el usuario lo levante, y
   conviene decirlo: el presupuesto semanal es una **ventana, no un saldo** —
   lo que no se gasta en el reset se destruye, así que un ahorro dejado por
   inercia no conserva el ciclo, lo tira. Dile al usuario que puede ponerle un
   final.

**Qué haces**: mantén reactivos a Capitano/Assistente/Mentor; nada más se mueve
sin una petición directa del usuario. **Con C-25**: ahorro ES una prohibición
explícita del usuario sobre el gasto autónomo — aquí C-25 NO desbloquea el
sourcing; si el presupuesto se está desperdiciando, se lo DICES al usuario (esa
es la otra mitad de C-25), no lo gastas. **NO hagas**: reinterpretar "mínimo"
como "un poco de sourcing no hace daño".

---

## Reglas transversales a los modos

- **C-25 (nunca desperdiciar el presupuesto)** se compone con todos los modos:
  trabajo propio del modo TERMINADO + margen → el trabajo útil por defecto es
  el sourcing al pace de 1 Scout — salvo donde el modo o el usuario prohíban
  explícitamente el gasto (ahorro; una prohibición explícita del tablón), donde
  la jugada correcta es reportar el presupuesto sobrante. C-25 nunca anula un
  freno: los cap weekly/diarios, `work_phase=OFF`, los gate de C-23 y los
  throttle del usuario ganan todos.
- **Los gate de pacing son independientes del modo**: ningún modo autoriza un
  burst ni ignorar `vel_target`; un modo solo cambia ADÓNDE va el presupuesto
  dosificado.
- **Salida ≠ cambio.** Cuando un modo reporta su trabajo agotado, avisa al
  usuario y sigue respetando el modo hasta que sea ÉL quien lo cambie. El
  archivo lo escribe la consola del juego en nombre del usuario — nunca tú.

## Véase también

- `mode_banner.py` (`shared/skills/`) — compone el banner horario desde el
  disco; `python3 /app/shared/skills/mode_banner.py show` lo relee a demanda.
- **C-18** en tu archivo de identidad — la regla completa del modo cuidado.
- `sentinel-orders`, `pipeline-triage`, `scaling-calc` — las palancas que cada
  modo apunta a colas distintas.
