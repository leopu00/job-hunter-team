#!/usr/bin/env python3
"""spawn_stagger — lo sfasamento iniziale di un worker, ricavato dal SUO periodo.

Il problema. Lo stagger allo spawn esisteva già ma era una costante: ~10 minuti
fra un worker e l'altro, scollegata dal periodo di throttle su cui quei worker
poi girano davvero. Con N worker che condividono il periodo T, la distanza che
li distribuisce è T/N: tre worker sul gradino da 5 minuti vogliono 1m40s l'uno
dall'altro, non 10 minuti. Un offset più GRANDE di T è il caso peggiore — il
primo worker ha già ciclato due volte prima che parta il secondo, quindi le fasi
finiscono dove capita; e aspettare ESATTAMENTE T mette i due in lockstep
permanente, perché il ciclo successivo di A cade sull'avvio di B.

Fa coppia con la scala coprima di `throttle-config.py`: la scala impedisce a
worker su gradini DIVERSI di risincronizzarsi, questo impedisce a worker sullo
STESSO gradino di partire insieme. Quello che si fissa qui è solo la fase
iniziale — la durata variabile dei task fa poi derivare le fasi da sola.

Il modello. Il periodo T del gradino si divide in N fette uguali (`slot = T/N`).
Il worker nuovo prende la PRIMA fetta libera dopo quella occupata dal worker
precedente sullo stesso gradino:

    T = 300s, N = 3  →  slot = 100s
    ┌──────────┬──────────┬──────────┐
    │ worker A │ worker B │ worker C │   fase 0 · 100 · 200
    └──────────┴──────────┴──────────┘

La fase del worker precedente sta nel ledger (`state/spawn-stagger.json`, una
riga per gradino): senza di esso due spawn consecutivi calcolerebbero entrambi
"fra T/N da adesso" e finirebbero appaiati — cioè esattamente il difetto da
correggere. Il ledger si auto-ripara: se il gradino si svuota, il primo worker
riparte da 0 e riscrive la fase.

Limiti, e perché quelli:

  * MIN 12s — sotto il tempo di boot della TUI del provider (8-15s misurati;
    è lo stesso valore che il launcher aspetta prima del kick-off e quello con
    cui pid1 scaglia l'autostart) lo "sfasamento" è finzione: i due agenti
    stanno ancora accendendosi e la differenza se la mangia il jitter di boot.
  * MAX 300s — un worker che non produce nulla per più di ~10 minuti è, per il
    Dottore, un candidato zombie: un'attesa più lunga dello sfasamento
    trasformerebbe un worker sano in un falso positivo. 300s è anche il
    WORKER_FLOOR, cioè la distanza minima che il sistema considera già
    sufficiente fra due unità di lavoro: oltre quella si comprerebbe precisione
    di fase che la varianza dei task cancella comunque.

I due limiti non possono creare lockstep: MAX morde solo quando slot > 300s,
cioè per T > 600s, quindi il valore tagliato resta < T; MIN (12s) è sotto il
gradino più basso della scala (60s). Invariante: 0 < offset < T, sempre.

Come si applica. Il worker nuovo NON viene fatto aspettare dal launcher (che
bloccherebbe il Capitano) né dal Capitano (che bloccherebbe sé stesso): si
PRE-ARMA il suo throttle, scrivendo `state/throttle-<agente>.json` con
`until = ora + offset`. Al primo giro di loop il worker incontra il gate che il
suo prompt gli impone già — `jht-throttle-check <me> || jht-throttle-wait <me>`
— e parte in fase. Nessuno blocca nessuno, e il meccanismo è quello già
documentato per il recovery.

Uso:
    spawn_stagger.py <agente>            # stampa i secondi (0 = parti subito)
    spawn_stagger.py <agente> --arm      # calcola, pre-arma il throttle, stampa
    spawn_stagger.py <agente> --json     # la decisione completa, per capirla

Disattivazione: `JHT_SPAWN_STAGGER=0` nell'ambiente → offset 0 sempre. Serve ai
percorsi in cui l'attesa è dannosa e non utile, per esempio il refresh di
sessione del Dottore, che ricrea un worker che era già in una fase buona.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys
import time
import tempfile
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
STATE_DIR = JHT_HOME / "state"
LEDGER_FILE = STATE_DIR / "spawn-stagger.json"
LOG_FILE = JHT_HOME / "logs" / "spawn-stagger.jsonl"

# Vedi il docstring per il perché di questi due numeri: non sono arrotondamenti
# comodi, sono il tempo di boot della TUI e la soglia di silenzio del Dottore.
MIN_OFFSET_SEC = 12
MAX_OFFSET_SEC = 300

_TC = None


def _throttle_config():
    """`throttle-config.py` caricato per path (il trattino non è importabile).

    È la sola fonte di verità sul periodo: applica scala, WORKER_FLOOR ed
    eventuali deroghe. Ricalcolarlo qui vorrebbe dire avere due scale che
    divergono al primo cambio.
    """
    global _TC
    if _TC is not None:
        return _TC
    for cand in (Path("/app/shared/skills/throttle-config.py"),
                 Path(__file__).resolve().parent / "throttle-config.py"):
        if not cand.exists():
            continue
        spec = importlib.util.spec_from_file_location("throttle_config", cand)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _TC = mod
        return _TC
    return None


def is_worker(agent) -> bool:
    """Solo i worker hanno un periodo su cui sfasarsi. Il core interattivo
    (Capitano/Sentinella/Assistente/Mentor) deve restare reattivo e non ha
    ladder: farlo aspettare allo spawn sarebbe solo latenza per l'utente."""
    tc = _throttle_config()
    if tc is None:
        return False
    return bool(tc._is_worker(agent))


def period_for(agent) -> int:
    """Periodo EFFETTIVO dell'agente in secondi (0 = nessun throttle)."""
    tc = _throttle_config()
    if tc is None:
        return 0
    try:
        return int(tc.get_agent(agent))
    except Exception:  # noqa: BLE001 — gira su un percorso di spawn, mai alzare
        return 0


def _session_to_agent(session: str) -> str:
    """`SCOUT-3` → `scout-3`. Stessa convenzione di `AGENT_NAME` nel launcher."""
    return session.strip().lower()


def live_agents() -> list:
    """Nomi agente delle sessioni tmux vive. Lista vuota se tmux non risponde
    (fuori dal container, in test): l'assenza di peer significa N=1, cioè
    nessuna attesa — la direzione sicura quando non si sa è non frenare."""
    try:
        out = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}"],
            capture_output=True, text=True, timeout=10,
        ).stdout
    except Exception:  # noqa: BLE001
        out = ""
    return [_session_to_agent(ln) for ln in out.splitlines() if ln.strip()]


def peers_on_rung(agent: str, period: int, candidates=None) -> list:
    """Worker vivi che condividono lo STESSO gradino dell'agente in arrivo.

    Gradini diversi non si contano fra loro: quella collisione la governa già
    la scala coprima, e mescolarli gonfierebbe N restringendo le fette senza
    motivo.
    """
    if period <= 0:
        return []
    names = live_agents() if candidates is None else list(candidates)
    me = str(agent).strip().lower()
    out = []
    for name in names:
        if name == me or not is_worker(name):
            continue
        if period_for(name) == period:
            out.append(name)
    return out


def offset_for(period, workers, last_phase=None, now=None) -> int:
    """I secondi di attesa prima del PRIMO ciclo del worker in arrivo.

    Aritmetica pura, nessun I/O: è il cuore testabile della skill.

    `period`     — T, il gradino su cui girerà (secondi).
    `workers`    — N, quanti worker condivideranno T, incluso questo.
    `last_phase` — istante del primo ciclo dell'ultimo worker entrato su T
                   (unix). None = gradino vergine.
    """
    try:
        period = int(period)
        workers = int(workers)
    except (TypeError, ValueError):
        return 0
    # Un worker solo non ha nessuno con cui sfasarsi, e il primo spawn è il
    # percorso anti-idle: parte subito, senza attese inventate.
    if period <= 0 or workers <= 1:
        return 0

    slot = period / workers
    if last_phase is None:
        raw = slot
    else:
        now = time.time() if now is None else float(now)
        # Le fette candidate sono `last_phase + j*slot` con j da 1 a N-1: la
        # fetta j=0 è quella del worker precedente, ed è l'unica che darebbe
        # lockstep. `% period` porta ognuna nella prima occorrenza futura;
        # si prende la più vicina, cioè il primo posto libero sulla griglia.
        raw = min((last_phase + j * slot - now) % period
                  for j in range(1, workers))
    value = int(round(max(MIN_OFFSET_SEC, min(MAX_OFFSET_SEC, raw))))
    # Nessun limite, e nessun arrotondamento, può spingere l'attesa fino al
    # periodo: aspettare esattamente T è il lockstep che questa skill esiste
    # per evitare. Succede in due casi soli — l'arrotondamento di un raw a
    # ridosso di T, e un periodo più corto dei limiti stessi (possibile solo
    # in deroga, dove la scala non si applica). In entrambi vale la fetta.
    if value >= period:
        value = int(round(slot))
    return value if value < period else 0


# ── Ledger delle fasi per gradino ────────────────────────────────────────
def read_ledger() -> dict:
    """`{"<periodo>": {"phase": <unix>, "agent": "<nome>"}}`. Illeggibile o
    corrotto → vuoto: si riparte da un gradino vergine, che è il caso già
    gestito (offset = T/N)."""
    try:
        data = json.loads(LEDGER_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return {}
    rungs = data.get("rungs") if isinstance(data, dict) else None
    return rungs if isinstance(rungs, dict) else {}


def _atomic_write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.name}-", suffix=".tmp",
                               dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(body)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def write_ledger(period: int, phase: float, agent: str) -> None:
    rungs = read_ledger()
    rungs[str(int(period))] = {"phase": int(phase), "agent": str(agent)}
    _atomic_write(LEDGER_FILE,
                  json.dumps({"rungs": rungs}, indent=2, sort_keys=True) + "\n")


def last_phase_on_rung(period: int):
    entry = read_ledger().get(str(int(period)))
    if not isinstance(entry, dict):
        return None
    try:
        return float(entry["phase"])
    except (KeyError, TypeError, ValueError):
        return None


# ── Decisione + applicazione ─────────────────────────────────────────────
def enabled() -> bool:
    return str(os.environ.get("JHT_SPAWN_STAGGER", "1")).strip().lower() \
        not in {"0", "false", "off", "no"}


def plan(agent: str, now=None, candidates=None) -> dict:
    """Cosa aspetterà questo worker, e perché. Nessuna scrittura."""
    now = time.time() if now is None else float(now)
    decision = {"agent": agent, "offset_sec": 0, "period_sec": 0, "workers": 0,
                "slot_sec": 0, "reason": ""}
    if not enabled():
        decision["reason"] = "disabled"
        return decision
    if not is_worker(agent):
        # Il core interattivo non ha ladder e deve restare reattivo.
        decision["reason"] = "not-a-worker"
        return decision
    period = period_for(agent)
    if period <= 0:
        decision["reason"] = "no-throttle"
        return decision
    peers = peers_on_rung(agent, period, candidates=candidates)
    workers = len(peers) + 1
    decision.update(period_sec=period, workers=workers,
                    peers=peers, slot_sec=round(period / workers, 1))
    if workers <= 1:
        # C-05: il primo worker del gradino è il percorso anti-idle, parte ora.
        decision["reason"] = "alone-on-rung"
        return decision
    last = last_phase_on_rung(period)
    decision["offset_sec"] = offset_for(period, workers, last_phase=last, now=now)
    decision["reason"] = "fresh-rung" if last is None else "next-free-slot"
    return decision


def arm(agent: str, decision: dict, now=None) -> dict:
    """Pre-arma il throttle del worker e registra la fase sul ledger.

    Scrive lo state file che `jht-throttle-check` legge già: il worker si ferma
    da solo al primo gate del suo loop, senza che il launcher o il Capitano
    stiano fermi ad aspettarlo.
    """
    now = time.time() if now is None else float(now)
    offset = int(decision.get("offset_sec") or 0)
    period = int(decision.get("period_sec") or 0)
    phase = now + offset
    if period > 0 and is_worker(agent):
        # La fase si registra anche a offset 0: è quella del primo worker del
        # gradino, ed è il riferimento da cui si misura il prossimo.
        try:
            write_ledger(period, phase, agent)
        except OSError:
            pass
    if offset > 0:
        state = {
            "agent": agent,
            "id": f"spawn-{int(now)}",
            "until": int(phase),
            "started": int(now),
            "applied_sec": offset,
            "source": "spawn-stagger",
        }
        try:
            _atomic_write(STATE_DIR / f"throttle-{agent}.json",
                          json.dumps(state, separators=(",", ":")) + "\n")
        except OSError:
            pass
    _log(dict(decision, event="spawn-stagger", ts_unix=round(now, 3),
              phase_unix=int(phase)))
    return decision


def _log(payload: dict) -> None:
    """Una riga per spawn. Serve a poter rispondere dopo, guardando i dati, a
    'perché questi due worker girano appaiati'."""
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload, separators=(",", ":")) + "\n")
    except OSError:
        pass


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="spawn_stagger",
        description="Initial worker offset derived from its period.")
    ap.add_argument("agent", help="agent name (for example, scout-3)")
    ap.add_argument("--arm", action="store_true",
                    help="pre-arm the worker throttle and update the ledger")
    ap.add_argument("--json", action="store_true",
                    help="print the full decision instead of seconds only")
    ap.add_argument("--peers", default=None,
                    help="comma-separated agent list instead of tmux discovery")
    args = ap.parse_args(argv)

    candidates = None
    if args.peers is not None:
        candidates = [p.strip().lower() for p in args.peers.split(",") if p.strip()]

    decision = plan(args.agent, candidates=candidates)
    if args.arm:
        arm(args.agent, decision)
    if args.json:
        print(json.dumps(decision, separators=(",", ":"), sort_keys=True))
    else:
        print(decision["offset_sec"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
