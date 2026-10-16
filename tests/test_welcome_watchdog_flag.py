"""Il watchdog del welcome non si fida di un welcomed.flag di un run precedente.

Il 15/10 l'ASSISTENTE e' partito ma non ha mai elaborato il messaggio iniziale.
Il watchdog (`start-agent.sh`, `_welcome_kickoff`) e' uscito al primo controllo
perche' `welcomed.flag` esisteva dal 29/09: il flag dura quanto il profilo, non
quanto l'avvio. In piu', un watchdog che reinietta digitava il testo anche se
quello del primo invio era ancora nel composer, e lo raddoppiava.

Ora (`tui_welcome_watchdog` in `.launcher/tui-helpers.sh`):
  * il flag vale solo se e' PIU' RECENTE del marcatore d'avvio che il launcher
    crea prima del kickoff;
  * flag vecchio + avvio nuovo senza turno  -> reiniezione;
  * turno gia' partito (riga di stato)       -> nessuna reiniezione;
  * testo ancora nel composer                -> solo Enter, mai un secondo incolla
    (anche in `tui_send_verified`, che lo fa per chiunque lo chiami).

Il tmux e' finto (lo stesso di test_tui_send_verified_submit.py, PATH di
test): non tocca MAI il tmux di FLEET. Gira con dash (la /bin/sh del container
dove il watchdog gira davvero, `setsid sh -c`) e con bash.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_tui_send_verified_submit import (  # noqa: E402
    FAKE_TMUX,
    HELPERS,
    LONG_MSG,
    START_AGENT,
    _shells,
)

STALE = "202609290900"  # 29/09, `touch -t`
BOOT = "202610160300"  # l'avvio corrente
FRESH = "202610160305"  # il turno di questo avvio ha toccato il flag


@pytest.fixture(params=_shells() or [None], ids=lambda p: Path(p).name if p else "none")
def shell(request):
    if sys.platform == "win32":
        pytest.skip("il launcher gira nel container Linux")
    if request.param is None:
        pytest.skip("ne' dash ne' bash disponibili")
    return request.param


class _Welcome:
    def __init__(self, tmp_path: Path):
        self.dir = tmp_path / "tui"
        self.dir.mkdir()
        self.bin = tmp_path / "bin"
        self.bin.mkdir()
        (self.bin / "tmux").write_text(FAKE_TMUX, encoding="utf-8", newline="\n")
        (self.bin / "tmux").chmod(0o755)
        (self.bin / "sleep").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8", newline="\n")
        (self.bin / "sleep").chmod(0o755)
        self.flag = tmp_path / "profile" / "welcomed.flag"
        self.flag.parent.mkdir()
        self.marker = tmp_path / "logs" / "welcome-watchdog-assistente.boot"
        self.marker.parent.mkdir()

    def boot(self):
        self.marker.write_text("", encoding="utf-8")
        _touch(self.marker, BOOT)

    def flag_at(self, stamp):
        self.flag.write_text("", encoding="utf-8")
        _touch(self.flag, stamp)

    def composer_holds_the_message(self):
        (self.dir / "composer").write_text(LONG_MSG, encoding="utf-8")

    def turn_running(self):
        (self.dir / "transcript").write_text("• Working (3s • esc to interrupt)\n", encoding="utf-8")

    def watchdog(self, shell, *, enter="accept", retries=1):
        env = {
            **os.environ,
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "FAKE_DIR": str(self.dir),
            "FAKE_STYLE": "codex",
            "FAKE_ENTER": enter,
            "FAKE_BUSY": "0",
            "FAKE_KEEP": "0",
            "FAKE_ROWS": "1000",
            "MSG": LONG_MSG,
        }
        env.pop("TUI_SUBMIT_TRIES", None)
        script = (
            f'. "{HELPERS}"\n'
            f'tui_welcome_watchdog ASSISTENTE "$MSG" "{self.flag}" "{self.marker}" {retries} 0\n'
            'echo "rc=$?"\n'
        )
        result = subprocess.run([shell, "-c", script], capture_output=True, text=True, env=env, timeout=60)
        rc = [line for line in result.stdout.splitlines() if line.startswith("rc=")]
        assert rc, result.stdout + result.stderr
        return int(rc[-1][3:]), result

    def calls(self):
        path = self.dir / "calls"
        return path.read_text(encoding="utf-8").splitlines() if path.exists() else []

    def typed(self):
        return sum(1 for c in self.calls() if c.startswith("send-keys") and " -l " in c)

    def enters(self):
        return sum(1 for c in self.calls() if c.startswith("send-keys") and c.endswith(" Enter"))


def _touch(path: Path, stamp: str):
    subprocess.run(["touch", "-t", stamp, str(path)], check=True)


def test_an_old_flag_with_a_new_boot_and_no_turn_reinjects_the_message(shell, tmp_path):
    w = _Welcome(tmp_path)
    w.flag_at(STALE)
    w.boot()
    rc, out = w.watchdog(shell)
    assert w.typed() == 1, out.stdout + out.stderr
    assert w.enters() == 1
    assert "previous boot" in out.stdout
    assert rc == 1, "il flag e' ancora quello vecchio: il benvenuto non e' confermato"


def test_a_missing_flag_reinjects_the_message(shell, tmp_path):
    w = _Welcome(tmp_path)
    w.boot()
    rc, out = w.watchdog(shell)
    assert w.typed() == 1, out.stdout + out.stderr
    assert rc == 1


def test_a_flag_touched_by_this_boot_ends_the_watchdog(shell, tmp_path):
    w = _Welcome(tmp_path)
    w.boot()
    w.flag_at(FRESH)
    rc, out = w.watchdog(shell)
    assert rc == 0, out.stdout + out.stderr
    assert w.calls() == [], "nessun tasto al tmux: il benvenuto di questo avvio c'e' gia'"


def test_a_turn_already_running_is_not_reinjected(shell, tmp_path):
    w = _Welcome(tmp_path)
    w.flag_at(STALE)
    w.boot()
    w.turn_running()
    rc, out = w.watchdog(shell)
    assert w.typed() == 0, out.stdout + out.stderr
    assert w.enters() == 0
    assert "turn is running" in out.stdout


@pytest.mark.parametrize("flag", ["stale", "missing"])
@pytest.mark.parametrize("enter", ["accept", "lose:1"])
def test_text_still_in_the_composer_gets_only_enter_never_a_second_paste(shell, tmp_path, flag, enter):
    w = _Welcome(tmp_path)
    if flag == "stale":
        w.flag_at(STALE)
    w.boot()
    w.composer_holds_the_message()
    rc, out = w.watchdog(shell, enter=enter)
    assert w.typed() == 0, "il testo e' stato incollato di nuovo: nel composer sarebbe doppio\n" + out.stdout
    assert w.enters() >= 1


def test_several_rounds_with_a_lost_enter_never_paste_twice(shell, tmp_path):
    """Il caso del 15/10: il primo invio lascia il testo nel composer, e i
    giri del watchdog dopo di lui lo ridigitavano."""
    w = _Welcome(tmp_path)
    w.flag_at(STALE)
    w.boot()
    rc, out = w.watchdog(shell, enter="never", retries=3)
    assert rc == 1, out.stdout + out.stderr
    assert w.typed() == 1, "tre giri, un solo incollo"
    assert "giving up" in out.stdout


def test_without_a_boot_marker_an_existing_flag_is_not_trusted(shell, tmp_path):
    w = _Welcome(tmp_path)
    w.flag_at(FRESH)  # nessun marcatore creato
    rc, out = w.watchdog(shell)
    assert w.typed() == 1, out.stdout + out.stderr
    assert rc == 1


def test_start_agent_wires_the_boot_marker_into_the_watchdog():
    source = START_AGENT.read_text(encoding="utf-8")
    block = source[source.index("_welcome_kickoff() {"): source.index('if [ "$ROLE" = "assistente" ]; then\n  _welcome_kickoff')]
    assert "tui_welcome_watchdog" in block
    assert 'welcome_boot_marker="${welcome_log%.log}.boot"' in block
    # il marcatore nasce PRIMA del kickoff, o un flag toccato subito sarebbe "vecchio"
    assert block.index(': >"$welcome_boot_marker"') < block.index('_kickoff "$SESSION" "$msg"')
    # il vecchio test "il file esiste" non deve tornare
    assert '[ -f "$JHT_WELCOME_FLAG" ]' not in block
    # l'agente, col flag gia' presente, deve toccarlo
    assert "Run touch ${welcome_flag}" in block
