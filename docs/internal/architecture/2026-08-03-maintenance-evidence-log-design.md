# 🔬 Storico dei controlli di manutenzione — design 2026-08-03

**Stato**: ✅ implementato il 2026-08-03. Non ancora deployato sulle VPS: richiede rebuild immagine.

Due problemi distinti, una tabella sola.

---

## Problema 1 — la storia dei controlli si sovrascrive

`positions.last_checked` e `last_open_check` tengono **solo l'ultima data**. Ad ogni giro di manutenzione la precedente sparisce. Quindi non è possibile rispondere a domande elementari:

- quante volte abbiamo guardato questa posizione?
- da quanto non la tocchiamo?
- quante volte abbiamo provato a verificarla **senza riuscirci**?

Lo stesso vale per `scores`: `INSERT OR REPLACE` sovrascrive in silenzio, quindi un re-score che lascia il punteggio identico è indistinguibile da un re-score mai eseguito.

Conseguenza pratica: le cifre di manutenzione (*"94 posizioni ricontrollate in 4 giorni"*) contano **righe toccate**, non controlli. Non c'è modo di sapere quanti di quei 94 abbiano concluso qualcosa.

---

## Problema 2 — l'incerto rischia di finire nel cestino

Quando un agente non riesce ad accertare se un annuncio è ancora aperto, l'esito corretto è **lasciare la posizione com'è e ritentare**. Non sapere non è sapere che è scaduta.

La skill `recheck-liveness` lo prescrive già, con un vocabolario a tre stati:

| state | significato | cosa fare |
|---|---|---|
| `OPEN` | aperto verificato | `is_open=1` |
| `CLOSED` | 404/410 o closed-marker | `status='expired'` |
| `OPEN_UNVERIFIED` | authwall, JS, browser giù | **lascia `is_open` invariato** |

Ma è **prosa in un file di skill**: nessuna riga di codice la impone. Un agente che scrive `--is-open false` dopo un controllo fallito lo può fare, e nessuno se ne accorge — la posizione esce dal radar e nessuno la guarda più.

> ⚠️ Chiudere una posizione è l'unica operazione di manutenzione **irreversibile nei fatti**. Una coordinata sbagliata o un logo mancante si correggono al giro dopo; un'offerta chiusa per dubbio è un'occasione persa in silenzio. È l'unica scrittura che merita un divieto nel codice.

---

## Schema

Una tabella append-only, modellata su `position_state_transitions` (stesse convenzioni: `id` autoincrement, `ts` con default, `by_agent`, indici per target e per tempo).

```sql
CREATE TABLE IF NOT EXISTS maintenance_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    by_agent      TEXT NOT NULL,
    target_type   TEXT NOT NULL,      -- position | company
    target_id     INTEGER NOT NULL,
    action        TEXT NOT NULL,
    outcome       TEXT NOT NULL,
    field         TEXT,               -- campo toccato (NULL = controllo senza modifiche)
    before        TEXT,
    after         TEXT,
    evidence_kind TEXT,               -- opzionali: cosa aveva risposto la fonte
    evidence_url  TEXT,
    evidence_code INTEGER,
    evidence_hash TEXT,
    duration_ms   INTEGER
);
```

I campi `evidence_*` sono **opzionali**: servono a ricordare *perché* un controllo è andato come è andato (uno status 403 ricorrente racconta un authwall, non una posizione morta). Non gatekeepano niente.

### Vocabolari chiusi

Chiusi perché un vocabolario aperto si riempie di sinonimi (`check`, `checked`, `verifica`) e rende inaggregabile proprio il conteggio per cui lo storico esiste.

`action` — `liveness_check` · `geocode` · `logo_fetch` · `website_fetch` · `jd_refresh` · `exclude` · `rescore`

`outcome`:

| valore | significato |
|---|---|
| `confirmed_open` | verificato: c'è ancora |
| `confirmed_closed` | verificato: non c'è più |
| **`inconclusive`** | **non si è riusciti a stabilirlo** |
| `updated` | un campo è cambiato |
| `unchanged` | nulla da cambiare |
| `unreachable` | fonte irraggiungibile |
| `skipped` | non tentato |
| `failed` | tentato, errore |

Gli ultimi quattro — `inconclusive`, `unreachable`, `skipped`, `failed` — formano il gruppo **"non lo so"**, ed è quello che fa scattare la protezione.

---

## La regola

```
outcome ∈ {inconclusive, unreachable, skipped, failed}
    ⇒ VIETATO scrivere is_open=false o status ∈ {excluded, expired}
```

Rifiutata **prima** di scrivere (exit 1 con un messaggio che spiega cosa fare), con una rete di sicurezza sul diff reale che fa `rollback` se una chiusura passa comunque.

Non tocca nient'altro: con un esito incerto l'agente può ancora aggiornare note, coordinate, summary. Il divieto è solo sulla chiusura. E **riaprire non è mai bloccato** — non perde niente.

---

## Cosa se ne legge

```
db_query.py check-history <id>              # quando trovata, quante volte guardata, con che esito
db_query.py maintenance-report [--days N]   # copertura, verificate, invariate, senza esito
```

`check-history` segnala anche la **serie di controlli non conclusi** consecutivi. Serve a distinguere due situazioni che oggi si confondono:

- *"non l'abbiamo ancora guardata"* → va guardata
- *"la guardiamo da tre settimane e non riusciamo mai a leggerla"* → è un problema di **fonte** da segnalare, non una posizione da buttare

---

## Aggancio

| dove | cosa |
|---|---|
| `shared/skills/maintenance_log.py` | vocabolari, regola, scrittura |
| `shared/skills/db_update.py` | posizioni **e aziende**: snapshot prima / diff dopo, stessa transazione dell'UPDATE |
| `shared/skills/db_insert.py` | `insert_score`: diff col punteggio precedente |
| `shared/skills/db_query.py` | `check-history`, `maintenance-report` |
| `tests/test_maintenance_log.py` | 29 test |

`--action` è **opt-in**: senza, `db_update`/`db_insert` si comportano esattamente come prima.

Skill aggiornate perché lo passino:

| skill | action |
|---|---|
| `recheck-liveness` | `liveness_check` — con la tabella `state` → `--outcome` e il divieto scritto in chiaro |
| `office-geocoding` | `geocode` (7 lingue) |
| `db-update` | documentazione di riferimento dei nuovi flag |

`logo-extraction` scrive su `companies`, per questo l'aggancio copre anche `update_company` (`logo_fetch`, `website_fetch`): senza, due delle sette azioni non avrebbero dove essere registrate.

> ⚠️ `last_checked` e `last_open_check` sono **esclusi dal diff** di proposito. Cambiano ad ogni chiamata per costruzione: includerli farebbe risultare `updated` ogni singolo controllo, e la distinzione fra "ha cambiato qualcosa" e "non ha cambiato niente" sparirebbe. Trovato al primo smoke test.

---

## Aperto

1. **`logo-extraction` non passa ancora `--action logo_fetch`**: il percorso di scrittura è agganciato, la skill no. Manca anche `jd_refresh` (non c'è una skill dedicata) e `rescore` (nessuno chiama `--action rescore`).
2. **Retention**: una riga per controllo. Sui volumi osservati (~100-200/giorno per VPS) è irrilevante per mesi, ma prima o poi serve un roll-up.
3. **`scores` ha lo stesso problema di sovrascrittura** ed è agganciato, ma nessuno chiama ancora `--action rescore`.
