"""Build9 to build10, German, Windows: an update of an install that already runs on Podman (0.4) ended step 3 with the
notes of the move from v0.3.9 (Docker Desktop), in English: «Existing JHT config, profile and Codex login will be reused
in Podman…», «If the old game stored a mail password…», «JHT v0.3.9 Docker volumes contain only reinstallable…», «Those
Docker volumes are not copied to Podman…», «Docker Desktop was not started…», and «The team restarts on the new runtime
image: <digest> (it ran on <digest>)».

The move from v0.3.9 is told only when the runtime folder has no Podman runtime yet (0.4 and later write
container-runtime = podman in it); its lines and the restart line come from the catalogs in the 7 languages, and a
person reads the restart without the digests (the app and the log keep them).

The code is read from the real enabler (the harness of test_windows_podman_wsl_branches): off Windows under pwsh, on
Windows under the shell JHT_TEST_SHELL names.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from test_windows_podman_wsl_branches import ENABLER, _run

LOCALES = Path(__file__).resolve().parents[1] / "shared" / "locales"
LANGS = ("en", "it", "de", "fr", "es", "pt", "hu")


@pytest.fixture(autouse=True)
def require_the_requested_engine(monkeypatch):
    # A missing native shell must fail, never turn these cases into a skip.
    monkeypatch.setenv("JHT_REQUIRE_WINDOWS_SHELLS", "1")


def _between(source: str, start: str, end: str) -> str:
    return source[source.index(start) : source.index(end)]


SOURCE = ENABLER.read_text(encoding="utf-8")
LEGACY_BLOCK = _between(SOURCE, "$selectionBefore = Join-Path $RuntimeDir 'container-runtime'", "$metadataRepaired = ")
RESTART_BLOCK = _between(SOURCE, "if ($runningImage -and $runningImage -ne $canonicalImage) {", "& (Join-Path $BinDir 'jht.ps1') up")


def _text(lang: str, key: str) -> str:
    return json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))[f"podman_machine.{key}"]


def _legacy(tmp_path, lang, *, podman_before):
    runtime = tmp_path / "runtime"
    home = tmp_path / "jht-home"
    runtime.mkdir()
    home.mkdir()
    (home / "jht.config.json").write_text("{}", encoding="utf-8")
    if podman_before:
        (runtime / "container-runtime").write_text("podman\n", encoding="utf-8")
    (tmp_path / "bin").mkdir()
    body = (f"$RuntimeDir = '{runtime}'\n$JhtHome = '{home}'\n$env:ProgramFiles = '{tmp_path / 'no-program-files'}'\n"
            + LEGACY_BLOCK)
    result, _ = _run(tmp_path, ENABLER, ["Report-LegacyDockerVolumes"], body, {"JHT_LANG": lang})
    return result, result.stdout.replace("\r\n", "\n")


@pytest.mark.parametrize("lang", ["de", "en"])
def test_an_update_of_a_podman_install_gets_none_of_the_v039_notes(tmp_path, lang):
    result, out = _legacy(tmp_path, lang, podman_before=True)
    assert result.returncode == 0, out + result.stderr
    for key in ("legacy_reused", "legacy_mail_password", "legacy_volumes_reinstallable", "legacy_volumes_not_copied",
                "legacy_docker_not_started"):
        assert _text(lang, key) not in out + result.stderr, key
        assert _text("en", key) not in out + result.stderr, key
    assert "v0.3.9" not in out + result.stderr and "Docker" not in out + result.stderr


@pytest.mark.parametrize("lang", LANGS)
def test_a_move_from_v039_is_still_told_in_the_language_of_the_person(tmp_path, lang):
    result, out = _legacy(tmp_path, lang, podman_before=False)
    assert result.returncode == 0, out + result.stderr
    for key in ("legacy_reused", "legacy_mail_password", "legacy_volumes_reinstallable", "legacy_volumes_not_copied",
                "legacy_docker_not_started"):
        assert _text(lang, key) in out, (key, out)
    if lang != "en":
        assert _text("en", "legacy_reused") not in out, out


def _restart(tmp_path, lang, machine_output):
    (tmp_path / "bin").mkdir()
    body = ("$canonicalImage = 'ghcr.io/leopu00/jht@sha256:new'\n$runningImage = 'ghcr.io/leopu00/jht@sha256:old'\n"
            + RESTART_BLOCK)
    result, _ = _run(tmp_path, ENABLER, ["Write-JhtPhase"], body, {"JHT_LANG": lang, "JHT_MACHINE_OUTPUT": machine_output})
    return result, result.stdout.replace("\r\n", "\n")


@pytest.mark.parametrize("lang", LANGS)
def test_a_person_reads_the_restart_in_their_language_without_digests(tmp_path, lang):
    result, out = _restart(tmp_path, lang, "0")
    assert result.returncode == 0, out + result.stderr
    assert _text(lang, "team_restarts") in out, out
    assert "sha256" not in out and "JHT_PHASE" not in out, out


def test_the_app_keeps_the_restart_line_with_both_images(tmp_path):
    result, out = _restart(tmp_path, "de", "1")
    assert result.returncode == 0, out + result.stderr
    assert "JHT_PHASE team_restart" in out
    assert "The team restarts on the new runtime image: ghcr.io/leopu00/jht@sha256:new (it ran on ghcr.io/leopu00/jht@sha256:old)." in out
