<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: mentor-patterns
description: I cinque pattern che il Mentor cerca nei record per decidere QUANDO parlare. Il silenzio è il default; solo un pattern reale e ricorrente merita una parola. Questa skill fornisce il metodo canonico di rilevazione per ogni pattern (query DB + soglia) così il Mentor non parla mai da un singolo data point. Read-only — non scrive mai nel DB. Responsabilità del Mentor.
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(grep *), Bash(awk *)
---

# mentor-patterns — cosa rivelano i record

Il Mentor osserva insiemi, non punti singoli. Cinque pattern meritano di parlarne; tutto il resto è rumore.

## Pattern A — Gap di competenze tra profilo e mercato

Competenze che appaiono ripetutamente nei requisiti dei JD ma sono assenti da `candidate_profile.yml > skills`. Se appaiono anche in posizioni con **punteggio alto**, il gap è **costoso** (colmarlo sbloccherebbe invii, non rumore).

### Rilevazione

```bash
# 1. Prendi le ultime 30 posizioni con requisiti + punteggio
python3 /app/shared/skills/db_query.py positions --limit 30 \
    --status scored,checked --order-by created_at:desc

# 2. Tokenizza i requisiti, confronta con profile.skills.primary + .secondary
# 3. Conta i token NON nel profilo che appaiono in N posizioni
```

### Soglia

Parla solo se una competenza mancante appare in **≥ 5 posizioni nelle ultime 30** E **≥ 1 di esse ha punteggio ≥ 65** (a portata del gate di invio).

### Esempio di output

> *"<Nome>, ho contato. **Docker** appare in dodici delle ultime trenta posizioni nei record. Nove con punteggio tra 65 e 78 — a portata del gate di invio, senza mai superarlo. Un'abilità ti separa da un terzo del percorso davanti a te."*

## Pattern B — Esclusioni ricorrenti

Conteggi dei marker `ESCLUSA: [TAG]` in `positions.notes` negli ultimi 30 giorni. Se un tag domina, la direzione di ricerca è disallineata.

### Rilevazione

```bash
python3 /app/shared/skills/db_query.py positions --status excluded --limit 50 \
    --order-by last_checked:desc \
    | grep -oE 'ESCLUSA: \[(SENIORITY|STACK|GEO|LINGUA|LINK_MORTO|SCAM)\]' \
    | sort | uniq -c | sort -rn
```

### Soglia

Parla solo se **un tag rappresenta ≥ 40% delle esclusioni** E le esclusioni totali sono ≥ 20 negli ultimi 30 giorni.

### Interpretazione

| Tag dominante   | Causa probabile                                                  | Mossa suggerita                          |
|-----------------|----------------------------------------------------------|------------------------------------------|
| `[SENIORITY]`   | Si punta troppo alto (o troppo basso) per il livello del candidato | Aggiusta `seniority_target` nel profilo  |
| `[LINGUA]`      | Una singola lingua chiude mercati interi                         | Aggiungi la lingua, o restringi lo scope geografico |
| `[GEO]`         | `work_mode` / `relocation` non in linea con la ricerca           | Ridiscuti le preferenze con l'utente     |
| `[STACK]`       | Rumore da stack adiacenti che raggiunge il team                  | Stringi i filtri Scout via Capitano      |
| `[LINK_MORTO]` (>40%) | Problema di qualità della fonte, non del candidato         | Inoltra al Capitano, questo è un problema Scout |

## Pattern C — Banda parcheggio punteggio basso (40-49)

Il segnale più ricco: le posizioni nella banda parcheggio sono **quasi-fit**. Una componente del punteggio le trattiene. Quella componente è la **leva**.

### Rilevazione

```bash
# Prendi tutte le posizioni 40-49 con il breakdown del punteggio
python3 /app/shared/skills/db_query.py scores \
    --min-total 40 --max-total 49 --limit 30
```

Per ciascuna, identifica la **componente singola più bassa** (`stack_match` / `experience_fit` / `remote_fit` / `salary_fit` / `strategic_fit`). Aggrega: quale componente è la leva per il maggior numero di posizioni?

### Soglia

Parla solo se **≥ 5 posizioni nella banda parcheggio condividono la stessa componente bassa** E quella componente è < 50% del suo cap di peso.

### Interpretazione

| Componente leva   | Cosa significa                                                       |
|-------------------|-----------------------------------------------------------------------|
| `stack_match`     | Gap di competenze (verifica incrociata con Pattern A)                 |
| `experience_fit`  | Mismatch di seniority (verifica incrociata con Pattern B `[SENIORITY]`)|
| `salary_fit`      | Aspettativa salariale del candidato che si allontana dal mercato      |
| `remote_fit`      | Preferenze geografiche troppo strette                                 |
| `strategic_fit`   | Bonus stack/settore eroso — la nicchia sta svanendo o non era ancora forte |

## Pattern D — Feedback post-invio

Se `applications.applied = true`, i funnel di outcome portano la verità.

### Rilevazione

```bash
# Application inviate negli ultimi 60 giorni
python3 /app/shared/skills/db_query.py applications --applied true \
    --order-by applied_at:desc --limit 30
```

Raggruppa per `response`: `interview` / `rejected` / `ghosted` / `null` (non ancora risposto). Calcola:
- Tasso colloqui = colloqui / inviate
- Tasso rifiuto = rifiutate / inviate
- Tasso ghost = ghosted (`now - applied_at > 30d` E nessuna risposta) / inviate

### Soglia

Parla solo con **≥ 10 application inviate** nella finestra (altrimenti campione troppo piccolo).

### Interpretazione

| Pattern osservato                               | Mossa                                                                 |
|-------------------------------------------------|-----------------------------------------------------------------------|
| I rifiuti condividono tipo azienda / gap seniority | Ri-targettizza la ricerca (gap competenze o seniority, vedi Pattern A/B) |
| Ghosting > 60% senza cluster specifico           | Il CV non spicca O mercato saturo → revisiona CV col Critico / metti in pausa invii aggressivi |
| Esistono colloqui → cerca cosa condividono      | **Oro**: replica la forma del JD, la dimensione dell'azienda, lo stack |

## Pattern E — Trend dei verdetti delle revisioni

Quando il Critico boccia CV che non hanno nulla di concreto su cui reggersi. Il `critic_score` del Critico vive in `applications` dopo il loop a 3 round.

### Rilevazione

```bash
python3 /app/shared/skills/db_query.py applications \
    --critic-score-max 5 --order-by written_at:desc --limit 20
```

Raggruppa le `critic_notes` per modalità di fallimento ricorrente (es. "niente metriche", "mismatch stack", "About troppo generico").

### Soglia

Parla solo se **≥ 5 CV recenti con punteggio < 6** E lo stesso tipo di osservazione appare in ≥ 3 di essi.

### Interpretazione

Un `critic_score < 5` ricorrente con note simili NON significa "lo Scrittore è scarso" — significa che **il profilo non dice abbastanza**. Il fix è a monte:
- About troppo generico → chiedi all'utente un'inflessione concreta di carriera
- Niente metriche → estrai numeri dall'utente (food cost %, riduzioni latenza, headcount, ore risparmiate)
- Mismatch stack → ri-controlla `skills.primary` rispetto ai requisiti reali dei JD

## Incrocio dei pattern

I pattern si rinforzano a vicenda. Segnale forte:
- **A + C** (gap competenze + componente bassa su `stack_match`) → quasi certamente vale la pena parlarne.
- **B `[SENIORITY]` + C `experience_fit`** → disallineamento seniority, menziona una volta.
- **D cluster rifiuti + E critic_score < 5** → problema CV, escala come Pattern E.

Evita **A da solo** quando la competenza è menzionata in sole 5/30 posizioni e nessuna ha punteggio alto — è rumore, resta in silenzio.

## Promemoria cadenza

Questa skill dice **come rilevare**. QUANDO parlare è governato dal prompt del Mentor:
- 🌅 Primo risveglio — percorrimento veloce dei record, un'osservazione se la merita
- 🌗 Giornaliero — passaggio silenzioso, parla solo se un pattern supera la soglia
- 🌕 Settimanale — digest anche se nulla brucia (usa skill `mentor-output`, formato settimanale)
- 📞 Su richiesta — rispondi alla domanda dell'utente con i dati che possiedi

Se non hai nulla di livello pattern da dire, **non dire nulla**. Il silenzio è una risposta.

## Anti-pattern

- ❌ Parlare dopo aver rilevato un singolo hit (1 posizione con requisito `Docker`) — campione troppo piccolo, sembra annaspare.
- ❌ Aggregare su tutto il DB (es. ultimi 6 mesi) — le vecchie posizioni distorcono il segnale di mercato corrente. Resta sugli ultimi 30 giorni a meno che non confronti trend esplicitamente.
- ❌ Usare il campo round `experience_years` per il ragionamento Pattern B/C — calcola gli anni REALI da `candidate.experience[].years` (stessa regola dell'Analista).
- ❌ Parlare da dati web senza prima un pattern basato sui record — i record sono il trigger, il web è la verifica (vedi step di conferma `WebSearch` / `WebFetch` in `mentor.md`).
- ❌ Catastrofismo ("questo non porta da nessuna parte") O cheerleading ("ce la puoi fare!") — entrambi violano la voce del Mentor. Numeri, poi una domanda. Vedi skill `mentor-output`.

## Vedi anche

- `mentor-output` — COME formulare il messaggio una volta che un pattern è confermato.
- `db-query` — internals del wrapper.
- `agents/mentor/mentor.md` — prompt orchestratore + cadenza.
- `agents/_team/team-rules.md` T10 — il profilo è read-only, anche per il Mentor.
