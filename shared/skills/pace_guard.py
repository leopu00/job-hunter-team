#!/usr/bin/env python3
"""
pace_guard.py — misurare la curva della finestra e CONSIGLIARE il throttle.

Problema osservato (run ThinkPad 2026-07-26, Kimi Allegretto): il team apre
la finestra alle 14:35, la satura al **100% alle 17:00** e resta muto fino al
reset delle 19:43. Due ore e mezza in cui l'utente scrive agli agenti e non
risponde nessuno — il modo più veloce per far disinstallare l'applicazione.

Questo modulo misura quanto il team è avanti o indietro rispetto alla curva:

    usage_ideale(t) = target × (tempo trascorso / durata finestra)

Dallo scarto ricava il gradino di throttle che rimetterebbe il team in pari:
uno per ogni `STEP_PCT` punti di deriva, saturando a 1h di pausa (un team
lento è recuperabile, uno lockato no).

Quel numero è un **consiglio**, non un comando. Il bridge lo scrive nel pane
del Capitano ed è il Capitano ad applicarlo con `throttle-config.py`
(vedi `advice_line`). Nessun automatismo tocca il throttle al posto suo —
decisione dell'utente, 2026-07-28: il throttle non è una divisione da
delegare a uno script, è **distribuzione di lavoro fra agenti**, e la decide
chi conosce il piano (chi sta lavorando a cosa, quale collo di bottiglia è
aperto, chi ha appena ricevuto un ordine). Uno script che scriveva il
throttle da solo si metteva davanti a quella decisione e si contendeva il
volante con il Capitano, che dal canto suo aggiustava a sua volta.

Fuori da questa scelta restano le **reti di sicurezza**, che non sono pacing
e continuano a scattare da sole: il `WORKER_FLOOR` di 5 minuti applicato da
`throttle-config.py` a ogni lettura e il daily hard-stop del bridge. Questo
modulo non li tocca e non li sostituisce: sono la protezione dal disastro
(burn notturna 2026-07-15, avvenuta con floor e hard-stop disattivati),
mentre il pacing è solo la scelta della velocità di crociera.

Uso:
  python3 pace_guard.py                 # misura e stampa il consiglio
  python3 pace_guard.py --apply         # scrive il throttle (MANUALE: nessun
                                        # automatismo passa mai di qui)
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
# ⚠️ WORKER_FLOOR è una RETE DI SICUREZZA, non pacing: `throttle-config.py` lo
# applica comunque a ogni lettura del throttle, qualunque cosa consigli questo
# modulo. Le due copie devono restare identiche (sono già divergute una volta).
WORKER_FLOOR = 300
WORKER_CEILING = 3600

# Sopra questa soglia di consumo la finestra è di fatto persa: si consiglia il
# freno massimo per lasciare qualcosa alla chat dell'utente (il core interattivo
# non entra mai in questo conto, solo i worker).
DANGER_PCT = 95.0

# Envelope e tag della riga che il bridge scrive nel pane del Capitano. Il tag
# è il punto di aggancio della sua skill: cambiarlo significa cambiare il
# contratto con lei, non solo un'etichetta.
ADVICE_ENVELOPE = "[@bridge -> @capitano]"
ADVICE_TAG = "[PACE-GUARD]"
THROTTLE_CLI = "python3 /app/shared/skills/throttle-config.py"


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
    """Verdetto di pacing + throttle consigliato.

    Funzione **pura**: legge un sample e ritorna numeri. Non scrive il
    throttle, non tocca file, non manda messaggi — chi decide è il Capitano,
    che riceve `advice_line()` nel suo pane.
    """
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
        # `current`/`recommended` e non `before`/`after`: nessuno applica nulla,
        # quindi non esiste un "dopo" — esiste solo ciò che il Capitano farebbe
        # bene a scrivere.
        "throttle_current_s": current_throttle_s,
        "throttle_recommended_s": suggested,
        "recommends_change": suggested != current_throttle_s,
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


def _exempt_checker():
    """`_floor_exempt` di throttle-config, o None se non disponibile.

    `getattr` con default perché una throttle-config più vecchia non espone la
    funzione: in quel caso non si esenta nessuno (direzione sicura).
    """
    mod = _load_module("throttle_config", "throttle-config.py")
    if mod is None:
        return None
    fn = getattr(mod, "_floor_exempt", None)
    return fn if callable(fn) else None


def advisable_workers(workers: list[str]) -> list[str]:
    """I worker su cui ha senso raccomandare un throttle.

    Esclude chi è esentato dal worker floor (config/throttle-floor-exempt.txt):
    sta girando senza pause per una misura a termine, e un consiglio che lo
    include farebbe finire l'esperimento in cinque minuti. È la stessa
    esclusione che `apply_throttle` ha sempre fatto, spostata nel consiglio
    ora che è il Capitano a scrivere.
    """
    exempt = _exempt_checker()
    if exempt is None:
        return list(workers)
    out = []
    for agent in workers:
        try:
            if not exempt(agent):
                out.append(agent)
        except OSError:
            out.append(agent)
    return out


def advice_line(result: dict, workers: list[str] | None = None,
                targets: list[str] | None = None) -> str:
    """La riga che il bridge scrive nel pane del Capitano.

    UNA riga sola, perché è così che si legge un pane, e di formato stabile,
    perché la skill del Capitano ci si aggancia. Contiene tutto ciò che serve
    per decidere senza aprire un file: verdetto, distanza dalla curva, valore
    consigliato e il comando pronto da eseguire. Dice esplicitamente che il
    freno NON è stato applicato: prima di oggi questa riga arrivava a cose
    fatte, ora è una richiesta di decisione.
    """
    workers = list(workers or [])
    if targets is None:
        targets = advisable_workers(workers)
    rec = result["throttle_recommended_s"]
    cmd = (f"{THROTTLE_CLI} bulk-set "
           + " ".join(f"{a}={rec}" for a in targets)) if targets else ""
    parts = [
        f"{ADVICE_ENVELOPE} {ADVICE_TAG} {result['verdict']} "
        f"— CONSIGLIO, THROTTLE NON APPLICATO",
        f"usage={result['usage_pct']}% vs curva={result['ideal_pct']}% "
        f"({result['deviation_pct']:+}pt sul target {result['target_pct']}% al reset)",
        f"reset fra {result['minutes_to_reset']} min",
        f"throttle worker ORA {result['throttle_current_s']}s "
        f"→ CONSIGLIATO {rec}s ({result['steps']:+} gradini)",
        f"worker: {', '.join(workers) if workers else 'nessuno'}",
    ]
    if result.get("verdict") == "LOCKOUT-IMMINENTE":
        parts.append("il freno da solo non basta: valuta di ridurre il ROSTER "
                     "(togli uno Scout, mai l'Analista o lo Scorer)")
    parts.append(
        f"decidi tu e applica: {cmd}" if cmd
        else "nessun worker su cui agire (tutti esenti dal floor): decidi tu")
    return " | ".join(parts)


def apply_throttle(workers: list[str], seconds: int) -> dict:
    """Scrive il throttle sui worker indicati. Ritorna {agent: secondi effettivi}.

    ⚠️ Nessun automatismo chiama questa funzione: il bridge misura e consiglia,
    l'attuazione è del Capitano via `throttle-config.py`. Resta qui come API
    esplicita (CLI `--apply`, invocata a mano) — cancellarla non renderebbe il
    sistema più sicuro, la scrittura del throttle esiste comunque dall'altra
    parte; a contare è CHI la chiama.
    """
    mod = _load_module("throttle_config", "throttle-config.py")
    if mod is None:
        return {}
    # Un agente esentato dal worker floor (config/throttle-floor-exempt.txt) sta
    # girando senza pause per una misura a termine: non lo si tocca, altrimenti
    # lo si riporterebbe sul suo pavimento di 300s e l'esperimento durerebbe
    # cinque minuti.
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
    ap = argparse.ArgumentParser(description="Consigliere di pacing sulla finestra")
    ap.add_argument("--apply", action="store_true",
                    help="MANUALE: scrive il throttle consigliato sui worker vivi. "
                         "Il bridge non usa mai questo flag — la via normale è il "
                         "Capitano con throttle-config.py")
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

    if result.get("ok"):
        result["advice"] = advice_line(result, workers)

    if args.apply and result.get("ok") and result.get("recommends_change") and workers:
        result["applied"] = apply_throttle(
            workers, result["throttle_recommended_s"])

    if args.json:
        print(json.dumps(result, ensure_ascii=False))
    elif not result.get("ok"):
        print(result.get("reason", "errore"), file=sys.stderr)
    else:
        # Stessa riga che riceve il Capitano: quello che si legge qui è
        # esattamente quello che gli arriva nel pane.
        print(result["advice"])
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
