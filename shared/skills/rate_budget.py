#!/usr/bin/env python3
"""
rate_budget — helper per il Capitano: legge l'ultimo tick dal bridge
(sentinel-bridge.py) e produce un riassunto leggibile del budget di
rate-limit del provider attivo. Usato dal Capitano all'avvio per
decidere quanti agenti spawnare e quale ritmo tenere.

Zero chiamate al provider per `status`/`plan`: il bridge gia' polla
ogni 1-10 min e scrive in /jht_home/logs/sentinel-data.jsonl. Questi
modi leggono solo l'ultimo sample, quindi sono gratis da invocare.

`live` invece bypassa la cache e fa una chiamata API on-demand al
provider: utile prima di una decisione importante (es. spawn massivo)
quando l'ultimo sample del bridge e' vecchio o sospetto. Costa una
hit API, da non usare in loop.

Uso:
  python3 rate_budget.py              # one-line status scriptable (da JSONL)
  python3 rate_budget.py status       # idem
  python3 rate_budget.py plan         # output dettagliato + policy consigliata
  python3 rate_budget.py live         # one-shot fresh fetch dall'API provider

Output di `plan` e' pensato per essere letto dall'LLM Capitano e
convertito in azioni (spawn N agenti vs freeze vs attesa reset).
"""

import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


JHT_HOME = Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht")))
DATA_JSONL = JHT_HOME / "logs" / "sentinel-data.jsonl"


# ── Reset → DATA+ORA completa (mai ora-nuda) ────────────────────────────
def _load_format_time_mod():
    for cand in (Path("/app/shared/skills/format_time.py"),
                 Path(__file__).resolve().parent / "format_time.py"):
        try:
            if not cand.exists():
                continue
            spec = importlib.util.spec_from_file_location("format_time", cand)
            m = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(m)
            return m
        except (OSError, ImportError, AttributeError):
            continue
    return None


_FT_MOD = _load_format_time_mod()


def _fmt_reset(unix_ts, fallback=None):
    """Epoch → 'YYYY-MM-DD HH:MM TZ' (mai ora-nuda). fallback se non derivabile."""
    if isinstance(unix_ts, (int, float)) and not isinstance(unix_ts, bool):
        if _FT_MOD is not None:
            out = _FT_MOD.fmt_reset(unix_ts)
            if out:
                return out
        try:
            return datetime.fromtimestamp(
                float(unix_ts), timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        except (OverflowError, OSError, ValueError):
            pass
    return fallback


THROTTLE_POLICY = {
    0: ("OK", "Proiezione dentro o sotto la finestra ottimale. Procedi col piano, spawna liberamente se hai coda."),
    1: ("ATTENZIONE", "Proiezione > 95% al reset: stai bruciando troppo. Blocca nuovi spawn, allunga gli sleep degli agenti attivi fino a rientrare. Il bridge te lo ripeterà ogni minuto finché sei fuori zona."),
}


def load_last_sample():
    if not DATA_JSONL.exists():
        return None
    try:
        with DATA_JSONL.open(encoding="utf-8") as f:
            last = None
            for line in f:
                line = line.strip()
                if line:
                    last = line
        if last is None:
            return None
        return json.loads(last)
    except (json.JSONDecodeError, OSError):
        return None


def hours_minutes_until(reset_hhmm, reset_at_unix=None):
    """Remaining '2h 34m' al reset. Ancorato all'EPOCH (reset_at_unix) — non
    ambiguo su mezzanotte né su slittamento di giorno. Il parse HH:MM resta
    solo come fallback legacy (sample senza unix): in quel caso assume "il
    prossimo HH:MM" (oggi o domani) come faceva prima.
    """
    target = None
    if isinstance(reset_at_unix, (int, float)) and not isinstance(reset_at_unix, bool):
        target = datetime.fromtimestamp(float(reset_at_unix), timezone.utc)
    elif reset_hhmm:
        try:
            h, m = map(int, str(reset_hhmm).split(":"))
        except ValueError:
            return None  # stringa data-completa senza unix → niente HH:MM da indovinare
        now = datetime.now(timezone.utc)
        target = now.replace(hour=h, minute=m, second=0, microsecond=0)
        if target <= now:
            from datetime import timedelta
            target = target + timedelta(days=1)
    if target is None:
        return None
    delta = target - datetime.now(timezone.utc)
    total_min = int(delta.total_seconds() // 60)
    if total_min < 0:
        return None
    h_rem = total_min // 60
    m_rem = total_min % 60
    return f"{h_rem}h {m_rem}m" if h_rem > 0 else f"{m_rem}m"


def local_reset_display(reset_hhmm, reset_at_unix=None):
    """Display user-facing del reset, SEMPRE con DATA di calendario completa.

    Ancorato all'epoch (reset_at_unix) → 'YYYY-MM-DD HH:MM TZ' nel fuso utente.
    Se l'epoch manca: la stringa reset_at è già data-completa (choke point del
    bridge) e la si mostra così com'è; solo un legacy HH:MM nudo riceve il
    suffisso UTC esplicito (mai un orario senza contesto).
    """
    s = _fmt_reset(reset_at_unix)
    if s:
        return s
    if not reset_hhmm:
        return "-"
    text = str(reset_hhmm)
    # Legacy: HH:MM nudo (solo cifre e un ':') → marca almeno UTC.
    if text.count(":") == 1 and text.replace(":", "").isdigit():
        return f"{text} UTC"
    return text  # già data-completa


def status_line(entry):
    if not entry:
        return "NO_DATA: nessun sample del bridge (il bridge non e' ancora partito o non ha ancora pollato)"
    usage = entry.get("usage", "-")
    provider = entry.get("provider", "-")
    status = entry.get("status", "-")
    throttle = entry.get("throttle", "-")
    reset_at = entry.get("reset_at", "-")
    reset_unix = entry.get("reset_at_unix")
    remaining = hours_minutes_until(reset_at, reset_unix) or "-"
    return (
        f"provider={provider} usage={usage}% status={status} throttle={throttle} "
        f"reset_in={remaining} (at {local_reset_display(reset_at, reset_unix)})"
    )


def plan(entry):
    if not entry:
        print("NO_DATA")
        print("")
        print("Il bridge non ha ancora pollato. Attendi 1-2 min e riprova.")
        print("Se il problema persiste: tmux capture-pane -t CAPITANO e leggi il log")
        print("del bridge in /tmp/sentinel-bridge.log.")
        return

    usage = entry.get("usage", 0)
    provider = entry.get("provider", "-")
    status = entry.get("status", "-")
    throttle = entry.get("throttle", 0)
    reset_at = entry.get("reset_at", "-")
    reset_unix = entry.get("reset_at_unix")
    remaining = hours_minutes_until(reset_at, reset_unix) or "-"
    velocity_smooth = entry.get("velocity_smooth") or 0
    velocity_ideal = entry.get("velocity_ideal")
    projection = entry.get("projection")
    host = entry.get("host") or {}
    host_level = entry.get("host_level", "OK")

    label, advice = THROTTLE_POLICY.get(throttle, (str(throttle), "Segui l'ordine del bridge."))

    print(f"=== Rate Budget - {provider} ===")
    print(f"  Utilizzo:         {usage}%")
    print(f"  Reset:            tra {remaining} ({local_reset_display(reset_at, reset_unix)})")
    print(f"  Velocity misurata:{velocity_smooth:+g}%/h (EMA)")
    if velocity_ideal is not None:
        print(f"  Velocity target:  {velocity_ideal:g}%/h (per chiudere a 95% al reset)")
    if projection is not None:
        print(f"  Proiezione reset: {projection}%")
    print(f"  Status:           {status}")
    print(f"  Throttle:         {label}")
    print(f"  Host:             cpu={host.get('cpu_pct', '-')}% ram={host.get('ram_pct', '-')}% ({host_level})")
    print("")
    print(f"  Policy consigliata: {advice}")

    # Stima "margine": quanto possiamo spendere prima di rompere il target.
    # Useful per l'LLM che decide quanti agenti parallelli tenere.
    # Target 95%: margine minimo sotto il 100% hard limit.
    if isinstance(usage, (int, float)) and usage < 95:
        remaining_budget = 95 - usage
        print(f"  Margine al target 95%: {remaining_budget}%")

    # Timestamp del sample — cosi' l'LLM sa se e' fresco
    ts = entry.get("ts", "-")
    print(f"  Ultimo tick:      {ts}")


def _import_bridge():
    """Carica .launcher/sentinel-bridge.py come modulo per riusare i fetch_*.

    Il bridge non e' importabile in modo standard (filename con trattino,
    fuori da package). Path-import via importlib mantiene questa skill
    indipendente: se il bridge non e' disponibile (host vs container),
    `live` si degrada a errore esplicito, gli altri comandi continuano
    a funzionare leggendo il JSONL.
    """
    bridge_path = Path("/app/.launcher/sentinel-bridge.py")
    if not bridge_path.exists():
        # Fallback host-side path (per dev / test non containerizzato)
        bridge_path = Path(__file__).resolve().parent.parent.parent / ".launcher" / "sentinel-bridge.py"
    if not bridge_path.exists():
        return None
    spec = importlib.util.spec_from_file_location("sentinel_bridge", bridge_path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception:
        return None
    return mod


_PROVIDER_FETCHERS = {
    "claude": "fetch_claude_api",
    "kimi": "fetch_kimi_api",
    "openai": "fetch_codex_rollout",
}


def live():
    """Chiamata API on-demand al provider attivo. Bypassa cache e JSONL.

    Stampa lo stesso shape di `status` ma marcando 'live' nel testo,
    cosi' il Capitano puo' distinguere fresh-from-API da
    cached-from-bridge nei suoi log/decisioni.
    """
    bridge = _import_bridge()
    if bridge is None:
        print("LIVE_UNAVAILABLE: sentinel-bridge.py non trovato. Uso `status` da JSONL.", file=sys.stderr)
        print(status_line(load_last_sample()))
        sys.exit(3)

    try:
        _tick, provider = bridge.read_config()
    except Exception as e:
        print(f"LIVE_UNAVAILABLE: read_config errore: {e}", file=sys.stderr)
        sys.exit(3)

    fn_name = _PROVIDER_FETCHERS.get(provider)
    if fn_name is None or not hasattr(bridge, fn_name):
        print(f"LIVE_UNAVAILABLE: nessun fetcher per provider={provider}", file=sys.stderr)
        sys.exit(3)

    try:
        sample = getattr(bridge, fn_name)()
    except Exception as e:
        print(f"LIVE_FAIL: chiamata API fallita ({provider}): {e}", file=sys.stderr)
        sys.exit(4)

    if not sample:
        print(f"LIVE_FAIL: provider {provider} ha risposto vuoto/None (rate-limit, timeout o credenziali mancanti)", file=sys.stderr)
        sys.exit(4)

    # fetch_claude_api ritorna la stringa "RATE_LIMIT" (sentinel value, non dict)
    # quando Anthropic ha 429ato. Va trattato come fail esplicito così la
    # Sentinella sa che deve passare a L2 (TUI worker).
    if isinstance(sample, str):
        print(f"LIVE_FAIL: provider {provider} segnale di rate-limit ({sample}). Usa L2 (check_usage.py).", file=sys.stderr)
        sys.exit(4)

    usage = sample.get("usage")
    reset_at = sample.get("reset_at")
    reset_unix = sample.get("reset_at_unix")
    weekly = sample.get("weekly_usage")
    remaining = hours_minutes_until(reset_at, reset_unix) or "-"

    # Auto-registra il sample nel JSONL del bridge marcando il source
    # in base a chi sta eseguendo la skill. Permette al grafico di
    # mostrare TUTTI i check (capitano + sentinella + bridge), non solo
    # quelli del bridge clock. Non bloccante: se il record fallisce il
    # comando deve ancora stampare l'output utile al chiamante.
    detected_source = _detect_source_from_env()
    recorded_sample = None
    try:
        recorded_sample = _record_sample_via_skill({
            "usage": usage,
            "reset_at": reset_at,
            # Propaga gli epoch così il choke point (compute_metrics) può
            # produrre reset_at/weekly_reset_at con la DATA completa.
            "reset_at_unix": reset_unix,
            "weekly_reset_at": sample.get("weekly_reset_at"),
            "weekly_reset_at_unix": sample.get("weekly_reset_at_unix"),
            "provider": provider,
            "weekly_usage": weekly,
        }, source=detected_source)
    except Exception as e:
        print(f"warn: auto-record JSONL fallito: {e}", file=sys.stderr)

    # Bug fix 2026-04-25: prima il one-liner stampava solo usage/reset/
    # weekly. La projection — l'unica metrica che il prompt del Capitano
    # gli dice di guardare per giudicare il target band 85-95 — era
    # nascosta. Risultato osservato: usage 16-99% letto come "tutto OK"
    # mentre projection era già 96-114% dal minuto 5. Ora `live` stampa
    # anche proj e status (calcolati da compute_metrics in record).
    proj = recorded_sample.get("projection") if recorded_sample else None
    status = recorded_sample.get("status") if recorded_sample else None

    parts = [
        f"provider={provider}",
        f"usage={usage}%",
    ]
    if proj is not None:
        parts.append(f"proj={proj}%")
    if status is not None:
        parts.append(f"status={status}")
    parts += [
        f"reset_in={remaining}",
        f"reset_at={local_reset_display(reset_at, reset_unix)}",
        f"source={detected_source}",
    ]
    if weekly is not None:
        parts.append(f"weekly={weekly}%")
    print(" ".join(parts))


def _detect_source_from_env():
    """Capisce chi sta chiamando la skill leggendo $JHT_AGENT_DIR
    (settato da start-agent.sh per ogni agente del team).

    Mapping:
      .../agents/capitano       -> 'capitano'
      .../agents/sentinella     -> 'sentinella-api'   (ramo API,
                                   il worker fallback usa --manual)
      qualsiasi altro path o env mancante -> 'manual'
    """
    agent_dir = (os.environ.get("JHT_AGENT_DIR") or "").rstrip("/")
    if not agent_dir:
        return "manual"
    leaf = agent_dir.rsplit("/", 1)[-1].lower()
    if leaf == "capitano":
        return "capitano"
    if leaf == "sentinella":
        return "sentinella-api"
    return "manual"


def _record_sample_via_skill(parsed, source):
    """Chiama la skill usage_record per scrivere il sample nel JSONL
    (con calcolo delle metriche derivate). Path-import per riuso.

    Ritorna il sample scritto (dict completo con projection, status,
    velocity_smooth, ecc.) così il chiamante può mostrarli in output.
    """
    here = Path(__file__).resolve().parent
    record_path = here / "usage_record.py"
    if not record_path.exists():
        return None
    spec = importlib.util.spec_from_file_location("usage_record", record_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    sample = mod.make_sample(parsed, source=source)
    mod.append_sample(sample)
    return sample


def main():
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "status").lower()
    if cmd == "live":
        live()
        return
    entry = load_last_sample()
    if cmd == "plan":
        plan(entry)
    elif cmd in ("status", ""):
        print(status_line(entry))
    else:
        print(f"rate_budget: comando '{cmd}' sconosciuto. Usa: status | plan | live", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
