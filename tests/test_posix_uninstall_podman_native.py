"""`jht uninstall` on Linux with rootless Podman takes the team away: stopped, and its containers, network, volumes and images removed.

Before, the uninstall looked for the team's project only through Docker (the JHT docker shim is never taken for Docker), so on Linux
with rootless Podman the team kept running and its containers, volumes and images stayed. Now Podman's own project is removed, chosen
as narrowly as Docker's: containers by project AND service label, the network and the volumes by project label AND their exact name
(podman-compose 1.6: <project>_default, <project>_<volume>), images only of JHT's repositories. Nothing else of the person's Podman,
and nothing of a Docker Engine on the same computer that is not JHT's.
"""

from __future__ import annotations

from pathlib import Path

from test_posix_uninstall_wrapper import FAKE_DOCKER, Box, phases

IMAGE_BLOCK = FAKE_DOCKER[FAKE_DOCKER.index("  image)\n"):FAKE_DOCKER.index("  run)\n")]

# Objects: one "<kind> <name> <project> <service>" per line in $FAKE_STATE/objects (project «-» = no compose label).
FAKE_NATIVE_PODMAN = """#!/bin/sh
printf 'podman %s\\n' "$*" >> "$FAKE_LOG"
[ -z "${CONTAINER_HOST:-}${CONTAINER_CONNECTION:-}" ] || { echo "remote podman used" >> "$FAKE_LOG"; exit 66; }
objects="$FAKE_STATE/objects"
touch "$objects"
project_of() { case "$1" in label=com.docker.compose.project=*) printf '%s' "${1#*=*=}" ;; *) exit 93 ;; esac; }
drop() {
  awk -v kind="$1" -v id="$2" '!($1 == kind && $2 == id)' "$objects" > "$objects.new"
  mv "$objects.new" "$objects"
}
case "$1" in
  ps)
    [ "$2:$3:$5" = "-aq:--filter:--filter" ] || exit 94
    project="$(project_of "$4")"
    case "$6" in label=com.docker.compose.service=*) service="${6#*=*=}" ;; *) exit 93 ;; esac
    awk -v p="$project" -v s="$service" '$1 == "container" && $3 == p && $4 == s { print $2 }' "$objects" ;;
  rm) [ "$2:$3:$4" = "-f:-t:30" ] || exit 95; drop container "$5" ;;
  network|volume)
    kind="$1"
    case "$2" in
      ls) [ "$3:$4" = "-q:--filter" ] || exit 96
          project="$(project_of "$5")"
          awk -v k="$kind" -v p="$project" '$1 == k && $3 == p { print $2 }' "$objects" ;;
      rm)
        if [ "$kind" = volume ] && awk -v id="$3" '
            $1 == "volume" && $2 == id { project = $3 }
            $1 == "container" { owners[$3] = 1 }
            END { exit !(project in owners) }' "$objects"; then exit 1; fi
        drop "$kind" "$3" ;;
      *) exit 97 ;;
    esac ;;
""" + IMAGE_BLOCK + """  *) exit 90 ;;
esac
"""

JHT_IMAGE = "sha256:" + "a" * 64


def _box(tmp_path: Path, *, with_docker: bool) -> Box:
    box = Box(tmp_path, "Linux")
    (box.tools / "podman").write_text(FAKE_NATIVE_PODMAN, encoding="utf-8")
    if not with_docker:
        (box.tools / "docker").unlink()
    box.select("podman")
    box.objects(
        "container jht jht jht", "container jht-broker jht jht-broker", "container jht-screen jht jht-screen",
        "network jht_default jht -", "volume jht_jht-deps jht -", "volume jht_jht-secrets jht -",
        # the person's own, in the same Podman: never touched
        "container my-db - -", "volume my-data - -", "volume jht_not-ours jht -", "network other_default other -",
    )
    box.images(f"{JHT_IMAGE} ghcr.io/leopu00/jht 0.4.0", "sha256:" + "b" * 64 + " docker.io/library/postgres 16")
    return box


def _left(box: Box) -> list[str]:
    return sorted((box.state / "objects").read_text(encoding="utf-8").splitlines())


def test_the_team_goes_and_nothing_else_of_the_persons_podman(tmp_path: Path) -> None:
    box = _box(tmp_path, with_docker=False)
    result = box.run("uninstall", "--confirm", CONTAINER_HOST="tcp://elsewhere:1")
    assert result.returncode == 0, result.stdout + result.stderr
    assert _left(box) == sorted(["container my-db - -", "volume my-data - -", "volume jht_not-ours jht -", "network other_default other -"])
    assert (box.state / "images").read_text(encoding="utf-8") == "sha256:" + "b" * 64 + " docker.io/library/postgres 16\n"
    assert "remote podman used" not in box.log.read_text(encoding="utf-8")
    assert "JHT_LEFT" not in result.stdout
    # the data stays without --purge
    assert box.data.read_text(encoding="utf-8") == "keep\n" and box.documents.read_text(encoding="utf-8") == "keep\n"


def test_a_container_that_will_not_go_leaves_the_machine_step_and_says_so(tmp_path: Path) -> None:
    box = _box(tmp_path, with_docker=False)
    # podman refuses every volume removal while a container of the project is there: make one container unremovable
    fake = (box.tools / "podman").read_text(encoding="utf-8").replace(
        '  rm) [ "$2:$3:$4" = "-f:-t:30" ] || exit 95; drop container "$5" ;;',
        '  rm) [ "$2:$3:$4" = "-f:-t:30" ] || exit 95; [ "$5" != jht ] || exit 1; drop container "$5" ;;')
    (box.tools / "podman").write_text(fake, encoding="utf-8")
    result = box.run("uninstall", "--confirm")
    assert result.returncode == 24
    assert "JHT_LEFT machine" in result.stdout
    assert box.runtime.exists()  # the command stays to run it again


def test_with_a_docker_engine_too_only_jht_s_labelled_projects_go_there(tmp_path: Path) -> None:
    box = _box(tmp_path, with_docker=True)
    result = box.run("uninstall", "--confirm")
    assert result.returncode == 0, result.stdout + result.stderr
    calls = box.log.read_text(encoding="utf-8").splitlines()
    def removes(call: str) -> bool:
        words = call.split()
        return words[0] == "docker" and (words[1] == "rm" or (words[1] in ("image", "network", "volume") and words[2] == "rm"))
    docker_mutations = [c for c in calls if removes(c)]
    assert all("ghcr.io/leopu00/jht" in c or c.split()[-1].startswith("jht") for c in docker_mutations), docker_mutations
