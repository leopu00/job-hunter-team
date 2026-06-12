# 🧠 Idle Enrichment — usare il tempo morto del team per arricchire il DB

**Stato:** 💡 idea / roadmap (non implementato)
**Data:** 2026-06-06
**Origine:** osservazione durante le simulazioni lunghe (settimane) del team

## 🔍 Il problema: il team si ferma

Durante le simulazioni lunghe (ordine di settimane) emerge un pattern ricorrente:

1. dopo alcuni giorni gli **Scout esauriscono le posizioni nuove** raggiungibili sul web e si fermano;
2. il resto del team (Analisti, Scorer, Critico, Scrittori) **smaltisce l'arretrato** e poi si ferma a sua volta;
3. si apre una **finestra di idle**: gli agenti sono accesi (token già pagati) ma non producono valore.

Questo idle ha un **costo fisso** non trascurabile (vedi `project_idle_burn` / sessioni precedenti): paghiamo presenza senza output.

## 💡 L'idea: convertire l'idle in arricchimento proattivo

Invece di lasciare il team fermo quando non c'è nuovo flusso da processare, attivare un **"enrichment mode"**: lavoro che non dipende da nuove posizioni e che **rende immediati i calcoli futuri**, a costo marginale ~zero (l'idle lo paghiamo comunque).

### 🎯 Pilota: netto-stipendio precomputato per-paese

Caso guida concreto, collegato alla feature "distribuzione stipendi" della dashboard:

1. l'**Analista** osserva la concentrazione geografica delle offerte (es. molti stipendi in 🇮🇹 IT, 🇮🇪 IE, 🇩🇪 DE, 🇳🇱 NL — cfr. `2026-06-04-scout-geo-concentration.md`);
2. nell'idle costruisce i **"paletti" fiscali** per quei paesi e li salva nel DB:
   - aliquote IRPEF/income-tax **progressive a scaglioni**,
   - contributi previdenziali,
   - numero di **mensilità** (13/14 in Italia),
   - detrazioni base;
3. in futuro il calcolo del **netto** in base a `offerta + profilo utente` diventa un **lookup immediato**, non un ricalcolo a runtime.

> Questo è il motivo per cui oggi NON facciamo "netto = lordo / 12" al volo: il netto serio è per-paese, progressivo e costoso. Precomputare le regole nell'idle è la mossa corretta. La dashboard mostra già il **lordo annuo** e il **lordo mensile** (÷12); il **netto** resta volutamente fuori finché non esiste questa base dati.

## 🌐 Generalizzazione

Lo stesso schema vale per qualsiasi knowledge base utile, popolabile nell'idle:

- benchmark salari per **ruolo × città**;
- **costo della vita** per località (per normalizzare gli stipendi);
- **tassi di risposta** storici per company / settore;
- normalizzazione valute / seniority / skill.

## 🛠️ Note di implementazione (quando si farà)

- Prevedere uno stato esplicito **`enrichment`** nel pacing/working-hours del team, che si attiva quando: Scout a secco **e** arretrato di Analisti/Scorer smaltito.
- Tabelle DB dedicate (es. `tax_rules_by_country`) con versioning/data di validità (le aliquote cambiano per anno fiscale).
- Primo task: popolare `tax_rules_by_country` per i 4–6 paesi più ricorrenti.
- Guardrail: l'enrichment non deve consumare budget oltre una soglia, né bloccare la ripresa degli Scout quando ricompaiono posizioni nuove.

## 🔗 Correlati

- `2026-06-04-scout-geo-concentration.md` — concentrazione geografica delle offerte
- `2026-05-23-position-classifier-llm-roadmap.md` — altro arricchimento data-driven del team
- Feature dashboard "Distribuzione Stipendi" + convertitore valuta (lordo annuo / mensile)
