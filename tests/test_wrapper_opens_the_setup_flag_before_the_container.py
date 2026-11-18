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
    return subprocess.run(["bash", "-c", _helpers() + "\n" + body], env=env, capture_output=True, text=True, timeout=30)


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
