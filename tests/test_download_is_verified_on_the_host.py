"""`jht download` downloads nothing: 0.4.0 has no desktop app, and the release attaches no installer for any system.

The command used to fetch the dmg or the setup.exe of the release and check its SHA-256 on the host; with no app in the release
that would be a 404. Now it says, in the language of the person, that JHT is used from the terminal (jht setup, jht up), and ends
with 1: it asks the release for nothing, writes no file and calls no container. Its --help is the local help of the host commands.
"""

from __future__ import annotations

import hashlib
import json
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
BYTES = b"an installer a release could still attach"
SUM = hashlib.sha256(BYTES).hexdigest()
LANGS = ["en", "it", "es", "fr", "de", "pt", "hu"]
SAID = {lang: json.loads((ROOT / f"shared/locales/{lang}.json").read_text(encoding="utf-8"))["wrapper.download.no_desktop_app"]
        for lang in LANGS}


class _Counted(SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D401 - silence
        pass

    def do_GET(self):  # noqa: N802 - name set by the base class
        self.server.asked.append(self.path)
        super().do_GET()


@pytest.fixture()
def site(tmp_path: Path):
    """A release that would still answer with the dmg: the command must not ask it."""
    root = tmp_path / "site"
    (root / "v0.4.0").mkdir(parents=True)
    (root / "v0.4.0" / ASSET).write_bytes(BYTES)
    (root / "v0.4.0" / "SHA256SUMS").write_text(f"{SUM} *{ASSET}\n", encoding="utf-8")
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(_Counted, directory=str(root)))
    server.asked = []
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield type("Site", (), {"url": f"http://127.0.0.1:{server.server_port}", "asked": server.asked})
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


ASKS = (
    ("--os", "macos", "--version", "0.4.0"),
    ("--os", "windows", "--version", "0.4.0"),
    ("--os", "linux", "--version", "0.4.0", "--deb"),
    ("--os", "macos", "--version", "0.3.9"),
    ("--os", "plan9", "--version", "x.y"),
    (),
)


@pytest.mark.parametrize("args", ASKS)
def test_jht_download_downloads_nothing_and_says_jht_is_used_from_the_terminal(tmp_path: Path, site, args: tuple):
    output = tmp_path / "out" / "client.dmg"
    done, home, tmpdir, calls = _run(tmp_path, site, *args, "--output", str(output))
    assert done.returncode == 1, (done.returncode, done.stdout, done.stderr)
    assert SAID["en"] in done.stdout + done.stderr
    assert "jht setup" in SAID["en"] and "jht up" in SAID["en"]
    # nothing asked of the release, no file written, no container called, no work folder left
    assert site.asked == []
    assert not output.exists() and not (tmp_path / "out").exists()
    assert not (home / "Downloads").exists()
    assert list(tmpdir.iterdir()) == []
    assert not calls.exists()


def test_the_help_is_the_local_help_and_downloads_nothing(tmp_path: Path, site):
    for flag in ("--help", "-h"):
        done, home, _, calls = _run(tmp_path, site, flag)
        assert done.returncode == 0 and "Host commands" in done.stdout, done.stdout + done.stderr
        assert site.asked == [] and not calls.exists() and not (home / "Downloads").exists()


@pytest.mark.parametrize("lang", LANGS)
def test_it_is_said_in_the_language_of_the_person(tmp_path: Path, site, lang: str):
    done, _, _, _ = _run(tmp_path, site, "--os", "macos", "--version", "0.4.0", JHT_LANG=lang)
    assert done.returncode == 1 and SAID[lang] in done.stdout + done.stderr, done.stdout + done.stderr
    for other in LANGS:
        if other != lang and SAID[other] != SAID[lang]:
            assert SAID[other] not in done.stdout + done.stderr


def test_the_wrapper_no_longer_holds_a_download_of_the_release():
    source = WRAPPER.read_text(encoding="utf-8")
    body = source[source.index("handle_host_download() {"):source.index("# ── Upgrade runtime")]
    for gone in ("curl", "releases/download", "SHA256SUMS", ".dmg", "setup.exe", "JHT_RELEASE_BASE_URL"):
        assert gone not in body, gone
