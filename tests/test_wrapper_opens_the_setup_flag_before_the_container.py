"""`jht setup` says on the host that the setup is open BEFORE it starts the container: the watchdog of the container wakes the
Assistant and the Mentor as soon as it is up, and the flag the wizard writes itself came 40 seconds later."""
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SH = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8").replace("\r\n", "\n")
PS1 = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")


def _helpers() -> str:
    start = SH.index("setup_wizard_args() {")
    end = SH.index("setup_open_flag_remove()")
    return SH[start:SH.index("\n", end)]


def _bash(home: Path, body: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "HOME": str(home), "JHT_HOME_HOST": ""}
    env.pop("JHT_HOME_HOST")
    # the two words the helpers say with, as the wrapper has them: a warning on stderr and the key of its text
    say = 'warn() { printf "warn: %s\\n" "$*" >&2; }\njht_say() { printf "%s %s" "$1" "$2"; }\n'
    return subprocess.run(["bash", "-c", say + _helpers() + "\n" + body], env=env, capture_output=True, text=True, timeout=30)


def test_the_flag_is_written_before_ensure_up_and_removed_after_the_wizard_in_both_wrappers():
    case = SH[SH.index("\n  setup)\n"):]
    case = case[:case.index("\n    ;;")]
    assert case.index("setup_open_flag_write") < case.index("ensure_up") < case.index("setup_exec_container") < case.index("setup_open_flag_remove")
    block = PS1[PS1.index("$keyPlan = Convert-SetupKeyFileArgs $Rest"):]
    block = block[:block.index("'download' {")]
    assert block.index("Write-JhtSetupOpenFlag") < block.index("Ensure-Up") < block.index("Remove-JhtSetupOpenFlag")


def test_only_the_wizard_opens_the_flag():
    home = Path(os.environ.get("TMPDIR", "/tmp"))
    for argv, expected in (("", 0), ("--lang it", 0), ("--non-interactive --provider claude", 1), ("cloud pair", 1)):
        out = _bash(home, f"setup_wizard_args {argv}; echo $?")
        assert out.stdout.strip() == str(expected), (argv, out.stdout, out.stderr)


def test_the_flag_is_written_fresh_never_through_a_link_and_removed(tmp_path):
    home = tmp_path / "h"
    (home / ".jht").mkdir(parents=True)
    out = _bash(home, "setup_open_flag_write")
    flag = home / ".jht" / ".setup-open.flag"
    assert out.returncode == 0 and flag.is_file() and not flag.is_symlink()
    assert oct(flag.stat().st_mode & 0o777) == "0o600"
    flag.unlink()
    target = tmp_path / "secret.txt"
    target.write_text("keep", encoding="utf-8")
    flag.symlink_to(target)
    _bash(home, "setup_open_flag_write")
    assert target.read_text(encoding="utf-8") == "keep" and flag.is_file() and not flag.is_symlink()
    _bash(home, "setup_open_flag_remove")
    assert not flag.exists() and target.exists()


def test_a_missing_folder_is_not_created_and_not_an_error(tmp_path):
    out = _bash(tmp_path / "nohome", "setup_open_flag_write; echo done")
    assert out.stdout.strip() == "done" and not (tmp_path / "nohome").exists()


def test_a_flag_that_cannot_be_written_is_said_and_not_skipped_in_silence(tmp_path):
    """Collaudo Linux 23/11: the first round of the watchdog did not see the flag, and nothing said whether it had been written."""
    home = tmp_path / "h"
    folder = home / ".jht"
    folder.mkdir(parents=True)
    out = _bash(home, "setup_open_flag_write")
    assert out.stderr == "", "a flag written is said nothing about"
    flag = folder / ".setup-open.flag"
    old = 1_700_000_000
    os.utime(flag, (old, old))                 # a flag of a setup of long ago, in a folder this user can no longer write
    folder.chmod(0o500)
    try:
        out = _bash(home, "setup_open_flag_write; echo rc=$?")
    finally:
        folder.chmod(0o700)
    assert "rc=0" in out.stdout, "the setup goes on"
    assert f"warn: line.setup_open_flag_not_written {flag}" in out.stderr, out.stderr
    flag.unlink()
    folder.chmod(0o500)
    try:
        out = _bash(home, "setup_open_flag_write")
    finally:
        folder.chmod(0o700)
    assert "line.setup_open_flag_not_written" in out.stderr and not flag.exists()


def test_the_text_of_the_warning_is_there_in_every_language_of_the_wrapper():
    lines = [line for line in SH.splitlines() if line.startswith("    line.setup_open_flag_not_written) printf '%s' ")]
    assert len(lines) == 7 and all(line.count("%s") == 2 for line in lines), lines
