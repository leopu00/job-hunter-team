<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: scout-coord
description: Protocolo de coordinación al arranque entre múltiples Scouts. Sin esta skill, dos scouts rastrean el mismo círculo (Remote EU) en el mismo tier (LinkedIn) y producen un 100% de duplicados que la puerta de dedup luego descarta — presupuesto desperdiciado y equipo más lento. Úsala como PRIMERA acción en tu loop, antes que nada. Propiedad del rol Scout; SCOUT-1 normalmente arbitra si varios scouts arrancan simultáneamente.
allowed-tools: Bash(python3 /app/shared/skills/scout_coord.py *), Bash(tmux *), Bash(jht-tmux-send *)
---

# scout-coord — particionar el territorio

Múltiples Scouts se ejecutan en paralelo (máx. 2 instancias por política del equipo). El equipo funciona solo si acuerdan una **partición sin solapamiento** de:
- qué **círculos** posee cada uno (1 = preferencia primaria, 2 = vecinos geográficos, 3 = reubicación, 4 = satélite, 5 = frontera)
- qué **tiers de fuentes** posee cada uno (LinkedIn / agregadores ATS / niche / WebSearch)

El estado se almacena en la **base de datos SQLite compartida** gestionada por `scout_coord.py`; los scouts negocian vía tmux al arranque y persisten el acuerdo allí.

**Una sola base de datos, o ningún coordinamiento.** Todos los Scouts deben estar en el mismo fichero — dos Scouts en dos ficheros no se están coordinando, solo lo creen. `scout_coord.py` resuelve la ruta desde el entorno (`JHT_SCOUT_COORD_DB` si el operador declaró una, si no `$JHT_HOME/data/`) y la crea si falta. Si sale con **3**, la base de datos no es utilizable: informa del mensaje que imprimió y PÁRATE. Nunca crees una base de datos propia, nunca apuntes la herramienta a otra ruta.

```bash
# ¿En qué base de datos estoy realmente?
python3 /app/shared/skills/scout_coord.py doctor
```

## Step 1 — Descubrir peers

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}' | grep -E '^SCOUT-[0-9]+$'
```

Si eres el único scout listado → no se necesita negociación, reclama todo lo que puedas manejar. Salta al Step 4.

Si hay otros → debes negociar (Steps 2-3) antes de hacer cualquier scraping.

## Step 2 — Resetear estado obsoleto

Si el equipo de scouts anterior se cayó a mitad de loop, `scout_coord.py` puede contener asignaciones obsoletas que referencian sesiones muertas. Elimínalas:

```bash
python3 /app/shared/skills/scout_coord.py reset
```

Este es un paso coordinado: el **SCOUT con número más bajo activo** (normalmente `SCOUT-1`) hace el reset, los demás esperan. Anúncialo en tmux:

```bash
jht-tmux-send SCOUT-2 "[@$MY_ID -> @scout-2] [INFO] resetto scout_coord, attendi 5s prima di assign"
```

## Step 3 — Negociar vía tmux

Abre una conversación breve (3-5 mensajes máx.) con cada peer. Propón una división:

```
[@scout-1 -> @scout-2] [REQ] proposta: io prendo cerchi 1+2 + tier 1-2 (LinkedIn, ATS).
Tu cerchi 3+4 + tier 3-4 (niche board + WebSearch). OK?
```

El peer responde con `[ACK]` (acepta) o `[COUNTER]` (contrapropuesta). Sé breve — si no logras un acuerdo en 3 ida y vuelta, escala al Capitano.

**Heurísticas para una buena división**:

| Situación                                       | División sugerida                                                  |
|-------------------------------------------------|--------------------------------------------------------------------|
| 2 Scouts, perfil `work_mode = remote`           | S1: círculos 1-2 + LinkedIn/ATS · S2: círculos 1 + niche remote board (RemoteOK, WeWorkRemotely) — ambos en círculo 1, fuentes complementarias |
| 2 Scouts, perfil `work_mode = on-site`          | S1: ciudad base + círculo 2 regional · S2: reubicación (círculo 3) |
| 2 Scouts, mixto `work_mode = flessibile`        | S1: círculos 1-2 (full mode) · S2: círculos 3-5 (reubicación + satélite + frontera) |

Cualquier división que elijas, la regla es: **dos scouts nunca en la misma combinación (círculo, set_tier) al mismo tiempo.**

**División volumen vs curada — datos empíricos del run VPS1 2026-05-21 (vps1-run-postmortem #14):**

> Scout-1 encontraba 130 positions con score avg 63.1 (40% high-score)
> Scout-2 encontraba 76 positions con score avg 68.4 (54% high-score)
>
> → Scout-2 era 1.4× más cualitativo que Scout-1 sobre el mismo candidato.

Patrón recomendado cuando se tiene libertad de elegir el tier para los 2 scouts:

| Scout    | Tier asignado                                           | Razonamiento                                   |
|----------|---------------------------------------------------------|------------------------------------------------|
| SCOUT-1  | LinkedIn (alto volumen, ruidoso)                        | Captura el flujo, acepta el score medio bajo   |
| SCOUT-2  | Ashby / Greenhouse / Lever / company-careers (curado)   | Pocos pero acertados, score medio más alto     |

El `next-for-analista` recibe luego un mix equilibrado de volumen + calidad, y el filtro hard-requirements del Analista (RULE-06) se concentra en el flujo de Scout-1 (donde hay más ruido). No es una regla rígida — adaptar al `work_mode` según la tabla anterior.

## Step 4 — Consolidar la asignación

Una vez que tú y tus peers estéis de acuerdo, persiste la partición:

```bash
python3 /app/shared/skills/scout_coord.py assign $MY_ID \
    --cerchi "<círculos asignados a ti, ej. 1,2>" \
    --fonti "<slugs de fuentes asignadas, separados por coma, ej. linkedin,greenhouse,lever>"
```

Cada scout escribe su propia línea. El script impide solapamiento en los slugs de fuentes, así que si dos scouts intentan reclamar `linkedin` simultáneamente el segundo falla — el perdedor debe renegociar.

## Step 5 — Verificar

```bash
python3 /app/shared/skills/scout_coord.py show
```

Salida esperada: una línea por scout activo con sus `cerchi` y `fonti`. Si tu línea falta, tu `assign` falló silenciosamente — repite el Step 4.

Comprobación cruzada: la unión de todas las `fonti` debería cubrir los tiers que el equipo realmente quiere scrapear hoy. Si un tier tiene cero scouts (ej. nadie está en `niche-remote`), notifica al Capitano:

```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [INFO] scout-coord: tier 'niche-remote' senza scout, considera spawn aggiuntivo o riassegnamento."
```

## Anti-patrones

- ❌ Saltar el Step 1 ("solo estoy yo") sin comprobar — un peer podría haber sido recién respawneado por el Dottore.
- ❌ Reset ejecutado por todos los scouts en paralelo — condición de carrera, la base de datos acaba corrupta. Solo el scout con número más bajo.
- ❌ Negociar y luego olvidar el Step 4 — la base de datos está vacía, los peers no pueden ver tu reclamo, dos scouts golpean la misma fuente.
- ❌ Reclamar `linkedin` Y `greenhouse` Y `lever` Y `remoteok` Y `weworkremotely` Y `webresearch` "por seguridad" — nada que compartir con el peer, no tiene nada que hacer.
- ❌ Renegociar a mitad de loop sin un disparador — la partición es al arranque. Si un peer muere el Dottore lo respawnea con el mismo rol; solo el propio SCOUT relee sus `cerchi`/`fonti` al arranque.

## Cuándo renegociar

Solo con estos disparadores:
- Un nuevo SCOUT acaba de arrancar (ves `SCOUT-N+1` en `tmux list-sessions` que no estaba en tu arranque)
- Un SCOUT murió y NO fue respawneado (la capacidad bajó, redistribuye su tier)
- El Capitano ordena explícitamente una repartición (raro, ej. después de un `[FEEDBACK]` del Analista indicando que un tier produce consistentemente links muertos)

En los tres casos: breve intercambio por tmux, luego re-`assign` con nuevos parámetros. No se necesita `reset` a menos que el JSON esté visiblemente corrupto.

## Ver también

- `circles-and-sources` — la definición real de los 5 círculos + 4 tiers de fuentes (esta skill es CÓMO particionar; esa es QUÉ particionar).
- `position-insert` — lo que hace cada Scout una vez que tiene su asignación.
- `agents/_manual/anti-collision.md` — el contrato anti-colisión más amplio que esta skill implementa para el rol Scout.
- `tmux-send` — formato del sobre de mensajes para la negociación.
