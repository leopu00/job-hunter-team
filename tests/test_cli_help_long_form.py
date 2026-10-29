"""`jht help` is the long list of commands, and the short help sends the person to it: the wrappers must not
answer `jht help` with the short help (they did, so the way out of the short help led back to it)."""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SH = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
PS1 = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8")


def test_the_bash_wrapper_forwards_help_as_help_and_the_flags_as_the_short_help():
    assert re.search(r"^  -h\|--help\|''\)\n    serve_help_without_docker --help\n", SH, re.M)
    assert re.search(r"^  help\)\n    serve_help_without_docker help\n", SH, re.M)
    assert "-h|--help|help|''" not in SH


def test_the_powershell_wrapper_forwards_help_as_help_and_the_flags_as_the_short_help():
    assert re.search(r"\$_ -in @\('-h', '--help', ''\) \} \{\n    exit \(Invoke-HelpWithoutDocker '--help'\)", PS1)
    assert re.search(r"'help' \{\n    exit \(Invoke-HelpWithoutDocker 'help'\)", PS1)
    assert "'--help', 'help', ''" not in PS1


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_the_cli_answers_help_with_the_long_list_and_the_flag_with_the_short_one():
    run = lambda *args: subprocess.run(["node", str(ROOT / "cli" / "bin" / "jht.js"), *args], capture_output=True, text=True, timeout=60).stdout
    assert "Essential commands" in run("--help")
    long = run("help")
    assert "Essential commands" not in long and "Commands:" in long and "doctor" in long
