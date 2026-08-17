<!-- @translation: es, ai-translated 2026-06-06 -->
# 🧭 Job Hunter — Arquitectura del equipo

---

## 🧠 Como se clasifican los agentes por nivel

JHT asigna cada rol a uno de **cuatro niveles**, listados de mayor a menor. El nivel indica el modelo + el esfuerzo de razonamiento que el launcher pasa a la CLI del proveedor activo.

| Nivel | Agentes | Claude | Codex | Kimi | Que hace |
|---|---|---|---|---|---|
| 🥇 **very smart** | 👨‍✈️ Captain | `opus-4-7` · effort `high` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Decisiones criticas e irreversibles — maxima profundidad de razonamiento |
| 🥈 **expert** | 👨‍🏫 Writer · 👨‍⚖️ Critic · 🧙‍♂️ Mentor | `opus-4-7` · effort `medium` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Pattern-matching contra plantillas conocidas (CV, revision ciega, analisis de brechas) |
| 🥉 **smart** | 🕵️ Scout · 👨‍🔬 Analyst · 👨‍💻 Scorer · 👩‍💼 Assistant | `sonnet-4-6` · effort `high` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Investigacion, scraping, scoring, chat con el usuario |
| 🎖️ **medium** | 💂 Sentinel | `sonnet-4-6` · effort `medium` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Watchdog ligero — reglas if-then, sin razonamiento profundo |

**Niveles de effort disponibles (para referencia):**

- **Claude** — `low · medium · high · xhigh · max` (Opus 4.7, Apr 2026). `xhigh`/`max` no utilizados por ahora — compromiso de costes.
- **Codex** — `minimal · low · medium · high · xhigh` (GPT-5.5). Default `medium`.
- **Kimi** — la CLI aun no expone niveles de effort, asi que todos los niveles convergen en una sola llamada.

---

## 🗺️ Pipeline de un vistazo

```
   👤 User
     │
     ▼
   👨‍✈️ Captain ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──────► Phase 5 ──► 👤 User
                  🕵️ Discover  👨‍🔬 Verify  👨‍💻 Score   👨‍🏫 👨‍⚖️ Write+Review   📲 Notify
```

Cada fase a continuacion corresponde a un rol de agente especializado. El Captain decide **cuantas instancias** lanzar por rol en cada momento — la cantidad de agentes es dinamica, no esta fijada en la arquitectura.

---

## 1️⃣ Phase 1 — Discovery 🔍 🕵️

```
        👤 candidate_profile.yml ──┐
                                    │ circles, filters, work_mode
                                    ▼
        ┌──────────────────────────────────────┐
        │ 🕵️ Scout pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (no overlap on       │
        │ circles / sources / URLs)             │
        └────────────────────┬─────────────────┘
                             │ INSERT positions  (status = new)
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │ ──► Phase 2
                       └──────────────┘
                             ▲
                             │ [FEEDBACK]
                             │ (rejection patterns:
                             │  SENIORITY · STACK · GEO · LINGUA)
                             └── from 👨‍🔬 Analyst / 👨‍💻 Scorer
```

**Que hacen los Scout.** Extraen ofertas de empleo de job boards y ATSs, deduplican contra `jobs.db` y escriben las posiciones nuevas con `status = new`. Se detienen cuando el Captain lo ordena.

### 🤝 Coordinacion multi-scout

Multiples Scouts corren en paralelo sin obtener nunca la misma oferta dos veces:

- 🗺️ **Particion al boot** — los peers se descubren mutuamente via `tmux list-sessions`, luego negocian territorio a traves de `scout_coord.py` (que **circles** y **sources** posee cada uno).
- 🎯 **Circles** — ambitos concentricos, agotados de dentro hacia fuera: ① preferencia primaria → ② vecinos geograficos → ③ reubicacion dirigida → ④ satelite → ⑤ frontera (roles adyacentes).
- 📚 **Source tiers** — drenados en orden: LinkedIn → agregadores ATS (Greenhouse/Lever/Indeed/Wellfound) → boards de nicho (PyJobs, RemoteOK, regionales) → WebSearch + paginas de carreras.
- ⚖️ **Anti-bias** — si mas del 30% de las posiciones de un batch provienen del mismo empleador, el Scout cambia source/query para el siguiente batch. Sin este mecanismo, una scaleup que publica 12 roles en un solo board inundaria el pool, ahogando la diversidad.
- 🛡️ **Anti-collision** — verificacion de deduplicacion en `positions.url` antes de cada `INSERT` ([`anti-collision.md`](../_manual/anti-collision.md)).

### 🔁 Escucha del feedback

Los Scout reciben mensajes `[FEEDBACK]` de los Analyst (e indirectamente de los Scorer via el Captain) etiquetados con `[SENIORITY] · [STACK] · [GEO] · [LINGUA]`, y ajustan queries/sources para el siguiente batch. Los sesgos sistemicos se escalan al Captain.

### 🛠️ Skills

Disponibles bajo `/app/shared/skills/`:

- **`scout_coord.py`** — particion de territorio al boot (que Scout posee que circle/source); usado para negociar propiedad y verificar la asignacion.
- **`db_query.py check-url`** — gate de deduplicacion. Se ejecuta antes de cada insert; devuelve `TROVATA` (skip) o `NON TROVATA` (proceder).
- **`db_insert.py position`** — escribe una oferta verificada en `positions`. Campos obligatorios: title, company, URL, location, texto JD, requisitos.
- **`db_update.py position`** — usado para marcar registros ya insertados como `excluded` cuando un duplicado se escapa. Nunca DELETE.
- **`linkedin_check.py`** — enriquecimiento autenticado en LinkedIn (job IDs → metadatos completos de la oferta) sin activar el bloqueo robots de `fetch` MCP.

### 🌐 MCP tools

- **`jobspy`** — scraper multi-source para job boards (LinkedIn, Indeed, ZipRecruiter, Glassdoor) encapsulado como MCP. Descubrimiento rapido en bulk, salida normalizada.
- **`linkedin`** — MCP dedicado a LinkedIn para busqueda + obtencion de ofertas.
- **`fetch`** — fetch HTTP generico para paginas de agregadores ATS (Greenhouse, Lever, Wellfound). ⚠️ Bloqueado por el robots.txt de LinkedIn — los Scout recurren a `curl` con user-agent de navegador alli.
- **`playwright`** — navegador headless para paginas de carreras JS-heavy donde el simple `fetch` no renderiza el DOM.
- **`WebSearch`** *(built-in)* — fallback de nivel 4 cuando ATSs/boards de nicho estan agotados.

---

## 2️⃣ Phase 2 — Verification ✅ 👨‍🔬

```
                       📦 jobs.db
                       (status = new)
                              │
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍🔬 Analyst pool                      │
        │ N instances · Captain-managed         │
        │ peer-coordinated (last_checked        │
        │ timestamp prevents double-work)       │
        └────────────────────┬─────────────────┘
                             │ UPDATE positions
                             │   status = checked   → Phase 3
                             │   status = excluded  → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
                             │
                             │ [FEEDBACK]
                             │ (rejection patterns:
                             │  SENIORITY · STACK · GEO · LINGUA …)
                             ▼
                        🕵️ Scout pool
```

**Que hacen los Analyst.** Toman las posiciones con `status = new`, obtienen la JD en vivo, validan el enlace, analizan 5 campos estructurados (`ESPERIENZA_RICHIESTA · ESPERIENZA_TIPO · LAUREA · LINGUA_RICHIESTA · SENIORITY_JD`), y las promueven a `checked` o las marcan como `excluded`. Los anios reales se calculan a partir de las entradas fechadas en el perfil, no del campo redondeado `experience_years`. El candidato se trata como **adaptable** — stacks adyacentes no se excluyen, el Scorer aplica una penalizacion proporcional de brecha mas adelante.

### 🚫 Etiquetas de exclusion

Las notas de exclusion comienzan con `ESCLUSA: [TAG]` — `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` (`req > real+3` o JD senior/lead) · `[STACK]` (fuera de dominio). Cuando hay incertidumbre → `checked`: los falsos negativos cuestan mas que los falsos positivos.

### 🤝 Coordinacion multi-analyst

- 🕒 **Watermark `last_checked`** — los Analyst saltan registros actualizados recientemente por un peer.
- 🛡️ **Contrato anti-collision** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Feedback a los Scout

Cuando 3 exclusiones consecutivas afectan la misma source con la misma etiqueta, o el batch de un Scout supera el 60% de tasa de rechazo, el Analyst envia un `[FEEDBACK]` a ese Scout — especifico (source + tag + IDs), accionable (alternativa sugerida), idempotente (uno por patron).

### 🛠️ Skills

- **`db_query.py next-for-analista`** — obtiene la siguiente posicion `status=new` respetando el watermark `last_checked`.
- **`db_query.py position <ID>`** — obtiene JD completa + metadatos para el analisis.
- **`db_update.py position <ID>`** — escribe el nuevo status (`checked` o `excluded`) + notas estructuradas.
- **`linkedin_check.py`** — verificacion autenticada en LinkedIn (activo / expirado / info de la empresa).

### 🌐 MCP tools

- **`fetch`** — GET de la JD en vivo con `-L` + browser UA; detecta marcadores "expired / closed-job".
- **`playwright`** — fallback para paginas ATS JS-heavy que `fetch` no puede renderizar (Workable/Lever/Ashby).
- **`linkedin`** — omitido: las verificaciones de LinkedIn pasan por `linkedin_check.py` (autenticado).

---

## 3️⃣ Phase 3 — Scoring 🎯 👨‍💻

```
                       📦 jobs.db
                       (status = checked)
                              │
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍💻 Scorer pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (last_checked < 5min │
        │ = peer claimed → skip)                │
        └────────────────────┬─────────────────┘
                             │ INSERT scores · UPDATE positions
                             │   score ≥ 50  → status = scored   → Phase 4
                             │   score 40-49 → status = scored   (parking)
                             │   score < 40  → status = excluded → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
                             │
                             │ score distribution
                             │ (high-score zones → Scout queries)
                             ▼
                        🕵️ Scout pool  (via 👨‍✈️ Captain)
```

**Que hacen los Scorer.** Ejecutan un **pre-check** (anios de experiencia, ubicacion, titulo obligatorio sin "o equivalente") para filtrar posiciones no evaluables, luego asignan una puntuacion 0-100 contra el perfil del candidato. `< 40` → `excluded`. `40-49` → `scored` (parking, el Captain decide despues). `≥ 50` → `scored` + notificacion a los Writer.

### 🧮 Formula de scoring (0-100)

| Componente | Peso | Columna DB | Que mide |
|---|---|---|---|
| Stack match | 35 | `stack_match` | Skills requeridas vs stack del candidato |
| Seniority fit | 25 | `experience_fit` | Anios requeridos vs anios reales del candidato |
| Remote / location | 20 | `remote_fit` | Compatibilidad con las preferencias de ubicacion del perfil |
| Salary fit | 10 | `salary_fit` | Rango ofrecido vs objetivo |
| Stack bonus | 10 | `strategic_fit` | Bonus tecnologico (AI · cybersec · fintech, si son areas fuertes del candidato) |

Penalizaciones aplicadas encima: `−10` titulo obligatorio sin "o equivalente" · `−15` idioma obligatorio no hablado · `−5` JD vaga sin requisitos concretos.

### 🤝 Coordinacion multi-scorer

- 🕒 **Claim `last_checked`** — el Scorer marca el timestamp antes de evaluar; los peers saltan registros reclamados en los ultimos 5 minutos.
- 🛡️ **Limite de escritura DB** — el Scorer escribe `scores` (INSERT) y solo `positions.status`. Nunca toca `applications`, `companies`, o `positions.notes` (territorio del Analyst).
- 🛡️ **Contrato anti-collision** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Feedback a los Scout (via Captain)

La distribucion en vivo de puntuaciones del Scorer (por source / rol / geo / stack) es leida por el Captain y retransmitida a los Scout, para que los siguientes batches se concentren en las zonas de alta puntuacion del candidato.

### 🛠️ Skills

- **`db_query.py next-for-scorer`** — obtiene la siguiente posicion `status=checked` respetando `last_checked`.
- **`db_query.py position <ID>`** — registro completo + notas estructuradas del Analyst (las entradas de la formula).
- **`db_insert.py score`** — escribe el desglose (5 componentes + total).
- **`db_update.py position <ID>`** — establece `status = scored | excluded`.

### 🌐 MCP tools

- **`fetch`** — re-valida el enlace antes del scoring (las ofertas mueren rapido — la Phase 2 puede haber sido hace un tiempo).

---

## 4️⃣ Phase 4 — Writing + Review ✍️ 👨‍🏫 👨‍⚖️

```
                       📦 jobs.db
                       (status = scored, score ≥ 50)
                              │  selection: ≥70 first, then 50-69 desc
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍🏫 Writer pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (status=writing      │
        │ claim prevents double-work)           │
        └────────────────────┬─────────────────┘
                             │ for each position:
                             │   3× rounds with a fresh Critic
                             ▼
        ┌──────────────────────────────────────┐
        │ 👨‍⚖️ Critic (CRITICO-S<N>)            │
        │ spawned fresh per round, killed after │
        │ blind review — no profile access      │
        └────────────────────┬─────────────────┘
                             │ critic_score 1-10
                             │ after round 3:
                             │   score ≥ 5 → status = ready    → Phase 5
                             │   score < 5 → status = excluded → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
```

**Que hacen los Writer.** Toman las posiciones `status = scored` en orden descendente de puntuacion (primero las ≥70, luego las 50-69), las reclaman estableciendo `status = writing`, generan un CV personalizado (Cover Letter solo si la JD la pide), y ejecutan **3 rondas obligatorias** con el Critic. Entre rondas el Writer corrige el CV y regenera el PDF. Gate final: `critic_score ≥ 5` → `ready`, si no `excluded`. **Zero invenzioni** — cada afirmacion en el CV debe ser rastreable hasta `candidate_profile.yml`.

**Que hace el Critic.** Creado desde cero para cada ronda (`CRITICO-S<N>`), recibe la ruta del PDF + URL de la JD, realiza una **revision ciega** (sin acceso al perfil — solo la pagina que tiene delante), devuelve un veredicto estructurado: voto X/10 + analisis de estructura/relevancia/impacto + tabla requisitos-vs-CV + acciones priorizadas. Eliminado despues de cada revision — nunca reutilizado. Usa la escala completa 1-10; sin votos de cortesia.

El loop Writer ↔ Critic es la fase de mayor consumo de tokens. Ambos estan en el nivel **expert** (modelo top + effort medio) — la tarea esta bien definida, no requiere razonamiento exploratorio.

### 🤝 Coordinacion multi-writer

- 🛡️ **Claim `status = writing`** — los Writer cambian el status antes de escribir; los peers saltan registros ya reclamados.
- 🚫 **Anti-rewriting** — si `critic_verdict` ya esta establecido, **skip absoluto** (el veredicto es final, sin re-revision).
- 📡 **Limite de escritura DB** — el Writer toca solo `positions.status` y `applications`; nunca `scores`, `companies`, `positions.notes`.

### 🛑 Captain freeze

Cuando el Sentinel senala saturacion de rate-limit, el Captain envia `[URG] FREEZE` a los Writer. Completan la ronda actual si estan a mitad del loop (nunca abandonan un Critic a mitad de revision), luego duermen hasta que el throttle vuelve a T0/T1.

### 🛠️ Skills

- **`db_query.py next-for-scrittore`** — obtiene la siguiente posicion en orden descendente de puntuacion.
- **`db_update.py position`** — cambia `status = writing | ready | excluded`.
- **`db_insert.py application`** — registra la candidatura + rutas CV/PDF.
- **`db_update.py application`** — guarda `critic_score · critic_verdict · critic_round · critic_notes` por ronda.
- **`pandoc`** — convierte el CV markdown a PDF via motor Typst.

### 🌐 MCP tools

- **`fetch`** — re-valida el enlace de la JD antes de escribir; el Critic usa el mismo MCP para leer la JD en vivo.
- **`WebFetch`** / **`WebSearch`** — fallback cuando `fetch` no puede alcanzar la JD (bloqueos LinkedIn / robots.txt).

---

## 5️⃣ Phase 5 — Notify 📲

```
                       📦 jobs.db
                       (status = ready)
                              │
                              ▼
                    👨‍✈️ Captain receives [RES]
                    from Writer (PDF + verdict)
                              │
                              ▼
                       📲 Telegram bot
                    (position · CV PDF · job link)
                              │
                              ▼
                         👤 User
                          ① reads the CV
                          ② sends feedback to 👨‍✈️ Captain
                          ③ applies manually using the link
                              │
                              ▼
                       📦 jobs.db
                       (status = applied — set by user)
```

**Que ocurre.** Cuando un Writer cierra la Phase 4 con `verdict = PASS` y `status = ready`, el Captain recibe un mensaje `[RES]` con el PDF y el veredicto. Se envia un mensaje de Telegram al usuario con el titulo de la posicion, la empresa, el CV PDF generado y el enlace a la oferta.

**Por que el paso de candidatura es completamente manual.** El usuario lee el CV, juzga la compatibilidad por si mismo, envia feedback al Captain (`el tono no encaja` · `falta esta experiencia` · `bien — me postulo` · ...), y **solo entonces decide si postularse** — usando el enlace que ya tiene. Este checkpoint humano es intencional: mantiene JHT como un coach para el trabajador, no un canon que dispara candidaturas de bajo esfuerzo hacia los reclutadores. El volumen del lado del reclutador solo tiene sentido si el trabajador lo eligio.

**Actualizacion de status.** Cuando el usuario se postula, la posicion se marca `status = applied` manualmente (respuesta de Telegram o boton "Me postule" en el web dashboard), con `applied_via = telegram | web | manual`. El ciclo opcional `response` (`interview` · `rejected` · `ghosted`) tambien lo rastrea el usuario.

### 🛠️ Skills / tools

- **`.launcher/tg-bridge.py`** — bridge de Telegram (Python): notificaciones salientes y feedback / actualizaciones de estado del usuario entrantes, un bot por rol user-facing.
- **`positions.applied`** — flag DB cambiado por el usuario (nunca automaticamente por el equipo).

---

## 🎮 Orquestacion de la pipeline

La pipeline no es una configuracion estatica de N instancias por rol: es un **loop guiado por feedback** que el Captain gestiona dinamicamente segun el flujo, la profundidad de las colas y el presupuesto del usuario. Los numeros a continuacion son ilustrativos, no normativos.

### 🥾 Cold start — llenar el embudo

Cuando la pipeline arranca desde cero, la prioridad es alimentar las colas downstream rapido:

```
   T=0       →  3× 🕵️ Scout                                    (flood the funnel)
   T+ a bit  →  2× 🕵️ Scout · 1× 👨‍🔬 Analyst                    (first offers to verify)
   T+ more   →  2× 🕵️ Scout · 1× 👨‍🔬 Analyst · 1× 👨‍💻 Scorer    (first verified ready to score)
```

Si el Analyst se queda atras respecto a los Scout, el Captain rebalancea al vuelo: `+1 Analyst · −1 Scout`. La misma logica fluye downstream.

### 🔁 Feedback loop — busqueda auto-afinada

El primer batch procesado por cada rol downstream es **dorado** — son los datos que el agente downstream usa para instruir al upstream:

- **👨‍🔬 Analyst → 🕵️ Scout** — tras un primer batch significativo, el Analyst senala patrones de rechazo (empresas que cierran ofertas rapido, boards de estafa, formas de JD que siempre fallan la verificacion). Los Scout los saltan upstream.
- **👨‍💻 Scorer → 🕵️ Scout** — una vez que el Scorer ha visto una muestra, sabe que roles/stacks/geografias puntuan alto. Retransmite la distribucion para que los Scout busquen mas cerca de las zonas de alta puntuacion.

Resultado: en cada ciclo, los Scout encuentran mejores ofertas, los Analyst rechazan menos ofertas buenas, los Scorer ven distribuciones de puntuacion mas altas. El equipo se convierte en un **sistema auto-afinado**.

### 🎯 Gate de activacion del Writer

Los loops Writer + Critic son la parte mas costosa de la pipeline (modelo top-tier, revision iterativa). Se **alternan** — el Writer espera mientras el Critic revisa y viceversa — asi que un par Writer + Critic cuesta aproximadamente **un agente continuo**, no dos.

Para evitar gastar esos tokens en ofertas mediocres, el Captain condiciona la activacion de los Writer a la profundidad de la cola con alta puntuacion:

1. Ordena las posiciones en cola por puntuacion descendente.
2. Espera hasta que se hayan acumulado suficientes ofertas de alta puntuacion (ej. **10+ ofertas con score ≥ 75**).
3. Lanza los Writer — siempre empiezan por la posicion con la puntuacion mas alta en cola.

### 💰 Throttling budget-aware

Todos los conteos de instancias y umbrales de gate se adaptan al presupuesto mensual del usuario y a la senal de uso en vivo del side-channel [📡 Bridge → 💂 Sentinel](#-side-channel--usage-monitoring). Un bootstrap agresivo con un presupuesto ajustado se ralentiza antes de que comience la escritura de calidad — mejor saltarse algunas ofertas que quemar el presupuesto en Discovery y no tener nada para Writing.

---

## 📡 Side-channel — Monitoreo de uso

Fuera de la pipeline. Corre continuamente en paralelo.

```
   ┌────────────┐  every tick  ┌────────────┐  notify on edge  ┌────────────┐
   │ 📡 Bridge  │ ───────────► │ 💂 Sentinel│ ───────────────► │ 👨‍✈️ Captain│
   │ (process,  │ usage + proj │ tier:      │  only on real    │            │
   │  not Claude│              │  medium    │  state changes   │            │
   │  agent)    │              │ event-     │                  │            │
   └────────────┘              │ driven     │                  └────────────┘
                               └────────────┘
```

**Bridge.** Un proceso no-AI que consulta la CLI de cada agente para el uso actual y el agotamiento proyectado. Envia un tick al Sentinel.
**Sentinel.** Edge-triggered: ingiere cada tick pero habla con el Captain *solo* cuando algo realmente cambia (pico de uso, violacion de la proyeccion, crash de un agente).
**Captain.** Reacciona — ralentiza, congela el equipo, mata sesiones problematicas — segun la senal del Sentinel.

---

## 🤝 Side-channel — Helpers orientados al usuario

```
                        👤 User
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
       👩‍💼 Assistant  👨‍✈️ Captain   🧙‍♂️ Mentor
       platform      team commander  career coach
       copilot                       (siempre activo)
```

- **👩‍💼 Assistant** — `tier: smart`. Traduce las solicitudes no tecnicas del usuario en ordenes para el Captain. Oculta los detalles de implementacion del chat orientado al usuario.
- **🧙‍♂️ Mentor** — `tier: expert`, **activo** (lo basico ya esta implementado, optimizacion en curso). Career coach: analiza la brecha perfil/resultados, produce un plan de accion, check-ins estrategicos. Orientado al usuario, siempre activo, creado al boot. Carpeta: `agents/mentor/`.

---

## 🩺 Side-channel — Salud y mantenimiento

Fuera de la pipeline. Agentes **one-shot programados**: el watchdog crea cada uno en su slot diario; ejecutan un barrido, reportan al Captain y luego se autodestruyen.

```
   ┌────────────┐  daily slot  ┌──────────────┐  report  ┌────────────┐
   │ watchdog   │ ───────────► │ 🩺 Dottore   │ ───────► │ 👨‍✈️ Captain│
   │ (scheduler)│              │ 👷‍♂️ Mantenitore│  findings │            │
   └────────────┘              └──────────────┘          └────────────┘
                                  one-shot → self-destruct
```

- **🩺 Dottore** — **salud de los agentes**. Refresco de contexto periodico + retrospectiva: detecta sesiones de agente bloqueadas/zombie y las reinicia con contexto fresco (los threads de larga vida que queman contexto provocan un colapso silencioso del throughput). Carpeta: `agents/dottore/`.
- **👷‍♂️ Mantenitore** — **salud de la infra**. Barrido de mantenimiento diario sobre el contenedor/VPS: smoke-test de herramientas criticas para la mision (canary de browser/Playwright), estandarizacion de dependencias (`jht-install`), tendencia de disco/RAM, GC de huerfanos. Una herramienta crucial rota es un P1. Carpeta: `agents/mantenitore/`.

---

## 💬 Comunicacion

```
   ┌──────────┐   tmux send-keys    ┌──────────┐
   │ Captain  │ ◄─────────────────► │ Agents   │
   │          │   [@from -> @to]     │ (one     │
   │          │   MSG / REQ / RES /  │  tmux    │
   │          │   URG                │  session │
   └────┬─────┘                      │  each)   │
        │                            └──────────┘
        │  Telegram bot
        ▼
    📲 User
```

Los mensajes inter-agente usan un sobre etiquetado (`[@scout-1 -> @capitano] [REQ] ...`). Protocolo completo: [`agents/_manual/communication-rules.md`](../_manual/communication-rules.md).

---

## 🔗 Relacionado

- 📋 [`agents/_manual/`](../_manual/) — documentos de referencia operativa consumidos en runtime (esquema DB, protocolo de comunicacion, contrato anti-collision)
- 📜 [`docs/adr/`](../../docs/adr/) — decisiones arquitecturales (CLIs soportadas, single-writer, subscription-only)
