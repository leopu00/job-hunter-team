# PR #214 — Rischio 5/5: sessione orfana / guscio vuoto dopo il `timeout`

> Analisi di sola lettura sul branch `lee-launcher-fixes` (PR #214 e #223 già mergiate).
> Nessun file sorgente è stato modificato. Commit d'origine della riga in esame: `1e45cd7d42`
> *fix(launcher): bound tmux new-session with a timeout to prevent a permanent spawn lockout*.

---

## ⚖️ Verdetto

**RISCHIO REALE — gravità MEDIA complessiva, con due letture molto diverse a seconda del ruolo:**

- 🟢 **Ruoli core** (ASSISTENTE / CAPITANO / MENTOR / SENTINELLA): il guscio è **coperto davvero** da `is_session_alive` entro **≤30 s** (`.launcher/agent-watchdog.sh:150-175`, `231-263`, interval `:59`). Gravità BASSA.
- 🟠 **Worker numerati** (SCOUT/ANALISTA/SCORER/SCRITTORE-N): `is_session_alive` **non li guarda mai**. Il roster li considera VIVI perché guarda solo `tmux list-sessions` (`shared/skills/team_roster.py:387-395`, `576`). L'unica rete deterministica è il **TTL a 12 h** (`.launcher/agent-watchdog.sh:368-404`, soglia `:66`). Gravità MEDIA: fino a 12 h di worker fantasma.
- 🔴 **CRITICO effimero** (`CRITICO-S<N>`): escluso per costruzione dal respawn del roster (`team_roster.py:95-100`, `:574`) e con un ciclo di vita di **minuti**, non di ore. Il TTL a 12 h arriva quando la review è morta da un pezzo: **per la singola review il guasto è permanente** e blocca lo Scrittore nel polling del verdetto (`agents/_skills/critic-loop/SKILL.md`, step 3-5). Gravità MEDIA-ALTA sul percorso che produce il deliverable finale.
- ⚠️ **La probabilità della race è bassa**, ma nelle **stesse tre righe** ci sono due difetti *più* probabili di lei: il `kill-session` senza target esatto (prefix matching di tmux, scatta a **ogni** fallimento del ramo, non solo sulla race) e l'assenza di `timeout` sul `kill-session` stesso, che può ri-creare esattamente il lockout del fd 9 che la PR voleva chiudere.
- 🧩 **La radice non è la PR**: il ramo principale di `start-agent.sh` è **l'unico dei tre percorsi di spawn** che non verifica mai che il REPL sia partito. La PR aggiunge una nuova porta a un buco che esisteva già. Il fix strutturale (riuso di `jht_spawn_wait_repl`, già sorgeato) chiude tutte le porte insieme e costa ~5 righe.

---

## 1️⃣ La sequenza esatta: il guscio è producibile?

### Le righe in esame — `.launcher/start-agent.sh:1120-1128`

```bash
if ! timeout 20 tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"; then
  echo "Error: 'tmux new-session' for '$SESSION' did not return within 20s (hung spawn)." >&2
  tmux kill-session -t "$SESSION" 2>/dev/null
  exit 1
fi
send_env_vars
tmux send-keys -t "$SESSION" "$FULL_CMD" C-m
```

`tmux new-session` è un **client** che parla con il **server** tmux: il client invia il comando, il server crea la sessione, il client stampa e esce. `timeout` manda SIGTERM **al client**, non al server. Se il server ha già ricevuto/accodato il comando, la sessione nasce comunque — dopo che il client è morto.

Ne segue la sequenza:

| t | evento |
|---|---|
| 0 s | `tmux new-session` parte; il server è lento (bind mount Windows / Docker Desktop, il caso descritto a `:1108-1119`) |
| 20 s | `timeout` manda SIGTERM al client → rc 124 → si entra nel ramo di errore |
| 20 s + ε | `tmux kill-session -t "$SESSION"` → **la sessione non esiste ancora** → no-op silenzioso (`2>/dev/null`) |
| 20 s + ε | `exit 1` |
| 20 s + n | il server si sblocca e **registra la sessione**: pane = bash nudo, cwd `$AGENT_DIR` |

Da quel momento in poi:

- `send_env_vars` (`:1028-1074`) **non è mai stato eseguito**: niente `HOME`, niente `PATH` con `/app/agents/_tools`, niente `JHT_AGENT_NAME` (`:1072`), niente `JHT_DB`/`JHT_CONFIG`;
- `$FULL_CMD` (`:1128`) **non è mai stato inviato**: nessun CLI LLM nel pane;
- il singleton a `.launcher/start-agent.sh:553-557` (`tmux has-session` → «Session '…' is already active.» → **exit 0**) rende lo stato **definitivo**: ogni respawn futuro (utente, Capitano, watchdog) è un no-op che dichiara successo.

**Conferma: il guscio vuoto è producibile.** ✅

### Un dettaglio che alza la probabilità, non la abbassa

`timeout` **non fa nulla** quando il client tmux è bloccato in una syscall non interrompibile (stato D su un mount wedged): SIGTERM resta pendente, `timeout 20` (senza `-k`) aspetta all'infinito e il ramo di errore non viene mai preso. Quindi la guardia della PR scatta **esattamente** nei casi in cui il client è ancora ammazzabile — cioè quando il server è *lento ma vivo*, che è precisamente lo scenario in cui la sessione si materializza qualche secondo dopo. Il guscio non è un corner case del fix: quando il fix scatta, è il suo esito **più probabile**.

### Cosa succede al lock (fd 9)

`.launcher/start-agent.sh:545-551`:

```bash
exec 9>"${JHT_HOME:-/jht_home}/locks/start-${SESSION}.lock"
if ! flock -w 30 9; then ...
```

Il lock è tenuto da un **file descriptor del processo**: `exit 1` chiude il processo, il kernel chiude fd 9, il lock si rilascia. 🟢 **Su questo la PR mantiene la promessa**: niente lock starvation, niente ripetizione dei 756 respawn falliti in 37 h.

🔴 **Ma con una crepa**: `tmux kill-session` a `:1124` **non ha timeout**. È un altro client verso lo **stesso server sospetto di essere wedged**. Se si appende lì, il processo non esce mai, fd 9 resta aperto e torna *identico* il bug che la PR chiude. La riga di pulizia è l'unico punto del ramo che può ancora appendersi per sempre.

### Cosa succede alla workdir già preparata

Tutta la preparazione a monte è idempotente: `mkdir -p "$AGENT_DIR"` (`:821`), `mkdir -p "$AGENT_DIR/tools" "$AGENT_DIR/tmp"` (`:847`), append del trust Codex protetto da `grep -qF` (`:862-870`). Lasciarla preparata **non fa danno** e il tentativo successivo la riusa. 🟢

### Cosa NON succede: il roster

`team_roster.py record` gira a `.launcher/start-agent.sh:1220-1223`, cioè **dopo** l'`exit 1`. Il guscio quindi:

- **non entra** nel roster se è un primo spawn → nessuno lo attende, nessuno lo cerca;
- se l'entry esisteva già (respawn di un worker morto), resta `status=active` e la sessione risulta **viva** in `missing()` / `decide_respawn` perché `sess in alive` (`team_roster.py:456-467`, `:576`).

In entrambi i casi il roster non produce alcun respawn. ⛔

### 🔻 Difetto collaterale nella stessa riga: `kill-session` senza target esatto

`tmux kill-session -t "$SESSION"` usa la risoluzione standard dei target tmux: **nome esatto → prefisso → fnmatch**. Quando la sessione **non** esiste — cioè il caso normale di questo ramo di errore — tmux passa al **prefix match**:

- spawn fallito di `SCOUT-1` mentre `SCOUT-10` è viva e `SCOUT-1` no → `-t SCOUT-1` **uccide SCOUT-10**;
- spawn fallito di `critico` senza istanza (sessione `CRITICO`, `spawn-lib.sh:80-83`) mentre esiste `CRITICO-S3` → **uccide il Critico di SCRITTORE-3** in mezzo a una review.

Il repo **sa già** come si evita: `.launcher/agent-watchdog.sh:564` e `:586` usano `-t "=$session"` (`=` forza l'exact match). Il ramo nuovo no. E questo difetto **non richiede la race**: scatta a ogni fallimento del ramo, incluso l'rc 127 di `timeout` assente documentato nel rischio 2 (`214-2-timeout-portability.md`).

---

## 2️⃣ Copertura reale di `is_session_alive`: chi è davvero sorvegliato

### La sonda

`.launcher/agent-watchdog.sh:150-175` — `tmux has-session` + `pane_current_command`; se il comando non è `kimi|claude|codex|node|python[3]` → log «ZOMBIE detected» + `kill-session` + return 1. Sonda corretta, che riconosce il guscio.

### Ma viene invocata solo da tre punti

| Chiamante | file:riga | Su chi |
|---|---|---|
| `ensure_agent` | `:240` | **solo** `AGENTS=(assistente capitano mentor sentinella)` (`:61`, loop `:702-704`) |
| `maybe_refresh_sentinella` | `:281` | solo SENTINELLA |
| verifica post-start | `:249`, `:351` | solo **dopo** uno start già tentato |

La verifica post-start (`:351` in `respawn_worker`) sembra una rete per i worker, ma **non lo è nel nostro caso**: si raggiunge solo se `start-agent.sh` è stato **invocato**, e viene eseguita solo nel ramo `if` (start rc 0). Nel nostro scenario `start-agent.sh` è uscito 1 → si cade a `:364` («start FAILED — retrying at the next tick») e la sonda non gira. Al tick successivo il roster non chiede più niente, perché la sessione ora *esiste*. 🕳️

### Chi decide i worker: il roster, che è cieco al guscio

`maybe_respawn_workers` (`:411-433`) delega tutto a `team_roster.py next-respawn`. E lì la nozione di «vivo» è **una sola riga**:

```python
# shared/skills/team_roster.py:387-395
["tmux", "list-sessions", "-F", "#{session_name}"]
```

Nessun `pane_current_command`. Il guscio compare nella lista → `sess in alive` (`:576`, `:611`) → **mai candidato al respawn**. La lezione del post-mortem 2026-05-18 («`tmux has-session` mentiva al watchdog per 11 ore», citata a `agent-watchdog.sh:151-154`) è stata applicata a `is_session_alive` ma **non** al roster, che è nato dopo (2026-07-29) per i worker.

### Il filtro `is_agent_session` (`:295-306`) e chi resta fuori

```bash
DOTTORE*|DOCTOR-WATCHDOG|MANTENITORE*|SENTINELLA-WORKER) return 1 ;;
ASSISTENTE|CAPITANO|MENTOR|SENTINELLA|CRITICO)            return 0 ;;
SCOUT-[0-9]*|ANALISTA-[0-9]*|SCORER-[0-9]*|SCRITTORE-[0-9]*|CRITICO-S[0-9]*) return 0 ;;
```

Questo filtro governa **solo il TTL**, non la sonda di liveness. Verdetto per gruppo:

| Sessione | Passa dal ramo `:1120`? | `is_session_alive`? | Roster respawn? | TTL 12 h? | Guscio permanente? |
|---|---|---|---|---|---|
| ASSISTENTE/CAPITANO/MENTOR/SENTINELLA | ✅ sì | ✅ ogni tick | — (li fa `ensure_agent`) | ✅ | ❌ no, ≤30 s |
| SCOUT/ANALISTA/SCORER/SCRITTORE-N | ✅ sì | ❌ mai | ❌ (cieco: sessione «viva») | ✅ | ⚠️ sì, **fino a 12 h** |
| CRITICO-S\<N\> (effimero) | ✅ sì | ❌ mai | ❌ **escluso per design** (`team_roster.py:95-100`, `:574`) | ✅ (ma a 12 h) | 🔴 sì, **per tutta la review** |
| CRITICO (senza istanza) | ✅ sì | ❌ mai | ❌ escluso | ✅ … ma vedi nota ⬇️ | 🔴 sì |
| DOTTORE / MANTENITORE | ❌ no → `spawn-doctor.sh:47-61`, `spawn-maintainer.sh:47-62` | ❌ | ❌ | ❌ escluso | ❌ **non esposti**: hanno `jht_spawn_wait_repl` |
| SENTINELLA-WORKER | ❌ no → short-circuit `:125-192` | ❌ | ❌ | ❌ escluso | ❌ **non esposto**: check inline `:178-190` |
| DOCTOR-WATCHDOG | ❌ no (sessione di uno script bash) | ❌ | ❌ | ❌ escluso | n/a — il suo pane **è** legittimamente una shell, per questo è escluso |

> 📌 **Risposta secca alla domanda chiave**: sì, gli agenti **effimeri** (le istanze CRITICO create dallo Scrittore in `critic-loop`, non dal Capitano) sono **scoperti** da ogni rete deterministica tranne il TTL a 12 h, che per un agente che vive minuti è come non esserci. I ruoli **esclusi** dal filtro (DOTTORE/MANTENITORE/SENTINELLA-WORKER/DOCTOR-WATCHDOG), invece, **non transitano dal ramo modificato** e quindi il rischio 5 non li tocca: la loro esclusione è corretta e non è un buco.

> ⚠️ **Nota a margine (bug indipendente, trovato strada facendo)**: se il TTL colpisce la sessione `CRITICO` *senza* istanza, `session_role` (`:308-326`) produce istanza vuota → non si chiama `respawn_worker` → si imposta `INTENTIONAL_RECREATE_SESSION="CRITICO"` (`:401`), che però viene consumato **solo** da `ensure_agent` per i 4 core (`:254`). Risultato: il Critico non viene ricreato da nessuno e il marcatore resta appeso. Fuori scope, ma vale un ticket.

### Il Critico: perché lì il guscio fa il danno peggiore

`agents/_skills/critic-loop/SKILL.md` (step 1, 3, 4, 5):

```bash
tmux kill-session -t "$CRITICO_SESSION" 2>/dev/null
bash /app/.launcher/start-agent.sh critico "$MY_NUMBER"
sleep 8
jht-tmux-send "$CRITICO_SESSION" "[REQ] Review cieca: PDF: …"
```

Nessuna verifica del REPL, `sleep 8` come unico criterio di boot, e `jht-tmux-send` **esce 0 anche scrivendo dentro un bash** — è il difetto che la skill `liveness-check` mette nella sua stessa descrizione (`agents/_skills/liveness-check/SKILL.md`, front-matter e Step 0). Lo Scrittore invia il PDF a una shell, poi entra nel polling del verdetto: aspetta una risposta che non arriverà, bruciando i suoi tick di throttle. La round 1 delle 3 obbligatorie non si chiude.

---

## 3️⃣ Quanto ci mette la mitigazione e cosa vede l'utente nel frattempo

### Tempi

| Chi | Tempo alla rimozione del guscio | Meccanismo |
|---|---|---|
| Core (4) | **≤ 30 s** (`INTERVAL_SEC`, `agent-watchdog.sh:59`) | `ensure_agent` → `is_session_alive` killa → `jht team start` → riverifica (`:249`) → `notify_captain_recovery` |
| Worker numerati | **~30 min** best-effort, **12 h** garantito | Giro del Dottore (`liveness-check`, «Routine round — every Dottore wake-up (~30 min)», PRIORITY 2) → altrimenti TTL (`:368-404`) |
| CRITICO-S\<N\> | **12 h** (di fatto: mai, entro la vita utile) | solo TTL |

Il giro del Dottore **non è una garanzia**: è un agente LLM, e l'incidente 2026-07-28/29 citato in testa al watchdog (`:18-38`) è esattamente il caso in cui il Dottore era fermo. Inoltre la sua skill impone PRIORITY 1 (i core) prima dei worker: con budget stretto i worker non vengono raggiunti.

### Cosa vede l'utente: **verde ovunque**

Tutti i consumatori di stato derivano «vivo» dalla **sola esistenza della sessione**:

| Superficie | file:riga | Cosa mostra |
|---|---|---|
| Dashboard web, dettaglio agente | `web/app/api/agents/[id]/route.ts:48-55` + `:134-138` | `status: "running"` |
| Dashboard web, lista agenti | `web/app/api/agents/route.ts:32-41` | presente nel set delle sessioni attive |
| Pulsante **Start** in dashboard | `web/app/api/agents/[id]/route.ts:181-182` | `{ ok: true, status: "already_active" }` — **il riavvio dall'UI non fa niente** |
| `jht team list` / `jht team status` | `cli/src/commands/team/list.js:24-25` + `cli/src/commands/team/agents.js:63-71`, `:91-93` | pallino **verde** `●` |
| Chat con l'agente (dashboard/Capitano) | `jht-tmux-send` → exit 0 | messaggio consegnato… dentro un bash, e perso |

L'**unico** segnale divergente è il LED CPU del gioco: `agent_vitals.py` campiona solo i processi marcati con `JHT_AGENT_NAME` (`shared/skills/agent_vitals.py:55-66`, `:89-102`), variabile che `send_env_vars` non ha mai esportato (`start-agent.sh:1072`) → nessun campione → `set_cpu_activity(cpu, fresh and found)` con `found=false` (`game/scripts/office/office.gd:1158`) → `cpu_led_active()` falso (soglia 8 %, `game/scripts/characters/agent_state_tag.gd:11`, `:59-60`) → **LED spento**. Ma un LED spento è **indistinguibile** da un agente legittimamente in attesa: non è un allarme, è un'assenza di segnale.

Sul versante log: `agent-recoveries.tsv` non riceve nulla (`:189-211`), nessun messaggio arriva al Capitano, e l'unica traccia è la riga di stderr di `start-agent.sh:1121` — che finisce nel log del watchdog solo se è stato lui a invocare (`>>"$LOG"`), altrimenti muore nella cattura di `runScript` (web) o nel pane del Capitano. **Guasto silenzioso, per definizione.**

---

## 4️⃣ Altre strade per lo stesso guscio, già presenti prima della PR

**Sì, e sono più probabili della race.** Il ramo principale (`:1101-1180`) non ha **mai** verificato che il REPL fosse partito. Ogni causa che fa uscire il CLI al boot produce lo stesso identico stato finale:

1. **CLI che esce al boot** — binario non nel PATH, credenziali assenti, crash: il pane torna bash. È il difetto documentato *dal repo stesso* a `.launcher/start-agent.sh:171-177` («col PATH rotto il pane restava un bash nudo, il singleton sopra lo rendeva DEFINITIVO») e a `.launcher/spawn-lib.sh:354-360`.
2. **Prompt TUI risposto male** — il commento a `:1129-1138` ricorda che un Enter cieco su «Bypass Permissions mode» sceglieva «No, exit» e killava claude → fantasma. Il loop detect-and-respond (`:1147-1179`) mitiga, ma se nessun pattern matcha manda comunque un **Enter cieco** a `:1177`.
3. **Ramo WSL/PowerShell** (`:1079-1100`): `sleep 2` / `sleep 8` e un Enter cieco a `:1099`, **nessun** controllo del REPL.
4. **Morte del CLI dopo il boot** (kimi crashato): il post-mortem 2026-05-18, 11 h di Capitano zombie.

### Confronto tra i tre rami di spawn — il ramo principale è il più debole

| Percorso | Crea la sessione | Verifica REPL | Su fallimento |
|---|---|---|---|
| SENTINELLA-WORKER (`start-agent.sh:133`) | `tmux new-session` nudo | ✅ `:178-190` — 12 poll da 1 s su `pane_current_command` | messaggio esplicito + `kill-session` + `exit 1` |
| DOTTORE / MANTENITORE (`spawn-doctor.sh:47`, `spawn-maintainer.sh:47`) | `tmux new-session` nudo | ✅ `jht_spawn_wait_repl` (`spawn-lib.sh:361-390`) — 12 poll, **+1 retry con `C-c` e reinvio**, evento `spawn_failed` su `<role>-actions.jsonl` | `kill-session` + return 1 |
| **Tutti gli agenti del team** (`start-agent.sh:1120`) | `timeout 20 tmux new-session` | ❌ **nessuna** | `echo` + `kill-session` (no-op nella race) + `exit 1`, poi `✓ started` mai smentito |

**Sì: il ramo speciale è nettamente più robusto del principale.** L'ironia è che i due percorsi protetti servono ruoli *ausiliari* (un pane di appoggio per `/usage`, due agenti one-shot rimpiazzati dal loro scheduler), mentre il ramo scoperto serve **Capitano, Sentinella, Scout, Scrittori e Critici** — cioè tutti quelli che producono. E la funzione che serve è **già sorgeata**: `.launcher/start-agent.sh:30` fa `source "$DEV_TEAM_DIR/spawn-lib.sh"`.

---

## 5️⃣ Fix proposto (diff testuale — NON applicato)

### 🅰️ Fix strutturale — **raccomandato**: adottare la verifica REPL nel ramo principale

```diff
--- a/.launcher/start-agent.sh
+++ b/.launcher/start-agent.sh
@@ -1127,6 +1127,20 @@
   send_env_vars
   tmux send-keys -t "$SESSION" "$FULL_CMD" C-m
+  # Il REPL e' partito DAVVERO? Finora questo ramo — l'unico che spawna gli
+  # agenti del team — era il solo a non farsi la domanda: SENTINELLA-WORKER la
+  # fa a riga 178-190, spawn-doctor/spawn-maintainer la fanno con
+  # jht_spawn_wait_repl (spawn-lib.sh:361). Senza, un pane rimasto bash (CLI
+  # crashato, PATH rotto, sessione materializzata dopo il timeout della
+  # guardia sopra) diventa DEFINITIVO: il singleton di riga 553 dichiara
+  # "already active" e nessun respawn lo ricreera' mai. Il roster non se ne
+  # accorge (team_roster.py:387 guarda solo list-sessions) e per i worker e
+  # per i CRITICO effimeri l'unica rete e' il TTL di 12h.
+  # Un guscio va segnalato e rimosso, non ereditato.
+  if [ "$CLI_BIN" != "python3" ]; then
+    jht_spawn_wait_repl "$SESSION" "$FULL_CMD" "start-agent" "$ROLE" \
+      "${JHT_HOME:-/jht_home}/logs" "start-agent.sh" || exit 1
+  fi
```

**Costi/benefici.**
✅ Chiude **tutte** le strade del §4, non solo la race; ✅ riusa una funzione già sorgeata e già in produzione su due percorsi; ✅ include il retry `C-c` + reinvio, quindi in molti casi *ripara* invece di limitarsi a fallire; ✅ scrive l'evento `spawn_failed` in `<role>-actions.jsonl`, rendendo il guasto **visibile** e correlabile; ✅ rende onesto il `✓ started` di `:1209` e il `record` del roster di `:1220`, che oggi possono certificare un guscio.
💰 Costa **1-3 s** nel percorso felice (esce appena il pane non è più una shell) e fino a ~26 s nel percorso rotto, in un processo che già dorme di suo. L'esclusione `python3` replica la condizione già usata a `:1147`.
⚠️ Verificare che il flusso resti compatibile col loop auto-Enter `setsid` di `:1147-1179` (gira in background, quindi sì) e che il retry `C-c` non arrivi mai su un dialog di trust legittimo — non può, perché in quel caso `pane_current_command` è già il CLI e la funzione ritorna 0 al primo poll.

### 🅱️ Fix puntuale sulla race — complementare, da fare comunque

```diff
--- a/.launcher/start-agent.sh
+++ b/.launcher/start-agent.sh
@@ -1120,7 +1120,26 @@
-  if ! timeout 20 tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"; then
-    echo "Error: 'tmux new-session' for '$SESSION' did not return within 20s (hung spawn)." >&2
-    # Pulizia best-effort: se tmux ha comunque registrato una sessione a
-    # meta', non lasciarla a meta' per il prossimo tentativo.
-    tmux kill-session -t "$SESSION" 2>/dev/null
-    exit 1
-  fi
+  if ! timeout -k 5 20 tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"; then
+    _rc=$?
+    if [ "$_rc" -eq 124 ] || [ "$_rc" -eq 137 ]; then
+      echo "Error: 'tmux new-session' for '$SESSION' did not return within 20s (hung spawn)." >&2
+    else
+      echo "Error: 'tmux new-session' for '$SESSION' failed (rc=$_rc)." >&2
+    fi
+    # `timeout` uccide il CLIENT tmux, non il server: la sessione puo'
+    # nascere QUALCHE SECONDO DOPO il SIGTERM. Un kill immediato sarebbe un
+    # no-op e lascerebbe un guscio (pane bash, nessuna env, nessun CLI) che il
+    # singleton di riga 553 rende permanente. Diamo al server il tempo di
+    # decidersi prima di dichiarare che non c'e' niente da pulire.
+    for _i in 1 2 3 4 5; do
+      timeout 5 tmux has-session -t "=$SESSION" 2>/dev/null && break
+      sleep 1
+    done
+    # `=` forza l'exact match: senza, il prefix matching di tmux fa colpire
+    # una sessione SORELLA quando la nostra non esiste (`-t SCOUT-1` uccide
+    # SCOUT-10, `-t CRITICO` uccide CRITICO-S3). Stessa convenzione di
+    # agent-watchdog.sh:564,586. Il `timeout` qui e' obbligatorio: senza, la
+    # pulizia puo' appendersi sullo stesso server wedged e tenere aperto il
+    # fd 9 del flock — cioe' proprio il lockout che questa guardia esiste per
+    # impedire.
+    timeout 5 tmux kill-session -t "=$SESSION" 2>/dev/null
+    exit 1
+  fi
```

**Costi/benefici.**
✅ Elimina la finestra della race (5 s di grazia coprono ampiamente lo sfasamento client/server); ✅ elimina il rischio di uccidere una sessione sorella, che oggi è **più probabile della race stessa**; ✅ chiude l'ultimo punto del ramo che può appendersi per sempre col lock in mano; ✅ smette di diagnosticare «hung spawn» per fallimenti che non sono hang (converge col fix proposto nel rischio 2, `214-2-timeout-portability.md` — **da armonizzare**: quel report propone un helper `jht_timeout`, e questo diff va riscritto sopra quell'helper, non in concorrenza).
💰 Costa fino a 5 s **solo nel percorso già fallito**. Nessun costo nel percorso felice.
⚠️ Da solo **non** basta: chiude una porta su quattro (§4). La combinazione 🅰️+🅱️ è quella che vale.

### 🅲️ Follow-up consigliato (ticket separato, non parte di questa PR)

Allineare la nozione di «vivo» del roster a quella del watchdog: `shared/skills/team_roster.py:387-395` può leggere `tmux list-panes -a -F '#{session_name} #{pane_current_command}'` — **una sola** chiamata, stesso costo di oggi — e scartare le sessioni il cui pane è una shell. È la vera rete per i worker: copre anche il caso 4 del §4 (CLI morto **dopo** il boot), che nessun fix in `start-agent.sh` potrà mai coprire. Attenzione a mantenere l'esclusione di `DOCTOR-WATCHDOG` e simili, il cui pane è legittimamente `bash`.

---

## 📋 Riepilogo verificabile

| Domanda del ticket | Risposta | Evidenza |
|---|---|---|
| Il guscio è producibile? | **Sì** | `start-agent.sh:1120-1128` + `:553-557` |
| Il lock si libera? | **Sì**, ma il `kill-session` senza timeout può ancora appendersi | `:545-551`, `:1124` |
| La workdir resta sporca? | No, tutto idempotente | `:821`, `:847`, `:862-870` |
| `is_session_alive` copre tutti? | **No**: solo i 4 core | `agent-watchdog.sh:240`, `:61`, `:702-704` |
| Gli effimeri (CRITICO) sono scoperti? | **Sì**, per design del roster; resta solo il TTL 12 h | `team_roster.py:95-100`, `:574`; `agent-watchdog.sh:303` |
| I ruoli esclusi dal filtro sono scoperti? | **Non esposti**: non passano dal ramo modificato | `spawn-doctor.sh:61`, `spawn-maintainer.sh:62`, `start-agent.sh:178-190` |
| Tempo alla mitigazione | 30 s (core) · ~30 min best-effort / 12 h garantito (worker) · di fatto mai (Critico) | `agent-watchdog.sh:59`, `:66`; `liveness-check/SKILL.md` |
| Cosa vede l'utente | **Verde ovunque**; solo il LED CPU resta spento, ma è indistinguibile da un idle | `agents/[id]/route.ts:134-138`, `list.js:24-25`, `agent_state_tag.gd:59-60` |
| Strade preesistenti allo stesso guscio | **Quattro**, tutte più probabili della race | `start-agent.sh:171-177`, `:1099`, `:1177`; post-mortem 2026-05-18 |
| Il ramo speciale è più robusto? | **Sì**, nettamente | tabella §4 |
