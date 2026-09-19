# PR #223 — Rischio 1/5: la finestra di rilevazione del pager-unstick-watchdog

**Data:** 2026-09-01 · **Branch:** `lee-launcher-fixes` · **Commit:** `11eca0aa9c` (mergiato in `9d4c23969c`)
**File sotto esame:** `.launcher/pager-unstick-watchdog.sh` (57 righe), `cli/src/commands/pid1.js:795-826`

---

## ⛔ Verdetto

**CONFERMATO, e peggio di come è stato descritto nel ticket.** `capture-pane -S -3` senza `-E`
non restringe la finestra: la **allarga**. Ispeziona **fino a 53 righe** (3 di scrollback + le
50 righe del pane), cioè **l'intero schermo più tre**. Scrivere semplicemente
`capture-pane -p` — senza nessun flag — darebbe una finestra *più piccola* (50 righe) di quella
che il codice usa oggi. Il nome della variabile `tail3` (`.launcher/pager-unstick-watchdog.sh:39`)
e il commento del commit ("scan every tmux session's **last few lines**") descrivono un
comportamento che il codice non ha.

Sommato ai **due `grep` indipendenti** sullo stesso buffer (righe 42-43), la firma effettiva non è
«il footer del pager» ma «da qualche parte in questa schermata compare `pgup/pgdn to page` **e**
da qualche altra parte compare `q to quit`». Sono condizioni che il **sorgente stesso del
watchdog** soddisfa — e il sorgente è dentro l'immagine, leggibile da ogni agente
(`Dockerfile:158`, `COPY . .`).

Conseguenza di un falso positivo: una `q` sporca lasciata nel composer di un TUI **senza nessuna
pulizia**, ripetuta **ogni 20s**, con il log che scrive `dismissed cleanly` (riga 52). Il canale
`jht-tmux-send` **non fa mai `C-u`** prima di digitare, quindi la `q` non viene mai rimossa: si
attacca in testa al messaggio successivo.

**Raccomandazione: bloccare.** Il fix è di quattro righe ed è nel §5.

> ⚠️ **Nota meta (che è anche la prova del §2):** questo documento contiene entrambi i frammenti
> cercati. Finché la finestra resta a 53 righe, **aprire questo file dentro un pane Codex è esso
> stesso un trigger del watchdog**. Con il fix proposto non lo è più.

---

## 1. Semantica di `capture-pane -S -3` senza `-E`

### Cosa dice tmux

Dal man page di `tmux(1)`, sezione `capture-pane`:

> `-S` and `-E` specify the starting and ending line numbers, zero is the first line of the
> visible pane and negative numbers are lines in the history. `-` to `-S` is the start of the
> history and to `-E` the end of the visible pane. **The default is to capture only the visible
> contents of the pane.**

Quindi, riga per riga:

| forma | start | end | righe catturate |
|---|---|---|---|
| `capture-pane -p` | 0 (prima riga visibile) | fondo del pane | `pane_height` |
| `capture-pane -p -S -3` | −3 (3 righe DENTRO lo scrollback) | **fondo del pane** (default) | `pane_height + 3` |
| `capture-pane -p -S -3 -E -1` | −3 | −1 | 3 |
| `capture-pane -p \| tail -3` | — | — | 3 |

`-S` e `-E` sono indipendenti: specificare `-S` **non** sposta `-E`. Il default di `-E` resta
"fine del pane visibile". La semantica è stabile da tmux 1.8 in poi, quindi la conclusione non
dipende dalla versione.

### Quante righe, in concreto, nel container JHT

- L'immagine è `node:22-bookworm-slim` (`Dockerfile:9`), `tmux` arriva da apt Debian bookworm
  (`Dockerfile:78`) → **tmux 3.3a**. Semantica `-S`/`-E` identica a quella sopra.
- Le sessioni agente nascono con geometria esplicita:
  `.launcher/start-agent.sh:1120` → `timeout 20 tmux new-session -d -x 220 -y 50 -s "$SESSION" …`
  Il commento a `.launcher/start-agent.sh:1101-1105` spiega perché: senza client attaccato tmux
  userebbe 80x24, e `capture-pane` restituirebbe righe troncate.

**→ `pane_height` = 50, quindi `-S -3` cattura 53 righe: 3 di storia + tutto lo schermo.**

Se lo scrollback è più corto di 3 righe (sessione appena creata) tmux parte dall'inizio della
storia e la cattura è di 50-52 righe — mai di 3.

Per completezza, la larghezza conta anche per un altro motivo: a 220 colonne il footer del pager
**non va a capo**, quindi entrambi i frammenti stanno sulla stessa riga. È il presupposto che
rende praticabile il fix del §5 (e che spiega perché la finestra larga non serviva comunque a
niente: non stava compensando un wrap).

### Il secondo moltiplicatore: due `grep` scollegati

```sh
.launcher/pager-unstick-watchdog.sh:42-43
    if printf '%s' "$tail3" | grep -q 'pgup/pgdn to page' \
      && printf '%s' "$tail3" | grep -q 'q to quit'; then
```

Due pipeline separate sullo **stesso** buffer da 53 righe. La congiunzione è a livello di *buffer*,
non di *riga*: i due frammenti possono stare a 50 righe di distanza, in ordine invertito, uno
nell'output di un comando e l'altro in un commento sorgente. Il commento alla riga 40-41
("Both footer fragments together are the pager's fixed signature — specific enough to avoid
matching normal agent chatter") descrive la specificità di un match **sulla stessa riga**, che
non è quello che il codice fa.

---

## 2. Scenari di falso positivo reali

Ricerca fatta su tutto il repo (esclusi `node_modules`) per entrambi i frammenti. Risultati grezzi:

- `pgup` / `pgdn`: **1 sola occorrenza in tutto il repo** → `.launcher/pager-unstick-watchdog.sh:42`
- `q to quit`: 4 occorrenze → `.launcher/pager-unstick-watchdog.sh:8`, `.launcher/pager-unstick-watchdog.sh:43`,
  `cli/src/commands/pid1.js:800`, `docs/internal/postmortems/2026-06-26-sentinella-capitano-relationship-live.md:27`

Il frammento raro è `pgup/pgdn to page`, ed è la chiave per ordinare gli scenari: **quasi tutti i
falsi positivi passano dal sorgente del watchdog stesso.** Il che non è una consolazione, perché
quel sorgente è dentro l'immagine e gli agenti diagnostici ci vanno dentro per mestiere.

Precondizione comune a tutti gli scenari: `Dockerfile:158` è `COPY . .`, e `.dockerignore` **non
esclude** né `.launcher/` né `docs/internal/`. Quindi `/app/.launcher/pager-unstick-watchdog.sh`
e i postmortem sono file reali e leggibili in produzione.

### 🔴 A — Il Dottore (o il Mantenitore) legge il sorgente dei watchdog — MOLTO PLAUSIBILE

Il runbook del Dottore lo manda **esplicitamente** dentro `/app/.launcher/`:

```
agents/dottore/dottore.md:75    python3 /app/.launcher/stepcap-watchdog.py --health
agents/dottore/dottore.md:80      python3 /app/.launcher/proc-kill.py stepcap-watchdog.py
```

Un Dottore che indaga «perché questa sessione non avanza» ha ottime ragioni per fare
`cat /app/.launcher/pager-unstick-watchdog.sh` o `grep -n pager /app/.launcher/*.sh`. Nel momento
in cui le righe 42-43 (adiacenti) finiscono nel pane, **entrambi** i `grep` matchano.

Ironia strutturale: la motivazione stessa della PR è che «un `cat`/`sed -n` di un file lungo apre
il pager». Quindi un Dottore che legge questo file su Codex apre davvero il pager — e il pager
mostra il file, che contiene la firma. Il watchdog manda `q`, il pager si chiude, il contenuto
resta a schermo, e al tick successivo la firma è **ancora lì**: seconda `q`, questa volta nel
composer. E poi una ogni 20s.

Con 53 righe di finestra, il match non richiede nemmeno che le due righe siano visibili insieme
in modo pulito: basta che cadano nello stesso schermo.

### 🔴 B — Il report di review stesso, e i doc di postmortem — MOLTO PLAUSIBILE

Questo file (`docs/internal/reviews/2026-09-01-lee-launcher-prs/223-1-finestra-rilevazione.md`)
contiene entrambi i frammenti, così come li conterrà qualunque doc futuro che discuta il bug.
`docs/internal/postmortems/2026-06-26-sentinella-capitano-relationship-live.md:27` contiene già
`q to quit` (gli manca solo l'altro frammento). Gli agenti leggono i doc interni; il Dottore ne
scrive.

È un anti-pattern serio: **documentare il rilevatore lo attiva.** Con una finestra a 53 righe non
c'è modo di scrivere una spiegazione del bug che non sia essa stessa un trigger.

### 🟠 C — Un agente riporta l'evidenza del pane a un peer via `jht-tmux-send` — PLAUSIBILE

Il canale fra agenti digita il testo nel pane del destinatario con
`tmux send-keys -t "$session" -l "$message"` (`agents/_skills/tmux-send/jht-tmux-send:373,389`).
Il Dottore e il Capitano hanno regola esplicita di guardare il pane prima di parlare
(`agents/dottore/dottore.md:187` «Never respawn without capture-pane first»;
`agents/capitano/capitano.pt.md:399`). Un messaggio del tipo *«SCRITTORE è fermo, il pane finisce
con `… pgup/pgdn to page · q to quit`»* fa comparire la firma nel composer del **destinatario**,
che a quel punto viene colpito dalla `q`.

Cioè: **segnalare il pager propaga il pager**. È un loop di contaminazione fra sessioni, non un
falso positivo isolato.

### 🟠 D — Un agente rilegge un file di evidenza containment — PLAUSIBILE

`.launcher/agent-watchdog.sh:564` salva l'**intero** scrollback prima di un kill:

```sh
tmux capture-pane -t "=$session" -p -S - > "$evidence"
```

in `$JHT_HOME/logs/containment/<stamp>-<session>-reenforced.txt`. Se la sessione contenuta era
davvero nel pager, quel file contiene il footer letterale. Un Dottore che apre l'evidenza per
capire cosa fosse successo si becca la `q`. Stesso meccanismo del caso B, ma su dati generati
automaticamente invece che scritti a mano.

### 🟡 E — Output di `--help` / man page di terze parti — POSSIBILE, non verificabile qui

`pgup/pgdn` è fraseologia comune nell'help di TUI e pager (`less`, `fzf`, `htop`, viewer vari).
Non ho trovato nel repo nessun tool JHT che la stampi, e non posso enumerare l'universo dei
comandi che un agente `--yolo` può lanciare. Lo cito per completezza: la finestra a 53 righe
rende plausibile che due frammenti generici di due *comandi diversi* coabitino nello stesso
schermo.

### 🟡 F — Il pane in cui il pager si è già chiuso da solo — POSSIBILE

Il pager Codex, una volta chiuso, lascia il contenuto nello scrollback/schermo. Se il footer era
vicino al fondo, resta nella finestra da 53 righe anche **dopo** la chiusura legittima. La `q`
successiva è un falso positivo puro su una sessione che il watchdog ha appena curato — cioè il
watchdog re-innesca sé stesso sul proprio successo. È lo stesso difetto che
`.launcher/stepcap-watchdog.py:20-24` documenta ed evita esplicitamente:

> «Il marcatore resta nello scrollback anche dopo la ripresa: trovarlo non basta, e senza il
> controllo sull'hash questo watchdog diventa un generatore di nudge a raffica su un agente che
> sta lavorando.»

Il pager-unstick-watchdog ripete alla lettera l'errore che stepcap aveva già pagato e corretto.

**Ordinamento finale per plausibilità:** A ≈ B > C ≈ D > F > E.

---

## 3. Conseguenza esatta di un falso positivo

```sh
.launcher/pager-unstick-watchdog.sh:45    tmux send-keys -t "$s" q
```

Nessun `-l`: tmux risolve prima l'argomento come nome di tasto, ma `q` non è un nome di tasto
noto, quindi viene inviato come **carattere letterale `q`**. Non c'è `Enter`. Il target è la
sessione, quindi il pane attivo della finestra corrente.

I tre CLI supportati (`.launcher/start-agent.sh:639-700`) girano **tutti** in TUI interattiva, e
il watchdog li scandisce **tutti** senza distinzione di provider (`tmux list-sessions` alla riga 37):

| provider | comando | riga |
|---|---|---|
| Claude | `claude --dangerously-skip-permissions --effort … --model …` | `start-agent.sh:645-647` |
| Codex | `codex --yolo --model … -c model_reasoning_effort=…` | `start-agent.sh:662,672` |
| Kimi | `kimi --yolo --max-steps-per-turn 100 …` | `start-agent.sh:679` |

Il pager fullscreen è una feature **del solo TUI Codex** (lo dice l'header del watchdog, righe
2-12). Su Claude e Kimi il watchdog non può mai avere ragione — può solo avere torto.

### Cosa succede davvero, in ordine di gravità

**1. La `q` finisce nel composer e ci resta.** In tutti e tre i TUI, un carattere digitato a
prompt libero va nel box di input. Senza `Enter` non parte nulla: il composer contiene `q`.

**2. Nessuno la pulisce mai.** Ho verificato il canale di consegna: `jht-tmux-send`
(`agents/_skills/tmux-send/jht-tmux-send`) **non manda mai `C-u`** — nessuna occorrenza nel file.
Digita direttamente con `send-keys -l "$message"` (righe 373, 389). Quindi il messaggio successivo
diventa `q<messaggio>`.

**3. La verifica di consegna non se ne accorge.** Il controllo è
`case "$pane" in *"$signature_tail"*|*"$signature_head"*` (righe 376-380): una *substring*. La `q`
in testa non impedisce il match, quindi `jht-tmux-send` **conferma la consegna** e manda `Enter`.
L'agente riceve `q[FROM @SYSTEM TO @SCOUT] …`. Nella maggior parte dei casi è rumore innocuo; se
il messaggio fosse uno slash-command (`/clear`, `/compact` — citati in
`docs/internal/architecture/context-watchdog-spec.md:231`), `q/clear` **non è più un comando** e
viene inviato come prosa. La cura si trasforma in una battuta.

**4. Il log mente.** Sul falso positivo, la seconda `capture-pane` (riga 47) non trova
`Conversation interrupted`, quindi si prende il ramo `else` (righe 51-53) e il log scrive
`session $s: dismissed cleanly, no resume needed`. Non c'è nessun controllo che il pager esistesse
davvero, né che la `q` abbia cambiato qualcosa. **Ogni falso positivo viene registrato come
successo.** Per un operatore che legge `pager-unstick-watchdog.log` non c'è modo di distinguere
54 dismissal reali da 54 `q` sparate nel vuoto.

**5. Si ripete ogni 20 secondi.** Non c'è né cooldown per sessione (che
`.launcher/codex-auth-healer.sh:38,150-158` ha, `COOLDOWN=300` + state file per agente) né
verifica su due tick. Se il testo che innesca il match resta a schermo — e nel caso A resta,
perché è il file che l'agente sta leggendo — il composer accumula `q` a **3 al minuto**: 30 in
dieci minuti, 180 in un'ora. A quel punto la stringa `qqqqq…q<messaggio>` supera in lunghezza il
messaggio e il `signature_head` può finire fuori dalla riga renderizzata → `jht-tmux-send` esce
con `exit 5` («vivo ma muto», riga 452) e il chiamante inizia a ritentare.

**Riassunto:** un falso positivo non uccide la sessione, la **avvelena silenziosamente** e si
auto-alimenta. Il costo peggiore non è la `q`, è che il watchdog dichiara successo mentre lo fa.

*(Adiacente, fuori dal mio rischio ma da segnalare: il ramo `Conversation interrupted` alla riga
49 manda una nudge LLM senza controllare `.team-halted.flag` / `.weekly-halt.flag` / standby, gate
che `codex-auth-healer.sh:145-149` e `stepcap-watchdog.py` rispettano entrambi. Un tick durante un
halt è spesa non autorizzata.)*

---

## 4. Il footer cercato è la firma giusta?

**No, non nella forma attuale.** Tre problemi distinti.

### 4a. Specificità: giusta l'idea, sbagliato l'ancoraggio

`pgup/pgdn to page` è, da solo, un frammento eccellente: **una sola occorrenza in tutto il repo**,
e non è fraseologia che un LLM produce spontaneamente. Il problema non è la stringa, è che
l'`AND` è valutato su 53 righe invece che su una. La firma reale del footer Codex è una
**singola riga di stato** del tipo `↑/↓ scroll · pgup/pgdn to page · q to quit`; a 220 colonne non
va a capo. Cercarla come riga singola è sia più fedele sia molto più specifico.

### 4b. Fragilità: nessun fallback, nessun rilevamento della deriva

- **Larghezza:** oggi 220 colonne fissate a `start-agent.sh:1120`, quindi niente wrap. Ma è un
  accoppiamento implicito e non documentato: se qualcuno abbassasse `-x`, il footer andrebbe a
  capo e la firma su riga singola smetterebbe di matchare (silenziosamente).
- **Versione Codex:** il footer è testo di un TUI di terze parti che non controlliamo. Una
  riscrittura upstream lo rompe senza rumore — il watchdog diventerebbe inerte e nessuno se ne
  accorgerebbe, esattamente come descritto in `.launcher/stepcap-watchdog.py:146-158` per la
  tabella `STEP_CAP_MARKERS` («il watchdog era inerte su tutte le VPS che non girano su Kimi …
  l'heartbeat riportava `stalled: 0` per sempre»).
- **Lingua:** il TUI Codex è oggi solo in inglese, quindi non è un rischio attuale. Ma la stringa
  è cablata nel sorgente, senza il meccanismo di estensione a caldo che stepcap ha
  (`stepcap-markers.txt` + `JHT_STEPCAP_MARKERS`, `.launcher/stepcap-watchdog.py:159,344-352`).

### 4c. Le convenzioni del repo che questa PR non segue

Il repo ha già **quattro** rilevatori di stringhe TUI, e tutti fanno cose che questo non fa:

| rilevatore | finestra | ancoraggio | conferma | cooldown |
|---|---|---|---|---|
| `codex-auth-healer.sh:161` | `capture-pane -p \| tail -25` | regex alternata, riga 42 | — | 300s + state file per agente (righe 38, 150-158) |
| `stepcap-watchdog.py:324,357-367` | `capture-pane -p`, ultime 40 righe **non vuote** | marcatore nelle ultime 10 non vuote (`MARKER_TAIL_LINES`, riga 111) | hash del pane **identico al giro prima** | escalation con backoff, righe 92-98 |
| `start-agent.sh:1154-1174` | `capture-pane -p -S -40` | frasi ancorate + `grep -qE` | loop 60×2s con exit al primo match | one-shot per spawn |
| `jht-tmux-send:264-289` (`_pane_busy`) | pane intero | marcatore + **euristiche anti-prosa** | — | — |

`_pane_busy` è lo standard aureo del repo: trova `esc to interrupt`, poi **scarta** il match se la
frase è fra virgolette (riga 275-277, «citata → prosa») o se è seguita da più di 40 caratteri di
testo (riga 282-284, «la frase è seguita da un discorso → prosa»). È esattamente la difesa contro
lo scenario B/C che al pager-unstick-watchdog manca del tutto.

E `.launcher/tui-helpers.sh:10-14` mette per iscritto la filosofia:

> «Invece di cercare marker hardcoded nei banner (`"OpenAI Codex"`, `"Welcome to Claude"`…) —
> fragili a ogni update del CLI che aggiunge un tip o un banner — aspettiamo che il pane sia
> identico a sé stesso per N secondi.»

La PR #223 non è allineata a nessuna di queste convenzioni: finestra più larga del default,
nessun ancoraggio di riga, nessuna conferma su due tick, nessun cooldown, nessun gate di halt,
nessun test (`git show --stat 11eca0aa9c` → 2 file, 94 righe aggiunte, **zero test**).

---

## 5. Proposta di fix (diff testuale — NON applicato)

Quattro cambi, in ordine di rapporto valore/rischio.

```diff
--- a/.launcher/pager-unstick-watchdog.sh
+++ b/.launcher/pager-unstick-watchdog.sh
@@
 INTERVAL_SEC="${JHT_PAGER_WATCHDOG_INTERVAL:-20}"
+# Il footer del pager e' UNA riga di stato in fondo a uno schermo che il pager
+# occupa tutto: cercarlo oltre le ultime righe non vuote non aggiunge
+# rilevazione, aggiunge solo superficie per i falsi positivi. `capture-pane -p`
+# senza flag da' gia' il pane visibile (50 righe, -y 50 in start-agent.sh:1120);
+# il `tail` e' la convenzione del repo (codex-auth-healer.sh:161).
+FOOTER_TAIL_LINES="${JHT_PAGER_WATCHDOG_TAIL:-3}"
+# I due frammenti sulla STESSA riga. Separati da un AND su tutto il buffer
+# matchavano il sorgente di questo file, i postmortem e qualunque messaggio fra
+# agenti che citasse il footer.
+FOOTER_RE='pgup/pgdn to page.*q to quit'
+
+# Ultime N righe NON VUOTE del pane visibile (righe vuote scartate prima:
+# stessa logica di stepcap-watchdog.py:357-364).
+pane_footer() {
+  tmux capture-pane -t "$1" -p 2>/dev/null | grep -v '^[[:space:]]*$' \
+    | tail -"$FOOTER_TAIL_LINES"
+}
+
+# Il pager fullscreen e' una feature del SOLO TUI Codex (vedi header). Su un
+# pane claude/kimi il watchdog non puo' avere ragione, puo' solo avere torto.
+is_codex_pane() {
+  [ "$(tmux list-panes -t "$1" -F '#{pane_current_command}' 2>/dev/null | head -1)" = "codex" ]
+}
+
 log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }

 log "pager-unstick-watchdog up — interval=${INTERVAL_SEC}s"

+# Sessioni che al giro PRECEDENTE mostravano il footer. Un pager aperto e'
+# statico e sopravvive a un tick; un footer di passaggio (l'agente sta leggendo
+# un file che lo cita, un peer glielo ha appena scritto nel composer) no.
+# Stessa difesa di stepcap-watchdog.py:20-24, dove il marcatore rimasto nello
+# scrollback aveva gia' prodotto nudge a raffica.
+armed=""
+
 while true; do
+  next_armed=""
   sessions=$(tmux list-sessions -F '#{session_name}' 2>/dev/null || true)
   for s in $sessions; do
-    tail3=$(tmux capture-pane -t "$s" -p -S -3 2>/dev/null || true)
-    # Both footer fragments together are the pager's fixed signature —
-    # specific enough to avoid matching normal agent chatter.
-    if printf '%s' "$tail3" | grep -q 'pgup/pgdn to page' \
-      && printf '%s' "$tail3" | grep -q 'q to quit'; then
-      log "session $s: stuck in pager, dismissing"
-      tmux send-keys -t "$s" q
-      sleep 1
-      after=$(tmux capture-pane -t "$s" -p -S -3 2>/dev/null || true)
-      if printf '%s' "$after" | grep -q 'Conversation interrupted'; then
-        jht-tmux-send "$s" "Continue where you left off." >>"$LOG" 2>&1 || true
-        log "session $s: dismissal interrupted the turn, sent resume nudge"
-      else
-        log "session $s: dismissed cleanly, no resume needed"
-      fi
+    is_codex_pane "$s" || continue
+    if ! pane_footer "$s" | grep -q "$FOOTER_RE"; then
+      continue
+    fi
+    # Primo avvistamento: si arma e basta. Si agisce al secondo consecutivo.
+    case " $armed " in
+      *" $s "*) ;;
+      *) next_armed="$next_armed $s"
+         log "session $s: pager footer seen, arming (confirm next tick)"
+         continue ;;
+    esac
+    log "session $s: pager confirmed on two consecutive ticks, dismissing"
+    tmux send-keys -t "$s" q
+    sleep 1
+    if pane_footer "$s" | grep -q "$FOOTER_RE"; then
+      # La `q` non ha chiuso niente: NON e' un pager. Non insistere e non
+      # dichiarare successo — il log deve poter distinguere i due esiti.
+      log "session $s: WARNING footer still present after q — not a pager, backing off"
+      next_armed="$next_armed $s"
+      continue
+    fi
+    after=$(tmux capture-pane -t "$s" -p 2>/dev/null | tail -"$FOOTER_TAIL_LINES")
+    if printf '%s' "$after" | grep -q 'Conversation interrupted'; then
+      jht-tmux-send "$s" "Continue where you left off." >>"$LOG" 2>&1 || true
+      log "session $s: dismissal interrupted the turn, sent resume nudge"
+    else
+      log "session $s: dismissed cleanly, no resume needed"
     fi
   done
+  armed="$next_armed"
   sleep "$INTERVAL_SEC"
 done
```

### Motivazione delle quattro scelte

1. **`capture-pane -p | grep -v vuote | tail -3`** — è la convenzione del repo
   (`codex-auth-healer.sh:161` usa `| tail -25`; `stepcap-watchdog.py:357-364` scarta le righe
   vuote prima di guardare). Passa da 53 righe a 3 righe reali: **~94% di superficie in meno**.
   Da sola questa riga elimina gli scenari A, B, C e D, perché in un TUI *non* in pager le ultime
   righe non vuote sono sempre il chrome (composer + status line), mai il contenuto letto
   dall'agente. Lo scarto delle righe vuote è necessario: `capture-pane` emette le righe di
   padding in fondo al pane, e un `tail -3` crudo rischierebbe di prenderne tre vuote.

2. **Frammenti sulla stessa riga (`FOOTER_RE`)** — è la firma vera del footer, che a 220 colonne
   non va a capo (`start-agent.sh:1120`). Chiude il buco strutturale dell'`AND` su buffer. Ho
   preferito la regex con `.*` a un match esatto della riga intera perché il separatore centrale
   (`·`, spaziatura, eventuali token aggiuntivi) è la parte del footer che più probabilmente
   cambia fra versioni di Codex: ancorarsi ai due estremi è il compromesso giusto fra specificità
   e resistenza alla deriva.

3. **Conferma su due tick consecutivi** — è la stessa difesa che `stepcap-watchdog.py:20-24` ha
   dovuto aggiungere dopo essersi bruciato sullo stesso identico problema. Un pager aperto è
   statico per definizione e sopravvive a 20 secondi; un footer di passaggio (agente che scrolla,
   messaggio appena digitato da un peer) no. Costa al massimo 20s di latenza aggiuntiva su un
   blocco che oggi dura all'infinito: irrilevante. Ho scelto la conferma su due tick invece
   dell'hash del pane perché il pager Codex ridisegna (cursore, indicatore di posizione) e un
   confronto di hash sarebbe fragile in senso opposto — inerte.

4. **Gate `pane_current_command = codex`** — il pager è una feature del solo TUI Codex, e
   `tmux list-panes -F '#{pane_current_command}'` è già la tecnica usata da
   `.launcher/tui-helpers.sh:40-48` (`_tui_is_shell_pane`). Azzera i falsi positivi su Claude e
   Kimi *a prescindere* da qualunque testo compaia nel loro pane. È il singolo cambio con il
   miglior rapporto righe/rischio-eliminato.

**Bonus incluso nel diff — il log smette di mentire.** La ri-verifica dopo la `q` (`if pane_footer
… still present`) distingue «pager chiuso» da «`q` sparata a vuoto», e nel secondo caso logga un
`WARNING` invece di `dismissed cleanly`. Senza questo, nessun operatore può misurare sul campo
se il watchdog sta funzionando.

**Non incluso, da valutare a parte** (fuori dal rischio 1, ma andrebbero risolti prima del
merge): il cooldown per sessione sul modello di `codex-auth-healer.sh:38,150-158`, e i gate
`.team-halted.flag` / `.weekly-halt.flag` / standby prima della nudge LLM di riga 49.

---

## 6. Test proposto

Convenzione: pytest source-asserting come `tests/test_spawn_stagger.py:327-341` (che legge
`.launcher/start-agent.sh` e fa asserzioni sul testo) più le seam funzionali di
`tests/test_stepcap_watchdog.py`. Lo script è bash puro, quindi l'unità testabile senza tmux è la
**decisione di match**: la si esercita estraendo `FOOTER_RE` dal sorgente e dandola in pasto a
`grep` su pane sintetici. Questo tiene fermo il contratto senza dover avviare nessuna sessione.

Nuovo file: `tests/test_pager_unstick_watchdog.py`

```python
"""Test del watchdog che dismette il pager fullscreen del TUI Codex.

Cosa questa suite tiene fermo:

  1. la finestra di rilevazione e' le ultime N righe NON VUOTE del pane
     visibile, non `-S -3` (che senza `-E` cattura schermo + 3 righe: con
     `-y 50` in start-agent.sh sono 53, cioe' l'intero schermo);
  2. i due frammenti del footer devono stare sulla STESSA riga — separati,
     matchavano il sorgente di questo watchdog, i postmortem e i messaggi fra
     agenti che citano il footer;
  3. il sorgente del watchdog, letto dentro un pane, NON e' un trigger
     (regressione diretta del difetto: il file e' in immagine, `COPY . .`);
  4. si agisce solo alla conferma sul secondo tick consecutivo;
  5. solo sui pane Codex — il pager non esiste su Claude/Kimi.

Eseguire:
    pytest tests/test_pager_unstick_watchdog.py -v
"""

import re
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
WATCHDOG = REPO_ROOT / ".launcher" / "pager-unstick-watchdog.sh"
START_AGENT = REPO_ROOT / ".launcher" / "start-agent.sh"

PAGER_FOOTER = "  ↑/↓ scroll · pgup/pgdn to page · q to quit"


@pytest.fixture(scope="module")
def src():
    return WATCHDOG.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def footer_re(src):
    """La regex vive nel sorgente: il test la legge da li', cosi' non puo'
    divergere dal codice che gira."""
    m = re.search(r"^FOOTER_RE='([^']+)'", src, re.M)
    assert m, "FOOTER_RE non trovata nel sorgente"
    return m.group(1)


def _matches(footer_re: str, pane: str, tail: int = 3) -> bool:
    """Riproduce la pipeline del watchdog: righe non vuote, ultime N, grep."""
    lines = [ln for ln in pane.splitlines() if ln.strip()][-tail:]
    return subprocess.run(
        ["grep", "-q", footer_re], input="\n".join(lines) + "\n",
        text=True,
    ).returncode == 0


# ── 1. La finestra ────────────────────────────────────────────────────────

def test_no_scrollback_capture(src):
    """`-S -3` senza `-E` NON e' «le ultime 3 righe»: e' schermo + 3. Con
    `-y 50` (start-agent.sh) sono 53 righe, piu' del default nudo."""
    assert "-S -3" not in src
    assert "capture-pane" in src


def test_window_is_a_tail_of_nonempty_lines(src):
    """Convenzione del repo: `capture-pane -p | tail -N`
    (codex-auth-healer.sh:161), righe vuote scartate (stepcap-watchdog.py)."""
    assert "tail -" in src
    assert "grep -v '^[[:space:]]*$'" in src


def test_the_pane_is_fifty_lines_tall():
    """Il numero da cui dipende tutto il ragionamento sulla finestra."""
    assert "-y 50" in START_AGENT.read_text(encoding="utf-8")


# ── 2. La firma ───────────────────────────────────────────────────────────

def test_fragments_must_share_a_line(footer_re):
    assert "pgup/pgdn to page" in footer_re
    assert "q to quit" in footer_re


def test_real_footer_matches(footer_re):
    assert _matches(footer_re, "\n".join(["riga di contenuto"] * 40
                                         + [PAGER_FOOTER]))


def test_fragments_on_separate_lines_do_not_match(footer_re):
    """Il difetto originale: due grep indipendenti sullo stesso buffer."""
    pane = "… pgup/pgdn to page …\n" + "x\n" * 20 + "… q to quit …\n"
    assert not _matches(footer_re, pane)


# ── 3. Il sorgente del watchdog non e' un trigger ────────────────────────

def test_reading_this_watchdog_source_is_not_a_trigger(footer_re, src):
    """`COPY . .` (Dockerfile) mette questo file in immagine e il Dottore ci
    entra per mestiere (dottore.md:75). Cat-arlo non deve mandare `q`."""
    assert not _matches(footer_re, src)


def test_a_doc_quoting_the_footer_is_not_a_trigger(footer_re):
    """Documentare il rilevatore non deve attivarlo (postmortem, review,
    messaggi fra agenti via jht-tmux-send)."""
    pane = (
        "> il pane finisce con `↑/↓ scroll · pgup/pgdn to page · q to quit`\n"
        "\n"
        "╭─ composer ─────────────────────────────────╮\n"
        "│ > _                                        │\n"
        "╰────────────────────────────────────────────╯\n"
    )
    assert not _matches(footer_re, pane)


# ── 4/5. Conferma e provider ─────────────────────────────────────────────

def test_requires_two_consecutive_ticks(src):
    """Un footer di passaggio non sopravvive a un tick; un pager si."""
    assert "armed" in src
    assert "confirm next tick" in src


def test_only_codex_panes(src):
    """Il pager e' una feature del solo TUI Codex: su claude/kimi il watchdog
    puo' solo avere torto."""
    assert "pane_current_command" in src
    assert "codex" in src


def test_log_distinguishes_a_failed_dismissal(src):
    """Oggi ogni falso positivo finisce a log come `dismissed cleanly`."""
    assert "still present after q" in src
```

Nota sulla policy di esecuzione: la suite è a I/O nullo (legge due file, non tocca tmux né
docker), quindi eseguibile anche su host Windows senza violare il vincolo «solo i test dei file
toccati».

---

## Riferimenti raccolti

| tema | riferimento |
|---|---|
| codice sotto esame | `.launcher/pager-unstick-watchdog.sh:39,42-43,45,47-53` |
| spawn del watchdog | `cli/src/commands/pid1.js:795-826` |
| geometria del pane (50 righe) | `.launcher/start-agent.sh:1101-1105,1120` |
| tmux 3.3a in immagine | `Dockerfile:9,78` |
| tutto il repo in immagine | `Dockerfile:158` (`COPY . .`), `.dockerignore` (no `.launcher/`, no `docs/internal/`) |
| convenzione `tail -N` + cooldown | `.launcher/codex-auth-healer.sh:38,42,150-158,161` |
| convenzione righe non vuote + conferma | `.launcher/stepcap-watchdog.py:20-24,111,146-158,324,357-367` |
| convenzione anti-prosa | `agents/_skills/tmux-send/jht-tmux-send:264-289` |
| nessun `C-u`, verifica per substring | `agents/_skills/tmux-send/jht-tmux-send:373,376-380,389,452` |
| filosofia anti-marker-hardcoded | `.launcher/tui-helpers.sh:10-14,40-48` |
| detect-and-respond dei prompt Claude | `.launcher/start-agent.sh:1131-1174` |
| tre CLI supportati | `.launcher/start-agent.sh:639-700` |
| il Dottore entra in `/app/.launcher/` | `agents/dottore/dottore.md:75,80,187` |
| evidenza containment (scrollback intero) | `.launcher/agent-watchdog.sh:557-570` |
| `q to quit` già nei doc | `docs/internal/postmortems/2026-06-26-sentinella-capitano-relationship-live.md:27`, `cli/src/commands/pid1.js:800` |
| zero test nella PR | `git show --stat 11eca0aa9c` → 2 file, +94 righe |
