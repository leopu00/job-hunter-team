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
    0: ("OK", "Projection is within or below the optimal window. Follow the plan and spawn freely if work is queued."),
    1: ("WARNING", "Projection is above 95% at reset: usage is too high. Block new spawns and lengthen active-agent sleeps until back on target. The bridge will repeat this every minute while usage remains outside the target zone."),
}


def display_status(value):
    """English label for stable internal status identifiers."""
    return {
        "ATTENZIONE": "WARNING",
        "SOTTOUTILIZZO": "UNDERUTILIZED",
        "SOPRA-PACE-WEEKLY": "ABOVE-PACE-WEEKLY",
        "SOPRA-PACE": "ABOVE-PACE",
        "SOTTO-PACE": "BELOW-PACE",
        "ALLINEATO": "ON-PACE",
    }.get(value, value)


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


def weekly_reset_remaining(unix_ts):
    """weekly_reset_at_unix → 'Ng Mh' remaining. Il weekly e' a GIORNI, non ore:
    HH:MM (come il 5h) non basta, serve il delta in giorni per non scambiarlo col 5h."""
    if not isinstance(unix_ts, (int, float)):
        return None
    now = datetime.now(timezone.utc)
    target = datetime.fromtimestamp(unix_ts, tz=timezone.utc)
    total_min = int((target - now).total_seconds() // 60)
    if total_min < 0:
        return None
    d, rem = total_min // 1440, total_min % 1440
    h, m = rem // 60, rem % 60
    return f"{d}d {h}h" if d > 0 else (f"{h}h {m}m" if h > 0 else f"{m}m")


def status_line(entry):
    if not entry:
        return "NO_DATA: no bridge sample (the bridge has not started or has not polled yet)"
    usage = entry.get("usage", "-")
    provider = entry.get("provider", "-")
    status = entry.get("status", "-")
    throttle = entry.get("throttle", "-")
    reset_at = entry.get("reset_at", "-")
    reset_unix = entry.get("reset_at_unix")
    remaining = hours_minutes_until(reset_at, reset_unix) or "-"
    line = (
        f"provider={provider} usage={usage}% status={status} throttle={throttle} "
        f"reset_in={remaining} (at {local_reset_display(reset_at, reset_unix)})"
    )
    # DIMENSIONE WEEKLY ESPLICITA (fix confusione-reset 2026-06-30): `reset_in` qui
    # e' SOLO il 5h (ore). Quando il vincolo e' weekly (es. status SOPRA-PACE-WEEKLY)
    # il reset che conta e' quello settimanale (GIORNI), NON il 5h. Mostrarlo sempre
    # accanto evita che il Capitano scambi il reset 5h per quello weekly e si aspetti
    # un sollievo che al reset 5h non arriva (osservato betaB/Kimi 2026-06-29).
    wk_usage = entry.get("weekly_usage")
    wk_rem = weekly_reset_remaining(entry.get("weekly_reset_at_unix"))
    if isinstance(wk_usage, (int, float)) or wk_rem:
        wk_unix = entry.get("weekly_reset_at_unix")
        at = (datetime.fromtimestamp(wk_unix, tz=timezone.utc).strftime("%d/%m %H:%M")
              if isinstance(wk_unix, (int, float)) else (entry.get("weekly_reset_at") or "?"))
        used = f"{wk_usage}% used" if isinstance(wk_usage, (int, float)) else "?"
        line += f" | weekly={used}, reset_weekly={wk_rem or '?'} (at {at} UTC)"
    return line


def plan(entry):
    if not entry:
        print("NO_DATA")
        print("")
        print("The bridge has not polled yet. Wait 1-2 minutes and try again.")
        print("If the problem persists, run tmux capture-pane -t CAPITANO and read")
        print("the bridge log at /tmp/sentinel-bridge.log.")
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

    label, advice = THROTTLE_POLICY.get(throttle, (str(throttle), "Follow the bridge instruction."))

    print(f"=== Rate Budget - {provider} ===")
    print(f"  Usage:            {usage}%")
    print(f"  Reset:            in {remaining} ({local_reset_display(reset_at, reset_unix)})")
    print(f"  Measured velocity:{velocity_smooth:+g}%/h (EMA)")
    if velocity_ideal is not None:
        print(f"  Target velocity:  {velocity_ideal:g}%/h (to finish at 95% at reset)")
    if projection is not None:
        print(f"  Reset projection: {projection}%")
    print(f"  Status:           {display_status(status)}")
    print(f"  Throttle:         {label}")
    print(f"  Host:             cpu={host.get('cpu_pct', '-')}% ram={host.get('ram_pct', '-')}% ({host_level})")
    print("")
    print(f"  Recommended policy: {advice}")

    # Stima "margine": quanto possiamo spendere prima di rompere il target.
    # Useful per l'LLM che decide quanti agenti parallelli tenere.
    # Target 95%: margine minimo sotto il 100% hard limit.
    if isinstance(usage, (int, float)) and usage < 95:
        remaining_budget = 95 - usage
        print(f"  Headroom to 95% target: {remaining_budget}%")

    # Timestamp del sample — cosi' l'LLM sa se e' fresco
    ts = entry.get("ts", "-")
    print(f"  Last tick:        {ts}")


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
        print("LIVE_UNAVAILABLE: sentinel-bridge.py not found. Falling back to JSONL `status`.", file=sys.stderr)
        print(status_line(load_last_sample()))
        sys.exit(3)

    try:
        _tick, provider = bridge.read_config()
    except Exception as e:
        print(f"LIVE_UNAVAILABLE: read_config error: {e}", file=sys.stderr)
        sys.exit(3)

    fn_name = _PROVIDER_FETCHERS.get(provider)
    if fn_name is None or not hasattr(bridge, fn_name):
        print(f"LIVE_UNAVAILABLE: no fetcher for provider={provider}", file=sys.stderr)
        sys.exit(3)

    try:
        sample = getattr(bridge, fn_name)()
    except Exception as e:
        print(f"LIVE_FAIL: API call failed ({provider}): {e}", file=sys.stderr)
        sys.exit(4)

    if not sample:
        print(f"LIVE_FAIL: provider {provider} returned an empty/None response (rate limit, timeout, or missing credentials)", file=sys.stderr)
        sys.exit(4)

    # fetch_claude_api ritorna la stringa "RATE_LIMIT" (sentinel value, non dict)
    # quando Anthropic ha 429ato. Va trattato come fail esplicito così la
    # Sentinella sa che deve passare a L2 (TUI worker).
    if isinstance(sample, str):
        print(f"LIVE_FAIL: provider {provider} reported a rate-limit signal ({sample}). Use L2 (check_usage.py).", file=sys.stderr)
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
        print(f"warn: JSONL auto-record failed: {e}", file=sys.stderr)

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


def show_tick():
    """Stampa l'ULTIMO messaggio del bridge — lo STESSO identico testo (3
    sezioni: 5h / oggi / settimana + consiglio) che riceve la Sentinella.
    Il bridge lo renderizza ad ogni tick e lo scrive in logs/last-tick.txt;
    qui lo rileggiamo (zero chiamate al provider, zero ricalcolo divergente)."""
    path = JHT_HOME / "logs" / "last-tick.txt"
    try:
        msg = path.read_text(encoding="utf-8").strip()
    except (OSError, FileNotFoundError):
        msg = ""
    if not msg:
        print("NO_DATA: the bridge has not written a tick yet "
              "(it has not started, or it is outside working hours). Try again in 1-2 minutes.")
        return
    print(msg)


def main():
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "tick").lower()
    if cmd == "live":
        live()
        return
    if cmd in ("tick", ""):
        show_tick()
        return
    entry = load_last_sample()
    if cmd == "plan":
        plan(entry)
    elif cmd == "status":
        print(status_line(entry))
    else:
        print(f"rate_budget: unknown command '{cmd}'. Use: tick | status | plan | live", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
