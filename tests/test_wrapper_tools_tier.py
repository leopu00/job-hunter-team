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
  image) [ -e "$FAKE/full-present" ] && exit 0; exit 1 ;;
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

    def run(body: str, *, library: bool = True, core_digest: str = CORE_DIGEST, **env):
        script = (
            f'set -u\nexport PATH="{bin_dir}:/usr/bin:/bin"\nexport FAKE="{fake}"\n'
            f'RUNTIME_DIR="{runtime}"\nRUNTIME_TIER_FILE="{runtime}/runtime-tier"\nRUNTIME_IMAGE_PIN="{runtime}/runtime-image"\n'
            f'RUNTIME_TIER_INTEGRITY="{runtime}/.runtime-tier-integrity"\nRUNTIME_MANIFEST="{runtime}/.runtime-integrity"\nCOMPOSE_FILE="{runtime}/docker-compose.yml"\n'
            f'HOST_SETUP_SCRIPT="{runtime}/host-setup.sh"\nWRAPPER_PATH="{wrapper}"\nRUNTIME_SELECTION_FILE="{runtime}/container-runtime"\n'
            f'HOST_KERNEL="$(uname -s)"\nHOST_UID="$(id -u)"\nCORE_IMAGE_DIGEST="{core_digest}"\nDEFAULT_RUNTIME_IMAGE="{FULL}"\nJHT_HOME_HOST="{home}"\nCONTAINER_RUNTIME=docker\n'
            'err() { echo "error: $*" >&2; }\n' + _functions() + "\n"
            + (f'source "{TOOLS}"\n' if library else "")
            + body
        )
        return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=60,
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

KICK_ENV = {"JHT_TOOLS_WAIT_STEP": "1", "JHT_TOOLS_SWITCH_GRACE": "0", "JHT_TOOLS_WAIT_MAX": "60", "JHT_TOOLS_QUIET_MAX": "600"}   # a switch that waited for nothing would miss every deadline below


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
    wrapper = tmp_path / "jht-wrapper.sh"
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


def test_jht_team_chat_ends_clean_with_a_line_when_the_switch_ended_it():
    text = WRAPPER.read_text(encoding="utf-8")
    arm = text[text.index("\n  team)\n"):]
    arm = arm[:arm.index("\n    ;;\n")]
    assert '"$NODE_ENTRY" "$@" || team_rc=$?' in arm                       # set -e does not end the wrapper on the REPL's exit
    assert re.search(r'if \[ "\$\{2:-\}" = chat \] && team_chat_ended_by_switch; then\n\s+info "\$\(jht_say tools\.chat_switched\)"\n\s+exit 0\n', arm)
    assert arm.rstrip().endswith('exit "$team_rc"')                       # any other end: the REPL's own code, as before
    import sys as _sys
    _sys.path.insert(0, str(ROOT / "tests"))
    from wrapper_texts import catalog
    for lang in ("en", "it", "hu", "es", "de", "fr", "pt"):
        line = catalog(lang)["wrapper.tools.chat_switched"]
        assert "jht team chat" in line and "%" not in line, lang


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
    assert "tools_tell_person" in status and "tools_tell_person kick" not in status   # status is a probe: it starts nothing
    body = text[text.index("\ntools_tell_person() {"):]
    body = body[:body.index("\n}\n")]
    for key in ("tools.arriving", "tools.waiting", "tools.failed", "tools.switch_failed"):
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
