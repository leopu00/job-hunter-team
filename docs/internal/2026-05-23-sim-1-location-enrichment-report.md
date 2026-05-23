# Simulazione 1 — location enrichment con Capitano + 3 analisti

Data: 2026-05-23
Container: `jht-sim-d2` (isolato, ~/.jht-sim-d2/)
Profilo candidato: Bartolomeo Oscar Puglisi (technical writer/translator + CAD-CAM/CNC)
Dataset: 206 posizioni `status=new` da scout (vergini), playbook
[location-playbook](2026-05-23-location-playbook.md).

## Setup

- 1 Capitano (Opus high, sessione `CAPITANO`)
- 3 Analisti (Sonnet high, sessioni `ANALISTA-1/2/3`) con range disgiunti
  assegnati dal Capitano: 1–69, 70–138, 139–206.
- Missione: per ogni position popolare `role_family` + 10 colonne
  `loc_*/work_*/is_multi_location/location_notes`, poi `status=checked`.
  Zero scoring/writing/critic.

## Risultati

- **206/206 checked**, anti-collision perfetta (zero sovrapposizioni di range).
- Tempo totale: ~25 min dall'avvio Capitano alla chiusura A2.

## Cosa ha funzionato

1. **Anti-collision deterministica** via range disgiunti dichiarati dal
   Capitano nel brief. Nessun analista ha mai scritto fuori range.
2. **Diacritici preservati e normalizzati**: gli analisti hanno corretto
   `Szekesfehervar` → `Székesfehérvár`, mantenuto `Pécs`, `Prüm`,
   `Saint-Médard-en-Jalles`.
3. **Web search per `work_country`**: deduzione corretta del paese
   contrattuale per remote in EU da aziende US (DataAnnotation, iMerit,
   Crossing Hurdles → work_country=United States).
4. **`work_mode` standardizzato**: solo `onsite|hybrid|remote`, zero
   improvvisazioni.
5. **Capitano monitora** con `[PROGRESS] N/206` come da brief.

## Problemi trovati

### P1 — Approccio batch su A2 ha degradato qualità dati specifici

A2 ha caricato **tutte le 69 posizioni del suo range in un singolo turno
LLM** (4m 36s di reasoning, 17.3k tokens output). Risultato:

| Colonna | A1 (one-by-one) | A2 (batch) | A3 (one-by-one) |
|---|---:|---:|---:|
| `loc_city` popolato | 87% | **39%** | 79% |
| `loc_country` popolato | 97% | **61%** | 93% |
| `is_multi_location=true` | 1/69 | 13/69 | 2/68 |
| `work_country=US` | 5/69 | 11/69 | 2/68 |

A2 ha generalizzato: più "multi-location + remote + US-entity" e meno
città/paesi specifici. Inoltre tutti gli altri agenti hanno aspettato A2
~4 minuti durante il mega-turn.

**Fix**: REGOLA-09b nel prompt analista ("una posizione alla volta, NO
batch eccetto casi banali in lotti di 3-5"). Già applicata.

### P2 — Tassonomia `role_family` divergente tra analisti

3 analisti hanno inventato **24 nomi categoria diversi**, di cui molti
semanticamente identici:

| Concetto | A1 | A2 | A3 |
|---|---|---|---|
| Translation | "Translation / Localization" | "Localization / Language Quality" | "Language / Localization" |
| Support | "Customer Support" | "Customer Success / Technical" | "Technical Support" |
| Writing | "Technical Engineering" (sic) | "Technical Writing" | "Technical Writing" |

A2 ha usato "Technical Engineering" per ruoli che A3 ha categorizzato
"Technical Writing" → stesso tipo di ruoli, etichette diverse → dashboard
inutile (3 categorie invece di 1).

**Causa root**: nessuno script obbliga gli analisti a consultare le
famiglie già scritte dai colleghi nel DB prima di inventarne di nuove.

**Fix proposto**: REGOLA-09c "peer DB lookup" — prima di inserire un
nuovo `role_family`, l'analista esegue `db-query` per le family già
popolate dagli altri analisti nel batch corrente; se trova un match
semantico, si allinea (es. trova "Technical Writing" già usato → non
scrive "Technical Engineering"). Ne riparlo sotto.

### P3 — Casi "unverifiable" lasciati NULL invece di fallback

A2 e A3 hanno lasciato `work_country=NULL` per ~3 record con annotazione
tipo "work_country TBD / unverifiable", invece di fare un secondo giro
di web search più approfondito o fallback al paese del job board.

Esempi: id=140 (Railsware → HQ Ucraina, ma A3 ha messo NULL), id=114
(Top Remote Talent → società CR, A2 ha messo TBD).

**Fix proposto**: nel playbook, regola esplicita "se HQ non trovato dopo
2 attempts: imposta `work_country` al paese del posting board /
primo paese citato in JD, e annota in `location_notes` 'work_country
inferred from posting board'".

## Lezioni per il sistema multi-analista

1. **Coordinamento via DB**: gli analisti devono **leggere** lo stato
   condiviso (DB) **prima di scrivere**. Pattern già esistenti dai
   colleghi sono il vocabolario di riferimento. Senza questo, ogni
   analista è un'isola.
2. **Capitano come arbitro tassonomia**: in alternativa (o in aggiunta)
   il Capitano può intervenire dopo un check di sample per consolidare
   le family (es. unire "Customer Support" + "Technical Support" sotto
   un nome unico).
3. **Batch è veleno per la coordinazione real-time**: gli altri analisti
   non vedono i tuoi pattern finché non scrivi sul DB. Batch da 69 =
   "buco nero" di 4 minuti.

## Cosa cambia per la sim 2

1. **REGOLA-09c**: peer DB lookup prima di inventare role_family.
2. **REGOLA-09d**: fallback HQ via posting board se web search inconclusiva.
3. **Brief Capitano sim 2**: dire esplicitamente "consulta DB prima di
   scegliere il vocabolario, allineati con i colleghi".
4. Wipe completo dati sim 1 (location_* + role_family → NULL, status → new)
   e restart container.
