<!-- @translation: it, ai-translated 2026-07-30 -->
# 💬 Regole di comunicazione inter-agente — lean, pull-default

Gli agenti JHT si coordinano **pull-first**. Il default è *scoprire* lo stato che ti serve, non *chiederlo*.
Un messaggio tmux è l'**eccezione**, riservata alle cose che un collega davvero non può trovare da solo.

> **Perché lean.** Un protocollo push-heavy (broadcast di stato, ACK di routine, ping "sei vivo?") brucia
> token da entrambi i lati — chi manda scrive un turno, chi riceve sveglia un turno per rispondere — e
> distrae gli agenti dal lavoro vero. Quasi tutto quel traffico non porta alcuna azione. Taglialo.

## 🪜 La gerarchia di coordinamento — DB → capture-pane → messaggio

Usa sempre il **tier più economico che risponde alla tua domanda**. Sali di tier solo quando quello
sotto davvero non ce la fa.

| Tier | Strumento | Serve per | Costo |
|---|---|---|---|
| **1. DB** | `db_query.py` (`next-for-*`, status, `last_checked`, flag) | **stato condiviso** — cosa è in coda, cosa è preso, cosa è finito, punteggi, ciclo di vita | il più economico, deterministico, senza race |
| **2. capture-pane** | `tmux capture-pane -p -S -N` sulla sessione del collega | **"cosa sta facendo X adesso?"** — sta lavorando, è bloccato su un fetch, è idle, è piantato | economico (nessun turno sul collega), ma è uno **snapshot racy** — mai fidarsene come stato durevole |
| **3. messaggio tmux** | `jht-tmux-send` | **azione che il collega non può scoprire** + **eventi di sicurezza** (vedi barra sotto) | costoso — un turno da entrambi i lati; è l'eccezione |

**Regola generale:** se la risposta è nel DB, interroga il DB. Se ti serve sapere cosa sta facendo un
collega *in questo momento*, guarda il suo pane — **non mandargli un messaggio per chiederglielo**.
Manda un messaggio solo quando nessuno dei due funziona.

## 🚧 La barra per un messaggio tmux (push)

Manda un messaggio **solo** se vale una di queste:

1. **Hand-off reale** — il collega deve *fare* qualcosa che non può scoprire dal suo loop `next-for-X`
   o dal DB. Esempi: Scrittore → Critico per avviare il loop di review del CV; Capitano → worker per
   spawn / throttle / kill; Analista → Scout `FEEDBACK` che deve cambiare la *prossima* query.
2. **Evento di sicurezza** — `LOCKED` / `403`, halt, kill, crash, uno sforamento di rate imminente che
   il polling del DB è troppo lento a cogliere. Sentinella → Capitano soltanto.
3. **Verso l'utente** — una richiesta dall'utente o una risposta all'utente (canale separato; vedi i
   manuali di ruolo).

### ✂️ Cosa viene TAGLIATO (non mandare)

- **ACK a vuoto** — "ricevuto, contesto aggiornato", "ok, resto in attesa". Se il messaggio non
  richiedeva nessuna azione e chi l'ha mandato non *ha bisogno* della conferma per procedere, **non dire
  niente**. (Vedi `ACK` sotto per il caso raro.)
- **Broadcast di stato** — "@all check 10:14, code vuote, tutti in standby". È tutto osservabile: le code
  stanno nel DB, l'attività nei pane. Non raccontarlo a tutti. (Per l'osservabilità leggibile dall'umano
  scrivi nell'event-log strutturato, non nei pane dei colleghi.)
- **"Sei vivo? / a che punto sei?"** — usa capture-pane (Tier 2). Mai bruciare il turno di un collega per
  chiedergli uno stato che dovrebbe fermarsi a scrivere.
- **Riconferme / ordini ripetuti** — se hai già mandato un ordine, non rimandarlo a ogni tick. Il bridge
  / la mailbox lo consegna una volta sola.

## 🔇 Produrre è silenzioso — lo stato se lo prende il Capitano

Un worker tocca il Capitano **zero volte** per raccontare l'avanzamento. Né per item, né sugli
estremi: i bookend `[START]` / `[DONE]` sono stati **rimossi il 2026-07-27**. Misurato su un team di
primo avvio, ~1,5h di cronologia: **37 messaggi sono arrivati al Capitano, 30 (81%) puro stato** — 12
`DONE`, 8 `START`, 8 `INFO`, 2 `ACK` — contro 3-6 che chiedevano davvero una decisione. Ognuno gli
costa un turno intero e, con lo split automatico dei modelli, lui gira su **Opus** mentre Scout /
Analista / Scorer girano su **Sonnet**: un "fatto" dello Scorer sveglia l'agente più costoso della
flotta per non fare niente.

Il lato pull esisteva già ed è nettamente migliore:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
```

Una chiamata restituisce i conteggi per agente più ogni transizione con timestamp, attore, posizione e
motivo — `#22 checked→scored`, `#27 new→excluded — [DEAD_LINK]`. **Un `DONE` porta meno informazione
della riga che lo ha prodotto.** (Lo stesso protocollo aveva già ucciso il flood per-item: un Analista
una notte ha svegliato il Capitano **25 volte**, un ping per posizione. Ora sono spariti anche i due
bookend "educati".)

### ⚠️ Cosa resta PUSH — l'asimmetria è il punto

`recent-activity` mostra **chi produce**, quindi un agente che si è fermato **sparisce dalla lista**
invece di risaltare: dal lato del Capitano il tuo silenzio e il tuo lavoro sono identici. Questi tre
vanno quindi ancora inviati **subito**, perché non lasciano **traccia nel DB**:

| Segnale | Quando |
|---|---|
| **BLOCKED** | hai smesso di produrre: tool rotto dopo la scala `resilience`, `403` / `LOCKED`, fonti davvero secche (`[SCOUT-ESAUSTO]`), un elemento in coda che non riesci né a lavorare né a saltare |
| **Conflitto** | due colleghi sullo stesso record / territorio e non riuscite a chiuderlo fra voi |
| **Richiesta di decisione** | un `REQ` a cui può rispondere solo il Capitano (arbitrato tassonomia, scaling, una scelta verso l'utente) |

Tutto il resto — inizio, avanzamento, fine — è pull. Restano permessi come prima, perché sono
*decisioni* e non narrazione: un `FEEDBACK` a uno Scout, un `URG` di sicurezza. **Se ti fermi e non lo
dici, non se ne accorge nessuno.**

## 🗄️ Tier 1 — coordinamento via DB (il default)

I passaggi di consegna nella pipeline avvengono attraverso il DB — **nessun tmux necessario**:

| Passaggio | Meccanismo |
|---|---|
| 🕵️ Scout → 👨‍🔬 Analista | L'Analista interroga `next-for-analista`; vede le righe fresche con `status = new` |
| 👨‍🔬 Analista → 👨‍💻 Scorer | Lo Scorer interroga `next-for-scorer`; prende le righe con `status = checked` |
| 👨‍💻 Scorer → 👨‍🏫 Scrittore | Lo Scrittore interroga `next-for-scrittore` (`score DESC`); prende le righe con `status = scored` ≥ 50 |
| 👨‍🏫 Scrittore → 👤 Utente | La posizione arriva a `status = ready` + `applications.critic_verdict = PASS`; compare sulla dashboard |

**Prendersi un record senza mandare messaggi** — i colleghi evitano la stessa riga grazie ai lock in
[`anti-collision.md`](anti-collision.md): dedup pre-INSERT + partizione circles/sources per lo Scout;
watermark `last_checked` per Analista/Scorer; flip a `status = writing` per lo Scrittore. **Vince la
prima scrittura.** Non annunci "prendo l'ID 42" — il claim *è* il lock; il collega lo legge dal DB.

## 👀 Tier 2 — capture-pane (osserva, non chiedere)

Per capire cosa sta facendo un collega **senza disturbarlo**:

```bash
tmux capture-pane -t <PEER_SESSION> -p -S -40
```

Cerca: lo spinner / `esc to interrupt` (vivo, a metà turno), un prompt di shell nudo (idle / forse
piantato), un fetch bloccato. Questo sostituisce del tutto i messaggi "sei vivo? / a che punto sei?".

⚠️ **È uno snapshot, non lo stato.** Puoi beccare un turno a metà rendering. Usalo per *liveness /
attività*, **mai** come fonte di verità sullo stato condiviso — quella è sempre il DB (Tier 1). Il
verdetto su un collega *forse morto* spetta al Dottore (`liveness-check`), non a una lettura riflessa.

## 📨 Tier 3 — busta del messaggio e tipi

Busta a riga singola con tag:

```
[@from -> @to] [TYPE] payload
```

Set di tipi ridotto (usa il più stretto che va bene):

| Tipo | Quando |
|---|---|
| `URG` | Sicurezza / agisci ora: Capitano → worker (throttle / freeze / kill); Sentinella → Capitano (sforamento, crash, LOCKED) |
| `FEEDBACK` | Analista → Scout, pattern di rifiuto (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`) che devono cambiare la prossima query |
| `REQ` / `RES` | Una vera richiesta sincrona che si aspetta una risposta (rara) — un hand-off reale, non una domanda di stato |
| `BLOCKED` | Worker → Capitano: hai **smesso di produrre** e la cosa non lascia traccia nel DB (tool rotto, `403`/`LOCKED`, fonti secche, un elemento che non riesci né a lavorare né a saltare). Dal 2026-07-27 è l'unico segnale che distingue uno stallo dal lavoro silenzioso — `recent-activity` non può mostrarlo, perché un agente fermo sparisce da quella lista |

`ACK` — **solo** quando chi manda ha davvero bisogno di sapere che l'azione ha avuto effetto per
procedere in sicurezza (es. il Capitano deve confermare che un `FREEZE` è stato applicato prima di
scalare). **Non** è una risposta di routine. Se un ordine non ha bisogno di conferma per essere sicuro,
chi lo riceve lo applica in silenzio. `INFO` / `REPORT` sono deprecati per il traffico fra colleghi:
manda la narrazione all'event-log, non nei pane.

## 🛠️ Invio: `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **Mai `tmux send-keys` grezzo per i messaggi inter-agente.** Le TUI di Codex/Kimi perdono il
carattere Enter quando arriva insieme al corpo, causando deadlock silenziosi. Il wrapper gestisce testo
+ Enter in modo atomico. È **busy-aware**: aspetta che il turno del collega finisca e poi consegna
(`exit 0`); `exit 4` = collega vivo ma ancora occupato oltre il budget → **riprova più tardi, non
spawnare / non rimetterti a ragionare**; `exit 3` = forse morto → verdetto del Dottore, non un riflesso.
Skill: `agents/_skills/tmux-send/jht-tmux-send`.

**Su un invio fallito / occupato:** mettilo in coda (la `bridge_mailbox` che il Capitano drena), **non**
aprire un turno di ragionamento nuovo per "riflettere" sul fallimento. Il retry è meccanico, non
cognitivo.

## ⏰ Segnali obbligatori per ruolo (tutto il resto è pull)

### 🕵️ Scout
- **Non annunciarti mai** al Capitano — niente `[START]`, niente `[DONE]`, niente per risultato. Gli
  INSERT sono il report; lui li legge da `recent-activity`. Push solo quando sei **BLOCKED e non
  produci più** (incluso `[SCOUT-ESAUSTO]`) o in conflitto con un altro Scout.
- Riceve `FEEDBACK` dagli Analisti → adatta la prossima query. **Nessun ACK** a meno che l'Analista non
  abbia fatto un `REQ`.

### 👨‍🔬 Analista
- **Non annunciarti mai** al Capitano — niente `[START]`, niente `[DONE]`, niente per posizione. Il flip
  a `checked` è il report. Push solo quando sei **BLOCKED e non produci più**, o per un `REQ` di
  arbitrato sulla tassonomia.
- Manda `FEEDBACK` a uno Scout solo su un pattern reale: 3 esclusioni consecutive con lo stesso tag da
  una stessa fonte, OPPURE > 60 % di tasso di esclusione in un batch di uno Scout. Altrimenti silenzio
  (il passaggio lo porta il DB).

### 👨‍💻 Scorer
- **Non annunciarti mai** al Capitano — niente `[START]`, niente `[DONE]`, niente per punteggio. Ogni
  punteggio è una riga nel DB che lui pesca da `recent-activity`. Push solo quando sei **BLOCKED e non
  produci più**. Il passaggio in pipeline è via DB; gli insight emergono su dashboard / event-log.

### 👨‍🏫 Scrittore
- **Non annunciarti mai** al Capitano — niente `[START]` quando prendi un lavoro CV, niente `[DONE]`
  quando arriva a `ready`: la transizione `writing → ready` è nel DB. Push solo quando sei **BLOCKED e
  non produci più** (loop del Critico piantato, dati di profilo mancanti).
- Su `URG FREEZE` dal Capitano: chiudi il round Critic corrente (mai abbandonare una review a metà), poi
  rallenta. Solo qui l'`ACK` ci va — è il caso raro della conferma-per-procedere.

### 💂 Sentinella
- Edge-triggered, **solo dentro l'orario di lavoro**. Parla **solo** su un cambio di stato reale (picco,
  sforamento, crash, `LOCKED`). Un messaggio per edge — mai riemetterlo. Non fa mai broadcast ai worker
  (il Capitano è il gateway). Stato stazionario → silenzio.

### 👨‍✈️ Capitano
- `URG` ai worker (throttle / freeze / kill / spawn) su segnale della Sentinella o su un bisogno
  osservato della pipeline.
- Legge lo stato della pipeline dal **DB**, l'attività degli agenti da **capture-pane** — non racconta
  mai lo stato ai colleghi, non rimanda mai ordini già dati.

## 📥 Leggere i messaggi dai peer

Non scansioni tmux prima di ogni azione — la maggior parte del coordinamento sta nel DB.
- **Tra unità di lavoro** (dopo una posizione, prima di prendere la prossima): un rapido
  `tmux capture-pane -p -S -20` sulla **tua** sessione per notare un `URG` / `FEEDBACK` in arrivo.
- Dai priorità a `URG` / `FEEDBACK`; agisci prima di prendere nuovo lavoro.
- Un messaggio che arriva a metà task è già nel tuo contesto (il wrapper l'ha scritto nel tuo pane) —
  basta notarlo prima dell'iterazione successiva.

## ⏸️ Throttle: pause tracciate

Per rallentare il tuo loop (cooldown, post-`URG`, attesa dell'upstream), usa la skill `throttle`, **mai
un semplice `sleep`**:

```bash
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

Ogni chiamata logga su `$JHT_HOME/logs/throttle-events.jsonl`, così il Capitano e la dashboard vedono
chi è in pausa e per quanto. Il semplice `sleep` solo per attese di retry ≤ 5 s. Capitano: nomina la
skill esplicitamente nell'ordine (`[URG] jht-throttle 180 --agent scout-1 --reason "rate budget"`), mai
"sleep 3 minuti".

Vedi: [`../_skills/throttle/SKILL.md`](../_skills/throttle/SKILL.md).

## 🔗 Correlati

- 🛡️ [`anti-collision.md`](anti-collision.md) — lock claim-before-work (come coordinarsi via DB)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — panoramica della pipeline (chi alimenta chi)
