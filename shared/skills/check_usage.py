#!/usr/bin/env python3
"""
check_usage — controllo manuale dell'usage del provider AI attivo.

Uso:
    python3 /app/shared/skills/check_usage.py

Cosa fa:
  Rileva il provider attivo (jht.config.json -> active_provider) e
  applica la strategia di fallback piu' robusta per quel provider:

    claude/anthropic   TUI fallback: spawna SENTINELLA-WORKER (CLI claude
                       idle), invia /usage, parsa la modal. Indipendente
                       dall'HTTP /api/oauth/usage che ha rate-limit
                       aggressivo (gh anthropics/claude-code#30930).

    kimi/moonshot      Chiamata diretta /coding/v1/usages riusando il
                       fetcher del bridge. L'API e' stabile, qui non
                       serve fallback indipendente: la skill conferma
                       solo che il dato e' fresco e leggibile.

    openai/codex       Lettura diretta dei rollout JSONL in
                       ~/.codex/sessions/, riusando il fetcher del
                       bridge. Zero dipendenze esterne (file locali).

    altri              Placeholder NOT_IMPLEMENTED, exit 4.

Output unificato (one-liner scriptable + verdict umano):
    provider=X usage=Y% reset=hhmm_utc reset_in=Ah Bm verdict=...

Quando serve:
  - Bridge fermo / in errore (degraded mode)
  - Ultimo sample sentinel-data.jsonl > 10 min, dato sospetto
  - Conferma indipendente prima di operazioni critiche (spawn 3+ agenti)

DETERMINISTICO (niente LLM nel loop di parsing).
"""
import importlib.util
import re
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

WORKER_SESSION = "SENTINELLA-WORKER"
START_AGENT_SH = "/app/.launcher/start-agent.sh"
WORKER_BOOT_WAIT_S = 18        # ~15s CLI boot + margine per trust dialog
USAGE_RENDER_WAIT_S = 4        # attesa dopo Enter perché la modal renderizzi
CAPTURE_LINES = 300            # righe recenti del pane da catturare

SAFE_CEILING = 95              # soglia di allerta usata dal bridge


# ── Provider detection ──────────────────────────────────────────────

def _import_bridge():
    """Carica .launcher/sentinel-bridge.py per riusare read_config / fetch_*.

    Path-import (filename con trattino, non importabile come package). Se
    il bridge non e' raggiungibile (host vs container, struttura diversa),
    la skill si degrada a errore esplicito invece di crashare.
    """
    candidates = [
        Path("/app/.launcher/sentinel-bridge.py"),
        Path(__file__).resolve().parent.parent.parent / ".launcher" / "sentinel-bridge.py",
    ]
    for p in candidates:
        if p.exists():
            spec = importlib.util.spec_from_file_location("sentinel_bridge", p)
            mod = importlib.util.module_from_spec(spec)
            try:
                spec.loader.exec_module(mod)
                return mod
            except Exception as e:
                print(f"[check_usage] errore caricamento bridge ({p}): {e}", file=sys.stderr)
                return None
    return None


def detect_provider():
    """Ritorna lo slug normalizzato del provider attivo, o None se sconosciuto.

    Normalizzazione: claude/anthropic -> claude; kimi/moonshot -> kimi;
    openai/codex -> openai. Permette ai branch di check_usage di non
    moltiplicare le casistiche.
    """
    bridge = _import_bridge()
    if bridge is None:
        return None
    try:
        _tick, raw = bridge.read_config()
    except Exception:
        return None
    raw = (raw or "").strip().lower()
    if raw in ("claude", "anthropic"):
        return "claude"
    if raw in ("kimi", "moonshot"):
        return "kimi"
    if raw in ("openai", "codex"):
        return "openai"
    return raw or None


# ── tmux helpers (usati solo da claude) ─────────────────────────────

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

    Supporta DUE formati:

    v2.1+ (Claude Code attuale, "Current session" header, % used PRIMA di Resets):
        Current session
        ██████████████████                  36% used
        Resets 4:40am (UTC)

        Current week (all models)
        ████████████▌                       25% used
        Resets Apr 27, 5am (UTC)

    Vecchio formato (pre-v2.1, % used DOPO Resets sulla stessa riga):
        Resets 6:10pm (UTC)                 42% used
        Resets 7pm (UTC) (all models)       12% used

    Per il nuovo formato cerchiamo l'header "Current session" e da lì
    estraiamo il percentuale e il Resets nella sezione. Per il vecchio
    formato fallback alla logica "primo Resets senza tag (all models|only)".
    """
    if not text:
        return None

    # Guard: se l'ULTIMO output mostra "Loading usage data…" significa che
    # il TUI ha provato ad aprire la modal ma non ha ricevuto i dati da
    # Anthropic (sessione/token compromessi, network issue). NON usare la
    # scrollback con valori cached da modali precedenti — fai fallire il
    # parse così il bridge cade su HTTP e l'orchestratore può respawnare
    # il worker.
    # Cerco l'ULTIMA "Loading usage data" nel testo: se è dopo l'ULTIMA
    # "Current session" (= modal corrente non caricata), restituisco None.
    last_loading = text.rfind("Loading usage data")
    last_session = text.rfind("Current session")
    if last_loading > last_session:
        return None

    reset_re = r"Resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(UTC\)"

    # ── Formato v2.1+: header "Current session" ──
    # Pattern: "Current session" → progress bar → "XX% used" → "Resets HH(:MM)?(am|pm) (UTC)"
    # re.S permette al . di matchare newline.
    #
    # IMPORTANTE: prendiamo l'ULTIMO match (più recente nel buffer),
    # non il primo. La scrollback può contenere modali /usage vecchie
    # (boot CLI, query precedenti) e re.search di default trova la
    # prima occorrenza che è SEMPRE quella più vecchia → dato stale.
    matches_v2 = list(re.finditer(
        r"Current\s+session\s+.*?(\d+)\s*%\s*used.*?" + reset_re,
        text, re.I | re.S,
    ))
    m_v2 = matches_v2[-1] if matches_v2 else None
    if m_v2:
        h = int(m_v2.group(2))
        minute = int(m_v2.group(3) or 0)
        ampm = m_v2.group(4).lower()
        if ampm == "pm" and h < 12:
            h += 12
        elif ampm == "am" and h == 12:
            h = 0
        # Estrai weekly: cerca SOLO nel testo dopo l'ultima "Current
        # session" (il blocco weekly accompagna sempre il session corrente).
        text_after = text[m_v2.start():]
        m_weekly = re.search(
            r"Current\s+week\s*\(all\s+models\).*?(\d+)\s*%\s*used",
            text_after, re.I | re.S,
        )
        weekly = int(m_weekly.group(1)) if m_weekly else None
        return {
            "usage": int(m_v2.group(1)),
            "reset_hhmm_utc": f"{h:02d}:{minute:02d}",
            "weekly": weekly,
        }

    # ── Formato vecchio (fallback): primo Resets senza tag ──
    resets = list(re.finditer(reset_re + r"([^\n]*)", text, re.I))
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
    if not reset_hhmm_utc:
        return None
    try:
        h, m = map(int, reset_hhmm_utc.split(":"))
    except ValueError:
        return None
    now = datetime.now(timezone.utc)
    target = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds() / 3600


def remaining_str(reset_hhmm_utc):
    h = hours_until_reset(reset_hhmm_utc)
    if h is None:
        return "?"
    hh = int(h)
    mm = int((h - hh) * 60)
    return f"{hh}h {mm}m" if hh > 0 else f"{mm}m"


# ── Strategie per provider ──────────────────────────────────────────

def query_claude_worker():
    """Esc → /usage → Enter → 4s → capture.

    Esc PRIMA di /usage è critico: se la modal /usage è già aperta dal
    tick precedente, senza Esc il "/usage" finisce nel prompt input
    della modal stessa (non rilanciato come slash command) → la modal
    resta sui dati del primo tick, mai aggiornata.

    Caveat: se il CLI è ancora nel trust dialog iniziale (entro 18s
    dallo spawn), Esc = cancel → CLI esce. Il chiamante DEVE attendere
    WORKER_BOOT_WAIT_S (18s) dopo lo spawn prima di chiamare questa.
    Lo facciamo già in spawn_worker() + check_claude(), e il bridge
    fa lo stesso prima del primo tick.
    """
    # Flusso "Esc PRIMA + DOPO" per max robustezza:
    #   1. Esc prima  → chiude eventuale modal residua dal tick
    #                   precedente (anche se ci aspettiamo che sia già
    #                   chiusa dall'Esc di fine ciclo, è una guard)
    #   2. /usage     → apre modal fresca
    #   3. capture    → leggi
    #   4. Esc dopo   → chiudi per il prossimo round (così Anthropic
    #                   non serve dato cached della modal aperta)
    #
    # Anche col fix "ultima modal in scrollback" del parser, mantenere
    # un solo formato di scrollback (modal aperta → chiusa) rende lo
    # stato più prevedibile.
    send_keys(WORKER_SESSION, "Escape")
    time.sleep(0.5)
    send_keys(WORKER_SESSION, "/usage", "Enter")
    time.sleep(USAGE_RENDER_WAIT_S)
    buf = capture_pane(WORKER_SESSION)
    send_keys(WORKER_SESSION, "Escape")
    time.sleep(0.5)
    return buf


def check_claude():
    """TUI fallback per claude/anthropic. Spawn WORKER se serve, manda
    /usage, parsa la modal."""
    spawned_now = False
    if not tmux_has_session(WORKER_SESSION):
        print(f"[check_usage] {WORKER_SESSION} non attiva, la spawno via start-agent.sh worker...")
        if not spawn_worker():
            print("[check_usage] ERRORE: spawn fallito", file=sys.stderr)
            return None, "spawn_failed"
        print(f"[check_usage] attendo {WORKER_BOOT_WAIT_S}s per boot CLI...")
        time.sleep(WORKER_BOOT_WAIT_S)
        spawned_now = True

    buf = query_claude_worker()
    parsed = parse_claude_usage(buf)
    if parsed is None and spawned_now:
        print("[check_usage] primo /usage senza output utile, retry dopo 8s...")
        time.sleep(8)
        buf = query_claude_worker()
        parsed = parse_claude_usage(buf)

    if parsed is None:
        print("[check_usage] IMPOSSIBILE PARSARE /usage output.", file=sys.stderr)
        print("--- ultimi 500 char del pane ---", file=sys.stderr)
        print(buf[-500:], file=sys.stderr)
        return None, "parse_failed"

    return {
        "usage": parsed["usage"],
        "reset_hhmm_utc": parsed["reset_hhmm_utc"],
        "weekly": None,
        "source": "tui:/usage",
    }, None


def check_via_bridge_fetcher(bridge, fn_name, source_label):
    """Fallback comune kimi/openai: ri-invoca il fetcher del bridge.

    Per questi provider l'API/file e' la sorgente primaria — non c'e' un
    canale "indipendente" come la TUI claude. Qui la skill conferma solo
    che il dato e' leggibile fresco. Se torna None, lo segnaliamo come
    sorgente non disponibile (tipico: container down per kimi, sessione
    codex non avviata).
    """
    fn = getattr(bridge, fn_name, None)
    if fn is None:
        return None, f"missing_fetcher:{fn_name}"
    try:
        sample = fn()
    except Exception as e:
        return None, f"fetch_error:{e}"
    if not sample:
        return None, "fetch_empty"
    return {
        "usage": sample.get("usage"),
        "reset_hhmm_utc": sample.get("reset_at"),
        "weekly": sample.get("weekly_usage"),
        "source": source_label,
    }, None


# ── Verdict comune ──────────────────────────────────────────────────

def compute_verdict(usage):
    if not isinstance(usage, (int, float)):
        return "⚪ sconosciuto"
    if usage >= 88:
        return "🔴 CRITICO: vicino al rate-limit, freeza subito tutti gli spawn"
    if usage >= 75:
        return "🟠 ATTENZIONE: riduci al minimo, niente spawn extra"
    if usage >= SAFE_CEILING:
        return "🟡 SOGLIA: al ceiling del budget, monitora"
    return "🟢 OK: margine disponibile"


# ── Main: dispatch per provider ─────────────────────────────────────

def main():
    provider = detect_provider()
    if provider is None:
        print("[check_usage] provider non rilevabile (config mancante o bridge non importabile)", file=sys.stderr)
        sys.exit(3)

    if provider == "claude":
        result, err = check_claude()
    elif provider in ("kimi", "openai"):
        bridge = _import_bridge()
        if bridge is None:
            print("[check_usage] bridge non disponibile per fallback non-claude", file=sys.stderr)
            sys.exit(3)
        if provider == "kimi":
            result, err = check_via_bridge_fetcher(bridge, "fetch_kimi_api", "http:/coding/v1/usages")
        else:  # openai
            result, err = check_via_bridge_fetcher(bridge, "fetch_codex_rollout", "file:rollout-jsonl")
    else:
        # Placeholder esplicito: provider riconosciuto dalla config ma non
        # ancora implementato qui. Intenzionalmente NON facciamo guessing.
        print(f"[check_usage] NOT_IMPLEMENTED: provider '{provider}' non ha ancora una strategia di fallback dedicata. "
              "Aggiungi un branch in check_usage.py + un fetch_<provider>_api() in sentinel-bridge.py.",
              file=sys.stderr)
        sys.exit(4)

    if result is None:
        print(f"[check_usage] FAIL provider={provider} reason={err}", file=sys.stderr)
        sys.exit(2)

    usage = result["usage"]
    reset = result["reset_hhmm_utc"]
    rem = remaining_str(reset)
    weekly = result.get("weekly")
    src = result.get("source", "?")
    verdict = compute_verdict(usage)

    # One-liner scriptable (machine-friendly)
    parts = [f"provider={provider}", f"usage={usage}%"]
    if reset:
        parts.append(f"reset={reset}_utc")
        parts.append(f"reset_in={rem}")
    if weekly is not None:
        parts.append(f"weekly={weekly}%")
    parts.append(f"source={src}")
    print(" ".join(parts))

    # Verdict umano (riga successiva, opzionale per LLM Capitano)
    print(f"verdict: {verdict}")
    print("note: check indipendente dal bridge. Se il bridge è vivo e fresco, preferisci `rate_budget.py plan`.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
