<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: db-update
description: Aggiorna record esistenti nel DB JHT (positions / applications). Usala per promuovere posizioni a checked/excluded, scrivere punteggio/verdetto del Critico, marcare application come inviate, aggiornare salario, last-checked, ecc. Sempre dopo un `db-query` che conferma lo stato corrente del record.
allowed-tools: Bash(python3 *)
---

# db-update — aggiornamento record nel DB JHT

Wrapper in `/app/shared/skills/db_update.py`. Aggiorna campi specifici su record esistenti. **Non crea** record — per quello, vedi `db-insert`.

## Pattern generale

```bash
python3 /app/shared/skills/db_update.py <table> <id> --<field> <value> [--<field> <value>...]
```

Tabelle: `position`, `application`.

## Positions

```bash
# Promuovi a checked / excluded (lavoro dell'Analista)
python3 /app/shared/skills/db_update.py position 42 --status checked
python3 /app/shared/skills/db_update.py position 42 --status excluded

# Marker last-checked (link confermato vivo — usato anche come claim anti-collisione)
python3 /app/shared/skills/db_update.py position 42 --last-checked now

# Liveness: --is-open / --last-open-check fanno avanzare da soli anche
# last_checked, così una posizione ricontrollata esce dalla coda della cura
# (che gata sulla più recente delle due date). --last-checked solo per forzarla.
python3 /app/shared/skills/db_update.py position 42 --is-open false --last-open-check now

# Salario come dichiarato nel JD
python3 /app/shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Salario stimato (glassdoor / levels.fyi / stima dell'analista)
python3 /app/shared/skills/db_update.py position 42 --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Famiglia ruolo (categoria semantica).
python3 /app/shared/skills/db_update.py position 42 --role-family "Technical Writing"

# Location strutturata (Analista). Esempio pieno per "Dublin, Ireland" hybrid:
python3 /app/shared/skills/db_update.py position 42 \
  --loc-city "Dublin" --loc-region "Leinster" \
  --loc-country "Ireland" --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" --work-country-code "IE" \
  --is-multi-location false

# Esempi casi speciali:
# A) "Europe Remote" → country=NULL, continent=EU, work_country dall'HQ azienda
python3 /app/shared/skills/db_update.py position 42 \
  --loc-continent "Europe" --work-mode "remote" \
  --work-country "United States" --work-country-code "US" \
  --location-notes "Remote within EU, US-based company"

# B) "Italy" + full_remote
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Italy" --loc-country-code "IT" --loc-continent "Europe" \
  --work-mode "remote" --work-country "Italy" --work-country-code "IT"

# E) Multi-location stesso paese ("Barcelona / Malaga")
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Spain" --loc-country-code "ES" --loc-continent "Europe" \
  --work-mode "hybrid" --work-country "Spain" --work-country-code "ES" \
  --is-multi-location true --location-notes "Barcelona or Málaga (candidato sceglie)"

# Per "ripulire" un campo (set NULL) passa stringa vuota:
python3 /app/shared/skills/db_update.py position 42 --loc-city ""
```

## Applications

```bash
# Verdetto del Critico (per round: NEEDS_WORK / PASS / REJECT) + punteggio 0-10 + note
python3 /app/shared/skills/db_update.py application 42 --critic-verdict NEEDS_WORK --critic-score 5.0 --critic-notes "serve più dettaglio sul progetto X"

# CV/cover letter committati (lo Scrittore marca come scritto)
python3 /app/shared/skills/db_update.py application 42 --written-at now

# Promuovi a ready dopo il PASS del Critico — solo lo Scrittore, in application-flow Step 7
python3 /app/shared/skills/db_update.py application 42 --status ready

# L'utente ha confermato l'invio della candidatura
python3 /app/shared/skills/db_update.py application 42 --applied-at "2026-02-28" --applied-via linkedin
python3 /app/shared/skills/db_update.py application 42 --applied true

# Risposta ricevuta (colloquio / rifiuto / ghosted)
python3 /app/shared/skills/db_update.py application 42 --response "rejected" --response-at now
```

### Le transizioni di stato delle posizioni sono auto-loggate (bug #14)

Ogni chiamata a `db_update.py position <id> --status <s>` che effettivamente
cambia `positions.status` inserisce una riga in `position_state_transitions`
con `from_state`, `to_state`, `ts`, `by_agent` (da `JHT_AGENT_NAME`),
e le `--notes` che hai passato (se presenti). Lo stesso per il primo
`db_insert.py position` (loggato come `NULL → 'new'`).

Non devi fare nulla — il wrapper lo gestisce. Non bypassarlo
con SQL grezzo: un workaround `python3 -c "import sqlite3; UPDATE positions SET
status=..."` salta il log delle transizioni e fa sottostare i grafici
throughput / funnel.

### Gate single-writer su `applications.status='ready'` (bug #21)

`applications.status='ready'` è **impostato esclusivamente dallo Scrittore** in
`application-flow` Step 7, **solo dopo** il PASS del Critico al 3° round.
Questo è il gate che rende il CV visibile sulla dashboard `/ready`
dell'utente. Gli altri agenti:

- **Critico**: scrive solo `critic_verdict` + `critic_score`. Mai `status`.
- **Capitano**: non scrive mai `applications.status`. Può leggerlo.
- **Mentor / Assistente**: read-only sulle `applications`.

Senza questo gate, il Capitano può riportare "12 ready" verbalmente mentre il
DB mostra ancora 0 — esattamente la divergenza che il bug #21 ha fixato.

## Regole di sicurezza

1. **Leggi prima.** Esegui `db-query position <id>` (o `application`) per vedere lo stato corrente prima di scrivere. Sovrascritture alla cieca producono record inconsistenti.
2. **Il flusso di status è solo in avanti.** Transizioni legittime: `new → checked → scored → writing → ready → applied → response`. `excluded` è raggiungibile da qualsiasi step ma nessuno step va mai indietro. Non invertire.
3. **Timestamp `now`.** Il wrapper converte la stringa letterale `now` nel timestamp corrente. Non passare `$(date)` — il parsing è gestito lato Python.
4. **Tag di esclusione nelle `--notes`.** Quando marchi una posizione `excluded`, prefissa le note con uno dei tag canonici: `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` · `[STACK]`. Stessa tassonomia usata dall'Analista (vedi `agents/analista/analista.md` REGOLA-06).

## Non usarla per

- Letture: usa **`db-query`**
- Creare record: usa **`db-insert`** (solo lo Scout fa INSERT sulle positions)
- Modifiche schema: mai eseguire `sqlite3` grezzo sulle tabelle — bypassa foreign key e il journaling WAL di Next.js
