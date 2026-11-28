#!/usr/bin/env python3
"""scaling_calc.py — calibrazione graduale del roster (2026-06-26).

Risponde alla domanda del Capitano dopo la fase di osservazione:
*"1 worker al floor ha consumato X in 30 min; per centrare la velocità-target
 sostenibile, quanti worker devo spawnare e con quale throttle?"*

Modello (semplice e spiegabile):
  - Un worker a throttle T brucia `b` (per-worker, stessa unità del target —
    consiglio: % weekly / h). Empiricamente il burn scala ~∝ 1/cycle ≈ 1/throttle
    (più lunga la pausa, meno brucia), quindi il PRODOTTO `P = b × T` è ~costante
    per worker (l'invariante che misuriamo nella fase di osservazione).
  - N worker a throttle T → burn_team ≈ N × P / T.
  - Per centrare il target S:   T = N × P / S   (con T ≥ floor 300s).
  - Il N "naturale" se tutti al floor:  N_floor = S × 300 / P.

Output: roster consigliato (N) + throttle (T, agganciato alla ladder) + un piano
di spawn A SCAGLIONI (uno per volta, ri-misurando in mezzo), così si sale di
marcia per gradini invece che in 6ª (l'errore ACCELERARE→throttle 0).

NB: l'attesa fra uno step e il successivo è una finestra di OSSERVAZIONE, non
uno sfasamento. La distanza di fase fra due worker dello stesso gradino la
ricava il launcher dal periodo reale (`T/N`, vedi `shared/skills/spawn_stagger.py`)
e la applica da sé: non è un numero che vada deciso qui.

Uso:
  scaling_calc.py --target 0.7 --measured 1.4                 # 1 worker osservato @ floor
  scaling_calc.py --target 0.7 --measured 2.1 --workers 2 --throttle 600
  scaling_calc.py --self-test

Le unità di --target e --measured devono COINCIDERE (sono in rapporto): passa
entrambe in % weekly / h, entrambe in % finestra-5h / h, oppure, con un accesso a
consumo (chiave API, budget in dollari), entrambe in USD al minuto con
`--unit usd-min`. Con `--measured-from-spend` il burn misurato e il numero di
worker li prende dalla spesa VERA degli ultimi 10 minuti (pi_spend_cap.py now):
mai un costo per worker stimato a mano (misurato una volta: 0,011 $/min stimati,
0,15 $/min veri).

  scaling_calc.py --unit usd-min --target 0.05 --measured-from-spend
"""
import argparse
import sys
from pathlib import Path
import importlib.util

FLOOR = 300          # floor worker (5min) — coerente con throttle-config.WORKER_FLOOR
LADDER = [300, 600, 900, 1200, 1500, 1800, 2400, 3000, 3600]
REMEASURE_MIN = 10   # minuti di osservazione prima dello step successivo
MAX_WORKERS = 8      # tetto di sicurezza anti-runaway


def _quantize(seconds: float) -> int:
    """Aggancia alla ladder (floor 5min, cap 1h). Stessa logica di throttle-config."""
    s = float(seconds)
    if s <= LADDER[0]:
        return LADDER[0]
    if s >= LADDER[-1]:
        return LADDER[-1]
    return min(LADDER, key=lambda x: abs(x - s))


def recommend(target_burn, measured_burn, workers_observed=1, throttle_observed=FLOOR):
    """Ritorna dict con roster (N), throttle (T) e piano di spawn a scaglioni.

    target_burn / measured_burn: stessa unità (% /h). workers_observed: quanti
    worker hanno prodotto measured_burn. throttle_observed: il throttle a cui
    giravano (default floor)."""
    S = float(target_burn)
    n_obs = max(1, int(workers_observed))
    T_obs = max(FLOOR, float(throttle_observed))
    b_per = float(measured_burn) / n_obs          # burn per-worker a T_obs

    if b_per <= 0 or S <= 0:
        return {
            "ok": False,
            "reason": "dati insufficienti (burn o target <= 0): osserva ancora un worker al floor",
            "workers": max(1, n_obs),
            "throttle_s": FLOOR,
            "plan": [],
        }

    P = b_per * T_obs                              # invariante per-worker

    # N "naturale" se tutti al floor; arrotonda al più vicino, min 1, cap di sicurezza
    n_floor = S * FLOOR / P
    N = max(1, min(MAX_WORKERS, round(n_floor)))

    # throttle esatto per N worker a centrare S; mai sotto il floor
    T = _quantize(max(FLOOR, N * P / S))

    # burn atteso col roster consigliato
    burn_expected = N * P / T

    # piano a scaglioni: uno per volta, REMEASURE_MIN di osservazione in mezzo
    plan = []
    for i in range(1, N + 1):
        plan.append({
            "step": i,
            "action": f"spawn worker #{i} @ throttle {T}s ({T//60}min)",
            "wait_after_min": REMEASURE_MIN if i < N else 0,
            "then": "ri-misura il burn reale e ricalcola prima del prossimo" if i < N else "roster a regime",
        })

    return {
        "ok": True,
        "target_burn": S,
        "measured_per_worker": round(b_per, 3),
        "invariant_P": round(P, 1),
        "workers": N,
        "throttle_s": T,
        "throttle_min": T // 60,
        "burn_expected": round(burn_expected, 3),
        "note": ("1 worker già basta: alza il throttle e tieni il roster a 1"
                 if N == 1 and T > FLOOR else
                 "spalma su più worker AL FLOOR" if T == FLOOR and N > 1 else
                 "roster + throttle combinati"),
        "plan": plan,
    }


UNITS = {"pct-h": "/h", "usd-min": " USD/min"}


def measured_from_spend():
    """(USD/min of the workers in the last 10 minutes, how many workers spent) from the brake's own measure, or None."""
    for folder in (Path("/app/shared/skills"), Path(__file__).resolve().parents[3] / "shared" / "skills"):
        if (folder / "pi_spend_cap.py").is_file():
            sys.path.insert(0, str(folder))
            break
    try:
        import time
        import pi_spend_cap
        r = pi_spend_cap.report(pi_spend_cap._cli_home(), time.time())
    except Exception:  # noqa: BLE001 - no measure: the caller says so
        return None
    return r["workers_usd_per_min"], r["workers"]


def _fmt(r, unit="pct-h") -> str:
    u = UNITS.get(unit, "/h")
    if not r.get("ok"):
        return f"⚠️  {r['reason']}\n→ tieni {r['workers']} worker @ {r['throttle_s']}s."
    out = []
    out.append(f"🎯 target burn = {r['target_burn']}{u}  |  misurato/worker = {r['measured_per_worker']}{u}")
    out.append(f"📐 CONSIGLIO: {r['workers']} worker @ throttle {r['throttle_s']}s "
               f"({r['throttle_min']}min) → burn atteso ≈ {r['burn_expected']}{u}")
    out.append(f"   ({r['note']})")
    out.append("📈 piano a scaglioni (NON spawnare in blocco):")
    for s in r["plan"]:
        w = (f"  → osserva {s['wait_after_min']}min, {s['then']}"
             if s["wait_after_min"] else f"  → {s['then']}")
        out.append(f"   {s['step']}. {s['action']}\n   {w}")
    return "\n".join(out)


def _self_test():
    ok = True

    def check(name, cond):
        nonlocal ok
        print(f"  {'✓' if cond else '✗'} {name}")
        ok = ok and cond

    # 1 worker già over-target → resta 1, alza throttle
    r = recommend(target_burn=0.7, measured_burn=1.4, workers_observed=1, throttle_observed=300)
    check("over-target: 1 worker, throttle alzato sopra floor", r["workers"] == 1 and r["throttle_s"] > 300)
    check("over-target: burn atteso ~target", abs(r["burn_expected"] - 0.7) < 0.2)

    # worker lento → servono più worker al floor
    r2 = recommend(target_burn=0.7, measured_burn=0.3, workers_observed=1, throttle_observed=300)
    check("under-target: più worker", r2["workers"] >= 2)
    check("under-target: al floor", r2["throttle_s"] == 300)

    # spawn a scaglioni col distacco
    check("piano a scaglioni con finestra di osservazione",
          all(s["wait_after_min"] in (0, REMEASURE_MIN) for s in r2["plan"]))
    check("ultimo step senza wait", r2["plan"][-1]["wait_after_min"] == 0)

    # mai sotto il floor
    r3 = recommend(target_burn=5.0, measured_burn=0.1, workers_observed=1)
    check("throttle mai sotto floor", r3["throttle_s"] >= 300)
    check("cap worker rispettato", r3["workers"] <= MAX_WORKERS)

    # dati nulli → degrada con grazia
    r4 = recommend(target_burn=0.7, measured_burn=0, workers_observed=1)
    check("burn 0 → not ok, fallback 1 worker", (not r4["ok"]) and r4["workers"] == 1)

    print("OK" if ok else "FAIL")
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(prog="scaling-calc")
    ap.add_argument("--target", type=float, help="velocità-target sostenibile (%%/h, stessa unità di --measured)")
    ap.add_argument("--measured", type=float, help="burn misurato dei worker osservati (%%/h)")
    ap.add_argument("--workers", type=int, default=1, help="quanti worker hanno prodotto --measured (default 1)")
    ap.add_argument("--throttle", type=float, default=FLOOR, help="throttle dei worker osservati in s (default floor 300)")
    ap.add_argument("--unit", choices=sorted(UNITS), default="pct-h",
                    help="unit of --target and --measured: pct-h (%%/h, default) or usd-min (USD per minute)")
    ap.add_argument("--measured-from-spend", action="store_true",
                    help="burn and workers measured from the spending of the last 10 min (pi_spend_cap.py now); implies --unit usd-min")
    ap.add_argument("--json", action="store_true", help="output JSON")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        return _self_test()
    if args.measured_from_spend:
        args.unit = "usd-min"
        seen = measured_from_spend()
        if seen is None:
            ap.error("measured spending unreadable: pass --measured in USD/min (pi_spend_cap.py now)")
        args.measured, observed = seen
        if observed:
            args.workers = observed
    if args.target is None or args.measured is None:
        ap.error("servono --target e --measured (oppure --measured-from-spend, oppure --self-test)")

    r = recommend(args.target, args.measured, args.workers, args.throttle)
    r["unit"] = args.unit
    if args.json:
        import json
        print(json.dumps(r, indent=2))
    else:
        print(_fmt(r, args.unit))
    return 0


if __name__ == "__main__":
    sys.exit(main())
