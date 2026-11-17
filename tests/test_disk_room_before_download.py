"""A download goes only when, after it, the agents keep the disk they need; a setup whose agents refused for the disk is set up.

Giro Mac build8: the Mac had 9.2 GiB free before the installer; after the update the setup ended with «✗ ASSISTENTE — disk_low …
available: 3.9 GiB», the Sentinella and the Capitano refused too, and the installer said the setup had not finished although the
configuration and the budget were saved. The agents refuse under 3% AND under 8 GiB free (cli/src/lib/disk-guard.js, the wrapper's
disk_low). So:

  - the installer, before the pull, removes the old images of JHT that nothing uses (and trims the Mac's machine), counts the image
    of a stopped JHT container as space that comes back, and refuses when what stays free after the download would be under the
    threshold, with how much to free;
  - `jht upgrade` does the same before its pull, keeping the image that runs;
  - `jht up` and `jht setup` clean the old images before the agents start when the disk is already under the threshold;
  - an installer whose setup ended with 3 (set up, the team needs space) says so, never «not set up yet».

Engines, disks and the setup are fakes: nothing real is touched.
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.sh"
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
GIB = 1048576  # KiB

# The engine of the installer: answers from files in $FAKE, writes every call in $FAKE/calls.
FAKE_ENGINE = r"""#!/bin/bash
printf '%s\n' "$*" >> "$FAKE/calls"
[ "$1" = --connection ] && shift 2
case "$1 $2" in
  "image inspect")
    shift 2
    if [ "$1" = --format ]; then
      fmt="$2"; ref="$3"
      case "$fmt" in
        *RootFS*) cat "$FAKE/local-layers" 2>/dev/null; exit 0 ;;
        *Size*) cat "$FAKE/size-$ref" 2>/dev/null || exit 1 ;;
        *RepoTags*) cat "$FAKE/tags-$ref" 2>/dev/null || exit 1 ;;
        *Id*) cat "$FAKE/id-$(printf '%s' "$ref" | tr '/@:' '___')" 2>/dev/null || exit 1 ;;
      esac
      exit 0
    fi
    [ -e "$FAKE/present-$(printf '%s' "$1" | tr '/@:' '___')" ] && exit 0; exit 1 ;;
  "image ls") cat "$FAKE/images" 2>/dev/null; exit 0 ;;
  "image rm") printf '%s\n' "$3" >> "$FAKE/removed"; [ -s "$FAKE/free-after" ] && cp "$FAKE/free-after" "$FAKE/free"; exit 0 ;;
  "container ls") cat "$FAKE/containers" 2>/dev/null; exit 0 ;;
  "container inspect") shift 2; [ "$1" = --format ] && shift 2; cat "$FAKE/container-image-$1" 2>/dev/null || exit 1; exit 0 ;;
  "machine ssh") exit 0 ;;
esac
case "$1" in
  inspect) shift 3; for c in "$@"; do cat "$FAKE/container-image-$c"; done; exit 0 ;;
esac
exit 0
"""

# df -Pk: a disk of 1 TiB (its 3% is above 8 GiB: the 8 GiB decide, as on the Mac of the giro), $FAKE/free KiB free.
FAKE_DF = r"""#!/bin/sh
printf '%s\n' "$2" >> "$FAKE/measured"
[ -s "$FAKE/free" ] || exit 1
printf 'Filesystem 1024-blocks Used Available Capacity Mounted\n/dev/disk 1073741824 1 %s 50%% /\n' "$(cat "$FAKE/free")"
"""

# The registry: absent ($FAKE/registry missing) unless a test builds it, and then it answers the token, the manifests and the blobs
# from files: a test never reaches the network.
FAKE_CURL = r"""#!/bin/sh
for a in "$@"; do url="$a"; done
printf '%s\n' "$url" >> "$FAKE/fetched"
[ -d "$FAKE/registry" ] || exit 22
case "$url" in
  https://ghcr.io/token*) printf '{"token":"t"}' ;;
  https://ghcr.io/v2/leopu00/jht/manifests/*) cat "$FAKE/registry/manifest-${url##*/}" 2>/dev/null || exit 22 ;;
  https://ghcr.io/v2/leopu00/jht/blobs/*) cat "$FAKE/registry/blob-${url##*/}" 2>/dev/null || exit 22 ;;
  *) exit 22 ;;
esac
"""

FULL = "ghcr.io/leopu00/jht@sha256:" + "a" * 64
CORE = "ghcr.io/leopu00/jht@sha256:" + "b" * 64


def _key(ref: str) -> str:
    return ref.replace("/", "_").replace("@", "_").replace(":", "_")


@pytest.fixture()
def installer(tmp_path):
    fake = tmp_path / "fake"
    bin_dir = fake / "bin"
    bin_dir.mkdir(parents=True)
    for name, body in (("podman", FAKE_ENGINE), ("df", FAKE_DF), ("curl", FAKE_CURL)):
        (bin_dir / name).write_text(body, encoding="utf-8")
        (bin_dir / name).chmod(0o755)
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True)

    def run(free_gib, *, os_name="macos", lang="en", **env):
        (fake / "free").write_text(str(int(free_gib * GIB)), encoding="utf-8")
        script = (
            f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\nOS={os_name}\nRUNTIME_CHOICE=podman\nDRY_RUN=0\n'
            f'PODMAN_MACHINE_NAME=jht-podman\nIMAGE="{CORE}"\nFULL_IMAGE="{FULL}"\nRUNTIME_TIER=core\n'
            'check_room_for_download\necho room-ok\n'
        )
        return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=60,
                              env={"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(home), "FAKE": str(fake), "LANG": f"{lang}.UTF-8",
                                   "JHT_MACHINE_OUTPUT": "1", "JHT_RUNTIME_DIR": str(tmp_path / "runtime"), **env})

    def calls():
        path = fake / "calls"
        return path.read_text(encoding="utf-8").splitlines() if path.exists() else []

    def removed():
        path = fake / "removed"
        return path.read_text(encoding="utf-8").splitlines() if path.exists() else []

    return type("Installer", (), {"run": staticmethod(run), "fake": fake, "home": home,
                                  "calls": staticmethod(calls), "removed": staticmethod(removed)})


@pytest.mark.parametrize("os_name", ["macos", "linux"])
def test_with_room_after_the_download_the_install_goes_on_and_removes_nothing(installer, os_name):
    # registry out of reach: the estimates, core 1 GiB + full 5 GiB = 6; 14 - 6 = 8 GiB stay: the agents can start
    done = installer.run(14, os_name=os_name)
    assert done.returncode == 0 and done.stdout.strip().endswith("room-ok"), done.stdout + done.stderr
    assert installer.removed() == []
    assert str(installer.home / ".jht") in (installer.fake / "measured").read_text(encoding="utf-8").splitlines()


def test_on_linux_a_disk_too_small_is_refused_too_and_the_machine_is_never_trimmed(installer):
    done = installer.run(9.2, os_name="linux")
    assert done.returncode == 1 and "JHT_ERROR disk_low" in done.stderr, done.stdout + done.stderr
    assert not any("fstrim" in c for c in installer.calls())


def test_the_disk_of_giro_mac_build8_is_refused_before_anything_is_downloaded(installer):
    done = installer.run(9.2)
    assert done.returncode == 1, done.stdout + done.stderr
    assert "room-ok" not in done.stdout
    assert "JHT_ERROR disk_low" in done.stderr
    assert "disk_low: Job Hunter Team downloads about 6 GiB, and after the download the agents would have less than the 8 GiB of disk they need: 9 GiB are free now. Free at least 5 GiB more" in done.stderr
    assert not any(" pull " in f" {c} " for c in installer.calls()), "pulled on a disk that cannot hold it"


def test_the_refusal_is_in_the_language_of_the_person(installer):
    done = installer.run(9.2, lang="it_IT")
    assert "Job Hunter Team scarica circa 6 GiB, e dopo il download agli agenti resterebbero meno dei 8 GiB di disco che servono: ora ne sono liberi 9. Libera almeno altri 5 GiB" in done.stderr


def test_short_of_room_the_old_unused_images_of_jht_go_first_and_the_disk_is_measured_again(installer):
    fake = installer.fake
    (fake / "images").write_text(
        "sha256:old1 ghcr.io/leopu00/jht\nsha256:old1 ghcr.io/leopu00/jht\nsha256:used ghcr.io/leopu00/jht\n"
        "sha256:shared jht\nsha256:shared ghcr.io/other/thing\nsha256:foreign docker.io/library/postgres\n", encoding="utf-8")
    (fake / "containers").write_text("c1\n", encoding="utf-8")
    (fake / "container-image-c1").write_text("sha256:used\n", encoding="utf-8")
    (fake / "free-after").write_text(str(17 * GIB), encoding="utf-8")
    done = installer.run(12)
    assert done.returncode == 0, done.stdout + done.stderr
    # only the JHT image no container uses, once; never the one in use, one that also has another name, or another repository
    assert installer.removed() == ["old1"]
    assert "--connection jht-podman machine ssh jht-podman sudo fstrim -a" not in installer.calls()  # the machine is trimmed by podman itself
    assert any(c.startswith("machine ssh jht-podman sudo fstrim -a") for c in installer.calls())


def test_the_image_of_a_stopped_jht_container_counts_as_space_that_comes_back(installer):
    fake = installer.fake
    (fake / "container-image-jht").write_text("sha256:build6\n", encoding="utf-8")
    (fake / "tags-sha256:build6").write_text("ghcr.io/leopu00/jht@sha256:cccc\n", encoding="utf-8")
    (fake / "size-sha256:build6").write_text(str(4 * 1024 ** 3), encoding="utf-8")
    # 13 - 6 = 7 GiB alone; with the 4 GiB of the old image that the setup replaces, 11
    done = installer.run(13)
    assert done.returncode == 0, done.stdout + done.stderr
    # an image of another repository in a container named jht is not ours to count
    (fake / "tags-sha256:build6").write_text("docker.io/someone/jht:1\n", encoding="utf-8")
    assert installer.run(13).returncode == 1


def test_images_already_here_need_no_room_and_space_that_cannot_be_measured_refuses_nothing(installer):
    fake = installer.fake
    (fake / f"present-{_key(CORE)}").write_text("", encoding="utf-8")
    (fake / f"present-{_key(FULL)}").write_text("", encoding="utf-8")
    assert installer.run(1).returncode == 0
    (fake / f"present-{_key(FULL)}").unlink()
    (fake / f"present-{_key(CORE)}").unlink()
    done = installer.run(1)
    assert done.returncode == 1
    (fake / "free").unlink()
    script_env = {}
    done = subprocess.run(["bash", "-c", f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\nOS=macos\nRUNTIME_CHOICE=podman\nDRY_RUN=0\n'
                           f'PODMAN_MACHINE_NAME=jht-podman\nIMAGE="{CORE}"\nFULL_IMAGE="{FULL}"\nRUNTIME_TIER=core\ncheck_room_for_download\necho room-ok\n'],
                          capture_output=True, text=True, timeout=60,
                          env={"PATH": f"{fake / 'bin'}:/usr/bin:/bin", "HOME": str(installer.home), "FAKE": str(fake), **script_env})
    assert done.returncode == 0 and "room-ok" in done.stdout, done.stderr


def test_the_estimates_can_be_changed_and_a_value_that_is_not_a_number_keeps_the_default(installer):
    assert installer.run(12, JHT_PULL_CORE_GIB="1", JHT_PULL_FULL_GIB="3").returncode == 0
    assert installer.run(12, JHT_PULL_FULL_GIB="lots").returncode == 1
    assert installer.run(13.9, JHT_PULL_CORE_GIB="x").returncode == 1 and installer.run(14).returncode == 0


# ── the size of the download, read from the registry ──────────────────────────────────────────────────────────────────────────

MIB = 1024 * 1024  # bytes


def _digest(name: str) -> str:
    return "sha256:" + hashlib.sha256(name.encode()).hexdigest()


def _registry(fake: Path, images: dict[str, list[tuple[str, int]]]) -> None:
    """Index -> manifest per platform (amd64 and arm64, plus an attestation that is no platform) -> config with the diff_ids. The
    layers are (name, compressed bytes); the diff_id of a layer is the digest of its name."""
    import json
    reg = fake / "registry"
    reg.mkdir(exist_ok=True)
    for ref, layers in images.items():
        index_digest = ref.split("@", 1)[1]
        entries = [{"mediaType": "application/vnd.oci.image.manifest.v1+json", "digest": _digest("att" + ref), "size": 839,
                    "annotations": {"vnd.docker.reference.type": "attestation-manifest"},
                    "platform": {"architecture": "unknown", "os": "unknown"}}]
        for arch in ("amd64", "arm64"):
            config = _digest(f"config-{arch}-{ref}")
            manifest = _digest(f"manifest-{arch}-{ref}")
            (reg / f"blob-{config}").write_text(json.dumps({"architecture": arch, "rootfs": {
                "type": "layers", "diff_ids": [_digest("diff-" + name) for name, _ in layers]}}), encoding="utf-8")
            (reg / f"manifest-{manifest}").write_text(json.dumps({
                "schemaVersion": 2, "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "config": {"mediaType": "application/vnd.oci.image.config.v1+json", "digest": config, "size": 2000},
                "layers": [{"mediaType": "application/vnd.oci.image.layer.v1.tar+gzip", "digest": _digest("blob-" + name), "size": size}
                           for name, size in layers]}, indent=2), encoding="utf-8")
            entries.insert(0 if arch == "amd64" else len(entries), {
                "mediaType": "application/vnd.oci.image.manifest.v1+json", "digest": manifest, "size": 1000,
                "platform": {"architecture": arch, "os": "linux"}})
        (reg / f"manifest-{index_digest}").write_text(json.dumps({
            "schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json", "manifests": entries}, indent=2), encoding="utf-8")


def _need_kib(installer, **env) -> int:
    script = (f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\nOS=macos\nRUNTIME_CHOICE=podman\nDRY_RUN=0\n'
              f'PODMAN_MACHINE_NAME=jht-podman\nIMAGE="{CORE}"\nFULL_IMAGE="{FULL}"\nRUNTIME_TIER=core\n'
              'set_runtime_engine\ninstaller_download_need_kib\n')
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=60,
                          env={"PATH": f"{installer.fake / 'bin'}:/usr/bin:/bin", "HOME": str(installer.home),
                               "FAKE": str(installer.fake), "JHT_RUNTIME_DIR": str(installer.fake / "runtime"), **env})
    assert done.returncode == 0, done.stderr
    return int(done.stdout.strip())


def test_the_download_is_measured_on_the_layers_of_the_pin_each_once_and_none_already_here(installer):
    # core and full share the base; a layer of the core is already here (an image of before)
    _registry(installer.fake, {CORE: [("base", 100 * MIB), ("node", 200 * MIB)],
                               FULL: [("base", 100 * MIB), ("browser", 800 * MIB)]})
    (installer.fake / "images").write_text("sha256:before ghcr.io/leopu00/jht\n", encoding="utf-8")
    (installer.fake / "local-layers").write_text(_digest("diff-node") + "\n", encoding="utf-8")
    # base + browser = 900 MiB compressed, times 4 on the disk
    assert _need_kib(installer) == 900 * 1024 * 4
    assert not any("attestation" in line for line in (installer.fake / "fetched").read_text(encoding="utf-8").splitlines())
    # with nothing here, the core layer counts too
    (installer.fake / "local-layers").unlink()
    assert _need_kib(installer) == 1100 * 1024 * 4


def test_an_image_the_registry_does_not_describe_takes_the_estimate_and_no_registry_takes_both(installer):
    _registry(installer.fake, {CORE: [("base", 100 * MIB)]})
    assert _need_kib(installer) == 100 * 1024 * 4 + 5 * GIB
    import shutil
    shutil.rmtree(installer.fake / "registry")
    assert _need_kib(installer) == 6 * GIB


def test_the_disk_of_giro_mac_m21_takes_the_pin_of_build9(installer):
    # giro Mac m21: 14.2 GiB free, the estimate of 8 GiB refused it; the pin is 0.27 GiB compressed (core) and 1.08 (full), 0.07
    # of them shared: some 5.1 GiB on the disk, 9 stay, the agents can start
    _registry(installer.fake, {CORE: [("base", 76 * MIB), ("core", 195 * MIB)],
                               FULL: [("base", 76 * MIB), ("full", 1035 * MIB)]})
    done = installer.run(14.2)
    assert done.returncode == 0 and done.stdout.strip().endswith("room-ok"), done.stdout + done.stderr
    assert installer.removed() == []


def test_short_of_room_the_images_of_the_installed_version_stay_and_the_refusal_says_so(installer):
    # giro Mac m21: the team of build8 was stopped, its containers gone; the installer removed the images of build8 too and the
    # person had no version that starts. The version installed is the one the files of the host runtime pin.
    fake = installer.fake
    runtime = fake / "runtime"
    runtime.mkdir()
    full8, core8 = "sha256:" + "8" * 64, "sha256:" + "9" * 64
    (runtime / "jht").write_text(f'DEFAULT_RUNTIME_IMAGE="ghcr.io/leopu00/jht@{full8}"\nCORE_IMAGE_DIGEST="{core8}"\n', encoding="utf-8")
    (fake / f"id-{_key('ghcr.io/leopu00/jht@' + full8)}").write_text("sha256:build8full\n", encoding="utf-8")
    (fake / f"id-{_key('ghcr.io/leopu00/jht@' + core8)}").write_text("build8core\n", encoding="utf-8")
    (fake / "images").write_text("sha256:build8full ghcr.io/leopu00/jht\nsha256:build8core ghcr.io/leopu00/jht\n"
                                 "sha256:build6 ghcr.io/leopu00/jht\n", encoding="utf-8")
    done = installer.run(7.5, JHT_RUNTIME_DIR=str(runtime))
    assert done.returncode == 1 and "JHT_ERROR disk_low" in done.stderr, done.stdout + done.stderr
    assert installer.removed() == ["build6"]
    assert "nothing was downloaded, and the version of Job Hunter Team you have installed was not touched." in done.stderr
    assert "only the old versions" not in done.stderr


def test_on_a_mac_the_room_is_checked_before_the_pull_of_the_machine_and_on_linux_before_the_setup_pulls():
    text = INSTALL.read_text(encoding="utf-8")
    mac = text[text.index("install_podman_macos() {"):text.index("\ninstall_container_runtime() {")]
    assert mac.index("check_room_for_download") < mac.index('jht_phase image_pull\n  "$podman_bin"')
    main = text[text.index("main_docker() {"):text.index("main_native() {")]
    assert '[ "$OS" = macos ] || check_room_for_download' in main
    assert main.index("refuse_running_team") < main.index("check_room_for_download")


# ── the installer after the setup ──────────────────────────────────────────────────────────────────────────────────────────────

def _onboard(tmp_path: Path, status: int, lang: str = "pt_PT"):
    pty = pytest.importorskip("pty")
    master, slave = pty.openpty()
    script = (f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\nDRY_RUN=0\nPAIRING_TOKEN=""\nPATH_READY=1\n'
              f'jht() {{ return {status}; }}\nrc=0; maybe_onboard || rc=$?; echo "rc=$rc"\n')
    try:
        done = subprocess.run(["bash", "-c", script], stdin=slave, capture_output=True, text=True, timeout=60,
                              env={"PATH": "/usr/bin:/bin", "HOME": str(tmp_path), "LANG": f"{lang}.UTF-8",
                                   "JHT_RUNTIME_DIR": str(tmp_path / "runtime")})
    finally:
        os.close(master)
        os.close(slave)
    return done


def test_a_setup_that_ended_with_the_team_short_of_disk_is_said_set_up_not_unfinished(tmp_path):
    done = _onboard(tmp_path, 3)
    assert "rc=3" in done.stdout, done.stdout + done.stderr
    assert "A configuração está concluída e guardada, mas a equipa não arrancou" in done.stdout
    assert "ainda não está configurado" not in done.stdout
    assert "jht team start" in done.stdout


def test_a_setup_that_stopped_is_still_said_unfinished(tmp_path):
    done = _onboard(tmp_path, 1)
    assert "rc=1" in done.stdout
    assert "ainda não está configurado" in done.stdout


# ── the wrapper: `jht upgrade`, and `jht up` / `jht setup` ─────────────────────────────────────────────────────────────────────

def _wrapper_functions(*names: str) -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    return "".join(re.search(rf"(?ms)^{name}\(\) \{{\n.*?^\}}\n", text).group(0) for name in names)


UPGRADE_BASE = (
    "DISK_BLOCK_FREE_PERMILLE=30\nDISK_BLOCK_FREE_KIB=8388608\nUPGRADE_NEED_KIB=0\nUPGRADE_PRUNE_JSON=''\n"
    + _wrapper_functions("pull_need_kib", "disk_download_volumes", "disk_room_after_download", "upgrade_disk_room")
    + r"""
disk_engine_path() { :; }
disk_total_avail() { printf '1073741824 %s' "$(cat "$FAKE/free")"; }
upgrade_prune_old_images() { printf 'prune %s %s json=%s\n' "$1" "$2" "${UPGRADE_JSON:-}" >> "$FAKE/log"; [ -s "$FAKE/free-after" ] && cp "$FAKE/free-after" "$FAKE/free"; UPGRADE_PRUNE_JSON='{"x":1}'; }
upgrade_trim_machine() { printf 'trim\n' >> "$FAKE/log"; }
"""
)


def _upgrade(tmp_path: Path, free_gib: float, body: str, free_after_gib: float | None = None, **env):
    (tmp_path / "free").write_text(str(int(free_gib * GIB)), encoding="utf-8")
    if free_after_gib is not None:
        (tmp_path / "free-after").write_text(str(int(free_after_gib * GIB)), encoding="utf-8")
    script = f'DEFAULT_RUNTIME_IMAGE="{FULL}"\nUPGRADE_CORE_REF=""\nUPGRADE_FULL_REF=""\nJHT_HOME_HOST="{tmp_path}"\n' + UPGRADE_BASE + body
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=60,
                          env={"PATH": "/usr/bin:/bin", "FAKE": str(tmp_path), **env})
    log = (tmp_path / "log").read_text(encoding="utf-8").splitlines() if (tmp_path / "log").exists() else []
    return done, log


def test_an_upgrade_with_room_after_its_download_cleans_nothing(tmp_path):
    done, log = _upgrade(tmp_path, 14, 'upgrade_disk_room sha256:run; echo "rc=$? need=$UPGRADE_NEED_KIB"')
    assert done.stdout.strip() == f"rc=0 need={5 * GIB}" and log == []


def test_an_upgrade_short_of_room_removes_the_old_images_first_keeping_the_running_one_then_measures_again(tmp_path):
    done, log = _upgrade(tmp_path, 10, 'upgrade_disk_room sha256:run; echo "rc=$? prune=$UPGRADE_PRUNE_JSON"', free_after_gib=15)
    assert done.stdout.strip() == "rc=0 prune=", "the prune of the preflight is not the result of the upgrade"
    assert log == ["prune sha256:run sha256:run json=1", "trim"]


def test_an_upgrade_still_short_after_the_cleaning_is_refused(tmp_path):
    done, log = _upgrade(tmp_path, 10, 'upgrade_disk_room sha256:run; echo "rc=$? short=$DISK_ROOM_SHORT_KIB"', free_after_gib=11)
    assert done.stdout.strip() == f"rc=1 short={2 * GIB}"
    assert log == ["prune sha256:run sha256:run json=1", "trim"]


def test_an_upgrade_of_a_stopped_team_cleans_nothing_and_a_core_upgrade_counts_the_core_and_the_new_full(tmp_path):
    done, log = _upgrade(tmp_path, 10, 'upgrade_disk_room none; echo "rc=$?"')
    assert done.stdout.strip() == "rc=1" and log == []
    other = FULL.replace("a" * 64, "c" * 64)
    done, _ = _upgrade(tmp_path, 30, f'UPGRADE_CORE_REF="{CORE}"; UPGRADE_FULL_REF="{other}"; upgrade_disk_room x; echo "$UPGRADE_NEED_KIB"')
    assert done.stdout.strip() == str(6 * GIB)
    done, _ = _upgrade(tmp_path, 30, f'UPGRADE_CORE_REF="{CORE}"; UPGRADE_FULL_REF="{FULL}"; upgrade_disk_room x; echo "$UPGRADE_NEED_KIB"')
    assert done.stdout.strip() == str(1 * GIB), "the full image already pinned is not downloaded again"


def test_the_upgrade_checks_the_room_before_its_pull_and_refuses_with_disk_low():
    text = WRAPPER.read_text(encoding="utf-8")
    start = text.index('[ -z "$UPGRADE_CORE_REF" ] || export JHT_IMAGE="$UPGRADE_CORE_REF"')
    block = text[start:text.index('phase="pull"', start)]
    assert 'if ! upgrade_disk_room "$old_image"; then' in block
    assert '"disk_low" false' in block and "line.upgrade.disk_room" in block


CLEANUP = (
    "DISK_BLOCK_FREE_PERMILLE=30\nDISK_BLOCK_FREE_KIB=8388608\n"
    + _wrapper_functions("pull_need_kib", "disk_download_volumes", "disk_room_after_download", "agents_room_cleanup")
    + r"""
disk_engine_path() { :; }
disk_total_avail() { printf '1073741824 %s' "$(cat "$FAKE/free")"; }
runtime_helper_digest() { echo digest; }
runtime_helper_load() { tools_clean_old_images() { echo cleaned >> "$FAKE/log"; }; }
"""
)


@pytest.mark.parametrize("free_gib,cleaned", [(8.5, False), (7.9, True)])
def test_up_and_setup_clean_the_old_images_before_the_agents_start_only_when_the_disk_is_under_their_threshold(tmp_path, free_gib, cleaned):
    (tmp_path / "free").write_text(str(int(free_gib * GIB)), encoding="utf-8")
    done = subprocess.run(["bash", "-c", f'JHT_HOME_HOST="{tmp_path}"\n' + CLEANUP + "agents_room_cleanup; echo rc=$?"],
                          capture_output=True, text=True, timeout=60, env={"PATH": "/usr/bin:/bin", "FAKE": str(tmp_path)})
    assert done.stdout.strip() == "rc=0", done.stderr
    assert (tmp_path / "log").exists() is cleaned


def test_up_and_setup_run_the_cleaning_before_the_tools_and_the_wizard():
    text = WRAPPER.read_text(encoding="utf-8")
    assert text.count("    agents_room_cleanup\n    tools_tell_person kick\n") == 2
    setup = text[text.index("\n  setup)\n"):]
    setup = setup[:setup.index("\n    ;;\n")]
    assert setup.index("ensure_up") < setup.index("agents_room_cleanup") < setup.index("setup_exec_container")
