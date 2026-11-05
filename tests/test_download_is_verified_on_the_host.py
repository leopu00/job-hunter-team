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
ASSET = "job-hunter-team-macos-universal.dmg"
BYTES = b"the installer the release published"
SUM = hashlib.sha256(BYTES).hexdigest()


class _Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D401 - silence
        pass


@pytest.fixture()
def site(tmp_path: Path):
    root = tmp_path / "site"
    (root / "v0.4.0").mkdir(parents=True)
    (root / "v0.4.0" / ASSET).write_bytes(BYTES)
    # the sum line may be starred (binary mode), as sha256sum writes it
    (root / "v0.4.0" / "SHA256SUMS").write_text(f"{SUM} *{ASSET}\n", encoding="utf-8")
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(_Quiet, directory=str(root)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield type("Site", (), {"url": f"http://127.0.0.1:{server.server_port}", "root": root / "v0.4.0"})
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
           "JHT_RELEASE_BASE_URL": site.url, "JHT_DOWNLOAD_HOST": "darwin-arm64", **extra}
    done = subprocess.run(["bash", str(WRAPPER), "download", *args], env=env, capture_output=True, text=True, timeout=60, check=False)
    return done, home, tmpdir, calls


def _asset_args(output: Path | None = None, *more: str):
    return ("--os", "macos", "--version", "0.4.0", *( ("--output", str(output)) if output else () ), *more)


def _clean(tmp_path: Path, tmpdir: Path, *folders: Path):
    assert list(tmpdir.iterdir()) == [], "a private download folder was left in TMPDIR"
    for folder in folders:
        assert not [p for p in folder.iterdir() if ".part" in p.name]


def test_the_installer_is_checked_on_the_host_and_saved_where_it_was_asked(tmp_path: Path, site):
    out = tmp_path / "chosen" / "client.dmg"
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


@pytest.mark.parametrize("extra", ((), ("--deb",)))
@pytest.mark.parametrize("version", ("0.4.0", "0.4.1", "0.3.9"))
def test_linux_is_said_to_have_no_desktop_app_in_this_version(tmp_path: Path, site, extra: tuple, version: str):
    # --os linux and --deb still parse, so the answer is the sentence and not «unknown argument»; nothing is fetched
    done, home, _, calls = _run(tmp_path, site, "--os", "linux", "--version", version, *extra, JHT_RELEASE_BASE_URL="http://127.0.0.1:9")
    assert done.returncode == 1, done.stderr
    assert "In this version there is no desktop app for Linux: use install.sh. Nothing was downloaded." in done.stderr
    assert "unknown argument" not in done.stderr
    assert not (home / "Downloads").exists() and not calls.exists()
    (tmp_path / "it").mkdir()
    italian, _, _, _ = _run(tmp_path / "it", site, "--os", "linux", "--version", version, *extra, JHT_RELEASE_BASE_URL="http://127.0.0.1:9", JHT_LANG="it")
    assert italian.returncode == 1 and "non c'e' l'app desktop per Linux: usa install.sh" in italian.stderr


def test_a_wrong_hash_saves_nothing_and_leaves_nothing(tmp_path: Path, site):
    (site.root / "SHA256SUMS").write_text(f"{'0' * 64}  {ASSET}\n", encoding="utf-8")
    out = tmp_path / "out" / "client.dmg"
    done, home, tmpdir, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and "invalid SHA-256 for" in done.stderr
    assert not out.exists()
    _clean(tmp_path, tmpdir, out.parent)


def test_the_bytes_that_are_not_the_ones_in_the_sums_are_refused(tmp_path: Path, site):
    (site.root / ASSET).write_bytes(b"a different installer")
    out = tmp_path / "out" / "client.dmg"
    done, _, tmpdir, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and not out.exists()
    _clean(tmp_path, tmpdir, out.parent)


def test_missing_sums_or_a_missing_asset_fail_and_leave_nothing(tmp_path: Path, site):
    out = tmp_path / "out" / "client.dmg"
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
    assert done.returncode == 1 and "no SHA-256 declared for" in done.stderr
    assert not (home / "Downloads").exists() or list((home / "Downloads").iterdir()) == []


def test_an_existing_file_with_the_same_hash_is_kept_and_a_different_one_is_not_overwritten(tmp_path: Path, site):
    out = tmp_path / "out" / "client.dmg"
    out.parent.mkdir()
    out.write_bytes(BYTES)
    done, _, _, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 0 and "File already present and verified" in done.stdout
    out.write_bytes(b"keep me")
    done, _, tmpdir, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and out.read_bytes() == b"keep me"
    _clean(tmp_path, tmpdir, out.parent)


def test_a_link_in_place_of_the_destination_is_refused_and_its_target_stays(tmp_path: Path, site):
    target = tmp_path / "victim.txt"
    target.write_bytes(b"mine")
    out = tmp_path / "out" / "client.dmg"
    out.parent.mkdir()
    out.symlink_to(target)
    done, _, _, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and target.read_bytes() == b"mine" and out.is_symlink()


@pytest.mark.parametrize("shared", (".jht", "Documents/Job Hunter Team", "Documents/Job Hunter Team/downloads"))
def test_a_destination_in_a_folder_shared_with_the_team_is_refused(tmp_path: Path, site, shared: str):
    home = tmp_path / "home"
    (home / shared).mkdir(parents=True)
    out = home / shared / "client.dmg"
    done, _, _, calls = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and "shared with the team" in done.stderr
    assert not out.exists()


def test_a_link_to_a_shared_folder_does_not_hide_the_destination(tmp_path: Path, site):
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True)
    (tmp_path / "elsewhere").mkdir()
    (tmp_path / "elsewhere" / "inside").symlink_to(home / ".jht")
    out = tmp_path / "elsewhere" / "inside" / "client.dmg"
    done, _, _, _ = _run(tmp_path, site, *_asset_args(out))
    assert done.returncode == 1 and not (home / ".jht" / "client.dmg").exists()


@pytest.mark.parametrize("args", (("--os", "linux"), ("--version", "0.4.0"), ("--os", "plan9", "--version", "0.4.0"),
                                  ("--os", "linux", "--version", "x.y"), ("--os", "windows", "--version", "0.4.0", "--deb"),
                                  ("--os", "linux", "--version", "0.4.0", "--nope")))
def test_a_wrong_ask_answers_2_before_any_network(tmp_path: Path, site, args: tuple):
    done, home, _, calls = _run(tmp_path, site, *args, JHT_RELEASE_BASE_URL="http://127.0.0.1:9")
    assert done.returncode == 2, done.stderr
    assert not (home / "Downloads").exists()


@pytest.mark.parametrize("version", ("0.4.0", "0.4.1", "1.0.0"))
def test_windows_is_refused_for_a_release_that_has_no_installer(tmp_path: Path, site, version: str):
    done, home, _, _ = _run(tmp_path, site, "--os", "windows", "--version", version, JHT_RELEASE_BASE_URL="http://127.0.0.1:9")
    assert done.returncode == 1 and "Windows is not part of 0.4.0" in done.stderr and "Nothing was downloaded" in done.stderr
    # another home: the first run records its language in the runtime's values file
    (tmp_path / "it").mkdir()
    italian, _, _, _ = _run(tmp_path / "it", site, "--os", "windows", "--version", version, JHT_RELEASE_BASE_URL="http://127.0.0.1:9",
                            JHT_LANG="it")
    assert italian.returncode == 1 and "Windows non fa parte" in italian.stderr


def test_an_intel_mac_is_refused_before_anything_is_downloaded(tmp_path: Path, site):
    done, home, _, _ = _run(tmp_path, site, "--os", "macos", "--version", "0.4.0", JHT_DOWNLOAD_HOST="darwin-x64",
                            JHT_RELEASE_BASE_URL="http://127.0.0.1:9")
    assert done.returncode == 1 and "Apple silicon" in done.stderr and "Nothing was downloaded" in done.stderr
    assert "Mac Intel, non" not in done.stderr
    (tmp_path / "it").mkdir()
    italian, _, _, _ = _run(tmp_path / "it", site, "--os", "macos", "--version", "0.4.0", JHT_DOWNLOAD_HOST="darwin-x64",
                            JHT_RELEASE_BASE_URL="http://127.0.0.1:9", JHT_LANG="it")
    assert italian.returncode == 1 and "questo e' un Mac Intel" in italian.stderr
    assert not (home / "Downloads").exists()


def test_without_the_seam_the_release_is_fetched_over_https_only(tmp_path: Path, site):
    # the real base is github.com over https; an http address is accepted only through JHT_RELEASE_BASE_URL
    source = WRAPPER.read_text(encoding="utf-8")
    body = source[source.index("handle_host_download() {"):source.index("# ── Upgrade runtime")]
    assert 'https://github.com/leopu00/job-hunter-team/releases/download' in body
    assert 'proto="=https"' in body and '[ -z "${JHT_RELEASE_BASE_URL:-}" ] || proto="=https,http"' in body
    assert "docker" not in body, "the container must not be part of the download"


@pytest.mark.parametrize("os_name", ("macos",))
@pytest.mark.parametrize("version", ("0.3.5", "0.3.9", "v0.3.9"))
def test_a_release_before_0_4_is_said_to_have_no_macos_app(tmp_path: Path, site, os_name: str, version: str):
    # the old releases have a SHA256SUMS without the 0.4 names: the answer is not «SHA-256 dichiarato non trovato»
    (site.root.parent / "v0.3.9").mkdir()
    (site.root.parent / "v0.3.9" / "SHA256SUMS").write_text(f"{'a' * 64}  job-hunter-team-linux-x64.tar.gz\n", encoding="utf-8")
    done, home, _, _ = _run(tmp_path, site, "--os", os_name, "--version", version)
    assert done.returncode == 1
    # an installation in English (the default) says it in English; one in Italian, as before (B5 of the Linux retest)
    assert f"This release (v{version.removeprefix('v')}) has no app for macOS: use 0.4.0 or later" in done.stderr
    assert "Nothing was downloaded" in done.stderr and "not found" not in done.stderr
    assert "Questa release" not in done.stderr and "e' stato" not in done.stderr
    (tmp_path / "it").mkdir()
    italian, _, _, _ = _run(tmp_path / "it", site, "--os", os_name, "--version", version, JHT_LANG="it")
    assert "non ha l'app per macOS: usa la 0.4.0 o successive" in italian.stderr
    assert "non trovato" not in italian.stderr and "Non e' stato scaricato niente" in italian.stderr
    assert not (home / "Downloads").exists()


def test_the_usage_offers_windows_and_macos_only_and_linux_still_gets_its_answer(tmp_path: Path, site):
    # no arguments: the usage that is printed does not offer linux or --deb (there is no desktop app for Linux in this version)
    done, _, _, _ = _run(tmp_path, site, JHT_RELEASE_BASE_URL="http://127.0.0.1:9")
    text = done.stdout + done.stderr
    assert done.returncode == 2
    assert "usage: jht download --os windows|macos --version X.Y.Z [--output FILE]" in text
    assert "linux" not in text.lower() and "--deb" not in text
    (tmp_path / "help").mkdir()
    (tmp_path / "other").mkdir()
    helped, _, _, _ = _run(tmp_path / "help", site, "--help", JHT_RELEASE_BASE_URL="http://127.0.0.1:9")
    assert helped.returncode == 0 and "linux" not in (helped.stdout + helped.stderr).lower() and "--deb" not in helped.stdout
    # an unknown system is told the two that exist
    other, _, _, _ = _run(tmp_path / "other", site, "--os", "plan9", "--version", "0.4.0", JHT_RELEASE_BASE_URL="http://127.0.0.1:9")
    assert other.returncode == 2 and "unsupported system: plan9. Use windows or macos." in other.stderr
    assert "linux" not in other.stderr.lower() and "sistema" not in other.stderr


def test_the_sentences_a_wrong_command_gets_follow_the_language_of_the_cli(tmp_path: Path, site):
    # English by default, Italian when the installation speaks Italian: no Italian inside an English output
    for name, args, english, italian in (
        ("os", ("--os", "plan9", "--version", "0.4.0"), "unsupported system: plan9. Use windows or macos.", "sistema non supportato: plan9. Usa windows o macos."),
        ("version", ("--os", "macos", "--version", "x.y"), "invalid version: x.y. Example: 0.3.5.", "versione non valida: x.y. Esempio: 0.3.5."),
        ("deb", ("--os", "windows", "--version", "0.4.0", "--deb"), "--deb is only for Linux.", "--deb vale solo per Linux."),
    ):
        (tmp_path / name).mkdir()
        (tmp_path / f"{name}-it").mkdir()
        en, _, _, _ = _run(tmp_path / name, site, *args, JHT_RELEASE_BASE_URL="http://127.0.0.1:9")
        it, _, _, _ = _run(tmp_path / f"{name}-it", site, *args, JHT_RELEASE_BASE_URL="http://127.0.0.1:9", JHT_LANG="it")
        assert en.returncode == 2 and english in en.stderr, en.stderr
        assert it.returncode == 2 and italian in it.stderr, it.stderr


def test_a_download_in_progress_and_its_failures_speak_the_language_of_the_installation(tmp_path: Path, site):
    # English by default, Italian when the installation speaks Italian; no Italian inside an English output and the other way round
    (tmp_path / "en").mkdir()
    (tmp_path / "it").mkdir()
    en_out, it_out = tmp_path / "en" / "client.dmg", tmp_path / "it" / "client.dmg"
    en, _, _, _ = _run(tmp_path / "en", site, *_asset_args(en_out))
    it, _, _, _ = _run(tmp_path / "it", site, *_asset_args(it_out), JHT_LANG="it")
    assert en.returncode == 0 and it.returncode == 0, en.stderr + it.stderr
    for line in (f"Downloading {ASSET}...", "SHA-256 verified:", "Saved in:"):
        assert line in en.stdout, en.stdout
    for line in (f"Scarico {ASSET}...", "SHA-256 verificato:", "Salvato in:"):
        assert line in it.stdout, it.stdout
    assert not any(word in en.stdout for word in ("Scarico", "verificato", "Salvato"))
    # the refusals: a link, a shared folder, a wrong hash
    for lang, link, shared, wrong in (
        ("en", "the destination is a link:", "shared with the team", "invalid SHA-256 for"),
        ("it", "la destinazione e' un link:", "condivisa con il team", "SHA-256 non valido per"),
    ):
        work = tmp_path / f"refusals-{lang}"
        work.mkdir()
        extra = {"JHT_LANG": "it"} if lang == "it" else {}
        target = work / "victim.txt"
        target.write_bytes(b"mine")
        out = work / "out" / "client.dmg"
        out.parent.mkdir()
        out.symlink_to(target)
        done, _, _, _ = _run(work, site, *_asset_args(out), **extra)
        assert done.returncode == 1 and link in done.stderr, done.stderr
        done, _, _, _ = _run(work, site, *_asset_args(work / "home" / ".jht" / "client.dmg"), **extra)
        assert done.returncode == 1 and shared in done.stderr, done.stderr
        (site.root / "SHA256SUMS").write_text(f"{'0' * 64}  {ASSET}\n", encoding="utf-8")
        done, _, _, _ = _run(work, site, *_asset_args(work / "other" / "client.dmg"), **extra)
        assert done.returncode == 1 and wrong in done.stderr, done.stderr
        (site.root / "SHA256SUMS").write_text(f"{SUM} *{ASSET}\n", encoding="utf-8")
