# 🌍 Scout geo-concentration — over-concentrazione su una città (2026-06-04)

> Analisi su run beta live (profilo finance, target EU, provider Codex). PII del
> tester rimossa (nome/indirizzo). Cifre dai dati live: `jobs.db`,
> `scout_workspace.json`, `messages.jsonl`.
> Correlato: [`2026-05-23-location-playbook.md`](2026-05-23-location-playbook.md).

## 🔎 Fenomeno

Su 72 posizioni trovate, **46 (64%) sono a Londra**, una città **mai richiesta**
dall'utente. Delle 10 *priority cities* indicate dall'utente, **6 hanno ZERO
risultati**.

| Città | Paese | # Pos | # Scored | Media | Priority? |
|---|---|---:|---:|---:|---|
| **London** | GB | **46** | 44 | 78.3 | ❌ non in lista |
| (n/d) | — | 7 | 2 | 66.5 | — |
| Dublin | IE | 4 | 4 | 71.8 | no (accettabile) |
| Zurich | CH | 3 | 3 | 85.3 | ✅ |
| Madrid | ES | 3 | 3 | 74.7 | ✅ |
| Amsterdam | NL | 2 | 2 | 86.0 | no |
| Milan | IT | 2 | 2 | 75.5 | ✅ |
| Stockholm | SE | 2 | 2 | 92.0 | no (Nordics ok) |
| Munich | DE | 1 | 1 | 90.0 | ✅ |
| Paris | FR | 1 | 1 | 81.0 | no |
| Athens | GR | 1 | 0 | — | no |

**Priority cities scoperte (0 risultati): Vienna, Geneva, Lyon, Nice, Barcelona,
Lisbon.** Coperte solo Milan(2), Zurich(3), Madrid(3), Munich(1) = 9 su 72.

Londra arriva da **fonti multiple** (28 LinkedIn + 15 Greenhouse + 3 altre) e da
**entrambi gli scout** (scout-1 28/47, scout-2 18/25) → è sistemico, non un
artefatto di una fonte o di un agente.

## 🧭 Cosa ha chiesto l'utente (conversazioni live)

L'utente, via Telegram, ha specificato (testuale):
- *"work somewhere in Europe, preferably Western Europe, Nordics also intrigue me"*
- *"The best locations would be Milan, Vienna, Zurich, Geneva, Lyon, Nice,
  Barcelona, Madrid, Lisbon, Munich"* — **Londra non è in lista**
- *"but again, I'm open to all exciting roles that match my preferences"* → soft
- *"roles where English and only Hungarian are required languages"* → **English-only**
- *"solely willing to move to BIG cities … international vibe, abundant
  opportunities"*

## ✅ Cosa ha fatto il team (corretto)

Il Capitano ha **recepito e inoltrato correttamente**:
- 13:39 `Capitano→scout`: priority cities forwardate per intero.
- 13:40: *"Treat the priority city list as **prioritization, NOT hard filters**"*
  (richiesta esplicita dell'utente).
- Scout ACK: *"Circle 1 prioritizza Milan/Vienna/.../Munich"*, *"priority cities
  first; broader strong matches only in large international hubs"*.

Il sistema **non ha ignorato l'utente**.

## 🧩 Causa radice (perché esce quasi solo Londra)

1. **Massimo globale dei vincoli dell'utente = Londra.** English-only + grande
   hub internazionale + finance front-office abbondante ha un unico massimo
   europeo: Londra (capitale finanziaria anglofona). Le priority cities hanno
   pochissimi ruoli finance front-office *English-only* → quasi nulla emerge.
2. **Granularità di ricerca = continente, non città.** Le source rivendicate in
   `scout_workspace.json` sono `linkedin:finance-priority-cities:**europe**`,
   `ashby:...:**europe**`: la ricerca è europe-wide, lascia che l'offerta
   (London-heavy) domini. Le priority cities sono solo un *tema keyword*, mai una
   dimensione `:location` per-città.
3. **Prioritizzazione mai operazionalizzata.** "Soft priority" è stato
   riconosciuto a parole ma **non esiste un meccanismo** che distribuisca/quoti
   le ricerche tra le priority cities o boosti quelle scoperte → effetto zero sul
   mix geografico.
4. **Relight "undershoot" amplifica.** 6 rilanci *"PIPELINE STALLED + UNDERSHOOT
   → bounded high-fit batch"* ripescano ogni volta il mercato a massima offerta
   (Londra), invece di riempire le città scoperte.
5. **Nessun check di diversità.** Nessun agente (scout/capitano/mentor) ha **mai
   notato** lo squilibrio. Manca del tutto un controllo di coverage geografico.

## 🎯 Verdetto

Fenomeno **emergente**, non richiesto dall'utente e non un bug puntuale:
vincoli utente (English-only + big-hub) × priority soft × ricerca europe-wide ×
relight high-fit × **assenza di controllo di copertura** = monocultura London non
rilevata. Il sistema ha seguito le regole alla lettera, ma le regole **non
garantiscono la copertura delle città prioritarie**.

---

## 🛠️ Implementazioni proposte

> Principio guida (guardrail): l'utente ha detto **soft, non hard**, *"open to all
> exciting roles"*. Il fix deve garantire **copertura/diversità** delle priority
> cities **senza escludere** Londra dove i ruoli sono genuinamente ottimi.
> Bilanciamento (quota + tie-break soft), non un filtro che taglia Londra.

### 1. ⭐ Capitano = bilanciatore geografico (lever primario)
Il Capitano fa *throughput control* (riempi la coda vuota) ma **zero coverage
control** (come è distribuito). Aggiungere un loop periodico (ogni N posizioni o
a ogni relight), regola di prompt **C-geo**:
- **Coverage report** — `db_query` nuovo su `jobs.db`: per priority-city →
  `#trovate, %share, #scored, media`.
- **Regola di squilibrio** — se una città > ~40-50% del totale **E** ci sono
  priority cities sotto soglia (es. <3) → trigger rebalance.
- **Direttiva correttiva** — search-map mirata: *"London saturo: prossimi 3 batch
  su Vienna, Barcelona, Lisbon"*.

### 2. ⭐ Ricerca per-città (operazionalizza il soft priority)
La taxonomy `scout_workspace.py` già supporta `<provider>:<keyword>:<location>`:
iterare le priority cities come dimensione location
(`linkedin:finance:vienna`, `:barcelona`, …) con **quota minima per città** prima
di allargare a `:europe`.

### 3. ♻️ Relight "undershoot" che riempie i buchi
Quando rilancia per undershoot, il Capitano sceglie la **città meno coperta**, non
l'high-fit generico → l'undershoot diventa meccanismo di copertura, non
amplificatore di Londra.

### 4. 📉 Rilevamento saturazione via dedup (segnale già esistente)
`scout_dedup.py` già logga gli skip (es. "Company 033 apparso 14×"). Quando lo
**skip-rate su una città sale**, il valore marginale di altre ricerche lì → 0:
pivot geografico automatico. Diversità agganciata a un segnale gratuito.

### 5. 📒 Coverage ledger: "cercato-e-vuoto" vs "mai cercato"
Registro `città → {cercata, #trovate, ultimo_tentativo}`. Permette al Capitano di
sapere **se insistere o accettare** che una città è thin, e di dare un **report
onesto all'utente** (*"Vienna: cercata, solo 1 ruolo English front-office
disponibile"*).

### 6. ⚖️ Tie-break geografico soft nello Scorer
A parità di fit, +2-3 punti alle priority-city. Rispetta il "soft" (niente
esclusione di Londra) ma spinge la shortlist verso le preferenze dell'utente
anche con offerta London-heavy.

### 7. 👤 Steering geografico lato utente
`feedback-query` già supporta `more_like_this`/`less_like_this` **per location**.
Esporre un pannello coverage (web/Telegram) — *"London 46 · priority coperte
4/10"* — e lasciare *"meno Londra, più Vienna/Barcelona"* → deprioritizza gli
sweep London. Geografia come asse di steering di prima classe.

### Priorità suggerita
- **Core**: #1 (Capitano coverage-check) + #2 (per-città).
- **Quasi gratis**: #3 e #4 (riusano relight + dedup esistenti).
- **Polish**: #5, #6, #7.

## 📌 File coinvolti (per il fix futuro)
- `agents/capitano/*.md` → nuova regola **C-geo** (coverage check + rebalance).
- `agents/_skills/` → nuovo skill `coverage-report` (query `jobs.db`).
- `agents/scout/*.md` + `shared/skills/scout_workspace.py` → location per-città
  nella taxonomy delle source.
- `agents/_skills/circles-and-sources/SKILL.md` → derivare sweep per-città dalle
  priority cities del profilo.
- `shared/skills/scout_dedup.py` → esporre skip-rate per città (saturazione).
- `agents/_skills/feedback-query/SKILL.md` → steering geografico (già per location).
- Scorer prompt → tie-break soft priority-city.
