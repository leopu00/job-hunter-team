#!/usr/bin/env python3
"""agent-speed-table.py — velocità per agente + tabella throttle pre-calcolata.

Pensata per essere consumata dal Capitano (prompt o skill) e dalla UI:
risponde alla domanda "se rallento l'agente X di N min/h, di quanto scende
il consumo team?" con numeri pronti, senza che il Capitano debba fare
matematica.

Logica:
  1. Δusage_team = usage_last - usage_first nei sentinel-data.jsonl ricaduti
     dentro la finestra `--since-min`.
  2. team_kt = somma weighted dei token consumati dal team nella stessa
     finestra (riusa la pipeline di token-by-agent-series.py — pesi 1.0
     uniformi, coerenti col rate limit Kimi).
  3. ratio_kt_per_pct = team_kt / Δusage_team   (il "kT macro" reale del
     team in questa finestra). È la conversione kT → % che useremo.
  4. Per ogni agente: kt_per_h e pct_per_h = (kt_per_h) / ratio.
  5. Tabella throttle: per pause ∈ {10, 15, 20, 30} min/h:
       saves_pct_h_agent = pct_per_h_agent * pause/60
       saves_team_pct_pct = saves_pct_h_agent / team_speed_pct_h * 100
     (cioè quanto la pause taglia in valore assoluto al rate, e che %
     del consumo team rappresenta).

Caveat (lo dico esplicitamente nel JSON, così il Capitano non si illude):
  - La velocità è wall-clock, NON "active". Se l'agente ha già pause naturali
    nei tempi morti, il throttle si sovrappone parzialmente — il risparmio
    reale può essere < di quello stimato. Per i due agenti che dominano
    (scout/scrittore) la frequenza eventi è alta e l'errore è piccolo.
  - Il calcolo ignora agenti sotto `--min-pct-h` (default 0.20 %/h): quelli
    contribuiscono troppo poco perché throttlarli faccia differenza.

Schema output:
{
  "ok": true,
  "now": "...",
  "since": "...",
  "window_min": 180,
  "team": {
    "kt": 68403.7,
    "delta_usage_pct": 47,
    "ratio_kt_per_pct": 1455.4,
    "speed_pct_per_h": 15.67
  },
  "agents": [
    {
      "name": "scout-1",
      "events": 294,
      "kt": 37470.6,
      "kt_per_h": 12490.2,
      "pct_per_h": 8.58,
      "team_share_pct": 54.7,
      "throttle_options": [
        {"pause_min_per_h": 10, "saves_pct_h": 1.43, "saves_team_pct": 9.1},
        ...
      ]
    },
    ...
  ],
  "skipped_agents": [
    {"name": "assistente", "pct_per_h": 0.10, "reason": "below threshold"},
    ...
  ],
  "caveats": [
    "Velocità misurata wall-clock: ...",
    ...
  ]
}
"""
import argparse
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
SENTINEL_JSONL = JHT_HOME / "logs" / "sentinel-data.jsonl"

# Soglia sotto cui un agente è troppo poco influente per essere throttlato.
DEFAULT_MIN_PCT_H = 0.20

# Pause options pre-calcolate (min/h) — coprono il range tipico tra
# "tocco leggero" (10 min) e "freno forte" (30 min). Il Capitano sceglie
# quella che porta team_speed sotto la sua soglia obiettivo.
PAUSE_OPTIONS_MIN = [10, 15, 20, 30]

# Watchdog: range accettabile di ratio_kt_per_pct calcolata. Se siamo
# fuori, qualcosa e' cambiato (Kimi ha cambiato il rate model, bridge
# sballato, composizione team estrema). NON cambiamo i pesi
# automaticamente — emettiamo un warning per chi consuma il JSON.
# Cfr docs/internal/2026-05-03-rate-kimi-weights.md per il razionale.
RATIO_OK_MIN_KT_PER_PCT = 25.0
RATIO_OK_MAX_KT_PER_PCT = 60.0


def _load_skill_module():
    """Path-import di token-by-agent-series.py per riusarne `collect_events`
    senza copiare la logica wire/state parsing."""
    here = Path(__file__).resolve().parent
    target = here / "token-by-agent-series.py"
    spec = importlib.util.spec_from_file_location("tba_series", str(target))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _parse_iso(s):
    if not isinstance(s, str):
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, TypeError):
        return None


def _team_delta_usage(since_ts: float, now_ts: float):
    """Ritorna (usage_first, usage_last, n_samples) dentro la finestra,
    leggendo sentinel-data.jsonl. Se file mancante o samples insufficienti
    ritorna None."""
    if not SENTINEL_JSONL.exists():
        return None
    samples = []
    try:
        with SENTINEL_JSONL.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ts = _parse_iso(e.get("ts"))
                if ts is None:
                    continue
                t = ts.timestamp()
                if t < since_ts or t > now_ts:
                    continue
                u = e.get("usage")
                if not isinstance(u, (int, float)):
                    continue
                samples.append((t, float(u)))
    except OSError:
        return None
    if len(samples) < 2:
        return None
    samples.sort()
    return samples[0][1], samples[-1][1], len(samples)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since-min", type=float, default=180.0,
                    help="finestra in minuti (default 180 = 3h)")
    ap.add_argument("--min-pct-h", type=float, default=DEFAULT_MIN_PCT_H,
                    help=f"soglia minima %/h per includere agente "
                         f"(default {DEFAULT_MIN_PCT_H})")
    args = ap.parse_args()

    now = datetime.now(timezone.utc)
    since = now - timedelta(minutes=args.since_min)
    now_ts = now.timestamp()
    since_ts = since.timestamp()
    window_h = args.since_min / 60.0

    tba = _load_skill_module()
    by_agent = tba.collect_events(since_ts)

    # Totali kT per agente
    agent_kt = {a: sum(w for _, w in evs) / 1000.0 for a, evs in by_agent.items()}
    agent_events = {a: len(evs) for a, evs in by_agent.items()}
    team_kt = sum(agent_kt.values())

    # Δusage del team dalla telemetria del bridge (sentinel-data.jsonl).
    delta_info = _team_delta_usage(since_ts, now_ts)
    if delta_info is None:
        json.dump({
            "ok": False,
            "error": "insufficient sentinel-data samples in window",
            "now": now.isoformat(),
            "since": since.isoformat(),
        }, sys.stdout)
        return

    u_first, u_last, n_samples = delta_info
    delta_usage = u_last - u_first
    if delta_usage <= 0 or team_kt <= 0:
        json.dump({
            "ok": False,
            "error": f"non-positive delta (Δusage={delta_usage}, team_kt={team_kt})",
            "now": now.isoformat(),
            "since": since.isoformat(),
        }, sys.stdout)
        return

    ratio = team_kt / delta_usage              # kT per ogni 1% di usage
    team_speed_pct_h = delta_usage / window_h  # %/h del team in finestra

    # Per ogni agente: speed + tabella throttle.
    agents_out = []
    skipped = []
    for name in sorted(agent_kt.keys(), key=lambda a: -agent_kt[a]):
        kt = agent_kt[name]
        kt_per_h = kt / window_h
        pct_per_h = kt_per_h / ratio
        share = (pct_per_h / team_speed_pct_h) * 100.0 if team_speed_pct_h > 0 else 0.0

        if pct_per_h < args.min_pct_h:
            skipped.append({
                "name": name,
                "kt": round(kt, 2),
                "pct_per_h": round(pct_per_h, 3),
                "reason": f"below threshold ({args.min_pct_h} %/h)",
            })
            continue

        opts = []
        for pause in PAUSE_OPTIONS_MIN:
            saves_pct_h = pct_per_h * (pause / 60.0)
            saves_team_pct = (saves_pct_h / team_speed_pct_h) * 100.0
            opts.append({
                "pause_min_per_h": pause,
                "saves_pct_h": round(saves_pct_h, 2),
                "saves_team_pct": round(saves_team_pct, 1),
            })

        agents_out.append({
            "name": name,
            "events": agent_events[name],
            "kt": round(kt, 2),
            "kt_per_h": round(kt_per_h, 1),
            "pct_per_h": round(pct_per_h, 2),
            "team_share_pct": round(share, 1),
            "throttle_options": opts,
        })

    # Watchdog ratio: vedi commento al top del file e doc 2026-05-03.
    warnings = []
    if ratio < RATIO_OK_MIN_KT_PER_PCT:
        warnings.append(
            f"ratio_kt_per_pct={ratio:.1f} sotto soglia "
            f"{RATIO_OK_MIN_KT_PER_PCT} kT/%: pesi possibilmente "
            f"fuori taratura. Vedi docs/internal/2026-05-03-rate-kimi-weights.md"
        )
    elif ratio > RATIO_OK_MAX_KT_PER_PCT:
        warnings.append(
            f"ratio_kt_per_pct={ratio:.1f} sopra soglia "
            f"{RATIO_OK_MAX_KT_PER_PCT} kT/%: pesi possibilmente "
            f"fuori taratura (Kimi ha cambiato modello? cache_read sta "
            f"contando di nuovo?). Vedi docs/internal/2026-05-03-rate-kimi-weights.md"
        )

    out = {
        "ok": True,
        "now": now.isoformat(),
        "since": since.isoformat(),
        "window_min": args.since_min,
        "team": {
            "kt": round(team_kt, 2),
            "delta_usage_pct": round(delta_usage, 2),
            "ratio_kt_per_pct": round(ratio, 2),
            "ratio_in_range": (
                RATIO_OK_MIN_KT_PER_PCT <= ratio <= RATIO_OK_MAX_KT_PER_PCT
            ),
            "speed_pct_per_h": round(team_speed_pct_h, 2),
            "samples": n_samples,
        },
        "agents": agents_out,
        "skipped_agents": skipped,
        "warnings": warnings,
        "caveats": [
            "speed misurata wall-clock: il throttle si somma alle pause "
            "naturali, l'effetto reale puo essere < dello stimato per "
            "agenti con eventi sporadici",
            f"agenti sotto {args.min_pct_h} %/h non sono throttabili "
            "utilmente (rumore)",
            "ratio_kt_per_pct e' valido per la finestra corrente; cambia "
            "se cambia la composizione degli agenti attivi",
            f"pesi token (1, 1, 0, 0) hardcoded — range atteso ratio "
            f"{RATIO_OK_MIN_KT_PER_PCT}-{RATIO_OK_MAX_KT_PER_PCT} kT/%, "
            f"se fuori vedi warnings[]",
        ],
    }
    json.dump(out, sys.stdout, separators=(",", ":"))


if __name__ == "__main__":
    main()
