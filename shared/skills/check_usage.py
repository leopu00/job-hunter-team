#!/usr/bin/env python3
"""
check_usage — controllo manuale dell'usage Claude via TUI fallback.

Uso:
    python3 /app/shared/skills/check_usage.py

Cosa fa:
  1. Garantisce l'esistenza della sessione SENTINELLA-WORKER (la spawn via
     /app/.launcher/start-agent.sh worker se non c'è, aspettando il boot
     del CLI claude).
  2. Invia il comando `/usage` al CLI nella sessione worker.
  3. Cattura il pane tmux e parsa l'output della modal `/usage`.
  4. Stampa usage corrente, reset UTC, reset remaining, weekly usage.
  5. Valuta se siamo in zona di rischio (projection > 95% con i dati
     osservabili) e stampa un'indicazione operativa.

Quando serve:
  - Il bridge (sentinel-bridge.py) è fermo / in errore
  - L'ultimo sample in /jht_home/logs/sentinel-data.jsonl è troppo vecchio
    (> 10 min) e non sai se il budget è ancora buono
  - Vuoi una conferma indipendente prima di spawnare un burst di agenti

È DETERMINISTICO (niente LLM), usa solo tmux + CLI claude idle.
Il comando `/usage` non consuma token significativi: apre una modal
locale senza inviare richieste al modello. Quindi il check in sé
non scala il budget.

Raccomandazione: chiama questo ogni tanto come "dentista" (una volta
ogni 15-20 min se sei in dubbio) o sempre prima di operazioni critiche
tipo spawn di 3+ agenti contemporanei.
"""
import re
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta

WORKER_SESSION = "SENTINELLA-WORKER"
START_AGENT_SH = "/app/.launcher/start-agent.sh"
WORKER_BOOT_WAIT_S = 18        # ~15s CLI boot + margine per trust dialog
USAGE_RENDER_WAIT_S = 4        # attesa dopo Enter perché la modal renderizzi
CAPTURE_LINES = 300            # righe recenti del pane da catturare

SAFE_CEILING = 95              # soglia di allerta usata dal bridge


def tmux_has_session(name):
    return subprocess.run(
        ["tmux", "has-session", "-t", name],
        capture_output=True,
    ).returncode == 0


def send_keys(name, *keys):
    subprocess.run(
        ["tmux", "send-keys", "-t", name, *keys],
        capture_output=True,
    )


def capture_pane(name, lines=CAPTURE_LINES):
    r = subprocess.run(
        ["tmux", "capture-pane", "-t", name, "-p", "-S", f"-{lines}"],
        capture_output=True,
    )
    return r.stdout.decode("utf-8", errors="replace") if r.returncode == 0 else ""


def spawn_worker():
    """Delega a start-agent.sh worker. Non duplica env setup / trust dialog."""
    try:
        r = subprocess.run(
            ["bash", START_AGENT_SH, "worker"],
            capture_output=True, timeout=10,
        )
        return r.returncode == 0
    except (subprocess.TimeoutExpired, OSError) as e:
        print(f"ERRORE spawn WORKER: {e}", file=sys.stderr)
        return False


# ── Parser /usage (formato Claude Code) ─────────────────────────────

def parse_claude_usage(text):
    """Estrae usage% e reset HH:MM UTC dalla modal /usage.

    Output atteso (può essere wrappato cross-line):
        Resets 6:10pm (UTC)                                42% used
        Resets 7pm (UTC) (all models)                      12% used
        Resets 6am (UTC) (Sonnet only)                     3% used

    Il primo Resets SENZA tag 'all models' / 'only' è la sessione 5h.
    """
    if not text:
        return None
    resets = list(re.finditer(
        r"Resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(UTC\)([^\n]*)",
        text, re.I,
    ))
    if not resets:
        return None
    session_match = None
    for m in resets:
        tail = (m.group(4) or "").lower()
        if "all models" not in tail and "only" not in tail:
            session_match = m
            break
    if session_match is None:
        return None

    start = session_match.start()
    next_reset_pos = len(text)
    for m in resets:
        if m.start() > session_match.start():
            next_reset_pos = m.start()
            break
    window = text[start:min(next_reset_pos, start + 400)]
    m_used = re.search(r"(\d+)\s*%\s*used", window, re.I)
    if not m_used:
        return None

    h = int(session_match.group(1))
    minute = int(session_match.group(2) or 0)
    ampm = session_match.group(3).lower()
    if ampm == "pm" and h < 12:
        h += 12
    elif ampm == "am" and h == 12:
        h = 0

    return {
        "usage": int(m_used.group(1)),
        "reset_hhmm_utc": f"{h:02d}:{minute:02d}",
    }


def hours_until_reset(reset_hhmm_utc):
    try:
        h, m = map(int, reset_hhmm_utc.split(":"))
    except ValueError:
        return None
    now = datetime.now(timezone.utc)
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds() / 3600


def query_worker():
    """/usage → Enter → 4s → capture. Niente Esc: durante il trust dialog
    iniziale (se il CLI è appena partito) Esc = cancel → CLI esce →
    /usage finisce in bash. Enter da solo è safe in tutti gli stati."""
    send_keys(WORKER_SESSION, "/usage")
    time.sleep(0.4)
    send_keys(WORKER_SESSION, "Enter")
    time.sleep(USAGE_RENDER_WAIT_S)
    return capture_pane(WORKER_SESSION)


def main():
    spawned_now = False
    if not tmux_has_session(WORKER_SESSION):
        print(f"[check_usage] {WORKER_SESSION} non attiva, la spawno via start-agent.sh worker...")
        if not spawn_worker():
            print("[check_usage] ERRORE: spawn fallito", file=sys.stderr)
            sys.exit(1)
        print(f"[check_usage] attendo {WORKER_BOOT_WAIT_S}s per boot CLI...")
        time.sleep(WORKER_BOOT_WAIT_S)
        spawned_now = True

    # Prima tentata: potrebbe ancora essere in boot dopo prima volta.
    buf = query_worker()
    parsed = parse_claude_usage(buf)

    # Retry una volta in più se il primo tentativo ha fallito e abbiamo
    # appena spawnato il worker (il CLI potrebbe non aver finito di caricare).
    if parsed is None and spawned_now:
        print("[check_usage] primo /usage senza output utile, retry dopo 8s...")
        time.sleep(8)
        buf = query_worker()
        parsed = parse_claude_usage(buf)

    if parsed is None:
        print("[check_usage] IMPOSSIBILE PARSARE /usage output.", file=sys.stderr)
        print("--- ultimi 500 char del pane ---", file=sys.stderr)
        print(buf[-500:], file=sys.stderr)
        sys.exit(2)

    usage = parsed["usage"]
    reset_utc = parsed["reset_hhmm_utc"]
    hours_rem = hours_until_reset(reset_utc)
    rem_str = "?"
    if hours_rem is not None:
        hh = int(hours_rem)
        mm = int((hours_rem - hh) * 60)
        rem_str = f"{hh}h {mm}m" if hh > 0 else f"{mm}m"

    # Stampa umana
    print("=== Claude /usage (via WORKER TUI) ===")
    print(f"  Usage (sessione 5h):  {usage}%")
    print(f"  Reset UTC:            {reset_utc}")
    print(f"  Reset remaining:      {rem_str}")

    # Indicazione operativa semplice. Non abbiamo velocity qui (serve
    # una serie di tick del bridge per quello), ma diamo un flag grezzo.
    if usage >= 88:
        verdict = "🔴 CRITICO: vicino al rate-limit, freeza subito tutti gli spawn"
    elif usage >= 75:
        verdict = "🟠 ATTENZIONE: riduci al minimo, niente spawn extra"
    elif usage >= SAFE_CEILING:
        verdict = "🟡 SOGLIA: al ceiling del budget, monitora"
    else:
        verdict = "🟢 OK: margine disponibile"
    print(f"  Verdict:              {verdict}")
    print("")
    print("Note: questo check è indipendente dal bridge. Se il bridge è vivo")
    print("e i suoi sample sono freschi, preferisci rate_budget.py plan che")
    print("include anche velocity / projection / host / isteresi zone.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
