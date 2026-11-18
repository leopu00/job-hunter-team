"""The tier of the host runtime (core image first, tools after) in the POSIX wrapper and in scripts/jht-tools.sh.

The production functions are cut out of scripts/jht-wrapper.sh and run in bash with a fake `docker`; nothing real is touched.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
TOOLS = ROOT / "scripts" / "jht-tools.sh"

FULL = "ghcr.io/leopu00/jht@sha256:" + "a" * 64
CORE_DIGEST = "sha256:" + "b" * 64
FUNCTIONS = ("runtime_stat", "runtime_sha256", "runtime_manifest_value", "runtime_node_safe", "runtime_image_pin_value", "runtime_tier_trusted",
             "runtime_selected_image", "runtime_write_manifest")

FAKE_DOCKER = """#!/bin/sh
case "$1" in
  info) [ -e "$FAKE/engine-down" ] && exit 1; exit 0 ;;
  image)
    # `image inspect --format '{{.Id}}' REF`: the core image is always here, the full one only once pulled
    if [ "$2" = inspect ] && [ "$3" = --format ]; then
      case "$5" in *@sha256:bbbb*) echo sha256:coreid; exit 0 ;; esac
      [ -e "$FAKE/full-present" ] && { echo sha256:fullid; exit 0; }; exit 1
    fi
    [ -e "$FAKE/full-present" ] && exit 0; exit 1 ;;
  pull) printf '%s\\n' "$*" >> "$FAKE/pulls"; n=0; while [ -e "$FAKE/pull-hold" ] && [ "$n" -lt 300 ]; do sleep 0.1; n=$((n+1)); done; [ -e "$FAKE/pull-fails" ] && exit 1; touch "$FAKE/full-present"; exit 0 ;;
esac
exit 0
"""


def _functions() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    parts = []
    for name in FUNCTIONS:
        match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        assert match, name
        parts.append(match.group(0))
    return "\n".join(parts)


@pytest.fixture()
def box(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir(mode=0o700)
    home = tmp_path / "jht"
    (home / "profile").mkdir(parents=True)
    fake = tmp_path / "fake"
    bin_dir = fake / "bin"
    bin_dir.mkdir(parents=True)
    (bin_dir / "docker").write_text(FAKE_DOCKER, encoding="utf-8")
    (bin_dir / "docker").chmod(0o755)
    wrapper = fake / "jht-wrapper.sh"
    wrapper.write_text('#!/bin/sh\necho "$@" >> "$FAKE/wrapper-calls"\necho "image=${JHT_IMAGE-unset}" >> "$FAKE/wrapper-calls"\n', encoding="utf-8")
    wrapper.chmod(0o755)
    (runtime / "docker-compose.yml").write_text("services: {}\n", encoding="utf-8")

    def run(body: str, *, library: bool = True, core_digest: str = CORE_DIGEST, argv: tuple = (), **env):
        # with argv the shell's command line is «bash -c <script> <argv...>» and the wrapper's path is $0, as in a real `jht <cmd>`:
        # the path then comes on the command line once, after the script, where tools_other_wrapper_running reads the command
        wrapper_path = '"$0"' if argv else f'"{wrapper}"'
        script = (
            f'set -u\nexport PATH="{bin_dir}:/usr/bin:/bin"\nexport FAKE="{fake}"\n'
            f'RUNTIME_DIR="{runtime}"\nRUNTIME_TIER_FILE="{runtime}/runtime-tier"\nRUNTIME_IMAGE_PIN="{runtime}/runtime-image"\n'
            f'RUNTIME_TIER_INTEGRITY="{runtime}/.runtime-tier-integrity"\nRUNTIME_MANIFEST="{runtime}/.runtime-integrity"\nCOMPOSE_FILE="{runtime}/docker-compose.yml"\n'
            f'HOST_SETUP_SCRIPT="{runtime}/host-setup.sh"\nWRAPPER_PATH={wrapper_path}\nRUNTIME_SELECTION_FILE="{runtime}/container-runtime"\n'
            f'HOST_KERNEL="$(uname -s)"\nHOST_UID="$(id -u)"\nCORE_IMAGE_DIGEST="{core_digest}"\nDEFAULT_RUNTIME_IMAGE="{FULL}"\nJHT_HOME_HOST="{home}"\nCONTAINER_RUNTIME=docker\n'
            'err() { echo "error: $*" >&2; }\n' + _functions() + "\n"
            + (f'source "{TOOLS}"\n' if library else "")
            + body
        )
        return subprocess.run(["bash", "-c", script, *argv], capture_output=True, text=True, timeout=60,
                              env={**os.environ, "LC_ALL": "C", **env})

    def tier(attested: bool = True, text: str = "core\n"):
        path = runtime / "runtime-tier"
        path.write_text(text, encoding="utf-8")
        path.chmod(0o600)
        if attested:
            import hashlib
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            (runtime / ".runtime-tier-integrity").write_text(f"runtime-tier={digest}\n", encoding="utf-8")
            (runtime / ".runtime-tier-integrity").chmod(0o600)
        return path

    def notice():
        path = home / "state" / "tools.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None

    def wait_for(state: str):
        for _ in range(100):
            data = notice()
            if data and data["state"] == state:
                return data
            time.sleep(0.1)
        raise AssertionError(f"the notice never reached {state}: {notice()}")

    def wait_for_pull_end():
        for _ in range(100):
            if not (runtime / ".tools-pull.lock").exists():
                return
            time.sleep(0.1)
        raise AssertionError("the pull job never ended")

    return type("Box", (), {"run": run, "tier": tier, "runtime": runtime, "home": home, "fake": fake, "notice": notice,
                            "wait_for": wait_for, "wait_for_pull_end": staticmethod(wait_for_pull_end)})


# ── the wrapper: which image, and whether the tier file can be believed ──────────────────────────────────────────────────────

def test_no_tier_file_is_the_whole_image_of_before(box):
    done = box.run('runtime_tier_trusted && echo trusted; echo "[$(runtime_selected_image)]"', library=False)
    assert done.stdout.split() == ["trusted", "[]"], done.stderr


def test_an_attested_core_tier_selects_the_core_image_by_digest(box):
    box.tier()
    done = box.run('runtime_tier_trusted && echo trusted; runtime_selected_image', library=False)
    assert done.stdout.split() == ["trusted", f"ghcr.io/leopu00/jht@{CORE_DIGEST}"], done.stderr


@pytest.mark.parametrize("what", ["not attested", "other content", "wrapper without a core digest", "next to a test pin", "changed after the attestation"])
def test_a_tier_file_that_cannot_be_believed_is_untrusted(box, what):
    kwargs = {}
    if what == "not attested":
        box.tier(attested=False)
    elif what == "other content":
        box.tier(text="full\n")
    elif what == "wrapper without a core digest":
        box.tier()
        kwargs["core_digest"] = ""
    elif what == "changed after the attestation":
        path = box.tier()
        path.write_text("core\r\n", encoding="utf-8", newline="")  # the same word, other bytes: only the hash can tell
    else:
        box.tier()
        (box.runtime / "runtime-image").write_text(FULL + "\n", encoding="utf-8")
    done = box.run('runtime_node_safe "$RUNTIME_TIER_FILE" file && echo node-ok; runtime_tier_trusted && echo trusted || echo untrusted',
                   library=False, **kwargs)
    assert done.stdout.split() == ["node-ok", "untrusted"], done.stderr  # the file is sound: it is the content that is refused


@pytest.mark.parametrize("what", ["a link", "writable by others"])
def test_an_integrity_file_that_is_not_the_users_own_plain_file_is_not_believed(box, tmp_path, what):
    box.tier()
    integrity = box.runtime / ".runtime-tier-integrity"
    if what == "a link":
        real = tmp_path / "real-integrity"
        real.write_text(integrity.read_text(encoding="utf-8"), encoding="utf-8")
        real.chmod(0o600)
        integrity.unlink()
        integrity.symlink_to(real)
    else:
        integrity.chmod(0o666)
    done = box.run("runtime_tier_trusted && echo trusted || echo untrusted", library=False)
    assert done.stdout.strip() == "untrusted", done.stderr


def test_the_main_manifest_never_carries_the_tier_the_app_compares_its_exact_keys(box):
    box.tier()
    (box.runtime / "host-setup.sh").write_text("x\n", encoding="utf-8")
    wrapper_copy = box.runtime / "jht-wrapper.sh"
    wrapper_copy.write_text("w\n", encoding="utf-8")
    done = box.run(f'WRAPPER_PATH="{wrapper_copy}"; runtime_write_manifest && runtime_tier_trusted && echo trusted', library=False)
    assert done.stdout.strip() == "trusted", done.stderr
    assert "runtime-tier" not in (box.runtime / ".runtime-integrity").read_text(encoding="utf-8")


def test_an_attestation_without_its_tier_file_is_an_interrupted_switch_not_a_failure(box):
    box.tier()
    (box.runtime / "runtime-tier").unlink()
    done = box.run('runtime_tier_trusted && echo trusted; echo "[$(runtime_selected_image)]"', library=False)
    assert done.stdout.split() == ["trusted", "[]"], done.stderr


# ── the library: status, pull, switch ─────────────────────────────────────────────────────────────────────────────────────────

def status(box, **env):
    done = box.run("tools_main status --json", **env)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


def test_status_without_a_tier_is_none_and_full(box):
    assert status(box) == {"ok": True, "state": "none", "tier": "full", "reason": ""}


def test_status_is_pending_then_ready_from_the_engine(box):
    box.tier()
    assert status(box) == {"ok": True, "state": "pending", "tier": "core", "reason": ""}
    (box.fake / "full-present").write_text("", encoding="utf-8")
    assert status(box)["state"] == "ready"


def test_status_is_an_error_when_the_engine_does_not_answer_and_one_line(box):
    box.tier()
    (box.fake / "engine-down").write_text("", encoding="utf-8")
    done = box.run("tools_main status --json")
    assert json.loads(done.stdout) == {"ok": False, "error": "engine_unreachable"}
    assert done.stdout.count("\n") == 1


def test_pull_prints_the_phase_once_and_ends_ready_with_the_notice(box):
    box.tier()
    # the fake pull waits for the test to let it go: "pulling" is there to be seen by construction, not because a child is slower
    (box.fake / "pull-hold").write_text("", encoding="utf-8")
    done = box.run("tools_main pull")
    assert done.returncode == 0 and done.stdout == "JHT_PHASE tools_pull\n", done.stderr
    assert box.notice()["state"] == "pulling" and box.notice()["tier"] == "core" and box.notice()["since"]
    # a second call while it pulls: nothing printed, no second pull
    again = box.run("tools_main pull")
    assert again.returncode == 0 and again.stdout == "", again.stderr
    assert status(box)["state"] == "pulling"
    (box.fake / "pull-hold").unlink()
    ready = box.wait_for("ready")
    assert ready["schema"] == 1 and ready["reason"] == ""
    assert (box.fake / "pulls").read_text(encoding="utf-8").splitlines() == [f"pull {FULL}"]
    assert status(box)["state"] == "ready"
    # already here: no phase, no pull
    third = box.run("tools_main pull")
    assert third.stdout == "" and len((box.fake / "pulls").read_text(encoding="utf-8").splitlines()) == 1


def test_a_failed_pull_is_failed_with_its_code_and_a_new_pull_can_start(box):
    box.tier()
    (box.fake / "pull-fails").write_text("", encoding="utf-8")
    assert box.run("tools_main pull").stdout == "JHT_PHASE tools_pull\n"
    assert box.wait_for("failed")["reason"] == "pull_failed"
    assert status(box) == {"ok": True, "state": "failed", "tier": "core", "reason": "pull_failed"}
    (box.fake / "pull-fails").unlink()
    assert box.run("tools_main pull").stdout == "JHT_PHASE tools_pull\n"
    box.wait_for("ready")


def test_pull_does_nothing_on_an_install_without_a_tier(box):
    done = box.run("tools_main pull")
    assert done.returncode == 0 and done.stdout == "" and not (box.fake / "pulls").exists()


def test_switch_is_silent_and_does_nothing_until_the_profile_is_ready_and_the_full_image_is_here(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    assert box.run("tools_main switch").stdout == ""
    assert tier.exists() and not (box.fake / "wrapper-calls").exists()
    (box.home / "profile" / "ready.flag").write_text("2026-11-10T09:00:00Z\n", encoding="utf-8")
    (box.fake / "full-present").unlink()
    assert box.run("tools_main switch").stdout == "" and tier.exists()


def test_switch_drops_the_tier_and_its_integrity_and_ups_the_full_image(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-10T09:00:00Z\n", encoding="utf-8")
    done = box.run("JHT_IMAGE=stale; export JHT_IMAGE; tools_main switch")
    assert done.returncode == 0 and done.stdout == "JHT_PHASE tools_ready\n", done.stderr
    assert not tier.exists() and not (box.runtime / ".runtime-tier-integrity").exists()
    assert (box.fake / "wrapper-calls").read_text(encoding="utf-8").splitlines() == ["up", "image=unset"]
    assert box.notice()["tier"] == "full" and box.notice()["state"] == "ready"
    # and the second call finds nothing to do
    assert box.run("tools_main switch").stdout == ""


def test_switch_does_not_follow_a_ready_flag_that_is_a_link(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").symlink_to(box.home)
    assert box.run("tools_main switch").stdout == "" and tier.exists()


def test_an_unknown_subcommand_is_a_usage_error(box):
    done = box.run("tools_main unknown")
    assert done.returncode == 2 and "uso:" in done.stderr


# ── the wiring: `jht tools` is a host helper like `jht integration` ──────────────────────────────────────────────────────────

def test_jht_tools_is_a_host_helper_loaded_after_its_digest_and_with_a_local_help():
    wrapper = WRAPPER.read_text(encoding="utf-8")
    assert re.search(r'^RUNTIME_HELPERS="[^"]*\bjht-tools\.sh\b[^"]*"', wrapper, re.M)
    # a helper that is not declared yet is answered «not installed yet» before anything is loaded; one that is declared is loaded as it was
    assert re.search(r'^  tools\)\n    require_compose_file\n(    if \[ -z "\$\(runtime_helper_digest jht-tools\.sh\)" \]; then runtime_helper_absent_answer tools "\$\{@:2\}" && exit 0; fi\n)?    runtime_helper_load jht-tools\.sh "\$\{2:-\}" \|\| exit 1\n    tools_main "\$\{@:2\}"\n    exit \$\?\n', wrapper, re.M)
    assert re.search(r"\|integration\|screen\|linkedin\|tools\|", wrapper), "its --help is the local one: no engine started by it"
    assert TOOLS.read_text(encoding="utf-8").count("\n# JHT_RUNTIME_HELPER=1\n") == 1, "the marker the installer's download checks, on a line of its own"
    # only `add` and `remove` of the integrations fetch a helper that is missing: no command of `jht tools` ever downloads (A3)
    assert "add|remove) runtime_helpers_install" in wrapper and "add|remove|pull)" not in wrapper
    installer = (ROOT / "scripts" / "install.sh").read_text(encoding="utf-8")
    assert re.search(r'^RUNTIME_HELPERS="[^"]*\bjht-tools\.sh\b[^"]*"', installer, re.M)


# ── the notice for the container is written only into a real folder and over a plain file ────────────────────────────────────

def test_a_link_in_place_of_the_state_folder_sends_the_notice_nowhere(box, tmp_path):
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (box.home / "state").symlink_to(elsewhere)
    box.tier()
    done = box.run("tools_main pull")
    assert done.returncode == 0 and done.stdout == "JHT_PHASE tools_pull\n", done.stderr
    box.wait_for_pull_end()
    assert list(elsewhere.iterdir()) == [], "nothing written through the link"
    assert (box.home / "state").is_symlink()


def test_a_dangling_link_in_place_of_the_state_folder_is_not_made_a_folder(box, tmp_path):
    (box.home / "state").symlink_to(tmp_path / "does-not-exist")
    box.run('tools_notice ready core "" ""')
    assert not (tmp_path / "does-not-exist").exists() and (box.home / "state").is_symlink()


def test_a_link_in_place_of_tools_json_is_not_written_through_and_not_replaced(box, tmp_path):
    victim = tmp_path / "victim.txt"
    victim.write_text("keep me\n", encoding="utf-8")
    (box.home / "state").mkdir()
    (box.home / "state" / "tools.json").symlink_to(victim)
    box.run('tools_notice ready core "" ""')
    assert victim.read_text(encoding="utf-8") == "keep me\n"
    assert (box.home / "state" / "tools.json").is_symlink()
    assert [p.name for p in (box.home / "state").iterdir()] == ["tools.json"], "no temp file is left"


def test_a_folder_in_place_of_tools_json_is_left_alone(box):
    (box.home / "state" / "tools.json").mkdir(parents=True)
    box.run('tools_notice ready core "" ""')
    assert (box.home / "state" / "tools.json").is_dir() and list((box.home / "state" / "tools.json").iterdir()) == []


def test_a_real_state_folder_and_a_plain_old_tools_json_are_written_as_before(box):
    (box.home / "state").mkdir()
    (box.home / "state" / "tools.json").write_text("{}\n", encoding="utf-8")
    box.run('tools_notice ready core "" "2026-11-10T00:00:00Z"')
    assert json.loads((box.home / "state" / "tools.json").read_text(encoding="utf-8"))["state"] == "ready"


# ── tools_kick: the CLI keeps the tools moving, as the desktop app's round did ───────────────────────────────────────────────

KICK_ENV = {"JHT_TOOLS_WAIT_STEP": "1", "JHT_TOOLS_SWITCH_GRACE": "0", "JHT_TOOLS_WAIT_MAX": "60", "JHT_TOOLS_QUIET_MAX": "600", "JHT_TOOLS_ONBOARDING_MAX": "0"}   # a switch that waited for nothing would miss every deadline below


def _wait_until(check, what):
    for _ in range(150):
        if check():
            return
        time.sleep(0.1)
    raise AssertionError(what)


def _calls(box):
    path = box.fake / "wrapper-calls"
    return [line for line in path.read_text(encoding="utf-8").splitlines() if not line.startswith("image=")] if path.exists() else []


def test_kick_on_a_core_install_pulls_once_then_switches_when_the_profile_is_ready(box):
    tier = box.tier()
    (box.fake / "pull-hold").write_text("", encoding="utf-8")
    done = box.run("tools_kick", **KICK_ENV)
    assert done.returncode == 0 and done.stdout == "", done.stderr   # the wrapper says it in the person's words, not the library
    assert box.run("tools_person_state", **KICK_ENV).stdout == "arriving\n"
    again = box.run("tools_kick", **KICK_ENV)                        # a second `jht up` while it pulls: no second job, no second pull
    assert again.returncode == 0 and again.stdout == ""
    (box.fake / "pull-hold").unlink()
    box.wait_for("ready")
    assert box.run("tools_person_state", **KICK_ENV).stdout == "waiting\n"
    assert tier.exists() and _calls(box) == []                        # no switch before the onboarding has closed
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    _wait_until(lambda: not tier.exists() and _calls(box) == ["down", "up"], f"the job never made the switch: {_calls(box)}")
    box.wait_for_pull_end()
    assert (box.fake / "pulls").read_text(encoding="utf-8").splitlines() == [f"pull {FULL}"]
    assert box.notice()["tier"] == "full" and box.notice()["state"] == "ready"
    assert box.run("tools_person_state", **KICK_ENV).stdout == ""


def test_kick_with_the_full_image_already_here_only_waits_and_switches(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    assert box.run("tools_kick", **KICK_ENV).returncode == 0
    _wait_until(lambda: not tier.exists() and _calls(box) == ["down", "up"], f"no switch: {_calls(box)}")
    assert not (box.fake / "pulls").exists()


def test_the_switch_stops_the_core_team_before_the_tier_goes_and_starts_it_on_the_full_image(box):
    # the order matters: `down` while the tier file still makes the running container the attested core one, then the tier, then
    # `up` (on a Mac, a `jht up` of the person in between refused the core container as not ours, giro 19)
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    (box.fake / "jht-wrapper.sh").write_text(
        '#!/bin/sh\nif [ -e "$TIER" ]; then t=core; else t=full; fi\necho "$1 $t" >> "$FAKE/wrapper-calls"\nexit 0\n', encoding="utf-8")
    assert box.run("tools_kick", TIER=str(tier), **KICK_ENV).returncode == 0
    path = box.fake / "wrapper-calls"
    _wait_until(lambda: path.exists() and path.read_text(encoding="utf-8").splitlines() == ["down core", "up full"],
                f"not down on core, then up on full: {path.read_text(encoding='utf-8') if path.exists() else ''}")
    box.wait_for_pull_end()
    assert box.notice()["state"] == "ready" and box.notice()["tier"] == "full"


def test_a_team_the_person_stopped_stays_stopped_only_the_tier_goes(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    assert box.run("team_stopped_by_person() { return 0; }; tools_kick", **KICK_ENV).returncode == 0
    _wait_until(lambda: not tier.exists(), "the tier never went")
    box.wait_for_pull_end()
    assert _calls(box) == [] and box.notice()["tier"] == "full"


def test_the_switch_waits_for_another_jht_command_to_end(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    wrapper = box.fake / "jht-wrapper.sh"
    # a `jht setup` of the person, still running: a process with the wrapper and the command on its command line
    other = subprocess.Popen(["sh", "-c", "sleep 4; :", str(wrapper), "setup"])   # «; :» keeps the shell (and its arguments) alive
    try:
        assert box.run("tools_kick", **KICK_ENV).returncode == 0
        time.sleep(2)
        assert tier.exists() and _calls(box) == [], "the switch did not wait"
    finally:
        other.wait(timeout=10)
    _wait_until(lambda: not tier.exists() and _calls(box) == ["down", "up"], f"no switch after the other command: {_calls(box)}")


def test_the_chat_of_the_onboarding_does_not_hold_the_switch(box):
    """Giro Linux: `jht team chat assistente`, the REPL of the onboarding the person keeps open, held the switch for its whole half
    hour, and no Scout or Analyst came for 30 minutes after the onboarding. It reads and talks: the switch does not wait for it."""
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    wrapper = box.fake / "jht-wrapper.sh"
    chat = subprocess.Popen(["sh", "-c", "sleep 20; :", str(wrapper), "team", "chat", "assistente"])
    try:
        assert box.run("tools_kick", **KICK_ENV).returncode == 0
        _wait_until(lambda: not tier.exists() and _calls(box) == ["down", "up"], f"the chat held the switch: {_calls(box)}")
    finally:
        chat.kill()
        chat.wait(timeout=10)


@pytest.mark.parametrize("words,holds", [
    (["setup"], True), (["up"], True), (["down"], True), (["restart"], True), (["upgrade"], True), (["uninstall"], True),
    (["reset"], True), (["start-container"], True), (["stop-container"], True), (["recreate"], True),
    (["migrate-runtime", "podman"], True), (["podman-machine-recreate"], True),
    (["config", "set", "x"], True), (["providers", "use", "glm"], True), (["providers", "harness", "pi"], True),
    (["integration", "add", "telegram"], True), (["integration", "remove", "telegram"], True),
    (["tools", "pull"], True), (["tools", "switch"], True),
    (["team", "chat", "assistente"], False), (["logs"], False), (["agents"], False), (["status"], False), (["doctor"], False),
    (["help"], False), (["--help"], False), ([], False), (["config", "get", "x"], False), (["providers", "list"], False),
    (["providers", "plan"], False), (["integration", "status"], False), (["integration", "list"], False),
    (["tools", "status", "--json"], False), (["tools", "pull-job"], False), (["team", "start"], False), (["SETUP"], False),
])
def test_only_a_command_that_changes_the_runtime_holds_the_switch(tmp_path, words, holds):
    # a long path, as on a runner: ps cuts a command line at the width of a terminal unless told not to (-ww)
    deep = tmp_path / ("a-long-folder-name-" * 6)
    deep.mkdir()
    wrapper = deep / "jht-wrapper.sh"
    wrapper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    body = (f'RUNTIME_DIR="{tmp_path}"; JHT_HOME_HOST="{tmp_path}"; WRAPPER_PATH="{wrapper}"\n'
            f'source "{TOOLS}"\nif tools_other_wrapper_running; then echo OTHER; else echo NONE; fi\n')
    other = subprocess.Popen(["sh", "-c", "sleep 6; :", str(wrapper), *words])
    try:
        time.sleep(0.5)
        seen = subprocess.run(["bash", "-c", body], capture_output=True, text=True, timeout=30)
        assert seen.stdout.strip() == ("OTHER" if holds else "NONE"), (words, seen.stdout + seen.stderr)
    finally:
        other.kill()
        other.wait(timeout=10)


def test_the_switch_says_it_is_under_way_while_it_stops_and_starts_the_team(box):
    """The REPL of `jht team chat` runs in the container: the down of the switch ends it. While the job stops the core team and
    starts the full one, .tools-switching holds its pid, for the wrapper to say why the chat ended; after, it is gone."""
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    (box.fake / "jht-wrapper.sh").write_text(
        '#!/bin/sh\npid="$(cat "$RUNTIME/.tools-switching" 2>/dev/null)"\n'
        'if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then s=switching; else s=quiet; fi\n'
        'echo "$1 $s" >> "$FAKE/wrapper-calls"\nexit 0\n', encoding="utf-8")
    assert box.run("tools_kick", RUNTIME=str(box.runtime), **KICK_ENV).returncode == 0
    path = box.fake / "wrapper-calls"
    _wait_until(lambda: path.exists() and path.read_text(encoding="utf-8").splitlines() == ["down switching", "up switching"],
                f"the switch did not say it was under way: {path.read_text(encoding='utf-8') if path.exists() else ''}")
    box.wait_for_pull_end()
    assert not tier.exists() and not (box.runtime / ".tools-switching").exists()


def _chat_end_function() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    match = re.search(r"^team_chat_ended_by_switch\(\) \{\n.*?^\}\n", text, re.S | re.M)
    assert match, "team_chat_ended_by_switch"
    return match.group(0)


def test_the_chat_says_why_it_ended_only_while_a_switch_runs(tmp_path):
    marker = tmp_path / ".tools-switching"
    body = f'set -euo pipefail\nRUNTIME_DIR="{tmp_path}"\n{_chat_end_function()}\nif team_chat_ended_by_switch; then echo SWITCH; else echo NO; fi\n'

    def said():
        return subprocess.run(["bash", "-c", body], capture_output=True, text=True, timeout=30).stdout.strip()

    assert said() == "NO"                                                   # no switch
    job = subprocess.Popen(["sleep", "20"])
    try:
        marker.write_text(f"{job.pid}\n", encoding="utf-8")
        assert said() == "SWITCH"                                           # the job of the switch is running
        marker.write_text("not a pid\n", encoding="utf-8")
        assert said() == "NO"
        marker.unlink()
        marker.symlink_to(tmp_path / "elsewhere")
        (tmp_path / "elsewhere").write_text(f"{job.pid}\n", encoding="utf-8")
        assert said() == "NO"                                               # a link is not believed
    finally:
        job.kill()
        job.wait(timeout=10)
    marker.unlink()
    marker.write_text(f"{job.pid}\n", encoding="utf-8")
    assert said() == "NO"                                                   # an old file of a job that is gone


def test_a_command_that_starts_the_team_waits_for_the_switch_to_end(tmp_path):
    """The chat closed by the switch, the person opens it again at once: ensure_up must not start a second `compose up` next to the
    job's (two creates at once lose the keep-id map on Podman <= 6.0.2; an up before the tier goes starts the core image)."""
    text = WRAPPER.read_text(encoding="utf-8")
    ensure = text[text.index("\nensure_up() {\n"):]
    assert ensure.split("\n")[3].strip() == "wait_for_tools_switch", "first, before container_up and compose_up_team"
    wait = re.search(r"^wait_for_tools_switch\(\) \{\n.*?^\}\n", text, re.S | re.M).group(0)
    marker = tmp_path / ".tools-switching"
    import sys as _sys
    _sys.path.insert(0, str(ROOT / "tests"))
    from wrapper_texts import say_functions
    body = ("set -euo pipefail\n" + say_functions("en") + 'info() { printf "%s\\n" "$*" >&2; }\n'
            f'RUNTIME_DIR="{tmp_path}"\n{_chat_end_function()}{wait}\nwait_for_tools_switch\necho STARTS-NOW\n')
    assert subprocess.run(["bash", "-c", body], capture_output=True, text=True, timeout=30).stderr == ""   # no switch: no wait
    job = subprocess.Popen(["sleep", "30"])
    try:
        marker.write_text(f"{job.pid}\n", encoding="utf-8")
        started = time.time()
        waiting = subprocess.Popen(["bash", "-c", body], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        time.sleep(3)
        assert waiting.poll() is None, "it did not wait for the switch"
        marker.unlink()                                                     # the job ends its switch
        out, err = waiting.communicate(timeout=30)
        assert out.strip() == "STARTS-NOW" and time.time() - started >= 3
        assert "waiting for it to start again" in err
        marker.write_text(f"{job.pid}\n", encoding="utf-8")                 # a switch that never ends: the tetto
        capped = subprocess.run(["bash", "-c", body], capture_output=True, text=True, timeout=30,
                                env={**os.environ, "JHT_TOOLS_SWITCH_WAIT_MAX": "2"})
        assert capped.stdout.strip() == "STARTS-NOW"
    finally:
        job.kill()
        job.wait(timeout=10)


def test_jht_team_chat_comes_back_by_itself_when_the_switch_ended_it():
    text = WRAPPER.read_text(encoding="utf-8")
    arm = text[text.index("\n  team)\n"):]
    arm = arm[:arm.index("\n    ;;\n")]
    assert '"$NODE_ENTRY" "$@" || team_rc=$?' in arm                       # set -e does not end the wrapper on the REPL's exit
    # a chat that resumes after a switch never starts the container: no ensure_up for it
    assert re.search(r'if \[ "\$\{2:-\}" = chat \] && \[ -n "\$\{JHT_TEAM_CHAT_RESUME:-\}" \]; then team_chat_resume "\$@"\n', arm)
    assert re.search(r'if \[ "\$\{2:-\}" = chat \] && team_chat_ended_by_switch; then\n(?:\s+\[ -z "\$team_err" \] \|\| rm -f "\$team_err"\n)'
                     r'\s+team_chat_through_switch "\$@"\n\s+exit \$\?\n', arm)
    assert arm.rstrip().endswith('exit "$team_rc"')                       # any other end: the REPL's own code, as before
    import sys as _sys
    _sys.path.insert(0, str(ROOT / "tests"))
    from wrapper_texts import catalog
    for lang in ("en", "it", "hu", "es", "de", "fr", "pt"):
        texts = catalog(lang)
        assert "jht team chat" in texts["wrapper.tools.chat_switched"], lang
        for key in ("wrapper.tools.chat_reconnecting", "wrapper.tools.chat_resumed", "wrapper.tools.switch_wait"):
            assert texts[key] and "%" not in texts[key], (lang, key)


def _chat_functions(tmp_path, docker_body: str, env_lines: str, call: str, **env):
    """The chat functions of the wrapper with a fake docker, a stand-in wrapper and ensure_up/container_up that leave a trace."""
    import sys as _sys
    _sys.path.insert(0, str(ROOT / "tests"))
    from wrapper_texts import say_functions
    text = WRAPPER.read_text(encoding="utf-8")
    parts = [re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M).group(0)
             for name in ("team_chat_ended_by_switch", "wait_for_tools_switch", "team_chat_agent_back", "team_chat_through_switch",
                          "team_chat_engine_gone", "team_chat_through_update", "team_chat_container_back", "team_chat_resume")]
    fake = tmp_path / "bin"
    fake.mkdir(exist_ok=True)
    (fake / "docker").write_text("#!/bin/sh\n" + docker_body, encoding="utf-8")
    (fake / "docker").chmod(0o755)
    wrapper = tmp_path / "again.sh"
    wrapper.write_text(f'echo "again $* resume=$JHT_TEAM_CHAT_RESUME" >> "{tmp_path}/calls"\n', encoding="utf-8")
    body = ("set -euo pipefail\n" + say_functions("en") + 'info() { printf "%s\\n" "$*" >&2; }\n'
            f'export PATH="{fake}:$PATH"\nRUNTIME_DIR="{tmp_path}"\nWRAPPER_PATH="{wrapper}"\nATTESTED_CONTAINER_ID=jht\n'
            f'ensure_up() {{ echo ENSURE_UP >> "{tmp_path}/calls"; }}\n' + env_lines + "".join(parts) + call)
    return subprocess.run(["bash", "-c", body], capture_output=True, text=True, timeout=60, env={**os.environ, **env})


def _team_arm_chat(tmp_path, switching: bool, exec_flags: str = "-it", engine_line: str | None = None, code: int = 125,
                   engine_up: bool = True, **env):
    """The wrapper's own `team)` arm on `jht team chat assistente`, with a docker whose REPL ends as the switch ends it: Podman's line
    on the client's stderr and code 125."""
    text = WRAPPER.read_text(encoding="utf-8")
    start = text.index("\n  team)\n") + 1
    arm = text[start:text.index("\n    ;;\n", start) + len("\n    ;;\n")]
    if switching:
        (tmp_path / ".tools-switching").write_text(f"{os.getpid()}\n", encoding="utf-8")
    line = engine_line or 'Error: no container with name or ID "jht" found: no such container'
    docker = (f'[ "$1" = exec ] || exit 0\ncase "$*" in *tmux*) exit 0;; esac\necho "$*" >> "{tmp_path}/exec-args"\n'
              f'echo REPL-LINE\necho \'{line}\' >&2\nexit {code}\n')
    lines = (f'EXEC_FLAGS="{exec_flags}"\nJHT_HOST_TYPE=linux\nNODE_ENTRY=/app/cli.js\n'
             "require_compose_file() { :; }\nrequire_docker() { :; }\nensure_up_for_stop() { :; }\n"
             "docker_reachable() { return " + ("0" if engine_up else "1") + "; }\ncontainer_up() { return " + ("0" if engine_up else "3") + "; }\n")
    return _chat_functions(tmp_path, docker, lines, 'set -- team chat assistente\ncase "$1" in\n' + arm + "esac\n",
                           TMPDIR=str(tmp_path), JHT_TOOLS_SWITCH_WAIT_MAX="0", **env)   # the switch's pid is this test's: no wait


def test_a_chat_the_switch_ended_does_not_show_the_engine_line(tmp_path):
    """Giro Windows of the build6, the same in this wrapper: the switch removed the container under `jht team chat`, and Podman's
    own line «Error: no container with name or ID "jht" found» reached the person next to the line that says why the chat stops."""
    done = _team_arm_chat(tmp_path, switching=True)
    assert done.returncode == 0, done.stderr
    assert "REPL-LINE" in done.stdout
    assert "no container" not in done.stderr and "so the chat stops for a moment" in done.stderr
    assert (tmp_path / "calls").read_text(encoding="utf-8").splitlines()[-1] == "again team chat assistente resume=1"
    assert not list(tmp_path.glob("jht-chat-err.*"))                        # the file of the client's lines is taken away


@pytest.mark.parametrize("exec_flags", ["-it", "-i"])
def test_a_chat_that_ends_otherwise_still_shows_the_engine_line_and_its_code(tmp_path, exec_flags):
    done = _team_arm_chat(tmp_path, switching=False, exec_flags=exec_flags)
    assert done.returncode == 125
    assert 'Error: no container with name or ID "jht" found' in done.stderr and "stops for a moment" not in done.stderr
    assert not list(tmp_path.glob("jht-chat-err.*"))


def test_a_chat_the_switch_ended_starts_a_fresh_wrapper_and_starts_nothing_itself(tmp_path):
    """Giro Linux: the wrapper that opened the chat read the core container; after the switch it refused the full one («cannot be
    confirmed as ours; automatic start refused»). It now waits for the switch and starts a fresh wrapper, told it resumes."""
    done = _chat_functions(tmp_path, f'echo "docker $*" >> "{tmp_path}/calls"\nexit 0\n', "",
                           "team_chat_through_switch team chat assistente\n")
    assert done.returncode == 0, done.stderr
    calls = (tmp_path / "calls").read_text(encoding="utf-8").splitlines()
    assert calls == ["again team chat assistente resume=1"], calls          # no docker, no ensure_up: only the fresh wrapper
    assert "so the chat stops for a moment" in done.stderr


def test_after_three_switches_in_a_row_the_chat_says_to_open_it_again(tmp_path):
    done = _chat_functions(tmp_path, "exit 0\n", "", "team_chat_through_switch team chat assistente\n", JHT_TEAM_CHAT_RESUME="3")
    assert done.returncode == 0 and "Open it again in a couple of minutes with jht team chat." in done.stderr
    assert not (tmp_path / "calls").exists()


def test_the_fresh_wrapper_attaches_to_the_running_agent_and_starts_nothing(tmp_path):
    done = _chat_functions(tmp_path, f'echo "docker $*" >> "{tmp_path}/calls"\nexit 0\n',
                           'container_up() { ATTESTED_CONTAINER_ID=full; }\n', "team_chat_resume team chat assistente\necho ATTACH\n")
    assert done.returncode == 0 and done.stdout.strip() == "ATTACH", done.stderr
    calls = (tmp_path / "calls").read_text(encoding="utf-8").splitlines()
    assert calls == ["docker exec full tmux has-session -t =ASSISTENTE"], calls   # the new container; no ENSURE_UP, no start
    assert "let's pick up again" in done.stderr


def test_the_fresh_wrapper_never_starts_a_container_that_is_not_there(tmp_path):
    done = _chat_functions(tmp_path, f'echo "docker $*" >> "{tmp_path}/calls"\nexit 0\n',
                           'container_up() { return 3; }\n', "team_chat_resume team chat assistente\necho ATTACH\n",
                           JHT_TOOLS_CHAT_RECONNECT_MAX="2")
    assert done.returncode == 0 and "ATTACH" not in done.stdout
    assert "Open it again in a couple of minutes with jht team chat." in done.stderr
    assert not (tmp_path / "calls").exists()                                 # no ensure_up, no docker at all


def test_the_fresh_wrapper_waits_for_the_container_the_switch_has_just_started(tmp_path):
    """Giro Linux build11: the full container was up, not yet ours for a second, and the chat said «it comes back by itself»
    and at once «this chat has closed» (the Assistente was back one second before). The container is waited for, as the agent."""
    tries = tmp_path / "tries"
    done = _chat_functions(tmp_path, f'echo "docker $*" >> "{tmp_path}/calls"\nexit 0\n',
                           f'container_up() {{ echo x >> "{tries}"; [ "$(wc -l < "{tries}")" -ge 3 ] || return 1; ATTESTED_CONTAINER_ID=full; }}\n',
                           "team_chat_resume team chat assistente\necho ATTACH\n", JHT_TOOLS_CHAT_RECONNECT_MAX="10")
    assert done.returncode == 0 and done.stdout.strip() == "ATTACH", done.stderr
    assert len(tries.read_text(encoding="utf-8").splitlines()) == 3
    assert "this chat has closed" not in done.stderr and "let's pick up again" in done.stderr
    calls = (tmp_path / "calls").read_text(encoding="utf-8").splitlines()
    assert calls == ["docker exec full tmux has-session -t =ASSISTENTE"], calls   # still nothing started


def test_an_agent_that_does_not_come_back_in_time_leaves_the_line_to_open_it_again(tmp_path):
    done = _chat_functions(tmp_path, f'echo "docker $*" >> "{tmp_path}/calls"\n[ "$3" = tmux ] && exit 1\nexit 0\n',
                           'container_up() { :; }\n', "team_chat_resume team chat assistente\necho ATTACH\n",
                           JHT_TOOLS_CHAT_RECONNECT_MAX="2")
    assert done.returncode == 0 and "ATTACH" not in done.stdout
    assert "Open it again in a couple of minutes with jht team chat." in done.stderr


def _ready(box, age: float = 0):
    flag = box.home / "profile" / "ready.flag"
    flag.write_text("2026-11-15T21:10:19Z\n", encoding="utf-8")
    stamp = time.time() - age
    os.utime(flag, (stamp, stamp))


def test_the_switch_waits_for_the_end_of_the_onboarding_not_for_ready_flag(box):
    """ready.flag is «the team starts» (three fields), not «the onboarding is over»: the Assistente goes on asking. Giro Linux:
    the switch closed the chat in the middle of the onboarding. It waits for onboarding-done.flag, which the Assistente writes
    when its questions are over."""
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    _ready(box)
    assert box.run("tools_kick", **{**KICK_ENV, "JHT_TOOLS_ONBOARDING_MAX": "600"}).returncode == 0
    time.sleep(3)
    assert tier.exists() and _calls(box) == [], "the switch did not wait for the end of the onboarding"
    (box.home / "profile" / "onboarding-done.flag").write_text("2026-11-15T21:40:00Z\n", encoding="utf-8")
    _wait_until(lambda: not tier.exists() and _calls(box) == ["down", "up"], f"no switch after the onboarding: {_calls(box)}")


def test_a_link_in_place_of_onboarding_done_is_not_believed(box, tmp_path):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    _ready(box)
    (tmp_path / "elsewhere").write_text("x\n", encoding="utf-8")
    (box.home / "profile" / "onboarding-done.flag").symlink_to(tmp_path / "elsewhere")
    assert box.run("tools_kick", **{**KICK_ENV, "JHT_TOOLS_ONBOARDING_MAX": "600"}).returncode == 0
    time.sleep(3)
    assert tier.exists() and _calls(box) == [], "a link made the switch"
    (box.home / "profile" / "onboarding-done.flag").unlink()
    (box.home / "profile" / "onboarding-done.flag").write_text("x\n", encoding="utf-8")
    _wait_until(lambda: not tier.exists(), "no switch")


def test_without_the_end_of_the_onboarding_the_tetto_after_ready_flag_decides(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    _ready(box)
    assert box.run("tools_kick", **{**KICK_ENV, "JHT_TOOLS_ONBOARDING_MAX": "4"}).returncode == 0
    time.sleep(2)
    assert tier.exists() and _calls(box) == [], "the switch did not wait for the tetto"
    _wait_until(lambda: not tier.exists() and _calls(box) == ["down", "up"], f"no switch at the tetto: {_calls(box)}")


def test_an_onboarding_over_long_ago_lets_the_switch_go_at_once(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    _ready(box, age=4000)
    assert box.run("tools_kick", **KICK_ENV).returncode == 0   # tetto 0 in KICK_ENV; and an old install: no done flag at all
    _wait_until(lambda: not tier.exists(), "no switch")


def test_a_switch_that_still_fails_is_said_until_an_up_goes_well(box):
    box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    (box.fake / "jht-wrapper.sh").write_text('#!/bin/sh\necho "$@" >> "$FAKE/wrapper-calls"\n[ "$1" = up ] && exit 1\nexit 0\n',
                                             encoding="utf-8")
    assert box.run("tools_kick", **KICK_ENV).returncode == 0
    box.wait_for("failed")
    box.wait_for_pull_end()
    assert box.notice()["reason"] == "switch_failed"
    assert box.run("tools_person_state", **KICK_ENV).stdout == "switch_failed\n"
    # the person runs `jht down` and `jht up`: the up that goes well reaches tools_kick, and the marker is gone
    assert box.run("tools_kick", **KICK_ENV).returncode == 0
    assert box.run("tools_person_state", **KICK_ENV).stdout == ""


def test_a_failed_pull_is_said_and_the_next_kick_tries_again(box):
    box.tier()
    (box.fake / "pull-fails").write_text("", encoding="utf-8")
    assert box.run("tools_kick", **KICK_ENV).returncode == 0
    box.wait_for("failed")
    box.wait_for_pull_end()
    assert box.run("tools_person_state", **KICK_ENV).stdout == "failed\n"
    (box.fake / "pull-fails").unlink()
    assert box.run("tools_kick", **KICK_ENV).returncode == 0
    box.wait_for("ready")
    assert len((box.fake / "pulls").read_text(encoding="utf-8").splitlines()) == 2


def test_kick_does_nothing_without_a_tier_or_with_the_engine_down(box):
    assert box.run("tools_kick", **KICK_ENV).returncode == 0 and not (box.runtime / ".tools-pull.lock").exists()
    box.tier()
    (box.fake / "engine-down").write_text("", encoding="utf-8")
    done = box.run("tools_kick", **KICK_ENV)
    assert done.returncode == 0 and done.stdout == "" and done.stderr == ""
    assert not (box.runtime / ".tools-pull.lock").exists()


def test_jht_up_setup_and_status_keep_the_tools_moving_and_say_where_they_stand():
    text = WRAPPER.read_text(encoding="utf-8")
    up = text[text.index("\n  up)\n"):text.index("\n  start-container)\n")]
    setup = text[text.index("\n  setup)\n"):text.index("\n  download)\n")]
    status = text[text.index("\n  status)\n"):]
    status = status[:status.index("\n    ;;\n")]
    assert "tools_tell_person kick" in up and "tools_tell_person kick" in setup
    # the pull starts with the container up, BEFORE telegram and the broker: an up that ends early on one of them never started it
    assert up.index("tools_tell_person kick") < up.index("telegram_lifecycle_if_available resume") < up.index("broker_after_up")
    assert up.index("container_postcheck_running") < up.index("tools_tell_person kick")
    assert "tools_tell_person" in status and "tools_tell_person kick" not in status   # status is a probe: it starts nothing
    body = text[text.index("\ntools_tell_person() {"):]
    body = body[:body.index("\n}\n")]
    for key in ("tools.arriving", "tools.not_started", "tools.waiting", "tools.failed", "tools.switch_failed"):
        assert f"jht_say {key}" in body, key
    assert "|| true" in body   # the command it rides on is never failed by it


# ── jht tools --help: its own usage, served before anything starts ───────────────────────────────────────────────────────────

def test_tools_help_is_its_own_usage_served_before_the_container_or_the_helper():
    sh = WRAPPER.read_text(encoding="utf-8")
    ps = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8")
    body = re.search(r"^tools_help\(\) \{\n.*?^\}\n", sh, re.S | re.M).group(0)
    assert "jht_say help.tools" in body
    gate = sh[sh.index('      -h|--help)\n'):]
    gate = gate[:gate.index("serve_help_without_docker")]
    assert re.search(r'if \[ "\$SUB" = tools \]; then\n\s+tools_help\n\s+exit 0', gate), "the help gate answers jht tools --help"
    assert sh.index('if [ "$SUB" = tools ]; then\n          tools_help') < sh.index("\n  tools)\n"), "before the tools arm"
    # the .ps1 says the catalogue's text by its key (in every language: tests/test_wrapper_ps1_speaks_the_language_chosen.py)
    assert re.search(r"function Write-ToolsHelp \{\n  \[Console\]::Out\.WriteLine\(\(Get-JhtText 'help\.tools'\)\)\n\}", ps)
    ps_gate = ps[ps.index("$HelpRequested = "):ps.index("exit (Invoke-HelpWithoutDocker $Sub @Rest)")]
    assert re.search(r"if \(\$Sub -ceq 'tools'\) \{\n\s+Write-ToolsHelp\n\s+exit 0", ps_gate)
    import sys as _sys
    _sys.path.insert(0, str(ROOT / "tests"))
    from wrapper_texts import catalog
    for lang in ("en", "it"):
        text = catalog(lang)["wrapper.help.tools"]
        for needed in ("jht tools", "status --json", "pull", "switch"):
            assert needed in text, (lang, needed)
    for lang in ("hu", "es", "de", "fr", "pt"):
        text = catalog(lang)["wrapper.help.tools"]
        assert "jht tools" in text and "status --json" in text and "%" not in text


def test_tools_help_runs_and_touches_nothing(tmp_path):
    import sys as _sys
    _sys.path.insert(0, str(ROOT / "tests"))
    from wrapper_texts import say_functions
    text = WRAPPER.read_text(encoding="utf-8")
    body = re.search(r"^tools_help\(\) \{\n.*?^\}\n", text, re.S | re.M).group(0)
    script = "set -u\ndocker() { echo DOCKER >&2; return 1; }\n" + say_functions("en") + body + "\ntools_help\n"
    result = subprocess.run(["bash", "-c", script], text=True, capture_output=True, timeout=30)
    assert result.returncode == 0 and result.stdout.startswith("Usage: jht tools <command>"), result.stderr
    assert "DOCKER" not in result.stderr


def test_the_job_does_not_take_its_own_subshells_for_another_command(tmp_path):
    """In production the job is a fork of the wrapper: every subshell it makes has the wrapper's command line. A subshell of a
    command substitution is a real fork on Linux (bash 5, procps pgrep), and pgrep leaves only itself out: the check must not
    count the job's own children, or the switch waits its whole half hour every time."""
    wrapper = tmp_path / "jht-wrapper.sh"
    wrapper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    body = (f'RUNTIME_DIR="{tmp_path}"; JHT_HOME_HOST="{tmp_path}"; WRAPPER_PATH="{wrapper}"\n'
            f'source "{TOOLS}"\n'
            # the job runs it from a function in a background subshell, like tools_pull_job
            '( x="$(true)"; if tools_other_wrapper_running; then echo OTHER; else echo NONE; fi ) &\nwait\n')
    # $0 = the wrapper's path: the shell and all its forks carry it on their command line, as the real job does
    done = subprocess.run(["bash", "-c", body, str(wrapper)], capture_output=True, text=True, timeout=30)
    assert done.stdout.strip() == "NONE", done.stdout + done.stderr
    # the same with no BASHPID, as in bash 3.2, the system bash of macOS
    no_bashpid = subprocess.run(["bash", "-c", "unset BASHPID\n" + body, str(wrapper)], capture_output=True, text=True, timeout=30)
    assert no_bashpid.stdout.strip() == "NONE", no_bashpid.stdout + no_bashpid.stderr
    # and a real other command is still seen
    other = subprocess.Popen(["sh", "-c", "sleep 4; :", str(wrapper), "up"])
    try:
        time.sleep(0.5)
        seen = subprocess.run(["bash", "-c", body, str(wrapper)], capture_output=True, text=True, timeout=30)
        assert seen.stdout.strip() == "OTHER", seen.stdout + seen.stderr
    finally:
        other.wait(timeout=10)



# --- `jht tools status`: one line for the person (the words `jht up` says), --json stays for programs ----------------

def _say_status(box):
    body = re.search(r"(?ms)^tools_say_status\(\) \{\n.*?^\}\n", WRAPPER.read_text(encoding="utf-8")).group(0)
    done = box.run("jht_say() { printf '%s' \"$1\"; }\n" + body + "tools_say_status")
    assert done.returncode == 0, done.stderr
    return done.stdout


def test_tools_status_says_where_the_tools_stand_in_one_line(box):
    assert _say_status(box) == "tools.ready\n", "no tier file: the tools are here"
    box.tier()
    assert _say_status(box) == "tools.not_started\n", "a core install with nothing pulling and nothing failed: nobody started the pull, it is not «arriving»"
    (box.fake / "full-present").write_text("", encoding="utf-8")
    assert _say_status(box) == "tools.waiting\n"
    (box.fake / "engine-down").write_text("", encoding="utf-8")
    assert _say_status(box) == "tools.engine_down\n"


def test_tools_status_says_a_failed_switch(box):
    (box.runtime / ".tools-switch-failed").write_text("switch_failed\n", encoding="utf-8")
    assert _say_status(box) == "tools.switch_failed\n"


def test_the_wrapper_answers_tools_status_alone_and_leaves_json_to_the_helper():
    text = WRAPPER.read_text(encoding="utf-8")
    assert "status:) if declare -F tools_say_status >/dev/null 2>&1; then tools_say_status; else tools_status_json; fi ;;" in TOOLS.read_text(encoding="utf-8")
    assert "tools_say_status() {" in text


# --- the setup that started the job holds the switch (a Mac round, a VPS round on Linux: the wizard of an update died with 137) ------

def test_the_switch_waits_for_the_jht_setup_that_started_the_job(box):
    """An update: the profile is already there, so the job of `jht setup` switches as soon as the full image is here. The wrapper
    that started it is the `jht setup` whose wizard is open (the installer opens it and waits for it): $$ in the job is that wrapper,
    and it was left out of the wait, so the switch recreated the container under the wizard, which died with 137. The job must wait
    for it, and switch once it is over."""
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    wrapper = box.fake / "jht-wrapper.sh"
    # the shell is the `jht setup`: «bash -c <script> <wrapper> setup»; it kicks the job, then its wizard stays open 4 seconds
    body = ('tools_kick\nsleep 4\n'
            f'if [ -e "{tier}" ]; then echo tier-during-setup; fi\n'
            'if [ -s "$FAKE/wrapper-calls" ]; then echo switched-during-setup; fi\n')
    done = box.run(body, argv=(str(wrapper), "setup"), **KICK_ENV)
    assert done.returncode == 0, done.stderr
    assert done.stdout.splitlines() == ["tier-during-setup"], f"the switch ran under the open wizard: {done.stdout}"
    _wait_until(lambda: not tier.exists() and _calls(box) == ["down", "up"], f"no switch after the setup ended: {_calls(box)}")
    box.wait_for_pull_end()


def test_a_setup_holds_the_switch_past_the_cap_of_the_other_commands(box):
    """`jht up` and the like hold the switch half an hour at most; a setup waits for the person, so it holds it as long as it runs."""
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    wrapper = box.fake / "jht-wrapper.sh"
    other = subprocess.Popen(["sh", "-c", "sleep 6; :", str(wrapper), "setup"])
    try:
        assert box.run("tools_kick", **{**KICK_ENV, "JHT_TOOLS_QUIET_MAX": "2"}).returncode == 0
        time.sleep(4.5)
        assert tier.exists() and _calls(box) == [], "the setup was cut at the cap of the other commands"
    finally:
        other.wait(timeout=10)
    _wait_until(lambda: not tier.exists() and _calls(box) == ["down", "up"], f"no switch after the setup: {_calls(box)}")
    box.wait_for_pull_end()


def test_another_command_still_holds_the_switch_only_up_to_its_cap(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    wrapper = box.fake / "jht-wrapper.sh"
    other = subprocess.Popen(["sh", "-c", "sleep 12; :", str(wrapper), "up"])
    try:
        assert box.run("tools_kick", **{**KICK_ENV, "JHT_TOOLS_QUIET_MAX": "2"}).returncode == 0
        _wait_until(lambda: not tier.exists() and _calls(box) == ["down", "up"], f"the cap did not end the wait: {_calls(box)}")
        assert other.poll() is None, "the switch waited for the end of the command, past its cap"
    finally:
        other.kill()
        other.wait(timeout=10)
    box.wait_for_pull_end()


# --- room on the disk before the pull, and the old images of JHT (giro Mac m21: from 10 to 2 GiB free) ---------------------

GIB = 1048576

# the wrapper's functions the helper uses, faked: the free KiB in $FAKE/free-kib (none = cannot be measured), the image the
# container runs in $FAKE/running, the cleaning writes its arguments in $FAKE/prune and frees $FAKE/freed bytes
def _wrapper_disk_room() -> str:
    """The wrapper's own room rule (what stays free AFTER a download), with its threshold: only the measure is faked."""
    text = WRAPPER.read_text(encoding="utf-8")
    names = ("pull_need_kib", "disk_download_volumes", "disk_room_after_download", "disk_gib_up_text")
    body = "".join(re.search(rf"(?ms)^{name}\(\) \{{\n.*?^\}}\n", text).group(0) for name in names)
    return "DISK_BLOCK_FREE_PERMILLE=30\nDISK_BLOCK_FREE_KIB=8388608\nDISK_ROOM_FREE_KIB=''\nDISK_ROOM_SHORT_KIB=''\n" + body


# a disk of 1 TiB: its 3% (about 31 GiB) is above 8 GiB, so the 8 GiB decide, as on the Mac of giro build8
DISK_FAKES = _wrapper_disk_room() + r'''
disk_total_avail() { printf '%s\n' "$1" >> "$FAKE/measured"; [ -s "$FAKE/free-kib" ] || return 1; printf '1073741824 %s' "$(cat "$FAKE/free-kib")"; }
disk_engine_path() { :; }
disk_gib_text() { printf '%s' $(( $1 / 1048576 )); }
upgrade_image_plain() { printf '%s' "${1#sha256:}"; }
upgrade_image() { cat "$FAKE/running" 2>/dev/null || true; }
upgrade_prune_old_images() {
  printf '%s %s json=%s\n' "$1" "$2" "${UPGRADE_JSON:-}" >> "$FAKE/prune"
  # what the cleaning gives back to this computer's disk (the trim of the machine included), as a test says
  [ -s "$FAKE/free-after" ] && cp "$FAKE/free-after" "$FAKE/free-kib"
  UPGRADE_PRUNE_JSON="{\"removed\":2,\"freedBytes\":$(cat "$FAKE/freed" 2>/dev/null || echo 0),\"refused\":0}"
}
'''


def _disk(box, free_gib=None, running="sha256:coreid", freed_gib=0):
    if free_gib is not None:
        (box.fake / "free-kib").write_text(str(int(free_gib * GIB)), encoding="utf-8")
    (box.fake / "running").write_text(running, encoding="utf-8")
    (box.fake / "freed").write_text(str(int(freed_gib * GIB * 1024)), encoding="utf-8")


# no profile yet: the job ends 2 s after its pull instead of waiting for it a minute
PULL_ONLY_ENV = {**KICK_ENV, "JHT_TOOLS_WAIT_MAX": "2"}


def _prunes(box):
    path = box.fake / "prune"
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else []


def test_with_room_on_the_disk_the_pull_goes_and_nothing_is_cleaned_first(box):
    box.tier()
    _disk(box, free_gib=20)
    assert box.run(DISK_FAKES + "tools_kick", **PULL_ONLY_ENV).returncode == 0
    box.wait_for("ready")
    box.wait_for_pull_end()
    assert (box.fake / "pulls").exists() and _prunes(box) == []


def test_short_of_room_the_old_images_go_first_and_the_disk_is_measured_again(box):
    box.tier()
    _disk(box, free_gib=8, freed_gib=8)
    (box.fake / "free-after").write_text(str(16 * GIB), encoding="utf-8")   # the old images and the trim gave 8 GiB back: 16 - 6 >= 8
    assert box.run(DISK_FAKES + "tools_kick", **PULL_ONLY_ENV).returncode == 0
    box.wait_for("ready")
    box.wait_for_pull_end()
    assert (box.fake / "pulls").exists()
    assert _prunes(box) == ["coreid coreid json=1"], "kept: the running core image, this version's core"


def test_space_freed_inside_the_machine_that_the_computer_does_not_get_back_does_not_count(box):
    """Giro Mac m21 (build6): the old images went inside the Podman machine, the Mac did not get the space back, and the pull
    took it from the Mac's own disk. Only the disk of this computer, measured again, says there is room."""
    box.tier()
    _disk(box, free_gib=8, freed_gib=4)                       # 4 GiB freed in the machine, the Mac still at 8
    assert box.run(DISK_FAKES + "tools_kick", **PULL_ONLY_ENV).returncode == 0
    assert not (box.fake / "pulls").exists() and box.notice()["reason"] == "disk_low"

def test_with_no_room_nothing_is_pulled_and_the_person_is_told_then_up_tries_again(box):
    box.tier()
    _disk(box, free_gib=3, freed_gib=1)
    done = box.run(DISK_FAKES + "tools_kick", **PULL_ONLY_ENV)
    assert done.returncode == 0 and done.stdout == "", done.stderr
    assert not (box.fake / "pulls").exists(), "pulled on a full disk"
    assert not (box.runtime / ".tools-pull.lock").exists()
    assert box.notice()["state"] == "failed" and box.notice()["reason"] == "disk_low"
    assert box.run(DISK_FAKES + "tools_person_state", **KICK_ENV).stdout == "disk_low\n"
    assert box.run(DISK_FAKES + "tools_status_json", **KICK_ENV).stdout.strip() == \
        '{"ok":true,"state":"failed","tier":"core","reason":"disk_low"}'
    # space made: the next `jht up` pulls
    _disk(box, free_gib=30)
    assert box.run(DISK_FAKES + "tools_kick", **PULL_ONLY_ENV).returncode == 0
    box.wait_for("ready")
    box.wait_for_pull_end()
    assert (box.fake / "pulls").exists()


def test_the_pull_goes_only_when_what_stays_free_after_it_keeps_the_agents_above_their_threshold(box):
    """Giro Mac build8: 9.2 GiB free took the update, and then every agent refused to start (disk_low at 3.9 GiB). The full pull
    takes about 5 GiB (JHT_PULL_FULL_GIB): it goes only when 8 GiB stay free after it."""
    box.tier()
    _disk(box, free_gib=13)
    assert box.run(DISK_FAKES + "tools_disk_room && echo room").stdout == "room\n"
    _disk(box, free_gib=12.9)
    assert box.run(DISK_FAKES + "tools_disk_room || echo short").stdout == "short\n"
    _disk(box, free_gib=10)
    assert box.run(DISK_FAKES + "tools_disk_room && echo room", JHT_PULL_FULL_GIB="2").stdout == "room\n"
    assert box.run(DISK_FAKES + "tools_disk_room || echo short", JHT_PULL_FULL_GIB="two").stdout == "short\n"
    (box.fake / "free-kib").unlink()
    assert box.run(DISK_FAKES + "tools_disk_room && echo room").stdout == "room\n"


def test_on_a_small_disk_the_threshold_is_the_three_percent():
    """The agents' threshold is under 3% AND under 8 GiB: on a disk of 100 GiB, 3 GiB free after the pull is still enough."""
    body = _wrapper_disk_room() + 'disk_total_avail() { printf "%s %s" 104857600 "$FREE"; }\ndisk_engine_path() { :; }\n'
    run = lambda free_gib, need_gib: subprocess.run(["bash", "-c", body + f"disk_room_after_download {int(need_gib * GIB)}; echo rc=$? short=$DISK_ROOM_SHORT_KIB"],
                                             capture_output=True, text=True, env={**os.environ, "FREE": str(int(free_gib * GIB))}).stdout
    assert run(9.1, 6) == "rc=0 short=\n"
    assert run(8.9, 6).startswith("rc=1 short=")
    # what is missing is the smaller of the two distances: here to the 3% (3.0 GiB after), not to the 8 GiB
    short = int(run(8.9, 6).split("short=")[1])
    assert 0 < short <= int(0.11 * GIB)


@pytest.mark.parametrize("case", ["other-image", "upgrade-lock", "upgrade-journal", "no-container"])
def test_the_old_images_are_left_alone_when_the_container_is_not_on_this_version_or_an_upgrade_runs(box, case):
    box.tier()
    _disk(box, free_gib=3, running="sha256:someoldid" if case == "other-image" else "sha256:coreid")
    if case == "upgrade-lock":
        (box.runtime / ".upgrade.lock").mkdir()
    if case == "upgrade-journal":
        (box.runtime / ".upgrade-journal").write_text("x\n", encoding="utf-8")
    if case == "no-container":
        (box.fake / "running").unlink()
    assert box.run(DISK_FAKES + "tools_clean_old_images").returncode == 0
    assert _prunes(box) == []


def test_after_a_switch_that_went_well_the_old_images_go_keeping_this_versions_core(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    _disk(box, free_gib=30, running="sha256:fullid")
    assert box.run(DISK_FAKES + "tools_kick", **KICK_ENV).returncode == 0
    _wait_until(lambda: not tier.exists() and _prunes(box) == ["fullid coreid json=1"], f"no cleaning after the switch: {_prunes(box)}")
    box.wait_for_pull_end()


def test_a_switch_that_failed_or_a_team_left_stopped_cleans_nothing(box):
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    _disk(box, free_gib=30, running="sha256:fullid")
    (box.fake / "jht-wrapper.sh").write_text('#!/bin/sh\necho "$@" >> "$FAKE/wrapper-calls"\n[ "$1" = up ] && exit 1\nexit 0\n',
                                             encoding="utf-8")
    assert box.run(DISK_FAKES + "tools_kick", **KICK_ENV).returncode == 0
    box.wait_for("failed")
    box.wait_for_pull_end()
    assert _prunes(box) == []
    tier = box.tier()
    (box.runtime / ".tools-switch-failed").unlink(missing_ok=True)
    assert box.run(DISK_FAKES + "team_stopped_by_person() { return 0; }; tools_kick", **KICK_ENV).returncode == 0
    _wait_until(lambda: not tier.exists(), "the tier never went")
    box.wait_for_pull_end()
    assert _prunes(box) == []


def test_the_manual_switch_cleans_the_old_images_too(box):
    box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    _disk(box, running="sha256:fullid")
    done = box.run(DISK_FAKES + "tools_switch")
    assert done.returncode == 0 and "JHT_PHASE tools_ready" in done.stdout, done.stderr
    assert _prunes(box) == ["fullid coreid json=1"]


def test_tools_status_says_there_is_no_room_with_the_numbers(box):
    box.tier()
    (box.runtime / ".tools-pull-failed").write_text("disk_low\n", encoding="utf-8")
    _disk(box, free_gib=3)
    text = WRAPPER.read_text(encoding="utf-8")
    body = "".join(re.search(rf"(?ms)^{name}\(\) \{{\n.*?^\}}\n", text).group(0) for name in ("tools_say_status", "tools_disk_low_text"))
    done = box.run(DISK_FAKES + "jht_say() { printf '%s' \"$*\"; }\n" + body + "tools_say_status")
    assert done.stdout == "tools.disk_low 13 3\n", done.stdout + done.stderr


def test_jht_up_setup_and_status_say_the_disk_is_short():
    text = WRAPPER.read_text(encoding="utf-8")
    tell = re.search(r"(?ms)^tools_tell_person\(\) \{\n.*?^\}\n", text).group(0)
    assert 'disk_low) warn "$(tools_disk_low_text)" ;;' in tell
    status = re.search(r"(?ms)^tools_say_status\(\) \{\n.*?^\}\n", text).group(0)
    assert "disk_low) printf '%s\\n' \"$(tools_disk_low_text)\" ;;" in status


# --- a container's process is not another jht command; a cap that is not a number is the default (review of p45) -------

def test_a_process_of_another_pid_namespace_does_not_hold_the_switch(tmp_path):
    """With a rootful Docker on Linux the host sees the processes of the containers: one with «<wrapper path> setup» on its
    command line held the switch for a day. Only the processes of the job's own pid namespace count."""
    wrapper = tmp_path / "jht-wrapper.sh"
    wrapper.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    other = subprocess.Popen(["sh", "-c", "sleep 8; :", str(wrapper), "setup"])
    try:
        time.sleep(0.5)
        check = (f'RUNTIME_DIR="{tmp_path}"; JHT_HOME_HOST="{tmp_path}"; WRAPPER_PATH="{wrapper}"\n'
                 f'source "{TOOLS}"\n'
                 '{fake}'
                 'if tools_other_wrapper_running; then echo OTHER; else echo NONE; fi\n')
        same = check.replace("{fake}", 'tools_pid_ns() { echo "pid:[1]"; }\n')
        foreign = check.replace("{fake}", f'tools_pid_ns() {{ if [ "$1" = {other.pid} ]; then echo "pid:[2]"; else echo "pid:[1]"; fi; }}\n')
        none = check.replace("{fake}", 'tools_pid_ns() { :; }\n')   # macOS: no namespace to read, nothing left out
        for body, expected in ((same, "OTHER"), (foreign, "NONE"), (none, "OTHER")):
            seen = subprocess.run(["bash", "-c", body], capture_output=True, text=True, timeout=30)
            assert seen.stdout.strip() == expected, (expected, seen.stdout + seen.stderr)
    finally:
        other.kill()
        other.wait(timeout=10)


@pytest.mark.parametrize("variable,command,default", [("JHT_TOOLS_SETUP_MAX", "setup", 86400), ("JHT_TOOLS_QUIET_MAX", "up", 1800)])
@pytest.mark.parametrize("value", ["abc", "", "-5", "1h"])
def test_a_cap_that_is_not_a_number_is_the_default_not_no_wait(box, variable, command, default, value):
    """`[ "$x" -gt 0 ]` on a word fails, and the wait read it as «over»: the switch went under the open wizard at once."""
    body = (f'n=0\ntools_other_wrapper_running() {{ n=$((n + 1)); TOOLS_RUNNING_COMMAND={command}; [ "$n" -le 3 ]; }}\n'
            'sleep() { :; }\n'
            'tools_wait_quiet\necho "looked=$n"\n')
    done = box.run(body, **{variable: value})
    assert done.stdout.strip() == "looked=4", f"{variable}={value!r}: {done.stdout}{done.stderr}"


# --- the trim of the Podman machine gives the space back to the Mac (giro Mac m21, build6: 11.3 -> 3.8 GiB) ----------------

TRIM_FAKES = r'''
PODMAN_RUNTIME_MODE=machine
PODMAN_MACHINE_NAME=jht-podman
podman_binary() { printf '%s\n' "$FAKE/bin/podman"; }
'''


def _fake_podman(box, fails=False):
    podman = box.fake / "bin" / "podman"
    podman.write_text('#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$FAKE/podman-calls"\n' + ("exit 1\n" if fails else "exit 0\n"),
                      encoding="utf-8")
    podman.chmod(0o755)


def _podman_calls(box):
    path = box.fake / "podman-calls"
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else []


def test_on_a_podman_machine_the_cleaning_trims_the_machines_disk(box):
    _fake_podman(box)
    _disk(box, free_gib=30, running="sha256:fullid")
    (box.fake / "full-present").write_text("", encoding="utf-8")
    done = box.run(DISK_FAKES + TRIM_FAKES + "tools_clean_old_images")
    assert done.returncode == 0, done.stderr
    assert _prunes(box) == ["fullid coreid json=1"]
    assert _podman_calls(box) == ["machine ssh jht-podman sudo fstrim -a"]


def test_the_trim_runs_even_when_no_image_could_go_and_a_failed_trim_changes_nothing(box):
    # an upgrade that waits keeps its images, but the layers a pull left behind still go back to the Mac
    _fake_podman(box, fails=True)
    _disk(box, free_gib=30, running="sha256:fullid")
    (box.runtime / ".upgrade-journal").write_text("x\n", encoding="utf-8")
    done = box.run(DISK_FAKES + TRIM_FAKES + "tools_clean_old_images; echo rc=$?")
    assert done.stdout.strip() == "rc=0" and _prunes(box) == []
    assert _podman_calls(box) == ["machine ssh jht-podman sudo fstrim -a"]


def test_without_a_podman_machine_nothing_is_trimmed(box):
    _fake_podman(box)
    _disk(box, free_gib=30, running="sha256:fullid")
    assert box.run(DISK_FAKES + TRIM_FAKES + "PODMAN_RUNTIME_MODE=native\ntools_clean_old_images").returncode == 0
    assert _podman_calls(box) == []


def test_after_the_switch_the_machine_is_trimmed(box):
    _fake_podman(box)
    tier = box.tier()
    (box.fake / "full-present").write_text("", encoding="utf-8")
    (box.home / "profile" / "ready.flag").write_text("2026-11-14T21:00:00Z\n", encoding="utf-8")
    _disk(box, free_gib=30, running="sha256:fullid")
    assert box.run(DISK_FAKES + TRIM_FAKES + "tools_kick", **KICK_ENV).returncode == 0
    _wait_until(lambda: not tier.exists() and _podman_calls(box) == ["machine ssh jht-podman sudo fstrim -a"],
                f"no trim after the switch: {_podman_calls(box)}")
    box.wait_for_pull_end()


def test_on_a_mac_the_room_is_measured_where_the_machines_disk_grows_too(box):
    _disk(box, free_gib=30)
    box.run(DISK_FAKES + TRIM_FAKES + "PODMAN_RUNTIME_MODE=machine\nJHT_PODMAN_MACHINE_DIR=/somewhere/machine\ndisk_room_after_download 0")
    measured = (box.fake / "measured").read_text(encoding="utf-8").splitlines()
    assert str(box.home) in measured and "/somewhere/machine" in measured
    (box.fake / "measured").unlink()
    box.run(DISK_FAKES + "PODMAN_RUNTIME_MODE=native\nJHT_PODMAN_MACHINE_DIR=/somewhere/machine\ndisk_room_after_download 0")
    assert "/somewhere/machine" not in (box.fake / "measured").read_text(encoding="utf-8")


# ── the engine goes away under the chat (an update restarts the Podman machine) ──────────────────────────────

RAW_ENGINE_LINE = 'Error: Get "http://d/v6.0.2/libpod/exec/0123abcd/json": EOF'


RAW_EXEC_SESSION_LINE = ("Error: retrieving exec session 0123abcd from container 99ff00: no container with ID 99ff00 found in database: "
                         "no such container")


@pytest.mark.parametrize("line", [RAW_ENGINE_LINE, "Cannot connect to Podman. Please verify your connection to the Linux system",
                                  "Error: unable to connect to Podman socket: dial unix: connection refused", RAW_EXEC_SESSION_LINE])
def test_a_chat_the_engine_ended_says_it_is_updating_and_comes_back_without_the_raw_line(tmp_path, line):
    """Windows, build 9 to 10: the installer restarts the Podman machine and the chat died with «Error: Get "http://d/v6.0.2/libpod/exec/…/json": EOF»."""
    done = _team_arm_chat(tmp_path, switching=False, engine_line=line)
    assert done.returncode == 0, done.stderr
    assert "libpod" not in done.stderr and "Cannot connect" not in done.stderr and "unable to connect" not in done.stderr
    assert "JHT is updating, so the chat stops for a moment" in done.stderr
    assert (tmp_path / "calls").read_text(encoding="utf-8").splitlines()[-1] == "again team chat assistente resume=1"
    assert not list(tmp_path.glob("jht-chat-err.*"))


def test_a_chat_that_comes_back_is_told_it_is_a_resumed_one_and_a_first_chat_is_not(tmp_path):
    """Windows, build 13: the container created again under the chat ended it with the raw line «retrieving exec session … no such
    container» and the question just asked stayed unanswered. The chat that comes back asks it again: the container side is told
    (JHT_TEAM_CHAT_RESUMED=1) only when the wrapper resumes a chat."""
    first = _team_arm_chat(tmp_path, switching=False, engine_line=RAW_EXEC_SESSION_LINE)
    assert first.returncode == 0, first.stderr
    assert "JHT_TEAM_CHAT_RESUMED" not in (tmp_path / "exec-args").read_text(encoding="utf-8")
    resumed_dir = tmp_path / "resumed"
    resumed_dir.mkdir()
    again = _team_arm_chat(resumed_dir, switching=False, engine_line=RAW_EXEC_SESSION_LINE, JHT_TEAM_CHAT_RESUME="1")
    assert again.returncode == 0, again.stderr
    assert "-e JHT_TEAM_CHAT_RESUMED=1" in (resumed_dir / "exec-args").read_text(encoding="utf-8")


def test_the_line_of_the_switch_is_not_taken_for_the_one_of_a_container_created_again(tmp_path):
    done = _team_arm_chat(tmp_path, switching=False)
    assert done.returncode == 125 and "updating" not in done.stderr


def test_a_chat_the_engine_ended_that_does_not_come_back_says_to_open_it_again(tmp_path):
    done = _team_arm_chat(tmp_path, switching=False, engine_line=RAW_ENGINE_LINE, engine_up=False, JHT_CHAT_UPDATE_WAIT_MAX="0")
    assert done.returncode == 0, done.stderr
    assert "libpod" not in done.stderr
    assert "JHT is updating, so this chat has closed. Open it again in a couple of minutes with jht team chat." in done.stderr
    assert (tmp_path / "calls").read_text(encoding="utf-8").splitlines() == ["ENSURE_UP"]   # no fresh wrapper, nothing started after


def test_after_three_rounds_the_engine_chat_says_to_open_it_again(tmp_path):
    done = _chat_functions(tmp_path, "exit 0\n", "docker_reachable() { return 0; }\ncontainer_up() { return 0; }\n",
                           "team_chat_through_update team chat assistente\n", JHT_TEAM_CHAT_RESUME="3")
    assert done.returncode == 0 and "so this chat has closed" in done.stderr
    assert not (tmp_path / "calls").exists()


def test_the_chat_back_after_an_update_says_the_update_not_the_full_tools(tmp_path):
    """Retest Windows build13: after the restart of the machine the chat came back with «the team has moved onto the full tools»,
    the sentence of the switch of the tools. The fresh wrapper is told it comes back after an update, and says that."""
    again = tmp_path / "again-after.sh"
    again.write_text(f'echo "after=$JHT_TEAM_CHAT_RESUME_AFTER" >> "{tmp_path}/after"\n', encoding="utf-8")
    done = _chat_functions(tmp_path, "exit 0\n", f'docker_reachable() {{ return 0; }}\ncontainer_up() {{ return 0; }}\nWRAPPER_PATH="{again}"\n',
                           "team_chat_through_update team chat assistente\n", JHT_TEAM_CHAT_RESUME_AFTER="switch")
    assert done.returncode == 0, done.stderr
    assert (tmp_path / "after").read_text(encoding="utf-8").splitlines() == ["after=update"]
    resumed = _chat_functions(tmp_path, "exit 0\n", "container_up() { :; }\n", "team_chat_resume team chat assistente\necho ATTACH\n",
                              JHT_TEAM_CHAT_RESUME_AFTER="update")
    assert resumed.stdout.strip() == "ATTACH", resumed.stderr
    assert "JHT is up to date: let's pick up again." in resumed.stderr and "full tools" not in resumed.stderr


def test_the_chat_that_does_not_come_back_after_an_update_says_the_update(tmp_path):
    done = _chat_functions(tmp_path, '[ "$3" = tmux ] && exit 1\nexit 0\n', "container_up() { :; }\n",
                           "team_chat_resume team chat assistente\necho ATTACH\n", JHT_TEAM_CHAT_RESUME_AFTER="update",
                           JHT_TOOLS_CHAT_RECONNECT_MAX="2")
    assert done.returncode == 0 and "ATTACH" not in done.stdout
    assert "JHT is updating, so this chat has closed." in done.stderr and "full tools" not in done.stderr


def test_the_engine_line_of_a_chat_that_ended_well_is_left_alone(tmp_path):
    done = _team_arm_chat(tmp_path, switching=False, engine_line=RAW_ENGINE_LINE, code=0)
    assert done.returncode == 0 and RAW_ENGINE_LINE in done.stderr and "updating" not in done.stderr


def test_a_chat_without_a_console_is_not_held_for_an_engine_line(tmp_path):
    done = _team_arm_chat(tmp_path, switching=False, exec_flags="-i", engine_line=RAW_ENGINE_LINE)
    assert done.returncode == 125 and "updating" not in done.stderr


def test_the_update_texts_say_the_chat_in_every_language():
    import sys as _sys
    _sys.path.insert(0, str(ROOT / "tests"))
    from wrapper_texts import catalog
    for lang in ("en", "it", "hu", "es", "de", "fr", "pt"):
        texts = catalog(lang)
        assert texts["wrapper.tools.chat_updating"] and "%" not in texts["wrapper.tools.chat_updating"], lang
        assert "jht team chat" in texts["wrapper.tools.chat_update_closed"], lang
        assert "libpod" not in texts["wrapper.tools.chat_updating"]


def test_a_core_install_with_no_pull_under_way_and_no_failure_is_not_started_not_arriving(box):
    box.tier()
    assert box.run("tools_person_state", **KICK_ENV).stdout == "not_started\n"
    (box.fake / "pull-hold").write_text("", encoding="utf-8")
    box.run("tools_kick", **KICK_ENV)
    assert box.run("tools_person_state", **KICK_ENV).stdout == "arriving\n"
    (box.fake / "pull-hold").unlink()
    box.wait_for("ready")


def test_a_command_that_only_reads_the_team_waits_for_the_switch_instead_of_saying_it_cannot_attest():
    """Giro Mac 18/11: `jht team status` during the change of image said «operation refused» (the container cannot be attested
    between the down and the up of the switch). It waits for the switch first, as ensure_up does, and says so."""
    text = WRAPPER.read_text(encoding="utf-8")
    body = text[text.index("\nread_only_team_command() {\n"):]
    body = body[: body.index("\n}\n")]
    assert "wait_for_tools_switch" in body
    assert body.index("wait_for_tools_switch") < body.index("container_up"), "before the check of the container"
    assert "jht_machine_output; then wait_for_tools_switch quiet" in body, "a program reading the output gets no extra line"
