# 📡 Lean-comms redesign — pull-default, push solo per l'importante

**Data:** 2026-06-15 · **Owner spec:** dev1 · **Implementazione:** dev1 + dev2 + dev3 (insieme,
validato dall'utente) · **Origine:** finding `2026-06-15-coordinator-burn-consumo-finding.md`.

> **CONTRATTO CONDIVISO.** Questo doc è la spec contro cui i tre lavorano. Per evitare collisioni su
> file condivisi, **ogni file ha UN solo owner** (vedi §6 Split). Niente edit fuori dalla propria
> colonna senza accordo in chat.

## 0. 🎯 Il principio guida

Il coordinator-burn, i loop di ACK e i broadcast di status sono lo stesso problema: un protocollo
**push-heavy**. Si ribalta:

> **Pull di default. Push (messaggio tmux) SOLO quando serve un'azione altrui che l'altro non può
> scoprire da sé. Gerarchia di coordinamento: DB → capture-pane → messaggio.**

Tre conseguenze, tre workstream (WS1/WS2/WS3) — ma un solo deploy.

---

## 1. 🛰️ WS1 — Cadenza Sentinella + gate orario (bridge + sentinella.md)

**Stato attuale:** `sentinel-bridge.py` ticka ogni `DEFAULT_TICK_MIN=3.0` con fasi adattive
(FAST 2 / STABLE 5 / CALM 10); `SENTINELLA_COOLDOWN_MIN=15` esiste già ma è cooldown morbido. La
Sentinella produce un turno LLM verboso AD OGNI sveglia, anche quando la conclusione è "silenzio".

**Target:**
1. **Tick bridge = 5 min fisso, ancorato all'orologio** (x:00/05/10/…). Puro monitoraggio
   deterministico in Python (campiona usage/pace/stato). **Zero LLM.** Rimuove le fasi adattive
   FAST/CALM (la prevedibilità + l'edge-wake valgono più del tick variabile).
2. **Gate orario assoluto:** fuori dalla finestra lavorativa **nessuna LLM viene svegliata** — né
   Sentinella né Capitano. Il bridge continua a tracciare lo stato (Python), ma non notifica nessuno.
   Es. orari 8-20, sono le 21 → silenzio totale.
3. **Sentinella svegliata solo:** (a) dentro l'orario, (b) ai quarti (x:00/15/30/45), (c) **e solo
   su edge azionabile** (soglia attraversata). A stato stabile dentro l'orario → **non si sveglia
   affatto**. Niente heartbeat LLM "a vuoto".
4. **Gate "silenzio" deterministico:** la decisione "nulla da fare" la prende il BRIDGE in codice
   PRIMA di invocare l'LLM. Oggi paghiamo un ragionamento completo per riconfermare "nessun
   cambiamento" — si elimina.
5. **Self-check liveness deterministico** (non LLM): garantisce che il bridge sia vivo senza svegliare
   la Sentinella.
6. **Failed-send → mailbox, non ri-ragionamento.** Quando un send al Capitano fallisce (busy/offline),
   la Sentinella NON apre un turno per "pensarci": il messaggio va in `bridge_mailbox` (che il
   Capitano drena). `jht-tmux-send` è già busy-aware (exit 4 = vivo-occupato → ritenta dopo).

**Edge azionabili (svegliano fuori cadenza):** transizione a `status=LOCKED`/403, weekly che entra
in lockout anticipato, BURN-MODE, crash worker. (Lista esatta da definire nel bridge.)

---

## 2. 👨‍✈️ WS2 — Capitano: agente in loop → Dottore-first → kill (capitano.md + skill)

**Gap reale:** il Capitano oggi ha segnali per *agente morto/silenzioso* (C-08 → Dottore) e per
*agente che brucia con cadenza 0.00/min* (C-12 → kill), ma **NON** per *agente vivo, attivo, che
ripete lo stesso ciclo senza produrre*. Cade nella crepa → non interviene. (NB: il "ping-loop"
Capitano↔SCORER-1 osservato è invece overhead di protocollo, si risolve in WS3, NON si killa.)

**Target — scala graduata:**
1. **Rilevamento deterministico** (in codice, non a occhio sulle pane): segnale "agente in loop" =
   stessa azione/output ripetuti N volte, oppure N tick "attivo" senza scrittura DB / senza
   avanzamento coda. Da esporre come signal (bridge o skill), non lasciato all'LLM.
2. **Dottore straordinario** (on-demand, `spawn-doctor` esteso al caso loop): diagnosi +
   riparazione/refresh della sessione.
3. **Kill della sessione** — ultima istanza (loop persiste o budget a rischio immediato) **+
   safeguard anti-respawn**: il watchdog non deve far ripartire l'agente nello stesso loop (respawn a
   stato pulito / backoff).
4. **Documentato in `capitano.md`** (ramo "agente in loop" accanto a C-08/C-12) **+ skill dedicata**
   (`agent-emergency` o estensione `pipeline-triage`): incapsula rileva→diagnostica→Dottore→kill.
   Deterministica dove possibile (rilevamento + kill); l'LLM del Capitano decide solo l'escalation.

---

## 3. 🤝 WS3 — Protocollo lean (il cuore: tutti i prompt + manual + skill)

**Canonico in UN posto:** la spec del protocollo vive in `agents/_manual/communication-rules.md`
(che i prompt già referenziano). Ogni prompt agente riceve un **pointer breve** + la rimozione di
istruzioni chiacchierone (no "broadcast il tuo status", no "manda ACK"). Niente duplicazione della
filosofia in 10 prompt.

**La barra per un messaggio tmux (push) — SOLO se:**
- (a) **hand-off reale**: l'altro deve fare qualcosa che non può scoprire da sé (es. Scrittore→Critico
  per il loop CV; Capitano→worker spawn/kill);
- (b) **evento safety**: lockout, halt, kill, richiesta utente.

**Si TAGLIANO:** ACK no-op ("ricevuto, contesto aggiornato"), broadcast di status periodici,
ri-conferme, "sei vivo?/a che punto sei?".

**Coordinamento pull (gerarchia):**
1. **DB = substrato primario.** Stato condiviso → DB (deterministico, interrogabile, non racy). Le
   code `next-for-*`, `last_open_check`, i flag on-demand già coordinano senza messaggi. Si estende.
2. **capture-pane = "cosa fa il collega" senza disturbarlo.** Niente messaggio per chiedere stato →
   si guarda la pane. (Snapshot racy + non gratis → SOLO per "cosa fa ora?", non per lo *stato*.)
3. **Messaggio = eccezione** (la barra sopra).

**DB claim/lease (rischio collisione) — DIFFERITO (YAGNI, deciso 2026-06-15).** I claim già
esistono per-record (`anti-collision.md`: Scout pre-INSERT dedup, Analista/Scorer watermark
`last_checked`, Writer flip `status=writing`). Verificato (dse3, barto): 3 worker 1/ruolo → nessuna
coda condivisa, nessun race; `next-for-*` fa solo SELECT e con 1/ruolo basta. Il race è **latente**
solo col futuro multi-worker sullo **stesso** task-type (RULE-14). → **NON si costruisce ora**; TODO,
owner **dse3** (è nelle sue `next-for-*`), si attiva quando il multi-per-tipo è davvero deployato.

**Osservabilità — RIUSO `position_state_transitions` (deciso 2026-06-15, ZERO tabella nuova).** Esiste
già una tabella strutturata e interrogabile degli eventi-pipeline (`id, position_id, from_state→to_state,
ts, by_agent, notes`, indici su ts/to_state). Sostituisce i broadcast "ho scorato #X" → si **QUERYa**
la tabella. Eventi NON-pipeline (lifecycle/errori) → capture-pane (pull). Lane dse3: helper `db_query
recent-activity` + skill `observe-via-capture-pane` + wiring di questa tabella come substrato. **Lane = dse3.**

**WS1 ↔ A2 (nota):** il bridge (WS1, mia lane) deve includere la transizione `status=LOCKED` fra gli
edge azionabili — è il segnale A2 già in `sentinel-bridge.py` (fb8be23ee). La logica A2 LOCKED resta;
l'edge-wake ci si costruisce sopra. dse3 NON tocca `sentinel-bridge.py` (rispetto split).

---

## 4. ⚠️ Rischi & mitigazioni

| Rischio | Mitigazione |
|---|---|
| capture-pane racy/non gratis | gerarchia DB > pane > messaggio; pane solo per "cosa fa ora", DB per lo stato |
| pull → 2 agenti stessa riga | claim/lease nel DB (WS3, dev2) |
| si perdono hand-off veri | si taglia la chiacchiera, NON il passaggio di lavoro (barra esplicita) |
| si perde la narrazione team | event-log strutturato (WS3, dev3) |
| edge perso fuori cadenza | edge-wake fuori dai quarti dentro l'orario; fuori orario gestito deterministicamente |
| kill prematuro | Dottore-first; kill solo su loop confermato N cicli o budget a rischio |
| collisioni fra dev1/2/3 sui file | §6 split: un owner per file, niente edit cross senza accordo |

---

## 5. 🔢 Sequenza

1. (questo doc) spec condivisa + split concordato in chat.
2. Implementazione parallela per lane (§6).
3. Cross-merge fra dev-branch + cross-review.
4. **Utente** merge in master.
5. Deploy nuova immagine `:latest` su entrambe le VPS (richiede rebuild — sono cambi prompt + bridge
   + skill, tutti baked nell'immagine).

---

## 6. 🧩 Split per-file (un owner ciascuno — anti-collisione)

**dev1 — coordinatori + protocollo (spina dorsale):**
- `agents/_manual/communication-rules.md` (riscrittura protocollo: barra, gerarchia, tagli)
- `.launcher/sentinel-bridge.py` (tick 5min ancorato, gate orario, edge-gate, self-check, failed-send→mailbox)
- `agents/sentinella/sentinella.md` (wake edge-only, no ragionamento per-tick)
- `agents/capitano/capitano.md` (ramo agente-in-loop, comms lean)
- skill emergenza Capitano (`agent-emergency` o estensione `pipeline-triage`)

**dev2 — worker-side metà A + tmux-send:**
- pointer comms-lean in: `agents/analista/analista.md`, `agents/scout/scout.md`
- skill `tmux-send` (la barra "quando inviare")
- (claim/lease DIFFERITO — non in questo giro; se servirà è lane dse3)

**dev3 — worker-side metà B + osservabilità + pattern pull:**
- pointer comms-lean in: `agents/scorer/scorer.md`, `agents/scrittore/scrittore.md`,
  `agents/critico/critico.md`, `agents/assistente/assistente.md`, `agents/mentor/mentor.md`
- skill `coordinate-via-db` + `observe-via-capture-pane`
- osservabilità: RIUSO `position_state_transitions` + helper `db_query recent-activity` (zero tabella nuova)

> I pointer per-prompt sono **brevi** (rimando a `communication-rules.md` + taglio istruzioni
> chiacchierone) → edit leggeri, collisione minima. Il grosso è centralizzato in dev1.
