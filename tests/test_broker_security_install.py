"""The broker's security profiles on the host (R3, T2): install.sh and jht up.

install.sh, on Linux, puts the two profiles of scripts/security/ in fixed
root-owned places (seccomp and its compose override always; AppArmor in
/etc/apparmor.d, loaded with apparmor_parser, where the kernel uses it). The
wrapper adds the overrides to jht-broker only when the files are there and
root's, and, with AppArmor, the profile is loaded in enforce mode. Otherwise
the broker starts with the engine's defaults: mail works, the login view
answers secure_browser_unavailable.

Both sides run for real here, with fake programs on PATH (apparmor_parser,
sudo's work, stat, uname) and the fixed paths moved under tmp_path.

Run with: pytest tests/test_broker_security_install.py -v
"""

import os
import re
import shlex
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install.sh"
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"


def _fake(bin_dir: Path, name: str, body: str) -> None:
    path = bin_dir / name
    path.write_text("#!/bin/sh\n" + body)
    path.chmod(0o755)


# ── install.sh ─────────────────────────────────────────────────────────────

@pytest.fixture
def host(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "calls.log"
    _fake(bin_dir, "apparmor_parser", f'echo "apparmor_parser $*" >> {shlex.quote(str(log))}\nexit "${{FAKE_PARSER_EXIT:-0}}"\n')
    enabled = tmp_path / "apparmor-enabled"
    enabled.write_text("Y\n")
    return {"tmp": tmp_path, "bin": bin_dir, "log": log, "enabled": enabled,
            "dir": tmp_path / "etc-jht" / "security", "apparmor": tmp_path / "apparmor.d" / "jht-broker"}


def _install(host, *args, base=None, os_name="linux", parser_exit=0, pins=None):
    (host["tmp"] / "apparmor.d").mkdir(exist_ok=True)
    script = (
        f"JHT_INSTALLER_SOURCE_ONLY=1 . {shlex.quote(str(INSTALLER))} {' '.join(map(shlex.quote, args))}\n"
        f"OS={os_name}\n"
        f"RUNTIME_RELEASE_BASE={shlex.quote(base or ROOT.as_uri())}\n"
        f"BROKER_SECURITY_DIR={shlex.quote(str(host['dir']))}\n"
        f"BROKER_APPARMOR_FILE={shlex.quote(str(host['apparmor']))}\n"
        f"APPARMOR_ENABLED_FILE={shlex.quote(str(host['enabled']))}\n"
        + "".join(f"{name}={value}\n" for name, value in (pins or {}).items()) +
        # sudo's work: the call is logged, then run without the root owner
        # (the test is not root).
        "sudo_maybe() {\n"
        f'  echo "sudo $*" >> {shlex.quote(str(host["log"]))}\n'
        '  if [ "$1" = install ]; then shift; local a=(); while [ $# -gt 0 ]; do\n'
        '    case "$1" in -o|-g) shift 2 ;; /etc/jht) shift ;; *) a+=("$1"); shift ;; esac; done\n'
        '    install "${a[@]}"; else "$@"; fi\n'
        "}\n"
        "install_broker_security_profiles\n"
    )
    env = {**os.environ, "PATH": f"{host['bin']}:{os.environ['PATH']}", "FAKE_PARSER_EXIT": str(parser_exit)}
    return subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True, timeout=30)


def _calls(host):
    return host["log"].read_text() if host["log"].exists() else ""


def test_with_apparmor_both_profiles_are_installed_as_root_and_loaded(host):
    result = _install(host, "--broker-profiles")
    assert result.returncode == 0, result.stderr
    assert (host["dir"] / "jht-broker.seccomp.json").read_bytes() == \
        (ROOT / "scripts" / "security" / "jht-broker.seccomp.json").read_bytes()
    assert host["apparmor"].read_bytes() == (ROOT / "scripts" / "security" / "jht-broker.apparmor.txt").read_bytes()
    calls = _calls(host)
    for name in ("jht-broker.seccomp.json", "compose-seccomp.yml", "compose-apparmor.yml"):
        assert re.search(rf"sudo install -m 0644 -o root -g root \S+ {re.escape(str(host['dir'] / name))}$", calls, re.M), name
    assert f"apparmor_parser -r -W {host['apparmor']}" in calls
    assert "seccomp and AppArmor (jht-broker, loaded)" in result.stdout


def test_the_overrides_name_the_installed_seccomp_file_and_the_profile(host):
    _install(host, "--broker-profiles")
    seccomp = (host["dir"] / "compose-seccomp.yml").read_text()
    assert f"- seccomp={host['dir']}/jht-broker.seccomp.json" in seccomp
    assert "- apparmor=jht-broker" in (host["dir"] / "compose-apparmor.yml").read_text()
    for name in ("compose-seccomp.yml", "compose-apparmor.yml"):
        text = (host["dir"] / name).read_text()
        assert "  jht-broker:\n    security_opt:\n" in text and "jht:" not in text.replace("jht-broker:", "")


def test_without_apparmor_only_seccomp_is_installed(host):
    host["enabled"].write_text("N\n")
    result = _install(host, "--broker-profiles")
    assert result.returncode == 0
    assert (host["dir"] / "jht-broker.seccomp.json").exists()
    assert not host["apparmor"].exists()
    assert "apparmor_parser" not in _calls(host)
    assert "seccomp (no AppArmor on this kernel)" in result.stdout


def test_a_profile_that_does_not_load_leaves_the_install_going(host):
    result = _install(host, "--broker-profiles", parser_exit=1)
    assert result.returncode == 0
    assert "did not load" in result.stdout + result.stderr


def test_without_consent_nothing_is_written(host):
    result = _install(host, "--no-broker-profiles")
    assert result.returncode == 0
    assert not host["dir"].exists() and not host["apparmor"].exists() and _calls(host) == ""
    assert "mail works" in result.stdout + result.stderr


def _sha256(path):
    import hashlib
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _fake_repo(tmp_path):
    repo = tmp_path / "repo" / "scripts" / "security"
    repo.mkdir(parents=True)
    for name in ("jht-broker.seccomp.json", "jht-broker.apparmor.txt"):
        shutil.copy(ROOT / "scripts" / "security" / name, repo / name)
    return repo


def _pinned(name):
    text = INSTALLER.read_text()
    return re.search(rf'^{name}="([0-9a-f]{{64}})"$', text, re.M).group(1)


def test_the_installer_pins_exactly_the_profiles_of_its_commit():
    # A profile changed without its pin would be refused on every host.
    assert _pinned("BROKER_SECCOMP_SHA256") == _sha256(ROOT / "scripts" / "security" / "jht-broker.seccomp.json")
    assert _pinned("BROKER_APPARMOR_SHA256") == _sha256(ROOT / "scripts" / "security" / "jht-broker.apparmor.txt")


@pytest.mark.parametrize("broken", ["seccomp", "apparmor"])
def test_a_file_that_is_not_the_pinned_profile_is_never_installed(host, tmp_path, broken):
    repo = _fake_repo(tmp_path)
    if broken == "seccomp":
        target = repo / "jht-broker.seccomp.json"
        target.write_text(target.read_text().replace('"SCMP_ACT_ERRNO"', '"SCMP_ACT_ALLOW"', 1))
    else:
        target = repo / "jht-broker.apparmor.txt"
        target.write_text(target.read_text().replace("deny mount,", "mount,", 1))
    result = _install(host, "--broker-profiles", base=(tmp_path / "repo").as_uri())
    assert result.returncode == 0
    assert not host["dir"].exists() and _calls(host) == ""
    assert "validation failed" in result.stdout + result.stderr


def test_an_apparmor_file_with_a_second_profile_is_refused_even_when_pinned(host, tmp_path):
    # R1 of the review: apparmor_parser -r would load every profile of the file,
    # as root. The pin is moved to the tampered file, so only the
    # one-profile rule can refuse it.
    repo = _fake_repo(tmp_path)
    target = repo / "jht-broker.apparmor.txt"
    target.write_text(target.read_text() + "\nprofile planted flags=(unconfined) {\n}\n")
    result = _install(host, "--broker-profiles", base=(tmp_path / "repo").as_uri(),
                      pins={"BROKER_APPARMOR_SHA256": _sha256(target)})
    assert result.returncode == 0
    assert not host["dir"].exists() and _calls(host) == ""
    assert "validation failed" in result.stdout + result.stderr


@pytest.mark.parametrize("os_name", ["macos", "wsl"])
def test_outside_native_linux_the_installer_does_nothing(host, os_name):
    result = _install(host, "--broker-profiles", os_name=os_name)
    assert result.returncode == 0 and _calls(host) == "" and not host["dir"].exists()


def test_the_docker_install_runs_the_step_after_the_runtime_download():
    text = INSTALLER.read_text()
    body = re.search(r"^main_docker\(\) \{\n(.*?)^\}", text, re.S | re.M).group(1)
    assert body.index("download_runtime_files") < body.index("install_broker_security_profiles")
    assert 'RUNTIME_RELEASE_BASE="$release_base"' in text


# ── jht up (jht-wrapper.sh) ───────────────────────────────────────────────

def _wrapper_functions(*names: str) -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    out = []
    for name in names:
        match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        assert match, name
        out.append(match.group(0))
    return "\n".join(out)


@pytest.fixture
def box(tmp_path):
    """A Linux host: the security dir, an AppArmor securityfs, a compose."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    owners = tmp_path / "owners"
    owners.write_text("")
    # stat -c '%u %a' PATH: the owner and mode written for PATH in `owners`,
    # else the test user's (not root).
    _fake(bin_dir, "stat", f'for p; do :; done\nline="$(grep -F "$p=" {shlex.quote(str(owners))} | tail -n 1)"\n'
                           'if [ -n "$line" ]; then echo "${line#*=}"; else echo "1000 644"; fi\n')
    _fake(bin_dir, "uname", 'echo "${FAKE_UNAME:-Linux}"\n')
    security = tmp_path / "security"
    security.mkdir()
    for name in ("jht-broker.seccomp.json", "compose-seccomp.yml", "compose-apparmor.yml"):
        (security / name).write_text("x\n")
    fs = tmp_path / "apparmorfs"
    (fs / "policy" / "profiles" / "jht-broker.3").mkdir(parents=True)
    (fs / "policy" / "profiles" / "jht-broker.3" / "name").write_text("jht-broker\n")
    (fs / "policy" / "profiles" / "jht-broker.3" / "mode").write_text("enforce\n")
    enabled = tmp_path / "enabled"
    enabled.write_text("Y\n")
    compose = tmp_path / "docker-compose.yml"
    compose.write_text("services:\n  jht:\n    image: x\n  jht-broker:\n    image: x\n")
    box = {"bin": bin_dir, "owners": owners, "security": security, "fs": fs, "enabled": enabled, "compose": compose}
    _root_owned(box, security, "755")
    for name in ("jht-broker.seccomp.json", "compose-seccomp.yml", "compose-apparmor.yml"):
        _root_owned(box, security / name, "644")
    return box


def _root_owned(box, path, mode, owner="0"):
    with box["owners"].open("a") as owners:
        owners.write(f"{path}={owner} {mode}\n")


def _wrapper(box, call, uname="Linux", runtime="docker"):
    script = "\n".join([
        f"HOST_KERNEL={uname}",
        f"CONTAINER_RUNTIME={runtime}",
        "BROKER_SERVICE=jht-broker",
        f"BROKER_SECURITY_DIR={shlex.quote(str(box['security']))}",
        f"APPARMOR_ENABLED_FILE={shlex.quote(str(box['enabled']))}",
        f"APPARMOR_FS={shlex.quote(str(box['fs']))}",
        "BROKER_APPARMOR_PROFILE=jht-broker",
        f"COMPOSE_FILE={shlex.quote(str(box['compose']))}",
        'info() { printf "%s\\n" "$*"; }',
        _wrapper_functions("runtime_stat", "broker_security_node_safe", "host_apparmor_enabled",
                           "broker_apparmor_loaded", "broker_security_mode", "broker_security_notice"),
        call,
    ])
    env = {**os.environ, "PATH": f"{box['bin']}:{os.environ['PATH']}", "FAKE_UNAME": uname}
    return subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True, timeout=30)


def _mode(box, **kwargs):
    return _wrapper(box, f"broker_security_mode {shlex.quote(str(box['compose']))}", **kwargs).stdout.strip()


def test_with_both_profiles_in_place_and_loaded_jht_up_adds_both(box):
    assert _mode(box) == "apparmor"


def test_a_profile_loaded_in_complain_mode_is_not_loaded(box):
    (box["fs"] / "policy" / "profiles" / "jht-broker.3" / "mode").write_text("complain\n")
    assert _mode(box) == ""


def test_the_root_profile_list_is_read_when_it_can_be(box):
    (box["fs"] / "profiles").write_text("docker-default (enforce)\njht-broker (enforce)\n")
    shutil.rmtree(box["fs"] / "policy")
    assert _mode(box) == "apparmor"
    (box["fs"] / "profiles").write_text("docker-default (enforce)\njht-broker-old (enforce)\n")
    assert _mode(box) == ""


def test_a_profile_list_the_kernel_refuses_to_open_falls_back_to_policy(box):
    # As a user, the list's mode bits say readable but the kernel refuses the
    # open (CI, run 37893287627): grep exits 2. A directory makes grep exit 2
    # here; the policy/ entry must still be read.
    (box["fs"] / "profiles").mkdir()
    assert _mode(box) == "apparmor"
    shutil.rmtree(box["fs"] / "policy")
    assert _mode(box) == ""


def test_under_podman_the_apparmor_override_is_never_added(box):
    # Rootless Podman refuses a container with apparmor= (exit 125, CI with
    # Podman 4.9.3): the broker would not start, and mail would stop.
    assert _mode(box, runtime="podman") == ""
    out = _wrapper(box, "broker_security_notice", runtime="podman").stdout
    assert "Podman senza root" in out and "la posta funziona" in out
    box["enabled"].write_text("N\n")
    assert _mode(box, runtime="podman") == "seccomp"


def test_apparmor_on_but_the_profile_not_loaded_adds_nothing(box):
    shutil.rmtree(box["fs"] / "policy")
    assert _mode(box) == ""


def test_without_apparmor_only_the_seccomp_override_is_added(box):
    box["enabled"].write_text("N\n")
    assert _mode(box) == "seccomp"


@pytest.mark.parametrize("name,owner,mode", [
    ("compose-seccomp.yml", "1000", "644"),       # not root's
    ("jht-broker.seccomp.json", "0", "666"),      # writable by others
    ("compose-apparmor.yml", "0", "664"),         # writable by the group
])
def test_a_profile_file_anyone_but_root_could_change_adds_nothing(box, name, owner, mode):
    _root_owned(box, box["security"] / name, mode, owner=owner)
    assert _mode(box) == ""


def test_a_missing_profile_file_adds_nothing(box):
    (box["security"] / "jht-broker.seccomp.json").unlink()
    assert _mode(box) == ""


def test_a_compose_without_the_broker_or_a_mac_adds_nothing(box):
    assert _mode(box, uname="Darwin") == ""
    box["compose"].write_text("services:\n  jht:\n    image: x\n")
    assert _mode(box) == ""


def test_jht_up_says_what_is_missing_and_that_mail_works(box):
    shutil.rmtree(box["fs"] / "policy")
    out = _wrapper(box, "broker_security_notice").stdout
    assert "la posta funziona" in out and "--broker-profiles" in out
    (box["fs"] / "profiles").write_text("jht-broker (enforce)\n")
    assert _wrapper(box, "broker_security_notice").stdout == ""


def test_every_compose_call_carries_the_overrides_and_every_start_says_the_notice():
    text = WRAPPER.read_text(encoding="utf-8")
    compose_file = re.search(r"^compose_file\(\) \{\n(.*?)^\}", text, re.S | re.M).group(1)
    assert compose_file.index('case "$(broker_security_mode "$file")" in') < compose_file.index("local project")
    assert '-f "$BROKER_SECURITY_DIR/compose-seccomp.yml" -f "$BROKER_SECURITY_DIR/compose-apparmor.yml" "$@"' in compose_file
    starts = re.findall(r"compose up -d\n    container_postcheck_running \|\| exit 1\n    broker_migrate_legacy_once\n(.*)\n", text)
    assert len(starts) == 3 and all(line.strip() == "broker_security_notice" for line in starts)


@pytest.mark.skipif(shutil.which("docker-compose") is None, reason="docker-compose not available")
def test_the_installed_overrides_add_to_the_broker_s_security_options(host, tmp_path):
    _install(host, "--broker-profiles")
    result = subprocess.run(
        ["docker-compose", "-f", str(ROOT / "docker-compose.yml"),
         "-f", str(host["dir"] / "compose-seccomp.yml"), "-f", str(host["dir"] / "compose-apparmor.yml"),
         "--project-directory", str(tmp_path), "config", "--format", "json"],
        capture_output=True, text=True, env={**os.environ, "HOME": str(tmp_path)}, check=False)
    assert result.returncode == 0, result.stderr
    import json
    services = json.loads(result.stdout)["services"]
    assert services["jht-broker"]["security_opt"] == [
        "no-new-privileges:true", f"seccomp={host['dir']}/jht-broker.seccomp.json", "apparmor=jht-broker"]
    assert services["jht"].get("security_opt") == ["no-new-privileges:true"]
