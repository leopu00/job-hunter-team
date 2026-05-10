#!/usr/bin/env python3
"""
usage_record — scrive un sample di usage nel JSONL del bridge.

La sorgente del sample (chi ha fatto il check) viene marcata nel campo
`source`. Permette al grafico di mostrare con colori diversi chi ha
fatto cosa, e al sistema di tracciare la sequenza di osservazioni.

Due modalità:

  --from-api         legge il dato fresco dal provider (riusa il fetcher
                     del bridge, provider-aware via jht.config.json).
                     Usato da Capitano e Sentinella per check on-demand.

  --manual           scrive un sample dato in input. Usato dalla
                     Sentinella quando ha letto i numeri da un capture-
                     pane di un worker tmux (fallback /usage TUI) e
                     deve registrarli nel grafico a mano.

In entrambi i casi compute_metrics calcola velocity/projection τ-aware
in base alla history disponibile nel JSONL.

Uso:

  python3 usage_record.py --from-api --source capitano
  python3 usage_record.py --from-api --source sentinella-api
  python3 usage_record.py --manual --usage 45 --reset-at 21:05 \\
                          --provider openai --source sentinella-worker

Output: il sample scritto, JSON.
Exit code: 0 ok, 2 fail (API down / parse error / missing input), 3 config error.

Source labels riconosciute (per evitare typo):
  bridge              — il bridge Python originario (clock + tick)
  capitano            — il Capitano LLM via skill on-demand
  sentinella-api      — la Sentinella LLM, ramo API diretto
  sentinella-worker   — la Sentinella LLM, fallback TUI worker tmux
  manual              — chiunque, debug
"""

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht")))
LOGS_DIR = JHT_HOME / "logs"
DATA_JSONL = LOGS_DIR / "sentinel-data.jsonl"

VALID_SOURCES = {
    "bridge",
    "capitano",
    "sentinella-api",
    "sentinella-worker",
    "manual",
}

HISTORY_LOOKBACK = 30  # sample da considerare per burst filter / EMA


def _load_module(path, name):
    """Path-import di un modulo .py (sentinel-bridge ha trattino, le
    skill sono al fianco). Se non esiste ritorna None."""
    p = Path(path)
    if not p.exists():
        return None
    spec = importlib.util.spec_from_file_location(name, p)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
        return mod
    except Exception as e:
        print(f"[usage_record] errore caricamento {path}: {e}", file=sys.stderr)
        return None


def load_compute_metrics():
    here = Path(__file__).resolve().parent
    mod = _load_module(here / "compute_metrics.py", "compute_metrics")
    if mod is None:
        print("[usage_record] compute_metrics.py non trovato", file=sys.stderr)
        sys.exit(3)
    return mod


def load_bridge():
    """Necessario per --from-api (riusa fetch_kimi/claude/codex e
    read_config). Path-import perché il bridge ha trattino nel nome."""
    candidates = [
        Path("/app/.launcher/sentinel-bridge.py"),
        Path(__file__).resolve().parent.parent.parent / ".launcher" / "sentinel-bridge.py",
    ]
    for p in candidates:
        mod = _load_module(p, "sentinel_bridge")
        if mod is not None:
            return mod
    return None


def load_history():
    """Carica gli ultimi N sample dal JSONL. Tollerante a righe corrotte."""
    if not DATA_JSONL.exists():
        return []
    samples = []
    try:
        with DATA_JSONL.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    samples.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        return []
    return samples[-HISTORY_LOOKBACK:]


def find_last_same_provider(samples, provider):
    for s in reversed(samples):
        if s.get("provider") == provider:
            return s
    return None


def append_sample(sample):
    """Append atomico. Crea la dir/file se non esiste."""
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    line = json.dumps(sample, ensure_ascii=False) + "\n"
    with DATA_JSONL.open("a", encoding="utf-8") as f:
        f.write(line)


PROVIDER_FETCHERS = {
    "claude": "fetch_claude_api",
    "anthropic": "fetch_claude_api",
    "kimi": "fetch_kimi_api",
    "moonshot": "fetch_kimi_api",
    "openai": "fetch_codex_rollout",
    "codex": "fetch_codex_rollout",
}


def fetch_from_api():
    """Riusa i fetch del bridge per leggere il dato fresco. Ritorna
    parsed dict o None su fail / provider non supportato."""
    bridge = load_bridge()
    if bridge is None:
        print("[usage_record] bridge non importabile per --from-api", file=sys.stderr)
        return None, "bridge_unavailable"

    try:
        _tick, provider = bridge.read_config()
    except Exception as e:
        return None, f"read_config_error:{e}"

    fn_name = PROVIDER_FETCHERS.get((provider or "").lower())
    if fn_name is None or not hasattr(bridge, fn_name):
        return None, f"unsupported_provider:{provider}"

    try:
        sample = getattr(bridge, fn_name)()
    except Exception as e:
        return None, f"fetch_error:{e}"

    if not sample:
        return None, "fetch_empty"

    sample["provider"] = provider
    return sample, None


def make_sample(parsed, source):
    """Calcola le metriche derivate e marca il source."""
    cm = load_compute_metrics()
    history = load_history()
    last = find_last_same_provider(history, parsed.get("provider"))
    sample = cm.compute_metrics(parsed, last, history=history)
    sample["source"] = source
    return sample


def main():
    ap = argparse.ArgumentParser()
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--from-api", action="store_true",
                      help="fetch fresco dal provider attivo")
    mode.add_argument("--manual", action="store_true",
                      help="scrive sample con dati passati a mano")

    ap.add_argument("--source", required=True,
                    help=f"chi sta scrivendo. Valori: {', '.join(sorted(VALID_SOURCES))}")
    ap.add_argument("--usage", type=float,
                    help="(--manual) percentuale usage")
    ap.add_argument("--reset-at",
                    help="(--manual) reset HH:MM UTC")
    ap.add_argument("--provider",
                    help="(--manual) provider, default da config")
    ap.add_argument("--weekly", type=int, default=None,
                    help="(--manual) opzionale weekly usage %")
    args = ap.parse_args()

    if args.source not in VALID_SOURCES:
        print(f"[usage_record] source '{args.source}' non valido. "
              f"Usa uno di: {', '.join(sorted(VALID_SOURCES))}", file=sys.stderr)
        sys.exit(2)

    if args.from_api:
        parsed, err = fetch_from_api()
        if parsed is None:
            print(f"[usage_record] FAIL --from-api reason={err}", file=sys.stderr)
            sys.exit(2)
    else:  # --manual
        if args.usage is None or not args.reset_at:
            print("[usage_record] --manual richiede --usage e --reset-at", file=sys.stderr)
            sys.exit(2)
        provider = args.provider
        if not provider:
            bridge = load_bridge()
            if bridge is not None:
                try:
                    _tick, provider = bridge.read_config()
                except Exception:
                    provider = "openai"
            else:
                provider = "openai"
        parsed = {
            "usage": args.usage,
            "reset_at": args.reset_at,
            "provider": provider,
            "weekly_usage": args.weekly,
        }

    sample = make_sample(parsed, args.source)
    append_sample(sample)
    print(json.dumps(sample, ensure_ascii=False))


if __name__ == "__main__":
    main()
