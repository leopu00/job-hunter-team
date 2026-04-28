# Ottimizzazioni Team Job Hunter

Registro delle ottimizzazioni applicate agli agenti, con pattern osservati e fix.

---

## OPT-001 — Scout: Strategia Tool (22/02/2026)

**Problema**: Gli scout sprecavano 30% dei turni tentando `fetch` su siti bloccati da robots.txt (LinkedIn, Wellfound, Revolut, WTTJ), per poi passare al tool corretto solo dopo l'errore.

**Fix**: Aggiunta tabella "Strategia d'uso" nel CLAUDE.md con mapping sito → tool corretto. Lista esplicita dei siti bloccati.

**File modificati**: scout-1/CLAUDE.md, scout-2/CLAUDE.md, scout-3/CLAUDE.md

---

## OPT-002 — Scout: Fallback LinkedIn auth (22/02/2026)

**Problema**: Il tool `linkedin` MCP dà "authentication_failed" intermittente. Gli scout riprovavano subito, sprecando turni.

**Fix**: Istruzione di NON riprovare subito, aspettare 2-3 turni facendo altro, usare `jobspy` come alternativa per bulk search.

**File modificati**: scout-1/CLAUDE.md, scout-2/CLAUDE.md, scout-3/CLAUDE.md

---

## OPT-003 — Scout: Inserimento DB veloce (22/02/2026)

**Problema**: Gli scout leggevano tanti JD ma inserivano poco nel DB. Aspettavano di avere tutti i dati completi prima di inserire.

**Fix**: Regola "insert fast, update later" — inserire appena trovata la posizione con dati parziali (titolo + azienda + URL), aggiornare il JD dopo.

**File modificati**: scout-1/CLAUDE.md, scout-2/CLAUDE.md, scout-3/CLAUDE.md

---

## OPT-004 — Scout: Condizione di arresto (22/02/2026)

**Problema**: Gli scout andavano avanti all'infinito, ciclando sulle stesse fonti con query diverse. Senza intervento manuale non si fermavano mai.

**Fix**: Aggiunta sezione "Condizione di arresto":
- Un ciclo = coprire tutte le fonti assegnate con 2-3 query
- Max ~15-20 minuti
- Riepilogo obbligatorio a fine ciclo
- STOP e attesa istruzioni
- Mai ricominciare sulle stesse fonti già coperte

**File modificati**: scout-1/CLAUDE.md, scout-2/CLAUDE.md, scout-3/CLAUDE.md

---

## OPT-005 — Scout: Comunicazione Alfa (22/02/2026)

**Problema**: Gli scout tentavano di inviare messaggi tmux alla sessione `🐺 ALFA` che potrebbe non esistere, causando errori "can't find pane".

**Fix**: Istruzione di verificare con `tmux has-session` prima di inviare. Il Capitano legge via capture-pane, non serve inviargli messaggi.

**File modificati**: scout-1/CLAUDE.md, scout-2/CLAUDE.md, scout-3/CLAUDE.md

---

## OPT-006 — Scout: Disponibilità geografica e relocation (22/02/2026)

**Problema**: Gli scout cercavano quasi esclusivamente con `is_remote: true` e query "remote EU". Tagliavano fuori tutto il mercato on-site/ibrido con relocation. Il candidato è disponibile a trasferirsi in tutta l'UE.

**Fix**:
- Aggiunta sezione "DISPONIBILITÀ GEOGRAFICA" nel profilo candidato dentro il CLAUDE.md
- Candidato disponibile a relocation (dettagli in candidate_profile.yml)
- Unica esclusione dura: "US work authorization required"
- Query di ricerca aggiornate per includere città specifiche (Berlin, Amsterdam, London, etc.)
- Rimosso "On-site fuori Roma" come criterio negativo

**File modificati**: scout-1/CLAUDE.md, scout-2/CLAUDE.md, scout-3/CLAUDE.md

---

## OPT-007 — Scout: Protocollo cerchi concentrici (22/02/2026)

**Problema**: Gli scout cercavano in modo disordinato, senza una priorità geografica chiara. Usavano split per fonte (LinkedIn vs Indeed) anziché per tipo di opportunità, causando sovrapposizioni.

**Fix**:
- Protocollo "Cerchi concentrici": 5 cerchi dal più vicino all'esterno (Remote EU → Roma → Italia → EU capitals → Resto EU)
- Split tra scout per tipo di opportunità, NON per fonte:
  - 2 scout: A = Remote+Italia (cerchi 1-3), B = On-site EU relocation (cerchi 4-5)
  - 3 scout: A = Remote EU, B = Italia, C = On-site EU relocation
- Tutti usano TUTTE le fonti, ma con query diverse per il proprio cerchio
- Aggiunta lista career pages Tech EU (Spotify, Booking, Adyen, Wise)
- Termini di ricerca specifici per ogni cerchio

**File modificati**: scout-1/CLAUDE.md, scout-2/CLAUDE.md, scout-3/CLAUDE.md

---

## OPT-008 — Scorer+Scrittori: Practice interview strategy (22/02/2026)

**Problema**: Posizioni con score 40-69 venivano scartate ("candidarsi se c'è tempo" o "parcheggiare"). Ma queste posizioni sono utili per fare pratica di colloquio prima di candidarsi alle posizioni TOP.

**Fix Scorer**:
- Nuovi tiers: 🟢 CANDIDATURA SERIA (>=70), 🟡 PRACTICE INTERVIEW (40-69), 🔵 SOLO RIFERIMENTO (<40)
- Scorer deve specificare il tier nel campo notes del DB
- Fix penalità on-site: rimossa penalità -10 per on-site fuori Roma (candidato disponibile a relocation). Aggiunta penalità -25 per on-site fuori UE / US work authorization
- Aggiunta disponibilità geografica nel profilo candidato dello scorer

**Fix Scrittori**:
- 3 livelli di effort: SERIA = CV personalizzato + CL su misura; PRACTICE = CV standard + CL template; RIFERIMENTO = non scrivere nulla
- Priorità: lavorare PRIMA sulle SERIE, POI sulle PRACTICE
- Query aggiornata: non più solo >= 70, ma >= 40 (ordinate per score desc)

**File modificati**: scorer/CLAUDE.md, scrittore-1/CLAUDE.md, scrittore-2/CLAUDE.md

---

## OPT-009 — Analisti: Pulizia dati e filtraggio (22/02/2026)

**Problema**: Lo scorer trovava errori grossolani che avrebbero dovuto essere catturati dagli analisti: nomi azienda sbagliati (Hoverture→Adentis, RTB House→Reggie & Cole, DualEntry→Lumenalta), posizioni US-only, stack senza Python. Gli analisti verificavano solo che la JD fosse attiva e inserivano l'azienda, senza correggere dati errati nel DB né filtrare posizioni non idonee. Passavano tutto come `checked`.

**Fix**:
- Compito CRITICO: pulizia dati — gli analisti correggono nome azienda, location, remote type con `db_update.py` (non solo nelle note)
- Nuovo status `excluded` per posizioni non idonee (US-only, no Python, senior 5+, scam, UK-only post-Brexit)
- Lista esplicita criteri di esclusione nel CLAUDE.md
- Lo scorer deve ricevere SOLO dati puliti e posizioni realmente idonee

**File modificati**: analista-1/CLAUDE.md, analista-2/CLAUDE.md

---

## OPT-010 — Scorer: Elaborazione sequenziale (22/02/2026)

**Problema**: Lo scorer caricava tutte le posizioni in un unico batch via bash loop, saturando il contesto. Con 35+ posizioni, questo causava lentezza e rischio di scoring impreciso.

**Fix**: Regola "UNA POSIZIONE ALLA VOLTA, MAI IN BATCH" nel CLAUDE.md. Ciclo: query next → dettaglio → score → insert → aggiorna status → torna al punto 1.

**File modificati**: scorer/CLAUDE.md, scorer-2/CLAUDE.md

---

## OPT-011 — Scout+Analisti: URL e deadline obbligatori (22/02/2026)

**Problema**: 29 posizioni migrate e alcune trovate dagli scout non avevano URL. Senza URL la posizione è inutile: il Comandante non può controllare né candidarsi. Inoltre nessuna posizione tracciava la data di scadenza, rendendo impossibile sapere quali JD sono ancora attive.

**Fix**:
- `--url` reso OBBLIGATORIO in `db_insert.py position` — lo script fallisce senza URL
- Aggiunta colonna `deadline` al DB (YYYY-MM-DD o "non presente")
- `--deadline` aggiunto a `db_insert.py` e `db_update.py`
- Scout: regole 4-5 obbligano URL e deadline ad ogni inserimento
- Analisti: step c-d verificano URL presente e deadline, cercano URL mancanti
- Analisti: JD scadute/404 → `excluded`
- `excluded` aggiunto come status valido in `db_update.py`
- Dashboard: mostra deadline nelle card

**File modificati**: `_db.py`, `db_insert.py`, `db_update.py`, `generate_dashboard.py`, scout-1/2/3/CLAUDE.md, analista-1/2/CLAUDE.md

---

## Template per nuove ottimizzazioni

```
## OPT-XXX — [Ruolo]: [Titolo] (data)

**Problema**: ...
**Fix**: ...
**File modificati**: ...
```
