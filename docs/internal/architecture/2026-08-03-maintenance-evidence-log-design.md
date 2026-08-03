# 🔬 Log di evidenza della manutenzione — design 2026-08-03

**Stato**: proposta di design. Schema non ancora applicato.

## Il problema

Con lo schema attuale **non è possibile stabilire se il lavoro di manutenzione sia stato fatto**. Si può solo stabilire che una riga è stata riscritta.

Tutti i campi che dovrebbero raccontare la manutenzione sono **stato last-write-wins**:

| campo | cosa prova | cosa non prova |
|---|---|---|
| `positions.last_checked` | una data è stata scritta | che l'URL sia stato aperto |
| `positions.last_open_check` | idem | che l'annuncio fosse vivo |
| `positions.updated_at` | la riga è stata riscritta | quale campo, da quale valore a quale |
| `positions.last_actor` | chi ha toccato per **ultimo** | nessuna storia: si sovrascrive |
| `positions.office_geocoded` | esiste una coordinata | da dove arriva, e se qualcuno l'ha guardata |

Ne segue che **un agente che scrive il timestamp senza fare nulla è indistinguibile da uno che ha lavorato**. E siccome il timestamp è anche la metrica con cui si giudica il suo lavoro, l'incentivo punta nella direzione sbagliata.

### Come si è manifestato

Su una VPS beta in modalità `maintenance` (ordine: *recheck 7gg, geocoding ufficio, logo, sito azienda*), dopo quattro giorni:

```
office geocodificato   1418 / 1418   (100%)
office verificato        36 / 1418   (2,5%)
```

Il 100% è credibile solo come **passata automatica in blocco**; la verifica vera è ferma al 2,5%. Lo scarto si è potuto vedere **solo** perché per l'ufficio esistono per caso due campi distinti, `office_geocoded` e `office_verified`. Per il recheck, il logo e il sito quel secondo campo non c'è: lì lo stesso scarto sarebbe **invisibile**.

> ⚠️ Tutte le cifre di manutenzione prodotte finora (*"94 posizioni ricontrollate in 4 giorni"*) vanno lette come **"94 righe toccate"**. Non sono una misura del lavoro svolto.

---

## Principio

> Distinguere **`checked`** (ho guardato) da **`verified`** (ho una prova), e non accettare mai `verified` senza un'evidenza **ri-derivabile da terzi**.

Un log in cui l'agente scrive in prosa cos'ha fatto non risolve niente: può scrivere il falso lì come lo scrive nel timestamp. L'evidenza deve essere qualcosa che **un secondo attore può ricalcolare e confrontare** — status HTTP e hash del contenuto, non una frase.

---

## Schema proposto

Una sola tabella nuova, append-only, modellata su `position_state_transitions` (stesse convenzioni: `id` autoincrement, `ts` con default, `by_agent`, indici per target e per tempo).

```sql
CREATE TABLE IF NOT EXISTS maintenance_events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    by_agent      TEXT NOT NULL,

    -- Che cosa è stato toccato
    target_type   TEXT NOT NULL,      -- position | company
    target_id     INTEGER NOT NULL,

    -- Che cosa si stava facendo
    action        TEXT NOT NULL,      -- vedi vocabolario
    outcome       TEXT NOT NULL,      -- vedi vocabolario

    -- Il diff, non il fatto
    field         TEXT,
    before        TEXT,
    after         TEXT,

    -- L'evidenza, ri-derivabile
    evidence_kind TEXT,               -- http | api | manual | none
    evidence_url  TEXT,
    evidence_code INTEGER,            -- status HTTP
    evidence_hash TEXT,               -- sha256 del contenuto normalizzato

    duration_ms   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_me_target  ON maintenance_events(target_type, target_id, ts);
CREATE INDEX IF NOT EXISTS idx_me_ts      ON maintenance_events(ts);
CREATE INDEX IF NOT EXISTS idx_me_outcome ON maintenance_events(action, outcome, ts);
```

### Vocabolario chiuso

`action` — **liveness_check** · **geocode** · **logo_fetch** · **website_fetch** · **jd_refresh** · **exclude** · **rescore_request**

`outcome`:

| valore | significato | richiede evidenza |
|---|---|---|
| `confirmed_open` | l'annuncio esiste ancora | ✅ sì |
| `confirmed_closed` | l'annuncio non esiste più | ✅ sì |
| `updated` | un campo è cambiato | ✅ sì |
| `unchanged` | verificato, nulla da cambiare | ✅ sì |
| `unreachable` | fonte irraggiungibile | ⬜ no (è il fallimento) |
| `skipped` | non tentato (throttle, fuori scope) | ⬜ no |
| `failed` | tentato, errore | ⬜ no |

**`unchanged` richiede evidenza**: è il caso più frequente della manutenzione, ed è esattamente quello in cui è più comodo non fare niente.

---

## Dove si aggancia

`shared/skills/db_update.py` è **l'unico punto di scrittura** che gli agenti usano, e costruisce già una lista `changed` con i campi modificati. È lì che va l'aggancio:

1. leggere i valori **prima** dell'`UPDATE` (oggi non si fa: si scrive e basta);
2. eseguire `UPDATE` e `INSERT` in `maintenance_events` **nella stessa transazione**;
3. rifiutare l'update quando `action` lo richiede e l'evidenza manca.

Un solo file, un solo chokepoint: nessun agente può aggiornare senza lasciare l'evento. Le scritture inline via `python3 -c "import sqlite3..."` restano possibili e aggirerebbero il log — stesso problema già affrontato per i timestamp `'now'`, e stessa cura: un **trigger educativo** che le rifiuta con un messaggio che insegna il pattern corretto (vedi `applications_reject_str_now_insert` in `shared/skills/_db.py`).

### Regola dura sul `verified`

`office_verified = 1` (e i futuri `*_verified`) si può scrivere **solo** contestualmente a un evento con `evidence_kind='http'` e `evidence_code` 2xx. Non è un controllo cosmetico: è l'unica cosa che impedisce alla prossima passata automatica di dichiararsi verifica.

---

## Cosa se ne ricava

| metrica | come | a cosa serve |
|---|---|---|
| **tasso di no-op** | `outcome='unchanged'` / totale eventi | misura diretta del lavoro finto |
| **copertura reale** | target distinti con evento negli ultimi N giorni / portafoglio | il "94 in 4 giorni" diventa un numero vero |
| **profondità** | eventi `confirmed_*` / eventi totali | quanto della manutenzione è verifica |
| **costo per record verificato** | incrocio col consumo del round | risponde a *"il weekly bruciato è servito?"* |
| **agente inerte** | eventi per `by_agent` per giorno | oggi si vede solo `last_actor`, che si sovrascrive |

Il primo indicatore è quello che mancava. Se la manutenzione produce `unchanged` sul 95% dei record senza evidenza, il team sta girando a vuoto — e oggi quel dato **non esiste in nessuna forma**.

---

## Costi e limiti

- **Scritture**: una riga per operazione. Sul volume osservato (~100-200 tocchi/giorno per VPS) è irrilevante; va comunque messa una **retention di 60 giorni** con roll-up mensile per target, altrimenti la tabella diventa il file più grande del DB.
- **Non impedisce di mentire**: un agente può ancora inventare `evidence_hash`. La difesa non è la tabella, è la **ri-derivabilità**: un secondo attore (Dottore, o uno script fuori dal team) ri-scarica un campione e confronta gli hash. Senza quel controllo a campione, il log resta autocertificazione — solo meglio strutturata.
- **Non retroattivo**: le righe già in DB restano senza storia. Il conteggio "verificato" riparte da zero, ed è corretto che sia così.
- **Sync cloud**: fuori scope per ora. La tabella è diagnostica interna; se poi serve in dashboard, va aggiunta al set di `db_to_supabase.py` con una migration numerata lato Supabase.

---

## Rollout

| passo | dove |
|---|---|
| 1 | `CREATE TABLE` idempotente in `shared/skills/_db.py`, accanto a `position_state_transitions` |
| 2 | aggancio in `shared/skills/db_update.py` (lettura *before*, insert in transazione, rifiuto senza evidenza) |
| 3 | flag `--evidence-url` / `--evidence-code` / `--evidence-hash` nella CLI di `db_update.py` |
| 4 | aggiornamento delle skill di manutenzione perché passino l'evidenza (liveness, geocode, logo, sito) |
| 5 | query di lettura in `shared/skills/db_query.py`: `maintenance-report [--days N]` |
| 6 | trigger educativo contro le `INSERT`/`UPDATE` inline che scavalcano la skill |
| 7 | campionamento di ri-verifica indipendente (senza, il punto 2 è autocertificazione) |

I passi 1-3 sono la base minima utile: da soli rendono già misurabile il tasso di no-op. I passi 4-5 rendono il dato leggibile. Il **7 è quello che rende il sistema onesto**, ed è l'unico che va fatto fuori dagli agenti.

---

## Domande aperte

1. **`scores` ha lo stesso problema?** Un re-score che non cambia il punteggio oggi è indistinguibile da un re-score mai eseguito. Probabilmente sì, stessa cura.
2. **Retention 60 giorni è la scelta giusta**, o serve tenere per sempre almeno gli `confirmed_closed` (sono la storia di *perché* una posizione è stata chiusa)?
3. **Chi fa il campionamento del punto 7?** Il Dottore è dentro il team e soggetto agli stessi guasti; un cron esterno è più credibile ma è un pezzo di infrastruttura in più.
