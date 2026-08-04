# 🔥 Indagine consumo budget — VPS betaD (Kimi) — 2026-06-28

> **Tipo:** osservazione + finding per il codice (nessun intervento a runtime — regola "sola lettura sulle simulazioni").
> **VPS:** `host.invalid` (Hetzner fsn1, `203.0.113.40`), creata 2026-06-27 15:27 UTC. Container `jht:latest`, provider **Kimi K2.7**.
> **Utente:** betaD — profilo luxury hospitality (hostess/reception/guest relations 5★, cabin crew), base Roma, cittadina venezuelana, multilingue (ES madre, IT C2, EN C1, FR C1).
> **Trigger:** in <24h il team aveva bruciato ~39% del budget settimanale; sospetto su un consumatore "fantasma" chiamato `resume` nel bridge di pacing.

---

> ⚠️ **NOTA 2026-07-02 (correzione):** il punto 3 del TL;DR ("i coordinatori 42% = il vero motore del consumo") è un **artefatto di coast** (finestra già in throttling/idle). Verità corrente (misura pulita full-history): coordinatori **~20% e ~uguali** su Kimi/Codex, budget Kimi **~2× (non 17×)**, €/token ≈ pari; il limite vero è **precisione + comportamento**, non il budget. Living doc: [`architecture/kimi-vs-codex-economics.md`](../architecture/kimi-vs-codex-economics.md). *(I fix che ne derivarono restano validi come riduzione-costo generica.)*

## 🎯 TL;DR

1. **Il 39%/giorno è reale** (letto dall'API Kimi, non gonfiato). A ritmo di punta la proiezione settimanale era 510–628% → il settimanale durerebbe ~2,5 giorni invece di 7.
2. **Il refresh del Dottore NON è il colpevole** (solo **4%** del fatturato). Fa già una sintesi densa, non un dump. È un `/compact` fatto in casa e funziona da controllo di costo. **Lasciare com'è.**
3. **Il vero motore del consumo sono i coordinatori sempre accesi**: **Sentinella 31% + Capitano 11% = 42%** del fatturato. Ticchettano ogni ~15 min su contesti enormi (~190k) mai snelliti, perché il Dottore li salta apposta. È il "coordinator-burn" già noto.
4. **Il bug `resume` è reale ma è di leggibilità, non di spreco** (4%): un'etichetta sbagliata che fa vedere al pacing un fantasma e gli fa strozzare i *worker* invece dei coordinatori.

> ⚠️ **Due correzioni rispetto alla prima lettura di questa sessione:** la stima iniziale "refresh = 48% / 1 refresh all'ora per agente" era **errata**. Le misure sul fatturato reale e sulla frequenza (sotto) la smentiscono.

---

## 1. 💸 Il numero reale del budget

Fonte: `sentinel-bridge.py` → `fetch_kimi_api()` (riga ~796) → `https://api.kimi.com/coding/v1/usages` (riga ~761), campo `weekly_usage` (riga ~835). È il **consumo reale dell'abbonamento**, non un calcolo interno.

Da `/jht_home/logs/sentinel-data.jsonl` (ultimo campione utile):

| Metrica | Valore |
|---|---|
| `weekly_usage` | **39%** (in ~21h) |
| `weekly_remaining_pct` | 61% |
| `proj_weekly` | 510–628% (proiezione a ritmo di punta) |
| `usage` (giornaliero, post HARD-COAST) | 13% — stato `SOTTOUTILIZZO` |

Il team si era già auto-corretto (Sentinella + Capitano → HARD-COAST: throttle 3600s, stop spawn, avviso utente via web). Ma il danno del giorno 1 era fatto: 39% bruciato.

---

## 2. 👻 Cos'è `resume` — il bug di attribuzione

### Meccanica

Il bridge **non guarda le sessioni tmux**: ricava il nome dell'agente dal **titolo testuale** della sessione Kimi, via `_extract_agent_from_text()` in `shared/skills/token-by-agent-series.py:79`:

1. prende l'**ultima** `@menzione` del titolo;
2. se non ce ne sono, ripiega sul tag maiuscolo iniziale `^\s*\[([A-Z][A-Z0-9_-]+)\]`.

| Titolo sessione | Estrazione | Esito |
|---|---|---|
| `[@dottore -> @scout-2] [RESUME] Contesto…` | ultima `@menzione` → `scout-2` | ✅ corretto |
| `[RESUME] Contesto pre-refresh: …` (nudo) | nessuna `@`, fallback tag → `RESUME` | ❌ → agente fantasma `resume` |

### Perché i 3 sintomi che insospettivano

- **Nessuna sessione tmux "resume":** è un'etichetta estratta da una stringa, non un processo.
- **Cadenza 0 (0 check in 15m):** una sessione di refresh fa un caricamento e basta, non lavora a turni.
- **78% in una finestra di 15m ma 4% sul totale:** in quel quarto d'ora un refresh nudo ha sparato ~100k token mentre i worker erano sotto throttle → sembrava dominare.

### Effetto dannoso (perché conta)

Il mislabel **acceca il sistema di pacing**: Sentinella/Capitano vedono `resume` come top-burn, non trovano la sessione, lo bollano "artefatto di parsing" e applicano l'HARD-COAST a manganello sui **worker** (scout/analista/scorer) — cioè sul lavoro produttivo — invece di toccare la leva vera (i coordinatori). È un bug **di leggibilità delle decisioni**, non di spreco di token.

---

## 3. ✅ Perché il refresh del Dottore NON è il problema

### Cosa fa il refresh

Quando il contesto di un agente si riempie, il Dottore fa un "refresh ricco con resume": **kill della sessione + ricrea + reinietta una sintesi**. È un `/compact` fatto in casa, scelto perché Codex/Kimi non espongono un `/compact` pilotabile (`docs/internal/architecture/context-watchdog-spec.md`).

### Misura 1 — il seed è una SINTESI, non un dump

Il messaggio `[RESUME]` iniziale misura **~900 caratteri (~300–400 token di testo)**. Esempio reale:

> `[RESUME] Contesto pre-refresh: hai appena chiuso un turno resume con insert ID 37 (Event Coordinator @ CARDO ROMA…). Pipeline DB: positions 37, companies 20, scores 20… Partizione SCOUT-4: cerchi 1-5, fonti hospitality-boards/airline-careers/web. Snags: scout_dedup.py mancante… Learnings: ResortWork validi; Emirates/Etihad già in DB… Task: continua sourcing nella tua partizione.`

Combacia col protocollo (`agents/_skills/session-refresh/SKILL.it.md:89`, `agents/dottore/dottore.it.md`): "stavi facendo X; completato Y; prossimo Z. Riprendi. Coda: …". **È esattamente l'approccio "sintetizza, non dare il contesto grezzo".**

### Misura 2 — il costo di ricarica è il 4%

Il primo turno di una sessione refreshata costa ~15–23k token: è il **prompt di sistema/skills dell'agente** ricaricato a fresco, non il contesto vecchio. I picchi da 100–213k si raggiungono **lavorando** (16–236 turni), lavoro che ci sarebbe stato comunque.

Costo totale di ricarica = primo turno × 20 refresh = **0.34M = 4%** del fatturato.

### Misura 3 — frequenza ≈ come da design

Protocollo (`shared/skills/doctor_schedule.py`, `dottore.it.md`): **2 giri per finestra di lavoro** (slot `T30` a +30min dall'inizio finestra, slot `MID` a metà), ogni giro refresha tutti gli agenti attivi. Più refresh per età su Sentinella/Assistente (watchdog, soglia 24h).

I timestamp reali confermano le **raffiche**, non "1/ora":

```
06-28 10:21–10:34 UTC  → giro completo (scout-3/4, analista-2, scorer-3, assistente, mentor)
06-28 12:00–12:12 UTC  → secondo giro (scout-2/4, analista-2, scorer-1/3)
notte 22:01 / 04:02 UTC → refresh per età (assistente)
```

20 refresh in 21h ≈ 2 giri × ~7 agenti + watchdog + qualche retry. **Nei limiti del previsto.**

---

## 4. 📊 Dove va davvero il budget

Fatturato a prezzo pieno (`input_other + input_cache_creation + output`, somma su tutti i turni di tutte le sessioni Kimi): **7.68M token in ~21h**.

| Agente | Fatturato | Quota | Note |
|---|---|---|---|
| 🛡️ **sentinella** | 2.37M | **31%** | 236 turni, contesto cresciuto a ~190k, 93% cache-read |
| 🧭 **capitano** | 0.87M | 11% | coordinatore, saltato dal refresh |
| heartbeat worker | 0.83M | 11% | sessioni "Leggi AGENTS.md…" |
| 🔭 scout-2 | 0.67M | 9% | |
| 🔭 scout-3 | 0.61M | 8% | |
| 🔎 analista-2 | 0.51M | 7% | |
| 🔭 scout-4 / scout | 0.74M | 10% | |
| 👻 resume (bug) | 0.32M | 4% | |
| 🗣️ assistente | 0.19M | 3% | |

**Coordinatori (Sentinella + Capitano) = 42%.** La Sentinella da sola è il 31%: fa **un turno LLM ogni ~15 min** (tick del bridge) portandosi dietro un contesto che cresce a ~190k e **non viene mai snellito** (il Dottore la salta — `skipped_active_orchestration`; il refresh per età scatta solo a 24h). ~40 tick/giorno × ~190k di contesto = lì se ne va il budget.

> Nota sulla cache: la Sentinella è al **93% cache-read** (contesto servito da cache, fatturato a sconto). Quindi non è un problema di expiry della cache, ma di **volume**: anche scontato, 29.55M di cache-read + 2.15M full-price su 236 turni pesano. La leva è ridurre il *contesto trascinato per tick*, non la cache.

Questo è il **coordinator-burn** già documentato (un turno LLM per tick anche sui no-op): vedi memoria globale `project_coordinator_burn_discovery`.

---

## 5. 🛠️ Findings / raccomandazioni per il codice

> Tutti finding per il **codice**, non interventi a runtime sulla VPS live.

| Priorità | Intervento | Razionale |
|---|---|---|
| 🔴 Alta | **Snellire il contesto dei coordinatori** (Sentinella su tutti): tick "leggero" che legge lo stato da `sentinel-data.jsonl` invece di trascinare ~190k di storia; e/o refresh dei coordinatori più frequente della soglia 24h | È il 42% del budget — la leva vera per far durare il settimanale 7 giorni |
| 🟡 Media | **No-op tick senza turno LLM** | Molti tick del bridge non richiedono ragionamento del modello |
| 🟢 Bassa | **Fix etichetta `resume`** in `token-by-agent-series.py:79`: un `[RESUME]` nudo deve risolversi all'agente proprietario, oppure il Dottore deve titolare SEMPRE `[@dottore -> @agente] [RESUME]` | Solo 4% di spesa, ma sblocca decisioni di pacing corrette (basta accecamento) |
| ⛔ Non toccare | **Refresh del Dottore** | Già fa la sintesi giusta (~900 char), costa il 4%, funziona da controllo di costo |

---

## 6. 🔁 Metodo / riproducibilità

Accesso: `ssh -i ~/.ssh/jht_ed25519 root@203.0.113.40` → `CID=$(docker ps -q --filter name=jht)`.
Nel container **non c'è `sqlite3` CLI** → usare `docker exec -i $CID python3 -c '…'`.

Fonti dati usate:
- Consumo reale provider: `/jht_home/logs/sentinel-data.jsonl` (`weekly_usage`, `proj_weekly`).
- Token per sessione: `~/.kimi/sessions/*/*/wire.jsonl` → `message.payload.token_usage` (`input_other`, `input_cache_read`, `input_cache_creation`, `output`).
- Nome agente: `state.json` `custom_title` → regex di `_extract_agent_from_text`.
- Azioni Dottore: `/jht_home/logs/dottore-actions.jsonl`.
- Protocollo: `agents/dottore/dottore.it.md`, `agents/_skills/session-refresh/SKILL.it.md`, `shared/skills/doctor_schedule.py`, `docs/internal/architecture/context-watchdog-spec.md`.

Metrica "fatturato": somma per-turno di `input_other + input_cache_creation + output` (esclude `input_cache_read`, scontato). Proxy per l'attribuzione relativa, non per il totale esatto dell'abbonamento (quello è `weekly_usage` dall'API).

---

## 7. ✅ Fix applicati (2026-06-28, branch `dev7`)

| # | Fix | File |
|---|---|---|
| 1 | **Bug "resume"**: il fallback `[TAG]` dell'estrazione nome è ora validato contro i ruoli canonici (`VALID_AGENT_ROLES`). Un `[RESUME]` nudo → `None` (→ fallback al wire / `?unknown`), non più un agente fantasma. | `shared/skills/token-by-agent-series.py`, `shared/skills/token_metrics_lib.py`, test `tests/test_session_to_agent.py` (30 casi, verde) |
| 2 | **Compattare i coordinatori**: rimosso lo skip della Sentinella ("managed by watchdog") e la cautela eccessiva sul Capitano ("never recreate lightly"). Il Dottore ora **compatta** Capitano + Sentinella a ogni giro, per ultimi, catturando lo stato in-flight nel seed (Sentinella near-stateless → seed minimo). | `agents/dottore/dottore.md` + 6 lingue, `agents/_skills/session-refresh/SKILL.md` + 6 lingue |

`agent-watchdog.sh` lasciato **invariato**: il suo reset per-età della Sentinella resta come *fallback* per quando il Dottore non gira (nessun race — il Dottore ora la compatta prima dei 24h).

## 8. 🐛 Finding residui — tool "fantasma" nei prompt

Check sistematico dei `*.py` citati nei prompt agenti vs realmente esistenti:

| Tool citato | Stato | Impatto |
|---|---|---|
| `scaling_calc.py` | ✅ esiste (`agents/_skills/scaling-calc/`) — falso positivo | — |
| `rate-budget.py` | refuso: esiste `rate_budget.py` (underscore), 1 file (`scaling-calc/SKILL.md`) | basso (comando) |
| `jht-throttle.py` | refuso in **prosa** (nome reale `throttle.py`/`throttle-config.py`), 7 file `sentinella.<lang>.md` | basso (descrittivo) |
| ⭐ `scout_dedup.py` | **MAI IMPLEMENTATO**, comando reale in 14 file (scout + email-monitor × 7 lingue) | **alto — budget** |

`scout_dedup.py` è il più rilevante: il prompt ne specifica l'interfaccia (`check --url --company --title --location` → `{action:insert|skip}`) e documenta il danno ("Canonical comparso 14× in 21h sprecando ~50% di una finestra Kimi"). La logica di dedup esiste già in `db_insert.py` → sarebbe un wrapper CLI. **Raccomandato implementarlo** (riduce spreco budget da duplicati), ma è una feature separata da decidere.

## 9. 🛡️ Analisi Sentinella — perché consuma e come ridurre

**Perché è il 31% del fatturato:**
- Fa un turno LLM **ogni ~15 min** (il bridge la sveglia con `BRIDGE PACING` + `BRIDGE TICK`) → ~40 turni/giorno in una finestra di 10h.
- Ogni turno re-invia il contesto cresciuto (fino a ~190k): 29.55M cache-read + 2.15M full-price su 236 turni. La cache (93%) sconta ma il **volume** resta.
- Il messaggio del bridge stesso è verboso (~500+ token/tick: la pacing line con i calcoli per-agente).
- Il contesto non veniva mai snellito tra i refresh (ora il fix #2 lo compatta 2×/finestra — miglioramento **parziale**).

**Come ridurlo (in ordine di impatto):**

1. ⭐ **No-op tick senza turno LLM** (leva più grossa): il bridge calcola GIÀ `vel_team` vs `target` (MARGINE/SFORO/coast). Svegliare l'LLM Sentinella **solo** quando serve un giudizio (cambio di regime, sforo del cap, decisione non banale); per i tick "tutto in banda" il bridge mantiene la decisione corrente **senza** turno del modello. Taglia il *numero* di turni.
2. ⭐ **Tick leggero / stateless**: la Sentinella è near-stateless (stato in `sentinel-data.jsonl` + config). Ogni turno LLM dovrebbe partire da un contesto **compatto** (legge lo stato dai file) invece di accumulare la storia nella chat. Taglia il *costo per turno* (da ~190k a ~15-20k di base).
3. **Compattazione regolare** (fix #2, già applicato): tiene il contesto più basso tra i tick.
4. **Accorciare il messaggio bridge** per-tick e/o ridurre la frequenza dei tick LLM-facing.

I punti 1+2 sono architetturali (toccano `sentinel-bridge.py` + prompt Sentinella + test) e vanno progettati a parte: insieme porterebbero il consumo Sentinella da ~31% a una frazione, eliminando sia i turni inutili sia il contesto trascinato.

**Stato (2026-06-28):**
- Il **gate no-op** (punto 1) **esisteva già** come *lean-comms* (`_should_notify_sentinella`, dal 2026-06-15): il bridge tace quando `on_pace`, sveglia la Sentinella solo sull'edge calma→attuabile e poi ai quarti col cooldown. **Raffinato** ora: durante un episodio attuabile **a regime invariato** (`status` uguale), la re-conferma è posticipata fino al cap `SENTINELLA_RECONFIRM_MIN` (45min) invece di ogni quarto — è il caso betaD (sforo/sottoutilizzo stabile per ore). Un cambio di regime la sveglia subito. Backward-safe (`status=None` → legacy). Test: 9 casi.
- Il **contesto** (punto 2) è ora mitigato dal fix #2 (il Dottore **compatta** la Sentinella a ogni giro). Un tick *davvero* stateless (la Sentinella ricostruisce tutto dai file a ogni wake) resta un miglioramento futuro più invasivo, non incluso qui.

---

*Stato team al momento dell'indagine: SANO e produttivo — 39 posizioni, 21 scorate (avg 69, max 95), offerte tutte centrate sul profilo luxury hospitality di Roma, comunicazione utente di qualità (digest Capitano + alert Assistente via web). L'unico tema aperto è il pacing descritto sopra.*
