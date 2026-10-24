"""Windows PowerShell 5.1 and the native programs the host scripts run.

Under `$ErrorActionPreference = 'Stop'` the shell the app uses (5.1) turns ANY line a native program
writes on stderr into an error that stops the script as soon as the stream is redirected, `2>$null`
included (T82, T106): the first install of a standard user ended in `docker exec … node -e …`. So a
native call whose stderr is redirected runs where the preference is 'Continue', and a double quote
inside an argument never goes through `node -e '...'` (5.1 strips it: the script reaches node broken).
"""

import re
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
FILES = [
    "jht-wrapper.ps1",
    "install.ps1",
    "enable-podman-windows-runtime.ps1",
    "configure-podman-windows-network.ps1",
    "jht-uninstall-windows.ps1",
]

NATIVE = re.compile(r"&\s+(?:docker|podman|wsl|schtasks)\b|&\s+\$[A-Za-z]*(?:Docker|Podman|Wsl|Shim)[A-Za-z]*\b|&\s+\$(?:podman|docker)\.Source", re.I)
REDIRECT = re.compile(r"(?<![\w/])(?:2>\s*(?:\$null|&1)|\*>\s*\$null)")
GUARD = "ErrorActionPreference = 'Continue'"
WINDOW = 4  # the guard may sit a few lines above a continued command, or in the enclosing block



def _unguarded(name):
    lines = (SCRIPTS / name).read_text(encoding="utf-8").splitlines()
    found = []
    for index, line in enumerate(lines):
        code = line.split("#", 1)[0] if line.lstrip().startswith("#") else line
        if not (NATIVE.search(code) and REDIRECT.search(code)):
            continue
        context = lines[max(0, index - WINDOW): index + 1]
        if not any(GUARD in text or "$previousPreference" in text for text in context):
            found.append((index + 1, line.strip()[:120]))
    return found


def test_every_native_call_with_redirected_stderr_runs_with_continue():
    problems = {name: _unguarded(name) for name in FILES if (SCRIPTS / name).exists()}
    assert {name: hits for name, hits in problems.items() if hits} == {}


def test_no_node_script_goes_through_a_single_quoted_argument_with_double_quotes():
    pattern = re.compile(r"node\s+-e\s+'[^']*\"")
    for name in FILES:
        code = [line for line in (SCRIPTS / name).read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#")]
        assert not pattern.search("\n".join(code)), name


def test_the_cloud_json_fields_are_read_through_stdin():
    wrapper = (SCRIPTS / "jht-wrapper.ps1").read_text(encoding="utf-8")
    assert "function Get-AgentCloudField" in wrapper
    assert "$script | & docker exec -i -u 1001 $AgentId node -" in wrapper
    assert wrapper.count("Get-AgentCloudField -AgentId $agentId") == 3
