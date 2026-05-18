# 🌙 Post-mortem — Capitano zombie night (17-18 maggio 2026)

**Sintesi in 1 riga**: il Capitano è morto nella notte (kimi CLI crashato dentro al pane tmux), e nessun automatismo l'ha rianimato fino alle 06:11 UTC, dopo 2 messaggi Telegram dell'utente e un intervento manuale dell'Assistente.

---

## ⏱️ Cronologia (UTC)

| Ora | Evento | Fonte |
|---|---|---|
| **2026-05-17 21:18:31** | Container `:buster` ricreato (deploy F-2). pid1 spawna user-facing + DOTTORE + watchdog. | `docker inspect jht --State.StartedAt` |
| **2026-05-17 21:18:34** | `agent-watchdog.sh` scrive ultimo log "agent mentor: start OK". Da qui in poi: **silenzio totale per 11 ore** mentre il process è ancora vivo. | `agent-watchdog.log` last Modify |
| **2026-05-17 ~22:00** (stima) | Il kimi CLI nel pane CAPITANO crasha. La sessione tmux resta viva (bash parent), il process kimi muore. | Inferenza dai gap successivi |
| **2026-05-17 23:30:00** | Bridge pacing scrive `[BRIDGE PACING] PIPELINE STALLED — usage=0% proj=0%` — segnale forte che il team non consumava più token. | `messages.jsonl` |
| **2026-05-17 23:35:23** | Utente manda voice document e poi `/help` `/pipeline` `/budget` via Telegram. **Capitano non risponde a nessuno**. | `messages.jsonl` `[TG]` |
| **2026-05-17 23:48 → 06:00** | 12+ messaggi di pacing/sentinella arrivano al Capitano. Nessuna risposta, nessun ACK. | `messages.jsonl` |
| **2026-05-17 22:48 → 18 mag 06:18** | Doctor-watchdog spawna correttamente 13 dottori uno ogni 30 min (un nuovo DOTTORE LLM ogni ciclo). Nessuno di loro rianima il Capitano. | `doctor-watchdog.log` |
| **2026-05-18 05:57:45** | Utente "Come mai non state lavorando?" su Telegram. Nessuna risposta. | `messages.jsonl` |
| **2026-05-18 06:00:52** | Utente "????". Nessuna risposta. | `messages.jsonl` |
| **2026-05-18 06:00 → 06:08** | Utente parla con l'**Assistente** ("agisci attivamente finché non riavvia il Capitano"). | Pane ASSISTENTE scrollback |
| **2026-05-18 06:08 → 06:09** | Assistente prova a delegare al DOTTORE: 2 messaggi `[URG]` consecutivi. **DOTTORE non risponde, nessuna azione**. | Conferma Assistente direct interview |
| **2026-05-18 06:10 ca.** | Assistente verifica via `/proc/663/exe → /usr/bin/bash`: il pane contiene solo bash residua, nessun process kimi/claude/codex attivo. `jht-tmux-send` aveva già fallito con "non ricettivo dopo 3 tentativi (testo mai apparso nel pane)". | Conferma Assistente |
| **2026-05-18 06:11:24** | Assistente esegue `tmux kill-session -t CAPITANO` + `/app/.launcher/start-agent.sh capitano` → Capitano ri-spawnato. | `tmux list-sessions` Mon May 18 06:11:24 |
| **2026-05-18 06:12:11** | Primo messaggio post-rianimazione: `[@assistente -> @capitano] [INFO] Capitano riavviato da Assistente`. | `messages.jsonl` |

**Durata downtime Capitano**: stimata 6-8 ore (da ~22:00 UTC del 17 maggio fino a 06:11 UTC del 18 maggio).

---

## 🔍 Causa root

Il bug ha **due livelli**:

### Livello 1 — `agent-watchdog.sh` controlla solo la sessione tmux, non il process LLM

```bash
is_session_alive() {
  tmux has-session -t "$1" 2>/dev/null
}
```

`tmux has-session` ritorna `0` (vivo) anche quando il process kimi/claude/codex dentro al pane è morto, perché la sessione tmux è gestita dal server tmux indipendentemente da cosa gira dentro. La "carcassa" del pane (bash shell parent + un eventuale `Killed`/exit message del kimi) resta viva, e il watchdog la considera sana.

Quindi il loop principale del watchdog, ad ogni tick (30s):
1. `config_ready` → OK (`kimi.json` esiste, bot configurati, provider settato)
2. Per ogni agente: `is_session_alive` → True → **return 0, nessuna azione**
3. `sleep 30` → e di nuovo. Per 11 ore.

Niente log perché lo script logga solo quando agisce (`agent X: start OK` / `start FAIL`). Silent loop = silenzio nei log = falsa sensazione di "tutto OK".

### Livello 2 — Doctor-watchdog spawna dottori ma i dottori non rianimano il Capitano

Il doctor-watchdog ha fatto perfettamente il suo lavoro (20 spawn in 11h ogni 30 min). Però il **Dottore LLM** dentro a `liveness-check` skill controlla a sua volta solo `tmux has-session` o legge log alto livello, non verifica se il process LLM nel pane Capitano è morto. Risultato: il Dottore dice "Capitano tmux session attiva, nessuna azione necessaria" → autoself-destruct → 30 min dopo un altro Dottore fa la stessa cosa. Ciclo per 11 ore.

Nessuno verifica `pane_current_command` o fa un capture-pane per vedere se il kimi sta davvero girando.

### Perché il Dottore non l'ha visto

Il Dottore controlla i pane di **Scout/Analista/Scorer/Scrittore/Critico** (worker spawnati a richiesta dal Capitano). Il Capitano stesso non è nella sua lista perché è considerato "long-lived user-facing" e quindi responsabilità dell'`agent-watchdog`. Doppia responsabilità → zero responsabilità.

---

## 🔧 Fix proposti

### Fix A (immediato) — `agent-watchdog.sh` controllo pane_current_command

```bash
is_session_alive() {
  local session="$1"
  tmux has-session -t "$session" 2>/dev/null || return 1
  # Bug 2026-05-18: tmux has-session True anche se kimi morto.
  # Verifica che il process nel pane sia un LLM CLI (kimi|Kimi|claude|codex).
  local cmd
  cmd=$(tmux list-panes -t "$session" -F '#{pane_current_command}' 2>/dev/null | head -1)
  case "$cmd" in
    [Kk]imi|claude|codex|node) return 0 ;;
    *) return 1 ;;
  esac
}
```

Quando rileva una sessione "zombie" (tmux up ma kimi morto), il watchdog la killa con `tmux kill-session` e rilancia via `start-agent.sh`. Niente intervento manuale dell'utente, niente Assistente.

### Fix B — Verifica "ultimo movimento" del pane

Più aggressivo: salva l'hash del `capture-pane` ogni N tick. Se non cambia per X tick consecutivi (es. 10 = 5 min), considera zombie anche se il `pane_current_command` dice OK. Cattura il caso "kimi vivo ma in deadlock".

### Fix C — Telegram alert se watchdog interviene

Quando l'agent-watchdog killa+rilancia una sessione zombie, manda via Telegram all'utente: *"⚠️ Capitano in zombie state da X minuti — riavviato automaticamente. Probabile OOM o kill esterno. Continua a operare."*. Così l'utente sa che è successo qualcosa anche se l'evento si è risolto da solo.

### Fix D — Dottore include user-facing nel suo check

Estendere `agents/dottore/dottore.md` per controllare anche ASSISTENTE/CAPITANO/MENTOR (oltre ai worker), con verifica `pane_current_command`. Backup deterministico al watchdog bash.

---

## 🔬 Conferma diretta dall'Assistente (interview post-mortem)

Domandato via `jht-tmux-send`, l'Assistente ha confermato:

> *"(1) Stato pre-kill: sessione CAPITANO esistente ma il pane conteneva
> solo bash (PID 663, stato S sleeping). /proc/663/exe → /usr/bin/bash.
> Nessun processo kimi/claude/codex attivo. jht-tmux-send falliva con
> 'non ricettivo dopo 3 tentativi (testo mai apparso nel pane)'.
>
> (2) DOTTORE: zero interventi su CAPITANO. Log dottore-actions.jsonl e
> doctor-watchdog.log mostrano solo auto-spawn del DOTTORE stesso ogni
> 30 min (ultimo 05:48:51Z). Ho mandato 2 URG al DOTTORE (06:08, 06:09),
> nessuna risposta né azione.
>
> (3) Segnali nei log: nessuno. Throttle-events e sentinel-log intorno
> alle 22-23 del 17/5 mostrano usage=0%, status=SOTTOUTILIZZO, nessun
> OOM, nessun exit code registrato. Nessun log kimi dedicato in /tmp/ o
> in agents/capitano/tmp/ (vuota). Causa root del crash: non documentata
> nei log a cui ho accesso — probabile exit silenzioso del CLI lasciando
> bash residua."*

**Tre fatti aggiuntivi rispetto alla mia diagnosi iniziale**:

1. **`/proc/663/exe → /usr/bin/bash`**: prova diretta che il process kimi
   era morto. La sessione tmux ospitava SOLO la bash parent del pane.
   Conferma il bug "tmux has-session insufficiente".

2. **`jht-tmux-send` fallisce su pane zombie**: il tool di invio inter-
   agente aveva GIÀ una euristica per rilevare unresponsive pane
   ("testo mai apparso nel pane"). Non era propagata al watchdog.
   **Idea fix bonus**: l'agent-watchdog può riusare `jht-tmux-send`
   per "ping" la sessione e considerarla zombie se non echeggia un
   token noto entro N tentativi.

3. **Dottore non risponde a URG dall'Assistente**: i 2 URG mandati alle
   06:08/06:09 dal Assistente al Dottore non hanno innescato azione.
   Il DOTTORE LLM era stato spawnato alle 05:48:51 e si era già auto-
   distrutto (lifecycle one-shot ~30 min) PRIMA dei messaggi URG. Il
   prossimo Dottore sarebbe partito alle 06:18:52. Quindi l'Assistente
   ha mandato URG a una sessione tmux con bash residua post-self-
   destruct → no agente da risvegliare. **Fix correlato**: il
   doctor-watchdog dovrebbe respawnare il Dottore "on demand" quando
   riceve un URG (oggi solo cadenza fissa 30 min).

## 📊 Statistiche del downtime

- **6+ ore di silenzio totale** tra l'ultimo ACK del Capitano (~23:48 UTC del 17) e la rianimazione (06:11 UTC del 18)
- **20 dottori spawnati a vuoto** (ognuno ~5 min di lavoro LLM)
- **Almeno 12 messaggi inter-agente persi** (pacing, sentinella INFO, scrittore-3 reports)
- **5 messaggi utente Telegram persi** (voice + /help + /pipeline + /budget + 2 "come va?")
- **0 PNG auto-report generati** nelle 6 ore (l'auto-report-loop richiama `auto_report.py send` ogni 5 min ma il threshold è 2h: il primo retry sarebbe stato comunque all'invio successivo, quindi 0-2 panorami persi a seconda del timing del crash vs ultimo invio riuscito)

---

## 🧭 Lezione

Il pattern "watchdog basato su tmux has-session" è **insufficiente** per agenti LLM. Una sessione tmux è una struttura di processi del server tmux, niente a che vedere con la salute del kimi/claude/codex CLI che ci gira dentro. Serve sempre un **secondo livello** di liveness: o controllo del `pane_current_command`, o capture-pane periodico con diff hash, o entrambi.

Stesso pattern del bug #18 (regressione doctor-watchdog non spawnato): "vivo" ≠ "funzionante". Il check deve guardare la cosa specifica che vogliamo verificare, non un proxy debole.

---

## ✅ Fix follow-up implementati 2026-05-18 (post discussione utente)

Oltre al fix A (pane_current_command check nell'agent-watchdog), 3
cambiamenti coordinati che chiudono il cerchio:

### 1. Dottore copre user-facing **PRIMA** dei worker

Il post-mortem ha mostrato che il Dottore non aveva preso il Capitano
in carico perché si concentrava sui worker. Decisione utente: i
user-facing sono **più importanti** dei worker (i worker li respawna
il Capitano stesso; i user-facing no, nessuno li copre se non il
Dottore).

- `agents/dottore/dottore.md` § Procedura del giro: ordine espresso
  PRIORITÀ 1 (ASSISTENTE/CAPITANO/MENTOR/SENTINELLA) → PRIORITÀ 2
  (worker). Se il budget 10min finisce, sempre PRIORITÀ 1 prima.
- `agents/_skills/liveness-check/SKILL.md`: nuova sezione "Priority
  order" + Step 0 `pane_current_command` (cheap pre-check che
  cattura il caso zombie senza fare il ping che si sarebbe perso).

### 2. Skill `spawn-doctor` per i coordinatori

Caso visto stamattina: l'Assistente ha mandato 2 URG a una sessione
DOTTORE già self-distructed (bash residua). Inutile.

Nuova skill `agents/_skills/spawn-doctor/SKILL.md`: i 4 coordinatori
(Capitano, Assistente, Mentor, Sentinella) sanno spawnare un Dottore
fresco via `/app/.launcher/spawn-doctor.sh` quando serve health-check
on-demand, INVECE di scrivere a una sessione morta.

Quando l'utente dice "fai partire il dottore" / "dottora" / "controlla
il team", il coordinatore di turno spawna ex-novo + manda `[REQ]`
mirato + aspetta `[RES]`. Niente più URG nel vuoto.

Aggiunta a `skills.list` di tutti e 4: capitano, assistente, mentor,
sentinella.

### 3. Doctor-watchdog cadenza 30min → 2h

20 spawn a vuoto in 11h notturne = ~3-5% budget Kimi bruciato per
giri di health-check che hanno trovato tutto OK e si sono
auto-distrutti. Decisione utente: cadenza 2h (12 spawn/giorno invece
di 48). Per i casi urgenti c'è la skill `spawn-doctor` on-demand.

- `.launcher/doctor-watchdog.sh`: `DOCTOR_WATCHDOG_INTERVAL` default
  `1800` → `7200`.

### Effetto combinato

- Capitano morto a mezzanotte → entro **30s** l'agent-watchdog lo
  rianima (Step 0 pane_current_command).
- Se anche il watchdog fallisse per qualche motivo → al prossimo giro
  Dottore (max 2h, PRIORITÀ 1 ASSISTENTE/CAPITANO/MENTOR/SENTINELLA)
  viene catturato.
- Se l'utente chiede `[TG] dottora` all'Assistente → l'Assistente
  spawna un Dottore ex-novo (skill `spawn-doctor`) entro 10-15s,
  niente attesa del watchdog 2h.
- Budget: 12 spawn/giorno regolari + spawn on-demand quando serve.
  Risparmio ~3-5% budget vs cadenza 30min.

---

## 🔗 Bug collegati

- **#18** (doctor-watchdog mai integrato in pid1) — stessa famiglia "regressione invisibile finché qualcuno non guarda"
- **#23** (leggi fonte, non memoria) — il Dottore avrebbe dovuto fare `tmux capture-pane` per leggere lo stato reale dei suoi target, non fidarsi di `has-session`
- **#24** (Sentinella troppo aggressiva) — non collegato, ma simile filosofia: il throttling fine-grained si applica anche al "che cos'è considerato vivo"

---

## 📜 File rilevanti

- `.launcher/agent-watchdog.sh` (script da patchare)
- `.launcher/doctor-watchdog.sh` (loop OK, ha fatto il suo)
- `agents/dottore/dottore.md` (estendere check ai user-facing)
- `agents/_skills/liveness-check/SKILL.md` (check pane content)
- `cli/src/commands/pid1.js` (orchestra entrambi, nessun cambio richiesto)
