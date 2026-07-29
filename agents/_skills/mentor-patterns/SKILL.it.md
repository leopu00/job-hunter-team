<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: mentor-patterns
description: I sei pattern che il Mentor cerca nei record per decidere QUANDO parlare. Il silenzio è il default; solo un pattern reale e ricorrente merita una parola. Questa skill fornisce il metodo canonico di rilevazione per ogni pattern (query DB + soglia) così il Mentor non parla mai da un singolo data point. Read-only — non scrive mai nel DB. Responsabilità del Mentor.
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/feedback_query.py *), Bash(grep *), Bash(awk *)
---

# mentor-patterns — cosa rivelano i record

Il Mentor osserva insiemi, non punti singoli. Sei pattern meritano di parlarne; tutto il resto è rumore.

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

## Pattern F — Motivi ricorrenti nelle parole dell'utente

Dal web l'utente giudica le posizioni (poco interessante / interessante / molto interessante, più "escludi") e può scrivere **perché**, in testo libero: `reason` (≤ 500 caratteri) e `comment` (≤ 2000). Quel testo è l'unico posto in cui dice cosa vuole con parole sue. Letto una posizione alla volta è un aneddoto; contato insieme è un fatto. Dieci "troppo senior" non sono dieci opinioni su dieci annunci — sono una frase sola sulla ricerca.

Attenzione alla differenza col Pattern B: lì le esclusioni sono degli **agenti** (`ESCLUSA: [TAG]` in `positions.notes`), qui il giudizio è dell'**utente**. Due flussi diversi; quando concordano, vedi la sezione di incrocio.

Questo feedback vive nel cloud (`position_feedback`), non in `jobs.db`: è l'unico pattern che non passa da `db_query.py`.

### Rilevazione

```bash
# I temi nei motivi scritti dall'utente, ultimi 30 giorni
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3

# Lo stesso feedback non aggregato, per leggere le sue parole esatte
python3 /app/shared/skills/feedback_query.py recent --days 30
```

`themes` raggruppa il testo libero per somiglianza semplice — nessun match esatto richiesto. Mette in minuscolo, toglie accenti, punteggiatura e parole di servizio, taglia ogni parola ai primi 5 caratteri (`senior` / `seniority` / `seniore` / `séniorité` finiscono sulla stessa chiave), poi conta parole singole e coppie adiacenti per **posizioni distinte**. Una coppia vince sulle sue parti quando copre le stesse posizioni: "troppo senior" dice più di "senior", e gli intensificatori sono tenuti apposta per questo.

Per ogni tema ritorna `positions`, `events`, `share` (frazione delle posizioni che portano testo), `actions` (come il tema si divide fra like / dislike / hide / star), `legacy_ids` e fino a 3 `examples` verbatim.

È grezzo per costruzione e si vede: i sinonimi lontani restano separati (`stipendio` e `RAL` sono due temi). Leggi gli `examples` e unisci con la testa quello che lo strumento non poteva.

Se il payload porta una `note` (`no-signal (...)`), il cloud è spento o irraggiungibile e l'aggregato non c'è: taci, non ricostruire il quadro con chiamate `check` posizione per posizione.

### Soglia

Parla solo se valgono **tutte e tre**:

- **≥ 8 eventi di feedback portano testo** (`events_with_text`). Scrivere un motivo costa fatica all'utente, quindi questo volume sta un ordine di grandezza sotto qualunque conteggio prodotto dalle macchine — ma sotto 8 una percentuale non significa niente (con 3 testi, un tema è già un terzo).
- Il tema copre **≥ 4 posizioni distinte** (`positions`, mai `events`: giudicare due volte lo stesso annuncio è un'opinione sola, e contare gli eventi farebbe sembrare un trend un singolo annuncio ostinato).
- Lo **`share` del tema è ≥ 0,30**. Il testo libero spacca la stessa obiezione reale su più sinonimi, quindi la dominanza è diluita per costruzione; il Pattern B può chiedere il 40% perché i suoi tag sono un vocabolario chiuso. A volume basso vincola la regola delle 4 posizioni, a volume alto lo share — è voluto.

Sotto quella soglia, non dire niente. Un "troppo senior" è un'osservazione su un annuncio.

### Interpretazione

Il tema dice dove guardare; i record dicono se è un problema.

| Famiglia di temi (esempi)                          | Dove punta                                                             |
|----------------------------------------------------|------------------------------------------------------------------------|
| Seniority ("troppo senior", "troppo junior")       | La fascia dichiarata in `seniority_target` vs come la chiama il mercato |
| Stack ("Java legacy", "niente PHP")                | `skills.primary` — stack dichiarato e stack voluto che divergono (incrocia con A) |
| Retribuzione ("stipendio basso", "nessuna RAL")    | Aspettativa salariale vs fasce pubblicate (incrocia con C `salary_fit`) |
| Luogo ("in sede", "troppo lontano", "niente remoto")| `work_mode` / `relocation` (incrocia con C `remote_fit`)               |
| Azienda / settore ("agenzia", "consulenza")        | Una preferenza mai scritta nel profilo                                 |
| L'annuncio stesso ("vago", "nessuna info")         | Qualità dell'annuncio, non fit — una riga solo se domina, e come rumore, non come leva |

**Il rilievo che vale una frase è il disaccordo.** Incrocia i `legacy_ids` del tema con i loro punteggi (`db_query.py scores`). Quando l'utente continua a scartare posizioni che lo Scorer ha messo sopra 70, il punteggio non è rotto — sta misurando fedelmente l'aderenza a un **profilo che ha smesso di descrivere quello che l'utente vuole**. Il profilo per te è read-only (T10): tu dici il numero e fai la domanda, decide lei.

### Esempio di output

> *"<Nome>, negli ultimi trenta giorni hai scritto un motivo su diciannove posizioni. Su sette — più di un terzo — le parole erano le stesse: **troppo senior**. Cinque di quelle sette lo Scorer le aveva messe sopra 70: stava leggendo il tuo profilo, che dichiara ancora un target senior. Il target si è spostato, o quelle sette erano solo annunci scritti male?"*

## Incrocio dei pattern

I pattern si rinforzano a vicenda. Segnale forte:
- **A + C** (gap competenze + componente bassa su `stack_match`) → quasi certamente vale la pena parlarne.
- **B `[SENIORITY]` + C `experience_fit`** → disallineamento seniority, menziona una volta.
- **D cluster rifiuti + E critic_score < 5** → problema CV, escala come Pattern E.
- **F + B sullo stesso tema** (l'utente scarta per seniority E gli agenti escludono per `[SENIORITY]`) → il problema è la fascia dichiarata, non il mercato. È il segnale più forte che esista, perché arriva da due flussi indipendenti.
- **F + C sulla stessa leva** (`salary_fit` / `remote_fit`) → il modello di punteggio e l'utente indicano lo stesso attrito. Una frase, non due.
- **F contro punteggi alti** → deriva del profilo, vedi l'interpretazione del Pattern F.

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
- ❌ **Trasformare il Pattern F in un'istruzione di ricerca.** Non passare mai allo Scout o al Capitano un "smetti di portare X" ricavato da quello che piace all'utente. Una pipeline che pesca solo ciò che piace si gonfia i punteggi da sola, e l'utente finisce per credere che il mercato sia ricco quando è stata la pipeline a scegliere per lei. Il Pattern F è rivolto **all'utente**: cosa cambia nel suo profilo lo decide lei, e tu sei comunque read-only (T10).
- ❌ Rinfacciare un giudizio che l'utente ha ritirato. `themes` lascia già fuori le posizioni il cui ultimo evento è `clear`; non rimetterle dentro con `--include-cleared` per arrivare a una soglia.
- ❌ Citare un singolo commento verbatim come se fosse un pattern. Gli `examples` danno voce a un tema **dopo** che ha superato la soglia; non sono il rilievo.

## Vedi anche

- `mentor-output` — COME formulare il messaggio una volta che un pattern è confermato.
- `db-query` — internals del wrapper.
- `feedback-query` — il lettore del feedback utente nel cloud (Pattern F); lo Scorer interroga la stessa fonte una posizione alla volta.
- `agents/mentor/mentor.md` — prompt orchestratore + cadenza.
- `agents/_team/team-rules.md` T10 — il profilo è read-only, anche per il Mentor.
