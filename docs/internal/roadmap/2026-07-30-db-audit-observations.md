# 🗄️ Audit `jobs.db` — osservazioni (2026-07-30)

**Domanda posta**: si può ottimizzare il database?
**Risposta**: ⚡ non per velocità — il DB è veloce e resta veloce. Il costo è
altrove: **le code degli agenti non hanno un limite di default e riversano
l'intera coda nel contesto di un LLM**.

Correlato: [`db-schema-optimization.md`](db-schema-optimization.md) (lo schema è
*lossy*, tema diverso), `[SOURCE-YIELD-MEMORY]` in `BACKLOG.md`.

---

## 🔬 Metodo

Schema reale estratto da un `jobs.db` vivo, ricostruito in `/tmp` e popolato a
scala di produzione (**2.000** posizioni) e a **10×** (20.000), con payload
testuali presi dalle medie misurate sul DB vero:

| colonna | media | max |
|---|---|---|
| `jd_text` | 3.504 B | 7.490 B |
| `requirements` | 1.578 B | 4.445 B |
| `notes` | 587 B | 1.241 B |

≈ **6 KB per riga** di `positions` (60 colonne). Nessun dato reale, nessuna VPS
interrogata. Connessione fredda a ogni ripetizione, `cache_size` a 64 KB.

---

## ✅ Quello che NON è un problema

### Velocità — nessun intervento giustificato

| query | 2.000 pos. | 20.000 pos. |
|---|---|---|
| `next-for-analista` | 0,17 ms | 2,0 ms |
| `next-for-scorer` | 0,15 ms | 1,6 ms |
| `next-for-recheck-weekly` | 1,22 ms | 15,5 ms |
| `next-for-categorize` | 1,53 ms | 19,6 ms |
| `next-for-geocode-missing` | 2,40 ms | 29,2 ms |

Provate e **scartate** due ottimizzazioni classiche, misurate a confronto:

| variante | guadagno | verdetto |
|---|---|---|
| indici copertura sulle 4 code | 1,0×–4,7× | ❌ da 0,17 ms a 0,06 ms: irrilevante |
| blob testuali in tabella laterale | 1,4×–2,4× | ❌ stesso motivo, e costa una migrazione |

I 14 indici già presenti su `positions` bastano. L'unica scansione piena
(`next-for-geocode-missing`) costa 2,4 ms.

### Altre ipotesi verificate e chiuse

- 📐 **Ordine delle colonne** — i campi caldi (`status` cid 20, `found_at` 18,
  `last_checked` 22, i flag 44-58) stanno **dopo** ~5 KB di `jd_text` +
  `requirements`, quindi ogni lookup insegue la catena di overflow. Misurato:
  irrilevante a questa scala. Da riaprire solo se `positions` superasse le
  centinaia di migliaia di righe.
- 🔄 **Sync Supabase** — `SELECT * FROM positions` con `jd_text` nel payload, ma
  il push è **on-demand** (`Sync now`), non a timer. Il 413 è già chiuso.
- 🧹 **Retention** — `position_state_transitions` cresce ~3 righe/posizione senza
  potatura. A 20.000 posizioni sono 60.000 righe: non è un problema per anni.
- 🧽 **VACUUM** — nessuna manutenzione su `jobs.db`. Non serve: `freelist_count`
  è 0 e il DB è in WAL.

---

## 🔴 Il problema: le code non hanno un limite di default

Misurato **con il codice vero** (`db_query.py`), a 2.000 posizioni:

| comando | righe | output | ~token |
|---|---|---|---|
| `next-for-geocode-missing` | 1.375 | 78 KB | **~19.500** |
| `next-for-categorize` | 1.239 | 70 KB | **~17.600** |
| `next-for-recheck-weekly` | 471 | 32 KB | ~8.100 |
| `next-for-analista` | 121 | 7 KB | ~1.700 |
| `next-for-scorer` | 88 | 5 KB | ~1.250 |

A 20.000 posizioni `next-for-geocode-missing` restituisce **13.741 righe** —
circa **195.000 token**, cioè più di un'intera finestra di contesto in una sola
invocazione.

Perché è il punto centrale e non un dettaglio:

1. 🎯 Sono **esattamente le code di maintenance mode** — `geocode-missing`,
   `categorize`, `recheck-weekly` — cioè la modalità in cui il team ha girato. E
   sono code che **per costruzione non si svuotano**: si geocodifica una
   posizione alla volta contro un backlog di migliaia.
2. 📣 **Nessun prompt le invoca con un limite.** Verificate tutte le occorrenze
   nelle skill: sono invocazioni nude.
3. 🧩 **Il pattern giusto è già nello stesso file**, due volte: `recent-activity`
   ha `--limit 40`, la dashboard `LIMIT 10`. Sulle code non è mai stato messo.

Vale la pena incrociarlo con l'incidente citato in
[`2026-07-28-ticket-provider-cli-autoupdate.md`](2026-07-28-ticket-provider-cli-autoupdate.md)
— due agenti impantanati a **565k** e **168k** token contro una finestra da
262k. Non è dimostrato che la causa sia questa, ma è il meccanismo che produce
quel profilo, ed è verificabile sui log.

### ⚠️ Vincolo di disegno: il limite è un DEFAULT, non un tetto

Gli agenti sono intelligenti e **devono poter interrogare il DB come ritengono**,
scegliendo da sé il limite in base a cosa stanno facendo. Il difetto da correggere
non è «gli agenti vedono troppe righe», è «**il comando ne stampa 13.000 senza che
nessuno l'abbia chiesto**».

Quindi:

- ✅ un default sensato quando il limite non è specificato;
- ✅ `--limit N` esplicito, e un modo esplicito per **non** avere limite
  (`--limit 0` / `--all`) quando l'agente sa perché gli serve;
- ✅ la coda dichiara **quante righe esistono in totale**, non solo quelle
  stampate — un limite silenzioso che nasconde il backlog è peggio del problema
  (è il difetto già visto in `recent-activity`, che mostra chi produce e quindi
  fa *sparire* chi è bloccato);
- ✅ resta aperta la via SQL libera: la skill `db-query` concede
  `Bash(python3 *)`, quindi una query custom con il proprio `LIMIT` è già
  possibile e va **documentata**, non ristretta.

---

## 🟡 Due difetti di correttezza trovati strada facendo

### 1. Dedup LinkedIn: falso duplicato da sottostringa

`shared/skills/db_insert.py:161` — livello 0 del dedup:

```python
"SELECT id, title, company FROM positions WHERE url LIKE ?", (f'%{linkedin_id}%',)
```

Verificato in laboratorio: cercando l'id `4381470286` si ottiene **match** su una
riga con id `43814702861`. Un falso duplicato **scarta silenziosamente una
posizione buona** — e il log dirà che era un doppione.

- Oggi **latente**: gli URL nel DB sono puliti, senza query string.
- Diventa **sistematico** quando gli id LinkedIn passeranno a 11 cifre (oggi 10).
- Diventa **immediato** se uno Scout salva un URL con `currentJobId=` nella query
  string: l'id cercato viene dal *path*, ma il `LIKE` guarda tutta la stringa.

Costo prestazionale trascurabile (0,09 ms, usa un indice copertura): il problema è
la **correttezza**, non la velocità. Nessuna normalizzazione URL esiste nel codice.

### 2. `positions.url` non è UNIQUE

Solo un indice non-unico (`idx_positions_url`). La deduplicazione è
**check-then-insert**, quindi due Scout sulla stessa fonte possono inserire lo
stesso URL: fra il `SELECT` e l'`INSERT` non c'è transazione.

Oggi non succede perché **C-21 divide i territori** — ma è esattamente la
configurazione che l'utente ha chiesto di valutare in `[SOURCE-YIELD-MEMORY]`
(due Scout insieme su LinkedIn, coordinati). Se si va in quella direzione, il
vincolo va messo **prima**, non dopo.

⚠️ Una migrazione a `UNIQUE` deve prima **verificare e risolvere i duplicati già
presenti**, altrimenti fallisce sui DB vivi.
