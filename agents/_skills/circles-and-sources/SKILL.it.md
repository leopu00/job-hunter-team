<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: circles-and-sources
description: Mappa strategica di cosa cercare DOVE, derivata interamente dal profilo del candidato. I 5 cerchi concentrici (work_mode + relocation) indicano lo scope geografico; i 4 livelli di fonte (LinkedIn → ATS aggregatori → niche → web) indicano quali piattaforme drenare in ordine. Uno scout che cerca nel livello sbagliato nel cerchio sbagliato spreca la sua quota e la sua partizione `scout-coord`. Apri questa skill al boot (dopo `scout-coord`) e di nuovo ogni volta che un cerchio è esaurito o un `[FEEDBACK]` dall'Analista suggerisce di cambiare fonte.
allowed-tools: Bash(python3 /app/shared/skills/safe_fetch.py *), Bash(python3 /app/shared/skills/linkedin_check.py *)
---

# circles-and-sources — leggi il profilo, costruisci la mappa

Due assi ortogonali:
- **Cerchi** = DOVE (scope geografico / modalità di lavoro)
- **Livelli** = QUALI piattaforme (in ordine di priorità)

Entrambi provengono da `$JHT_HOME/profile/candidate_profile.yml`. **Non assumere**: leggi `preferences.work_mode`, `location`, `preferences.relocation`, poi costruisci i cerchi in base a ciò che il candidato vuole davvero.

## I 5 cerchi concentrici

Esaurisci ogni cerchio dall'interno verso l'esterno prima di spostarti.

| # | Cerchio                      | Cos'è                                                                                                       | Quando entrare                                                           |
|---|------------------------------|-------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | 🎯 **Preferenza primaria**   | La modalità + geografia che il candidato ha dichiarato come priorità.                                       | Inizia sempre qui. Drenalo per primo.                                    |
| 2 | 🗺️ **Geo vicini**            | Aree immediatamente estensibili dal cerchio 1.                                                              | Solo se `relocation` lo permette O il cerchio 1 è esaurito.             |
| 3 | ✈️ **Relocation mirata**      | Città / paesi elencati in `preferences.relocation` (o inferiti da `"ovunque"` / `"Europa"`).                | Solo se `relocation` è non vuoto (true / lista / `"ovunque"`).           |
| 4 | 🛰️ **Satellite**             | Geografia fuori dal target core, probabilità minore.                                                        | Solo se i cerchi 1-3 sono esauriti.                                      |
| 5 | 🌗 **Frontiera**             | Ruoli **adiacenti** allo stack primario del candidato (sotto-domini dello stesso linguaggio, cross-funzionale, automazione, ML adiacente, ecc.). Il candidato è trattato come adattabile; lo Scorer applica la penalità di gap a valle. | Solo dopo che i cerchi 1-4 sono drenati per la giornata. |

### Come materializzare il cerchio 1 dal profilo

```yaml
preferences:
  work_mode: <remoto|ibrido|in sede|flessibile>
  ...
location: <city/area>
preferences:
  relocation: <true|false|"per la giusta posizione"|list>
```

| `work_mode`   | Cerchio 1 = COSA cercare                                                                                 |
|---------------|---------------------------------------------------------------------------------------------------------|
| `remote`      | Ruoli remoti compatibili con il fuso orario / paese del candidato (es. `Remote (EU only)` per basati in UE) |
| `on-site`     | Ruoli in `location` (città base) solo                                                                    |
| `hybrid`      | Ruoli nella città di `location`, taggati come ibridi o nel raggio di pendolarismo                        |
| `flessibile`  | Unione dei tre sopra — esaurisci in ordine remoto → città → ibrido                                      |

### Cerchio 2 — geo vicini

| Tipo cerchio 1   | Espansione cerchio 2                                                                          |
|------------------|------------------------------------------------------------------------------------------------|
| Remoto (nazionale)| Remoto regionale / continentale compatibile con fuso + work-auth del candidato                |
| In sede          | Regione / area metropolitana del paese base                                                   |
| Ibrido           | Come in sede (allargamento raggio pendolarismo)                                               |

### Cerchio 3 — relocation mirata

Solo se `preferences.relocation` è non vuoto:

| Valore `relocation`    | Espansione cerchio 3                                                                         |
|------------------------|---------------------------------------------------------------------------------------------|
| Lista (`["Berlin", "Lisbon"]`) | Solo quelle città                                                                    |
| `"ovunque"`            | Hub globali **per il dominio del candidato** (finanza → Londra, NYC, Zurigo, Francoforte, Singapore, Dublino, Lussemburgo; tech → SF, Berlino, Amsterdam, Lisbona, Tel Aviv…). **Ruota tra loro in round-robin — NON drenare l'hub più denso (es. Londra per la finanza) per primo**, altrimenti la shortlist finisce dominata dall'hub (vedi regola Anti-bias, guard location). |
| `"Europa"`             | Hub tech EU (Berlino, Londra, Amsterdam, Lisbona, Dublino, Madrid, Parigi, Stoccolma, ...)    |
| `"per la giusta posizione"` | Salta il cerchio 3, marca i candidati borderline dal cerchio 4 con flag relocation nelle note |

## I 4 livelli di fonte

Drena un livello completamente prima di passare al successivo.

| Livello | Tipo                                | Fonti                                                                                                        | Note                                                                                          |
|---------|-------------------------------------|--------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------|
| 1       | **LinkedIn**                        | `linkedin_check.py` (profilo autenticato), `safe_fetch.py`                                            | Universale: copre remoto, in sede, ibrido. Primo step obbligatorio per ogni cerchio. **MAI `fetch` MCP** — bloccato da robots.txt. |
| 2       | **Aggregatori ATS**                 | Board Greenhouse, board Lever, Indeed, Wellfound (ex AngelList)                                              | Funzionano per qualsiasi work_mode. Coprono molte aziende in un solo scrape.                  |
| 3       | **Board niche (specifiche per profilo)** | Scegli per `work_mode` E dominio                                                                       | (vedi tabella sotto)                                                                          |
| 4       | **WebSearch + pagine career**       | Query `WebSearch` + scrape di pagine career aziendali                                                       | Ultimo ricorso solo dopo che i livelli 1-3 sono drenati.                                      |

### Livello 3 — scegli per work_mode + dominio

| `work_mode` del candidato | Board niche da considerare                                                                                 |
|---------------------------|--------------------------------------------------------------------------------------------------------------------|
| `remote`                  | Remote.co, WeWorkRemotely, RemoteOK, EURemoteJobs (o equivalenti regionali)                                       |
| `on-site` / `hybrid`     | Board locali / nazionali (InfoJobs, Glassdoor regionale, Stepstone, Welcome to the Jungle FR, ...)                |
| `flessibile`              | Combina remote + locale                                                                                           |
| Specifico per dominio (qualsiasi) | Niche per stack: PyJobs (Python), GoJobs (Go), Djinni (Europa dell'Est / dev), 4dayweek.io (settimana 4 giorni), ... |

> ⚠️ **Non portare board specifiche per il remoto in una ricerca non-remoto**, e viceversa. WeWorkRemotely su un candidato che vuole lavoro in sede a Milano è scraping sprecato.

## Regola anti-bias (obbligatoria) — su **azienda E location**

Due guard indipendenti, entrambi a fine batch:

1. **Azienda**: se **> 30% delle posizioni di un singolo batch provengono da una sola azienda**, cambia fonte/query per il batch successivo. Una scaleup che scarica 12 ruoli su una board inonda il pool — la diversità conta più del volume.
2. **Location** (città/area): se **> 40% di un singolo batch proviene da una città**, il batch successivo DEVE puntare a una *diversa* città del cerchio. Senza questo, un candidato aperto a un cerchio multi-città (es. relocation `"ovunque"`/`"Europa"`) riceve un pool dominato dal singolo hub che ha più offerte per il suo dominio — finanza → **Londra**, tech → SF/Berlino. Incidente reale (beta tester #2): un candidato in finanza ha ricevuto una shortlist quasi esclusivamente londinese perché Londra supera ogni altro hub di ~10×. Ruota tra le città del cerchio in round-robin; non drenare l'hub più denso per primo.

```python
# pseudocodice per il check a fine batch
from collections import Counter
batch = [...]
n = len(batch)

# guard 1 — azienda
top_company, c_count = Counter(p.company for p in batch).most_common(1)[0]
if c_count / n > 0.30:
    log(f"anti-bias azienda: {top_company} = {c_count}/{n} >30% → cambia fonte/query")

# guard 2 — location (città), CUMULATIVO sull'intero run (NON solo questo batch)
# Il guard per-batch non basta: un hub (London per la finanza) resta sotto-soglia
# in ogni singolo batch eppure accumula il 60% del DB nel tempo (visto live sul
# beta: London=57/97=59%). Misura sul TOTALE del DB.
db_by_city = dict(db.execute(
    "SELECT COALESCE(loc_city, TRIM(SUBSTR(location,1,INSTR(location||',',',')-1))), COUNT(*) "
    "FROM positions GROUP BY 1"))
db_total = sum(db_by_city.values()) or 1
top_city, top_n = max(db_by_city.items(), key=lambda kv: kv[1])
if top_n / db_total > 0.35:                       # SOFT cap: nessuna città > ~35% del run
    log(f"anti-bias location CUMULATIVO: {top_city}={top_n}/{db_total} (>35%) → "
        f"STOP queries su {top_city}, prossimo sweep su città prioritarie sotto-servite")
```

**Regola di bilanciamento geografico (cumulativa, soft-cap) — incentiva lo spread, non impone la parità:**

1. **Leggi il profilo**: le `priority cities` (campo `location` / `preferences.relocation`) sono il target. È normale e giusto che le città con più fit pesino di più — NON forzare uno split uniforme.
2. **Misura sul run intero** prima di ogni nuovo sweep: `SELECT loc_city, COUNT(*) FROM positions GROUP BY loc_city ORDER BY 2 DESC`.
3. **Soft-cap ~35%**: se UNA sola città supera il ~35% del totale DB, **smetti di interrogarla** per i prossimi sweep e ridirigi lo sforzo. Un hub (es. London per la finanza out-posta ogni altra città ~10×): lasciarlo correre produce uno shortlist hub-dominated, inutile per chi ha priorità multi-città.
4. **Quota di copertura priorità**: le priority-city del profilo a **0 o sotto-servite** hanno precedenza nei prossimi sweep — dedica query mirate (`<provider>:<keyword>:<city>`) finché non hanno una presenza minima, prima di tornare sugli hub già pieni.
5. **Città fuori-profilo come hub = doppio allarme**: se la città dominante NON è tra le priority del profilo, è hub-bias + off-target → ribilancia con urgenza.

### ⚠️ Work-authorization come filtro PRIMA del bilanciamento (Brexit, visti)

Bilanciare le location non serve se le offerte non sono **lavorabili** dall'utente. Prima di accettare un hub, verifica la compatibilità di work-permit col profilo (cittadinanza / visti dichiarati):

- 🇬🇧 **UK post-Brexit**: un cittadino **UE senza visto UK** NON può lavorare a Londra/UK senza **sponsorship** (Skilled Worker visa). Quindi per un profilo solo-UE le offerte UK valgono **solo se** il JD menziona esplicitamente *visa sponsorship*; altrimenti sono work-auth incompatibili → SKIP (vedi "Filtri permissivi", regola geo).
- 🇨🇭 **Svizzera / non-UE**: stessa logica — verifica permesso di lavoro.
- Regola pratica: se l'hub dominante è in un paese che richiede un permesso che l'utente non ha (e i JD non offrono sponsorship), quel volume è **fantasma** — non conta come copertura e va escluso dal pool, non solo bilanciato.

### 🗣️ Sourcing language-aware — non raccogliere ciò che verrà escluso per lingua

Stesso principio della work-auth, sul fronte linguistico. Se le **lingue dell'utente** (`languages`, con livello) NON coprono la **lingua di lavoro locale** di una città target, i ruoli che la richiedono saranno scartati a valle dall'Analista (`[LANGUAGE]`) — raccoglierli è spreco. Caso reale (beta): candidato con inglese C1 + tedesco solo conversazionale + niente IT/ES/FR → su 18 escluse, 11 erano per lingua locale obbligatoria (M&A in tedesco a Monaco/Zurigo, IB in italiano a Milano, ecc.).

**Regola:** prima di interrogare una città il cui idioma locale l'utente non padroneggia a livello business, **biasa le query verso ruoli English-first / international**:
- Aggiungi qualificatori alla query: `"English-speaking"`, `"international team"`, `"English required"`, nome di multinazionali/firm globali (Big4, bulge-bracket, scale-up internazionali) che lavorano in inglese anche in mercati non-anglofoni.
- Per i ruoli che invece **richiedono** la lingua locale (e l'utente non l'ha a livello business): trattali come i UK-no-sponsor — non inserirli, oppure inseriscili solo se il JD dice esplicitamente che la lingua locale non è richiesta.
- Inglese come lingua di lavoro ≠ paese anglofono: a Amsterdam, Zurigo, Lussemburgo, Lisbona molti ruoli finance girano in inglese. Sono il **sweet spot** per chi parla solo inglese ma vuole l'Europa continentale.

Esito: il pool che sopravvive all'Analista è più piccolo ma **ad alto rendimento** (accessibile per lingua E per work-auth), invece di gonfiarsi di ruoli che verranno scartati.

## Filtri permissivi a livello SCOUT

Lo Scout pre-filtra solo i casi **totalmente fuori scope**. **Non fare il lavoro dell'Analista** — il candidato è trattato come adattabile a ruoli adiacenti. Salta un annuncio solo se:

- 🚫 Il titolo contiene esplicitamente: `senior`, `lead`, `staff`, `principal`, `head of`, `director` → SKIP (gap di seniority troppo ampio)
- 🚫 Work-auth geografica incompatibile con il profilo (es. `US-only` / `Canada-only` e il candidato non ha il visto) → SKIP
- 🚫 Dominio completamente fuori dall'IT/coding (es. pasticciere, contabile, vendite) quando il candidato è in IT → SKIP
- 🚫 Requisito rigido di `> anni_reali + 3` anni di esperienza → SKIP (gap moderato va bene, lo Scorer decide)

Tutto il resto: **inseriscilo**. Stack adiacenti (data, devops, platform, frontend, automazione, ML adiacente, ecc.) passano tutti; lo Scorer assegna un punteggio proporzionale al fit e l'utente li vede.

## Ascolto del feedback dell'Analista

Quando l'Analista invia `[FEEDBACK]` con un tag ricorrente (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`):

1. ACK il messaggio
2. Aggiusta le query / fonti del batch successivo secondo il suggerimento
3. Prioritizza la fonte/filtro alternativo suggerito per la prossima rotazione
4. Notifica il Capitano solo se emerge un bias sistemico (non risolvibile con cambio fonte)

Esempio: l'Analista dice "4 degli ultimi 5 da greenhouse.io richiedono senior+, cambia fonte". Al batch successivo salti greenhouse.io, prova una board Lever o una fonte niche junior-friendly.

## Anti-pattern

- ❌ Cercare nel cerchio 2 prima di esaurire il cerchio 1 — spreca scope, diluisce i risultati.
- ❌ Andare al livello 4 (WebSearch) prima di aver drenato i livelli 1-3 — `WebSearch` è la fonte più rumorosa, salvala per ultima.
- ❌ Inferire `relocation = "ovunque"` per un candidato il cui profilo dice `false` — leggi il profilo, non proiettare.
- ❌ Usare LinkedIn via `fetch` MCP — bloccato da robots.txt; sempre `linkedin_check.py` (autenticato) o `safe_fetch.py`.
- ❌ Includere JD con titolo senior sperando che lo Scorer li filtri — spreca budget dello Scorer, aggiunge rumore. I 4 filtri a livello SCOUT sopra sono il posto giusto.
- ❌ Check anti-bias dimenticato — un'azienda vorace sommerge il tuo batch.

## Vedi anche

- `scout-coord` — partizionamento al boot tra scout (COME dividere questa mappa tra istanze).
- `position-insert` — cosa fare per ogni posizione candidata una volta che hai deciso DOVE cercare.
- `agents/scout/scout.md` — il prompt orchestratore dello Scout che chiama questa skill.
- `agents/_team/architettura.md` Fase 1 — quadro più ampio della Discovery nella pipeline.
