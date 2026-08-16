<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: position-insert
description: "La sequenza a 5 gate che lo Scout esegue per OGNI posizione candidata prima dell'INSERT in `positions`: dedup → verifica link → fetch JD → filtri permissivi → INSERT. Saltare qualsiasi gate riempie il DB di duplicati, link morti, o righe fuori scope che l'Analista deve poi scartare — budget Sonnet sprecato a valle. Responsabilità del ruolo Scout; abbina con `circles-and-sources` (decide DOVE cercare) e `scout-coord` (decide CHI cerca dove)."
allowed-tools: Bash(python3 *), Bash(grep *)
---

# position-insert — 5 gate per posizione

Una posizione merita di essere inserita solo se tutti e cinque i gate passano. L'ordine conta: i check più economici vengono prima così quelli costosi (fetch JD completo + filtraggio) girano solo su candidati viabili.

## Gate 1 — Dedup (economico, obbligatorio per primo)

```bash
python3 /app/shared/skills/db_query.py check-url <linkedin_id_or_url>
```

- Output `TROVATA` → **SKIP** (già nel DB, possibilmente con status diverso — mai re-inserire).
- Output `NON TROVATA` → procedi al Gate 2.

La chiave dedup è l'URL canonico (o l'ID job LinkedIn per LinkedIn). Se lo stesso annuncio proviene da due fonti diverse (es. pagina career aziendale E un cross-listing LinkedIn), `check-url` deduplica.

## Gate 2 — Verifica link (HTTP + URL)

Verifica in due step per rilevare annunci morti E redirect silenziosi a una pagina `/careers` generica (= lavoro rimosso ma la pagina restituisce 200).

### Step 2a — status code + URL finale

```bash
python3 /app/shared/skills/safe_fetch.py --status '<URL>'
```

| Risultato                                     | Azione                                         |
|-----------------------------------------------|------------------------------------------------|
| `HTTP:404` / `HTTP:410`                       | SKIP (link morto)                              |
| `HTTP:301/302` a `/careers` o `/jobs` generico | SKIP (posizione rimossa, redirect generico)    |
| `HTTP:200/301/302` URL finale = pagina annuncio | procedi allo Step 2b                          |

### Step 2b — segnali nel contenuto

```bash
python3 /app/shared/skills/safe_fetch.py '<URL>' \
  | grep -i 'no longer accepting\|closed-job\|position has been filled\|expired\|job not found'
```

- Match → SKIP (lavoro chiuso)
- Nessun match → procedi al Gate 3

### Nota Workable

Per ATS ospitati su Workable: ci sono **due** URL per annuncio. Usa quello giusto:
- `apply.workable.com/...` → form di candidatura: restituisce `302` quando il lavoro è chiuso (sembra un link morto, falso positivo).
- `jobs.workable.com/...` → pagina JD canonica: HTTP 200 + JSON-LD valido se la posizione è viva.

Verifica sempre la pagina **canonica** (`jobs.workable.com`), non il form di candidatura. Stesso principio per Greenhouse, Lever, Ashby.

## Gate 3 — Fetch del JD COMPLETO

Il contratto DB richiede che `--jd-text` e `--requirements` siano COMPLETI — scrape parziali rompono l'Analista a valle.

```bash
# livello 1 — fetch controllato con browser UA (la maggior parte dei casi)
python3 /app/shared/skills/safe_fetch.py '<URL>' > $JHT_AGENT_DIR/tmp/jd-raw.html

# livello 2 — pagine JS-heavy (Wellfound, alcune career custom): usa playwright MCP
# livello 3 — fallback: WebFetch / WebSearch
```

> `safe_fetch.py` sostituisce `curl -L` di proposito: controlla **ogni**
> salto dei redirect e rifiuta gli indirizzi interni alla rete del
> container. Non tornare a `curl` nudo — una pagina di annuncio che
> rimanda a `169.254.169.254` non è una pagina di annuncio.

Estrai il **corpo completo del testo** (non solo il titolo) e la **sezione requisiti** (competenze, anni di esperienza, lingue). Se la pagina ha una sezione chiara "Requirements" / "Must have" / "What you'll bring", scrapala verbatim in `--requirements`.

Siti bloccati (NON usare `fetch` MCP, bloccato da robots.txt):
- `linkedin.com` → usa `linkedin_check.py` (autenticato) o `safe_fetch.py`
- `wellfound.com` → usa `playwright` o `safe_fetch.py`

## Gate 4 — Filtri permissivi a livello Scout

Applica SOLO i quattro filtri totalmente-fuori-scope (tabella completa nella skill `circles-and-sources`). Salta se:

- Il titolo contiene esplicitamente: `senior`, `lead`, `staff`, `principal`, `head of`, `director`
- Work-auth geografica incompatibile (`US-only` / `Canada-only` e il candidato non ha visto)
- Dominio completamente fuori IT/coding (e il candidato è in IT)
- Requisito rigido di `> anni_reali + 3` anni di esperienza

Tutto il resto: passa al Gate 5. **Non fare il lavoro dell'Analista** — stack adiacenti, quasi-fit, lievi gap sono tutti materiale `checked`; lo Scorer applica la penalità di gap.

## Gate 5 — INSERT

```bash
python3 /app/shared/skills/db_insert.py position \
  --title "<TITOLO>" \
  --company "<AZIENDA>" \
  --url "<URL canonica, NON apply form>" \
  --location "<location reale dalla JD>" \
  --remote-type <full_remote|hybrid|on_site> \
  --source <slug fonte: linkedin|greenhouse|lever|indeed|wellfound|remoteok|...> \
  --found-by $MY_ID \
  --jd-text "<TESTO COMPLETO DELLA JD>" \
  --requirements "<stack + requirements estratti dalla JD>"
```

**Tutti i flag sono obbligatori** — `--jd-text` vuoto o `--url` mancante significa che l'Analista non può fare il suo lavoro. Lo script `db_insert.py` impone valori non vuoti; se rifiuta la tua chiamata, correggi l'input — mai bypassare con SQL grezzo.

## Perimetro di scrittura DB (T05 + ruolo)

Lo Scout scrive SOLO:
- `positions` (INSERT, mai UPDATE eccetto il caso di dup-recovery sotto)

MAI tocca:
- `companies` (territorio Analista)
- `scores` (Scorer)
- `applications` (Scrittore)
- `position_highlights` (Analista)
- posizioni con `status != 'new'` (già mosse a valle, hands off)

### Dup recovery (l'unico UPDATE permesso)

Se hai accidentalmente inserito un duplicato (il Gate 1 era sbagliato, es. un URL normalizzato è passato), puoi marcare il duplicato come escluso — mai DELETE:

```bash
python3 /app/shared/skills/db_update.py position <DUP_ID> --status excluded \
  --notes "DUPLICATA di #<ORIGINAL_ID>"
```

`DELETE` / `DROP` SQL è vietato (T02 + sicurezza DB). I rollback via note `excluded` sono auditabili; le cancellazioni no.

## Dopo l'INSERT — notifica gli Analisti

Dopo ogni batch di 3-5 insert, pinga le sessioni Analista con il range di ID. Prendono comunque `status=new` dal DB, ma il ping accorcia la latenza:

```bash
jht-tmux-send ANALISTA-1 "[@$MY_ID -> @analista-1] [INFO] Batch 5 posizioni inserite (IDs: X-Y)"
```

Se hai 2 Analisti, alterna il target del ping per bilanciare il carico (gli Analisti hanno anche coordinamento di claim `last_checked` quindi non è mai sbagliato, ma la notifica tmux aiuta la reattività).

## Anti-pattern

- ❌ Saltare il Gate 1 "perché sembrava nuova" — `check-url` è economico, eseguilo sempre.
- ❌ Inserire con `--jd-text` vuoto "la riempirò dopo" — non c'è un dopo, l'Analista la processa subito.
- ❌ Fermarsi al primo stato senza seguire i redirect — un 302 a un `/careers` generico sembra vivo; `safe_fetch.py --status` li segue, controllando ogni salto.
- ❌ Verificare il form di candidatura su Workable invece della pagina JD canonica — falsi positivi link morti.
- ❌ Usare `fetch` MCP su `linkedin.com` / `wellfound.com` — bloccato, ricevi un banner 403 invece del JD.
- ❌ Bypassare il wrapper con `python3 -c "import sqlite3; INSERT ..."` — rompe gli invarianti dedup e il tracciamento `found-by`, e ora lo rifiuta anche il DB: `positions.url` è UNIQUE. `UNIQUE constraint failed: positions.url` vuol dire che l'annuncio c'è già — torna al Gate 1, non riprovare con un URL ritoccato.
- ❌ Impostare `--status` a qualcosa di diverso dal default `new` (lo Scout non imposta mai lo status manualmente; il wrapper lo gestisce).

## Vedi anche

- `circles-and-sources` — cosa cercare DOVE (questa skill è cosa fare DOPO che trovi un annuncio candidato).
- `scout-coord` — partizionamento al boot (questa skill è per-posizione, a valle della partizione).
- `db-insert` — internals del wrapper + schema `position`.
- `agents/_manual/anti-collision.md` — contratto di coordinamento Scout più ampio.
- `agents/scout/scout.md` — il prompt orchestratore che chiama questa skill nel loop principale.
