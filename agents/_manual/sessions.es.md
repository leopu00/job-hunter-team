<!-- @translation: es, ai-translated 2026-06-06 -->
# 🪟 Sesiones Tmux

El equipo JHT se ejecuta como un conjunto de sesiones tmux dentro del contenedor. Los nombres de sesion son **mayusculas, sin emoji, sin espacios**.

## 📛 Convencion de nomenclatura

| Pattern | Significado | Ejemplos |
|---|---|---|
| `<ROLE>` | Singleton — una sola instancia | `CAPITANO` · `CRITICO` · `SENTINELLA` · `ASSISTENTE` |
| `<ROLE>-<N>` | Miembro del pool — N es un entero positivo | `SCOUT-1` · `ANALISTA-2` · `SCRITTORE-3` |
| `<ROLE>-S<N>` | Creado dinamicamente por otro agente | `CRITICO-S1` (creado por `SCRITTORE-1`), `CRITICO-S2`, … |

## 📚 Sesiones conocidas

### Sesiones pool (el Capitan decide la cantidad de instancias)

| Prefijo de sesion | Rol | Notas |
|---|---|---|
| `SCOUT-<N>` | Descubrimiento | Multiples instancias, coordinacion peer via `scout_coord.py` |
| `ANALISTA-<N>` | Verificacion | Extrae de `next-for-analista` |
| `SCORER-<N>` | Puntuacion | Extrae de `next-for-scorer` |
| `SCRITTORE-<N>` | Escritura | Extrae de `next-for-scrittore` (score DESC) |

### Singletons

| Sesion | Rol | Notas |
|---|---|---|
| `CAPITANO` | Comandante del equipo | Instancia unica — coordina ordenes, estado, escalaciones |
| `CRITICO` | Critico independiente | Legacy — en V5 el Critico se crea dinamicamente por los Escritores (ver abajo) |
| `SENTINELLA` | Watchdog de consumo | Edge-triggered, habla solo con `CAPITANO` |
| `ASSISTENTE` | Copiloto del usuario | Traduce las solicitudes del usuario en ordenes |
| `MENTOR` | Agente career-coach | Activo — orientado al usuario, siempre activo, creado al boot (lo basico ya esta implementado, optimizacion en curso) |

### Sesiones dinamicas

| Sesion | Creada por | Duracion |
|---|---|---|
| `CRITICO-S<N>` | `SCRITTORE-<N>` (un Critico nuevo por cada ronda de revision) | Una solicitud de revision → una sesion, eliminada por el Escritor inmediatamente despues |
| `DOTTORE` | watchdog (slot diario) | One-shot — barrido de salud de los agentes, reporta a `CAPITANO`, luego se autodestruye |
| `MANTENITORE` | watchdog (slot diario) | One-shot — barrido de salud de la infra, reporta a `CAPITANO`, luego se autodestruye |

El Escritor crea `CRITICO-S<N>` con su mismo numero (`SCRITTORE-1` → `CRITICO-S1`), ejecuta la revision y luego `tmux kill-session`. Se crea una instancia nueva del Critico para **cada** una de las 3 rondas de revision — nunca se reutiliza.

## 🔗 Relacionado

- 💬 [`communication-rules.md`](communication-rules.md) — sobre del mensaje, `jht-tmux-send`, quien debe enviar que
- 🛡️ [`anti-collision.md`](anti-collision.md) — coordinacion peer entre los miembros del pool
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — composicion completa del equipo y mapeo de niveles
