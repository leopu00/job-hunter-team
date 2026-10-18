"""`jht clean-images` frees space even when the disk is almost full.

`jht upgrade` refuses below the disk threshold (`disk_low`), and with it the
cleaning that runs after a successful upgrade: with a full disk the user had no
way to get space back. `jht clean-images` is that way, SEPARATE from the upgrade
(which stays refused) and never passing through the disk check. It is the same
cleaning (`upgrade_prune_old_images`, same rules, none widened below the
threshold); what changes is the "previous" image: outside an upgrade nothing
records it, so it is the most recent JHT image by creation date among the
non-current ones.

The real functions of scripts/jht-wrapper.sh run against a stateful fake
`docker` on PATH (never an engine) and a fake `df`. Checked:

- at 2% free (`disk_low` true) the command removes the old JHT images, and
  `handle_runtime_upgrade` still refuses (test_disk_guard.py owns that proof);
- always kept: the current, the previous (newest other), any image of a
  container even stopped, other repositories, an ID that also carries a
  non-JHT name, the `<none>` ones;
- after a rollback the "previous" can be NEWER than the current: it errs on the
  side of keeping one more, never one less;
- never -f, prune, system, rmi, volume; an engine refusal is counted;
- doubt keeps everything: unreadable containers/images/dates, no running
  container, an upgrade in progress or interrupted, the opt-out;
- it does not start anything: no machine, no engine, no container.

Run with: pytest tests/test_clean_images.py -v
"""

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"

CURRENT = "aaaa" * 16
NEWEST = "bbbb" * 16          # newest of the non-current JHT images: the "previous"
OLD = ["c1c1" * 16, "d2d2" * 16]
LOCAL_TAG = "f4f4" * 16       # jht:latest, built on the host
OTHER_JHT_REPO = "0a0a" * 16
FOREIGN = "0b0b" * 16
IN_USE = "0c0c" * 16         # used by a stopped container
MULTI = "0d0d" * 16          # carries a JHT name AND postgres
UNTAGGED = "0e0e" * 16       # <none>

MB = 1048576
# id, repository, nominal size, creation date
IMAGES = [
    (CURRENT, "ghcr.io/leopu00/jht", 1000, "2026-10-10T10:00:00.500000000Z"),
    (NEWEST, "ghcr.io/leopu00/jht", 1000, "2026-10-05T10:00:00Z"),
    (OLD[0], "ghcr.io/leopu00/jht", 3 * MB, "2026-09-20T10:00:00.1Z"),
    (OLD[1], "ghcr.io/leopu00/jht", 5 * MB, "2026-09-01T10:00:00.1Z"),
    (LOCAL_TAG, "jht", 2 * MB, "2026-08-15T10:00:00Z"),
    (OTHER_JHT_REPO, "ghcr.io/leopu00/jht-other", 11 * MB, "2026-10-09T10:00:00Z"),
    (FOREIGN, "postgres", 13 * MB, "2026-10-09T10:00:00Z"),
    (IN_USE, "ghcr.io/leopu00/jht", 17 * MB, "2026-07-01T10:00:00Z"),
    (MULTI, "ghcr.io/leopu00/jht", 19 * MB, "2026-06-01T10:00:00Z"),
    (MULTI, "postgres", 19 * MB, "2026-06-01T10:00:00Z"),
    (UNTAGGED, "<none>", 23 * MB, "2026-05-01T10:00:00Z"),
]
EXPECTED_REMOVED = {OLD[0], OLD[1], LOCAL_TAG}

FAKE_DOCKER = r"""#!/bin/sh
# Stateful fake of the docker CLI: images and containers live in $FAKE_STATE.
printf '%s\n' "$*" >> "$FAKE_STATE/calls.log"
style() { if [ "${FAKE_STYLE:-docker}" = podman ]; then sed 's/^sha256://'; else sed 's/^\([0-9a-f]\)/sha256:\1/'; fi; }
case "$1 $2" in
  "container ls")
    [ "${FAKE_CONTAINERS_FAIL:-0}" = 1 ] && exit 1
    cut -d' ' -f1 "$FAKE_STATE/containers" ;;
  "image ls")
    [ "${FAKE_IMAGES_FAIL:-0}" = 1 ] && exit 1
    while read -r id repo size created; do printf '%s %s\n' "$(printf '%s' "$id" | style)" "$repo"; done < "$FAKE_STATE/images" ;;
  "image inspect")
    id="${5#sha256:}"
    case "$4" in
      *Created*)
        case " ${FAKE_CREATED_FAIL:-} " in *" $id "*) exit 1 ;; esac
        if [ -n "${FAKE_CREATED_OVERRIDE+x}" ]; then echo "$FAKE_CREATED_OVERRIDE"; exit 0; fi
        awk -v id="$id" '$1 == id { print $4; exit }' "$FAKE_STATE/images" ;;
      *) awk -v id="$id" '$1 == id { print $3; exit }' "$FAKE_STATE/images" ;;
    esac ;;
  "image rm")
    id="${3#sha256:}"
    case " ${FAKE_REFUSE:-} " in *" $id "*) echo "image is being used" >&2; exit 1 ;; esac
    grep -v "^$id " "$FAKE_STATE/images" > "$FAKE_STATE/images.new"; mv "$FAKE_STATE/images.new" "$FAKE_STATE/images"
    printf 'RM %s\n' "$id" >> "$FAKE_STATE/removed.log" ;;
  "inspect --format")
    shift 3
    for cid in "$@"; do awk -v c="$cid" '$1 == c { print $2 }' "$FAKE_STATE/containers"; done | style ;;
  *) exit 97 ;;
esac
"""

FUNCTIONS = (
    "upgrade_image_plain", "upgrade_repo_is_jht", "upgrade_foreign_image_ids",
    "upgrade_prune_result", "upgrade_prune_old_images", "clean_images_previous",
    "clean_images_message", "clean_images_emit", "handle_clean_images",
    "upgrade_acquire_lock", "upgrade_cleanup_ephemeral",
)
DISK_FUNCTIONS = ("disk_free_measure", "disk_engine_path", "disk_level_of", "disk_low")


def wrapper_text() -> str:
    return WRAPPER.read_text(encoding="utf-8")


def wrapper_function(name: str) -> str:
    match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", wrapper_text(), re.S | re.M)
    assert match, name
    return match.group(0)


def wrapper_constants() -> str:
    text = wrapper_text()
    lines = re.findall(r"^(?:DISK_[A-Z_]+|JHT_IMAGE_REPOSITORIES)=.*$", text, re.M)
    assert len(lines) >= 4, lines
    return "\n".join(lines) + "\n"


@pytest.fixture(params=["docker", "podman"])
def host(request, tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(FAKE_DOCKER)
    (bin_dir / "docker").chmod(0o755)
    state = tmp_path / "state"
    state.mkdir()
    (state / "runtime").mkdir()
    (state / "images").write_text("".join(f"{i} {r} {s} {c}\n" for i, r, s, c in IMAGES))
    # The current image runs; a stopped container holds IN_USE.
    (state / "containers").write_text(f"c0ffee {CURRENT}\nbeef01 {IN_USE}\n")
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "FAKE_STATE": str(state),
           "FAKE_STYLE": request.param}
    env.pop("JHT_KEEP_OLD_IMAGES", None)
    return type("H", (), {"state": state, "env": env, "style": request.param, "bin": bin_dir})


def sha(host, image_id: str) -> str:
    return image_id if host.style == "podman" else f"sha256:{image_id}"


def run_clean(host, args="--json", running=CURRENT, reachable=True, extra_env=None, before="", disk_pct=None):
    """Runs the REAL handle_clean_images. Returns (process, parsed JSON or None)."""
    if disk_pct is not None:
        (host.bin / "df").write_text(
            '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\n"\n'
            f'printf "/dev/fake 1000000 %s %s 1%% /\\n" "$((1000000 - 1000000 * {disk_pct} / 100))" "$((1000000 * {disk_pct} / 100))"\n')
        (host.bin / "df").chmod(0o755)
    script = (
        'STATE="$FAKE_STATE"\n'
        'RUNTIME_DIR="$STATE/runtime"\n'
        'PODMAN_RUNTIME_MODE=native\n'
        'UPGRADE_JSON=0; UPGRADE_LOCK=; UPGRADE_STAGE=; UPGRADE_PRUNE_JSON=\n'
        + wrapper_constants()
        + 'info() { echo "INFO: $*"; }\nerr() { echo "ERR: $*" >&2; }\n'
        'upgrade_note() { echo "NOTE: $*"; }\n'
        'require_confined_podman_machine() { :; }\n'
        + ('docker_reachable() { return 0; }\n' if reachable else 'docker_reachable() { return 1; }\n')
        + f'upgrade_image() {{ echo "{sha(host, running) if running else ""}"; }}\n'
        # A stand-in that records the call: the cleaning must NEVER ask the disk check.
        'disk_low() { echo called > "$STATE/disk_low_called"; return 0; }\n'
        + "\n".join(wrapper_function(n) for n in FUNCTIONS)
        + "\n" + before
        + f'\nhandle_clean_images {args}\necho "rc=$?"\n'
    )
    done = subprocess.run(["bash", "-c", script], env={**host.env, **(extra_env or {})},
                          capture_output=True, text=True, timeout=60)
    jsonl = next((l for l in done.stdout.splitlines() if l.startswith("{")), "")
    return done, (json.loads(jsonl) if jsonl else None)


def remaining_ids(host) -> set:
    return {line.split()[0] for line in (host.state / "images").read_text().splitlines() if line}


def engine_calls(host) -> list:
    path = host.state / "calls.log"
    return path.read_text().splitlines() if path.exists() else []


def removed(host) -> list:
    path = host.state / "removed.log"
    return [l.split()[1] for l in path.read_text().splitlines()] if path.exists() else []


def untouched(host):
    assert not (host.state / "removed.log").exists()
    assert remaining_ids(host) == {i for i, *_ in IMAGES}


# ── What it removes, and what it always keeps ────────────────────────────────


def test_it_removes_only_the_old_exact_jht_images_by_id(host):
    done, payload = run_clean(host)
    assert "rc=0" in done.stdout, done.stderr
    assert set(removed(host)) == EXPECTED_REMOVED
    assert remaining_ids(host) == {i for i, *_ in IMAGES} - EXPECTED_REMOVED
    assert payload["ok"] is True
    ip = payload["imagePrune"]
    assert (ip["removed"], ip["refused"], ip["inUse"], ip["skipped"]) == (3, 0, 1, "")
    assert ip["freedBytes"] == (3 + 5 + 2) * MB


def test_the_previous_is_the_newest_other_jht_image_and_survives(host):
    run_clean(host)
    assert NEWEST in remaining_ids(host)
    assert CURRENT in remaining_ids(host)


def test_after_a_rollback_a_newer_image_than_the_current_is_the_one_kept(host):
    # The running image is an old one (rollback); a NEWER one is still around.
    # "Previous" = the newest by date, so it is kept: one more image, never one less.
    done, payload = run_clean(host, running=OLD[1])
    assert "rc=0" in done.stdout, done.stderr
    kept = remaining_ids(host)
    assert CURRENT in kept, "the newest image of all must survive a rollback"
    assert OLD[1] in kept
    assert OLD[0] not in kept and payload["imagePrune"]["removed"] >= 1


def test_images_created_in_the_same_second_are_all_kept(host):
    lines = [l for l in (host.state / "images").read_text().splitlines()]
    lines = [l.replace("2026-10-05T10:00:00Z", "2026-10-05T10:00:00.9Z") if l.startswith(NEWEST) else l for l in lines]
    lines = [l.replace("2026-09-20T10:00:00.1Z", "2026-10-05T10:00:00Z") if l.startswith(OLD[0]) else l for l in lines]
    (host.state / "images").write_text("\n".join(lines) + "\n")
    run_clean(host)
    assert NEWEST in remaining_ids(host) and OLD[0] in remaining_ids(host)
    assert OLD[1] not in remaining_ids(host)


def test_an_image_of_a_stopped_container_is_kept(host):
    run_clean(host)
    assert IN_USE in remaining_ids(host)


def test_other_repositories_are_never_touched(host):
    run_clean(host)
    assert {OTHER_JHT_REPO, FOREIGN} <= remaining_ids(host)
    assert OTHER_JHT_REPO not in removed(host) and FOREIGN not in removed(host)


def test_an_id_that_also_carries_a_non_jht_name_is_kept(host):
    # Old and JHT-named, but the same ID is a postgres tag too: not ours to remove.
    run_clean(host)
    assert MULTI in remaining_ids(host) and MULTI not in removed(host)


def test_an_id_with_a_foreign_name_is_never_taken_as_the_previous(host):
    # MULTI (also a postgres tag) is the NEWEST non-current image. It must not count as
    # "previous": that would let the real previous JHT image go.
    lines = (host.state / "images").read_text().splitlines()
    lines = [l.replace("2026-06-01T10:00:00Z", "2026-10-08T10:00:00Z") if l.startswith(MULTI) else l for l in lines]
    (host.state / "images").write_text("\n".join(lines) + "\n")
    run_clean(host)
    assert NEWEST in remaining_ids(host), "the real previous was removed"
    assert MULTI in remaining_ids(host)


def test_untagged_images_stay(host):
    run_clean(host)
    assert UNTAGGED in remaining_ids(host)


def test_an_engine_refusal_is_counted_and_the_image_stays(host):
    _, payload = run_clean(host, extra_env={"FAKE_REFUSE": OLD[0]})
    assert OLD[0] in remaining_ids(host)
    assert payload["imagePrune"]["removed"] == 2 and payload["imagePrune"]["refused"] == 1


def test_with_only_the_current_there_is_nothing_to_remove(host):
    (host.state / "images").write_text(f"{CURRENT} ghcr.io/leopu00/jht 1000 2026-10-10T10:00:00Z\n")
    done, payload = run_clean(host, args="")
    assert "rc=0" in done.stdout and removed(host) == []
    assert "Nessuna immagine JHT vecchia" in done.stdout
    assert not any(c.startswith("image rm") for c in engine_calls(host))


def test_it_never_forces_prunes_or_touches_volumes(host):
    run_clean(host)
    for line in engine_calls(host):
        words = line.split()
        assert not {"-f", "--force", "prune", "system", "rmi", "volume", "stop", "kill", "start"} & set(words), line
        assert words[:2] in (["container", "ls"], ["image", "ls"], ["image", "inspect"],
                             ["image", "rm"], ["inspect", "--format"]), line
    assert all(re.fullmatch(r"image rm [0-9a-f]{64}|image rm sha256:[0-9a-f]{64}", c)
               for c in engine_calls(host) if c.startswith("image rm"))


# ── Almost-full disk: this is the way out, and the upgrade is not it ─────────


def test_with_the_disk_below_the_threshold_it_still_cleans(host):
    done, payload = run_clean(host, disk_pct=2)
    assert "rc=0" in done.stdout, done.stderr
    assert set(removed(host)) == EXPECTED_REMOVED
    assert not (host.state / "disk_low_called").exists(), "the cleaning asked the disk check"
    assert payload["imagePrune"]["removed"] == 3


def test_the_real_disk_check_calls_this_disk_low_but_the_cleaning_never_asks(host):
    # Real disk functions at 2% free: the check IS low (so an upgrade would be
    # refused), and the cleaning still ran without consulting it.
    real = "\n".join(wrapper_function(n) for n in DISK_FUNCTIONS)
    before = (wrapper_constants() + real +
              '\nJHT_HOME_HOST="$STATE"; disk_low; echo "DISK_LOW_RC=$?"\n')
    done, _ = run_clean(host, disk_pct=2, before=before)
    assert "DISK_LOW_RC=0" in done.stdout, done.stdout + done.stderr   # the real check says "low"
    assert set(removed(host)) == EXPECTED_REMOVED


def test_the_handler_never_refers_to_the_disk_check():
    body = wrapper_function("handle_clean_images")
    for forbidden in ("disk_low", "disk_level_of", "disk_free_measure", "DISK_"):
        assert forbidden not in body, forbidden


def test_the_handler_starts_nothing():
    body = wrapper_function("handle_clean_images") + wrapper_function("clean_images_previous")
    for forbidden in ("ensure_up", "require_docker", " up -d", "machine start", "docker start", "compose",
                      "docker info", "docker run", "image pull", "docker pull", "image prune", "system prune", "rmi", "volume",
                      "--force", " -f "):
        assert forbidden not in body, forbidden


def test_the_dispatcher_arm_runs_the_handler_and_exits_with_its_code():
    text = wrapper_text()
    arm = text[text.index("  clean-images)"):]
    arm = arm[: arm.index("    ;;")]
    assert "handle_clean_images" in arm and "exit $?" in arm
    for forbidden in ("ensure_up", "require_docker", "require_compose_file", "disk_low", "compose up"):
        assert forbidden not in arm, forbidden


def test_the_command_is_in_the_local_help_and_the_upgrade_still_refuses_below_the_threshold():
    text = wrapper_text()
    assert "jht clean-images [--json]" in text
    assert "upgrade|clean-images|logs" in text          # host command: its help stays local
    upgrade = wrapper_function("handle_runtime_upgrade")
    assert "if disk_low; then" in upgrade
    refusal = upgrade[upgrade.index("if disk_low; then"):]
    refusal = refusal[: refusal.index("\n  fi\n")]
    assert "upgrade_prune_old_images" not in refusal and "clean_images" not in refusal
    assert "jht clean-images" in refusal    # the refusal sentence tells the user the way out


# ── Doubt means keeping everything ───────────────────────────────────────────


@pytest.mark.parametrize("env, reason", [
    ({"FAKE_CONTAINERS_FAIL": "1"}, "containers-unreadable"),
    ({"FAKE_IMAGES_FAIL": "1"}, "previous-unidentified"),   # the listing is read first for the dates
    ({"FAKE_CREATED_FAIL": NEWEST}, "previous-unidentified"),
    ({"FAKE_CREATED_OVERRIDE": "2026-10-05T10:00:00+02:00"}, "previous-unidentified"),   # not UTC
    ({"FAKE_CREATED_OVERRIDE": "yesterday"}, "previous-unidentified"),
    ({"FAKE_CREATED_OVERRIDE": ""}, "previous-unidentified"),
    ({"JHT_KEEP_OLD_IMAGES": "1"}, "opt-out"),
])
def test_doubt_removes_nothing(host, env, reason):
    done, payload = run_clean(host, extra_env=env)
    assert "rc=0" in done.stdout, done.stderr
    assert payload["imagePrune"]["skipped"] == reason
    untouched(host)
    if reason == "opt-out":
        assert engine_calls(host) == [], "the opt-out must not even ask the engine"


def test_without_a_running_container_nothing_is_removed(host):
    done, payload = run_clean(host, running=None)
    assert payload["imagePrune"]["skipped"] == "current-unidentified"
    assert "jht up" in payload["message"]
    untouched(host)


def test_a_running_image_that_is_not_in_the_list_removes_nothing_odd(host):
    # The current is not among the JHT images: every JHT image becomes a candidate,
    # but the newest is still the "previous" and the containers' images stay.
    done, payload = run_clean(host, running="9999" * 16)
    assert "rc=0" in done.stdout, done.stderr
    assert CURRENT in remaining_ids(host) and IN_USE in remaining_ids(host)


def test_an_engine_that_is_not_running_is_not_started(host):
    done, payload = run_clean(host, reachable=False)
    assert "rc=1" in done.stdout
    assert payload["ok"] is False
    assert engine_calls(host) == []
    untouched(host)


def test_a_missing_runtime_removes_nothing(host):
    (host.state / "runtime").rmdir()
    done, payload = run_clean(host)
    assert payload["imagePrune"]["skipped"] == "runtime-not-installed"
    assert engine_calls(host) == []


def test_an_upgrade_in_progress_blocks_it_and_its_lock_is_left_alone(host):
    lock = host.state / "runtime" / ".upgrade.lock"
    lock.mkdir()
    (lock / "pid").write_text(f"{os.getpid()}\n")       # a live process holds it
    done, payload = run_clean(host)
    assert payload["imagePrune"]["skipped"] == "upgrade-in-progress"
    assert lock.is_dir() and (lock / "pid").read_text().strip() == str(os.getpid())
    assert engine_calls(host) == []


def test_an_interrupted_upgrade_blocks_it_because_the_rollback_needs_the_old_image(host):
    (host.state / "runtime" / ".upgrade-journal").write_text("candidate_started\n")
    done, payload = run_clean(host)
    assert payload["imagePrune"]["skipped"] == "upgrade-pending"
    assert "jht upgrade" in payload["message"]
    assert engine_calls(host) == []
    assert not (host.state / "runtime" / ".upgrade.lock").exists(), "its own lock is released"


def test_its_own_lock_is_released_at_the_end(host):
    run_clean(host)
    assert not (host.state / "runtime" / ".upgrade.lock").exists()


def test_an_unknown_option_is_refused_with_code_2(host):
    done, _ = run_clean(host, args="--all")
    assert "rc=2" in done.stdout
    assert engine_calls(host) == []


def test_plain_output_says_what_it_did(host):
    done, _ = run_clean(host, args="")
    assert "NOTE: Immagini JHT vecchie: rimosse 3" in done.stdout


# ── The shared cleaning also protects an ID with a non-JHT name after an upgrade ──


def test_the_cleaning_after_an_upgrade_keeps_an_id_that_also_carries_a_foreign_name(host):
    script = (
        'STATE="$FAKE_STATE"\nUPGRADE_PRUNE_JSON=\n' + wrapper_constants()
        + 'upgrade_note() { :; }\n'
        + f'upgrade_image() {{ echo "{sha(host, CURRENT)}"; }}\n'
        + "\n".join(wrapper_function(n) for n in FUNCTIONS[:5])
        + f'\nupgrade_prune_old_images "{sha(host, CURRENT)}" "{sha(host, NEWEST)}"\n'
    )
    subprocess.run(["bash", "-c", script], env=host.env, capture_output=True, text=True, timeout=60)
    assert MULTI in remaining_ids(host) and MULTI not in removed(host)
    assert set(removed(host)) == EXPECTED_REMOVED
