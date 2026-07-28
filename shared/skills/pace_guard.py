#!/usr/bin/env python3
"""
pace_guard.py — arrivare al 100% della finestra ESATTAMENTE al reset.

Problema osservato (run ThinkPad 2026-07-26, Kimi Allegretto): il team apre
la finestra alle 14:35, la satura al **100% alle 17:00** e resta muto fino al
reset delle 19:43. Due ore e mezza in cui l'utente scrive agli agenti e non
risponde nessuno — il modo più veloce per far disinstallare l'applicazione.

Il pacing esistente non è sbagliato, è **lento ad attuare**: misura ogni 15
min, produce un verdetto testuale, e l'attuazione passa dal Capitano (un LLM
che deve leggere, capire, calcolare un throttle e scriverlo). Nel frattempo
il team continua a bruciare. Quando il Capitano reagisce, l'unico rimedio
rimasto è il freeze totale — che è il fallimento, non la cura.

Questo modulo chiude l'anello in modo **deterministico**:

    usage_ideale(t) = target × (tempo trascorso / durata finestra)

Se il consumo reale sta sopra la curva, il throttle dei worker sale di un
gradino per ogni scarto di `STEP_PCT` punti; se sta sotto, scende. Nessun
LLM nel giro di controllo, nessun freeze: il freno satura a 1h di pausa e
lì si ferma, perché un team lento è recuperabile e un team lockato no.

Il Capitano resta il decisore su COSA far fare al team (chi spawnare, quale
collo di bottiglia sciogliere). Questo modulo decide solo QUANTO IN FRETTA,
che è una divisione (velocità) e non merita un turno di modello.

Uso:
  python3 pace_guard.py                 # valuta e stampa, NON applica
  python3 pace_guard.py --apply         # valuta e scrive il throttle
  python3 pace_guard.py --json          # output machine-readable
  python3 pace_guard.py --target 100    # forza il target di finestra
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


JHT_HOME = Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))
DATA_JSONL = JHT_HOME / "logs" / "sentinel-data.jsonl"

# Durata nominale della finestra rolling, quando non è derivabile dal sample.
DEFAULT_WINDOW_H = 5.0

# Un gradino di throttle ogni `STEP_PCT` punti di scarto dalla curva ideale.
# 6 punti su una finestra da 100 = ~18 minuti di anticipo/ritardo: sotto
# questa soglia è rumore di misura, sopra è una deriva vera.
STEP_PCT = 6.0

# Scala dei throttle (secondi). DEVE restare identica a THROTTLE_LADDER in
# throttle-config.py, che aggancia comunque qualunque valore le si passi: se le
# due divergono, questo modulo sceglie gradini che l'altro poi sposta altrove.
# Gradini in minuti primi (1,2,3,5,7,11,13,17,23,31,41,53,60) invece dei vecchi
# multipli di 5: due worker su gradini diversi si risincronizzavano ogni 10-15
# minuti *per costruzione*, e ogni coincidenza è un picco simultaneo.
LADDER = [0, 60, 120, 180, 300, 420, 660, 780, 1020, 1380, 1860, 2460, 3180,
          3600]

# I worker non scendono mai sotto i 5 minuti (anti-marathon) e non salgono
# mai sopra l'ora: oltre, la cura diventa il KILL, che è decisione del
# Capitano e non di questo modulo.
WORKER_FLOOR = 300
WORKER_CEILING = 3600

# Sopra questa soglia di consumo la finestra è di fatto persa: si frena al
# massimo per lasciare qualcosa alla chat dell'utente (il core interattivo
# NON viene toccato da questo modulo, ma i worker sì).
DANGER_PCT = 95.0


def _load_module(name: str, filename: str):
    """Importa un modulo fratello per path (i nomi con `-` non sono importabili)."""
    for cand in (Path("/app/shared/skills") / filename,
                 Path(__file__).resolve().parent / filename):
        if not cand.exists():
            continue
        try:
            spec = importlib.util.spec_from_file_location(name, cand)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except (OSError, ImportError, AttributeError, SyntaxError):
            continue
    return None


def load_last_sample() -> Optional[dict]:
    if not DATA_JSONL.exists():
        return None
    last = None
    try:
        with DATA_JSONL.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    last = line
    except OSError:
        return None
    if last is None:
        return None
    try:
        return json.loads(last)
    except json.JSONDecodeError:
        return None


def window_bounds(sample: dict, now_unix: float) -> Optional[tuple[float, float]]:
    """(inizio, fine) della finestra corrente in epoch, o None se indeterminabile.

    L'inizio si ricava dal `session_id` del bridge (`YYYYMMDDTHHMMSSZ`, l'istante
    in cui la finestra si è aperta) e solo in mancanza di quello si assume
    `reset − 5h`: l'assunzione è accettabile perché la finestra è rolling e la
    durata nominale è nota, ma il session_id è il dato vero.
    """
    reset = sample.get("reset_at_unix")
    if not isinstance(reset, (int, float)) or isinstance(reset, bool):
        return None
    reset = float(reset)

    start = None
    sid = sample.get("session_id")
    if isinstance(sid, str) and len(sid) >= 16:
        try:
            dt = datetime.strptime(sid[:16], "%Y%m%dT%H%M%SZ")
            start = dt.replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            start = None
    if start is None or start >= reset:
        start = reset - DEFAULT_WINDOW_H * 3600.0

    # Sample stantio (il bridge è fermo da un pezzo): non decidere sul vecchio.
    if now_unix > reset:
        return None
    return start, reset


def elapsed_fraction(start: float, end: float, now_unix: float) -> float:
    span = end - start
    if span <= 0:
        return 1.0
    frac = (now_unix - start) / span
    return min(1.0, max(0.0, frac))


def ideal_usage(target_pct: float, frac: float) -> float:
    """Consumo che il team DOVREBBE avere ora per chiudere a `target` al reset."""
    return target_pct * frac


def _ladder_index(seconds: int) -> int:
    """Gradino corrente: il più alto ≤ seconds (così un valore fuori scala non salta)."""
    idx = 0
    for i, v in enumerate(LADDER):
        if seconds >= v:
            idx = i
    return idx


def step_throttle(current_s: int, steps: int) -> int:
    """Sposta di `steps` gradini sulla ladder, dentro i limiti dei worker."""
    idx = _ladder_index(current_s) + steps
    idx = min(len(LADDER) - 1, max(0, idx))
    value = LADDER[idx]
    return min(WORKER_CEILING, max(WORKER_FLOOR, value))


def evaluate(sample: dict, now_unix: float,
             target_pct: float | None = None,
             current_throttle_s: int = WORKER_FLOOR) -> dict:
    """Verdetto di pacing + throttle consigliato. Funzione pura, nessuna scrittura."""
    usage = sample.get("usage")
    if not isinstance(usage, (int, float)) or isinstance(usage, bool):
        return {"ok": False, "reason": "sample senza usage"}

    bounds = window_bounds(sample, now_unix)
    if bounds is None:
        return {"ok": False, "reason": "finestra non determinabile (sample vecchio?)"}
    start, end = bounds

    if target_pct is None:
        # Il bridge, quando è weekly-aware, sa già a che percentuale deve
        # chiudere la finestra; senza quel dato l'obiettivo è la finestra piena.
        cand = sample.get("target_pct")
        target_pct = float(cand) if isinstance(cand, (int, float)) and not isinstance(cand, bool) else 100.0

    frac = elapsed_fraction(start, end, now_unix)
    ideal = ideal_usage(target_pct, frac)
    deviation = float(usage) - ideal

    # Il pericolo non è il livello in sé — a un minuto dal reset il 99% è
    # l'obiettivo centrato, non un allarme. È pericoloso solo un livello alto
    # raggiunto IN ANTICIPO sulla curva: lì la finestra si chiude davvero
    # prima del tempo e l'utente resta senza risposte.
    if float(usage) >= DANGER_PCT and deviation > STEP_PCT:
        verdict, steps = "LOCKOUT-IMMINENTE", len(LADDER)
    elif deviation > STEP_PCT:
        verdict, steps = "AVANTI", int(deviation // STEP_PCT)
    elif deviation < -STEP_PCT:
        verdict, steps = "INDIETRO", -int((-deviation) // STEP_PCT)
    else:
        verdict, steps = "IN-PARI", 0

    suggested = step_throttle(current_throttle_s, steps)
    return {
        "ok": True,
        "verdict": verdict,
        "usage_pct": round(float(usage), 2),
        "ideal_pct": round(ideal, 2),
        "deviation_pct": round(deviation, 2),
        "target_pct": round(float(target_pct), 2),
        "elapsed_frac": round(frac, 4),
        "minutes_to_reset": int((end - now_unix) // 60),
        "steps": steps,
        "throttle_before_s": current_throttle_s,
        "throttle_after_s": suggested,
        "changed": suggested != current_throttle_s,
    }


def active_workers() -> list[str]:
    """Worker vivi, dai nomi di sessione tmux. Lista vuota se tmux non c'è."""
    import subprocess
    try:
        out = subprocess.run(["tmux", "list-sessions", "-F", "#{session_name}"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        return []
    if out.returncode != 0:
        return []
    roles = ("scout", "analista", "scorer", "scrittore", "critico")
    names = []
    for line in out.stdout.splitlines():
        name = line.strip().lower()
        if name and name.split("-")[0] in roles:
            names.append(name)
    return names


def apply_throttle(workers: list[str], seconds: int) -> dict:
    """Scrive il throttle sui worker indicati. Ritorna {agent: secondi effettivi}."""
    mod = _load_module("throttle_config", "throttle-config.py")
    if mod is None:
        return {}
    # Un agente esentato dal worker floor (config/throttle-floor-exempt.txt) sta
    # girando senza pause per una misura a termine: il pace_guard non lo tocca,
    # altrimenti al primo tick lo riporterebbe sul suo pavimento di 300s e
    # l'esperimento durerebbe cinque minuti. `getattr` con default perché una
    # throttle-config più vecchia non espone la funzione.
    exempt = getattr(mod, "_floor_exempt", None)
    applied = {}
    for agent in workers:
        try:
            if callable(exempt) and exempt(agent):
                applied[agent] = mod.get_agent(agent)
                continue
            mod.set_agent(agent, seconds)
            applied[agent] = mod.get_agent(agent)
        except (OSError, ValueError):
            continue
    return applied


def current_worker_throttle(workers: list[str]) -> int:
    """Throttle rappresentativo del gruppo: il massimo in vigore.

    Il massimo (e non la media) perché il guard ragiona sul freno del team:
    partire dal più frenato evita di allentare per sbaglio chi era già stato
    rallentato apposta dal Capitano.
    """
    mod = _load_module("throttle_config", "throttle-config.py")
    if mod is None or not workers:
        return WORKER_FLOOR
    values = []
    for agent in workers:
        try:
            values.append(int(mod.get_agent(agent)))
        except (OSError, ValueError):
            continue
    return max(values) if values else WORKER_FLOOR


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Guard-rail di pacing sulla finestra")
    ap.add_argument("--apply", action="store_true",
                    help="scrive il throttle consigliato sui worker vivi")
    ap.add_argument("--json", action="store_true", help="output JSON")
    ap.add_argument("--target", type=float, default=None,
                    help="target %% di finestra al reset (default: dal bridge, o 100)")
    args = ap.parse_args(argv)

    sample = load_last_sample()
    if sample is None:
        msg = {"ok": False, "reason": "nessun sample dal bridge"}
        print(json.dumps(msg) if args.json else msg["reason"], file=sys.stderr)
        return 1

    workers = active_workers()
    current = current_worker_throttle(workers)
    now = datetime.now(timezone.utc).timestamp()
    result = evaluate(sample, now, target_pct=args.target, current_throttle_s=current)
    result["workers"] = workers

    if args.apply and result.get("ok") and result.get("changed") and workers:
        result["applied"] = apply_throttle(workers, result["throttle_after_s"])

    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    elif not result.get("ok"):
        print(result.get("reason", "errore"), file=sys.stderr)
    else:
        print(f"{result['verdict']}: usage={result['usage_pct']}% "
              f"ideale={result['ideal_pct']}% (scarto {result['deviation_pct']:+}pt) "
              f"| throttle {result['throttle_before_s']}s → {result['throttle_after_s']}s "
              f"| reset fra {result['minutes_to_reset']} min "
              f"| worker: {', '.join(workers) if workers else 'nessuno'}")
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
