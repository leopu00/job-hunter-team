"""P1 sudo (08/10): the shell of an agent never becomes root.

The image gave `jht` passwordless sudo on apt-get, apt, chown, mkdir and ln:
root, through APT hooks or chown. With Docker rootful on Linux, a root-owned
file in the ~/.jht bind lands on the host. Now:

- the image has no sudo and no /etc/sudoers.d/jht, and its build fails if
  either comes back (the Dockerfile gates);
- every start path of the agents' container runs with no-new-privileges and
  cap_drop ALL (docker-compose.yml, inherited by the dev and Podman
  overrides; the one-shot root containers keep only CAP_CHOWN);
- what used sudo moved: the Windows mount repair runs on the host before
  `up`, system packages live in the image, RULE-T13 says so;
- a live check, here on a small image with the compose's flags and in
  docker.yml on the image just built, proves it from an agent's shell.

Residue until Podman, accepted: nosuid,nodev on the binds cannot be had with
Docker (see docker-compose.yml), so a file made setuid in /jht_home is owned
by uid 1001 and runs as 1001, never as root.

Run with: pytest tests/test_agent_shell_privileges.py -v
"""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = ROOT / "Dockerfile"
ENTRYPOINT = ROOT / ".launcher" / "entrypoint.sh"
REPAIR = ROOT / ".launcher" / "repair-mounts.sh"
JHT_INSTALL = ROOT / "agents" / "_tools" / "jht-install"
PS1 = ROOT / "scripts" / "jht-wrapper.ps1"
CONTAINER_JS = ROOT / "cli" / "src" / "commands" / "container.js"
CHECK = ROOT / "scripts" / "ci" / "agent_shell_privileges.py"
DISPATCH = (
    "if [ -x /app/.launcher/repair-mounts.sh ]; then exec /app/.launcher/repair-mounts.sh; "
    "else echo mount_repair_unsupported; fi"
)


def code_lines(text: str) -> list[str]:
    return [line for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]


# ── The image ────────────────────────────────────────────────────────────


def test_the_image_installs_no_sudo_and_writes_no_sudoers():
    lines = code_lines(DOCKERFILE.read_text(encoding="utf-8"))
    assert not any(re.search(r">\s*/etc/sudoers", line) for line in lines)
    assert not any("NOPASSWD" in line for line in lines)
    # The apt package lists name no sudo package: every `apt-get install`
    # block, up to the cleaning of the apt lists that closes it.
    blocks, inside = [], False
    for line in lines:
        if "apt-get install" in line:
            inside = True
        if inside:
            blocks.append(line)
        if inside and "rm -rf /var/lib/apt/lists" in line:
            inside = False
    assert blocks, "no apt-get install block found: the check would prove nothing"
    assert not re.search(r"(?<![\w-])sudo(?![\w-])", " ".join(blocks))


def test_the_build_fails_if_sudo_comes_back():
    text = DOCKERFILE.read_text(encoding="utf-8")
    # As root, before USER jht: no sudo binary and no sudoers entry.
    assert 'if command -v sudo >/dev/null 2>&1 || [ -e /etc/sudoers.d/jht ]; then' in text
    # As jht, after USER jht: sudo -n true must fail.
    user = text.index("\nUSER jht\n")
    gate = text.index('RUN if sudo -n true 2>/dev/null; then echo "GATE: jht can sudo" >&2; exit 1; fi')
    assert gate > user


# ── Every start path ─────────────────────────────────────────────────────


def _resolved_service(*files: str) -> dict:
    env = {**os.environ, "HOME": "/tmp/jht-compose-home"}
    if "DOCKER_CONFIG" not in os.environ and os.environ.get("HOME"):
        env["DOCKER_CONFIG"] = str(Path(os.environ["HOME"]) / ".docker")
    args = ["docker", "compose"]
    for name in files:
        args += ["-f", str(ROOT / name)]
    result = subprocess.run(args + ["config", "--format", "json"], capture_output=True, text=True, env=env, timeout=60)
    if result.returncode != 0:
        pytest.skip(f"docker compose unavailable: {result.stderr.strip()[:120]}")
    return json.loads(result.stdout)["services"]["jht"]


def test_the_base_compose_declares_both_flags():
    service = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))["services"]["jht"]
    assert service["security_opt"] == ["no-new-privileges:true"]
    assert service["cap_drop"] == ["ALL"]
    assert "user" not in service  # the image's USER jht, never root


@pytest.mark.skipif(shutil.which("docker") is None, reason="docker CLI unavailable")
@pytest.mark.parametrize("override", [None, "docker-compose.podman.yml", "docker-compose.dev.yml"])
def test_every_compose_combination_resolves_with_both_flags(override):
    files = ["docker-compose.yml"] + ([override] if override else [])
    service = _resolved_service(*files)
    assert service["security_opt"] == ["no-new-privileges:true"]
    assert service["cap_drop"] == ["ALL"]


@pytest.mark.parametrize("override", ["docker-compose.podman.yml", "docker-compose.dev.yml"])
def test_no_override_resets_the_flags(override):
    # Repeating them in an override is invalid (duplicate items); resetting
    # them (`!reset`) or setting a user would drop the boundary.
    text = (ROOT / override).read_text(encoding="utf-8")
    for key in ("security_opt", "cap_drop", "cap_add", "privileged", "user:"):
        assert not re.search(rf"^\s+{re.escape(key)}", text, re.M), (override, key)


def test_the_one_shot_root_containers_keep_only_chown():
    ps1 = PS1.read_text(encoding="utf-8")
    run = ps1[ps1.index("& docker run --rm --user '0:0'"):]
    run = run[: run.index("$MountRepairDispatch")]
    for flag in ("--cap-drop ALL", "--cap-add CHOWN", "--network none", "--security-opt no-new-privileges"):
        assert flag in run, flag
    js = CONTAINER_JS.read_text(encoding="utf-8")
    call = js[js.index("'run', '--rm', '--user', 'root'"):]
    call = call[: call.index("--volumes-from")]
    for flag in ("'--cap-drop', 'ALL'", "'--cap-add', 'CHOWN'", "'--network', 'none'", "'--security-opt', 'no-new-privileges'"):
        assert flag in call, flag


def test_the_dev_one_shot_root_container_keeps_only_chown():
    text = (ROOT / "scripts" / "dev-up.sh").read_text(encoding="utf-8")
    run = text[text.index("docker run --rm --user root"):]
    run = run[: run.index("chown -R 1001:1001")]
    for flag in ("--cap-drop ALL", "--cap-add CHOWN", "--network none", "--security-opt no-new-privileges"):
        assert flag in run, flag


def test_the_compose_tells_the_truth_about_nosuid():
    # Docker cannot put nosuid,nodev on a bind: the compose must not claim an
    # override that does it, and must name the residue.
    text = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert "override generato" not in text
    assert "NON sono" in text and "nosuid,nodev" in text
    assert "mounter_linux.go" in text and "setuid dall'uid 1001" in text


def test_the_repair_names_only_callers_that_exist():
    text = REPAIR.read_text(encoding="utf-8")
    assert "setup_service.gd" not in text and "_repair_mount_ownership" not in text
    assert "jht-wrapper.ps1 (Repair-MountOwnership)" in text
    # On Windows the Tauri desktop starts the local runtime only through the
    # installed jht.ps1, whose every `up` repairs first
    # (test_every_up_of_the_windows_wrapper_repairs_first): it never runs
    # compose or docker itself.
    onboarding = (ROOT / "desktop" / "src-tauri" / "src" / "onboarding.rs").read_text(encoding="utf-8")
    install = onboarding[onboarding.index("fn install_local("):]
    assert "#[cfg(windows)]" in install[:500] and "return install_local_windows(app, phase);" in install[:500]
    windows = onboarding[onboarding.index("fn install_local_windows("):]
    windows = windows[: windows.index("\n}\n")]
    assert "installer_invocation(&script, &channel_args)" in windows
    for direct in ("compose", '"up"', "docker run", "chown"):
        assert direct not in windows, direct


# ── What used sudo ───────────────────────────────────────────────────────


def _fake_sudo(tmp_path: Path) -> tuple[Path, Path]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "sudo.log"
    sudo = bin_dir / "sudo"
    sudo.write_text(f'#!/bin/sh\necho "$@" >> {log}\nexit 0\n')
    sudo.chmod(0o755)
    return bin_dir, log


def test_the_entrypoint_never_calls_sudo_and_says_what_is_wrong(tmp_path):
    assert not any("sudo" in line for line in code_lines(ENTRYPOINT.read_text(encoding="utf-8")))
    bin_dir, log = _fake_sudo(tmp_path)
    result = subprocess.run(
        ["bash", str(ENTRYPOINT)],
        env={**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "JHT_ENTRYPOINT_NO_EXEC": "1"},
        capture_output=True, text=True, timeout=30,
    )
    assert result.returncode == 0
    if not os.access("/", os.W_OK):
        # /jht_home cannot be created here: the probe fails and is reported.
        assert "mount_not_writable /jht_home" in result.stderr
    assert not log.exists()


def test_jht_install_refuses_system_packages_without_sudo(tmp_path):
    bin_dir, log = _fake_sudo(tmp_path)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"}
    result = subprocess.run(["bash", str(JHT_INSTALL), "apt", "tesseract-ocr"], env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 3
    assert "no sudo in the container" in result.stderr and "tesseract-ocr" in result.stderr
    playwright = bin_dir / "playwright"
    playwright.write_text(f'#!/bin/sh\necho "playwright $@" >> {tmp_path / "pw.log"}\n')
    playwright.chmod(0o755)
    result = subprocess.run(["bash", str(JHT_INSTALL), "browser"], env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode == 0
    assert (tmp_path / "pw.log").read_text() == "playwright install --only-shell chromium\n"
    assert not log.exists()


@pytest.mark.parametrize("lang", ["", ".it", ".de", ".es", ".fr", ".hu", ".pt"])
def test_rule_t13_no_longer_offers_sudo(lang):
    text = (ROOT / "agents" / "_team" / f"team-rules{lang}.md").read_text(encoding="utf-8")
    assert "sudo apt" not in text
    assert "/etc/sudoers.d" not in text
    assert "(whitelisted)" not in text
    assert "jht-install apt" in text


# ── The Windows mount repair: one contract ──────────────────────────────


def test_the_repair_dispatch_is_the_same_in_the_script_and_the_wrapper():
    assert DISPATCH in REPAIR.read_text(encoding="utf-8")
    assert f"$MountRepairDispatch = '{DISPATCH}'" in PS1.read_text(encoding="utf-8")


def test_every_up_of_the_windows_wrapper_repairs_first():
    lines = PS1.read_text(encoding="utf-8").splitlines()
    ups = [i for i, line in enumerate(lines) if re.search(r"Invoke-Compose 'up'|Invoke-UpgradeCompose \$newCompose 'up'", line)]
    assert len(ups) == 4
    for i in ups:
        window = "\n".join(lines[max(0, i - 4): i])
        assert "Repair-MountOwnership" in window, lines[i]


def test_a_failed_repair_stops_the_start_with_code_sentence_and_action():
    text = PS1.read_text(encoding="utf-8")
    assert 'Write-Err "mount_repair_failed:' in text
    assert "Cosa fare:" in text
    assert text.count("if (-not (Repair-MountOwnership)) { exit 1 }") == 3


def test_windows_wrapper_requires_positive_receipts_for_both_mounts():
    text = PS1.read_text(encoding="utf-8")
    repair = text[text.index("function Repair-MountOwnership") : text.index("function Get-ComposeProjectName")]
    assert "$expected = @('/jht_home', '/jht_user')" in repair
    assert "^mount_(?:ok|repaired) (/jht_home|/jht_user)$" in repair
    assert "$receipts.Count -eq $expected.Count" in repair
    assert "$confirmed.ContainsKey($_)" in repair


def _stubbed_repair(tmp_path: Path, owners: dict[str, str], chown_works: bool):
    """Run repair-mounts.sh on temporary folders with stat, find and chown faked."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    state = tmp_path / "owners.json"
    state.write_text(json.dumps(owners))
    chown_log = tmp_path / "chown.log"
    head = f"#!{sys.executable}\nimport json, sys\nstate = {str(state)!r}\nowners = json.load(open(state))\n"
    stubs = {
        # stat -c %u DIR → the uid recorded for DIR
        "stat": head + "print(owners[sys.argv[-1]])\n",
        # find DIR -xdev ! -uid 1001 -print -quit → DIR when it is not jht's
        "find": head + "print(sys.argv[1] if owners[sys.argv[1]] != '1001' else '', end='')\n",
        # chown -R 1001:1001 DIR → logged; takes effect only when it works
        "chown": head
        + f"open({str(chown_log)!r}, 'a').write(' '.join(sys.argv[1:]) + '\\n')\n"
        + ("owners[sys.argv[-1]] = '1001'\njson.dump(owners, open(state, 'w'))\n" if chown_works else ""),
    }
    for name, body in stubs.items():
        (bin_dir / name).write_text(body)
        (bin_dir / name).chmod(0o755)
    result = subprocess.run(
        ["sh", str(REPAIR)],
        env={**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "JHT_REPAIR_MOUNT_ROOTS": " ".join(owners)},
        capture_output=True, text=True, timeout=30,
    )
    return result, (chown_log.read_text() if chown_log.exists() else "")


def test_repair_leaves_jht_owned_mounts_alone(tmp_path):
    a, b = tmp_path / "home", tmp_path / "user"
    a.mkdir(), b.mkdir()
    result, chowns = _stubbed_repair(tmp_path, {str(a): "1001", str(b): "1001"}, chown_works=True)
    assert result.returncode == 0
    assert result.stdout.split("\n")[:2] == [f"mount_ok {a}", f"mount_ok {b}"]
    assert chowns == ""


def test_repair_chowns_a_root_owned_mount_and_verifies(tmp_path):
    a, b = tmp_path / "home", tmp_path / "user"
    a.mkdir(), b.mkdir()
    result, chowns = _stubbed_repair(tmp_path, {str(a): "0", str(b): "1001"}, chown_works=True)
    assert result.returncode == 0
    assert f"mount_repaired {a}" in result.stdout and f"mount_ok {b}" in result.stdout
    assert chowns == f"-R 1001:1001 {a}\n"


def test_repair_reports_a_chown_that_did_not_take(tmp_path):
    a = tmp_path / "home"
    a.mkdir()
    result, _ = _stubbed_repair(tmp_path, {str(a): "0"}, chown_works=False)
    assert result.returncode == 1
    assert result.stdout.strip() == f"mount_repair_failed {a}"


def test_repair_reports_a_missing_mount(tmp_path):
    result, chowns = _stubbed_repair(tmp_path, {str(tmp_path / "absent"): "0"}, chown_works=True)
    assert result.returncode == 1
    assert "mount_repair_failed" in result.stdout and chowns == ""


# ── Live, from an agent's shell (Linux with a Docker daemon) ─────────────


def _docker_daemon() -> bool:
    if sys.platform != "linux" or shutil.which("docker") is None:
        return False
    return subprocess.run(["docker", "info"], capture_output=True, timeout=30).returncode == 0


LIVE = pytest.mark.skipif(not _docker_daemon(), reason="needs Linux with a Docker daemon (runs in CI)")
PROBE_IMAGE = "busybox:1.36.1"


@pytest.fixture(scope="module")
def probe_image():
    pulled = subprocess.run(["docker", "pull", PROBE_IMAGE], capture_output=True, text=True, timeout=300)
    if pulled.returncode != 0:
        pytest.fail(f"cannot pull {PROBE_IMAGE}: {pulled.stderr[-300:]}")
    return PROBE_IMAGE


@LIVE
def test_with_the_compose_flags_nothing_leads_to_root(probe_image):
    result = subprocess.run(
        [sys.executable, str(CHECK), probe_image, "--user", "1001:1001"],
        capture_output=True, text=True, timeout=300,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "checks done: 0 failed" in result.stdout
    assert "FAIL" not in result.stdout
    # The setuid probe ran (it answers with a uid, so no `setuid-probe`).
    assert "applet not found" not in result.stderr, result.stderr


@LIVE
def test_the_check_catches_a_container_that_can_reach_root(probe_image):
    # Control: root with default capabilities and no flags. The same checks
    # must fail here, or the green above would prove nothing.
    result = subprocess.run(
        [sys.executable, str(CHECK), probe_image, "--unsafe-control"],
        capture_output=True, text=True, timeout=300,
    )
    assert result.returncode == 1
    # Every check that must break as root, by its tag: the messages may change,
    # the set may not. `setuid` proves the probe really ran (an empty answer
    # would be `setuid-probe`); `host-root` is the host's view of the folder.
    assert fail_tags(result.stdout) == {"uid", "capeff", "nnp", "chown", "setuid", "host-root"}, result.stdout


def fail_tags(stdout: str) -> set[str]:
    return set(re.findall(r"^FAIL \[([a-z-]+)\]", stdout, flags=re.MULTILINE))


def test_every_fail_line_of_the_check_carries_a_tag():
    """A FAIL without a tag would be invisible to the assertion above."""
    source = CHECK.read_text(encoding="utf-8")
    # Inside the container every failure goes through fail(), which takes the
    # tag first; on the host every print of a FAIL line opens with a tag.
    assert re.findall(r"^fail\(\) \{.*$", source, flags=re.MULTILINE) == ['fail() { echo "FAIL [$1] $2"; fails=$((fails + 1)); }']
    assert not re.search(r'\bfail "', source)
    emitted = re.findall(r'(?:echo|print\(f?)\s*"FAIL[^"]*', source)
    assert emitted and all(line.split("FAIL ", 1)[1].startswith("[") for line in emitted), emitted
