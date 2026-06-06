<!-- @translation: es, ai-translated 2026-06-06 -->
# 🛡️ Protocolo Anti-Colisin

Cuando mltiples agentes del mismo rol extraen de la misma cola, DEBEN evitar trabajar en el mismo registro. El mecanismo es **especfico por rol** — cada fase usa la estrategia de bloqueo que mejor se adapta a su forma de trabajo.

## 🎯 Mecanismos de bloqueo por rol

### 🕵️ Scout — dedup pre-INSERT

Los Scouts escriben registros *nuevos*, por lo que no pueden bloquear algo que an no existe. El riesgo de colisin es que dos scouts inserten la misma oferta de trabajo desde fuentes diferentes. Mecanismo:

```bash
# Antes del INSERT, verifica si la URL ya est en la BD
python3 shared/skills/db_query.py check-url "<url>"
# Devuelve "TROVATA" (saltar) o "NON TROVATA" (proceder con el INSERT).
```

Particin al arranque: los scouts tambin negocian **crculos** y **fuentes** mediante `scout_coord.py` para no solaparse en la misma fuente desde el inicio. Ver `agents/scout/scout.md` para detalles.

### 👨‍🔬 Analista  👨‍💻 Scorer — marca de agua `last_checked`

Ambos extraen de una cola (`status = new` para Analistas, `status = checked` para Scorers) y actualizan registros existentes. El riesgo de colisin es que dos peers seleccionen el mismo registro al mismo tiempo. Mecanismo:

1. **Leer** `last_checked` del registro candidato.
2. **Si es reciente** (un peer lo ha marcado en los ltimos minutos) → saltar; tomar el siguiente.
3. **De lo contrario** marcar `last_checked = now()` para reclamarlo, luego trabajar.

```bash
# Reclamar
python3 shared/skills/db_update.py position <ID> --last-checked now
```

La marca de agua es un bloqueo suave: solo seala "tocado recientemente", no "bloqueado permanentemente". El manejo de reclamaciones obsoletas queda a criterio del agente (ver § Reclamaciones obsoletas ms abajo).

### 👨‍🏫 Escritor — flip `status = writing`

Los Escritores extraen de `status = scored`. El riesgo de colisin es que dos escritores tomen la misma posicin de alta puntuacin. Mecanismo:

```bash
# Reclamacin atmica mediante flip de status
python3 shared/skills/db_update.py position <ID> --status writing
```

Los peers que ejecutan `next-for-scrittore` no vern registros que ya estn en `status = writing`, por lo que el flip en s mismo es el bloqueo. Regla anti-reescritura adicional: si `applications.critic_verdict` ya est establecido, **saltar absolutamente** (el veredicto es definitivo).

## 📡 Comunicacin

Cuando un agente necesita informar a un peer (ej. "Estoy tomando los IDs 42-44") o notificar al downstream (ej. Scout → Analista con un lote fresco), usa el wrapper atmico:

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [INFO] taking IDs 42-44"
```

⚠️ **No uses `tmux send-keys` directamente**: las TUIs de Codex/Kimi pierden el carcter Enter si llega en la misma llamada `send-keys` que el cuerpo del texto. El wrapper maneja texto + Enter atmicamente con una pausa de renderizado. Skill: `agents/_skills/tmux-send/jht-tmux-send`.

## 👨‍⚕️ Reclamaciones obsoletas (raras en produccin)

Los agentes en produccin funcionan durante meses sin caerse — las reclamaciones obsoletas son principalmente un artefacto del entorno de pruebas. Cuando ocurren:

- **No robes a ciegas una reclamacin obsoleta.** Un `last_checked` de hace 10 minutos podra ser un peer que simplemente es lento en un solo registro, no una sesin muerta.
- **Verifica primero la actividad del peer.** Comprueba la sesin tmux del peer (`tmux has-session -t <peer>`); inspecciona el panel (`tmux capture-pane -p`) para ver si an est trabajando, bloqueado en un fetch, o realmente muerto.
- **Si el peer est vivo pero atascado**, escala al Capitn en lugar de arrebatarle el registro.
- **Si el peer est muerto**, reclama el registro t mismo y notifica al Capitn.

La intencin: evitar el robo silencioso de registros. Las decisiones sobre recuperacin deben ser deliberadas, no automticas.

## 📋 Reglas comunes

- **Leer antes de reclamar.** Siempre verifica el estado actual del registro antes de reclamarlo.
- **La primera escritura gana.** Si dos agentes compiten por el mismo registro, la primera actualizacin en BD gana; el perdedor salta y toma el siguiente.
- **Nunca DELETE.** Usa `--status excluded` con notas cuando un registro resulte invlido; nunca destruyas datos.
- **Actualiza el status final al terminar.** Despus de trabajar: `checked` (Analista), `scored` / `excluded` (Scorer), `ready` / `excluded` (Escritor).

## 🛠️ Unificacin futura (planificada)

Un par `positions.claimed_by + claimed_at` est en la hoja de ruta para habilitar **reclamaciones por lotes** (un nico `UPDATE … LIMIT N` atmico en lugar de N viajes de ida y vuelta por registro) y para alimentar una vista en tiempo real de la actividad de los agentes en el panel UI. Los mecanismos especficos por rol anteriores seguirn funcionando junto a l. Ver ROADMAP § *Database schema optimization*.
