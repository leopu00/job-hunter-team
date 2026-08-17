<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: circles-and-sources
description: Mapa estratégico de qué buscar DÓNDE, derivado enteramente del perfil del candidato. Los 5 círculos concéntricos (work_mode + reubicación) te indican el alcance geográfico; los 4 niveles de fuentes (LinkedIn → agregadores ATS → nicho → web) te indican qué plataformas drenar en orden. Un scout que busca en el nivel equivocado en el círculo equivocado desperdicia su cuota y su partición de `scout-coord`. Abre esta skill al arranque (después de `scout-coord`) y de nuevo cuando un círculo se agote o un `[FEEDBACK]` del Analyst sugiera cambiar de fuente.
allowed-tools: Bash(python3 /app/shared/skills/safe_fetch.py *), Bash(python3 /app/shared/skills/linkedin_check.py *)
---

# circles-and-sources — lee el perfil, construye el mapa

Dos ejes ortogonales:
- **Círculos** = DÓNDE (alcance geográfico / modo de trabajo)
- **Niveles** = QUÉ plataformas (en orden de prioridad)

Ambos provienen de `$JHT_HOME/profile/candidate_profile.yml`. **No asumas**: lee `preferences.work_mode`, `location`, `preferences.relocation`, luego construye los círculos sobre lo que el candidato realmente quiere.

## Los 5 círculos concéntricos

Agota cada círculo de dentro hacia fuera antes de moverte hacia afuera.

| # | Círculo                      | Qué es                                                                                                      | Cuándo entrar                                                            |
|---|------------------------------|-------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | 🎯 **Preferencia primaria**  | El modo + geografía que el candidato declaró como prioridad.                                                 | Siempre empieza aquí. Drénalo primero.                                    |
| 2 | 🗺️ **Vecinos geográficos**   | Áreas inmediatamente extensibles desde el círculo 1.                                                        | Solo si `relocation` lo permite O el círculo 1 está agotado.             |
| 3 | ✈️ **Reubicación dirigida**   | Ciudades / países listados en `preferences.relocation` (o inferidos de `"ovunque"` / `"Europa"`).           | Solo si `relocation` no está vacío (true / lista / `"ovunque"`).         |
| 4 | 🛰️ **Satélite**              | Geografía fuera del objetivo central, menor probabilidad.                                                    | Solo si los círculos 1-3 están agotados.                                  |
| 5 | 🌗 **Frontera**              | Roles **adyacentes** al stack principal del candidato (sub-dominios del mismo lenguaje, cross-funcional, automatización, ML adyacente, etc.). El candidato se trata como adaptable; el Scorer aplica la penalización de brecha downstream. | Solo después de que los círculos 1-4 estén drenados para el día. |

### Cómo materializar el círculo 1 desde el perfil

```yaml
preferences:
  work_mode: <remoto|ibrido|in sede|flessibile>
  ...
location: <city/area>
preferences:
  relocation: <true|false|"per la giusta posizione"|list>
```

| `work_mode`   | Círculo 1 = QUÉ buscar                                                                                |
|---------------|---------------------------------------------------------------------------------------------------------|
| `remote`      | Roles remotos compatibles con la zona horaria / país del candidato (ej. `Remote (EU only)` para basados en UE) |
| `on-site`     | Roles en `location` (base de ciudad) solamente                                                         |
| `hybrid`      | Roles en ciudad `location`, etiquetados como híbridos o radio de commute                               |
| `flessibile`  | Unión de los tres anteriores — agotar en orden remoto → ciudad → híbrido                               |

### Círculo 2 — vecinos geográficos

| Tipo de círculo 1   | Expansión del círculo 2                                                                       |
|---------------------|-----------------------------------------------------------------------------------------------|
| Remoto (nacional)   | Remoto regional / continental compatible con zona horaria + autorización de trabajo del candidato |
| Presencial          | Región / área metropolitana del país base                                                     |
| Híbrido             | Igual que presencial (ampliación del radio de commute)                                        |

### Círculo 3 — reubicación dirigida

Solo si `preferences.relocation` no está vacío:

| Valor de `relocation`        | Expansión del círculo 3                                                                      |
|------------------------------|----------------------------------------------------------------------------------------------|
| Lista (`["Berlin", "Lisbon"]`) | Solo esas ciudades                                                                         |
| `"ovunque"`                  | Hubs globales **para el dominio del candidato** (finanzas → London, NYC, Zurich, Frankfurt, Singapore, Dublin, Luxembourg; tech → SF, Berlin, Amsterdam, Lisbon, Tel Aviv…). **Rota entre ellos round-robin — NO drenes el hub más denso (ej. London para finanzas) primero**, o la shortlist termina dominada por el hub (ver regla Anti-sesgo, guardia de ubicación). |
| `"Europa"`                   | Hubs tech de la UE (Berlin, London, Amsterdam, Lisbon, Dublin, Madrid, Paris, Stockholm, ...) |
| `"per la giusta posizione"`  | Saltar círculo 3, marcar candidatos borderline del círculo 4 con bandera de reubicación en notas |

## Los 4 niveles de fuentes

Drena un nivel completamente antes de pasar al siguiente.

| Nivel | Tipo                                | Fuentes                                                                                                      | Notas                                                                                         |
|-------|-------------------------------------|--------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| 1     | **LinkedIn**                        | `linkedin_check.py` (perfil autenticado), `safe_fetch.py`                                        | Universal: cubre remoto, presencial, híbrido. Primer paso obligatorio para cada círculo. **NUNCA `fetch` MCP** — bloqueado por robots.txt. |
| 2     | **Agregadores ATS**                 | Tableros Greenhouse, tableros Lever, Indeed, Wellfound (ex AngelList)                                        | Funcionan para cualquier work_mode. Cubren muchas empresas en un scrape.                       |
| 3     | **Tableros nicho (específicos del perfil)** | Elegir por `work_mode` Y dominio                                                                     | (ver tabla abajo)                                                                              |
| 4     | **WebSearch + páginas de carreras** | Consultas `WebSearch` + scrape de páginas de carreras de empresas                                            | Último recurso solo después de que los niveles 1-3 estén drenados.                             |

### Nivel 3 — elegir por work_mode + dominio

| `work_mode` del candidato | Tableros nicho a considerar                                                                                |
|---------------------------|------------------------------------------------------------------------------------------------------------|
| `remote`                  | Remote.co, WeWorkRemotely, RemoteOK, EURemoteJobs (o equivalentes regionales)                              |
| `on-site` / `hybrid`     | Tableros locales / nacionales (InfoJobs, Glassdoor regional, Stepstone, Welcome to the Jungle FR, ...)     |
| `flessibile`              | Combinar remoto + local                                                                                    |
| Específico de dominio (cualquiera) | Nicho específico de stack: PyJobs (Python), GoJobs (Go), Djinni (Europa del Este / dev), 4dayweek.io (4-day-week), ... |

> ⚠️ **No traigas tableros específicos de remoto a una búsqueda no remota**, y viceversa. WeWorkRemotely para un candidato que quiere presencial en Milán es scraping desperdiciado.

## Regla anti-sesgo (obligatoria) — sobre **empresa Y ubicación**

Dos guardias independientes, ambos al final del lote:

1. **Empresa**: si **> 30% de las posiciones de un solo lote provienen de una empresa**, cambia fuente/consulta para el siguiente lote. Una scaleup volcando 12 roles en un tablero inunda el pool — la diversidad importa más que el volumen.
2. **Ubicación** (ciudad/área): si **> 40% de un solo lote proviene de una ciudad**, el siguiente lote DEBE apuntar a una *diferente* ciudad del círculo. Sin esto, un candidato abierto a un círculo multi-ciudad (ej. reubicación `"ovunque"`/`"Europa"`) obtiene un pool dominado por el único hub que tiene más publicaciones para su dominio — finanzas → **London**, tech → SF/Berlin. Incidente real (beta tester #2): un candidato de finanzas recibió una shortlist casi solo de London porque London supera a cualquier otro hub ~10×. Rota entre las ciudades del círculo en round-robin; no drenes el hub más denso primero.

```python
# pseudocódigo para la verificación al final del lote
from collections import Counter
batch = [...]
n = len(batch)

# guardia 1 — empresa
top_company, c_count = Counter(p.company for p in batch).most_common(1)[0]
if c_count / n > 0.30:
    log(f"anti-bias company: {top_company} = {c_count}/{n} >30% → switch source/query")

# guardia 2 — ubicación (ciudad), ACUMULATIVO sobre toda la ejecución (NO solo este lote)
# El guardia por-lote no basta: un hub (London para finanzas) queda por debajo del umbral
# en cada lote individual y sin embargo acumula el 60% de la DB con el tiempo (visto en vivo
# en beta: London=57/97=59%). Mide sobre el TOTAL de la DB.
db_by_city = dict(db.execute(
    "SELECT COALESCE(loc_city, TRIM(SUBSTR(location,1,INSTR(location||',',',')-1))), COUNT(*) "
    "FROM positions GROUP BY 1"))
db_total = sum(db_by_city.values()) or 1
top_city, top_n = max(db_by_city.items(), key=lambda kv: kv[1])
if top_n / db_total > 0.35:                       # tope SUAVE: ninguna ciudad > ~35% de la ejecución
    log(f"anti-bias location ACUMULATIVO: {top_city}={top_n}/{db_total} (>35%) → "
        f"STOP consultas en {top_city}, próximo sweep en ciudades prioritarias sub-atendidas")
```

**Regla de balance geográfico (acumulativa, tope suave) — incentiva la distribución, no impone la paridad:**

1. **Lee el perfil**: las `priority cities` (campo `location` / `preferences.relocation`) son el objetivo. Es normal y justo que las ciudades con más ajuste pesen más — NO fuerces una distribución uniforme.
2. **Mide sobre toda la ejecución** antes de cada nuevo sweep: `SELECT loc_city, COUNT(*) FROM positions GROUP BY loc_city ORDER BY 2 DESC`.
3. **Tope suave ~35%**: si UNA sola ciudad supera el ~35% del total de la DB, **deja de consultarla** para los próximos sweeps y redirige el esfuerzo. Un hub (ej. London para finanzas supera a cada otra ciudad ~10×): dejarlo correr produce una shortlist dominada por el hub, inútil para quien tiene prioridades multi-ciudad.
4. **Cuota de cobertura de prioridades**: las priority-city del perfil a **0 o sub-atendidas** tienen precedencia en los próximos sweeps — dedica consultas dirigidas (`<provider>:<keyword>:<city>`) hasta que tengan una presencia mínima, antes de volver a los hubs ya llenos.
5. **Ciudades fuera de perfil como hub = doble alarma**: si la ciudad dominante NO está entre las prioridades del perfil, es sesgo de hub + fuera de objetivo → rebalancear con urgencia.

### ⚠️ Autorización de trabajo como filtro ANTES del balance (Brexit, visados)

Balancear las ubicaciones no sirve si las ofertas no son **trabajables** por el usuario. Antes de aceptar un hub, verifica la compatibilidad de permiso de trabajo con el perfil (ciudadanía / visados declarados):

- 🇬🇧 **UK post-Brexit**: un ciudadano **UE sin visado UK** NO puede trabajar en London/UK sin **sponsorship** (Skilled Worker visa). Entonces para un perfil solo-UE las ofertas UK valen **solo si** el JD menciona explícitamente *visa sponsorship*; de lo contrario son incompatibles en work-auth → SKIP (ver "Filtros permisivos", regla geo).
- 🇨🇭 **Suiza / no-UE**: misma lógica — verificar permiso de trabajo.
- Regla práctica: si el hub dominante está en un país que requiere un permiso que el usuario no tiene (y los JD no ofrecen sponsorship), ese volumen es **fantasma** — no cuenta como cobertura y debe excluirse del pool, no solo balancearse.

### 🗣️ Búsqueda consciente del idioma — no recojas lo que será excluido por idioma

Mismo principio que la work-auth, en el frente lingüístico. Si los **idiomas del usuario** (`languages`, con nivel) NO cubren el **idioma de trabajo local** de una ciudad objetivo, los roles que lo requieran serán descartados downstream por el Analyst (`[LANGUAGE]`) — recogerlos es desperdicio. Caso real (beta): candidato con inglés C1 + alemán solo conversacional + sin IT/ES/FR → de 18 excluidas, 11 eran por idioma local obligatorio (M&A en alemán en Munich/Zurich, IB en italiano en Milán, etc.).

**Regla:** antes de consultar una ciudad cuyo idioma local el usuario no domina a nivel business, **sesga las consultas hacia roles English-first / internacionales**:
- Añade calificadores a la consulta: `"English-speaking"`, `"international team"`, `"English required"`, nombre de multinacionales/firmas globales (Big4, bulge-bracket, scale-up internacionales) que trabajan en inglés incluso en mercados no anglófonos.
- Para los roles que **requieren** el idioma local (y el usuario no lo tiene a nivel business): trátalos como los UK-sin-sponsor — no los insertes, o insértalos solo si el JD dice explícitamente que el idioma local no es requerido.
- Inglés como idioma de trabajo ≠ país anglófono: en Amsterdam, Zurich, Luxembourg, Lisboa muchos roles de finanzas funcionan en inglés. Son el **punto dulce** para quien habla solo inglés pero quiere Europa continental.

Resultado: el pool que sobrevive al Analyst es más pequeño pero **de alto rendimiento** (accesible por idioma Y por work-auth), en lugar de inflarse con roles que serán descartados.

## Filtros permisivos a nivel de SCOUT

El Scout pre-filtra solo los casos **totalmente fuera de alcance**. **No hagas el trabajo del Analyst** — el candidato se trata como adaptable a roles adyacentes. Salta una publicación solo si:

- 🚫 El título contiene explícitamente: `senior`, `lead`, `staff`, `principal`, `head of`, `director` → SKIP (brecha de seniority demasiado amplia)
- 🚫 Incompatibilidad geográfica de work-auth con el perfil (ej. `US-only` / `Canada-only` y el candidato no tiene visado) → SKIP
- 🚫 Dominio completamente fuera de IT/coding (ej. pastelero, contador, ventas) cuando el candidato está en IT → SKIP
- 🚫 Requisito duro de `> real_years + 3` años de experiencia → SKIP (brecha moderada está bien, el Scorer decide)

Todo lo demás: **insértalo**. Stacks adyacentes (data, devops, platform, frontend, automatización, ML adyacente, etc.) todos pasan; el Scorer asigna una puntuación proporcional al ajuste y el usuario los ve.

## Escuchando feedback del Analyst

Cuando el Analyst envía `[FEEDBACK]` con una etiqueta recurrente (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`):

1. ACK el mensaje
2. Ajustar las consultas / fuentes del siguiente lote según la sugerencia
3. Priorizar la fuente / filtro alternativo sugerido para la siguiente rotación
4. Notificar al Capitano solo si emerge un sesgo sistémico (no solucionable con cambio de fuente)

Ejemplo: el Analyst dice "4 de los últimos 5 de greenhouse.io requieren senior+, cambiar fuente". En el siguiente lote saltas greenhouse.io, pruebas un tablero Lever o una fuente nicho amigable con junior.

## Anti-patrones

- ❌ Buscar en el círculo 2 antes de agotar el círculo 1 — desperdicia alcance, diluye resultados.
- ❌ Ir al nivel 4 (WebSearch) antes de que los niveles 1-3 estén drenados — `WebSearch` es la fuente más ruidosa, guárdala para el final.
- ❌ Inferir `relocation = "ovunque"` para un candidato cuyo perfil dice `false` — lee el perfil, no proyectes.
- ❌ Usar LinkedIn vía `fetch` MCP — bloqueado por robots.txt; siempre `linkedin_check.py` (autenticado) o `safe_fetch.py`.
- ❌ Incluir JDs con título senior esperando que el Scorer los filtre — desperdicia presupuesto del Scorer, añade ruido. Los 4 filtros a nivel de SCOUT de arriba son el lugar correcto.
- ❌ Verificación anti-sesgo olvidada — una empresa codiciosa inunda tu lote.

## Ver también

- `scout-coord` — partición al arranque entre scouts (CÓMO dividir este mapa entre instancias).
- `position-insert` — qué hacer para cada posición candidata una vez que has decidido DÓNDE buscar.
- `agents/scout/scout.md` — el prompt orquestador del Scout que llama esta skill.
- `agents/_team/architettura.md` Fase 1 — panorama más amplio del Discovery dentro del pipeline.
