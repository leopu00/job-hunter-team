"""`jht screen off` and `jht integration remove media` on Windows leave the extras image on the disk (it was downloaded when the person asked
for the tool, and the next `on` finds it); `--remove-image` takes it away and says what it freed; the uninstall takes the Podman machine
with everything in it. Same library, harness and fake engine as tests/test_integration_command_windows.py, with `docker image inspect`
(the size) and `docker rmi` answered by the fake.

Run with: pytest tests/test_integration_extras_image_stays_windows.py -v   (needs PowerShell: pwsh off Windows)
"""

from __future__ import annotations

import json

import pytest
from windows_native_fakes import install_fake, powershell_argv

from test_integration_command_windows import CASE, DIGEST, FAKE_PODMAN, REF, log, run

# the fake engine of the base file, told what to answer to `image inspect` and to `rmi`
FAKE_ENGINE = """  if ($args[0] -eq 'image' -and $args[1] -eq 'inspect') {
    if ($env:T_IMAGE_ABSENT -eq '1') { $global:LASTEXITCODE = 1; return }
    $env:T_IMAGE_SIZE; return
  }
  if ($args[0] -eq 'rmi' -and $env:T_RMI_FAILS -eq '1') { $global:LASTEXITCODE = 1; return }
"""
ANCHOR = "  if ($args[0] -eq 'exec' -and $env:T_EXEC_FAIL -eq '1')"


@pytest.fixture
def host(tmp_path):
    assert CASE.count(ANCHOR) == 1
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "docker-compose.yml").write_text(
        "services:\n  jht:\n    image: x\n  jht-broker:\n    image: x\n  jht-telegram:\n    profiles: [telegram]\n    image: x\n", encoding="utf-8")
    for name in ("log", "volumes", "running"):
        (tmp_path / name).write_text("", encoding="utf-8")
    script = tmp_path / "case.ps1"
    script.write_text(CASE.replace(ANCHOR, FAKE_ENGINE + ANCHOR), encoding="utf-8-sig")

    class H:
        pass

    h = H()
    h.tmp, h.runtime, h.script = tmp_path, runtime, script
    h.log, h.volumes, h.running = tmp_path / "log", tmp_path / "volumes", tmp_path / "running"
    h.argv = powershell_argv()
    h.bin = tmp_path / "bin"
    h.bin.mkdir()
    install_fake(h.bin, "podman.exe", FAKE_PODMAN)
    return h


def reason(done) -> str:
    return json.loads(done.stdout)["reason"]


def lines(host) -> list[str]:
    return log(host).splitlines()


@pytest.mark.parametrize("tool", ["screen", "media"])
def test_off_keeps_the_extras_image_and_says_its_weight_and_the_command_that_frees_the_space(host, tool):
    run(host, ["add", tool, "--json"], T_EXTRAS=DIGEST)
    done = run(host, ["remove", tool, "--json"], T_EXTRAS=DIGEST, T_IMAGE_SIZE="3084123456")
    assert done.returncode == 0, done.stdout + done.stderr
    assert not any(line.startswith("DOCKER rmi") for line in lines(host))
    text = reason(done)
    command = "jht screen off --remove-image" if tool == "screen" else "jht integration remove media --remove-image"
    assert "3084 MB" in text and "resta sul disco" in text and command in text


def test_off_of_the_screen_still_begins_as_it_did(host):
    done = run(host, ["remove", "screen", "--json"], T_EXTRAS=DIGEST, T_IMAGE_SIZE="3084123456")
    assert reason(done).startswith("schermo spento e container tolto")


def test_off_without_a_size_from_the_engine_says_the_image_stays_and_invents_no_number(host):
    text = reason(run(host, ["remove", "screen", "--json"], T_EXTRAS=DIGEST))
    assert "resta sul disco" in text and "MB" not in text


def test_off_with_no_image_on_the_disk_says_nothing_about_it(host):
    done = run(host, ["remove", "screen", "--json"], T_EXTRAS=DIGEST, T_IMAGE_ABSENT="1")
    assert reason(done) == "schermo spento e container tolto"


def test_a_release_without_an_extras_image_says_nothing_about_it(host):
    done = run(host, ["remove", "screen", "--json"])
    assert reason(done) == "schermo spento e container tolto" and not any(line.startswith("DOCKER image") for line in lines(host))


def test_purge_takes_the_container_and_the_display_volume_but_the_image_stays(host):
    host.volumes.write_text("jht_jht-x11\njht_jht-playwright\n", encoding="utf-8")
    done = run(host, ["remove", "screen", "--purge", "--yes", "--json"], T_EXTRAS=DIGEST, T_IMAGE_SIZE="3084123456")
    assert done.returncode == 0, done.stdout + done.stderr
    assert [line for line in lines(host) if line.startswith("DOCKER volume rm")] == ["DOCKER volume rm jht_jht-x11"]
    assert not any(line.startswith("DOCKER rmi") for line in lines(host))
    assert "3084 MB" in reason(done) and "immagine tolta" not in reason(done)


def test_the_next_on_after_an_off_starts_again(host):
    run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST)
    run(host, ["remove", "screen", "--json"], T_EXTRAS=DIGEST)
    done = run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST)
    assert done.returncode == 0 and json.loads(done.stdout)["state"] == "running"


@pytest.mark.parametrize("tool", ["screen", "media"])
def test_remove_image_takes_the_image_away_after_the_container_and_says_what_was_freed(host, tool):
    run(host, ["add", tool, "--json"], T_EXTRAS=DIGEST)
    done = run(host, ["remove", tool, "--remove-image", "--json"], T_EXTRAS=DIGEST, T_IMAGE_SIZE="3084123456")
    assert done.returncode == 0, done.stdout + done.stderr
    seen = lines(host)
    assert f"DOCKER rmi {REF}" in seen
    assert seen.index(f"COMPOSE --profile {tool} rm -f jht-{tool}") < seen.index(f"DOCKER rmi {REF}")
    assert "immagine degli strumenti tolta (fino a 3084 MB)" in reason(done)


@pytest.mark.parametrize("tool,other", [("screen", "media"), ("media", "screen")])
def test_remove_image_keeps_the_image_while_another_tool_of_it_is_still_added_and_says_which(host, tool, other):
    run(host, ["add", tool, "--json"], T_EXTRAS=DIGEST)
    run(host, ["add", other, "--json"], T_EXTRAS=DIGEST)
    done = run(host, ["remove", tool, "--remove-image", "--json"], T_EXTRAS=DIGEST)
    assert done.returncode == 0, done.stdout + done.stderr
    assert not any(line.startswith("DOCKER rmi") for line in lines(host))
    assert f"non e' tolta: la usa ancora {other}" in reason(done)


def test_remove_image_that_the_engine_refuses_is_an_error_with_a_reason(host):
    run(host, ["add", "screen", "--json"], T_EXTRAS=DIGEST)
    done = run(host, ["remove", "screen", "--remove-image", "--json"], T_EXTRAS=DIGEST, T_RMI_FAILS="1")
    assert done.returncode == 1
    assert "non toglie l'immagine" in reason(done)


@pytest.mark.parametrize("args", [["add", "screen", "--remove-image"], ["status", "screen", "--remove-image"],
                                  ["remove", "telegram", "--remove-image"], ["remove", "google", "--remove-image"]])
def test_remove_image_is_only_for_remove_of_screen_or_media(host, args):
    done = run(host, args, T_EXTRAS=DIGEST)
    assert done.returncode == 2 and not any(line.startswith("DOCKER rmi") for line in lines(host))
