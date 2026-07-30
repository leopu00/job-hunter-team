<!-- @translation: it, ai-translated 2026-06-06 -->
# 💬 Regole di comunicazione inter-agente

Gli agenti JHT si coordinano principalmente attraverso il **database**, non tramite tmux. Il DB trasporta lo stato stazionario della pipeline; tmux è riservato ai **segnali in tempo reale** che non possono attendere il prossimo ciclo di polling.

## 🗄️ Coordinamento via DB (il default)

I passaggi di consegna nella pipeline avvengono naturalmente attraverso il DB — nessuna notifica tmux necessaria:

| Passaggio | Meccanismo |
|---|---|
| 🕵️ Scout → 👨‍🔬 Analista | L'Analista interroga `next-for-analista` continuamente; vede subito le nuove righe con `status = new` |
| 👨‍🔬 Analista → 👨‍💻 Scorer | Lo Scorer interroga `next-for-scorer`; prende le righe con `status = checked` |
| 👨‍💻 Scorer → 👨‍🏫 Scrittore | Lo Scrittore interroga `next-for-scrittore` ordinato per `score DESC`; prende le righe con `status = scored` ≥ 50 |
| 👨‍🏫 Scrittore → 👤 Utente | La posizione arriva a `status = ready` + `applications.critic_verdict = PASS`; la dashboard del Capitano la mostra |

**Regola generale**: se il prossimo agente nella pipeline può vedere il nuovo stato eseguendo la sua query standard `next-for-X`, **non inviare un messaggio tmux**. Inviare tmux ad ogni batch crea rumore e rischia messaggi persi su pane occupati.

## 📡 tmux è solo per segnali in tempo reale

Invia un messaggio tmux solo quando il destinatario deve agire *ora* e non può attendere il prossimo poll del DB:

| Tipo | Quando usarlo | Tempo reale necessario perché… |
|---|---|---|
| `URG` | Capitano → worker (FREEZE / throttle / kill) su segnale del Sentinel | Il superamento del rate-limit è imminente — il polling del DB è troppo lento |
| `URG` | Sentinel → Capitano su cambio di stato reale (picco, violazione, crash) | Idem |
| `FEEDBACK` | Analista → Scout su pattern di rifiuto (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`) | Lo Scout deve adattare la **prossima** query, non dopo un ciclo di polling |
| `REQ` / `RES` | Richiesta interattiva tra agenti (rara) | Risposta sincrona attesa |
| `ACK` | Risposta che conferma la ricezione e applicazione di un `URG` | Il Capitano deve sapere che il throttle/freeze è stato applicato |

## 📨 Busta del messaggio

Ogni messaggio inter-agente usa una busta a riga singola con tag:

```
[@from -> @to] [TYPE] payload
```

`TYPE` è uno tra `URG · FEEDBACK · REQ · RES · ACK · INFO · REPORT` — ma in V5 solo i primi 5 sono usati di routine (vedi tabella sopra).

## 🛠️ Invio: `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **Non usare mai `tmux send-keys` grezzo per i messaggi inter-agente.** Le TUI di Codex e Kimi perdono il carattere Enter se arriva nella stessa chiamata `send-keys` del corpo del testo, causando deadlock silenziosi. Il wrapper gestisce testo + Enter in modo atomico con una pausa di rendering. Skill in `agents/_tools/jht-tmux-send`.

## 🔇 Produrre è silenzioso — lo stato se lo prende il Capitano

Un worker tocca il Capitano **zero volte** per raccontare l'avanzamento. Né per item, né sugli
estremi: i bookend `[START]` / `[DONE]` sono stati **rimossi il 2026-07-27**. Misurato su un team di
primo avvio, ~1,5h di cronologia: **37 messaggi sono arrivati al Capitano, 30 (81%) puro stato** — 12
`DONE`, 8 `START`, 8 `INFO`, 2 `ACK` — contro 3-6 che chiedevano davvero una decisione. Ognuno gli
costa un turno intero e, con lo split automatico dei modelli, lui gira su **Opus** mentre Scout /
Analista / Scorer girano su **Sonnet**: un "fatto" dello Scorer sveglia l'agente più costoso della
flotta per non fare niente.

Il lato pull esisteva già ed è migliore:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
```

Una chiamata restituisce i conteggi per agente più ogni transizione con timestamp, attore, posizione e
motivo — `#22 checked→scored`, `#27 new→excluded — [DEAD_LINK]`. **Un `DONE` porta meno informazione
della riga che lo ha prodotto.**

### ⚠️ Cosa resta PUSH — l'asimmetria è il punto

`recent-activity` mostra **chi produce**, quindi un agente che si è fermato **sparisce dalla lista**
invece di risaltare: dal lato del Capitano il tuo silenzio e il tuo lavoro sono identici. Questi tre
vanno quindi ancora inviati **subito**, perché non lasciano **traccia nel DB**:

| Segnale | Quando |
|---|---|
| **BLOCCATO** | hai smesso di produrre: tool rotto dopo la scala `resilience`, `403` / `LOCKED`, fonti davvero secche (`[SCOUT-ESAUSTO]`), un elemento in coda che non riesci né a lavorare né a saltare |
| **Conflitto** | due colleghi sullo stesso record / territorio e non riuscite a chiuderlo fra voi |
| **Richiesta di decisione** | un `REQ` a cui può rispondere solo il Capitano (arbitrato tassonomia, scaling, una scelta verso l'utente) |

Tutto il resto — inizio, avanzamento, fine — è pull. **Se ti fermi e non lo dici, non se ne accorge
nessuno.**

## ⏰ Segnali obbligatori per ruolo

Cosa ogni ruolo DEVE inviare via tmux (tutto il resto è gestito via DB):

### 🕵️ Scout
- Riceve `FEEDBACK` dagli Analisti → adatta le query; risponde `ACK`

### 👨‍🔬 Analista
- Invia `FEEDBACK` a uno Scout quando:
  - 3 esclusioni consecutive dalla stessa fonte con lo stesso tag, OPPURE
  - Tasso di esclusione >60% in un singolo batch di uno Scout

### 👨‍💻 Scorer
- *(nessun tmux — i passaggi nella pipeline sono gestiti via DB; le statistiche sulla distribuzione dei punteggi emergono nella dashboard del Capitano)*

### 👨‍🏫 Scrittore
- Riceve `URG FREEZE` dal Capitano → termina il round Critic corrente (non abbandonare mai una review a metà), poi `ACK` e sospendi fino a quando il throttle torna a T0/T1

### 💂 Sentinel
- Edge-triggered: parla solo quando lo stato cambia effettivamente (picco di utilizzo, violazione della proiezione, crash di un agente). Invia `URG` al Capitano con l'azione proposta (throttle / freeze / kill). Non invia mai direttamente ai worker — il Capitano è il gateway.

### 👨‍✈️ Capitano
- Invia ordini `URG` ai worker (FREEZE, livello throttle, kill) su segnale del Sentinel
- Invia `REQ` per coordinamento interattivo (raro)
- Inoltra il feedback dell'utente dalla Fase 5 al ruolo pertinente
- Legge lo stato della pipeline dal DB, non dai pane dei worker — non mette mai in dubbio un agente collegandosi al suo tmux

## 📥 Leggere i messaggi dai peer

Non serve controllare tmux prima di *ogni* azione — la maggior parte del coordinamento passa dal DB. Invece:

- **Tra unità di lavoro** (dopo aver completato una posizione, prima di prenderne una nuova), fai un rapido `tmux capture-pane -p -S -20` sulla tua sessione.
- **Dai priorità a `URG` e `FEEDBACK`**: agisci su di essi prima di prendere nuovo lavoro.
- Un messaggio in arrivo mentre sei nel mezzo di un task sarà già nel tuo contesto (il wrapper lo scrive nel tuo pane); non devi fare polling, basta notarlo prima di iniziare la prossima iterazione.

## ⏸️ Throttle: pause tracciate

Ogni volta che vuoi rallentare il tuo loop per rispettare il budget di rate
(cooldown dopo un batch, freeze post-`URG`, "attendi l'upstream", …),
**usa la skill `throttle`, mai un semplice `sleep`**:

```bash
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

Ogni chiamata aggiunge un evento a `$JHT_HOME/logs/throttle-events.jsonl`,
così il Capitano e la dashboard possono vedere chi è in pausa e per quanto
tempo. Il semplice `sleep` è consentito solo per attese molto brevi (≤ 5 s)
tra i retry, dove il logging sarebbe rumore.

Capitano: quando ordini a un worker di rallentare, nomina la skill esplicitamente,
es. `[URG] Throttle: jht-throttle 180 --agent scout-1 --reason "rate budget"`.
Non dire "sleep 3 minutes" — questo bypassa il logging.

Vedi: [`../_skills/throttle/SKILL.md`](../_skills/throttle/SKILL.md).

## 🔗 Correlati

- 🛡️ [`anti-collision.md`](anti-collision.md) — meccanismi di lock (claim prima di lavorare)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — panoramica della pipeline (chi alimenta chi)
