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
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

import private_tmux


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

# Confini dei casi comportamentali. Con uno script `tmux` davanti al binario
# vero nel PATH (un wrapper di sicurezza dell'host), il caso "real" prendeva lo
# script come tmux vero: lo script cerca `tmux` nel PATH, trovava il NOSTRO
# wrapper, che lo richiamava con un altro `-S`. Il loop non finiva mai, e i casi
# rimasti orfani (ppid 1) hanno scritto gigabyte di calls.txt. Ora: PATH chiuso,
# il wrapper rifiuta di richiamarsi, calls.txt ha un tetto, ogni caso ha un
# timeout e il suo gruppo di processi muore a fine caso anche se fallisce.
CASE_TIMEOUT_S = 30
CALLS_CAP_BYTES = 1 << 20


def _tmux_guard(calls: Path) -> str:
    """Prime righe del tmux finto (stub o wrapper): un tmux che richiama se
    stesso, o un calls.txt oltre il tetto, si fermano subito e lasciano un
    segno che la fixture trasforma in un rosso."""
    return (
        'if [ -n "${JHT_TEST_TMUX_ACTIVE:-}" ]; then\n'
        f'  : > "{calls}.loop"; echo "tmux finto richiamato da se stesso: $*" >&2; exit 97\n'
        "fi\n"
        "export JHT_TEST_TMUX_ACTIVE=1\n"
        f'if [ -f "{calls}" ] && [ "$(wc -c < "{calls}")" -gt {CALLS_CAP_BYTES} ]; then\n'
        f'  : > "{calls}.overcap"; echo "calls.txt oltre il tetto" >&2; exit 98\n'
        "fi\n"
    )


def _real_tmux():
    """Il binario di tmux, mai uno script `tmux` davanti a lui: lo script
    cercherebbe `tmux` nel PATH e troverebbe il wrapper."""
    for d in os.environ.get("PATH", "").split(os.pathsep):
        candidate = Path(d or ".") / "tmux"
        if candidate.is_file() and os.access(candidate, os.X_OK):
            with candidate.open("rb") as fh:
                if fh.read(2) != b"#!":
                    return str(candidate)
    return None


def _closed_path(bin_dir: Path) -> str:
    """Il PATH dei casi: prima il tmux finto, poi solo cartelle senza un altro
    `tmux` (la cartella del binario vero resta: il finto la precede)."""
    real = _real_tmux()
    keep = [str(bin_dir)]
    for d in os.environ.get("PATH", "").split(os.pathsep):
        if not d or d in keep:
            continue
        candidate = Path(d) / "tmux"
        if os.path.lexists(candidate) and str(candidate) != real:
            continue
        keep.append(d)
    return os.pathsep.join(keep)


def _kill_group(pgid: int):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(pgid, sig)
        except (ProcessLookupError, PermissionError):
            return
        time.sleep(0.2)


def _self_timer(seconds: int = CASE_TIMEOUT_S + 5) -> str:
    """Prima riga di ogni caso: se pytest muore senza teardown, il caso uccide
    da se' il proprio gruppo poco dopo il timeout."""
    return f"( sleep {seconds}; kill -KILL -- -$$ ) </dev/null >/dev/null 2>&1 &\n"


# Stub che riproduce la risoluzione MISURATA su tmux 3.6. Stato in un file:
# una riga `NOME|pane_current_command|session_created` per sessione.
STUB_TMUX = r"""#!/usr/bin/env bash
state="$T_SESSIONS"
printf '%s\n' "$*" >> "$T_CALLS"
sub="$1"; shift
all_args="$*"; target=""; fmt=""; positional=""
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
  new-session)
    printf '%s|bash|1700000000\n' "$T_NEW" >> "$state" ;;
  send-keys)
    # Il CLI "crasha" al lancio e il pane si chiude: la sessione sparisce.
    case "$all_args" in *" claude "*) grep -vF -- "$T_NEW|" "$state" > "$state.tmp"; mv "$state.tmp" "$state"; exit 0 ;; esac
    s="$(resolve pane)"; [ -n "$s" ] || exit 1
    # Un Enter (non digitato con -l) e' un submit accettato: il composer si
    # svuota, come in una TUI vera; tui_send_verified lo rilegge per crederci.
    case "$all_args" in
      *" -l "*) printf '%s\n' "$positional" >> "$state.typed-$s" ;;
      *) if [ "$positional" = Enter ]; then : > "$state.typed-$s"; else printf '%s\n' "$positional" >> "$state.typed-$s"; fi ;;
    esac
    echo "TYPED-INTO $s" >> "$T_CALLS" ;;
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
        self.sockdir = private_tmux.private_dir("launcher")
        self.socket = self.sockdir / "s"
        wrapper = self.bin / "tmux"
        guard = _tmux_guard(self.calls)
        if kind == "stub":
            shebang, body = STUB_TMUX.split("\n", 1)
            wrapper.write_text(shebang + "\n" + guard + body, encoding="utf-8", newline="\n")
        else:
            real = _real_tmux()
            wrapper.write_text(
                "#!/usr/bin/env bash\n"
                + guard
                + f'printf "%s\\n" "$*" >> "{self.calls}"\n'
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
        if subprocess.run([str(binary), "0"], capture_output=True, timeout=30).returncode != 0:
            # `sleep` is one applet of a multicall binary (uutils coreutils, Ubuntu 26.04): a copy named `claude`
            # is not an applet and exits at once.  Linux names the process by argv[0], so the real sleep is
            # started under the name instead.
            program = f"bash -c 'exec -a \"{binary}\" \"{shutil.which('sleep')}\" 300'"
        started = self.run([str(self.bin / "tmux"), "new-session", "-d", "-s", name, program], timeout=15)
        assert started.returncode == 0, started.stderr
        # pane_current_command si aggiorna appena il processo e' partito
        for _ in range(50):
            out = self.run(
                [str(self.bin / "tmux"), "display-message", "-p", "-t", f"={name}:", "#{pane_current_command}"],
                timeout=5,
            ).stdout.strip()
            if out == command:
                return
            time.sleep(0.1)

    def env(self):
        env = {
            **os.environ,
            "PATH": _closed_path(self.bin),
            "T_SESSIONS": str(self.state),
            "T_CALLS": str(self.calls),
        }
        env.pop("JHT_TEST_TMUX_ACTIVE", None)
        return env

    def run(self, argv, timeout=CASE_TIMEOUT_S) -> subprocess.CompletedProcess:
        """Un processo in un gruppo suo, col PATH chiuso. Alla fine, anche a
        timeout o se il caso fallisce, muore tutto il gruppo: niente orfani.
        Si uccide subito, non al teardown: un gruppo vuoto puo' riavere il suo
        numero da un processo di altri."""
        proc = subprocess.Popen(
            argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env=self.env(), start_new_session=True,
        )
        timed_out = False
        try:
            out, err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            _kill_group(proc.pid)
            try:
                out, err = proc.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                out, err = "", ""
        finally:
            _kill_group(proc.pid)
        if timed_out:
            pytest.fail(f"caso oltre {timeout} s, gruppo ucciso: {argv[:2]}\n{out}{err}")
        return subprocess.CompletedProcess(argv, proc.returncode, out, err)

    def alive(self):
        out = self.run([str(self.bin / "tmux"), "list-sessions", "-F", "#{session_name}"], timeout=5).stdout
        return sorted(line for line in out.splitlines() if line.strip())

    def close(self):
        # The server (if real) goes, then the folder: private_tmux does both, in that order.
        private_tmux.close_dir(self.sockdir)
        loop = self.calls.with_name(self.calls.name + ".loop")
        overcap = self.calls.with_name(self.calls.name + ".overcap")
        assert not loop.exists(), "il tmux finto si e' richiamato da solo (un altro tmux nel PATH?)"
        assert not overcap.exists(), f"calls.txt oltre {CALLS_CAP_BYTES} byte"
        assert not self.calls.exists() or self.calls.stat().st_size <= CALLS_CAP_BYTES * 2


@pytest.fixture(params=["stub", "real"])
def tmux(request, tmp_path):
    if sys.platform == "win32":
        pytest.skip("gli script del launcher girano nel container Linux")
    if request.param == "real" and not _real_tmux():
        pytest.skip("tmux non installato: il caso stub copre la stessa risoluzione")
    t = _Tmux(request.param, tmp_path)
    yield t
    t.close()


def _run(capable_bash, tmux: _Tmux, body: str) -> subprocess.CompletedProcess:
    home = tmux.tmp / "home"
    (home / "logs").mkdir(parents=True, exist_ok=True)
    script = (
        _self_timer()
        + f"export JHT_HOME='{home}'\n"
        f"export T_SESSIONS='{tmux.state}' T_CALLS='{tmux.calls}'\n"
        + _prelude()
        + f"\nexport PATH='{tmux.bin}':\"$PATH\"\n"
        + body
        + "\n"
    )
    path = tmux.tmp / "case.sh"
    path.write_text(script, encoding="utf-8", newline="\n")
    return tmux.run([capable_bash, str(path)])


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
        _self_timer()
        + f"export T_SESSIONS='{tmux.state}' T_CALLS='{tmux.calls}'\n"
        f"export PATH='{tmux.bin}':\"$PATH\"\n"
        f"source '{LAUNCHER / 'tui-helpers.sh'}'\n"
        + body
        + "\n"
    )
    return tmux.run([capable_bash, "-c", script])


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
        pane = tmux.run([str(tmux.bin / "tmux"), "capture-pane", "-p", "-t", "=CRITICO-S1:"], timeout=5).stdout
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


# ── start-agent.sh worker: la sonda del REPL non legge il pane di una sorella ─


def test_the_sentinel_worker_repl_probe_never_reads_a_sibling(capable_bash, tmp_path, healthy_disk):
    """SENTINELLA-WORKER nasce, il CLI crasha e il pane si chiude; resta viva
    una sessione che ne estende il nome con un CLI vivo. Col target nudo la
    sonda leggeva `claude` nella sorella e stampava "started"."""
    if sys.platform == "win32":
        pytest.skip("il launcher gira nel container Linux")
    tmux = _Tmux("stub", tmp_path)
    try:
        tmux.add("SENTINELLA-WORKER-OLD", "claude")
        home = tmp_path / "home"
        home.mkdir()
        script = (
            _self_timer(95)
            + f"export T_SESSIONS='{tmux.state}' T_CALLS='{tmux.calls}' T_NEW=SENTINELLA-WORKER\n"
            f"export PATH='{tmux.bin}':\"$PATH\" JHT_HOME='{home}'\n"
            f"bash '{LAUNCHER / 'start-agent.sh'}' worker; echo \"rc=$?\"\n"
        )
        result = tmux.run([capable_bash, "-c", script], timeout=90)
        out = result.stdout + result.stderr
        assert "rc=1" in out, out
        assert "SENTINELLA-WORKER started" not in out, out
        assert "REPL did not start" in out, out
        assert tmux.alive() == ["SENTINELLA-WORKER-OLD"], "la sorella non va toccata"
    finally:
        tmux.close()
