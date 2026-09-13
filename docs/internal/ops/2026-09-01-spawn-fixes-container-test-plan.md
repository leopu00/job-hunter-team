# Piano di test su team vivo — batch di fix allo spawn degli agenti

> **Stato del batch:** in verifica · **Branch:** `lee-launcher-fixes` · **Apertura:** 2026-09-01
>
> Questo file è un **tracciamento vivo**: si compila mentre si esegue. Un test senza
> esito scritto qui conta come non eseguito. Se un test fallisce si scrive *cosa* si è
> visto, non «da rifare».

## Perché serve un test su container vivo

Le suite pytest di questo batch asseriscono sul **sorgente** degli script shell: tengono
ferma la forma del codice, non il comportamento del sistema. Nessuna di esse avvia tmux,
crea una sessione o osserva un lock. I difetti che stiamo correggendo si manifestano
tutti in condizioni che il test statico non può riprodurre:

- un file descriptor ereditato da un processo che sopravvive allo script,
- una risoluzione di target tmux che sceglie la sessione sbagliata,
- un contatore che deve salire per N tentativi consecutivi e poi scendere,
- un tetto di tempo che deve scattare su un filesystem lento.

Cioè: **il verde delle suite è condizione necessaria e non sufficiente.** Da qui in giù
si verifica il comportamento.

---

## 0. Preparazione

### 0.1 Cosa si sta testando

| # | Fix | Commit | Suite statica |
|---|---|---|---|
| F1 | fd 9 del lock chiuso nei figli tmux e nel server | `5ca0adfc2e` | `test_start_agent_spawn_lock_fd.py` |
| F2 | `jht_timeout` portabile (degrada, non muore) | `9dd5ee7db5` | `test_start_agent_spawn_timeout_portability.py` |
| F3 | budget 45s / `flock -w` 75s, con override | `788eb498a6` | `test_start_agent_spawn_budgets_and_liveness.py` |
| F4 | target tmux ancorati con `=` | `7f77893ac7` | idem |
| F5 | rc discriminato, cleanup non distruttivo | `e21fca08ab` | `test_start_agent_spawn_error_diagnostics.py` |
| F6 | verifica che il REPL sia partito | `b1ba13a083` | `test_start_agent_spawn_budgets_and_liveness.py` |
| F7 | misura dei fallimenti di spawn + escalation | `396898bc6e`…`d32ed2b44d` | `test_agent_watchdog_spawn_failure_escalation.py` |
| F8 | cooldown di `bridge_escalate` per chiave | `04ede359d1` | idem |
| F9 | tetto sul `has-session` del guard di idempotenza | *in corso* | — |
| F10 | tetto sullo spawn Dottore/Mantenitore + log a due scrittori | *in corso* | — |
| — | PR #214 (contributor) — `timeout` sulla `new-session` | `0673592ca4` | coperta da F2/F3/F5 |
| — | PR #223 (contributor) — watchdog del pager | `9d4c23969c` | **⚠️ vedi §4: non testare, va rilavorata** |

### 0.2 Precauzioni prima di partire

- **Il compose di root va lanciato da PowerShell o git-bash di Windows, non da WSL.**
  Da WSL `${HOME}` diventa `/home/ubuntu` e i bind mount `.jht` e `Documents/JHT`
  puntano a directory vuote: si finisce a testare un impianto senza profilo.
- **Dopo un rebuild dell'immagine serve `docker rm -f jht`** prima di riavviare,
  altrimenti resta in piedi il container vecchio e si testa il codice sbagliato.
- **Non cancellare `agents/`, `profile/`, gli allegati o `jobs.db`.** Nessun test qui
  sotto lo richiede. Se un test sembra richiederlo, è scritto male.
- **Un solo metodo pesante alla volta.** Non impilare `next build`, `next dev` e il
  container: su questa macchina l'I/O è il collo di bottiglia.
- Prendere nota della **data/ora di inizio**: diversi test confrontano l'età dei
  processi con il momento dell'avvio del container.

### 0.3 Snapshot dello stato «prima»

Da eseguire **prima** di far partire il team, per avere un termine di paragone:

```sh
docker exec jht sh -c 'ls -la /jht_home/locks/ 2>/dev/null | head -40'
docker exec jht sh -c 'wc -l < /jht_home/logs/agent-watchdog.log 2>/dev/null'
docker exec jht sh -c 'grep -c "start FAILED" /jht_home/logs/agent-watchdog.log 2>/dev/null'
```

Esito atteso: possono esistere file `start-*.lock.stale-tmux-server-*` da incidenti
passati — **non cancellarli**, sono l'evidenza storica del difetto F1.

---

## 1. Test decisivi (bloccanti per il merge su `master`)

### T1 — Il server tmux non eredita più il lock

> Verifica F1. È **il** test di questo batch: chiude il difetto che ha tenuto un agente
> irrecuperabile per 37 ore e che sulla VPS di produzione era ancora attivo dopo 11 giorni.

**Come:** avviare il container e il team da zero, attendere che almeno un agente sia su,
poi cercare chi tiene un fd su un lock di spawn.

```sh
docker exec jht sh -c '
now=$(date +%s); found=0
for p in /proc/[0-9]*; do
  [ -d "$p/fd" ] || continue
  for f in "$p"/fd/*; do
    t=$(readlink "$f" 2>/dev/null) || continue
    case "$t" in */locks/start-*)
      found=1
      printf "pid=%s  name=%s  age=%ss\n   fd -> %s\n" "${p#/proc/}" \
        "$(sed -n "s/^Name:\t//p" "$p/status")" \
        "$(( now - $(stat -c %Y "$p") ))" "$t" ;;
    esac
  done
done
[ "$found" = 1 ] || echo "PASS: nessun processo tiene un fd su locks/start-*"'
```

**Passa se:** l'output è la riga `PASS`.
**Fallisce se:** compare un processo — e in particolare uno con `Name: tmux: server`,
che è il difetto originale non chiuso.

**Esito:** _(da compilare)_

---

### T2 — Il lock si libera subito dopo uno spawn riuscito

> Verifica F1 dal lato osservabile. Prima del fix, per i ruoli `assistente`, `capitano` e
> `mentor` il lock restava preso fino a ~270s dal welcome watchdog; e per la prima
> sessione della vita del container, per sempre.

**Come:** spawnare l'ASSISTENTE, poi sondare il suo lock a intervalli. La sonda è in sola
lettura (apre in lettura e chiede un lock condiviso: non modifica il file e non lo tiene).

```sh
probe() { docker exec jht sh -c '
  l=/jht_home/locks/start-ASSISTENTE.lock
  [ -e "$l" ] || { echo "ASSENTE"; exit 0; }
  if ( exec 9<"$l"; flock -n -s 9 ) 2>/dev/null; then echo FREE; else echo HELD; fi'; }
# subito dopo lo spawn:
for d in 10 60 150 300; do sleep "$d"; printf "+%ss -> " "$d"; probe; done
```

**Passa se:** `FREE` a ogni rilevazione, compresa quella a +10s.
**Fallisce se:** `HELD` a +150s o oltre → un figlio detached tiene ancora il fd.

**Esito:** _(da compilare)_

---

### T3 — Un agente si può riaccendere subito dopo essere partito

> Il sintomo che l'utente vede. Prima del fix, un respawn nella finestra di 270s
> moriva con `timed out waiting for the concurrent spawn`.

**Come:** appena l'ASSISTENTE è su, ucciderne la sessione e chiederne il respawn entro
un minuto.

```sh
docker exec jht tmux kill-session -t '=ASSISTENTE'
docker exec jht bash /app/.launcher/start-agent.sh assistente; echo "rc=$?"
docker exec jht tmux has-session -t '=ASSISTENTE' && echo "sessione presente"
```

**Passa se:** `rc=0`, la sessione esiste e nel pane parte il CLI (non una bash nuda).
**Fallisce se:** compare `concurrent spawn`, oppure `rc=0` ma il pane resta `bash`
(quello sarebbe un fallimento di F6, non di F1 — annotare quale dei due).

**Esito:** _(da compilare)_

---

### T4 — Nessuna regressione sul percorso felice

> Il rischio di questo batch è di aver reso più fragile ciò che funzionava. F3 alza i
> tetti (nessuno spawn sano dovrebbe accorgersene) e F6 aggiunge un'attesa.

**Come:** avvio pulito del team completo, misurando.

```sh
docker exec jht sh -c 'time bash /app/.launcher/start-agent.sh scout 1'
docker exec jht tmux list-sessions -F '#{session_name}'
docker exec jht sh -c 'for s in $(tmux list-sessions -F "#{session_name}"); do \
  printf "%-16s %s\n" "$s" "$(tmux list-panes -t "=$s" -F "#{pane_current_command}" | head -1)"; done'
```

**Passa se:** tutte le sessioni attese sono presenti, **nessun pane è `bash`**, e il
tempo di un singolo spawn è nell'ordine dei secondi (F6 aggiunge ~1s, non minuti).
**Fallisce se:** uno spawn sano ora impiega decine di secondi → F6 sta pollando troppo,
oppure `jht_spawn_wait_repl` non riconosce il comando del pane.

**Esito:** _(da compilare)_

---

## 2. Test dei difetti indotti (serve provocare il guasto)

### T5 — `duplicate session` non uccide più la sessione di un altro

> Verifica F5. Prima, un secondo tentativo sullo stesso nome produceva un messaggio che
> accusava un hang inesistente **e** un `kill-session` che ammazzava la sessione viva
> creata dal primo.

**Come:** con l'ASSISTENTE già su e funzionante, forzare un secondo spawn saltando il
lock (il lock lo serializzerebbe e il guard di idempotenza uscirebbe 0 prima del punto
che ci interessa). Il modo più pulito è invocare direttamente la `new-session` con un
nome già esistente e leggere il ramo d'errore:

```sh
docker exec jht sh -c 'tmux new-session -d -s ASSISTENTE -c /tmp; echo "rc=$?"'
docker exec jht tmux has-session -t '=ASSISTENTE' && echo "la sessione originale e ancora viva"
```

Poi verificare il messaggio prodotto dal launcher su un nome di sessione occupato,
leggendo `agent-watchdog.log` dopo un tentativo di respawn concorrente reale.

**Passa se:** il messaggio nomina l'`rc` e riporta la diagnosi di tmux, **non** dice
«did not return within 45s», e la sessione originale **sopravvive**.
**Fallisce se:** il messaggio parla di hang, o la sessione originale muore.

**Esito:** _(da compilare)_

---

### T6 — Il prefix match non fa più sparire un agente

> Verifica F4. È il difetto registrato in produzione dal Dottore: `has-session -t
> SENTINELLA` trovava `SENTINELLA-WORKER`, il guard dichiarava «già attiva» e la
> SENTINELLA non nasceva mai.

**Come:** creare il worker **senza** che la SENTINELLA esista, poi chiedere lo spawn
della SENTINELLA.

```sh
docker exec jht tmux kill-session -t '=SENTINELLA' 2>/dev/null
docker exec jht bash /app/.launcher/start-agent.sh worker      # crea SENTINELLA-WORKER
docker exec jht tmux list-sessions -F '#{session_name}' | grep SENTINELLA
docker exec jht bash /app/.launcher/start-agent.sh sentinella; echo "rc=$?"
docker exec jht tmux has-session -t '=SENTINELLA' && echo "PASS: SENTINELLA creata"
```

**Passa se:** la SENTINELLA viene creata davvero.
**Fallisce se:** il launcher stampa «already active» senza creare nulla → l'ancoraggio
non è arrivato su quel punto.

⚠️ Ripristinare lo stato del worker dopo il test (il bridge lo usa per leggere `/usage`).

**Esito:** _(da compilare)_

---

### T7 — Un CLI che non parte viene segnalato, non ereditato

> Verifica F6. Prima, un pane rimasto bash veniva certificato come «✓ started» e il
> guard di idempotenza lo rendeva permanente.

**Come:** rompere deliberatamente la risoluzione del CLI per un solo worker, senza
toccare la configurazione degli altri. Un modo non distruttivo è spawnare con un `PATH`
mutilato via env, oppure puntare temporaneamente il provider a un binario inesistente
**per quella singola invocazione**.

**Passa se:** lo spawn esce **non-zero**, viene scritto un evento `spawn_failed`, e
**nessuna sessione guscio resta in piedi** (o, se resta, il tentativo successivo la
ricrea invece di dichiararla attiva).
**Fallisce se:** lo spawn esce 0 con un pane `bash`.

**Esito:** _(da compilare)_

---

### T8 — I fallimenti di spawn ora si contano e arrivano a destinazione

> Verifica F7. È la parte che risponde a «2.677 fallimenti e nessun allarme».

**Come:** indurre un fallimento ripetibile su un solo agente (lo stesso meccanismo di
T7, reso persistente per la durata del test) e lasciare girare il watchdog.

Cosa osservare, in ordine:

1. il registro cresce di una riga per tentativo fallito:
   `docker exec jht sh -c 'cat /jht_home/logs/agent-spawn-failures.tsv'`
2. la riga contiene un `detail` **parlante** (l'ultima riga scritta dallo spawner), non
   vuoto e non un messaggio dello ZOMBIE detector;
3. al 5° fallimento consecutivo e dopo ≥5 minuti, il **CAPITANO** riceve un messaggio;
4. all'8° e dopo ≥20 minuti, arriva un avviso **all'utente** (riga in
   `pending_user_messages`, più Telegram se configurato);
5. il respawn **continua** a essere tentato, rallentato a ~1 ogni 5 minuti, senza mai
   fermarsi;
6. rimosso il guasto, al primo successo lo streak si azzera e chi era stato avvisato
   riceve il rientro.

**Passa se:** tutti e sei i punti.
**Fallisce se:** anche uno solo — annotare quale, perché sono meccanismi indipendenti.

**Esito:** _(da compilare)_

---

### T9 — L'escalation tace a team fermo

> Il rischio economico opposto: un allarme che suona mentre il team è deliberatamente
> spento. Sotto i gate lo spawn non viene nemmeno tentato, quindi lo streak non deve
> muoversi.

**Come:** con un guasto attivo (come in T8), attivare a turno `.team-halted.flag`,
`.weekly-halt.flag` e lo standby a spesa zero, e verificare che il registro **non**
cresca e che non partano messaggi.

**Passa se:** nessuna riga nuova nel TSV e nessun messaggio, per tutti e tre i gate.

**Esito:** _(da compilare)_

---

### T10 — Un'escalation non zittisce le altre

> Verifica F8. Prima, un unico file di cooldown globale faceva sì che un allarme sui
> bridge silenziasse per un'ora quello sui processi di pid1.

**Come:** provocare due categorie di allarme diverse nella stessa ora e verificare che
arrivino entrambe.

**Passa se:** arrivano entrambe, e ciascuna rispetta il proprio cooldown separatamente.

**Esito:** _(da compilare)_

---

## 3. Test da fare sulla VPS, non in locale

Alcune cose non sono riproducibili su Docker Desktop for Windows, e altre non sono
riproducibili altrove.

| Cosa | Dove | Perché |
|---|---|---|
| Baseline «il lock si libera» su bind mount **nativo** | VPS | è l'ambiente dove il difetto F1 è stato osservato per 11 giorni; il fix va confermato lì |
| Tetto di tempo che scatta davvero (rc 124) | Windows | il bind mount lento è la sola condizione in cui la `new-session` ci arriva vicino |
| `jht_timeout` che degrada senza `timeout` | né l'uno né l'altra | entrambe hanno coreutils GNU: coperto dai test comportamentali con `PATH` ridotto |
| Frequenza reale del pager Codex | VPS | è dove si è manifestato (vedi §4) |

**Sulla VPS, prima di aggiornare:** ripetere lo snapshot §0.3 e conservarlo. Il processo
`tmux: server` con `fd 9` aperto e i file `*.stale-tmux-server-*` sono l'evidenza del
difetto: servono come confronto «prima/dopo».

**Nota operativa:** il difetto F1 si ripresenta **a ogni riavvio del container** finché
il fix non è deployato, su qualunque agente capiti di spawnare per primo. Il fix va in
produzione prima del prossimo restart, non dopo.

---

## 4. Cosa NON testare in questo batch

**La PR #223 (watchdog del pager) è mergiata nella branch ma non è pronta.** Non
includerla nei test e non deployarla:

- non legge `.team-halted.flag`, `.weekly-halt.flag` né `.team-standby.flag`: è l'unico
  processo che continuerebbe a spendere dopo lo Stop e durante lo standby a spesa zero;
- non ha cooldown: un falso positivo persistente manda un prompt LLM ogni 20 secondi
  senza limite;
- la firma che cerca (`pgup/pgdn to page`) ha **zero occorrenze** nei log di produzione,
  dove il modal osservato è `/TRANSCRIPT/` con `q to quit`: sull'impianto reale non
  scatterebbe, o scatterebbe sul caso sbagliato;
- non è registrata in `shared/skills/process_health.py`, quindi la sua morte è invisibile.

Il problema che affronta **è reale e confermato** (il Dottore ha sbloccato a mano con `q`
almeno cinque agenti diversi), ma va rilavorata prima di essere provata su un team vivo.

---

## 5. Esito complessivo

| Test | Cosa verifica | Esito | Note |
|---|---|---|---|
| T1 | server tmux senza fd sul lock | | |
| T2 | lock libero dopo lo spawn | | |
| T3 | respawn immediato possibile | | |
| T4 | nessuna regressione sul percorso felice | | |
| T5 | `duplicate session` non distruttivo | | |
| T6 | prefix match non fa sparire agenti | | |
| T7 | CLI morto segnalato | | |
| T8 | fallimenti contati ed escalati | | |
| T9 | silenzio a team fermo | | |
| T10 | escalation indipendenti | | |

**Decisione su `master`:** _(da compilare — richiede T1-T4 verdi come minimo)_

### Se qualcosa va storto

I fix sono su `lee-launcher-fixes` e `master` non è stato toccato: il ripristino è
tornare all'immagine costruita da `master`. Nessuno dei fix scrive dati persistenti
nuovi salvo `agent-spawn-failures.tsv` e i file di stato sotto `logs/`, che sono
append-only e ignorabili da una versione precedente del codice.
