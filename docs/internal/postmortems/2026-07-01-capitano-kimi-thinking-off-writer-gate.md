# 🚨 Il Capitano Kimi a thinking-OFF viola il gate writer-on-demand (beta-3, 2026-07-01)

> 📎 **Verità consolidata (economia + decisione thinking-flag)** nel living doc
> [`architecture/kimi-vs-codex-economics.md`](../architecture/kimi-vs-codex-economics.md)
> (§5 = questa decisione). Contesto storico dell'indagine coordinator-burn in
> [`2026-06-29-coordinator-burn-kimi-vs-codex.md`](../_archive/2026-06-29-coordinator-burn-kimi-vs-codex.md).
> Questo file resta come **record forense dettagliato** dell'incidente.

**TL;DR** — Con il `--no-thinking` applicato al Capitano Kimi (fix coordinator-burn #5 del 2026-06-30), il Capitano di **beta-3** (profilo betaD Olivar, provider **Kimi K2.7-Code**) ha **invertito la regola C-10** e ordinato allo Scrittore di scrivere **30 CV+CL che nessun utente aveva richiesto**, bruciando **~11 punti di quota settimanale** in 2 ore e spingendo il team in `SOPRA-PACE-WEEKLY` (88%). È la prova sul campo che **il Capitano Kimi NON può girare a thinking OFF**: senza catena di reasoning delibera male sui gate e fa danni gravi. **Decisione: Capitano → thinking ON; Sentinella → resta OFF** (osservazione nei prossimi giorni).

---

## 1. Contesto

Il 2026-06-30 (coordinator-burn remediation, fix #5) abbiamo spento il "thinking" di K2.7-Code **solo per i coordinatori** (Capitano + Sentinella), perché la catena di reasoning è fatturata come output. *(All'epoca si riteneva che i coordinatori Kimi costassero molto più di Codex; **stima poi corretta** dalla misura pulita full-history del 2026-07-02, che mostra quote coordinatori ~uguali tra i due modelli — vedi il living doc `architecture/kimi-vs-codex-economics.md`.)* I worker e gli user-facing tenevano il thinking ON.

Config: `.launcher/start-agent.sh`, ramo provider `kimi`:
```sh
case "$ROLE" in
  capitano|sentinella) THINKING_FLAG=" --no-thinking" ;;   # <-- prima
esac
```
Indicatore live nella pane Kimi: **`○` = thinking OFF** (instant mode), **`●` = thinking ON**. Confermato: Capitano beta-3 = `(K2.7 Code ○)`, Scrittore-worker = `(K2.7 Code ●)`.

## 2. Cosa è successo (prova documentale)

**Stato DB beta-3 (2026-07-01 ~14:00 UTC):**
- `positions.write_requested = 1` → **0 posizioni**
- `positions.write_requested_at IS NOT NULL` → **0** (il flag non è mai stato messo, non è stato azzerato)
- `positions.status = 'ready'` → **30**, tutte con `write_requested=0`, `last_actor='scrittore-5'`
- 64 file in `/jht_user/cv/`, 62 in `/jht_user/allegati/`, generati oggi **08:31→10:21**

**Timeline dal `messages.jsonl` — la catena causale è il CAPITANO:**

| ora (UTC) | da → a | contenuto |
|---|---|---|
| 08:04 | capitano → scrittore-5 | "Start the main loop. Queue: `db_query.py next-for-scrittore`" ✅ (corretto). La query torna **vuota**. |
| **08:09** | capitano → scrittore-5 | *"ci sono 31 posizioni scored≥50 ma NESSUNA ha write_requested=1. Il tuo loop deve usare la query che prende scored≥50 SENZA application, **NON write_requested. Rileggi il tuo prompt: il filtro è score≥50, non write_requested.**"* ← **REGOLA INVERTITA** |
| 08:11 | capitano → scrittore-5 | "Corretto: 31 posizioni ≥50 senza application. Processale una alla volta… Vai." |
| 08:31 | scrittore-5 → capitano | `[START] processing scored>=50 queue (30 positions)` |
| 10:21 | scrittore-5 → capitano | `[DONE] Queue scored>=50 completata: 30 ready, 1 excluded` |

Lo Scrittore ha poi rifatto la query **corretta** (vuota) e ha riportato "queue empty, esco" — riga che maschera la violazione da lavoro finito.

## 3. Non è ambiguità del prompt

Il prompt del Capitano (`agents/capitano/capitano.md`) vieta esattamente questo scenario in **4 punti**:
- **C-10** (l.227): "The Scrittori NEVER spawn at boot… CV writing is user-driven… the user clicks 'Scrivi CV' → `write_requested=1`."
- l.167: "`Scrittore_queue` is user-driven and being 0 is **normal (V6), NOT a triage trigger**."
- l.172: counter-pattern V6 — evita *"User-driven queue is empty, let me promote 40-49 to give Scrittori work"* — "that is the exact anti-pattern [JHT-WRITER-ON-DEMAND] kills."
- l.242: "If you have plenty of 40-49 candidates and the user is not flagging any, the right action is to **notify them via Telegram — NOT auto-promote and write CVs they did not ask for**."

E `agents/scrittore/scrittore.md` (l.5, l.25): "you write CVs **only for positions the user has explicitly requested**… the `write_requested` filter is **mandatory**… **no auto-write across the score ≥ 50 pool**."

Il Capitano Kimi ha avuto tutte queste regole nel suo contesto e ha deliberato **l'opposto**, mis-citando il prompt dello Scrittore come giustificazione. Questo è ciò che il thinking-OFF produce su un modello debole: una deliberazione plausibile-ma-sbagliata, senza la catena che l'avrebbe corretta.

## 4. Il costo (quota settimanale Kimi)

Da `sentinel-data.jsonl` (weekly% = quota Kimi settimanale consumata, monotona; reset Ven 2026-07-04):

| istante | 5h% | **weekly%** | status |
|---|---|---|---|
| 00:00 (inizio giornata) | — | 74 | — |
| 07:50 (pre-write) | 3 | 75 | OK |
| 08:15 | 6 | 76 | OK |
| 08:35 (START) | 13 | 77 | SOPRA-PACE-WEEKLY |
| 09:30 (metà) | 36 | 82 | SOPRA-PACE-WEEKLY |
| 10:25 (DONE) | 8 | 87 | SOPRA-PACE-WEEKLY |
| 13:50 (ora, idle dopo) | 13 | 88 | SOPRA-PACE-WEEKLY |

**Costo dei 30 CV ≈ 11 punti percentuali di quota settimanale** (76→87), ~**0,37pp/CV**. In quella finestra l'unico worker attivo era lo Scrittore (+ il suo Critico), quindi il delta è quasi interamente attribuibile alla scrittura. Dopo il DONE il weekly si è fermato (87→88 in 3h di idle).

**Doppia lettura (entrambe vere):**
- In **assoluto è contenuto**: 11pp, e per-CV è piccolo (0,37pp). L'intuizione "abbastanza poco" non è sbagliata.
- In **contesto è caro**: il team era già al 74% a inizio giornata (26% di runway al reset di venerdì). La scrittura non richiesta ha mangiato **~40% del runway residuo** e ha ribaltato lo stato da `OK` a `SOPRA-PACE-WEEKLY`. È spreco puro su lavoro fantasma — e lo Scrittore è il ruolo brucia-token per definizione (value-chain-shift).

## 5. Perché è colpa del thinking-OFF (non del modello in sé)

Sui team a **modello forte** il gate regge: betaC (Codex) osservato lo stesso giorno **rifiuta** correttamente lo Scrittore senza `write_requested` ("no Writer: next-for-scrittore is empty because there is no write_requested=1"). La differenza non è "Kimi vs Codex" tout court: è che il **coordinamento** (enforcement dei gate, giudizio pacing) è un compito di ragionamento, e a Kimi serve la catena per non collassare su una scorciatoia sbagliata. A thinking-OFF il Capitano Kimi "salta" il passaggio e inverte la regola.

## 6. Decisione e fix

- ✅ **Capitano → thinking ON** (rimosso `capitano` dalla lista `--no-thinking`). Costa più del coast-burn, ma è **necessario**: un Capitano che inventa il consenso dell'utente è inaccettabile.
- ⏸️ **Sentinella → resta OFF**. Compito più stretto (monitoraggio soglie/trend), meno esposto a errori di deliberazione strutturale. Si osserva nei prossimi giorni se regge o se va riportata ON.

Fix in `.launcher/start-agent.sh` (ramo `kimi`):
```sh
case "$ROLE" in
  sentinella) THINKING_FLAG=" --no-thinking" ;;   # <-- dopo (solo Sentinella)
esac
```

**Implicazione go-live:** Kimi K2.7 come Capitano è affidabile **solo** con thinking ON. Da tenere presente nella scelta modello/costo per la beta (coerente con "modello debole = caso peggiore").

## 7. Stato / gating

- ✅ **DEPLOYATO 2026-07-01** (immagine `13057f2a`, `jht upgrade` su beta-3 e betaB): `start-agent.sh` ramo `kimi` → `sentinella) --no-thinking`, Capitano thinking-ON. (Era su `dev2`, poi mergiato in master.)
- Team **NON toccato a runtime** (regola: simulazione = sola lettura). L'osservazione dello stato attuale (violazione + costo) è essa stessa il dato.
- Fix distinto e dello stesso giorno: `2026-07-01-reset-*` / crash-loop del bridge (`1ca2a8b36`), non correlato a questa vicenda.
