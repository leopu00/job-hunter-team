<!-- @translation: es, ai-translated 2026-06-20 -->
---
name: email-monitor
description: "Sourcing al inicio del dia desde el buzon de correo DEDICADO del equipo (el usuario os reenvia sus propias alertas de empleo). La fuente de mayor precision: la alerta ya viene pre-filtrada segun la intencion del usuario. Poll IMAP de CUALQUIER plataforma (LinkedIn/Glassdoor/Indeed + boards nacionales/de ciudad/de nicho), crea posiciones con el tag source, idempotente por Message-ID. El VOLUMEN lo equilibra el Capitan (C-16): al inicio de la jornada se lee el email ANTES del scraping web; ante un flood se ingieren solo las relevantes, asi el funnel llega al SCORE."
allowed-tools: Bash(python3 /app/shared/skills/email_monitor.py *), Bash(python3 /app/shared/skills/scout_dedup.py *), Bash(python3 /app/shared/skills/db_insert.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# email-monitor — leer las alertas de empleo reenviadas, al inicio de la jornada

El usuario crea un email **dedicado** (ej. `nombre.jht@gmail.com`) y configura en
su propio cliente unas **reglas de reenvio** que nos mandan las alertas de empleo
(LinkedIn, Glassdoor, Indeed **y cualquier otra plataforma** que notifique por
correo). Tu lees ese buzon y transformas las alertas en posiciones. Es la fuente
mas **precisa** (la alerta ya viene filtrada segun el target del usuario) y la mas
**economica en tokens** (sin scraping a ciegas).

> 📍 **Opcional pero recomendada.** Si no esta configurada, el equipo trabaja como
> antes (web sourcing). Sin bloqueo.

## Cuando

- **Al inicio de la ventana de trabajo** (day-start): lee el email **ANTES** del
  scraping web. Las alertas nocturnas ya estan ahi.
- Luego como mucho cada ~30 min (el IMAP del lado servidor rate-limita mas alla, y
  no llegan nuevas alertas con mayor frecuencia). No hagas poll mas a menudo.
- Claim de la fuente en STEP 0 (`scout-coord`): `scout_workspace.py claim
  <agent> email:<box>` — un solo Scout por buzon, sin colisiones.

## Procedimiento

### 1. ¿Esta configurada?
```bash
python3 /app/shared/skills/email_monitor.py status
```
`configured=false` → el buzon no existe: salta, haz web sourcing normal.
`any_platform=true` significa que procesamos **toda** la inbox dedicada (ningun
`from_filters` restringido) → se lee cada remitente que el usuario reenvia.

### 2. Estima el VOLUMEN (economico, sin body fetch)
```bash
python3 /app/shared/skills/email_monitor.py count
```
Retorna `new_total` + `by_sender`. Te sirve a **ti y al Capitan** para entender si
es un volumen manejable o un **flood**. Ante un flood, **el Capitan (C-16) te dice
cuantas / cuales** ingerir: el objetivo es que las posiciones lleguen a un
**score**, no acumular 200 nunca evaluadas.

### 3. Poll → leads
```bash
python3 /app/shared/skills/email_monitor.py poll --since-days 1
```
Cada linea JSONL es un lead: `{"url","source","subject","sender","received_at"}`.
- `source` = `linkedin-email` / `glassdoor-email` / `indeed-email` para los
  providers conocidos, `email:<domain>` para cualquier otra plataforma (extraccion
  generica).
- La idempotencia (Message-ID en `state/email_monitor_seen.json`) garantiza que un
  re-run **no** reprocese las mismas alertas.

### 4. Por cada lead → los 5 gate de `position-insert`
Trata cada `url` **exactamente como un hit web**: dedup (`scout_dedup.py`) →
verifica link activo → fetch JD → 4 filtros Scout → INSERT en `positions`
(`status=new`). **Manten el tag `--source`** del lead (`linkedin-email`,
`email:<domain>`): es lo que hace **medible la precision por fuente** en el
dashboard. JD obligatoria (SC-02): si no logras recuperarla, no la inventes.

## Equilibrado (criterio del Capitan, C-16)

Leer es gratis (`poll`/`count`), **procesar** hasta el score cuesta. El decisor es
el Capitan, no una formula:
- Volumen razonable → procesalas todas (mas senal es mejor).
- Flood → lleva adelante solo las **relevantes**, con dos criterios desde los solos
  metadatos (gratis): **(1) match con el perfil/target** del usuario
  (rol/keyword en el `subject`/titulo) y **(2) frescura** (`received_at` mas
  reciente). Las demas se retoman en las ventanas siguientes.
- Objetivo: las posiciones **llegan a un score**, no se acumulan sin evaluar. Sin
  umbrales fijos — el Capitan decide cuantas segun el presupuesto.

## Anti-patrones

- ❌ Hacer poll mas a menudo de ~30 min (rate-limit IMAP, ninguna alerta nueva).
- ❌ INSERT sin JD completa (SC-02) o sin el tag `source`.
- ❌ Crear en avalancha ante un flood ignorando el criterio del Capitan (C-16): se
  hincha la cola de posiciones que nunca llegaran a un score.
- ❌ Saltarse el dedup (SC-05): las mismas alertas se repiten cada dia.

## Ver tambien

- `position-insert` — los 5 gate de INSERT (tu flujo estandar).
- `scout-coord` — claim de la fuente `email:*` al boot (anti-colision).
- `circles-and-sources` — el sourcing web, a hacer DESPUES del email al inicio de la jornada.
