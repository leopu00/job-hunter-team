"""`jht upgrade` on an install of the core image, with the full one maybe already downloaded (P7).

An install at the `core` level (the `runtime-tier` file) runs the core image; `jht tools` pulls the full one in the background and
switches to it when the onboarding has closed. The upgrade has to know both. The real functions of scripts/jht-wrapper.sh run against a
stateful fake `docker` on PATH (never an engine), with fake digests. Checked:

- the core image the upgrade goes to is the one the CANDIDATE wrapper names, not the one of the wrapper that runs;
- a release with no core, or with a malformed digest, is refused before anything is downloaded;
- the full image is pulled only when the one of today is already here, and a failed pull keeps the old one and does not fail;
- the pruning of old images keeps the full image that waits for the switch, and drops the old full once the new one is here;
- an install with no tier file is pruned exactly as before;
- the upgrade reads the plan before the pull, uses the core image for pull, start and verification, and pulls the full one after
  the commit and before the pruning.

Run with: pytest tests/test_upgrade_core_and_full_images.py -v
"""

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
SOURCE = WRAPPER.read_text(encoding="utf-8")

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the wrapper is a POSIX script")

OLD_CORE = "sha256:" + "1" * 64
NEW_CORE = "sha256:" + "2" * 64
OLD_FULL = "sha256:" + "3" * 64
NEW_FULL = "sha256:" + "4" * 64
REPO = "ghcr.io/leopu00/jht"
ID_OLD_CORE, ID_NEW_CORE, ID_OLD_FULL, ID_NEW_FULL = "a1" * 32, "a2" * 32, "a3" * 32, "a4" * 32
ID_ANCIENT, ID_OTHER = "a5" * 32, "a6" * 32

# Images: id, repository, nominal size. Refs: "<reference> <id>" (what a pull by digest makes).
FAKE_DOCKER = r"""#!/bin/sh
printf '%s\n' "$*" >> "$FAKE_STATE/calls.log"
img="$FAKE_STATE/images"; refs="$FAKE_STATE/refs"
id_of() { awk -v r="$1" '$1 == r { print $2 }' "$refs" | head -n 1; }
case "$1 $2" in
  "image inspect")
    shift 2
    fmt=""; [ "$1" = --format ] && { fmt="$2"; shift 2; }
    id="$(id_of "$1")"; [ -n "$id" ] || id="$(awk -v i="${1#sha256:}" '$1 == i { print $1 }' "$img")"
    [ -n "$id" ] || exit 1
    [ "$fmt" = "{{.Id}}" ] && printf 'sha256:%s\n' "$id"
    [ "$fmt" = "{{.Size}}" ] && awk -v i="$id" '$1 == i { print $3 }' "$img"
    exit 0 ;;
  "image ls") while read -r id repo size; do printf 'sha256:%s %s\n' "$id" "$repo"; done < "$img" ;;
  "image rm")
    id="${3#sha256:}"
    grep -v "^$id " "$img" > "$img.new"; mv "$img.new" "$img"
    printf 'RM %s\n' "$id" >> "$FAKE_STATE/removed.log" ;;
  "container ls") : ;;
  "pull "*|"pull")
    [ ! -f "$FAKE_STATE/pull-fails" ] || exit 1
    id="$(awk -v r="$2" '$1 == r { print $2 }' "$FAKE_STATE/pull-result" | head -n 1)"
    [ -n "$id" ] || exit 1
    printf '%s %s\n' "$2" "$id" >> "$refs"
    grep -q "^$id " "$img" || printf '%s %s 100\n' "$id" "ghcr.io/leopu00/jht" >> "$img" ;;
  *) exit 97 ;;
esac
"""


def function(name: str) -> str:
    match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", SOURCE, re.S | re.M)
    assert match, name
    return match.group(0)


class Host:
    def __init__(self, tmp_path: Path, tier: bool) -> None:
        self.dir = tmp_path
        bins = tmp_path / "bin"
        bins.mkdir()
        (bins / "docker").write_text(FAKE_DOCKER)
        (bins / "docker").chmod(0o755)
        self.state = tmp_path / "state"
        self.state.mkdir()
        self.runtime = tmp_path / "runtime"
        self.runtime.mkdir()
        if tier:
            (self.runtime / "runtime-tier").write_text("core\n")
        self.env = {**os.environ, "PATH": f"{bins}:{os.environ['PATH']}", "FAKE_STATE": str(self.state)}
        (self.state / "pull-result").write_text(f"{REPO}@{NEW_FULL} {ID_NEW_FULL}\n")
        self.set_images([(ID_OLD_CORE, 10), (ID_NEW_CORE, 10), (ID_OLD_FULL, 100), (ID_ANCIENT, 100), (ID_OTHER, 100)],
                        {f"{REPO}@{OLD_CORE}": ID_OLD_CORE, f"{REPO}@{NEW_CORE}": ID_NEW_CORE, f"{REPO}@{OLD_FULL}": ID_OLD_FULL})

    def set_images(self, images, refs) -> None:
        (self.state / "images").write_text("".join(
            f"{i} {'postgres' if i == ID_OTHER else REPO} {size}\n" for i, size in images))
        (self.state / "refs").write_text("".join(f"{ref} {i}\n" for ref, i in refs.items()))

    def candidate(self, core: str | None, full: str | None = NEW_FULL, line_core: str | None = None) -> Path:
        path = self.dir / "candidate-wrapper.sh"
        path.write_text(
            "#!/usr/bin/env bash\n"
            f'DEFAULT_RUNTIME_IMAGE="{REPO}@{full}"\n'
            + (line_core if line_core is not None else f'CORE_IMAGE_DIGEST="{core or ""}"\n'))
        return path

    def run(self, body: str, names: tuple[str, ...]) -> subprocess.CompletedProcess[str]:
        script = (
            "set -u\n"
            f'RUNTIME_TIER_FILE="{self.runtime}/runtime-tier"\n'
            f'DEFAULT_RUNTIME_IMAGE="{REPO}@{OLD_FULL}"\n'
            'upgrade_note() { echo "NOTE: $*"; }\nupgrade_run() { "$@" >/dev/null 2>&1; }\n'
            + "\n".join(function(n) for n in names) + "\n" + body
        )
        return subprocess.run(["bash", "-c", script], env=self.env, capture_output=True, text=True, timeout=30)

    def removed(self) -> set:
        path = self.state / "removed.log"
        return {line.split()[1] for line in path.read_text().splitlines()} if path.exists() else set()

    def calls(self) -> list:
        path = self.state / "calls.log"
        return path.read_text().splitlines() if path.exists() else []


PLAN = ("upgrade_candidate_constant", "upgrade_tier_plan")
PULL = PLAN + ("upgrade_pull_full",)
KEEP = ("upgrade_image_plain", "upgrade_tier_keep_ids")


def test_the_core_the_upgrade_goes_to_is_the_one_the_candidate_wrapper_names(tmp_path):
    host = Host(tmp_path, tier=True)
    done = host.run(f'upgrade_tier_plan "{host.candidate(NEW_CORE)}"; echo "rc=$? core=$UPGRADE_CORE_REF full=$UPGRADE_FULL_REF"', PLAN)
    # the full image of today (OLD_FULL) is here, so the candidate's full one is named too
    assert done.stdout.strip() == f"rc=0 core={REPO}@{NEW_CORE} full={REPO}@{NEW_FULL}"


def test_without_a_tier_file_nothing_is_planned(tmp_path):
    host = Host(tmp_path, tier=False)
    done = host.run(f'upgrade_tier_plan "{host.candidate(NEW_CORE)}"; echo "rc=$? core=[$UPGRADE_CORE_REF] full=[$UPGRADE_FULL_REF]"', PLAN)
    assert done.stdout.strip() == "rc=0 core=[] full=[]"
    assert host.calls() == []


def test_the_full_image_is_named_only_when_the_one_of_today_is_already_here(tmp_path):
    host = Host(tmp_path, tier=True)
    host.set_images([(ID_OLD_CORE, 10), (ID_NEW_CORE, 10)], {f"{REPO}@{OLD_CORE}": ID_OLD_CORE, f"{REPO}@{NEW_CORE}": ID_NEW_CORE})
    done = host.run(f'upgrade_tier_plan "{host.candidate(NEW_CORE)}"; echo "rc=$? core=$UPGRADE_CORE_REF full=[$UPGRADE_FULL_REF]"', PLAN)
    assert done.stdout.strip() == f"rc=0 core={REPO}@{NEW_CORE} full=[]"


@pytest.mark.parametrize("line_core", [
    'CORE_IMAGE_DIGEST=""\n',                                  # a release with no core: a core install is reinstalled, not turned half way
    'CORE_IMAGE_DIGEST="sha256:abc"\n',                        # malformed
    'CORE_IMAGE_DIGEST="sha256:' + "G" * 64 + '"\n',         # not hex
    'CORE_IMAGE_DIGEST="' + "2" * 64 + '"\n',                  # no prefix
    "# no such line\n",
], ids=["empty", "short", "not-hex", "no-prefix", "absent"])
def test_a_candidate_without_a_valid_core_is_refused_before_anything_is_downloaded(tmp_path, line_core):
    host = Host(tmp_path, tier=True)
    done = host.run(f'upgrade_tier_plan "{host.candidate(None, line_core=line_core)}"; echo "rc=$?"', PLAN)
    assert done.stdout.strip() == "rc=1"
    assert not [call for call in host.calls() if call.startswith("pull")]


def test_a_malformed_full_digest_in_the_candidate_is_refused(tmp_path):
    host = Host(tmp_path, tier=True)
    path = host.candidate(NEW_CORE)
    path.write_text(path.read_text().replace(f"@{NEW_FULL}", "@latest"))
    assert host.run(f'upgrade_tier_plan "{path}"; echo "rc=$?"', PLAN).stdout.strip() == "rc=1"


def test_the_new_full_image_is_pulled_by_digest_after_the_core_and_kept(tmp_path):
    host = Host(tmp_path, tier=True)
    done = host.run(f'upgrade_tier_plan "{host.candidate(NEW_CORE)}"; upgrade_pull_full; echo "rc=$? keep=$UPGRADE_FULL_KEEP"', PULL)
    assert done.stdout.strip().endswith(f"rc=0 keep={REPO}@{NEW_FULL}"), done.stdout
    assert f"pull {REPO}@{NEW_FULL}" in host.calls()


def test_a_full_pull_that_fails_keeps_the_old_full_image_and_does_not_fail_the_upgrade(tmp_path):
    host = Host(tmp_path, tier=True)
    (host.state / "pull-fails").write_text("")
    done = host.run(f'upgrade_tier_plan "{host.candidate(NEW_CORE)}"; upgrade_pull_full; echo "rc=$? keep=[$UPGRADE_FULL_KEEP]"', PULL)
    assert "rc=0 keep=[]" in done.stdout
    assert "full_pull_failed" in done.stdout


def test_a_full_image_with_the_same_digest_is_not_pulled_again(tmp_path):
    host = Host(tmp_path, tier=True)
    done = host.run(f'upgrade_tier_plan "{host.candidate(NEW_CORE, full=OLD_FULL)}"; upgrade_pull_full; echo "keep=$UPGRADE_FULL_KEEP"', PULL)
    assert done.stdout.strip() == f"keep={REPO}@{OLD_FULL}"
    assert not [call for call in host.calls() if call.startswith("pull")]


def test_no_full_image_here_means_nothing_to_pull(tmp_path):
    host = Host(tmp_path, tier=True)
    host.set_images([(ID_OLD_CORE, 10)], {f"{REPO}@{OLD_CORE}": ID_OLD_CORE})
    done = host.run(f'upgrade_tier_plan "{host.candidate(NEW_CORE)}"; upgrade_pull_full; echo "keep=[$UPGRADE_FULL_KEEP]"', PULL)
    assert done.stdout.strip() == "keep=[]"
    assert not [call for call in host.calls() if call.startswith("pull")]


def keep_ids(host: Host, keep: str = "") -> list:
    done = host.run(f'UPGRADE_FULL_KEEP="{keep}"; upgrade_tier_keep_ids', KEEP)
    return done.stdout.split()


def test_a_core_install_keeps_the_full_image_that_waits_for_the_switch(tmp_path):
    assert keep_ids(Host(tmp_path, tier=True)) == [ID_OLD_FULL]


def test_the_new_full_image_is_the_one_kept_once_it_is_here(tmp_path):
    host = Host(tmp_path, tier=True)
    host.set_images([(ID_OLD_CORE, 10), (ID_NEW_CORE, 10), (ID_OLD_FULL, 100), (ID_NEW_FULL, 100)],
                    {f"{REPO}@{OLD_FULL}": ID_OLD_FULL, f"{REPO}@{NEW_FULL}": ID_NEW_FULL})
    assert keep_ids(host, f"{REPO}@{NEW_FULL}") == [ID_NEW_FULL]


def test_an_install_with_no_tier_file_keeps_no_full_image_apart(tmp_path):
    assert keep_ids(Host(tmp_path, tier=False)) == []


def test_no_full_image_here_keeps_nothing_apart(tmp_path):
    host = Host(tmp_path, tier=True)
    host.set_images([(ID_OLD_CORE, 10)], {f"{REPO}@{OLD_CORE}": ID_OLD_CORE})
    assert keep_ids(host) == []


# ── the pruning with the two images ───────────────────────────────────────

PRUNE = ("upgrade_image_plain", "upgrade_repo_is_jht", "upgrade_foreign_image_ids", "upgrade_prune_result", "upgrade_tier_keep_ids",
         "upgrade_prune_old_images")


def prune(host: Host, keep: str = "") -> set:
    (host.state / "containers").write_text("")
    body = (
        'JHT_IMAGE_REPOSITORIES="ghcr.io/leopu00/jht jht localhost/jht"; UPGRADE_PRUNE_JSON=""\n'
        f'upgrade_image() {{ echo "sha256:{ID_NEW_CORE}"; }}\nUPGRADE_FULL_KEEP="{keep}"\n'
        f'upgrade_prune_old_images "sha256:{ID_NEW_CORE}" "sha256:{ID_OLD_CORE}"; echo "rc=$?"\n'
    )
    done = host.run(body, PRUNE)
    assert "rc=0" in done.stdout, done.stdout + done.stderr
    return host.removed()


def test_the_pruning_of_a_core_install_removes_the_ancient_image_and_keeps_the_core_and_the_full_one(tmp_path):
    # current core, previous core and the full image of today stay; the ancient one goes; the foreign one is not ours
    assert prune(Host(tmp_path, tier=True)) == {ID_ANCIENT}


def test_the_old_full_image_goes_once_the_new_one_is_here(tmp_path):
    host = Host(tmp_path, tier=True)
    host.set_images([(ID_OLD_CORE, 10), (ID_NEW_CORE, 10), (ID_OLD_FULL, 100), (ID_NEW_FULL, 100), (ID_ANCIENT, 100)],
                    {f"{REPO}@{OLD_FULL}": ID_OLD_FULL, f"{REPO}@{NEW_FULL}": ID_NEW_FULL})
    assert prune(host, f"{REPO}@{NEW_FULL}") == {ID_OLD_FULL, ID_ANCIENT}


def test_an_install_with_no_tier_file_is_pruned_as_before_the_full_image_is_just_an_old_one(tmp_path):
    assert prune(Host(tmp_path, tier=False)) == {ID_OLD_FULL, ID_ANCIENT}


# ── how the upgrade uses them ─────────────────────────────────────────────

def upgrade_body() -> str:
    return function("handle_runtime_upgrade")


def test_the_plan_is_read_before_the_pull_and_the_core_image_is_the_one_of_the_whole_upgrade():
    body = upgrade_body()
    plan = body.index('upgrade_tier_plan "$candidate_wrapper"')
    assert body.index('export JHT_IMAGE="$UPGRADE_CORE_REF"') > plan
    assert body.index("pull \"$CONTAINER_SERVICE\"") > body.index('export JHT_IMAGE="$UPGRADE_CORE_REF"')
    assert body.index("up -d --force-recreate \"$CONTAINER_SERVICE\"") > body.index('export JHT_IMAGE="$UPGRADE_CORE_REF"')
    # a release with no usable core stops at the preflight: nothing downloaded, nothing changed
    assert body.index("pull \"$CONTAINER_SERVICE\"") > body.index("Il rilascio non porta un nucleo valido")


def test_the_full_image_is_pulled_after_the_commit_and_before_the_pruning_never_on_a_check():
    body = upgrade_body()
    commit = body.index('phase="commit"')
    pull_full = body.index("upgrade_pull_full")
    assert commit < pull_full < body.index('upgrade_prune_old_images "$candidate_image" "$old_image"')
    assert body.count("upgrade_pull_full") == 1
    assert pull_full > body.index('if [ "$check_only" = "1" ]')
