"""I processi si fermano per pid, o per un bersaglio che porta il proprio path.

Un `pkill -f "node .*vite"` di un altro team ha ucciso il Vite della nostra
desktop (07/10): un nome prende chiunque si chiami cosi' sulla macchina. Qui un
gate statico su ogni file di codice tracciato:

  - niente `pkill` / `killall` eseguiti (nei commenti si possono nominare);
  - `pgrep -f` solo con un pattern che contiene un path variabile (`$...`,
    per esempio la propria worktree): `pgrep -P <pid>` resta libero;
  - `jht_kill_by_marker` solo con un marker che parte dal path dello script
    lanciato (`"$..._SCRIPT"`), mai con un nome nudo (.launcher/daemon-lib.sh).

Un'eccezione vera va in ALLOWED, con il perche'.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CODE_SUFFIXES = {".sh", ".bash", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx"}
SKIP_PREFIXES = ("archive/",)
THIS_FILE = "tests/test_process_kill_scope.py"

# (file, testo che compare nella riga) -> perche' non e' un kill per nome.
ALLOWED = {
    ("game/tools/run.sh", "pkill -x godot"): (
        "messaggio per l'utente dentro un echo: suggerisce un comando, non lo esegue"
    ),
    ("game/tools/run.sh", 'pgrep -f "godot --path.*job-hunter-team"'): (
        "guarda soltanto se un Godot del progetto e' gia' aperto, per fermarsi: "
        "non uccide niente (game/ e' legacy)"
    ),
    ("desktop/scripts/dev-server.test.mjs", "someone else's pkill"): (
        "il titolo di un test che descrive la difesa dal pkill di un altro team"
    ),
}

KILL_BY_NAME = re.compile(r"""(?:^|[\s;&|(`'"\[,])(pkill|killall)(?=[\s'",\]]|$)""")
PGREP_F = re.compile(r"""\bpgrep\s+(?:-\w+\s+)*-f\s+(?P<pattern>"[^"]*"|'[^']*'|\S+)""")
MARKER = re.compile(r"""\bjht_kill_by_marker\s+(?P<marker>\S+)""")


def _code_files() -> list[str]:
    tracked = subprocess.check_output(["git", "-C", str(ROOT), "ls-files"], text=True)
    files = []
    for name in tracked.splitlines():
        if name == THIS_FILE or name.startswith(SKIP_PREFIXES):
            continue
        path = ROOT / name
        if path.suffix in CODE_SUFFIXES:
            files.append(name)
        elif not path.suffix and path.is_file() and not path.is_symlink():
            try:
                with path.open("rb") as handle:
                    if handle.read(2) == b"#!":
                        files.append(name)
            except OSError:
                pass
    return files


def _code_lines(name: str):
    """(numero, riga) senza le righe che sono solo commento."""
    try:
        text = (ROOT / name).read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return
    for number, line in enumerate(text.splitlines(), 1):
        stripped = line.lstrip()
        if stripped.startswith(("#", "//", "*", "/*")):
            continue
        yield number, line


def _allowed(name: str, line: str) -> bool:
    return any(file == name and snippet in line for file, snippet in ALLOWED)


UNCHECKED_KILL = re.compile(r"""^\s*jht_kill_by_marker\s""")


def test_every_kill_by_marker_result_is_checked():
    """Un kill che non riesce lo dice (exit 1): chi chiama non puo' ignorarlo.

    Una chiamata nuda lancerebbe il daemon nuovo accanto a quello vecchio
    sopravvissuto al segnale (AppArmor nel container). Si chiama dentro un
    `if`, oppure con `|| ...` sulla stessa riga.
    """
    calls, unchecked = 0, []
    for name in _code_files():
        if not name.endswith(".sh"):
            continue
        for number, line in _code_lines(name):
            if "jht_kill_by_marker" not in line or "jht_kill_by_marker()" in line:
                continue
            calls += 1
            if UNCHECKED_KILL.match(line) and "||" not in line:
                unchecked.append(f"{name}:{number}: {line.strip()}")
    assert calls >= 10, "il gate non trova piu' le chiamate: struttura cambiata"
    assert not unchecked, "esito di jht_kill_by_marker ignorato:\n" + "\n".join(unchecked)


def test_the_gate_reads_the_launcher_and_the_scripts():
    """Senza questi file il gate sarebbe verde perche' non legge niente."""
    files = set(_code_files())
    for expected in (
        ".launcher/start-agent.sh",
        ".launcher/daemon-lib.sh",
        "cli/src/commands/pid1.js",
        "scripts/dev-down.sh",
        "tests/test_tg_bridge_spawn_race.py",
    ):
        assert expected in files, expected


def test_no_process_is_stopped_by_name_alone():
    found = []
    for name in _code_files():
        for number, line in _code_lines(name):
            if _allowed(name, line):
                continue
            if KILL_BY_NAME.search(line):
                found.append(f"{name}:{number}: {line.strip()}")
            for match in PGREP_F.finditer(line):
                if "$" not in match.group("pattern"):
                    found.append(f"{name}:{number}: pgrep -f senza un path variabile: {line.strip()}")
            for match in MARKER.finditer(line):
                marker = match.group("marker")
                if marker.startswith("<"):
                    continue  # la firma documentata nella riga d'uso
                if not marker.startswith('"$'):
                    found.append(f"{name}:{number}: marker senza il path dello script: {line.strip()}")
    assert not found, "fermare un processo per nome prende anche quelli degli altri:\n" + "\n".join(found)
