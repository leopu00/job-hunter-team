"""Contratto di ``jht download``: asset reale, integrita' ed exit code onesti."""

import hashlib
import http.server
import os
import subprocess
import threading
from contextlib import contextmanager
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
JHT = ROOT / "cli" / "bin" / "jht.js"


def run_jht(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", str(JHT), *args],
        cwd=ROOT,
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
        timeout=15,
    )


@contextmanager
def release_server(files: dict[str, bytes]):
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - nome imposto da BaseHTTPRequestHandler
            body = files.get(self.path)
            if body is None:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *_args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/releases/download"
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()


def release_files(asset: str, body: bytes, *, checksum: str | None = None):
    digest = checksum or hashlib.sha256(body).hexdigest()
    return {
        "/releases/download/v0.3.5/SHA256SUMS": f"{digest}  {asset}\n".encode(),
        f"/releases/download/v0.3.5/{asset}": body,
    }


def isolated_env(tmp_path: Path, base_url: str):
    return {
        "HOME": str(tmp_path / "home"),
        "JHT_USER_DIR": str(tmp_path / "user"),
        "JHT_RELEASE_BASE_URL": base_url,
        "NO_COLOR": "1",
    }


def test_download_help_describes_required_contract():
    result = run_jht("download", "--help")
    assert result.returncode == 0
    for flag in ("--os <platform>", "--version <release>", "--output <file>", "--portable"):
        assert flag in result.stdout


@pytest.mark.parametrize(
    ("platform", "asset"),
    [
        ("windows", "job-hunter-team-windows-x64-setup.exe"),
        ("macos", "job-hunter-team.zip"),
        ("linux", "job-hunter-team-linux-x64.tar.gz"),
    ],
)
def test_downloads_platform_asset_and_verifies_sha256(tmp_path, platform, asset):
    body = f"release bytes for {platform}".encode()
    with release_server(release_files(asset, body)) as base_url:
        result = run_jht(
            "download", "--os", platform, "--version", "0.3.5",
            env=isolated_env(tmp_path, base_url),
        )

    destination = tmp_path / "user" / "downloads" / asset
    assert result.returncode == 0, result.stderr
    assert destination.read_bytes() == body
    assert "SHA-256 verificato" in result.stdout
    assert "100%" in result.stdout + result.stderr


def test_download_version_is_not_intercepted_by_global_version_flag(tmp_path):
    """Regressione P1: il comando deve lavorare, non stampare solo ``0.3.5``."""
    asset = "job-hunter-team-windows-x64-setup.exe"
    with release_server(release_files(asset, b"windows installer")) as base_url:
        output = tmp_path / "chosen.exe"
        result = run_jht(
            "download", "--os", "windows", "--version", "0.3.5",
            "--output", str(output), env=isolated_env(tmp_path, base_url),
        )

    assert result.returncode == 0, result.stderr
    assert output.read_bytes() == b"windows installer"
    assert result.stdout.strip() != "0.3.5"


def test_download_portable_selects_optional_windows_asset(tmp_path):
    asset = "job-hunter-team-windows-x64-portable.exe"
    with release_server(release_files(asset, b"portable")) as base_url:
        result = run_jht(
            "download", "--os", "windows", "--version", "0.3.5", "--portable",
            env=isolated_env(tmp_path, base_url),
        )

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "user" / "downloads" / asset).read_bytes() == b"portable"


def test_checksum_mismatch_fails_and_removes_partial_file(tmp_path):
    asset = "job-hunter-team-linux-x64.tar.gz"
    files = release_files(asset, b"corrupt", checksum="0" * 64)
    with release_server(files) as base_url:
        result = run_jht(
            "download", "--os", "linux", "--version", "0.3.5",
            env=isolated_env(tmp_path, base_url),
        )

    download_dir = tmp_path / "user" / "downloads"
    assert result.returncode != 0
    assert "SHA-256" in result.stderr
    assert not (download_dir / asset).exists()
    assert not list(download_dir.glob("*.part-*"))


@pytest.mark.parametrize(
    ("args", "message"),
    [
        (("--os", "plan9", "--version", "0.3.5"), "Sistema operativo non supportato"),
        (("--os", "windows", "--version", "not-a-version"), "Versione non valida"),
        (("--os", "linux", "--version", "0.3.5", "--portable"), "solo per Windows"),
    ],
)
def test_invalid_requests_fail_before_network(tmp_path, args, message):
    result = run_jht(
        "download", *args,
        env=isolated_env(tmp_path, "http://127.0.0.1:1/releases/download"),
    )
    assert result.returncode != 0
    assert message in result.stderr


def test_network_error_is_nonzero_and_leaves_no_file(tmp_path):
    result = run_jht(
        "download", "--os", "linux", "--version", "0.3.5",
        env=isolated_env(tmp_path, "http://127.0.0.1:1/releases/download"),
    )
    assert result.returncode != 0
    assert "Download non riuscito" in result.stderr
    assert not (tmp_path / "user" / "downloads" / "job-hunter-team-linux-x64.tar.gz").exists()


def test_existing_wrong_file_is_not_overwritten(tmp_path):
    asset = "job-hunter-team.zip"
    output = tmp_path / asset
    output.write_bytes(b"keep me")
    with release_server(release_files(asset, b"new bytes")) as base_url:
        result = run_jht(
            "download", "--os", "macos", "--version", "0.3.5",
            "--output", str(output), env=isolated_env(tmp_path, base_url),
        )

    assert result.returncode != 0
    assert "esiste gia" in result.stderr
    assert output.read_bytes() == b"keep me"
