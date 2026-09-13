# PR #214 — Rischio 6/6: nessuno prende in carico l'agente che NON si riesce ad avviare

> Analisi di sola lettura sul branch `lee-launcher-fixes` (PR #214 e #223 già mergiate).
> Nessun file sorgente è stato modificato. Tutte le righe citate sono di quel branch.

---

## ⚖️ Verdetto in una riga

**L'obiezione del proprietario è fondata e il buco è preciso e dimostrabile: nell'intera catena di sorveglianza NON esiste, in nessun file, un contatore dei FALLIMENTI di spawn.** Esistono tre contatori — recuperi *riusciti* (`agent-recoveries.tsv`), respawn *tentati* sui bridge (`bridge-flap-*`), respawn *tentati* sui worker (`roster.respawns[]`) — e nessuno dei tre misura «ho provato a rianimare questo agente e ho fallito». Il ramo di fallimento di `ensure_agent` è **una singola riga di `log`** senza stato, senza soglia e senza destinatario. È esattamente il motivo per cui 756 fallimenti in 37 ore non hanno prodotto un allarme: non c'era niente da superare, perché non si contava nulla.

---

## 1️⃣ Mappa dell'esistente

### 1.1 `agent-watchdog.sh` — l'unico anello deterministico sugli agenti

**Come decide che un agente è morto** — `.launcher/agent-watchdog.sh:150-175`, `is_session_alive()`:

1. `tmux has-session -t "$session"` → se manca, morto;
2. altrimenti legge `pane_current_command` e lo confronta con una whitelist di CLI LLM (`kimi|claude|codex|node|python|python3`, `:165`). Fuori whitelist = **zombie**: la sessione viene uccisa (`:171`) e trattata come non viva.

Il secondo controllo nasce dal post-mortem `2026-05-18-capitano-zombie-night` (11h di watchdog silenzioso su un Capitano zombie): `has-session` da solo diceva «vivo» su un pane ridotto a bash.

**Come lo rispawna** — due percorsi distinti, entrambi con la stessa struttura:

| Percorso | Funzione | Spawner | Ramo di successo | Ramo di FALLIMENTO |
|---|---|---|---|---|
| Core (`assistente/capitano/mentor/sentinella`, `:61`) | `ensure_agent` `:231-263` | `node /app/cli/bin/jht.js team start <role>` `:244` | verifica la sonda DOPO lo start `:249`, poi `notify_captain_recovery` `:258` | **`log ... start FAILED (rc=$?) — retrying at the next tick`** `:261` |
| Worker numerati (`SCOUT-N`…) | `respawn_worker` `:346-366` | `bash start-agent.sh <role> <inst>` `:350` | verifica la sonda `:352`, kick-off `:356`, `notify_captain_recovery` `:358` | **`log "worker $session: start FAILED — retrying at the next tick"`** `:364` |

⚠️ Esiste anche un **terzo** esito, ugualmente silenzioso: lo spawner esce **0** ma la sessione non è viva — `:249-251` («start reported OK but session … is still inactive — recovery not recorded») e `:352-354`. È un fallimento a tutti gli effetti e finisce nello stesso posto: una riga di log.

**Il registro `record_recovery` / `recovery_today_count`** — `:177-211`, file `$JHT_HOME/logs/agent-recoveries.tsv` (`:82`):

- è **append-only** e deliberatamente durevole («deve poter rispondere a *quante volte è stato recuperato oggi SCOUT-1?* anche dopo che i messaggi al Capitano sono scorsi via», `:76-79`);
- `record_recovery` scrive `timestamp \t sessione \t osservazione` e ritorna il conteggio del giorno solo **dopo** aver scritto (`:200-210`);
- è invocato **esclusivamente** da `notify_captain_recovery` (`:219`), cioè **solo sul percorso di successo**. Nei rami di fallimento non viene mai chiamato;
- 🔴 **nessun altro file nel repo legge questo TSV.** Verificato: le uniche due occorrenze della stringa `agent-recoveries` sono `.launcher/agent-watchdog.sh:82` e `tests/test_agent_watchdog_recovery_notice.py:41`. Non lo legge il Dottore, non il Mantenitore, non la dashboard, non il cloud sync.

**`bridge_escalate` e il flap cap** — `:435-464`, riguardano **solo bridge e daemon**, non gli agenti:

- `bridge_flap_ok` / `bridge_flap_record` (`:435-450`) tengono una finestra scorrevole di timestamp in `$JHT_HOME/logs/bridge-flap-<chiave>`; `JHT_BRIDGE_FLAP_CAP` default 3 in `JHT_BRIDGE_FLAP_WINDOW_SEC` default 600s (`:99-101`). Sono già **per chiave** (`bridge`, `tg-bridge-<ruolo>`);
- superato il cap, `bridge_escalate` (`:452-464`) **smette di rispawnare** e manda un `jht-tmux-send CAPITANO` con cooldown `JHT_BRIDGE_ESCALATE_COOLDOWN_SEC` (default 3600, `:101`);
- 🐞 **difetto già presente**: il cooldown usa **un unico file globale** `$BRIDGE_STATE_DIR/bridge-escalate.ts` (`:456`) per qualunque `what`. Un'escalation sui bridge zittisce per un'ora quella sui `pid1-child` e viceversa. E l'invio è `>/dev/null 2>&1 || true` (`:463`): se il Capitano non esiste, il fallimento è invisibile;
- i tre chiamanti sono `:513` (suite bridge), `:538` (tg-bridge per ruolo), `:548` (`PROC_DEAD_DEEP`). **Nessuno riguarda un agente LLM.**

**Gate del loop principale** (`:643-727`) — rilevanti perché definiscono quando un fallimento è *anomalo*: `.team-halted.flag` / `.weekly-halt.flag` (`:651`), standby a spesa zero (`:674`), `config_ready` (`:690`). Sotto questi gate non si tenta nemmeno lo spawn. Il solo caso già dotato di escalation *loud* è `config_ready=false` persistente oltre la grace (`:718-723`) — aggiunto dopo il post-mortem `2026-07-18-provider-vendor-enum-config-ready` (ashley morta ~44h in silenzio). È il precedente esatto della cosa che qui manca.

### 1.2 `shared/skills/process_health.py` — canary dei PROCESSI, non degli agenti

- Lista `EXPECTED` (`:36-67`): ogni riga è `(nome, marker-cmdline, gruppo)` con quattro gruppi — `bridge-suite` (riparabile con un `start-agent.sh bridge`), `pid1-child` (respawn di pid1 → **escala**), `daemon` (cloud-daemon → escala), `core` (pid1 stesso).
- `dead` = non vivo **e** non opzionale (`:227`); `dead_deep` = i `dead` nei gruppi `pid1-child|daemon|core` (`:229`) — quelli che si escalano invece di rispawnare, per non orfanarli.
- Consumatori: `agent-watchdog.sh:493` (`summary --shell`, poi `eval`) e il Mantenitore come step 0 dello sweep (`agents/mantenitore/mantenitore.md:81`, `agents/_skills/maintainer-sweep/SKILL.md:18-32`).
- 🔴 **Nella lista `EXPECTED` non c'è nessuna sessione agente.** Il file sorveglia `agent-watchdog.sh` come processo (`:46`), non gli agenti che quel watchdog dovrebbe tenere in vita. Un ASSISTENTE inesistente da 37 ore lascia `all_ok=1`.

### 1.3 DOTTORE e MANTENITORE — cosa controllano davvero

**Scheduler**: `.launcher/doctor-watchdog.sh` — Dottore 2×/finestra (slot `T30`/`MID`/`FALLBACK`, `:174-205`), Mantenitore 1×/giorno (`:153-166`). Stessi gate `config_ready` (`:117`) e halt/standby (`:132`) del watchdog agenti.

**Dottore** (`agents/dottore/dottore.md`):
- step 0: freschezza dello `stepcap-watchdog` (`:75-80`);
- step 0bis: `agent_unblock.py scan` — sblocca pane appesi;
- step 2: **«Inventory: `tmux list-sessions -F '#{session_name}|#{session_created}'`»** (`:100`, ripetuto in `agents/_skills/session-refresh/SKILL.md:26`);
- step 3: per ogni sessione — capture, TTL, intervista, kill+recreate+resume.
- 🔴 **L'inventario del Dottore parte dalle sessioni che ESISTONO.** Un agente che non nasce non compare in `tmux list-sessions`, quindi non entra nel giro. Il Dottore non confronta mai «atteso» con «vivo»: non legge `team_roster.py` (verificato: nessun prompt agente cita `team_roster`), non legge `agent-recoveries.tsv`. La sua diagnosi (`liveness-check`) lavora su `capture-pane`, e su una sessione che non c'è non ha niente da catturare.

**Mantenitore** (`agents/mantenitore/mantenitore.md:17-46`, sweep `:81-90`): process-liveness canary, tool-health, dipendenze, disco/RAM, orphan GC, locale. La regola **M-01** (`:102-103`) è esplicita: *«Never touch agent sessions or their context. That is the Dottore's domain.»* Il Mantenitore è la rete giornaliera **sotto i bridge**, non sotto gli agenti.

➡️ **Nessuno dei due agenti LLM ha il mandato «verifica che tutti gli agenti attesi esistano».**

### 1.4 CAPITANO — riceve escalation, ma non su questo

Riceve `jht-tmux-send CAPITANO ...` in tre casi: recupero **riuscito** (`agent-watchdog.sh:220-221`), flap cap **dei bridge** (`:463`), containment violato (`:589-591`). In più `pacing-bridge.py:1245` e `:1287` (target irricettivo/muto) e il Mantenitore su `dead_deep`.

Le sue regole coprono l'agente **vivo ma rotto**: C-08 (morto/silenzioso → Dottore, `agents/capitano/capitano.md:169`), C-08 bis (busy ≠ dead, `:171`), C-12 (brucia senza produrre), C-14 (loop attivo, `:304-309`). C-14 gli dice testualmente che sui core *«you only kill — the watchdog brings it back clean in ≤30s»* (`:308`): il Capitano è **istruito a fidarsi del watchdog**. Non ha nessuna regola per «il watchdog ci sta provando e non ce la fa».

### 1.5 Notifiche all'utente — il canale esiste già, ma non è collegato a niente di questo

| Canale | Ingresso | Note |
|---|---|---|
| **DB → dashboard + Telegram** | `agents/_tools/jht-notify-user` | CLI Python **deterministico, zero LLM**. Inserisce in `pending_user_messages` (`shared/skills/_db.py:304-328`), poi tenta Telegram e ricade su `delivered_via='web'`. `--kind` accetta già **`alert`** (`_db.py:308-310`). |
| **Telegram diretto** | `agents/_tools/jht-telegram-send` | 3 bot per ruolo; exit code parlanti (0/1/2/3/4/5/6). |
| **Cloud sync** | `shared/cloud/receipt-ids.js:38` | `pending_user_messages` è tra le tabelle sincronizzate. |
| **Web** | `web/app/(protected)/messages/` (+ `web/lib/local-queries.ts:1438-1562`) | La casella agente→utente. |
| **Desktop / gioco** | `game/scripts/setup/team_start_state.gd` | Macchina a stati `starting/running/failed/**recovering**` (`:11-15`). |

🔴 **Nessuno script di `.launcher/` chiama `jht-notify-user`** (verificato: zero occorrenze in tutta la directory). Il canale utente è oggi appannaggio esclusivo degli agenti LLM.

🔴 La pagina `/team` della dashboard (`web/app/(protected)/team/page.tsx`) mostra **attività** (`getTeamActivity`), non liveness: non esiste in tutta la web UI una vista «questo agente è giù».

🟡 Il desktop è l'unico posto dove esiste già il concetto di «sto tentando il recupero»… ma è inutilizzabile qui, per tre motivi tutti in `team_start_state.gd`:
- il pattern cercato nel log è **hardcoded sul solo CAPITANO**: `WATCHDOG_ATTEMPT := "agent capitano: session CAPITANO is inactive — relaunching via jht team start"` (`:27`);
- la finestra di osservazione dura **3 minuti** dopo il click su Start (`RECOVERY_TIMEOUT_MS := 180_000`, `:26`; scadenza → `failed`, `:107-110`);
- il delta di log si legge **solo** dentro quella finestra (`game/scripts/setup/setup_service.gd:543-545`).

Cioè: la UI sa dire «recovering» solo per il Capitano, solo se l'utente sta guardando, e solo nei primi 180 secondi.

---

## 2️⃣ Il buco — scenario «`start-agent.sh` esce 1 ripetutamente per lo stesso agente»

### Anello per anello

| Anello | Scatta? | Perché |
|---|:--:|---|
| `is_session_alive` rileva la sessione assente | ✅ | `:161`, ogni 30s |
| `ensure_agent` ritenta lo spawn | ✅ | `:244`, ogni tick, all'infinito |
| Il fallimento finisce a log | ✅ | `:261` — **e finisce lì** |
| Il fallimento viene **contato** | ❌ | nessun contatore esiste (vedi sotto) |
| `record_recovery` scrive nel TSV | ❌ | invocato solo da `notify_captain_recovery`, `:219` — percorso di successo |
| Il Capitano viene avvisato | ❌ | `notify_captain_recovery` è nel ramo `then`, `:258` |
| `bridge_escalate` scatta | ❌ | i suoi 3 chiamanti (`:513`, `:538`, `:548`) riguardano bridge/daemon |
| `process_health.py` lo vede | ❌ | nessuna sessione agente in `EXPECTED` (`:36-67`) |
| Il Mantenitore lo vede | ❌ | step 0 = `process_health.py`; M-01 gli vieta le sessioni agente |
| Il Dottore lo vede | ❌ | inventario da `tmux list-sessions` (`dottore.md:100`) = solo ciò che esiste |
| `team_roster.py` reagisce (worker) | ⚠️ | vedi «il caso worker» sotto — reagisce **al contrario** |
| L'utente riceve una notifica | ❌ | nessuno script `.launcher/` chiama `jht-notify-user` |
| La dashboard mostra qualcosa | ❌ | `/team` è attività, non liveness |
| Il desktop mostra `failed` | ❌ | solo CAPITANO, solo 180s dopo un click su Start |

### Il watchdog distingue «rispawnato con successo» da «sto fallendo»?

**Sì nel log, no nello stato.** Le due frasi sono diverse (`:245` *start OK and session verified alive* vs `:261` *start FAILED*), ma la prima produce **una riga durevole in un TSV + un messaggio al Capitano con un numero progressivo**, la seconda produce **solo testo in un file di log rotante che nessun consumatore legge**. La distinzione esiste per un umano che apra il log; non esiste per il sistema.

### Esiste da qualche parte un contatore di FALLIMENTI di spawn?

**No. Non esiste, in nessun file del repository.** È la risposta esplicita richiesta, e regge al confronto con i tre contatori che *sembrano* fare quel lavoro:

| Contatore | File:riga | Cosa conta davvero | Perché non copre il caso |
|---|---|---|---|
| `agent-recoveries.tsv` | `agent-watchdog.sh:82`, `:189-211` | recuperi **riusciti**, per sessione, per giorno | scritto solo nel ramo `then` |
| `bridge-flap-<chiave>` | `agent-watchdog.sh:435-450` | respawn **tentati** in finestra, sui **bridge** | mai invocato per una sessione agente |
| `roster.respawns[]` | `team_roster.py:636-648` | respawn **tentati**, sui **worker numerati** | `mark-respawn` è scritto **prima** del tentativo (`agent-watchdog.sh:431`) e non registra l'esito |

E c'è di peggio sul terzo. `decide_respawn` (`team_roster.py:540-602`) interpreta «l'ho rispawnato e la sessione è di nuovo assente entro il cooldown» come *«la lettura morta era sbagliata»* e **auto-ritira** l'entry (`:583-587`, motivo scritto a `:629-632`: *«treating it as an intentional removal»*). In altre parole: **per un worker, un secondo fallimento di spawn non alza un allarme — cancella il worker dal roster atteso, in silenzio.** La guardia progettata contro il conflitto col Capitano si comporta, di fronte a uno spawn rotto, come un insabbiamento.

### Perché 756 fallimenti in 37 ore sono passati inosservati

Con `tmux new-session` appeso (la causa che #214 corregge, `start-agent.sh:1109-1127`), il fd 9 del `flock` (`start-agent.sh:545-551`) restava aperto per sempre → ogni tentativo successivo moriva in `flock -w 30` con *«timed out waiting for the concurrent spawn»* (`:549-550`) → `ensure_agent` cadeva a `:261` → **una riga di log ogni 30 secondi, per 37 ore, e nient'altro**. Nessuna riga nel TSV (che è la misura che qualcuno guarda), nessun messaggio al Capitano, nessun processo mancante per `process_health.py`, nessuna sessione da ispezionare per il Dottore. Il guasto non era «poco visibile»: era **fuori da ogni strumento di misura del sistema**.

PR #214 rompe il *meccanismo* di questo particolare loop (il lock si libera, i tentativi ripartono puliti). **Non rompe l'invisibilità**: un `start-agent.sh` che fallisce per un'altra causa — credenziali revocate, disco pieno, immagine corrotta, provider in errore — produce esattamente lo stesso silenzio.

---

## 3️⃣ Progetto

Requisito del proprietario, tradotto in contratto: *un fallimento ripetuto di spawn deve (a) essere **misurato**, (b) avere un **proprietario** entro minuti, (c) raggiungere l'**utente** se non si risolve, (d) **spegnersi da solo** quando l'agente riparte.*

### 🥇 Proposta PRINCIPALE — «spawn-failure streak» a due gradini nel watchdog

Tutto dentro `.launcher/agent-watchdog.sh`, riusando i pattern già presenti nel file. Nessun componente nuovo, nessun agente LLM nel percorso critico.

**A. Dove si conta.** Due funzioni gemelle di `record_recovery`, da collocare **prima** del marker `log "watchdog start` (`:552`) perché il test harness estrae il prelude fino a lì (`tests/test_agent_watchdog_recovery_notice.py:18-23`; le funzioni di containment stanno dopo apposta, `:554-555`):

```
record_spawn_failure <session> <detail>   → appende in $JHT_HOME/logs/agent-spawn-failures.tsv
                                             (ts \t session \t detail) e stampa lo streak corrente
clear_spawn_failures  <session>           → azzera lo streak al primo successo
```

Registro **separato** da `agent-recoveries.tsv`, non una terza colonna in quello esistente: `recovery_today_count` (`:184-186`) conta le righe per sessione **senza filtrare l'osservazione**, quindi mescolarle falsificherebbe il «Recovery #N» già inviato al Capitano e testato (`test_agent_watchdog_recovery_notice.py:87-88`).

**Punti di chiamata** — tutti e quattro i rami di fallimento oggi muti:
- `ensure_agent` `:250` (start OK ma sessione non viva) e `:261` (start rc≠0);
- `respawn_worker` `:353` e `:364`;
- e `clear_spawn_failures` sui due rami di successo (`:253` e `:355`).

Il `detail` è l'ultima riga di stderr dello spawner — resa parlante da #223/R4 — così l'allarme dice *perché*, non solo *che*.

**B. Soglie.** Due gradini, entrambi su fallimenti **consecutivi** (non cumulativi nella giornata: un flap benigno non deve suonare) **e** con un minimo di tempo trascorso, sul modello di `CONFIG_NOT_READY_GRACE_TICKS` (`:641`):

| Gradino | Soglia (default, env-overridabile) | Destinatario | Costo |
|---|---|---|---|
| **1 — presa in carico** | `JHT_SPAWN_FAIL_ESCALATE_AFTER=5` fallimenti consecutivi **e** ≥5 min dal primo (≈2,5 min a 30s/tick) | **CAPITANO** via `"$TMUX_SENDER"` (già cablato, `:220`) | 1 turno LLM/ora/sessione |
| **2 — allarme utente** | `JHT_SPAWN_FAIL_ALERT_AFTER=40` consecutivi (≈20 min ininterrotti) | **UTENTE** via `jht-notify-user --agent capitano --kind alert` | **zero token** (Python puro) |
| **rientro** | primo successo dopo un gradino raggiunto | stessi destinatari già avvisati | trascurabile |

Il **respawn non si ferma mai**: nessun cap alla `bridge_flap_cap`. Un agente che non parte e per cui smettiamo di provare è peggio del rumore. Si aggiunge solo un **backoff**: oltre il gradino 1 si tenta 1 volta ogni `JHT_SPAWN_FAIL_BACKOFF_TICKS=10` (5 min) invece che ogni 30s — meno pressione su lock, CPU e log, e nessuna perdita di reattività reale (se non parte al 5° tentativo non partirà al 6°).

**C. Chi per primo, e perché non il Dottore.** Capitano → utente. Il Dottore **non** va messo nel percorso automatico: costa un turno LLM ricco e i suoi strumenti (`liveness-check`, `session-refresh`) lavorano su `capture-pane` di sessioni **esistenti** — su una sessione che non nasce non ha niente da catturare. Resta raggiungibile su decisione del Capitano (C-08, `capitano.md:169`), che è il posto giusto per quella scelta.

**D. Anti-spam.**
1. Cooldown **per sessione** (`JHT_SPAWN_FAIL_COOLDOWN_SEC=3600` al gradino 1, `21600` al gradino 2), su file `spawn-escalate-<SESSION>.ts`. 🔧 **Correggere contestualmente il difetto gemello esistente**: `bridge_escalate` usa un unico `bridge-escalate.ts` (`:456`) per tutti i `what` — va reso per-chiave con la stessa convenzione.
2. Reset dello streak al primo successo → l'allarme si spegne da solo.
3. I gate `halted`/`weekly-halt` (`:651`), `standby` (`:674`) e `config_ready` (`:690`) impediscono già il tentativo: lo streak non sale a team fermo. Il caso `config_ready=false` persistente ha già la sua escalation (`:718-723`) e non va duplicato.
4. Il containment sticky (`:237`) esce prima di qualsiasi tentativo: una sessione tenuta giù di proposito non genera falsi allarmi.

**E. Come l'utente lo vede.**
- **Ora**: riga `kind='alert'` in `pending_user_messages` → **Telegram** (bot capitano) se configurato, **sempre** la casella `/messages` della dashboard, che è già sincronizzata (`shared/cloud/receipt-ids.js:38`). Testo che dice sessione, streak, durata, ultima causa e il path del log — e che **non dichiara una causa non osservata**, coerentemente con la disciplina già scritta a `:213-217`.
- **Fase 2 (fuori da questo intervento)**: generalizzare la macchina a stati del desktop — `WATCHDOG_ATTEMPT` non più hardcoded sul Capitano (`team_start_state.gd:27`) e non più confinata ai 180s post-Start (`:26`) — così la scheda agente del gioco può mostrare *non avviabile* invece di un LED spento indistinguibile da *inattivo*.

**Costo stimato**: ~70 righe in `agent-watchdog.sh` + 1 seam di test (`JHT_NOTIFY_USER_BIN`, sulla falsariga dei tre già presenti a `:83-84`) + il file di test. Nessuna migration, nessun contratto pubblico toccato.

### 🥈 Alternativa ECONOMICA — riuso letterale del flap cap

Nessun registro nuovo, nessuna notifica utente. Nei rami di fallimento di `ensure_agent` e `respawn_worker`:

```
flap_record "agent-$session"
flap_ok "agent-$session" || escalate "agent $session cannot be started (>N failed attempts in M min)"
```

`bridge_flap_ok` / `bridge_flap_record` (`:435-450`) sono **già** generiche per chiave; serve solo rinominarle (`flap_ok`/`flap_record`) e rendere per-chiave il cooldown di `bridge_escalate` (`:456`). **≈15 righe.** Da notare: qui il flap cap va usato **solo per decidere quando parlare**, mai per smettere di rispawnare — semantica opposta a quella dei bridge, e va scritto nel commento o qualcuno lo "uniformerà" per errore.

Copre *«qualcuno se ne accorge»*; **non** copre *«l'utente lo sa»*. Due limiti da dichiarare:
- se il non-avviabile è il **CAPITANO**, `$TMUX_SENDER` scrive in un pane che non esiste e fallisce in silenzio (`|| true`, `:463`): nessuno saprà mai nulla;
- il conteggio vive in un file a finestra scorrevole, non è una misura storica: non risponde a *«quante volte oggi?»*.

Nell'incidente reale (ASSISTENTE morto, Capitano vivo) sarebbe bastata. È un ripiego ragionevole se si vuole chiudere il buco in un commit, ma la richiesta del proprietario — *«e come lo sa l'utente?»* — resta scoperta.

---

## 4️⃣ Rischi della proposta stessa

| Rischio | Perché è reale | Mitigazione |
|---|---|---|
| **Falso allarme al boot** | Al primo avvio la config può essere pronta mentre il provider è ancora lento; 5 tick = 2,5 min possono non bastare a un cold start (il CLI stesso usa `timeoutMs: 90_000`, `cli/src/commands/team/start.js:294`) | Doppia condizione conteggio **e** tempo (≥5 min dal primo fallimento), come la grace di `:641` |
| **Falso allarme da teardown deliberato** | Un `tmux kill-session` del Capitano (C-14, `agent-emergency/SKILL.md:105`) è seguito da un respawn che **riesce** → lo streak non parte. Il containment esce prima (`:237`). | Rischio già coperto dall'esistente; da verificare con un test dedicato |
| **Loop di escalation** | Il messaggio al Capitano lo fa ragionare; se reagisce con `spawn-agent` e anche quello fallisce, si sommano tentativi | Il contatore conta **solo** i tentativi del watchdog; cooldown per sessione; il messaggio dice esplicitamente «il watchdog continua a ritentare, non rilanciare a mano prima di aver letto il log» |
| **Costo in token** | 1 messaggio/ora/sessione al Capitano | Trascurabile rispetto allo `heartbeat-bridge` orario già esistente. Il gradino utente costa **zero** token. Il Dottore non viene svegliato per design |
| **Allarme che non si spegne** | Un alert vecchio e mai chiuso addestra l'utente a ignorarlo — e il prossimo allarme vero non verrà letto | Il messaggio di **rientro** non è un extra: è parte del contratto |
| **Tempesta al riavvio del container** | Se tutti gli agenti falliscono insieme (provider giù, disco pieno) → N escalation simultanee | Coalescere: se le sessioni in streak sono ≥3, un solo messaggio «il team non si avvia (N agenti)» invece di N |
| **Doppia verità coi worker** | `decide_respawn` auto-ritira un worker sparito due volte (`team_roster.py:583-587`): lo streak salirebbe a 1 e poi la sessione uscirebbe dal roster | Il contatore vive nel watchdog e **non** dipende dal roster; ma va scritto che per i worker l'auto-retire è oggi una perdita di segnale, ed è un difetto a sé da valutare |
| **Crescita del TSV** | Un guasto lungo scrive ~120 righe/ora | Con il backoff scende a ~12/ora; e va inserito in `shared/skills/log_archive.py` come gli altri log |

---

## 5️⃣ Test da aggiungere

File proposto: **`tests/test_agent_watchdog_spawn_failure_escalation.py`**, gemello di `tests/test_agent_watchdog_recovery_notice.py` e con lo stesso metodo: estrarre il prelude fino al marker `log "watchdog start` (`:18-23`), eseguire le funzioni **vere** con i confini iniettati via env (`JHT_NODE_BIN`, `JHT_TMUX_SENDER`, `JHT_START_AGENT`, `JHT_AGENT_RECOVERY_LOG` — più il nuovo `JHT_NOTIFY_USER_BIN`), senza tmux né TUI.

1. **`test_repeated_spawn_failure_is_counted_in_a_durable_register`** — `is_session_alive → 1`, `start_rc=1`, `ensure_agent assistente` × 6 → il TSV dei fallimenti ha 6 righe `ASSISTENTE`, e `agent-recoveries.tsv` resta **vuoto** (il recupero non è stato falsificato).
2. **`test_the_captain_is_warned_once_at_the_first_threshold`** — stesse condizioni: il sender riceve **esattamente un** messaggio, contenente il nome sessione, lo streak e il path del registro, e **non** la parola «dead»/«morto» (il watchdog osserva un fallimento di spawn, non una causa — stessa disciplina asserita a `test_...recovery_notice.py:89`).
3. **`test_a_successful_start_resets_the_streak`** — 4 fallimenti, 1 successo, 4 fallimenti → **nessuna** escalation (soglia 5 mai raggiunta consecutivamente) e registro azzerato.
4. **`test_the_user_alert_fires_only_at_the_second_threshold_and_only_once`** — finto `jht-notify-user`: 0 chiamate sotto soglia, 1 sopra, ancora 1 dopo altri 50 tick. Asserire anche gli argomenti (`--kind alert`).
5. **`test_recovery_after_an_alert_sends_a_resolution_notice`** — dopo il gradino 2, un `ensure_agent` riuscito produce la riga di rientro sia al Capitano sia all'utente, e azzera lo stato su disco.
6. **`test_start_ok_but_session_not_alive_counts_as_a_spawn_failure`** — regressione sul terzo esito silenzioso (`:250`): `start_rc=0` con `is_session_alive → 1` deve alimentare lo streak, non essere ignorato.
7. **`test_worker_spawn_failures_use_the_same_measure`** — `respawn_worker scorer 2 SCORER-2 unexpected` con spawner rc=1, × 6.
8. **`test_the_escalation_cooldown_is_per_session`** — regressione sul difetto **esistente** (`:456`): ASSISTENTE e SCOUT-2 in streak contemporaneo producono **due** messaggi, non uno.
9. **`test_an_intentional_ttl_recreation_never_counts_as_a_spawn_failure`** — `INTENTIONAL_RECREATE_SESSION` e `recovery_kind=intentional_ttl` restano fuori dalla misura, come già per i recuperi (`test_...recovery_notice.py:92-107`).
10. **`test_a_contained_session_never_produces_a_spawn_failure`** — con `agent_is_contained → 0`, `ensure_agent` esce a `:238` e non scrive nulla.

Vincoli operativi (memoria `feedback_no_full_suites_small_steps`): su questo PC eseguire **solo** il nuovo file e `tests/test_agent_watchdog_recovery_notice.py`, uno alla volta — mai la suite intera.

---

## 📌 Sintesi per il proprietario

L'obiezione è corretta e il difetto è strutturale, non un dettaglio di #214. Oggi il sistema misura i **successi** del watchdog e resta cieco sui suoi **fallimenti**: `agent-recoveries.tsv` si scrive solo quando l'agente riparte, il Capitano viene avvisato solo quando l'agente riparte, il Dottore guarda solo le sessioni che esistono, il Mantenitore ha il divieto esplicito di occuparsi degli agenti, e nessuno script del launcher ha mai parlato all'utente. Un agente che non si riesce ad avviare non è «poco visibile»: è fuori da ogni strumento di misura. La cura minima è contare i fallimenti consecutivi dove già si contano i recuperi, dare la presa in carico al Capitano dopo ~5 tentativi e all'utente dopo ~20 minuti attraverso il canale di notifica che esiste già ed è a costo zero in token — con reset automatico e messaggio di rientro, perché un allarme che non si spegne è un allarme che si impara a ignorare.
