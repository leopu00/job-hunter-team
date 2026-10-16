"""`jht upgrade` removes the old JHT images, and only those.

Every upgrade pulls a new image and neither Docker nor Podman ever deletes the
old ones: one host collected 23 of them (tens of GB). After a SUCCESSFUL
upgrade the wrapper keeps the current image and the previous one (the rollback
anchor) and removes the other JHT images by ID. The real functions of
scripts/jht-wrapper.sh run against a stateful fake `docker` on PATH (never an
engine). Checked:

- an upgrade that succeeded leaves only the current and the previous image;
- an image of a repository that is not JHT's (even `ghcr.io/leopu00/jht-other`)
  is never touched;
- an image used by a container, even a stopped one, is kept and counted;
- an engine refusal is counted, not ignored, and the image stays;
- no `-f`, `prune`, `system` or `rmi` is ever issued;
- JHT_KEEP_OLD_IMAGES=1 removes nothing;
- when the current image is not the one that runs, the previous one is unknown
  or the containers cannot be read, nothing is removed;
- the pruning is called once, only after the commit of a successful upgrade,
  never on `--check`, on a failure or on a rollback;
- the JSON contract only gains `imagePrune` after an upgrade that cleaned.

Run with: pytest tests/test_upgrade_image_prune.py -v
"""

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"

CURRENT = "aaaa" * 16
PREVIOUS = "bbbb" * 16
OLD = ["c1c1" * 16, "d2d2" * 16, "e3e3" * 16]
LOCAL_TAG = "f4f4" * 16
OTHER_JHT_REPO = "0a0a" * 16
FOREIGN = "0b0b" * 16
IN_USE = "0c0c" * 16

# id, repository, nominal size in bytes
IMAGES = [
    (CURRENT, "ghcr.io/leopu00/jht", 1000),
    (PREVIOUS, "ghcr.io/leopu00/jht", 1000),
    (OLD[0], "ghcr.io/leopu00/jht", 3 * 1048576),
    (OLD[1], "ghcr.io/leopu00/jht", 5 * 1048576),
    (OLD[2], "ghcr.io/leopu00/jht", 7 * 1048576),
    (LOCAL_TAG, "jht", 2 * 1048576),
    (OTHER_JHT_REPO, "ghcr.io/leopu00/jht-other", 11 * 1048576),
    (FOREIGN, "postgres", 13 * 1048576),
    (IN_USE, "ghcr.io/leopu00/jht", 17 * 1048576),
]

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
    while read -r id repo size; do printf '%s %s\n' "$(printf '%s' "$id" | style)" "$repo"; done < "$FAKE_STATE/images" ;;
  "image inspect")
    id="${5#sha256:}"
    awk -v id="$id" '$1 == id { print $3 }' "$FAKE_STATE/images" ;;
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


def wrapper_function(name: str) -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
    assert match, name
    return match.group(0)


@pytest.fixture(params=["docker", "podman"])
def host(request, tmp_path):
    style = request.param
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(FAKE_DOCKER)
    (bin_dir / "docker").chmod(0o755)
    state = tmp_path / "state"
    state.mkdir()
    (state / "images").write_text("".join(f"{i} {r} {s}\n" for i, r, s in IMAGES))
    # The current image runs; a stopped container holds IN_USE.
    (state / "containers").write_text(f"c0ffee {CURRENT}\nbeef01 {IN_USE}\n")
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}",
           "FAKE_STATE": str(state), "FAKE_STYLE": style}
    return type("H", (), {"state": state, "env": env, "style": style})


def sha(image_id: str, style: str) -> str:
    return image_id if style == "podman" else f"sha256:{image_id}"


def run_prune(host, current=CURRENT, previous=PREVIOUS, running=CURRENT, extra_env=None):
    env = {**host.env, **(extra_env or {})}
    script = (
        'upgrade_note() { echo "NOTE: $*"; }\n'
        f'upgrade_image() {{ echo "{sha(running, host.style) if running else ""}"; }}\n'
        'UPGRADE_PRUNE_JSON=""\n'
        + 'JHT_IMAGE_REPOSITORIES="ghcr.io/leopu00/jht jht localhost/jht"\n'
        + "\n".join(wrapper_function(n) for n in
                   ("upgrade_image_plain", "upgrade_prune_result", "upgrade_prune_old_images"))
        + f'\nupgrade_prune_old_images "{sha(current, host.style) if current else ""}" "{previous if previous in ("none", "sconosciuta", "") else sha(previous, host.style)}"\n'
        'echo "rc=$?"\necho "JSON=$UPGRADE_PRUNE_JSON"\n'
    )
    done = subprocess.run(["bash", "-c", "set -euo pipefail\n" + script], env=env,
                          capture_output=True, text=True, timeout=30)
    payload = next((line[5:] for line in done.stdout.splitlines() if line.startswith("JSON=")), "")
    return done, (json.loads(payload) if payload else None)


def remaining(host) -> set:
    return {line.split()[0] for line in (host.state / "images").read_text().splitlines() if line}


def calls(host) -> list:
    path = host.state / "calls.log"
    return path.read_text().splitlines() if path.exists() else []


# ── A successful upgrade keeps the current and the previous, and nothing else of JHT's ──


def test_only_the_current_and_the_previous_survive_of_the_jht_images(host):
    done, payload = run_prune(host)
    assert "rc=0" in done.stdout, done.stderr
    assert remaining(host) == {CURRENT, PREVIOUS, OTHER_JHT_REPO, FOREIGN, IN_USE}
    assert payload["removed"] == 4          # three old digests and the local jht:* tag
    assert payload["freedBytes"] == (3 + 5 + 7 + 2) * 1048576
    assert payload["inUse"] == 1 and payload["refused"] == 0
    assert payload["kept"] == ["current", "previous"] and payload["skipped"] == ""
    note = next(line for line in done.stdout.splitlines() if line.startswith("NOTE:"))
    assert "rimosse 4" in note and "tenute: corrente, precedente" in note and "17 MB" in note


def test_a_repository_that_is_not_jhts_is_never_touched(host):
    done, _ = run_prune(host)
    assert OTHER_JHT_REPO in remaining(host) and FOREIGN in remaining(host)
    removed = (host.state / "removed.log").read_text()
    assert OTHER_JHT_REPO not in removed and FOREIGN not in removed


def test_an_image_of_a_stopped_container_is_kept_and_counted(host):
    done, payload = run_prune(host)
    assert IN_USE in remaining(host)
    assert payload["inUse"] == 1
    assert "In uso da un container (tenute): 1" in done.stdout


def test_an_engine_refusal_is_counted_and_the_image_stays(host):
    done, payload = run_prune(host, extra_env={"FAKE_REFUSE": OLD[0]})
    assert OLD[0] in remaining(host)
    assert payload["removed"] == 3 and payload["refused"] == 1
    assert "Rifiutate dal motore (tenute): 1" in done.stdout


def test_no_force_no_prune_no_system_no_rmi_ever(host):
    run_prune(host)
    for line in calls(host):
        words = line.split()
        assert "-f" not in words and "--force" not in words, line
        assert "prune" not in words and "system" not in words and "rmi" not in words, line
        assert words[:2] in (["container", "ls"], ["image", "ls"], ["image", "inspect"],
                             ["image", "rm"], ["inspect", "--format"]), line


def test_the_opt_out_removes_nothing_and_asks_the_engine_nothing(host):
    done, payload = run_prune(host, extra_env={"JHT_KEEP_OLD_IMAGES": "1"})
    assert len(remaining(host)) == len(IMAGES)
    assert payload["skipped"] == "opt-out" and payload["removed"] == 0
    assert calls(host) == []


# ── Doubt means keeping everything ──


@pytest.mark.parametrize("env, reason", [
    ({"FAKE_CONTAINERS_FAIL": "1"}, "containers-unreadable"),
    ({"FAKE_IMAGES_FAIL": "1"}, "images-unreadable"),
])
def test_an_unreadable_engine_removes_nothing(host, env, reason):
    done, payload = run_prune(host, extra_env=env)
    assert "rc=0" in done.stdout
    assert len(remaining(host)) == len(IMAGES)
    assert payload["skipped"] == reason
    assert not (host.state / "removed.log").exists()


@pytest.mark.parametrize("kwargs, reason", [
    ({"running": OLD[0]}, "current-not-running"),
    ({"current": "sconosciuta", "running": None}, "current-unidentified"),
    ({"previous": "none"}, "previous-unidentified"),
    ({"previous": "sconosciuta"}, "previous-unidentified"),
])
def test_an_unidentified_current_or_previous_removes_nothing(host, kwargs, reason):
    done, payload = run_prune(host, **kwargs)
    assert "rc=0" in done.stdout, done.stderr
    assert len(remaining(host)) == len(IMAGES)
    assert payload["skipped"] == reason


def test_an_image_listed_under_two_tags_is_removed_once(host):
    with (host.state / "images").open("a") as images:
        images.write(f"{OLD[0]} jht {3 * 1048576}\n")
    done, payload = run_prune(host)
    assert (host.state / "removed.log").read_text().count(OLD[0]) == 1
    assert payload["removed"] == 4


# ── Only a successful upgrade cleans ──


def upgrade_body() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    start = text.index("handle_runtime_upgrade() {")
    return text[start:text.index("\n}\n", start)]


def test_pruning_runs_once_after_the_commit_of_a_successful_upgrade():
    body = upgrade_body()
    assert body.count("upgrade_prune_old_images") == 1
    call = body.index("upgrade_prune_old_images")
    # after every way out of a failed or rolled-back upgrade, and after the commit...
    assert call > body.index('"Metadata runtime non persistiti"')
    assert call > body.index("broker_migrate_legacy_once")
    # ...before the success report, and not on --check
    assert call < body.index('"Nuova versione attiva e verificata"')
    assert call > body.index('if [ "$check_only" = "1" ]')
    # and never inside a branch that restores the previous version
    assert "upgrade_restore_previous" not in body[call - 200:call + 200]


def test_every_other_use_of_the_pruning_is_the_definition():
    text = WRAPPER.read_text(encoding="utf-8")
    uses = [m.start() for m in re.finditer(r"upgrade_prune_old_images", text)]
    assert len(uses) == 2   # the definition and the single call in the upgrade


def test_the_json_contract_gains_image_prune_only_after_a_cleaning_upgrade():
    script = (
        "\n".join(wrapper_function(n) for n in ("upgrade_safe_field", "upgrade_result"))
        + '\nUPGRADE_JSON=1\nUPGRADE_PRUNE_JSON=""\n'
        'upgrade_result false false pull 1 sha256:a 1 sha256:a false "no" false\n'
        'UPGRADE_PRUNE_JSON=\'{"removed":2,"freedBytes":5,"refused":0,"inUse":0,"kept":["current","previous"],"skipped":""}\'\n'
        'upgrade_result true true complete 1 sha256:a 2 sha256:b false "ok" false\n'
    )
    done = subprocess.run(["bash", "-c", "set -euo pipefail\n" + script], capture_output=True,
                          text=True, timeout=30)
    failed, completed = [json.loads(line) for line in done.stdout.splitlines()]
    assert "imagePrune" not in failed
    assert completed["imagePrune"]["removed"] == 2 and completed["ok"] is True
    assert completed["previous"]["image"] == "sha256:a"   # the rest is untouched


# ── The Windows wrapper does the same, with the same rules ──
# (no PowerShell on the Mac that runs this suite: the rules are checked on the text)


def powershell_function(name: str) -> str:
    text = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    start = text.index(f"function {name} ")
    return text[start:text.index("\n}\n", start)]


def test_the_windows_wrapper_prunes_with_the_same_rules():
    body = powershell_function("Remove-OldJhtImages")
    assert "JHT_KEEP_OLD_IMAGES" in body
    text = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    assert "@('ghcr.io/leopu00/jht', 'jht', 'localhost/jht')" in text
    engine_calls = re.findall(r"& docker ([^\n]+)", body)
    assert engine_calls
    for call in engine_calls:
        assert re.match(r"(container ls|inspect|image ls|image inspect|image rm) ", call), call
        assert not re.search(r"(^| )(-f|--force|rmi|prune|system)( |$)", call), call
    assert "image rm $parts[0]" in body
    # unreadable engine or unknown current/previous: nothing removed
    for reason in ("containers-unreadable", "images-unreadable", "current-unidentified",
                   "previous-unidentified", "current-not-running", "opt-out"):
        assert reason in body, reason


def test_the_windows_pruning_runs_once_after_the_commit_and_can_never_undo_the_upgrade():
    text = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    assert len(re.findall(r"Remove-OldJhtImages", text)) == 2   # the definition and the call
    upgrade = powershell_function("Invoke-RuntimeUpgrade")
    call = upgrade.index("Remove-OldJhtImages")
    assert call > upgrade.index("Write-UpgradeJournal 'metadata_committed'")
    assert call > upgrade.index("Remove-UpgradeTransaction\n    # Il broker")
    assert call < upgrade.index("'Nuova versione attiva e verificata'")
    # a pruning error must not reach the catch that rolls the upgrade back
    assert re.search(r"try \{ Remove-OldJhtImages [^\n]*\} catch \{[^\n]*\}", upgrade)
    assert "if ($script:UpgradePrune) { $result['imagePrune']" in powershell_function("Write-UpgradeResult")
