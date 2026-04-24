#!/usr/bin/env python3
"""
rate_budget — helper per il Capitano: legge l'ultimo tick dal bridge
(sentinel-bridge.py) e produce un riassunto leggibile del budget di
rate-limit del provider attivo. Usato dal Capitano all'avvio per
decidere quanti agenti spawnare e quale ritmo tenere.

Zero chiamate al provider: il bridge gia' polla ogni 1-10 min e
scrive in /jht_home/logs/sentinel-data.jsonl. Questo script legge
solo l'ultimo sample, quindi e' gratis da invocare.

Uso:
  python3 rate_budget.py              # one-line status scriptable
  python3 rate_budget.py status       # idem
  python3 rate_budget.py plan         # output dettagliato + policy consigliata

Output di `plan` e' pensato per essere letto dall'LLM Capitano e
convertito in azioni (spawn N agenti vs freeze vs attesa reset).
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


JHT_HOME = Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht")))
DATA_JSONL = JHT_HOME / "logs" / "sentinel-data.jsonl"


THROTTLE_POLICY = {
    0: ("T0 full speed", "Puoi spawnare in parallelo senza restrizioni. Mantieni ritmo normale."),
    1: ("T1 rallentato", "Spawn ok ma allarga gli intervalli tra azioni (sleep 30-60s)."),
    2: ("T2 spawn bloccato", "NON spawnare nuovi agenti. Quelli esistenti: sleep 2 min tra azioni."),
    3: ("T3 critico", "NON spawnare. Agenti esistenti in pausa operativa (sleep 5 min)."),
    4: ("T4 freeze totale", "STOP TOTALE. Freeze tutti gli agenti. Aspetta BRIDGE ORDER di downgrade."),
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


def hours_minutes_until(reset_hhmm):
    """HH:MM (UTC, come lo scrive il bridge) → '2h 34m' remaining.

    Il reset_at nel JSONL e' sempre in UTC (fetch_codex_rollout usa
    datetime.astimezone() con TZ=UTC del container). Calcoliamo
    remaining in UTC per essere coerenti con lo storage.
    """
    if not reset_hhmm:
        return None
    try:
        h, m = map(int, reset_hhmm.split(":"))
    except ValueError:
        return None
    now = datetime.now(timezone.utc)
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if target <= now:
        from datetime import timedelta
        target = target + timedelta(days=1)
    delta = target - now
    total_min = int(delta.total_seconds() // 60)
    if total_min < 0:
        return None
    h_rem = total_min // 60
    m_rem = total_min % 60
    return f"{h_rem}h {m_rem}m" if h_rem > 0 else f"{m_rem}m"


def local_reset_display(reset_hhmm):
    """Converte HH:MM UTC in 'HH:MM local (HH:MM UTC)' per display user-facing.

    Container di default gira in UTC, ma l'utente legge orari in local
    (CEST/CET in Italia). Mostrare entrambi evita l'ambiguita' tipica
    "reset alle 13:49" dove il numero e' UTC e l'utente lo scambia per
    ora italiana, calcolando remaining errato.
    """
    if not reset_hhmm:
        return "-"
    try:
        h, m = map(int, reset_hhmm.split(":"))
    except ValueError:
        return reset_hhmm
    now_utc = datetime.now(timezone.utc)
    target_utc = now_utc.replace(hour=h, minute=m, second=0, microsecond=0)
    if target_utc <= now_utc:
        from datetime import timedelta
        target_utc = target_utc + timedelta(days=1)
    target_local = target_utc.astimezone()
    local_hhmm = target_local.strftime("%H:%M")
    if local_hhmm == reset_hhmm:
        # Container e' in UTC e pure il "local" risolve a UTC (TZ unset),
        # oppure l'offset e' 0 — mostra solo UTC senza duplicare.
        return f"{reset_hhmm} UTC"
    return f"{local_hhmm} local ({reset_hhmm} UTC)"


def status_line(entry):
    if not entry:
        return "NO_DATA: nessun sample del bridge (il bridge non e' ancora partito o non ha ancora pollato)"
    usage = entry.get("usage", "-")
    provider = entry.get("provider", "-")
    status = entry.get("status", "-")
    throttle = entry.get("throttle", "-")
    reset_at = entry.get("reset_at", "-")
    remaining = hours_minutes_until(reset_at) or "-"
    return (
        f"provider={provider} usage={usage}% status={status} throttle=T{throttle} "
        f"reset_in={remaining} (at {local_reset_display(reset_at)})"
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
    remaining = hours_minutes_until(reset_at) or "-"
    velocity_smooth = entry.get("velocity_smooth") or 0
    velocity_ideal = entry.get("velocity_ideal")
    projection = entry.get("projection")
    host = entry.get("host") or {}
    host_level = entry.get("host_level", "OK")

    label, advice = THROTTLE_POLICY.get(throttle, (f"T{throttle}", "Segui l'ordine del bridge."))

    print(f"=== Rate Budget - {provider} ===")
    print(f"  Utilizzo:         {usage}%")
    print(f"  Reset:            tra {remaining} ({local_reset_display(reset_at)})")
    print(f"  Velocity misurata:{velocity_smooth:+g}%/h (EMA)")
    if velocity_ideal is not None:
        print(f"  Velocity target:  {velocity_ideal:g}%/h (per chiudere a 92% al reset)")
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


def main():
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "status").lower()
    entry = load_last_sample()
    if cmd == "plan":
        plan(entry)
    elif cmd in ("status", ""):
        print(status_line(entry))
    else:
        print(f"rate_budget: comando '{cmd}' sconosciuto. Usa: status | plan", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
