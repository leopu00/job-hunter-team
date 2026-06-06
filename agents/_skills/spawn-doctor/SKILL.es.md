<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: spawn-doctor
description: Genera un DOTTORE nuevo bajo demanda cuando tu (Capitano/Assistente/Sentinella/Mentor) necesitas una ronda de health-check inmediata. Usa esta skill EN LUGAR DE escribir en la sesion DOTTORE cuando el usuario pide "fai partire il dottore" / "dottora" / "controlla il team", porque entre rondas programadas la sesion DOTTORE es bash residual (ciclo de vida one-shot, ~10 min activos + ~110 min durmiendo hasta el proximo spawn del ciclo de 2h).
allowed-tools: Bash(/app/.launcher/spawn-doctor.sh *), Bash(tmux *), Bash(jht-tmux-send *)
---

# spawn-doctor — llamada de emergencia al Dottore

## Por que existe

El **doctor-watchdog** genera automaticamente un DOTTORE cada 2 horas
(cadencia elegida el 2026-05-18 para reducir el desperdicio de tokens:
12 spawn/dia en lugar de 48). Entre un spawn y el siguiente, la sesion
tmux `DOTTORE` existe pero es "bash residual" (el Dottore anterior se
autodestruyo al terminar su ronda). Enviar un `[URG]` o `[HEALTH]` a
esa sesion es **inutil**: el mensaje termina en la bash y nadie lo lee.

Caso clasico (post-mortem `2026-05-18-capitano-zombie-night`):
el Assistente envio 2 URG al Dottore a las 06:08/06:09 porque el
usuario lo habia pedido, pero el Dottore anterior se habia
autodestruido a las 05:48 → 2 URG perdidos en el vacio, el Capitano
permanecio zombie otros ~20 min hasta que el Assistente entendio que
debia actuar directamente.

Esta skill cierra el loop: en lugar de "hablar con un Dottore muerto",
**genero uno nuevo** de inmediato.

## Quien puede usarla

Los 4 agentes coordinadores long-lived:
- 👨‍✈️ **Capitano** — cuando detecta workers zombie y quiere una segunda
  opinion antes de hacer respawn el mismo.
- 💬 **Assistente** — cuando el usuario pide "fai partire il dottore" o
  "controlla il team" via Telegram/chat.
- 🧙‍♂️ **Mentor** — cuando en un digest semanal detecta patrones anomalos
  y quiere una verificacion de salud de la infraestructura.
- 💂 **Sentinella** — cuando un agente deja de consumir tokens
  inesperadamente en plena ventana productiva.

Los demas agentes (Scout, Analista, Scorer, Scrittore, Critico) **NO**
tienen esta skill: si ven un problema, lo reportan al Capitano via
`[REPORT]` y dejan la decision a el.

## Como usarla

```bash
# Spawn one-shot. El script es idempotente: mata cualquier DOTTORE* existente
# antes de crear uno nuevo, asi que puedes llamarlo sin miedo a
# duplicados.
bash /app/.launcher/spawn-doctor.sh
```

Output esperado:
```
[spawn-doctor] killing old session: DOTTORE     (si existe)
[spawn-doctor] DOTTORE avviato — workdir=/jht_home/agents/dottore — round=YYYYMMDDTHHMMSSZ-spawn
```

El nuevo DOTTORE LLM (Codex/Kimi/Claude segun `active_provider`)
arranca en ~6-10 segundos, lee `AGENTS.md` (= prompt del Dottore), e
inicia la ronda de health-check. Se autodestruye al final.

## Despues del spawn — interactua a traves del Dottore (no por tu cuenta)

```bash
# 1. Spawn
bash /app/.launcher/spawn-doctor.sh

# 2. Espera 8-12s a que el LLM este listo para recibir
sleep 10

# 3. Envia un [REQ] dirigido (el Dottore hara su procedimiento estandar,
#    pero puedes orientarlo si tienes una sospecha precisa).
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Round mirato: il Capitano non risponde da
   ~30 min, capture-pane mostra solo bash. Verifica e respawn se zombie.
   Riporta a me con [RES] alla fine."

# 4. Espera [RES] del Dottore (~10 min budget estandar) — sin polling
#    agresivo. El Dottore mismo registrara eventos en
#    /jht_home/logs/dottore-actions.jsonl cuando actue.
```

## Cuando NO usarla

- ❌ Worker zombie y tu eres el **Capitano**: haz respawn directamente via
  skill `spawn-agent` + kick-off resume. No hace falta molestar al Dottore.
  El Dottore es para problemas que requieren LLM de alto nivel
  (diagnostico de token spike, deadlock sutil, prune cache cross-system).
- ❌ Loop de peticiones: si ya hiciste `spawn-doctor` en los ultimos
  15 min, espera. Generar un nuevo Dottore mientras el anterior aun
  esta trabajando lo mata (el script es idempotente con
  `kill-session` al inicio) — perderas tiempo y presupuesto.
- ❌ Sin razon concreta: el Dottore cuesta ~3-5% del presupuesto Kimi por
  ronda. No lo generes "para verificar si todo va bien" — ya existe el
  doctor-watchdog cada 2h para eso. Generalo cuando tengas un evento
  especifico que investigar.

## Anti-patterns

- ❌ `jht-tmux-send DOTTORE "[URG] ..."` sin antes generar — exit 0
  pero mensaje perdido en la bash residual. Error historico observado
  2026-05-18 06:08-06:09 UTC.
- ❌ Generar manualmente con `tmux new-session -d -s DOTTORE` — omite
  el prompt sync `AGENTS.md` + log JSONL + cleanup. Usa SIEMPRE
  `spawn-doctor.sh`.
- ❌ Esperar que el Dottore resuelva un task no-health (ej. "scrivi
  un CV"). El Dottore es single-purpose: liveness + cache-prune +
  py-tools-audit + cv-disk-audit. Nada mas.

## Ver tambien

- `agents/dottore/dottore.md` — prompt del Dottore, lifecycle one-shot
- `agents/_skills/liveness-check/SKILL.md` — diagnostico que el Dottore ejecuta
- `.launcher/spawn-doctor.sh` — script idempotente (rev. legacy 2026-05-08)
- `.launcher/doctor-watchdog.sh` — loop cadencia 2h (post-mortem 2026-05-18)
- `docs/sessions/2026-05-18-capitano-zombie-night/README.md` — caso que origino esta skill
