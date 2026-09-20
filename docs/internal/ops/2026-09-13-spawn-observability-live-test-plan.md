# Piano di test su team vivo — osservabilità dello spawn

> **Stato:** pronto, non eseguito · **Branch:** `fullstack-1`
>
> Il merge resta bloccato finché l'operatore non indica il team e tutti i test
> applicabili hanno un esito scritto. Non incollare output grezzo in issue o
> commit: i log possono contenere diagnostica del provider. Riportare soltanto
> campi tecnici e righe già verificate prive di dati personali.

## 0. Preparazione e limiti

Eseguire dalla checkout che ha costruito l'immagine del branch. L'operatore deve
approvare un'istanza worker inattiva e sacrificabile; gli esempi usano `SCOUT-99`.
Non usare un agente che sta lavorando e non cambiare config, credenziali o profilo.

```sh
export JHT_CONTAINER=jht
export TEST_ROLE=scout
export TEST_INSTANCE=99
export TEST_SESSION=SCOUT-99
case "$TEST_SESSION" in *[!A-Z0-9-]*) echo "invalid TEST_SESSION"; exit 1;; esac

docker inspect -f '{{.State.Running}}' "$JHT_CONTAINER" | grep -qx true
docker exec "$JHT_CONTAINER" test -x /app/.launcher/start-agent.sh
docker exec "$JHT_CONTAINER" grep -q 'spawn-attempts.jsonl' /app/.launcher/start-agent.sh
docker exec "$JHT_CONTAINER" tmux has-session -t "=$TEST_SESSION" 2>/dev/null \
  && { echo "$TEST_SESSION is already in use: stop"; exit 1; } || true
```

Annotare UTC iniziale, commit dell'immagine e conteggi iniziali, senza copiare il
contenuto dei log:

```sh
date -u +%Y-%m-%dT%H:%M:%SZ
docker exec "$JHT_CONTAINER" sh -c '
  for f in spawn-attempts.jsonl agent-watchdog.log agent-recoveries.tsv agent-spawn-failures.tsv; do
    test -f "/jht_home/logs/$f" && wc -l "/jht_home/logs/$f" || echo "0 /jht_home/logs/$f"
  done'
```

## 1. Una riga conclusiva per ogni tentativo

**Setup e causa.** Avviare il worker approvato tramite la CLI reale; poi fare un
tentativo deliberatamente invalido, che fallisce prima di creare una sessione.

```sh
env -u JHT_SPAWN_SRC node cli/bin/jht.js team start "${TEST_ROLE}:${TEST_INSTANCE}"

set +e
docker exec -e JHT_SPAWN_SRC=live-invalid-role "$JHT_CONTAINER" \
  bash /app/.launcher/start-agent.sh invalid-observability-role >/dev/null 2>&1
invalid_rc=$?
set -e
test "$invalid_rc" -ne 0
```

**Dove guardare.** Solo nella traccia persistente:

```sh
docker exec -i -e TEST_SESSION="$TEST_SESSION" "$JHT_CONTAINER" python3 - <<'PY'
import json
import os
from pathlib import Path

rows = [json.loads(line) for line in Path("/jht_home/logs/spawn-attempts.jsonl").read_text().splitlines()]
required = {"timestamp", "session", "role", "source", "flock_wait_s", "stage", "rc", "duration_s"}
selected = [row for row in rows if row.get("source") in {"cli-team-start", "live-invalid-role"}]
assert any(row.get("session") == os.environ["TEST_SESSION"] and row.get("rc") == 0 for row in selected)
assert any(row.get("role") == "invalid-observability-role" and row.get("rc") != 0 for row in selected)
assert all(required <= row.keys() for row in selected)
print("PASS: success and failure attempts have complete rows")
PY
```

**Passa se:** ci sono esattamente eventi conclusivi separati per successo ed errore,
con campi completi e durata/attesa numeriche non negative. **Fallisce se:** manca
l'errore, ci sono JSON troncati o un campo richiesto contiene contenuto del profilo.

**Esito:** _(da compilare)_

## 2. Il timeout del lock identifica il detentore

**Setup e causa.** Tenere per pochi secondi il lock del worker già attivo. Il file
`spawn-lock-probe.ready` è soltanto un handshake e viene eliminato. Il processo
holder viene atteso esplicitamente: non deve restare in background.

```sh
docker exec "$JHT_CONTAINER" bash -lc "
  exec 8>/jht_home/locks/start-${TEST_SESSION}.lock
  flock -x 8
  touch /jht_home/logs/spawn-lock-probe.ready
  sleep 15
" & holder_job=$!

ready_i=0
until docker exec "$JHT_CONTAINER" test -e /jht_home/logs/spawn-lock-probe.ready; do
  ready_i=$((ready_i + 1)); test "$ready_i" -lt 50 || { wait "$holder_job"; exit 1; }
  sleep 0.2
done
set +e
lock_output="$(docker exec \
  -e JHT_SPAWN_SRC=live-lock-probe \
  -e JHT_SPAWN_LOCK_WAIT_SEC=2 \
  "$JHT_CONTAINER" bash /app/.launcher/start-agent.sh "$TEST_ROLE" "$TEST_INSTANCE" 2>&1)"
lock_rc=$?
set -e
wait "$holder_job"
docker exec "$JHT_CONTAINER" rm -f /jht_home/logs/spawn-lock-probe.ready

test "$lock_rc" -ne 0
printf '%s\n' "$lock_output" | grep -Eq 'lock holder: pid=[0-9]+ process=[^ ]+ age=[0-9]+s'
docker exec "$JHT_CONTAINER" tail -n 20 /jht_home/logs/spawn-attempts.jsonl \
  | grep '"source":"live-lock-probe"' | grep '"stage":"lock_timeout"'
```

**Passa se:** rc non-zero, messaggio con PID/nome/età, e trace `lock_timeout`.
**Fallisce se:** compare solo `unknown`, il comando supera il budget, oppure il
processo holder resta vivo dopo `wait`.

**Esito:** _(da compilare)_

## 3. La sorgente attraversa i chiamanti reali

**Setup e causa.** Il punto 1 ha già esercitato `cli-team-start`. Prima del kill,
consegnare al worker sonda un messaggio tecnico privo di dati utente: è attività
reale ricevuta e registrata tramite il trasporto normale, quindi soddisfa il gate
dei 90 minuti senza inventare righe nel DB. Il worker è sacrificabile e il testo
gli ordina di non iniziare lavoro. Solo dopo la consegna verificata lo si ferma
senza `retire`, così il watchdog deve ricrearlo. Fare il test durante la finestra
di lavoro, con team non halted/standby e tetto globale dei respawn disponibile.

```sh
test_target="$(printf '%s' "$TEST_SESSION" | tr '[:upper:]' '[:lower:]')"
docker exec "$JHT_CONTAINER" /app/agents/_skills/tmux-send/jht-tmux-send \
  "$TEST_SESSION" \
  "[@observability-probe -> @${test_target}] [INFO] Live observability probe: do not start work; acknowledge once and wait."

# Il criterio usato dal roster deve vedere proprio la consegna appena fatta.
docker exec -i -e TEST_SESSION="$TEST_SESSION" "$JHT_CONTAINER" python3 - <<'PY'
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, "/app")
from shared.skills.team_roster import last_activity

activity = last_activity(os.environ["TEST_SESSION"])
assert activity is not None
assert (datetime.now(timezone.utc) - activity).total_seconds() < 60
print("PASS: probe worker has recent real message activity")
PY

before="$(docker exec "$JHT_CONTAINER" sh -c \
  "grep -c '\"session\":\"$TEST_SESSION\".*\"source\":\"agent-watchdog\"' /jht_home/logs/spawn-attempts.jsonl 2>/dev/null || true")"
docker exec "$JHT_CONTAINER" tmux kill-session -t "=$TEST_SESSION"

i=0
while [ "$i" -lt 120 ]; do
  after="$(docker exec "$JHT_CONTAINER" sh -c \
    "grep -c '\"session\":\"$TEST_SESSION\".*\"source\":\"agent-watchdog\"' /jht_home/logs/spawn-attempts.jsonl 2>/dev/null || true")"
  if [ "${after:-0}" -gt "${before:-0}" ] \
     && docker exec "$JHT_CONTAINER" tmux has-session -t "=$TEST_SESSION" 2>/dev/null; then break; fi
  sleep 1; i=$((i + 1))
done
test "$i" -lt 120

docker exec "$JHT_CONTAINER" python3 - <<'PY'
import json
from pathlib import Path

rows = [
    json.loads(line)
    for line in Path("/jht_home/logs/spawn-attempts.jsonl").read_text().splitlines()
    if line.strip()
]
sources = {str(row.get("source") or "") for row in rows}
assert "cli-team-start" in sources
assert "agent-watchdog" in sources
assert {"pid1", "pid1-autostart"} & sources
assert "unknown" not in sources
print("PASS: real CLI, watchdog and pid1 spawn sources are attributed")
PY

# JHT_AGENT_NAME is exported by send-keys inside the pane shell, after tmux has
# created the session. Therefore `tmux show-environment` is the wrong observer:
# inspect process environments without printing their other variables.
docker exec "$JHT_CONTAINER" python3 - <<'PY'
from pathlib import Path

needle = b"JHT_AGENT_NAME=CAPITANO"
holders = []
for env_path in Path("/proc").glob("[0-9]*/environ"):
    try:
        variables = env_path.read_bytes().split(b"\0")
    except OSError:
        continue
    if needle in variables:
        holders.append(env_path.parent.name)
assert holders, "no Capitano process inherited JHT_AGENT_NAME"
print("PASS: Capitano identity is present in a process environment")
PY
```

**Dove guardare.** Filtrare `spawn-attempts.jsonl` per `source`, senza stampare
altri log. Il test del bridge del punto 6 aggiunge `sentinel-bridge`. Se il
messaggio non viene consegnato o `last_activity` non lo vede, fermarsi prima del
kill: senza quel prerequisito la mancata ricreazione sarebbe il comportamento
corretto del roster, non una prova sulla sorgente.

**Passa se:** si osservano almeno `cli-team-start`, `agent-watchdog` e `pid1`/
`pid1-autostart`; un processo del Capitano ha `JHT_AGENT_NAME=CAPITANO`; il punto
6 produce `sentinel-bridge` sul provider Claude. **Fallisce se:** un percorso
reale finisce come `unknown`. Una sessione tmux priva della variabile nel proprio
environment non è un fallimento: l'identità vive nell'ambiente del processo che
esegue il comando, non nel server tmux.

**Esito:** _(da compilare)_

## 4. Kickoff e welcome sopravvivono al container

**Setup e causa.** Usare l'avvio normale del team nell'immagine nuova; non
provocare un secondo welcome. Il launcher crea un kickoff persistente soltanto
per i quattro ruoli core `ASSISTENTE`, `CAPITANO`, `MENTOR` e `SENTINELLA`.
I worker numerati ricevono il primo ordine dal Capitano, oppure il resume da
`worker_kickoff` dopo un recupero del watchdog: entrambi passano da
`jht-tmux-send` e restano in `messages.jsonl`, non in `kickoff-WORKER.log`.
Attendere fino a 30 secondi perché gli helper detached dei core aprano i file.

```sh
for session in ASSISTENTE CAPITANO MENTOR SENTINELLA; do
  i=0
  while [ "$i" -lt 30 ]; do
    docker exec "$JHT_CONTAINER" test -s "/jht_home/logs/kickoff-${session}.log" && break
    sleep 1; i=$((i + 1))
  done
  test "$i" -lt 30
  docker exec "$JHT_CONTAINER" test ! -e "/tmp/kickoff-${session}.log"
done

for role in assistente capitano mentor; do
  docker exec "$JHT_CONTAINER" test -s "/jht_home/logs/welcome-watchdog-${role}.log"
  docker exec "$JHT_CONTAINER" test ! -e "/tmp/welcome-watchdog-${role}.log"
done
```

**Passa se:** i quattro kickoff core e i tre welcome log esistono sotto
`/jht_home/logs`, hanno una riga operativa e non vengono creati sotto `/tmp`.
**Fallisce se:** esistono soltanto nel layer effimero o manca un file previsto
per un ruolo core. L'assenza di `kickoff-SCOUT-N.log` è il comportamento atteso,
non un fallimento.

**Esito:** _(da compilare)_

## 5. I registri sono limitati e archiviabili

**Setup e causa.** Prima verificare che l'archiver riconosca i quattro formati.
Poi esercitare la rotazione in una directory sonda, senza abbassare il limite dei
log reali e senza tagliare il loro storico.

```sh
docker exec "$JHT_CONTAINER" python3 /app/shared/skills/log_archive.py status \
  | python3 -c '
import json, sys
d=json.load(sys.stdin)
wanted={"spawn-attempts.jsonl","agent-watchdog.log","agent-recoveries.tsv","agent-spawn-failures.tsv"}
seen={row["file"] for row in d["sources"]}
assert wanted <= seen, wanted-seen
print("PASS: four sources registered")'

docker exec \
  -e JHT_LOGS_DIR=/jht_home/logs/observability-rotation-probe \
  -e JHT_DAEMON_LOG_MAX_BYTES=32 \
  "$JHT_CONTAINER" bash -lc '
    set -eu
    . /app/.launcher/daemon-lib.sh
    p="$(jht_daemon_log bounded.log)"
    printf "%040d" 0 >"$p"
    jht_daemon_log bounded.log >/dev/null
    test -s "$p.old"
    test ! -s "$p"
    rm -f "$p" "$p.old"
    rmdir /jht_home/logs/observability-rotation-probe
  '

# Prova che il watchdog ruoti DURANTE la propria vita, non soltanto al boot.
# Il gate halted e il JHT_HOME separato impediscono qualunque spawn reale.
docker exec "$JHT_CONTAINER" bash -lc '
  set -eu
  probe=/jht_home/observability-watchdog-probe
  test ! -e "$probe"
  mkdir -p "$probe/logs"
  touch "$probe/.team-halted.flag"
  set +e
  JHT_HOME="$probe" JHT_DAEMON_LOG_MAX_BYTES=128 \
    JHT_AGENT_WATCHDOG_INTERVAL=0 timeout 2 \
    bash /app/.launcher/agent-watchdog.sh >/dev/null 2>&1
  rc=$?
  set -e
  case "$rc" in 0|124|143) ;; *) exit "$rc";; esac
  test -s "$probe/logs/agent-watchdog.log.old"
  rm -f "$probe/.team-halted.flag" \
    "$probe/logs/agent-watchdog.log" "$probe/logs/agent-watchdog.log.old"
  rmdir "$probe/logs" "$probe"
'

# Prova che l'output figlio senza timestamp segua la riga watchdog che lo
# introduce, invece di restare immortale nel file vivo.
docker exec "$JHT_CONTAINER" bash -lc '
  set -eu
  probe=/jht_home/observability-archive-probe
  test ! -e "$probe"
  mkdir -p "$probe/logs"
  fresh="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf "%s\n" \
    "[2026-01-05T12:00:00Z] old spawn" \
    "old launcher detail" \
    "[$fresh] fresh tick" \
    "fresh launcher detail" >"$probe/logs/agent-watchdog.log"
  JHT_HOME="$probe" python3 /app/shared/skills/log_archive.py run \
    --retain-days 30 >/dev/null
  JHT_HOME="$probe" python3 - <<"PY"
from pathlib import Path
import zipfile
root = Path("/jht_home/observability-archive-probe/logs")
live = (root / "agent-watchdog.log").read_text()
assert "old spawn" not in live and "old launcher detail" not in live
assert "fresh tick" in live and "fresh launcher detail" in live
bundles = list((root / "archive").glob("logs-*.zip"))
assert len(bundles) == 1
with zipfile.ZipFile(bundles[0]) as bundle:
    archived = "".join(bundle.read(name).decode() for name in bundle.namelist())
assert "old spawn" in archived and "old launcher detail" in archived
PY
  rm -f "$probe/logs/agent-watchdog.log" "$probe/logs/archive/logs-2026-W02.zip"
  rmdir "$probe/logs/archive" "$probe/logs" "$probe"
'

docker exec "$JHT_CONTAINER" python3 /app/shared/skills/log_archive.py run \
  --dry-run --retain-days 30 >/dev/null
```

**Passa se:** le quattro fonti risultano registrate, `.old` contiene la riga
ruotata, il watchdog acceso crea il proprio `.old`, il blocco vecchio finisce
interamente nello zip, e il dry-run termina zero. **Fallisce se:** una fonte
manca, la rotazione avviene soltanto al boot, una riga figlia vecchia resta nel
vivo o il dry-run modifica un log.

**Esito:** _(da compilare)_

## 6. Il bridge conserva l'output dello spawn worker

**Precondizione bloccante.** Eseguire solo su un team con provider `claude`, e solo
dopo approvazione dell'operatore: il test ricrea `SENTINELLA-WORKER` e può consumare
una richiesta. Se il provider è diverso, scegliere un altro team; non cambiare il
provider per far passare il test.

```sh
provider="$(docker exec "$JHT_CONTAINER" python3 -c '
import json
print(json.load(open("/jht_home/jht.config.json")).get("active_provider", ""))')"
test "$provider" = claude || { echo "requires an operator-selected Claude team"; exit 1; }

before="$(docker exec "$JHT_CONTAINER" sh -c \
  'grep -c "worker spawn rc=" /jht_home/logs/sentinel-bridge.log 2>/dev/null || true')"
docker exec "$JHT_CONTAINER" tmux kill-session -t '=SENTINELLA-WORKER' 2>/dev/null || true

i=0
while [ "$i" -lt 360 ]; do
  after="$(docker exec "$JHT_CONTAINER" sh -c \
    'grep -c "worker spawn rc=" /jht_home/logs/sentinel-bridge.log 2>/dev/null || true')"
  if [ "${after:-0}" -gt "${before:-0}" ]; then break; fi
  sleep 1; i=$((i + 1))
done
test "$i" -lt 360
docker exec "$JHT_CONTAINER" sh -c \
  'grep "worker spawn rc=" /jht_home/logs/sentinel-bridge.log | tail -1'
docker exec "$JHT_CONTAINER" sh -c \
  "grep '\"source\":\"sentinel-bridge\"' /jht_home/logs/spawn-attempts.jsonl | tail -1 >/dev/null"
docker exec "$JHT_CONTAINER" tmux has-session -t '=SENTINELLA-WORKER'
```

**Passa se:** il log del bridge cresce con `worker spawn rc=...`, la trace attribuisce
il tentativo a `sentinel-bridge` e il worker torna attivo. **Fallisce se:** il worker
ricompare ma il log resta muto, oppure l'attesa scade.

Nota: il bridge concede 10 secondi al launcher mentre il worker può attendere il
REPL fino a 12; `rc=timeout` può quindi essere un esito preesistente ora finalmente
visibile. Non è da solo un fallimento di questa modifica: contano log, trace e stato
finale della sessione.

**Esito:** _(da compilare)_

## 7. La CLI mostra una coda stderr, non una sola riga

**Precondizione bloccante.** Usare un team dove il consenso auto-apply è disattivo.
Il gate va verificato prima: se consente l'invio, fermarsi e scegliere un altro team;
non modificare il consenso. Il rifiuto del CLOSER produce due righe reali e non crea
alcun agente.

```sh
if docker exec "$JHT_CONTAINER" python3 /app/shared/skills/apply_gate.py consent \
     >/dev/null 2>&1; then
  echo "auto-apply is enabled: do not run this probe"; exit 1
fi

set +e
cli_output="$(env -u JHT_SPAWN_SRC node cli/bin/jht.js team start closer 2>&1)"
cli_rc=$?
set -e
test "$cli_rc" -ne 0
printf '%s\n' "$cli_output" | grep -q 'Refusing to start closer:'
printf '%s\n' "$cli_output" | grep -q 'Set applications.auto_apply.enabled = true'
```

**Passa se:** entrambe le righe significative compaiono nell'output CLI e il comando
fallisce. **Fallisce se:** resta soltanto l'ultima riga, compare `unknown error` o nasce
una sessione `CLOSER-1`.

**Esito:** _(da compilare)_

## 8. Pulizia e controllo finale

Ritirare prima il worker sonda dal roster, poi rimuovere soltanto la sua sessione.
Attendere due tick del watchdog e verificare che non venga ricreato.

```sh
docker exec "$JHT_CONTAINER" python3 /app/shared/skills/team_roster.py \
  retire "$TEST_SESSION" --reason observability-live-test
docker exec "$JHT_CONTAINER" tmux kill-session -t "=$TEST_SESSION" 2>/dev/null || true
sleep 65
if docker exec "$JHT_CONTAINER" tmux has-session -t "=$TEST_SESSION" 2>/dev/null; then
  echo "cleanup failed: watchdog recreated $TEST_SESSION"; exit 1
fi
docker exec "$JHT_CONTAINER" test ! -e /jht_home/logs/spawn-lock-probe.ready
```

Annotare soltanto: timestamp UTC, commit dell'immagine, PASS/FAIL per i sette punti,
rc osservati, sorgenti osservate e nomi dei file. Nessun contenuto del profilo,
credenziale, hostname, IP o output integrale del provider deve entrare nel repo.
