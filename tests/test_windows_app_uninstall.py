"""The desktop app's Windows uninstaller and the team: what it stops, what it removes, what it never touches.

desktop/src-tauri/windows/installer-hooks.nsi (NSIS_HOOK_PREUNINSTALL) runs
scripts/jht-uninstall-windows.ps1, shipped next to the app (tauri.windows.conf.json):
- never when the updater runs the uninstaller (/UPDATE);
- silent (/S) or passive (/P): Keep. Data intact, our Podman machine stopped
  normally, a report of what stays;
- with the wizard: a question with No as the default; Yes = Remove, a closed
  list of this user's paths, one outcome each, junctions removed as links.
The template's checkbox «Delete the application data» follows the answer and
is never turned on by the hook when silent, passive or updating.

Two halves:
- the hook, run by a small interpreter of the NSIS it uses (LogicLib blocks,
  StrCpy, MessageBox, plugin calls), over every combination of /UPDATE, /S,
  /P, the answer, the game and a running app;
- the script, run by the PowerShell under test (pwsh off Windows; on Windows
  JHT_TEST_SHELL, 5.1 by default) on two fake profiles, with a fake podman,
  fake scheduled tasks and a fake HKCU\\Environment; on Windows also the real
  HKCU\\Environment, on a scratch value.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

import pytest

from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, install_fake, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "jht-uninstall-windows.ps1"
HOOKS = ROOT / "desktop" / "src-tauri" / "windows" / "installer-hooks.nsi"
WINDOWS_CONF = ROOT / "desktop" / "src-tauri" / "tauri.windows.conf.json"
INSTALL_PS1 = ROOT / "scripts" / "install.ps1"

needs_powershell = pytest.mark.skipif(not WINDOWS and shutil.which("pwsh") is None and not os.environ.get("JHT_TEST_PWSH"),
                                      reason="needs PowerShell")

GAME_TEXT_IT = "la cartella dei dati resta perché la usa anche il gioco: per toglierla disinstalla anche il gioco"


# ── The hook, interpreted ────────────────────────────────────────────────

LANGS = {"LANG_ENGLISH": "1033", "LANG_ITALIAN": "1040", "LANG_GERMAN": "1031", "LANG_SPANISH": "1034",
         "LANG_FRENCH": "1036", "LANG_HUNGARIAN": "1038", "LANG_PORTUGUESE": "2070"}


def _hooks_text() -> str:
    return HOOKS.read_text(encoding="utf-8-sig")


def _logical_lines(text: str) -> list[str]:
    out, pending = [], ""
    for raw in text.splitlines():
        line = raw.strip()
        if line.endswith("\\"):
            pending += line[:-1] + " "
            continue
        out.append(pending + line)
        pending = ""
    return [line for line in out if line and not line.startswith(";")]


def _macros(lines: list[str]) -> dict[str, tuple[list[str], list[str]]]:
    macros, name, params, body = {}, None, [], []
    for line in lines:
        if line.startswith("!macroend"):
            macros[name] = (params, body)
            name = None
        elif line.startswith("!macro "):
            parts = line.split()
            name, params, body = parts[1], parts[2:], []
        elif name:
            body.append(line)
    return macros


def _tokens(line: str) -> list[str]:
    """Words of an NSIS line: "...", '...' and `...` are one word each, quotes removed."""
    words, i = [], 0
    while i < len(line):
        c = line[i]
        if c.isspace():
            i += 1
        elif c in "\"'`":
            end = line.index(c, i + 1)
            words.append(line[i + 1 : end])
            i = end + 1
        else:
            end = i
            while end < len(line) and not line[end].isspace():
                end += 1
            words.append(line[i:end])
            i = end
    return words


class Aborted(Exception):
    pass


class Hook:
    """Runs NSIS_HOOK_PREUNINSTALL as the uninstaller would, for one situation."""

    def __init__(self, *, update=False, silent=False, passive=False, answer_yes=False, game=False,
                 app_running=False, ok_to_close=True, ticked=False, exit_code="0", language="LANG_ITALIAN"):
        text = _hooks_text()
        self.lines = _logical_lines(text)
        self.macros = _macros(self.lines)
        self.defines = {**LANGS, "INSTALLMODE": "currentUser", "MAINBINARYNAME": "jht-desktop",
                        "PRODUCTNAME": "Job Hunter Team"}
        for match in re.finditer(r'^!define\s+(\w+)\s+"([^"]*)"', text, re.M):
            self.defines[match.group(1)] = match.group(2)
        interactive = not silent and not passive
        self.vars = {
            "UpdateMode": "1" if update else "", "PassiveMode": "1" if passive else "",
            "DeleteAppDataCheckboxState": ("1" if ticked else "0") if interactive else "",
            "LANGUAGE": LANGS[language], "INSTDIR": r"C:\Users\someone\AppData\Local\Job Hunter Team",
            "SYSDIR": r"C:\Windows\System32", "TEMP": r"C:\Users\someone\AppData\Local\Temp",
        }
        self.silent, self.answer_yes, self.game = silent, answer_yes, game
        self.app_running, self.ok_to_close, self.exit_code = app_running, ok_to_close, exit_code
        self.stack: list[str] = []
        self.boxes: list[tuple[str, str]] = []
        self.execs: list[str] = []
        self.checkbox_writes: list[str] = []
        self.events: list[str] = []
        self.aborted = False

    def sub(self, value: str) -> str:
        value = re.sub(r"\$\{(\w+)\}", lambda m: self.defines.get(m.group(1), m.group(0)), value)
        value = re.sub(r"\$\{(\w+)\}", lambda m: self.defines.get(m.group(1), m.group(0)), value)
        value = value.replace("$\\n", "\n")
        return re.sub(r"\$(\w+)", lambda m: self.vars.get(m.group(1), m.group(0)), value)

    def _box(self, words: list[str]) -> str:
        flags, text = words[1], self.sub(words[2])
        self.boxes.append((flags, text))
        self.events.append("box")
        return flags

    def condition(self, words: list[str]) -> bool:
        if words[0] == "${Silent}":
            return self.silent
        if words[0] == "${RunningX64}":
            return True
        if words[0] == "${Cmd}":
            inner = _tokens(words[1])
            assert inner[0] == "MessageBox", words
            flags = self._box(inner)
            if inner[-1] == "IDYES":
                assert "MB_YESNO" in flags
                return self.answer_yes
            if inner[-1] == "IDOK":
                return self.ok_to_close
            raise AssertionError(f"unknown MessageBox test: {words}")
        left, op, right = self.sub(words[0]), words[1], self.sub(words[2])
        if op in ("=", "<>"):
            equal = int(left or "0") == int(right or "0")
            return equal if op == "=" else not equal
        if op in ("==", "!="):
            equal = left.lower() == right.lower()
            return equal if op == "==" else not equal
        raise AssertionError(f"unknown condition: {words}")

    def statement(self, words: list[str]) -> None:
        head = words[0]
        if head == "StrCpy":
            name, value = words[1].lstrip("$"), self.sub(words[2])
            self.vars[name] = value
            if name == "DeleteAppDataCheckboxState":
                self.checkbox_writes.append(value)
        elif head == "Pop":
            self.vars[words[1].lstrip("$")] = self.stack.pop()
        elif head == "MessageBox":
            self._box(words)
        elif head == "Abort":
            self.aborted = True
            raise Aborted
        elif head in ("DetailPrint", "Sleep"):
            pass
        elif head == "ReadRegStr":
            assert words[2:] == ["HKCU", "${JHT_GAME_UNINSTKEY}", "UninstallString"], words
            self.vars[words[1].lstrip("$")] = r'"C:\game\Uninstall.exe"' if self.game else ""
        elif head in ("${DisableX64FSRedirection}", "${EnableX64FSRedirection}"):
            self.events.append(head)
        elif head in ("nsis_tauri_utils::FindProcessCurrentUser", "nsis_tauri_utils::FindProcess"):
            self.stack.append("0" if self.app_running else "1")
        elif head in ("nsis_tauri_utils::KillProcessCurrentUser", "nsis_tauri_utils::KillProcess"):
            self.app_running = False
            self.events.append("kill")
            self.stack.append("0")
        elif head == "nsis_tauri_utils::StrReplace":
            self.stack.append(self.sub(words[1]))
        elif head == "nsExec::ExecToLog":
            self.execs.append(self.sub(words[1]))
            self.events.append("exec")
            self.stack.append(self.exit_code)
        else:
            raise AssertionError(f"the interpreter does not know: {words}")

    def run_block(self, body: list[str], params: dict[str, str]) -> None:
        # frames: [parent_active, cond_now, taken]
        frames: list[list[bool]] = []
        skip_pre: list[bool] = []

        def active() -> bool:
            return all(f[0] and f[1] for f in frames) and not any(skip_pre)

        for line in body:
            for key, val in params.items():
                line = line.replace("${" + key + "}", val)
            if line.startswith("!if "):
                skip_pre.append(not ('"${INSTALLMODE}" == "currentUser"' in line))
                continue
            if line.startswith("!else"):
                skip_pre[-1] = not skip_pre[-1]
                continue
            if line.startswith("!endif"):
                skip_pre.pop()
                continue
            words = _tokens(line)
            head = words[0]
            if head in ("${If}", "${IfNot}"):
                parent = active()
                cond = self.condition(words[1:]) if parent else False
                frames.append([parent, cond if head == "${If}" else not cond, False])
            elif head in ("${AndIf}", "${AndIfNot}"):
                frame = frames[-1]
                if frame[0] and frame[1]:
                    cond = self.condition(words[1:])
                    frame[1] = cond if head == "${AndIf}" else not cond
            elif head == "${ElseIf}":
                frame = frames[-1]
                frame[2] = frame[2] or frame[1]
                frame[1] = (not frame[2]) and frame[0] and self.condition(words[1:])
            elif head == "${Else}":
                frame = frames[-1]
                frame[2] = frame[2] or frame[1]
                frame[1] = not frame[2]
            elif head == "${EndIf}":
                frames.pop()
            elif not active():
                continue
            elif head == "!insertmacro":
                names, body2 = self.macros[words[1]]
                self.run_block(body2, dict(zip(names, words[2:])))
            else:
                self.statement(words)
        assert not frames, "unbalanced LogicLib blocks"

    def run(self) -> "Hook":
        _params, body = self.macros["NSIS_HOOK_PREUNINSTALL"]
        try:
            self.run_block(body, {})
        except Aborted:
            pass
        return self


SITUATIONS = [
    dict(update=u, silent=s, passive=p, answer_yes=y, game=g, app_running=a, ticked=t)
    for u in (False, True) for s in (False, True) for p in (False, True) for y in (False, True)
    for g in (False, True) for a in (False, True) for t in (False, True)
]


@pytest.mark.parametrize("situation", SITUATIONS, ids=lambda s: ",".join(k for k, v in s.items() if v) or "wizard")
def test_the_hook_in_every_situation(situation):
    hook = Hook(**situation).run()
    interactive = not situation["silent"] and not situation["passive"]
    if situation["update"]:
        # The updater: nothing of the team, no question, no checkbox, no app check.
        assert hook.execs == [] and hook.boxes == [] and hook.checkbox_writes == [] and "kill" not in hook.events
        return
    assert not hook.aborted
    assert len(hook.execs) == 1
    if situation["app_running"]:
        # The app is closed before anything of the team is touched.
        assert hook.events.index("kill") < hook.events.index("exec")
    questions = [box for box in hook.boxes if "MB_YESNO" in box[0]]
    if not interactive:
        assert questions == [] and hook.boxes == []
        assert hook.checkbox_writes == ["0"]
        assert "-Mode Keep " in hook.execs[0]
        return
    assert len(questions) == 1
    flags, text = questions[0]
    assert "MB_DEFBUTTON2" in flags, "No must be the default answer"
    assert (GAME_TEXT_IT in text) == situation["game"]
    assert ("e la cartella dei dati ~/.jht." in text) == (not situation["game"])
    assert "Documenti › Job Hunter Team" in text
    if situation["answer_yes"]:
        assert hook.checkbox_writes == ["0", "1"]
        assert "-Mode Remove " in hook.execs[0]
        assert r"C:\Users\someone\AppData\Local\Temp\Job Hunter Team - disinstallazione.txt" in hook.boxes[-1][1]
    else:
        assert hook.checkbox_writes == ["0"]
        assert "-Mode Keep " in hook.execs[0]
        assert hook.boxes[-1] == questions[0]


def test_the_checkbox_is_never_turned_on_without_a_yes_in_the_wizard():
    for situation in SITUATIONS:
        hook = Hook(**situation).run()
        if "1" in hook.checkbox_writes:
            assert not situation["update"] and not situation["silent"] and not situation["passive"]
            assert situation["answer_yes"]


def test_cancel_on_the_running_app_stops_before_anything():
    hook = Hook(app_running=True, ok_to_close=False, answer_yes=True).run()
    assert hook.aborted
    assert hook.execs == [] and hook.checkbox_writes == [] and "kill" not in hook.events


def test_the_hook_runs_the_shipped_script_with_windows_powershell_64_bit():
    hook = Hook(silent=True).run()
    command = hook.execs[0]
    assert command.startswith(r'"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" ')
    assert "-NoProfile" in command and "-NonInteractive" in command and "-ExecutionPolicy Bypass" in command
    assert r'-File "C:\Users\someone\AppData\Local\Job Hunter Team\jht-uninstall-windows.ps1"' in command
    assert command.endswith("-Language it")
    # 64-bit System32 only with the redirection off around the call
    assert hook.events.index("${DisableX64FSRedirection}") < hook.events.index("exec") < hook.events.index("${EnableX64FSRedirection}")


@pytest.mark.parametrize("language,code", [("LANG_ENGLISH", "en"), ("LANG_GERMAN", "de"), ("LANG_SPANISH", "es"),
                                           ("LANG_FRENCH", "fr"), ("LANG_HUNGARIAN", "hu"), ("LANG_PORTUGUESE", "pt")])
def test_the_script_gets_the_uninstallers_language(language, code):
    hook = Hook(passive=True, language=language).run()
    assert hook.execs[0].endswith(f"-Language {code}")


def test_the_script_is_a_resource_of_the_windows_bundle():
    conf = json.loads(WINDOWS_CONF.read_text(encoding="utf-8"))
    resources = conf["bundle"]["resources"]
    assert resources == {"../../scripts/jht-uninstall-windows.ps1": "jht-uninstall-windows.ps1"}
    assert (WINDOWS_CONF.parent / "../../scripts/jht-uninstall-windows.ps1").resolve() == SCRIPT.resolve()
    assert re.search(r'^!define JHT_UNINSTALL_SCRIPT "jht-uninstall-windows.ps1"$', _hooks_text(), re.M)


def test_the_script_is_saved_for_windows_powershell_51():
    raw = SCRIPT.read_bytes()
    # Without a BOM 5.1 reads a script in the ANSI code page: the accents of the report break.
    assert raw.startswith(b"\xef\xbb\xbf")
    raw.decode("utf-8")


def test_the_scripts_jht_cmd_is_the_one_install_ps1_writes():
    install = INSTALL_PS1.read_text(encoding="utf-8")
    written = install[install.index('$shimContent = @"\n') + len('$shimContent = @"\n') : install.index('\n"@', install.index("$shimContent"))]
    script = SCRIPT.read_text(encoding="utf-8-sig")
    ours = script[script.index("$JhtCmdShim = @'\n") + len("$JhtCmdShim = @'\n") : script.index("\n'@", script.index("$JhtCmdShim"))]
    assert ours.replace("\r\n", "\n") == written.replace("\r\n", "\n")


def test_the_script_never_uses_the_shortcuts_that_break_things():
    script = SCRIPT.read_text(encoding="utf-8-sig")
    code = "\n".join(line for line in script.splitlines() if not line.lstrip().startswith("#"))
    for forbidden in ("Remove-Item", "setx", "SetEnvironmentVariable", "wsl", "Stop-Process", "Kill(", "--shutdown",
                      "--terminate", "--unregister", "$env:USERPROFILE", "$env:LOCALAPPDATA", "$env:APPDATA"):
        assert forbidden.lower() not in code.lower(), forbidden


# ── The script, run ──────────────────────────────────────────────────────

FAKE_PODMAN = r"""#!/bin/sh
echo "$*" >> "$FAKE_LOG"
state=$(cat "$FAKE_STATE" 2>/dev/null)
case "$1 $2" in
  "machine list")
    [ -n "$FAKE_LIST_FAILS" ] && exit 125
    if [ -z "$state" ]; then echo '[]'; exit 0; fi
    name=${state% *}; run=false
    [ "${state#* }" = running ] && run=true
    printf '[{"Name":"%s","Running":%s}]\n' "$name" "$run"
    exit 0;;
  "machine stop")
    [ -n "$FAKE_STOP_SLEEP" ] && sleep "$FAKE_STOP_SLEEP"
    [ -n "$FAKE_STOP_FAILS" ] && exit 125
    echo "$3 stopped" > "$FAKE_STATE"
    exit 0;;
  "machine rm")
    [ -n "$FAKE_RM_FAILS" ] && exit 125
    : > "$FAKE_STATE"
    exit 0;;
esac
exit 0
"""

HARNESS = r"""
. $env:JHT_UNDER_TEST
if ($env:T_STOP_SECONDS) { $JhtMachineStopSeconds = [int]$env:T_STOP_SECONDS }

$global:FakeEnv = @{}
$seed = ConvertFrom-Json $env:T_ENV_JSON
foreach ($property in $seed.psobject.Properties) {
  $global:FakeEnv[$property.Name] = @{ Value = [string]$property.Value.Value; Kind = [string]$property.Value.Kind }
}
$global:FakeSets = 0
$global:FakeBroadcasts = 0
function Get-JhtUserEnvironmentValue {
  param([string]$Name)
  if ($global:FakeEnv.ContainsKey($Name)) { return @{ Value = $global:FakeEnv[$Name].Value; Kind = $global:FakeEnv[$Name].Kind } }
  return $null
}
function Set-JhtUserEnvironmentValue {
  param([string]$Name, [string]$Value, $Kind)
  $global:FakeSets++
  $global:FakeEnv[$Name] = @{ Value = $Value; Kind = [string]$Kind }
}
function Remove-JhtUserEnvironmentValue { param([string]$Name) $global:FakeEnv.Remove($Name) }
function Send-JhtEnvironmentChanged { $global:FakeBroadcasts++ }

$global:FakeTask = ($env:T_TASK -eq '1')
function Get-ScheduledTask {
  param([string]$TaskName)
  if ($global:FakeTask -and $TaskName -ceq 'Job Hunter Team - Start runtime') { return [pscustomobject]@{ TaskName = $TaskName } }
}
function Unregister-ScheduledTask {
  param([string]$TaskName, [switch]$Confirm)
  [IO.File]::AppendAllText($env:FAKE_LOG, "unregister $TaskName`n")
  if ($env:T_TASK_STUCK -ne '1' -and $TaskName -ceq 'Job Hunter Team - Start runtime') { $global:FakeTask = $false }
}

$roots = @{ Profile = $env:R_PROFILE; LocalAppData = $env:R_LOCAL; AppData = $env:R_ROAMING; Temp = $env:R_TEMP }
$code = Invoke-JhtAppUninstall -Mode $env:T_MODE -Language $env:T_LANG -Roots $roots -GameInstalled ($env:T_GAME -eq '1') `
  -Podman $env:T_PODMAN -Update ($env:T_UPDATE -eq '1')
[Console]::Out.WriteLine("EXIT=$code TYPE=$($code.GetType().Name)")
[Console]::Out.WriteLine('ENV=' + (ConvertTo-Json -Compress -Depth 4 -InputObject $global:FakeEnv))
[Console]::Out.WriteLine("SETS=$global:FakeSets BROADCASTS=$global:FakeBroadcasts TASK=$global:FakeTask")
"""

WRAPPER_TEXT = "# the wrapper, as install.ps1 publishes it\n"
HELPER_TEXT = "# the ACL helper\n"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class User:
    """One Windows profile, as install.ps1 and the app leave it."""

    def __init__(self, base: Path, *, runtime=True, engine="podman", machine="jht-podman"):
        self.profile = base / "profile"
        self.local = self.profile / "AppData" / "Local"
        self.roaming = self.profile / "AppData" / "Roaming"
        self.docs = self.profile / "Documents"
        self.temp = self.local / "Temp"
        self.runtime_root = self.local / "Job Hunter Team"
        self.runtime = self.runtime_root / "host-runtime"
        self.bin = self.profile / ".local" / "bin"
        self.jht = self.profile / ".jht"
        self.appdata = [self.roaming / "ai.jobhunterteam.desktop", self.local / "ai.jobhunterteam.desktop"]
        self.mydocs = self.docs / "Job Hunter Team"
        for folder in (self.temp, self.roaming, self.bin, self.jht / "profile", self.mydocs, *self.appdata):
            folder.mkdir(parents=True, exist_ok=True)
        # Tauri installs the app for one user in %LOCALAPPDATA%\\<productName>: the same folder as
        # the runtime's. These are the uninstaller's to remove, after the hook.
        self.runtime_root.mkdir(parents=True, exist_ok=True)
        self.app_files = [self.runtime_root / name for name in ("jht-desktop.exe", "uninstall.exe", "jht-uninstall-windows.ps1")]
        for app_file in self.app_files:
            app_file.write_bytes(b"the app")
        (self.bin / "jht.ps1").write_text(WRAPPER_TEXT, encoding="utf-8")
        (self.bin / "windows-private-acl.ps1").write_text(HELPER_TEXT, encoding="utf-8")
        shim = SCRIPT.read_text(encoding="utf-8-sig")
        shim = shim[shim.index("$JhtCmdShim = @'\n") + len("$JhtCmdShim = @'\n") : shim.index("\n'@", shim.index("$JhtCmdShim"))]
        (self.bin / "jht.cmd").write_bytes((shim.replace("\n", "\r\n") + "\r\n").encode("ascii"))
        if runtime:
            (self.runtime / "bin").mkdir(parents=True)
            (self.runtime / "podman-machine").write_text(machine + "\n", encoding="utf-8")
            (self.runtime / "container-runtime").write_text(engine + "\n", encoding="utf-8")
            (self.runtime / "docker-compose.yml").write_text("services: {}\n", encoding="utf-8")
            (self.runtime / ".runtime-integrity").write_text(
                f"version=1\njht-wrapper.ps1={_sha(self.bin / 'jht.ps1')}\n"
                f"windows-private-acl.ps1={_sha(self.bin / 'windows-private-acl.ps1')}\n", encoding="utf-8")
        (self.jht / "jobs.db").write_bytes(b"jobs")
        (self.jht / "profile" / "candidate.json").write_text("{}", encoding="utf-8")
        for folder in self.appdata:
            (folder / "settings.json").write_text("{}", encoding="utf-8")
        (self.mydocs / "cv.pdf").write_bytes(b"%PDF")

    def env(self) -> dict[str, str]:
        return {"R_PROFILE": str(self.profile), "R_LOCAL": str(self.local), "R_ROAMING": str(self.roaming),
                "R_TEMP": str(self.temp)}

    @property
    def keep_report(self) -> Path:
        return self.runtime_root / "disinstallazione.txt"

    @property
    def remove_report(self) -> Path:
        return self.temp / "Job Hunter Team - disinstallazione.txt"


def _snapshot(root: Path) -> dict[str, str]:
    seen = {}
    for folder, dirs, files in os.walk(root):
        for name in dirs + files:
            path = Path(folder) / name
            rel = path.relative_to(root).as_posix()
            if path.is_symlink():
                seen[rel] = "link"
            elif path.is_file():
                seen[rel] = _sha(path)
            else:
                seen[rel] = "dir"
    return seen


def _link_dir(link: Path, target: Path) -> None:
    if WINDOWS:
        done = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, text=True)
        assert done.returncode == 0, done.stdout + done.stderr
    else:
        os.symlink(target, link, target_is_directory=True)


class Run:
    def __init__(self, done: subprocess.CompletedProcess, log: Path, state: Path):
        self.stdout, self.stderr = done.stdout, done.stderr
        self.calls = [line for line in log.read_text(encoding="utf-8").splitlines() if line] if log.exists() else []
        self.state = state.read_text(encoding="utf-8").strip() if state.exists() else ""
        found = re.search(r"^EXIT=(\S+) TYPE=(\S+)$", done.stdout, re.M)
        assert found, done.stdout + done.stderr
        assert found.group(2) == "Int32", f"Invoke-JhtAppUninstall must return one int: {found.group(2)}\n{done.stdout}"
        self.code = int(found.group(1))
        self.env = json.loads(re.search(r"^ENV=(.*)$", done.stdout, re.M).group(1))
        counters = re.search(r"^SETS=(\d+) BROADCASTS=(\d+) TASK=(\w+)$", done.stdout, re.M)
        self.sets, self.broadcasts, self.task = int(counters.group(1)), int(counters.group(2)), counters.group(3)
        self.items = re.findall(r"^JHT_ITEM (\S+) (\S+)$", done.stdout, re.M)

    def podman_calls(self) -> list[str]:
        return [call for call in self.calls if not call.startswith("unregister ")]


def _run(tmp_path: Path, user: User, *, mode="Keep", language="en", update=False, game=False, machine_state="",
         podman=True, path_value=None, path_kind="ExpandString", variables=True, task=False, extra=None) -> Run:
    work = tmp_path / "run"
    work.mkdir(exist_ok=True)
    fakes = work / "bin"
    fakes.mkdir(exist_ok=True)
    podman_path = install_fake(fakes, "podman.exe", FAKE_PODMAN) if podman else ""
    log, state, engine = work / "calls.log", work / "machine.state", work / "engine.txt"
    log.write_text("", encoding="utf-8")
    state.write_text(machine_state, encoding="utf-8")
    engine.unlink(missing_ok=True)
    if path_value is None:
        path_value = f"%USERPROFILE%\\tools;{user.bin};C:\\Other\\bin"
    seed = {"Path": {"Value": path_value, "Kind": path_kind}}
    if variables:
        seed["JHT_CONTAINER_RUNTIME"] = {"Value": "podman", "Kind": "String"}
        seed["JHT_PODMAN_MACHINE"] = {"Value": "jht-podman", "Kind": "String"}
    harness = work / "case.ps1"
    harness.write_text(ENGINE_CHECK + HARNESS, encoding="utf-8-sig")
    env = {**windows_env(work), "PATH": str(fakes)} if WINDOWS else {"PATH": f"{fakes}:/usr/bin:/bin", "HOME": str(work)}
    env.update(user.env())
    env.update({
        "JHT_ENGINE_FILE": str(engine), "JHT_UNDER_TEST": str(SCRIPT), "FAKE_LOG": str(log), "FAKE_STATE": str(state),
        "T_MODE": mode, "T_LANG": language, "T_GAME": "1" if game else "0", "T_UPDATE": "1" if update else "0",
        "T_PODMAN": str(podman_path), "T_ENV_JSON": json.dumps(seed), "T_TASK": "1" if task else "0", **(extra or {}),
    })
    done = subprocess.run([*powershell_argv(), "-File", str(harness)], capture_output=True, text=True,
                          encoding="utf-8", timeout=180, env=env)
    assert_engine(engine, done.stderr)
    return Run(done, log, state)


@pytest.fixture
def two_users(tmp_path):
    user = User(tmp_path / "a")
    other = User(tmp_path / "b")
    return user, other, _snapshot(other.profile)


@needs_powershell
@pytest.mark.parametrize("mode", ["Keep", "Remove"])
def test_the_update_touches_nothing(tmp_path, two_users, mode):
    user, other, other_before = two_users
    before = _snapshot(user.profile)
    run = _run(tmp_path, user, mode=mode, update=True, machine_state="jht-podman running", task=True)
    assert run.code == 0 and "JHT_SKIPPED update" in run.stdout
    assert run.calls == [] and run.state == "jht-podman running" and run.task == "True"
    assert run.sets == 0 and run.broadcasts == 0
    assert _snapshot(user.profile) == before and _snapshot(other.profile) == other_before


@needs_powershell
def test_keep_stops_only_our_machine_and_says_what_stays(tmp_path, two_users):
    user, other, other_before = two_users
    before = _snapshot(user.profile)
    run = _run(tmp_path, user, mode="Keep", machine_state="jht-podman running", task=True)
    assert run.code == 0, run.stdout + run.stderr
    assert run.podman_calls() == ["machine list --format json", "machine stop jht-podman", "machine list --format json"]
    assert run.state == "jht-podman stopped"
    assert ("machine", "stopped") in run.items
    after = _snapshot(user.profile)
    report_key = user.keep_report.relative_to(user.profile).as_posix()
    assert after.pop(report_key)
    assert after == before, "Keep must not change the data"
    assert run.sets == 0 and run.task == "True"
    assert _snapshot(other.profile) == other_before
    report = user.keep_report.read_text(encoding="utf-8-sig")
    assert str(user.mydocs) in report and str(user.jht) in report and "Podman and Compose stay" in report
    assert "Automatic start of the team (scheduled task): stays" in report
    assert str(other.profile) not in report


@needs_powershell
def test_keep_writes_the_report_in_temp_when_nothing_of_the_runtime_is_there(tmp_path):
    """Only the app in %LOCALAPPDATA%\\Job Hunter Team (its install folder): a report there would
    keep the folder alive after the uninstaller removed the app, and call it a runtime."""
    user = User(tmp_path / "a", runtime=False)
    before = _snapshot(user.runtime_root)
    run = _run(tmp_path, user, mode="Keep", machine_state="")
    assert run.code == 0, run.stdout + run.stderr
    assert _snapshot(user.runtime_root) == before, "the report must not go in the app's folder"
    report = user.remove_report.read_text(encoding="utf-8-sig")
    assert "Job Hunter Team local runtime" not in report


@needs_powershell
def test_keep_names_the_runtime_folder_that_stays(tmp_path):
    user = User(tmp_path / "a")
    run = _run(tmp_path, user, mode="Keep", machine_state="")
    assert run.code == 0, run.stdout + run.stderr
    report = user.keep_report.read_text(encoding="utf-8-sig")
    assert f"Job Hunter Team local runtime: stays ({user.runtime})" in report


@needs_powershell
@pytest.mark.parametrize("engine,machine", [("docker", "jht-podman"), ("podman", "jht-podman-2")])
@pytest.mark.parametrize("mode", ["Keep", "Remove"])
def test_a_machine_this_user_did_not_install_is_never_touched(tmp_path, engine, machine, mode):
    user = User(tmp_path / "a", engine=engine, machine=machine)
    run = _run(tmp_path, user, mode=mode, machine_state="jht-podman running")
    assert run.podman_calls() == ["machine list --format json"]
    assert run.state == "jht-podman running"
    assert ("machine", "not_ours") in run.items
    if mode == "Remove":
        # The runtime that is not ours is what proves it: it stays, and the rest with it.
        assert user.runtime.is_dir() and user.jht.is_dir() and run.code == 24


@needs_powershell
def test_keep_does_not_wait_forever_for_the_stop(tmp_path):
    user = User(tmp_path / "a")
    run = _run(tmp_path, user, mode="Keep", machine_state="jht-podman running",
               extra={"FAKE_STOP_SLEEP": "4", "T_STOP_SECONDS": "1"})
    assert run.code == 24
    assert ("machine", "left") in run.items
    assert not any(call.startswith("machine rm") for call in run.calls)
    assert "NOT stopped" in user.keep_report.read_text(encoding="utf-8-sig")


@needs_powershell
def test_remove_takes_the_closed_list_and_nothing_else(tmp_path, two_users):
    user, other, other_before = two_users
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "keep.txt").write_text("not ours", encoding="utf-8")
    _link_dir(user.jht / "linked", outside)
    run = _run(tmp_path, user, mode="Remove", machine_state="jht-podman stopped", task=True)
    assert run.code == 0, run.stdout + run.stderr
    assert run.podman_calls() == ["machine list --format json", "machine rm --force jht-podman", "machine list --format json"]
    assert run.calls.index("unregister Job Hunter Team - Start runtime") < run.calls.index("machine rm --force jht-podman")
    assert run.task == "False"
    for gone in (user.runtime, user.jht, *user.appdata, user.bin / "jht.ps1", user.bin / "jht.cmd",
                 user.bin / "windows-private-acl.ps1"):
        assert not gone.exists() and not gone.is_symlink(), gone
    # the app's own files are left to the uninstaller, which then removes the empty folder
    assert sorted(p.name for p in user.runtime_root.iterdir()) == sorted(f.name for f in user.app_files)
    # never followed: the junction went as a link, its target stays
    assert (outside / "keep.txt").read_text(encoding="utf-8") == "not ours"
    assert (user.mydocs / "cv.pdf").read_bytes() == b"%PDF"
    assert _snapshot(other.profile) == other_before
    # only our PATH entry, the person's %USERPROFILE% entry raw, the same type, then WM_SETTINGCHANGE
    assert run.env["Path"] == {"Value": "%USERPROFILE%\\tools;C:\\Other\\bin", "Kind": "ExpandString"}
    assert run.sets == 1 and run.broadcasts == 1
    assert "JHT_CONTAINER_RUNTIME" not in run.env and "JHT_PODMAN_MACHINE" not in run.env
    report = user.remove_report.read_text(encoding="utf-8-sig")
    assert f"Your documents (CVs, attachments, output): stays ({user.mydocs})" in report
    assert "NOT removed" not in report


@needs_powershell
@pytest.mark.parametrize("mode", ["Keep", "Remove"])
def test_the_documents_folder_jht_up_made_empty_stays_and_is_named(tmp_path, mode):
    """jht up creates %USERPROFILE%\\Documents\\Job Hunter Team before the first start, even empty (T83):
    it is the person's folder, it stays, and the report says where it is."""
    user = User(tmp_path / "a")
    (user.mydocs / "cv.pdf").unlink()
    run = _run(tmp_path, user, mode=mode, machine_state="jht-podman stopped")
    assert run.code == 0, run.stdout + run.stderr
    assert user.mydocs.is_dir() and not any(user.mydocs.iterdir())
    report = (user.keep_report if mode == "Keep" else user.remove_report).read_text(encoding="utf-8-sig")
    assert f"Your documents (CVs, attachments, output): stays ({user.mydocs})" in report


@needs_powershell
def test_remove_with_the_path_entry_absent_rewrites_nothing(tmp_path):
    user = User(tmp_path / "a")
    run = _run(tmp_path, user, mode="Remove", path_value="%USERPROFILE%\\tools;C:\\Other\\bin")
    assert run.code == 0, run.stdout + run.stderr
    assert run.sets == 0 and run.broadcasts == 0
    assert ("path", "absent") in run.items


@needs_powershell
def test_remove_keeps_a_jht_that_is_not_ours_and_the_shared_path_entry(tmp_path):
    user = User(tmp_path / "a")
    (user.bin / "jht.ps1").write_text("# someone else's jht\n", encoding="utf-8")
    (user.bin / "other-tool.exe").write_bytes(b"MZ")
    run = _run(tmp_path, user, mode="Remove")
    assert run.code == 0, run.stdout + run.stderr
    assert (user.bin / "jht.ps1").read_text(encoding="utf-8") == "# someone else's jht\n"
    assert (user.bin / "other-tool.exe").exists()
    assert not (user.bin / "jht.cmd").exists() and not (user.bin / "windows-private-acl.ps1").exists()
    assert run.sets == 0 and ("path", "kept_for_others") in run.items
    assert str(user.bin) in run.env["Path"]["Value"]


@needs_powershell
def test_remove_with_the_game_keeps_its_data_and_says_why(tmp_path):
    user = User(tmp_path / "a")
    run = _run(tmp_path, user, mode="Remove", language="it", game=True)
    assert run.code == 0, run.stdout + run.stderr
    assert (user.jht / "jobs.db").read_bytes() == b"jobs"
    assert ("jht_home", "kept_for_game") in run.items
    assert not user.runtime.exists()
    assert GAME_TEXT_IT in user.remove_report.read_text(encoding="utf-8-sig")


@needs_powershell
@pytest.mark.parametrize("failure", [{"FAKE_RM_FAILS": "1"}, {"T_TASK_STUCK": "1"}, {"FAKE_LIST_FAILS": "1"}])
def test_remove_keeps_everything_for_a_retry_when_the_machine_or_the_task_stays(tmp_path, failure):
    user = User(tmp_path / "a")
    before = _snapshot(user.profile)
    run = _run(tmp_path, user, mode="Remove", machine_state="jht-podman running", task=True, extra=failure)
    assert run.code == 24
    if "T_TASK_STUCK" in failure:
        assert not any(call.startswith("machine rm") for call in run.calls)
    after = _snapshot(user.profile)
    assert after.pop(user.remove_report.relative_to(user.profile).as_posix())
    assert after == before, "a failed machine or task must leave the runtime that proves ownership, and the data"
    assert run.sets == 0 and "JHT_PODMAN_MACHINE" in run.env
    assert "NOT removed" in user.remove_report.read_text(encoding="utf-8-sig")


@needs_powershell
@pytest.mark.parametrize("broken", ["empty", "drive_root", "missing"])
def test_a_root_that_is_not_a_user_folder_is_refused(tmp_path, broken):
    user = User(tmp_path / "a")
    before = _snapshot(user.profile)
    profile = {"empty": "", "drive_root": "C:\\" if WINDOWS else "/", "missing": str(tmp_path / "nowhere")}[broken]
    run = _run(tmp_path, user, mode="Remove", machine_state="jht-podman running", extra={"R_PROFILE": profile})
    assert run.code == 2
    assert run.calls == [] and run.sets == 0
    assert _snapshot(user.profile) == before


@needs_powershell
def test_the_script_run_by_the_updater_exits_before_reading_anything(tmp_path):
    engine = tmp_path / "engine.txt"
    env = {**windows_env(tmp_path), "PATH": ""} if WINDOWS else {"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)}
    env["JHT_ENGINE_FILE"] = str(engine)
    done = subprocess.run([*powershell_argv(), "-File", str(SCRIPT), "-Mode", "Remove", "-Update"],
                          capture_output=True, text=True, timeout=120, env=env)
    assert done.returncode == 0, done.stdout + done.stderr
    assert done.stdout.strip() == "JHT_SKIPPED update"


@pytest.mark.skipif(not WINDOWS, reason="the real HKCU\\Environment exists only on Windows")
def test_the_real_registry_keeps_the_type_and_the_unexpanded_entries(tmp_path):
    name = "JHT_T72_PATH_PROBE"
    bin_dir = str(tmp_path / ".local" / "bin")
    script = tmp_path / "registry.ps1"
    engine = tmp_path / "engine.txt"
    script.write_text(ENGINE_CHECK + r"""
. $env:JHT_UNDER_TEST
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
try {
  $key.SetValue($env:T_NAME, "%USERPROFILE%\tools;$env:T_BIN;C:\Other\bin", [Microsoft.Win32.RegistryValueKind]::ExpandString)
  $first = Remove-JhtPathEntry -Bin $env:T_BIN -Name $env:T_NAME
  $second = Remove-JhtPathEntry -Bin $env:T_BIN -Name $env:T_NAME
  $raw = $key.GetValue($env:T_NAME, '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  [Console]::Out.WriteLine("RESULT=$first|$second|$($key.GetValueKind($env:T_NAME))|$raw")
} finally {
  $key.DeleteValue($env:T_NAME, $false)
  $key.Dispose()
}
""", encoding="utf-8-sig")
    env = {**os.environ, "JHT_UNDER_TEST": str(SCRIPT), "T_NAME": name, "T_BIN": bin_dir, "JHT_ENGINE_FILE": str(engine)}
    done = subprocess.run([*powershell_argv(), "-File", str(script)], capture_output=True, text=True, timeout=120, env=env)
    assert_engine(engine, done.stderr)
    assert done.returncode == 0, done.stdout + done.stderr
    assert "RESULT=removed|absent|ExpandString|%USERPROFILE%\\tools;C:\\Other\\bin" in done.stdout, done.stdout + done.stderr
