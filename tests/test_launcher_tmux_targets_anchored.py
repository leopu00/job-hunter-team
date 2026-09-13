"""I daemon di `.launcher/` non devono mai risolvere un target tmux per PREFISSO.

tmux cerca un nome esatto, poi il primo che INIZIA come lui. Con SENTINELLA
morta e SENTINELLA-WORKER viva, `agent-watchdog.sh` chiedeva
`has-session -t SENTINELLA` e riceveva "viva": la SENTINELLA non veniva mai
rispawnata, e il ramo ZOMBIE di `is_session_alive` — il pane della sorella
non e' un CLI LLM — lanciava `kill-session -t SENTINELLA`, cioe' uccideva la
SENTINELLA-WORKER. Lo stesso difetto era gia' stato chiuso in `start-agent.sh`
(7f77893ac7) e restava aperto nel watchdog.

Due forme, perche' `=` vale solo sulla parte SESSIONE di un target:

- `=NOME`  per i comandi a target sessione (`has-session`, `kill-session`);
- `=NOME:` per quelli a target finestra/pane. Misurato su tmux 3.6:
  `list-panes -t =NOME` senza i due punti, con NOME assente, restituisce i pane
  della sorella; `capture-pane -t =NOME` fallisce sempre.

Il test statico sorveglia la FORMA in ogni daemon; quello comportamentale gira
due volte — contro tmux vero su un socket privato quando c'e', e contro uno
stub che riproduce la risoluzione misurata — perche' la CI puo' non avere tmux
e un test che salta sempre non protegge niente.
"""

import os
import re
import shutil
import tempfile
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
LAUNCHER = ROOT / ".launcher"
WATCHDOG = LAUNCHER / "agent-watchdog.sh"

# Daemon che parlano a tmux: TUTTI i loro target devono essere ancorati.
SHELL_DAEMONS = ["agent-watchdog.sh", "codex-auth-healer.sh", "tui-helpers.sh"]
PYTHON_DAEMONS = ["sentinel-bridge.py", "stepcap-watchdog.py"]
# In spawn-lib.sh le due funzioni che DECIDONO (il REPL e' su?) o DISTRUGGONO
# (kill) una sessione per nome. Le altre funzioni della libreria mandano tasti
# a una sessione appena creata dallo stesso processo, dove l'exact match vince
# comunque: e' la stessa scelta motivata in 7f77893ac7 per start-agent.sh.
SPAWN_LIB_FUNCTIONS = ["jht_spawn_kill_sessions", "jht_spawn_wait_repl"]

SESSION_COMMANDS = {"has-session", "kill-session"}
PANE_COMMANDS = {
    "list-panes",
    "display-message",
    "capture-pane",
    "send-keys",
    "paste-buffer",
}


def _shell_code_lines(text: str):
    for number, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        yield number, line


def _function_body(text: str, name: str) -> str:
    start = text.index(f"{name}() {{")
    return text[start : text.index("\n}\n", start) + 3]


# `jht_spawn_tmux` (spawn-lib.sh) e' tmux con un tetto: il target conta uguale.
SHELL_CALL = re.compile(r"(?<![\w-])(?:jht_spawn_)?tmux\s+([a-z-]+)\b([^|;&)]*)")


def _shell_targets(text: str):
    """(riga, sottocomando, target) per ogni `tmux <cmd> ... -t <target>`."""
    for number, line in _shell_code_lines(text):
        for match in SHELL_CALL.finditer(line):
            command, args = match.group(1), match.group(2)
            target = re.search(r"-t\s+(\"[^\"]*\"|\S+)", args)
            if target:
                yield number, command, target.group(1).strip('"')


PY_CALL = re.compile(r"""(?:\[\s*"tmux",|_tmux\()\s*"([a-z-]+)"(.*?)[\])]""", re.S)


def _python_targets(text: str):
    for match in PY_CALL.finditer(text):
        command, args = match.group(1), match.group(2)
        target = re.search(r'"-t",\s*([^,\]\)]+)', args)
        if target:
            number = text.count("\n", 0, match.start()) + 1
            yield number, command, target.group(1).strip()


def _shell_offence(command: str, target: str):
    if target.startswith("$pane_id") or target.startswith("%"):
        return None  # un pane_id e' univoco sul server: niente prefisso
    if not target.startswith("="):
        return "not anchored with ="
    if command in PANE_COMMANDS and not target.endswith(":"):
        return "pane/window target without the trailing ':'"
    if command in SESSION_COMMANDS and target.endswith(":"):
        return "session target must be =NAME"
    return None


def _python_offence(command: str, target: str):
    if command in PANE_COMMANDS and target.startswith("_pane_target("):
        return None  # la forma la verifica test_the_stepcap_pane_target_is_exact
    if not re.fullmatch(r'f"=\{[A-Za-z_]+\}' + (":" if command in PANE_COMMANDS else "") + '"', target):
        return f"expected f\"={{name}}{':' if command in PANE_COMMANDS else ''}\""
    return None


def test_every_daemon_tmux_target_is_anchored():
    offenders, seen = [], 0
    for name in SHELL_DAEMONS:
        for number, command, target in _shell_targets((LAUNCHER / name).read_text(encoding="utf-8")):
            seen += 1
            why = _shell_offence(command, target)
            if why:
                offenders.append(f"{name}:{number} tmux {command} -t {target} — {why}")
    spawn_lib = (LAUNCHER / "spawn-lib.sh").read_text(encoding="utf-8")
    for function in SPAWN_LIB_FUNCTIONS:
        for number, command, target in _shell_targets(_function_body(spawn_lib, function)):
            if command == "send-keys":
                continue  # sessione appena creata da questo processo
            seen += 1
            why = _shell_offence(command, target)
            if why:
                offenders.append(f"spawn-lib.sh {function} tmux {command} -t {target} — {why}")
    for name in PYTHON_DAEMONS:
        for number, command, target in _python_targets((LAUNCHER / name).read_text(encoding="utf-8")):
            seen += 1
            why = _python_offence(command, target)
            if why:
                offenders.append(f"{name}:{number} tmux {command} -t {target} — {why}")
    # Un gate che cerca deve rifiutare una ricerca vuota: se il parser smette
    # di riconoscere le chiamate, "zero offensori" non dimostra niente.
    assert seen >= 20, f"trovati solo {seen} target: il parser non riconosce piu' le chiamate"
    assert not offenders, "\n".join(offenders)


def test_the_stepcap_pane_target_is_exact():
    source = (LAUNCHER / "stepcap-watchdog.py").read_text(encoding="utf-8")
    body = source[source.index("def _pane_target(") :]
    body = body[: body.index("\ndef ")]
    assert 'return f"={session}:"' in body, body


def test_the_parser_recognises_an_unanchored_target():
    """Contro-prova del gate: le forme rotte vengono davvero riconosciute."""
    broken = 'tmux has-session -t "$session" 2>/dev/null || return 1\n' \
             'cmd=$(tmux list-panes -t "=$session" -F x | head -1)\n'
    found = [(_c, _t, _shell_offence(_c, _t)) for _, _c, _t in _shell_targets(broken)]
    assert [f[0] for f in found] == ["has-session", "list-panes"]
    assert all(f[2] for f in found), found
    broken_py = 'subprocess.run(["tmux", "send-keys", "-t", session, "Escape"])'
    found_py = list(_python_targets(broken_py))
    assert found_py and _python_offence(found_py[0][1], found_py[0][2])


# ── Comportamento: due sessioni con prefisso comune ──────────────────────────

# Stub che riproduce la risoluzione MISURATA su tmux 3.6. Stato in un file:
# una riga `NOME|pane_current_command|session_created` per sessione.
STUB_TMUX = r"""#!/usr/bin/env bash
state="$T_SESSIONS"
printf '%s\n' "$*" >> "$T_CALLS"
sub="$1"; shift
target=""; fmt=""; positional=""
while [ $# -gt 0 ]; do
  case "$1" in
    -t) target="$2"; shift 2 ;;
    -F) fmt="$2"; shift 2 ;;
    -p|-d) shift ;;
    -S) shift 2 ;;
    *) positional="$1"; shift ;;
  esac
done
names() { cut -d'|' -f1 "$state"; }
exact() { names | grep -Fx -- "$1" | head -1; }
prefix() { names | while IFS= read -r n; do case "$n" in "$1"*) echo "$n"; break ;; esac; done; }
resolve() {  # $1 = session | window | pane
  local body name
  case "$target" in
    %*) names | sed -n "${target#%}p" ;;  # pane_id = numero di riga
    =*)
      body="${target#=}"
      case "$body" in
        *:*) exact "${body%%:*}" ;;
        *)
          case "$1" in
            session) exact "$body" ;;
            window) exact "$body"; [ -n "$(exact "$body")" ] || prefix "$body" ;;
            pane) : ;;
          esac ;;
      esac ;;
    *)
      name="${target%%:*}"
      if [ -n "$(exact "$name")" ]; then exact "$name"; else prefix "$name"; fi ;;
  esac
}
field() { grep -F -- "$1|" "$state" | cut -d'|' -f"$2" | head -1; }
render() { local s="$1" f="$2"
  f="${f//\#\{session_name\}/$s}"
  f="${f//\#\{pane_current_command\}/$(field "$s" 2)}"
  f="${f//\#\{session_created\}/$(field "$s" 3)}"
  f="${f//\#\{pane_id\}/%$(names | grep -nFx -- "$s" | cut -d: -f1)}"
  printf '%s\n' "$f"; }
case "$sub" in
  list-sessions) names ;;
  has-session) [ -n "$(resolve session)" ] ;;
  kill-session)
    s="$(resolve session)"; [ -n "$s" ] || exit 1
    grep -vF -- "$s|" "$state" > "$state.tmp"; mv "$state.tmp" "$state" ;;
  list-panes) s="$(resolve window)"; [ -n "$s" ] || exit 1; render "$s" "$fmt" ;;
  display-message) s="$(resolve window)"; [ -n "$s" ] || exit 0; render "$s" "$positional" ;;
  capture-pane) s="$(resolve pane)"; [ -n "$s" ] || exit 1; echo "pane of $s"; cat "$state.typed-$s" 2>/dev/null ;;
  send-keys) s="$(resolve pane)"; [ -n "$s" ] || exit 1; printf '%s\n' "$positional" >> "$state.typed-$s"; echo "TYPED-INTO $s" >> "$T_CALLS" ;;
  *) exit 0 ;;
esac
"""


def _prelude() -> str:
    """Variabili e funzioni del watchdog senza il loop infinito. Le funzioni
    definite DOPO il marker (capture_for_containment) si estraggono per nome:
    senza, il test chiamerebbe un comando inesistente e passerebbe a vuoto."""
    source = WATCHDOG.read_text(encoding="utf-8")
    marker = 'log "watchdog start'
    assert marker in source, "il marker prima del loop watchdog e' cambiato"
    head = source[: source.index(marker)]
    extra = [
        _function_body(source, name)
        for name in ("capture_for_containment",)
        if f"{name}() {{" not in head
    ]
    return head + "\n" + "\n".join(extra)


class _Tmux:
    """Due sessioni dietro la stessa interfaccia: stub o tmux vero."""

    def __init__(self, kind: str, tmp_path: Path):
        self.kind = kind
        self.tmp = tmp_path
        self.bin = tmp_path / "bin"
        self.bin.mkdir()
        self.state = tmp_path / "sessions.txt"
        self.state.write_text("", encoding="utf-8")
        self.calls = tmp_path / "calls.txt"
        # Il path di un socket unix ha un tetto di ~104 byte e la tmp di pytest
        # su macOS lo supera: il socket vive in una dir corta a parte.
        self.sockdir = Path(tempfile.mkdtemp(prefix="jt-", dir="/tmp" if os.path.isdir("/tmp") else None))
        self.socket = self.sockdir / "s"
        wrapper = self.bin / "tmux"
        if kind == "stub":
            wrapper.write_text(STUB_TMUX, encoding="utf-8", newline="\n")
        else:
            real = shutil.which("tmux")
            wrapper.write_text(
                "#!/usr/bin/env bash\n"
                f'printf "%s\\n" "$*" >> "{self.calls}"\n'
                f'exec "{real}" -S "{self.socket}" "$@"\n',
                encoding="utf-8",
                newline="\n",
            )
        wrapper.chmod(0o755)

    def add(self, name: str, command: str):
        if self.kind == "stub":
            with self.state.open("a", encoding="utf-8") as fh:
                fh.write(f"{name}|{command}|1700000000\n")
            return
        # tmux riporta il NOME del processo in foreground: una copia di `sleep`
        # chiamata `claude` e' un CLI della whitelist senza avviarne nessuno
        # (`python3` non va bene: su molti host il processo si chiama
        # `python3.12`, fuori whitelist).
        binary = self.bin / command
        if not binary.exists():
            shutil.copy(shutil.which("sleep"), binary)
            if sys.platform == "darwin":
                # macOS uccide (137) una copia di un binario di sistema la cui
                # firma non corrisponde piu' al path: firma ad-hoc.
                subprocess.run(["codesign", "-f", "-s", "-", str(binary)],
                               capture_output=True, timeout=30)
        program = f"'{binary}' 300"
        subprocess.run(
            [str(self.bin / "tmux"), "new-session", "-d", "-s", name, program],
            check=True,
            timeout=15,
        )
        # pane_current_command si aggiorna appena il processo e' partito
        for _ in range(50):
            out = subprocess.run(
                [str(self.bin / "tmux"), "display-message", "-p", "-t", f"={name}:", "#{pane_current_command}"],
                capture_output=True, text=True, timeout=5,
            ).stdout.strip()
            if out == command:
                return
            subprocess.run(["sleep", "0.1"])

    def env(self):
        return {**os.environ, "T_SESSIONS": str(self.state), "T_CALLS": str(self.calls)}

    def alive(self):
        out = subprocess.run(
            [str(self.bin / "tmux"), "list-sessions", "-F", "#{session_name}"],
            capture_output=True, text=True, timeout=5, env=self.env(),
        ).stdout
        return sorted(line for line in out.splitlines() if line.strip())

    def close(self):
        if self.kind == "real":
            subprocess.run([str(self.bin / "tmux"), "kill-server"], capture_output=True, timeout=10)
        shutil.rmtree(self.sockdir, ignore_errors=True)


@pytest.fixture(params=["stub", "real"])
def tmux(request, tmp_path):
    if sys.platform == "win32":
        pytest.skip("gli script del launcher girano nel container Linux")
    if request.param == "real" and not shutil.which("tmux"):
        pytest.skip("tmux non installato: il caso stub copre la stessa risoluzione")
    t = _Tmux(request.param, tmp_path)
    yield t
    t.close()


def _run(capable_bash, tmux: _Tmux, body: str) -> subprocess.CompletedProcess:
    home = tmux.tmp / "home"
    (home / "logs").mkdir(parents=True, exist_ok=True)
    script = (
        f"export JHT_HOME='{home}'\n"
        f"export T_SESSIONS='{tmux.state}' T_CALLS='{tmux.calls}'\n"
        + _prelude()
        + f"\nexport PATH='{tmux.bin}':\"$PATH\"\n"
        + body
        + "\n"
    )
    path = tmux.tmp / "case.sh"
    path.write_text(script, encoding="utf-8", newline="\n")
    return subprocess.run(
        [capable_bash, str(path)], capture_output=True, text=True, timeout=60
    )


def test_a_dead_session_is_not_reported_alive_through_its_sibling(capable_bash, tmux):
    """SENTINELLA assente, SENTINELLA-WORKER viva con un CLI della whitelist."""
    tmux.add("SENTINELLA-WORKER", "claude")
    result = _run(
        capable_bash, tmux,
        'if is_session_alive SENTINELLA; then echo VERDICT=alive; else echo VERDICT=dead; fi',
    )
    assert "VERDICT=dead" in result.stdout, result.stdout + result.stderr
    assert tmux.alive() == ["SENTINELLA-WORKER"]


def test_the_zombie_branch_never_kills_the_sibling(capable_bash, tmux):
    """Il pane della sorella non e' un CLI LLM: col prefisso diventava ZOMBIE
    e il kill atterrava su SENTINELLA-WORKER."""
    tmux.add("SENTINELLA-WORKER", "sleep")
    result = _run(
        capable_bash, tmux,
        'is_session_alive SENTINELLA; echo "rc=$?"',
    )
    assert "rc=1" in result.stdout, result.stdout + result.stderr
    assert "ZOMBIE" not in result.stdout, result.stdout
    assert tmux.alive() == ["SENTINELLA-WORKER"], "il watchdog ha ucciso la sessione sorella"


def test_an_exact_session_is_still_seen_and_its_own_zombie_still_killed(capable_bash, tmux):
    """Contro-prova: l'ancoraggio non deve accecare il caso sano ne' il ramo
    ZOMBIE vero."""
    tmux.add("SCOUT-10", "claude")
    tmux.add("SCOUT-1", "sleep")
    result = _run(
        capable_bash, tmux,
        'is_session_alive SCOUT-10 && echo TEN=alive\n'
        'is_session_alive SCOUT-1 || echo ONE=dead',
    )
    assert "TEN=alive" in result.stdout, result.stdout + result.stderr
    assert "ONE=dead" in result.stdout and "ZOMBIE" in result.stdout, result.stdout
    assert tmux.alive() == ["SCOUT-10"]


def test_the_session_age_is_never_read_from_a_sibling(capable_bash, tmux):
    tmux.add("CRITICO-S1", "claude")
    result = _run(
        capable_bash, tmux,
        'if session_age_h CRITICO >/dev/null; then echo AGE=read; else echo AGE=none; fi',
    )
    assert "AGE=none" in result.stdout, result.stdout + result.stderr


def test_the_containment_capture_never_lands_on_a_sibling(capable_bash, tmux):
    tmux.add("SCRITTORE-10", "claude")
    result = _run(
        capable_bash, tmux,
        'type capture_for_containment >/dev/null || { echo MISSING; exit 3; }\n'
        'if capture_for_containment SCRITTORE-1 >/dev/null; then echo CAP=yes; else echo CAP=no; fi',
    )
    assert "CAP=no" in result.stdout, result.stdout + result.stderr
    assert not list((tmux.tmp / "home" / "logs" / "containment").glob("*SCRITTORE-1*"))


# ── tui-helpers.sh: il kick-off non deve finire nel pane di una sorella ──────


def _tui_run(capable_bash, tmux: _Tmux, body: str) -> subprocess.CompletedProcess:
    script = (
        f"export T_SESSIONS='{tmux.state}' T_CALLS='{tmux.calls}'\n"
        f"export PATH='{tmux.bin}':\"$PATH\"\n"
        f"source '{LAUNCHER / 'tui-helpers.sh'}'\n"
        + body
        + "\n"
    )
    return subprocess.run([capable_bash, "-c", script], capture_output=True, text=True, timeout=60)


def test_a_kickoff_is_never_typed_into_a_sibling_session(capable_bash, tmux):
    """CRITICO assente, CRITICO-S1 (review di uno Scrittore) viva."""
    tmux.add("CRITICO-S1", "claude")
    result = _tui_run(
        capable_bash, tmux,
        'if tui_send_verified CRITICO "[KICKOFF] start the review" "" 1; then echo SENT; else echo NOT-SENT; fi\n'
        'if _tui_is_shell_pane CRITICO; then echo SHELL; else echo NOT-SHELL; fi',
    )
    assert "NOT-SENT" in result.stdout, result.stdout + result.stderr
    calls = tmux.calls.read_text(encoding="utf-8") if tmux.calls.exists() else ""
    assert "TYPED-INTO CRITICO-S1" not in calls, calls
    if tmux.kind == "real":
        pane = subprocess.run(
            [str(tmux.bin / "tmux"), "capture-pane", "-p", "-t", "=CRITICO-S1:"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        assert "KICKOFF" not in pane, pane


def test_a_kickoff_still_reaches_its_own_session(capable_bash, tmux):
    """Contro-prova: l'ancoraggio non deve accecare il caso sano (solo stub:
    la sessione vera non ha una TUI che faccia eco del testo)."""
    if tmux.kind == "real":
        pytest.skip("serve un pane che faccia eco del testo digitato")
    tmux.add("CRITICO", "claude")
    tmux.add("CRITICO-S1", "claude")
    result = _tui_run(
        capable_bash, tmux,
        'tui_send_verified CRITICO "[KICKOFF] start the review" "" 1 && echo SENT',
    )
    assert "SENT" in result.stdout, result.stdout + result.stderr
    calls = tmux.calls.read_text(encoding="utf-8")
    assert "TYPED-INTO CRITICO" in calls and "TYPED-INTO CRITICO-S1" not in calls, calls
