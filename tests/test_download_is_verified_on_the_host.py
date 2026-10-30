"""`jht download` takes the release and checks its SHA-256 on the host, in a folder the agents cannot write.

It used to download and verify inside the container and then copy the verified bytes to the host (docker cp, no check), or leave
them in /jht_user/downloads, which the agents write: an agent could hand the person an installer other than the one that was
verified. Now the host fetches SHA256SUMS and the installer itself, compares the hash in a private folder outside the mounts and
publishes the file only after, to a folder that is not shared with the team. The container is not part of the command.
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
ASSET = "job-hunter-team-linux-x64.AppImage"
BYTES = b"the installer the release published"
SUM = hashlib.sha256(BYTES).hexdigest()


class _Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D401 - silence
        pass


@pytest.fixture()
def site(tmp_path: Path):
    root = tmp_path / "site"
    (root / "v0.3.5").mkdir(parents=True)
    (root / "v0.3.5" / ASSET).write_bytes(BYTES)
    (root / "v0.3.5" / "job-hunter-team-linux-x64.deb").write_bytes(b"deb bytes")
    (root / "v0.3.5" / "SHA256SUMS").write_text(
        f"{SUM}  {ASSET}\n{hashlib.sha256(b'deb bytes').hexdigest()} *job-hunter-team-linux-x64.deb\n", encoding="utf-8")
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(_Quiet, directory=str(root)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield type("Site", (), {"url": f"http://127.0.0.1:{server.server_port}", "root": root / "v0.3.5"})
    server.shutdown()
    server.server_close()


def _run(tmp_path: Path, site, *args: str, **extra: str):
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir(exist_ok=True)
    calls = tmp_path / "docker-calls"
    docker = fake_bin / "docker"
    docker.write_text(f'#!/bin/sh\necho "$*" >> "{calls}"\nexit 0\n', encoding="utf-8")
    docker.chmod(0o755)
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    runtime = runtime.resolve()
    (runtime / "docker-compose.yml").write_text("services:\n  jht:\n    image: example.invalid/jht\n", encoding="utf-8")
    host_setup = runtime / "host-setup.sh"
    host_setup.write_text("#!/usr/bin/env bash\nJHT_HOST_SETUP_PROTOCOL=1\nexit 0\n", encoding="utf-8")
    host_setup.chmod(0o700)
    (runtime / ".runtime-integrity").write_text(
        f"version=1\ndocker-compose.yml={hashlib.sha256((runtime / 'docker-compose.yml').read_bytes()).hexdigest()}\n"
        f"host-setup.sh={hashlib.sha256(host_setup.read_bytes()).hexdigest()}\n"
        f"jht-wrapper.sh={hashlib.sha256(WRAPPER.read_bytes()).hexdigest()}\n", encoding="utf-8")
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    tmpdir = tmp_path / "tmp"
    tmpdir.mkdir(exist_ok=True)
    env = {**os.environ, "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}", "HOME": str(home), "TMPDIR": str(tmpdir),
           "JHT_RUNTIME_DIR": str(runtime), "JHT_COMPOSE_FILE": str(runtime / "docker-compose.yml"),
           "JHT_RELEASE_BASE_URL": site.url, **extra}
    done = subprocess.run(["bash", str(WRAPPER), "download", *args], env=env, capture_output=True, text=True, timeout=60, check=False)
    return done, home, tmpdir, calls


def _asset_args(output: Path | None = None, *more: str):
    return ("--os", "linux", "--version", "0.3.5", *( ("--output", str(output)) if output else () ), *more)


def _clean(tmp_path: Path, tmpdir: Path, *folders: Path):
    assert list(tmpdir.iterdir()) == [], "a private download folder was left in TMPDIR"
    for folder in folders:
        assert not [p for p in folder.iterdir() if ".part" in p.name]


def test_the_installer_is_checked_on_the_host_and_saved_where_it_was_asked(tmp_path: Path, site):
    out = tmp_path / "chosen" / "client.AppImage"
    done, home, tmpdir, calls = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 0, done.stderr
    assert out.read_bytes() == BYTES
    assert SUM in done.stdout
    assert not calls.exists(), "the container was involved: " + (calls.read_text() if calls.exists() else "")
    _clean(tmp_path, tmpdir, out.parent)


def test_by_default_it_goes_to_the_downloads_folder_of_the_person_not_to_a_shared_one(tmp_path: Path, site):
    done, home, tmpdir, calls = _run(tmp_path, site, *_asset_args())
    assert done.returncode == 0, done.stderr
    assert (home / "Downloads" / ASSET).read_bytes() == BYTES
    assert not (home / "Documents").exists() and not (home / ".jht").exists()
    assert not calls.exists()


def test_the_deb_is_chosen_by_its_flag_and_its_sum_may_be_starred(tmp_path: Path, site):
    done, home, _, _ = _run(tmp_path, site, *_asset_args(None, "--deb"))
    assert done.returncode == 0, done.stderr
    assert (home / "Downloads" / "job-hunter-team-linux-x64.deb").read_bytes() == b"deb bytes"


def test_a_wrong_hash_saves_nothing_and_leaves_nothing(tmp_path: Path, site):
    (site.root / "SHA256SUMS").write_text(f"{'0' * 64}  {ASSET}\n", encoding="utf-8")
    out = tmp_path / "out" / "client.AppImage"
    done, home, tmpdir, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and "SHA-256 non valido" in done.stderr
    assert not out.exists()
    _clean(tmp_path, tmpdir, out.parent)


def test_the_bytes_that_are_not_the_ones_in_the_sums_are_refused(tmp_path: Path, site):
    (site.root / ASSET).write_bytes(b"a different installer")
    out = tmp_path / "out" / "client.AppImage"
    done, _, tmpdir, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and not out.exists()
    _clean(tmp_path, tmpdir, out.parent)


def test_missing_sums_or_a_missing_asset_fail_and_leave_nothing(tmp_path: Path, site):
    out = tmp_path / "out" / "client.AppImage"
    (site.root / "SHA256SUMS").unlink()
    done, _, tmpdir, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and not out.exists()
    (site.root / "SHA256SUMS").write_text(f"{SUM}  {ASSET}\n", encoding="utf-8")
    (site.root / ASSET).unlink()
    done, _, tmpdir, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and not out.exists()
    _clean(tmp_path, tmpdir, out.parent)


def test_an_asset_that_is_not_in_the_sums_is_refused(tmp_path: Path, site):
    (site.root / "SHA256SUMS").write_text(f"{SUM}  something-else.AppImage\n", encoding="utf-8")
    done, home, _, _ = _run(tmp_path, site, *_asset_args())
    assert done.returncode == 1 and "non trovato" in done.stderr
    assert not (home / "Downloads").exists() or list((home / "Downloads").iterdir()) == []


def test_an_existing_file_with_the_same_hash_is_kept_and_a_different_one_is_not_overwritten(tmp_path: Path, site):
    out = tmp_path / "out" / "client.AppImage"
    out.parent.mkdir()
    out.write_bytes(BYTES)
    done, _, _, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 0 and "gia' presente e verificato" in done.stdout
    out.write_bytes(b"keep me")
    done, _, tmpdir, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and out.read_bytes() == b"keep me"
    _clean(tmp_path, tmpdir, out.parent)


def test_a_link_in_place_of_the_destination_is_refused_and_its_target_stays(tmp_path: Path, site):
    target = tmp_path / "victim.txt"
    target.write_bytes(b"mine")
    out = tmp_path / "out" / "client.AppImage"
    out.parent.mkdir()
    out.symlink_to(target)
    done, _, _, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and target.read_bytes() == b"mine" and out.is_symlink()


@pytest.mark.parametrize("shared", (".jht", "Documents/Job Hunter Team", "Documents/Job Hunter Team/downloads"))
def test_a_destination_in_a_folder_shared_with_the_team_is_refused(tmp_path: Path, site, shared: str):
    home = tmp_path / "home"
    (home / shared).mkdir(parents=True)
    out = home / shared / "client.AppImage"
    done, _, _, calls = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and "condivisa con il team" in done.stderr
    assert not out.exists()


def test_a_link_to_a_shared_folder_does_not_hide_the_destination(tmp_path: Path, site):
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True)
    (tmp_path / "elsewhere").mkdir()
    (tmp_path / "elsewhere" / "inside").symlink_to(home / ".jht")
    out = tmp_path / "elsewhere" / "inside" / "client.AppImage"
    done, _, _, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and not (home / ".jht" / "client.AppImage").exists()


@pytest.mark.parametrize("args", (("--os", "linux"), ("--version", "0.3.5"), ("--os", "plan9", "--version", "0.3.5"),
                                  ("--os", "linux", "--version", "x.y"), ("--os", "windows", "--version", "0.3.5", "--deb"),
                                  ("--os", "linux", "--version", "0.3.5", "--nope")))
def test_a_wrong_ask_answers_2_before_any_network(tmp_path: Path, site, args: tuple):
    done, home, _, calls = _run(tmp_path, site, *args, JHT_RELEASE_BASE_URL="http://127.0.0.1:9")
    assert done.returncode == 2, done.stderr
    assert not (home / "Downloads").exists()


@pytest.mark.parametrize("version", ("0.4.0", "0.4.1", "1.0.0"))
def test_windows_is_refused_for_a_release_that_has_no_installer(tmp_path: Path, site, version: str):
    done, home, _, _ = _run(tmp_path, site, "--os", "windows", "--version", version, JHT_RELEASE_BASE_URL="http://127.0.0.1:9")
    assert done.returncode == 1 and "Windows non fa parte" in done.stderr


def test_an_intel_mac_is_refused_before_anything_is_downloaded(tmp_path: Path, site):
    done, home, _, _ = _run(tmp_path, site, "--os", "macos", "--version", "0.3.5", JHT_DOWNLOAD_HOST="darwin-x64",
                            JHT_RELEASE_BASE_URL="http://127.0.0.1:9")
    assert done.returncode == 1 and "Apple silicon" in done.stderr
    assert not (home / "Downloads").exists()


def test_without_the_seam_the_release_is_fetched_over_https_only(tmp_path: Path, site):
    # the real base is github.com over https; an http address is accepted only through JHT_RELEASE_BASE_URL
    source = WRAPPER.read_text(encoding="utf-8")
    body = source[source.index("handle_host_download() {"):source.index("# ── Upgrade runtime")]
    assert 'https://github.com/leopu00/job-hunter-team/releases/download' in body
    assert 'proto="=https"' in body and '[ -z "${JHT_RELEASE_BASE_URL:-}" ] || proto="=https,http"' in body
    assert "docker" not in body, "the container must not be part of the download"
