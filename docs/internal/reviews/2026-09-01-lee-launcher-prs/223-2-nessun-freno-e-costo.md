# PR #223 — Rischio 2/5: nessun freno e costo del loop

**File sotto esame:** `.launcher/pager-unstick-watchdog.sh` (57 righe, nuovo)
**Data:** 2026-09-01 · **Ambito:** sola analisi, nessuna modifica applicata

---

## ⛔ Verdetto

**BLOCCANTE.** Il rischio è **confermato in pieno, e peggiore di come è stato descritto nel ticket.**
Lo script non ha **nessuna** forma di memoria fra un tick e l'altro: né cooldown per sessione,
né cap in finestra, né escalation, né registro. Ma soprattutto — e questa è la scoperta che
alza il rischio da "spreco" a "bloccante" — **non legge nessuno dei tre freni di sicurezza
che tutti gli altri watchdog del repo rispettano** (`.team-halted.flag`, `.weekly-halt.flag`,
`.team-standby.flag`). Non c'è quindi un solo meccanismo, automatico o manuale, capace di
fermarlo se non `docker rm -f`: **è l'unico processo del container che continua a spendere
dopo che l'utente ha premuto Stop, dopo il weekly-halt e durante lo standby a spesa zero.**

Questo è esattamente il guasto già pagato una volta e corretto in
`codex-auth-healer.sh:28-32` (`[HEALER-BLIND-TO-GATES-AND-ROLES]`): *«In standby a spesa zero
questo era l'UNICO processo capace di far ripartire una TUI e rimettersi a spendere —
esattamente ciò che lo standby esiste per impedire.»* La PR #223 lo reintroduce identico.

## 💸 Stima del costo in apertura

| Scenario | Nudge/h | Burn | Esito in una notte (8h) |
|---|---|---|---|
| **1 sessione** in falso positivo persistente | 84–153 (≈120) | **1,7–3,4 %weekly/h** | 13–27% del budget settimanale, bruciato da una sola sessione |
| **Team intero** (8 sessioni) che matcha | ≈75/sessione → **600/h** | **8,4–16,8 %weekly/h** | **67–134% del weekly**: quota esaurita in 6–12 h |

Prima ancora del weekly cede la **finestra rolling 5h**, che vale il 17% del weekly su
Codex (`shared/skills/provider_capacity.py:55-60`): al ritmo sopra si satura in **1–2 ore**,
il provider passa a 429 e **tutto il team si ferma** mentre il watchdog continua a martellare.

Il precedente interno che dice quanto costa davvero è documentato in
`agents/_skills/tmux-send/jht-tmux-send:49-51`: l'overspawn del 07/06 portò il *weekly Codex
al 100%* e costò **~3,5 giorni di halt forzato**. Su un abbonamento Claude Max x20 (€200/mese,
≈€46/settimana) sono ~€23 di valore distrutto **più la ricerca ferma per 3 giorni e mezzo**.
Su un setup a consumo (API metered) non esiste alcun tetto: la spesa è illimitata.

---

## 1. Assenza di limitazioni — analisi del flusso

Lo script intero è un `while true` (riga 36) senza una sola variabile che sopravviva al giro.
Non esiste alcun file di stato, alcun contatore, alcun timestamp.

```
36  while true; do
37    sessions=$(tmux list-sessions -F '#{session_name}' ...)   ← nessun filtro di sessione
38    for s in $sessions; do
39      tail3=$(tmux capture-pane -t "$s" -p -S -3 ...)
42-43    if <firma pager>; then
45          tmux send-keys -t "$s" q                            ← nessun cooldown
47          after=$(tmux capture-pane -t "$s" -p -S -3 ...)
48          if <'Conversation interrupted'>; then
49              jht-tmux-send "$s" "Continue where you left off." ... || true   ← ⚠ turno LLM
56    sleep "$INTERVAL_SEC"                                     ← 20s e si ricomincia
```

### I rami che possono ripetersi all'infinito

**(a) Ramo `q` a vuoto — riga 45.** Se la firma matcha ma il pane non è realmente in un pager
(falso positivo), `q` viene digitato come **carattere letterale nel composer** della TUI. Il
pane non cambia, la firma resta, e al tick successivo si ripete: dopo un'ora il composer
contiene ~180 `q`. Non costa token, ma **corrompe il canale**: il prossimo messaggio reale
inviato da `jht-tmux-send` diventa `qqq...[@capitano -> @scout-1] [MSG] ...`, la regex della
busta (`jht-tmux-send:170`) non matcha più e il messaggio finisce in `messages.jsonl` con
`from=""`/`to=""` — invisibile nel team chart e non attribuibile.

**(b) Ramo nudge LLM — riga 49. È il ramo costoso.** Ogni passaggio manda un prompt che fa
ripartire il modello. Nessun cooldown, nessun cap, nessuna escalation, nessuna memoria: se la
condizione persiste, il prompt riparte **ogni ~25 secondi, indefinitamente**.

**Perché la condizione persiste — il moltiplicatore che il ticket non aveva visto.**
`tmux capture-pane -S -3` **non cattura le ultime 3 righe**: `-S` è la riga *iniziale* e i
numeri negativi indicano lo scrollback, mentre `-E` di default è il fondo del pane. Quindi
`-S -3` cattura **3 righe di storia + TUTTO il pane visibile** (≈40–50 righe). Due conseguenze
dirette sulla ripetibilità:

- la firma del pager (righe 42-43) viene cercata in tutta la schermata, non nel footer: basta
  che l'agente *parli* del pager, legga questo stesso script, o incolli un transcript, perché
  matchi — è la stessa classe di guasto del "FALSO-OCCUPATO" già documentato in
  `jht-tmux-send:239-247`, dove il Capitano si auto-zittì per ore citando *«esc to interrupt»*
  nella propria prosa;
- **`Conversation interrupted` (riga 48) resta sullo schermo per decine di righe di output.**
  Una volta stampato, il ramo nudge continua a scattare a ogni tick anche molto dopo che
  l'evento è passato.

Gli altri due watchdog che leggono il pane restringono esplicitamente la finestra:
`codex-auth-healer.sh:161` fa `capture-pane -p | tail -25`, `stepcap-watchdog.py:106`
usa `TAIL_LINES=40` con un tail vero e in più **ancora la rilevazione all'hash del pane
identico al giro precedente**, con questa motivazione testuale (`stepcap-watchdog.py:24-26`):
*«senza il controllo sull'hash questo watchdog diventa un generatore di nudge a raffica su un
agente che sta lavorando»*. Il pager watchdog è l'unico dei tre a non avere né tail né hash.

**(c) Amplificazione.** Il nudge "Continue where you left off." spinge l'agente a riprendere
il lavoro, cioè a **rileggere file** — che è la causa documentata dell'apertura del pager
(righe 5-10 dello script). Il rimedio alimenta la causa.

**(d) Nessun filtro di sessione — riga 37.** `tmux list-sessions` restituisce *tutto*:
`SENTINELLA-WORKER` (pane sensore del bridge, non un agente in chat), `DOTTORE`,
`MANTENITORE`, `DOCTOR-WATCHDOG`, più qualunque sessione utente. Tutti gli altri componenti
filtrano: `agent-watchdog.sh:295-306` (`is_agent_session`, che esclude esplicitamente
`SENTINELLA-WORKER` e i one-shot), `codex-auth-healer.sh:102-113` (`role_of` via
`team_roster.py roles`), `stepcap-watchdog.py:18-19` (solo i WORKER: *«i core NON si nudgeano
in automatico»*). Qui un nudge LLM può finire in un pane che non è un agente.

**(e) Nessun gate di spesa.** Confronto diretto:

| Freno | agent-watchdog | codex-auth-healer | stepcap-watchdog | **pager-unstick** |
|---|---|---|---|---|
| `.team-halted.flag` | :651 | :148 | :582 | **assente** |
| `.weekly-halt.flag` | :651 | :148 | :591-592 | **assente** |
| `.team-standby.flag` (predicato) | :674 | :148 | :570-575 | **assente** |
| working hours | :284 | — | :65-68 | **assente** |
| cooldown / cap | :99-101 | :37-38 | :116-117,127 | **assente** |
| filtro sessioni | :295-306 | :102-113 | worker-only | **assente** |
| registro durevole | :82,189-211 | — | `stepcap.jsonl` | **assente** |

**(f) pid1 lo rende immortale.** `cli/src/commands/pid1.js:806-827` lo spawna con
respawn-on-crash a 5 s. Un crash non è una via d'uscita: qualunque stato tenuto in memoria
sarebbe azzerato e il loop ripartirebbe pulito. **Questo è il motivo per cui il freno deve
vivere su disco, non in una variabile.**

---

## 2. Quantificazione del danno

### Dati reali usati (nessuno inventato)

| Dato | Valore | Fonte |
|---|---|---|
| Burn naturale dell'**intero team** a piena velocità, Codex/OpenAI | **2,70 %weekly/h** (`confidence: high`) | `shared/skills/provider_capacity.py:55-60` |
| idem Claude | 2,50 %weekly/h | `provider_capacity.py:64-69` |
| idem Kimi | 4,60 %weekly/h (stima) | `provider_capacity.py:81-83` |
| Valore di una finestra 5h piena rispetto al weekly (Codex) | 17,0% | `provider_capacity.py:55` |
| Ore/settimana per saturare il weekly (`sweet_spot_min_hours`) | 100/2,70 ≈ **37 h** | `provider_capacity.py:197-201` |
| Cadenza **massima di progetto** di un worker | 1 turno / 300 s = **12 turni/h** (worker floor) | `shared/skills/throttle-config.py:57-61` |
| Ladder dei throttle | 5→60 min, floor 5 min | `throttle-config.py:52-56`, `MAX_SLEEP=3600` :85 |
| Roster "normale" | 3-4 worker (+4 core) ≈ **8 sessioni** | `provider_capacity.py:79-80` |
| Costo di un weekly bruciato | **~3,5 giorni di halt forzato** | `jht-tmux-send:49-51` (incidente 07/06) |

### Assunzioni dichiarate

- **A1** — Team tipico = 4 core + 4 worker = **8 sessioni tmux** (da A/`provider_capacity.py:79-80`).
- **A2** — I 2,70 %weekly/h sono il consumo dell'*intero* team, quindi **≈0,34 %weekly/h per sessione**.
- **A3** — Un team a piena velocità gira alla cadenza di progetto (12 turni/h/worker), quindi
  **un turno vale ≈0,34/12 ≈ 0,028 %weekly**.
- **A4** — Un turno di *nudge* costa **meno** di un turno di lavoro pieno (meno tool call), ma
  **non poco**: rimanda l'intero transcript come input. Assumo prudenzialmente un intervallo
  **0,5×–1,0×** del turno medio → **0,014–0,028 %weekly per nudge**.

### Ritmo effettivo del loop

Durata di un ciclo su una sessione bloccata = `INTERVAL_SEC` (20 s, riga 30) + `sleep 1`
(riga 46) + durata di `jht-tmux-send`. Il sender impiega **~2,5 s** nel caso migliore
(`jht-tmux-send:391` sleep 1, `:416` sleep 0,3, `:442` sleep 1,2) e fino a **~22 s** nel caso
peggiore (3 tentativi × 3 Enter, `:366`, `:415`). Ciclo = **23,5–43 s → 84–153 nudge/h**,
centrale ≈120/h.

> **≈120 nudge/h contro una cadenza di progetto di 12 turni/h: il watchdog gira a 10× il ritmo
> massimo che il sistema di throttling è progettato per consentire a un worker.**

### Il conto

**Una sola sessione** in falso positivo: 120 × (0,014–0,028) = **1,7–3,4 %weekly/h**. È il
**5–10× del consumo naturale di una sessione sana** e arriva fino a **superare il burn
dell'intero team in salute**. Una notte (8 h) = **13–27% del weekly**, prodotto da zero lavoro.

**Team intero** (falso positivo sistemico — il caso realistico, perché la firma è cercata in
tutta la schermata e tutte le sessioni girano sulla stessa TUI): il tick si allunga a
20 + 8×3,5 ≈ 48 s, quindi ~75 nudge/h a sessione = **600 nudge/h di team** →
**8,4–16,8 %weekly/h** → **weekly esaurito in 6–12 ore**. Una notte = **67–134% del weekly**.

**Cosa si rompe per primo.** Non il weekly: la **finestra rolling 5h**, che vale il 17% del
weekly. A 8-17 %weekly/h la si riempie in **1–2 ore** → 429 dal provider → **l'intero team è
bloccato** e il watchdog continua comunque a mandare `q` e prompt.

**In euro.** L'abbonamento è flat, quindi il danno non è una fattura: è **quota bruciata e
tempo di team perso**. Su Claude Max x20 (€200/mese ≈ €46/settimana), un weekly bruciato in
una notte = fino a €46 di valore settimanale + il precedente misurato dei **3,5 giorni di
halt** (`jht-tmux-send:49-51`) ≈ **€23 di abbonamento inutilizzabile e la ricerca ferma**.
Su provider a consumo **non c'è tetto**.

### Effetti collaterali misurabili

- `messages.jsonl` (`jht-tmux-send:163-221`): **una riga JSON per nudge**, con
  `from=""`/`to=""` perché "Continue where you left off." non ha busta → 600 righe/h di
  rumore nel log che alimenta il team chart della UI e i case studies.
- `pending-input.jsonl` (`jht-tmux-send:346-361`): a ogni `rc=5` si scrive un record. È il
  file su cui il Dottore basa la skill `agent-unblock` → viene **sommerso**.

---

## 3. Interazione col resto del sistema

### Il nudge scavalca il throttling? **Sì, per costruzione.**

Il throttling in JHT è **pull-side**: è l'agente che chiama `throttle`/`jht-throttle` nel
proprio loop e il motore (`shared/skills/throttle_engine.py`, daemon di pid1) tiene il timer e
la sveglia (`agents/_tools/jht-throttle:14-24`). Non esiste alcun gate *push-side*: chiunque
scriva nel pane fa ripartire il modello, punto. **Un prompt iniettato dall'esterno bypassa il
floor dei 5 minuti e la ladder in modo strutturale**, perché quei freni si applicano *in
lettura*, dentro il turno dell'agente (`throttle-config.py:57-61`).

Il fatto che il bypass sia strutturale è precisamente il motivo per cui **ogni altro
iniettore ha il proprio freno interno**, e perché la mancanza di uno qui non è un dettaglio
ma il difetto centrale.

### `jht-tmux-send` — cosa fa davvero prima di inviare

Ho letto le 476 righe. Sintesi dei controlli, nell'ordine:

1. **Argomenti** (`:66-70`) → `exit 1`. **Sessione esistente** (`:78-81`) → `exit 2`.
2. **Anti-impersonazione #198** (`:99-141`): deriva il mittente dalla *parentela dei processi*
   via `shared/skills/message_origin.py`; se la busta dichiara un agente diverso, rifiuta con
   `exit 6` dopo aver registrato il tentativo. *Nota:* il nudge del pager **non ha busta**, quindi
   cade in `unverified` (non `impersonation`) e passa.
3. **Provider attivo** (`:149-157`) per il `C-s` extra su Kimi.
4. **Log strutturato** su `messages.jsonl` (`:163-221`), best-effort.
5. **Busy-detection** (`:262-296`): riconosce la *riga di stato* `esc to interrupt`
   distinguendola dalla prosa. ⚠️ **Busy non blocca più la digitazione** (`:298`, `:372-386`):
   il testo viene **digitato e accodato anche in un pane occupato**. Quindi il nudge del pager
   entra nel composer **anche mentre l'agente sta lavorando davvero**.
6. **Verifica del submit** (`:411-448`): fino a 3 Enter, poi rilettura del pane.

**Codici di ritorno** (`:41-62`): `0` consegnato · `1` argomenti · `2` sessione assente ·
`3` TUI irricettiva (**l'unico che autorizza l'escalation-per-morte**) · `4` occupata oltre il
budget · `5` "vivo ma muto" · `6` impersonazione / consegna non verificata su pane busy.

**Non c'è alcun gate di throttle, halt, standby o working-hours in `jht-tmux-send`.** È un
canale di trasporto, non un freno — coerentemente, ogni chiamante mette il freno *prima*.

**Il pager watchdog butta via il codice di ritorno**: riga 49, `... || true`. La documentazione
del sender è esplicita sul fatto che `4` e `5` significano *«il chiamante deve RIPROVARE più
tardi»* (`:47-55`). Qui "più tardi" vuol dire **20 secondi**, ed è esattamente l'abuso che quei
codici esistono per prevenire. `pacing-bridge.py:226` mostra il contratto corretto:
`UNRECEPTIVE_ESCALATE_AFTER=2` tick consecutivi di `rc=3` → escalation, e `rc=4` **non conta**.

### Due daemon che scrivono nello stesso pane: sì, si pestano i piedi

**Non esiste alcuna serializzazione delle scritture sui pane.** L'unico lock del repo
(`codex-auth-healer.sh:115-139`) è un singleton *di processo*, non un lock di pane. Gli
scrittori concorrenti e le loro cadenze:

| Scrittore | Cadenza | Cosa scrive |
|---|---|---|
| **pager-unstick** | **20 s** ← il più veloce di tutti | `send-keys q` grezzo + prompt |
| `agent-watchdog` (`worker_kickoff` :328-344) | 30 s (+`sleep 12`) | prompt di kick-off |
| `stepcap-watchdog` | 60 s | prompt via **tmux buffer** (`TMUX_BUFFER`, :129) |
| `codex-auth-healer` | 60 s | `kill-session` + `team start` |
| `throttle_engine` | sveglie | prompt di risveglio |
| `pacing-bridge` | 15 min (:215) | `[BRIDGE PACING]` → SENTINELLA |

Collisioni concrete:

- **`q` in mezzo a un messaggio altrui.** `jht-tmux-send` digita carattere per carattere
  (`send-keys -l`, `:373`/`:389`) e poi attende 1 s prima di verificare. Un `q` del pager
  watchdog che arriva in quella finestra si infila **dentro** il testo: la verifica della
  signature (`:402-409`) può fallire → il sender ritenta → il messaggio viene digitato due
  volte, oppure passa con la busta corrotta. Finestra di collisione: ~1 s ogni 20 s per pane.
- **`q` contro il paste-buffer di stepcap.** `stepcap-watchdog` usa deliberatamente un buffer
  tmux *«mai send-keys col testo inline: il quoting salta al primo apice»*
  (`stepcap-watchdog.py:40-41`). Un `send-keys` grezzo concorrente vanifica quella protezione.
- **`q` contro l'`Escape` del sender.** `jht-tmux-send:467-469` manda `Escape` per chiudere i
  modal. Le due sequenze si alternano ogni 20 s su stati di TUI diversi: esito non
  deterministico.
- **pager vs codex-auth-healer.** L'healer fa `kill-session` (`:175`); il pager watchdog fa
  `tmux send-keys` (riga 45) **senza `2>/dev/null`** — su sessione appena uccisa l'errore
  finisce sullo stderr del daemon, non nel suo log. Rumore, non danno.
- **Doppio nudge sullo stesso stallo.** stepcap e pager possono classificare lo *stesso* pane
  fermo come proprio caso e mandare due prompt: stepcap paga il throttle prima
  (`stepcap-watchdog.py:34-39`), il pager no.

---

## 4. Il precedente interno da replicare — `agent-watchdog.sh`

`agent-watchdog.sh` ha **due meccanismi distinti** che insieme sono il modello esatto.

### (A) Flap cap + escalation con cooldown — `:435-464`

Costanti (`:98-101`):

```bash
BRIDGE_STATE_DIR="$JHT_HOME/logs"
BRIDGE_FLAP_WINDOW_SEC="${JHT_BRIDGE_FLAP_WINDOW_SEC:-600}"    # finestra 10 min
BRIDGE_FLAP_CAP="${JHT_BRIDGE_FLAP_CAP:-3}"                    # max 3 respawn/finestra
BRIDGE_ESCALATE_COOLDOWN_SEC="${JHT_BRIDGE_ESCALATE_COOLDOWN_SEC:-3600}"
```

- **`bridge_flap_ok <key>` (`:435-442`)** — ritorna 0 se sotto il cap. Legge
  `$BRIDGE_STATE_DIR/bridge-flap-<key>`, conta con `awk` i timestamp `>= now - WINDOW` e
  confronta con `BRIDGE_FLAP_CAP`. File assente = via libera.
- **`bridge_flap_record <key>` (`:444-450`)** — appende `now` **e pota** i timestamp fuori
  finestra (rolling window), con scrittura atomica `tmp` + `mv`.
- **`bridge_escalate <what>` (`:452-464`)** — al superamento del cap **smette di rispawnare**
  e avvisa il Capitano **una sola volta per finestra di cooldown**, usando un singolo file
  timestamp `bridge-escalate.ts`. Il messaggio dice esplicitamente *«Automatic respawn has been
  STOPPED to prevent a crash loop. Manual diagnosis is required»*.
- **La chiave è per-entità, non globale** (`:532`, `bridge_flap_ok "tg-bridge-$_tg_role"`) —
  con commento esplicito al `:528-529`: *«Il flap-cap è per ruolo, se no quello rotto consuma
  il credito dei sani e li lascia morti quando muoiono davvero.»*
- **Il ramo di uscita non è mai "continua in silenzio"**: `:547-549`, i processi profondi morti
  che pid1 dovrebbe gestire vengono **solo escalati**, mai riparati da qui.

Il razionale è scritto in testa alla funzione (`:89-97`) e cita il post-mortem
`2026-06-27-betaC-sentinel-bridge-crash.md`: *«Anti-flap (lezione del V4 restart-loop, per cui
il self-restart del bridge fu RIMOSSO): oltre un cap di respawn in finestra, NON rispawna più e
ESCALA al Capitano — niente crash-loop.»*

### (B) Registro append-only dei recovery — `:177-229`

- **`RECOVERY_LOG`** (`:82`) = `$JHT_HOME/logs/agent-recoveries.tsv`, override-abile via
  `JHT_AGENT_RECOVERY_LOG` **esplicitamente per i test** (`:80-81`).
- **`recovery_today_count <day> <session>` (`:177-187`)** — conta con `awk -F '\t'` le righe del
  giorno per quella sessione. Il commento (`:178-180`) spiega la scelta: *«TSV, non un contatore
  in memoria: un crash del watchdog non può azzerare la storia che serve a capire se un agente è
  morto dieci volte oggi.»*
- **`record_recovery` (`:189-211`)** — scrive `ts \t session \t observation`, **poi** rilegge il
  conteggio. Se `mkdir`/`printf` falliscono → log loud e `return 1`: *«Se la scrittura fallisce
  non mandiamo un numero inventato al Capitano: log loud, nessuna misura dichiarata completa.»*
- **`notify_captain_recovery` (`:213-229`)** — l'evento durevole è scritto **prima** della
  notifica; se la notifica fallisce, l'evidenza resta comunque su disco.
- Due sorgenti separate e volute: il **file rolling** serve al cap (si pota), il **TSV
  append-only** serve alla diagnosi (non si pota mai).

L'altro precedente utile è il **cooldown per agente** di `codex-auth-healer.sh:164-172`:
`COOLDOWN=300` s (`:38`), un file per sessione in `$STATE_DIR/$sess` contenente l'epoch
dell'ultimo intervento, con log esplicito quando lo skip avviene.

---

## 5. Proposta concreta (diff testuale — **NON applicato**)

### Principio di progetto

**Separare i due gesti perché hanno costi diversi.** `q` è gratis (nessun LLM) e sbloccare un
pager è utile anche durante un halt → cooldown breve, nessun gate di spesa. Il **nudge** è un
turno LLM → cooldown lungo, cap in finestra, gate di spesa, escalation.

Al superamento del cap: **si smette e si escala**, mai "si continua in silenzio".

### Nuove env var (convenzioni `JHT_*` esistenti)

| Variabile | Default | Modello |
|---|---|---|
| `JHT_PAGER_DISMISS_COOLDOWN_SEC` | `60` | — (gesto gratuito) |
| `JHT_PAGER_NUDGE_COOLDOWN_SEC` | `300` | `CODEX_AUTH_HEALER_COOLDOWN` (healer `:38`) |
| `JHT_PAGER_NUDGE_WINDOW_SEC` | `3600` | `JHT_BRIDGE_FLAP_WINDOW_SEC` (`:99`) |
| `JHT_PAGER_NUDGE_CAP` | `3` | `JHT_BRIDGE_FLAP_CAP` (`:100`) |
| `JHT_PAGER_ESCALATE_COOLDOWN_SEC` | `3600` | `JHT_BRIDGE_ESCALATE_COOLDOWN_SEC` (`:101`) |
| `JHT_PAGER_CAPTAIN` | `CAPITANO` | `JHT_STEPCAP_CAPTAIN` (stepcap `:128`) |
| `JHT_PAGER_TMUX_SENDER` | `jht-tmux-send` | `JHT_TMUX_SENDER` (`:84`) — **iniettabile nei test** |
| `JHT_PAGER_STATE_DIR` | `$JHT_HOME/logs/.pager-unstick` | `STATE_DIR` (healer `:36`) |
| `JHT_PAGER_NUDGE_LOG` | `$JHT_HOME/logs/pager-unstick.tsv` | `JHT_AGENT_RECOVERY_LOG` (`:82`) |

`JHT_PAGER_WATCHDOG_INTERVAL` resta com'è (riga 30).

### Diff

```diff
--- a/.launcher/pager-unstick-watchdog.sh
+++ b/.launcher/pager-unstick-watchdog.sh
@@
 JHT_HOME="${JHT_HOME:-/jht_home}"
 LOG="$JHT_HOME/logs/pager-unstick-watchdog.log"
 INTERVAL_SEC="${JHT_PAGER_WATCHDOG_INTERVAL:-20}"
+
+# ── Freni (2026-09-01) ─────────────────────────────────────────────────────
+# `q` e il nudge hanno budget SEPARATI perche' hanno costi separati: il primo
+# e' un tasto, il secondo fa ripartire il modello. Senza questa distinzione o
+# si paralizza lo sblocco o si lascia aperto un rubinetto di token.
+# Modello: bridge_flap_ok/record/escalate di agent-watchdog.sh:435-464 e il
+# cooldown per-agente di codex-auth-healer.sh:164-172.
+DISMISS_COOLDOWN_SEC="${JHT_PAGER_DISMISS_COOLDOWN_SEC:-60}"
+NUDGE_COOLDOWN_SEC="${JHT_PAGER_NUDGE_COOLDOWN_SEC:-300}"
+NUDGE_WINDOW_SEC="${JHT_PAGER_NUDGE_WINDOW_SEC:-3600}"
+NUDGE_CAP="${JHT_PAGER_NUDGE_CAP:-3}"
+ESCALATE_COOLDOWN_SEC="${JHT_PAGER_ESCALATE_COOLDOWN_SEC:-3600}"
+CAPTAIN_SESSION="${JHT_PAGER_CAPTAIN:-CAPITANO}"
+TMUX_SENDER="${JHT_PAGER_TMUX_SENDER:-jht-tmux-send}"
+# Lo stato vive su DISCO, non in memoria: pid1 rispawna questo daemon 5s dopo
+# un crash (cli/src/commands/pid1.js:818-824) e un contatore in RAM
+# ripartirebbe da zero — cioe' il cap non esisterebbe proprio nel caso in cui
+# serve. Stessa ragione del TSV di agent-watchdog.sh:178-180.
+STATE_DIR="${JHT_PAGER_STATE_DIR:-$JHT_HOME/logs/.pager-unstick}"
+NUDGE_LOG="${JHT_PAGER_NUDGE_LOG:-$JHT_HOME/logs/pager-unstick.tsv}"
+TEAM_HALTED_FLAG="$JHT_HOME/.team-halted.flag"
+WEEKLY_HALT_FLAG="$JHT_HOME/.weekly-halt.flag"
+TEAM_STANDBY_FLAG="$JHT_HOME/.team-standby.flag"
+STANDBY_PY="${JHT_STANDBY_PY:-/app/shared/skills/standby.py}"
+mkdir -p "$STATE_DIR" "$(dirname "$LOG")" 2>/dev/null || true
 
 log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }
 
-log "pager-unstick-watchdog up — interval=${INTERVAL_SEC}s"
+# Standby ATTIVO? Stesso predicato unico degli altri watchdog: un flag SCADUTO
+# non e' piu' standby (fail-CLOSED sul solo `-e` se il modulo non e'
+# invocabile). Copia di codex-auth-healer.sh:84-93.
+standby_active() {
+  [ -e "$TEAM_STANDBY_FLAG" ] || return 1
+  local state
+  state="$(JHT_HOME="$JHT_HOME" python3 "$STANDBY_PY" active 2>/dev/null)"
+  case "$state" in
+    active)              return 0 ;;
+    expired|invalid|off) return 1 ;;
+    *)                   return 0 ;;
+  esac
+}
+
+# Gate di SPESA: valgono per il nudge (turno LLM), non per `q` (un tasto).
+# Gli stessi tre di agent-watchdog.sh:651/674 e codex-auth-healer.sh:148 — un
+# unstick non e' una deroga ai freni di sicurezza. Stampa il MOTIVO del blocco.
+spend_gates_open() {
+  [ -e "$TEAM_HALTED_FLAG" ] && { printf 'team-halted'; return 1; }
+  [ -e "$WEEKLY_HALT_FLAG" ] && { printf 'weekly-halt'; return 1; }
+  standby_active && { printf 'team-standby'; return 1; }
+  return 0
+}
+
+cooldown_ok()    { local f="$STATE_DIR/$1.ts" now last
+                   now=$(date -u +%s); last=$(cat "$f" 2>/dev/null || echo 0)
+                   [ $((now - last)) -ge "$2" ]; }
+cooldown_touch() { date -u +%s > "$STATE_DIR/$1.ts" 2>/dev/null || true; }
+
+# Rolling window, identico a bridge_flap_ok (agent-watchdog.sh:435-442).
+# Chiave PER SESSIONE: un cap globale lascerebbe la sessione rotta a consumare
+# il credito delle sane (agent-watchdog.sh:528-529).
+nudge_window_count() {
+  local f="$STATE_DIR/nudge-$1" now cutoff
+  now=$(date -u +%s); cutoff=$((now - NUDGE_WINDOW_SEC))
+  [ -f "$f" ] || { echo 0; return 0; }
+  awk -v c="$cutoff" '$1+0>=c' "$f" 2>/dev/null | wc -l | tr -d ' '
+}
+
+# Due scritture DIVERSE e volute: il file rolling serve al cap (si pota), il
+# TSV e' append-only e risponde a "quante volte e' stato nudgeato oggi SCOUT-1?"
+# anche dopo che il log rotante e' scorso via (agent-watchdog.sh:76-79).
+record_nudge() {
+  local s="$1" reason="$2" f="$STATE_DIR/nudge-$1" now cutoff
+  now=$(date -u +%s); cutoff=$((now - NUDGE_WINDOW_SEC))
+  { [ -f "$f" ] && awk -v c="$cutoff" '$1+0>=c' "$f" 2>/dev/null; echo "$now"; } \
+    > "$f.tmp" 2>/dev/null && mv "$f.tmp" "$f" 2>/dev/null || true
+  printf '%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$s" "$reason" >> "$NUDGE_LOG" 2>/dev/null \
+    || log "session $s: nudge inviato ma NON registrato in $NUDGE_LOG"
+}
+
+# Superato il cap si SMETTE e si avvisa una volta per finestra di cooldown.
+# Non "si continua piu' piano": un falso positivo persistente non guarisce
+# rallentando (agent-watchdog.sh:452-464).
+pager_escalate() {
+  local s="$1" cnt="$2"
+  cooldown_ok "escalate-$s" "$ESCALATE_COOLDOWN_SEC" || return 0
+  cooldown_touch "escalate-$s"
+  log "session $s: NUDGE CAP superato ($cnt in $((NUDGE_WINDOW_SEC/60))min) — nudge STOPPATI, escalation a $CAPTAIN_SESSION"
+  "$TMUX_SENDER" "$CAPTAIN_SESSION" \
+    "[WATCHDOG] $s continua a mostrare la firma del pager fullscreen: $cnt riprese in $((NUDGE_WINDOW_SEC/60)) min. I nudge automatici sono STOPPATI per non bruciare budget in loop — la sessione puo' essere in falso positivo o davvero incastrata. Diagnosi manuale: $LOG e il registro durevole $NUDGE_LOG." \
+    >/dev/null 2>&1 || true
+}
+
+log "pager-unstick-watchdog up — interval=${INTERVAL_SEC}s · dismiss_cooldown=${DISMISS_COOLDOWN_SEC}s · nudge_cooldown=${NUDGE_COOLDOWN_SEC}s · nudge_cap=${NUDGE_CAP}/$((NUDGE_WINDOW_SEC/60))min · gates=halted,weekly,standby"
 
 while true; do
   sessions=$(tmux list-sessions -F '#{session_name}' 2>/dev/null || true)
   for s in $sessions; do
     tail3=$(tmux capture-pane -t "$s" -p -S -3 2>/dev/null || true)
     if printf '%s' "$tail3" | grep -q 'pgup/pgdn to page' \
       && printf '%s' "$tail3" | grep -q 'q to quit'; then
+      # `q` a raffica non costa token ma sporca il composer quando la firma e'
+      # un falso positivo: un tasto al minuto basta a sbloccare un pager vero.
+      cooldown_ok "dismiss-$s" "$DISMISS_COOLDOWN_SEC" || continue
+      cooldown_touch "dismiss-$s"
       log "session $s: stuck in pager, dismissing"
-      tmux send-keys -t "$s" q
+      tmux send-keys -t "$s" q 2>/dev/null || true
       sleep 1
       after=$(tmux capture-pane -t "$s" -p -S -3 2>/dev/null || true)
       if printf '%s' "$after" | grep -q 'Conversation interrupted'; then
-        jht-tmux-send "$s" "Continue where you left off." >>"$LOG" 2>&1 || true
-        log "session $s: dismissal interrupted the turn, sent resume nudge"
+        if ! gate="$(spend_gates_open)"; then
+          log "session $s: turno interrotto ma nudge SOSPESO ($gate) — l'utente/il budget hanno la precedenza"
+          continue
+        fi
+        cnt="$(nudge_window_count "$s")"
+        if [ "${cnt:-0}" -ge "$NUDGE_CAP" ]; then
+          pager_escalate "$s" "$cnt"
+          continue
+        fi
+        if ! cooldown_ok "nudge-$s" "$NUDGE_COOLDOWN_SEC"; then
+          log "session $s: turno interrotto ma nudge in cooldown (<${NUDGE_COOLDOWN_SEC}s dall'ultimo)"
+          continue
+        fi
+        cooldown_touch "nudge-$s"
+        # Registrato PRIMA dell'invio: se il sender fallisce a meta' l'evento e'
+        # comunque avvenuto e deve contare per il cap (agent-watchdog.sh:216-219).
+        record_nudge "$s" "resume-after-pager"
+        "$TMUX_SENDER" "$s" "Continue where you left off." >>"$LOG" 2>&1; rc=$?
+        # Il codice di ritorno NON si butta: 4 e 5 vogliono dire "vivo, riprova
+        # PIU' TARDI, mai respawnare" (jht-tmux-send:47-55) — e "piu' tardi" e'
+        # il cooldown appena armato, non 20 secondi.
+        log "session $s: nudge di ripresa inviato (rc=$rc, #$((cnt+1))/${NUDGE_CAP} in $((NUDGE_WINDOW_SEC/60))min)"
       else
         log "session $s: dismissed cleanly, no resume needed"
       fi
     fi
   done
   sleep "$INTERVAL_SEC"
 done
```

### Effetto sulla stima

Con `NUDGE_CAP=3` / `NUDGE_WINDOW_SEC=3600` il tetto passa da **~120 nudge/h/sessione a 3**:
il burn di una sessione in falso positivo scende da 1,7–3,4 %weekly/h a **≤0,08 %weekly/h**
(**−97%**), e dopo la prima ora il loop **si ferma e parla** invece di continuare.

### Due sub-item consigliati (fuori dal minimo indispensabile)

1. **Filtrare le sessioni** come fa l'healer (`codex-auth-healer.sh:53,102-113`, via
   `team_roster.py roles`), per non mandare `q` e prompt in `SENTINELLA-WORKER`, `DOTTORE`,
   `MANTENITORE` o in una sessione dell'utente.
2. **Restringere la finestra di cattura**: `capture-pane -p | tail -n "${JHT_PAGER_FOOTER_LINES:-4}"`
   invece di `-S -3` (che cattura tutto il pane visibile). È il moltiplicatore principale della
   frequenza dei falsi positivi — l'analisi di merito è del rischio 3 (finestra di rilevazione),
   qui la segnalo perché **senza di essa i freni proposti vengono comunque consumati** da match
   che non sono pager.

---

## 6. Test proposto (convenzione pytest source-asserting)

Nuovo file **`tests/test_pager_unstick_brakes.py`**, stessa forma di
`tests/test_agent_watchdog_recovery_notice.py`: si estrae il *prelude* dello script fino al
marker di bootstrap e si eseguono **le funzioni vere** con i confini iniettati — nessuna TUI,
nessun container, nessuna sessione tmux.

```python
"""Un watchdog che riprende gli agenti non deve poter spendere senza tetto.

Non avviamo una TUI ne' tmux: eseguiamo le funzioni vere di
`pager-unstick-watchdog.sh` con il sender e lo stato iniettati. Il test vede
sia il freno (cooldown + cap) sia cio' che il Capitano riceve quando il freno
scatta -- e che dopo il cap NON parte piu' nessun nudge.
"""

ROOT = Path(__file__).resolve().parent.parent
WATCHDOG = ROOT / ".launcher" / "pager-unstick-watchdog.sh"

def _prelude():
    source = WATCHDOG.read_text(encoding="utf-8")
    marker = 'log "pager-unstick-watchdog up'
    assert marker in source, "il marker prima del loop watchdog e' cambiato"
    return source[:source.index(marker)]
```

Il diff sopra colloca **tutte** le funzioni prima di quel marker, esattamente perché il
prelude resti estraibile (stessa ragione dichiarata in `agent-watchdog.sh:554-555`).

Ambiente iniettato: `JHT_HOME=tmp_path`, `JHT_PAGER_TMUX_SENDER=<fake che appende su file>`,
`JHT_PAGER_STATE_DIR`, `JHT_PAGER_NUDGE_LOG`, `JHT_STANDBY_PY=<fake>`, più le soglie
abbassate (`JHT_PAGER_NUDGE_CAP=2`, `JHT_PAGER_NUDGE_WINDOW_SEC=60`, …).

Casi:

| # | Test | Asserzione |
|---|---|---|
| 1 | `test_il_nudge_ha_un_cooldown_per_sessione` | due tentativi ravvicinati su `SCOUT-1` → **una sola** riga nel file del sender; il log dice `nudge in cooldown` |
| 2 | `test_il_cap_ferma_i_nudge_e_escala_al_capitano` | con `NUDGE_CAP=2`, tre tentativi → 2 nudge a `SCOUT-1` + **1** messaggio a `CAPITANO`, e **nessun** terzo nudge |
| 3 | `test_l_escalation_e_una_sola_per_finestra_di_cooldown` | due superamenti del cap entro `ESCALATE_COOLDOWN_SEC` → **un solo** messaggio al Capitano |
| 4 | `test_il_cap_e_per_sessione_non_globale` | `SCOUT-1` al cap non impedisce il nudge a `SCOUT-2` (regressione di `agent-watchdog.sh:528-529`) |
| 5 | `test_nessun_nudge_con_halt_weekly_o_standby` (parametrizzato sui 3 flag) | sender **mai** chiamato; il log riporta il motivo (`team-halted`/`weekly-halt`/`team-standby`) |
| 6 | `test_il_registro_sopravvive_al_riavvio_del_watchdog` | si scrive lo stato, si **ri-esegue il prelude da zero** con lo stesso `JHT_HOME` → il cap è ancora applicato (simula il respawn di `pid1.js:818-824`) |
| 7 | `test_ogni_nudge_lascia_una_riga_nel_tsv_durevole` | `pager-unstick.tsv` ha `ts \t session \t reason`, una riga per nudge |
| 8 | `test_il_dismiss_resta_consentito_durante_un_halt` | con `.team-halted.flag`, il gate di spesa blocca il **nudge** ma non `q` — la scelta di progetto è verificata, non solo commentata |

Da aggiungere anche un caso al test di parità dei daemon, se esiste, per verificare che
`pager-unstick-watchdog.sh` compaia nella tabella di `shared/skills/process_health.py:37-45`
(oggi **non c'è**: né in `bridge-suite` né fra i "profondi", quindi né il Mantenitore né il
Dottore lo vedono — un runaway di questo daemon oggi è invisibile a ogni sonda del sistema).

---

## Riepilogo delle citazioni chiave

- Assenza totale di stato: `.launcher/pager-unstick-watchdog.sh:36-57`
- Nudge LLM senza freno né rc: `.launcher/pager-unstick-watchdog.sh:49`
- Finestra di cattura = tutto il pane: `.launcher/pager-unstick-watchdog.sh:39,47`
- Nessun filtro di sessione: `.launcher/pager-unstick-watchdog.sh:37`
- Modello flap cap/escalation: `.launcher/agent-watchdog.sh:98-101,435-464`
- Modello registro durevole: `.launcher/agent-watchdog.sh:76-82,177-229`
- Gate di spesa (i tre flag): `.launcher/agent-watchdog.sh:651,674` · `.launcher/codex-auth-healer.sh:148` · `.launcher/stepcap-watchdog.py:578-600`
- Stesso bug già pagato: `.launcher/codex-auth-healer.sh:28-32`
- Cooldown per-agente: `.launcher/codex-auth-healer.sh:37-38,164-172`
- Anti-raffica via hash: `.launcher/stepcap-watchdog.py:21-33`
- Contratto dei codici di ritorno: `agents/_skills/tmux-send/jht-tmux-send:41-62`
- Costo storico di un weekly bruciato: `agents/_skills/tmux-send/jht-tmux-send:49-51`
- Digitazione anche in pane occupato: `agents/_skills/tmux-send/jht-tmux-send:298,372-386`
- Burn naturale e cap di finestra: `shared/skills/provider_capacity.py:54-84,197-201`
- Cadenza massima di progetto (worker floor 300 s): `shared/skills/throttle-config.py:52-61`
- Respawn immortale da pid1: `cli/src/commands/pid1.js:806-827`
- Assente dalle sonde di salute: `shared/skills/process_health.py:37-45`
