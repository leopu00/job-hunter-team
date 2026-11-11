"""The macOS installer on Colima (the default) must leave `docker compose` working, or stop and say what to run.

Homebrew's `docker` formula is only the client: no `docker compose`. The installer ended with «Installation complete!» and every `jht`
command then failed. These tests take the function from the installer and run it with a docker that has no Compose until its plugin is
registered, and a brew that only records what it was asked (a made-up HOME and prefix, no network, no real brew).
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install.sh"
SOURCE = INSTALLER.read_text(encoding="utf-8")

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the bash installer is not run on Windows")


def _world(tmp_path: Path, *, brew_fails: bool = False, plugin_works: bool = True, preexisting_plugin: bool = False):
    home = tmp_path / "home"
    home.mkdir()
    prefix = tmp_path / "prefix"
    (prefix / "opt" / "docker-compose" / "bin").mkdir(parents=True)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "brew.log"
    plugin_dir = home / ".docker" / "cli-plugins"
    # docker: «compose version» answers only when the plugin is registered where the client looks (and works)
    (bin_dir / "docker").write_text(f"""#!/bin/sh
if [ "$1" = compose ] && [ "$2" = version ]; then
  if [ -x "{plugin_dir}/docker-compose" ] && [ "{int(plugin_works)}" = 1 ]; then echo "Docker Compose version v2.0.0"; exit 0; fi
  echo "docker: unknown command: docker compose" >&2; exit 1
fi
exit 0
""", encoding="utf-8")
    (bin_dir / "docker").chmod(0o755)
    brew_install = "" if brew_fails else f'''cat > "{prefix}/opt/docker-compose/bin/docker-compose" <<'EOP'
#!/bin/sh
exit 0
EOP
chmod 755 "{prefix}/opt/docker-compose/bin/docker-compose"'''
    (bin_dir / "brew").write_text(f"""#!/bin/sh
printf '%s\\n' "$*" >> "{log}"
case "$1" in
  --prefix) echo "{prefix}"; exit 0 ;;
  install) {"exit 1" if brew_fails else ":"} ;;
esac
{brew_install}
exit 0
""", encoding="utf-8")
    (bin_dir / "brew").chmod(0o755)
    if preexisting_plugin:
        plugin_dir.mkdir(parents=True)
        (plugin_dir / "docker-compose").write_text("#!/bin/sh\necho mine\n", encoding="utf-8")
        (plugin_dir / "docker-compose").chmod(0o755)
    return home, prefix, bin_dir, log, plugin_dir


def _run(tmp_path: Path, home: Path, bin_dir: Path, *, dry_run: int = 0, extra: str = ""):
    script = f"""set -u
. "{INSTALLER}"
DRY_RUN={dry_run}
DOCKER_CLI="{bin_dir}/docker"
{extra}
ensure_docker_compose_macos
echo "RC=$?"
echo "LINK=$COMPOSE_PLUGIN_LINK_PATH|$COMPOSE_PLUGIN_LINK_TARGET|$COMPOSE_PLUGIN_DIR_CREATED"
"""
    env = {"HOME": str(home), "PATH": f"{bin_dir}:/usr/bin:/bin", "JHT_INSTALLER_SOURCE_ONLY": "1", "JHT_MACHINE_OUTPUT": "0"}
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env, timeout=60)


def test_a_docker_without_compose_gets_the_plugin_installed_and_registered(tmp_path):
    home, prefix, bin_dir, log, plugin_dir = _world(tmp_path)
    done = _run(tmp_path, home, bin_dir)
    assert "RC=0" in done.stdout, done.stdout + done.stderr
    assert "install docker-compose" in log.read_text()
    link = plugin_dir / "docker-compose"
    assert link.is_symlink() and os.readlink(link) == f"{prefix}/opt/docker-compose/bin/docker-compose"
    assert "docker compose installed and registered" in done.stdout


def test_a_docker_that_already_has_compose_is_left_alone(tmp_path):
    home, prefix, bin_dir, log, plugin_dir = _world(tmp_path, preexisting_plugin=True)
    done = _run(tmp_path, home, bin_dir)
    assert "RC=0" in done.stdout and "already available" in done.stdout
    assert not log.exists()


def test_when_the_install_fails_it_stops_and_says_the_command(tmp_path):
    home, prefix, bin_dir, log, plugin_dir = _world(tmp_path, brew_fails=True)
    done = _run(tmp_path, home, bin_dir)
    assert "RC=0" not in done.stdout and done.returncode != 0
    assert "brew install docker-compose" in done.stdout + done.stderr
    assert not (plugin_dir / "docker-compose").exists()


def test_when_the_plugin_still_does_not_answer_it_stops_and_says_what_to_run(tmp_path):
    home, prefix, bin_dir, log, plugin_dir = _world(tmp_path, plugin_works=False)
    done = _run(tmp_path, home, bin_dir)
    text = done.stdout + done.stderr
    assert done.returncode != 0 and "RC=0" not in done.stdout
    assert "still not available" in text and "ln -sfn" in text and str(plugin_dir / "docker-compose") in text


def test_a_plugin_file_of_the_person_is_not_replaced(tmp_path):
    home, prefix, bin_dir, log, plugin_dir = _world(tmp_path, plugin_works=False, preexisting_plugin=True)
    # the person's file is there and does not answer for this docker: the installer must not overwrite it
    docker = bin_dir / "docker"
    docker.write_text(docker.read_text().replace('-x "%s/docker-compose"' % plugin_dir, '-x "/nonexistent"'), encoding="utf-8")
    done = _run(tmp_path, home, bin_dir)
    assert (plugin_dir / "docker-compose").read_text() == "#!/bin/sh\necho mine\n"
    assert not (plugin_dir / "docker-compose").is_symlink() and done.returncode != 0


def test_dry_run_changes_nothing(tmp_path):
    home, prefix, bin_dir, log, plugin_dir = _world(tmp_path)
    done = _run(tmp_path, home, bin_dir, dry_run=1)
    assert "RC=0" in done.stdout and "would verify: docker compose version" in done.stdout
    assert not log.exists() and not plugin_dir.exists()


def test_the_check_runs_for_a_colima_the_installer_sets_up_and_for_an_engine_that_was_already_there():
    colima = re.search(r"^install_colima_macos\(\) \{\n.*?^\}\n", SOURCE, re.S | re.M).group(0)
    assert colima.index("ensure_docker_compose_macos") < colima.index("colima start")
    verify = re.search(r"^verify_docker_works\(\) \{\n.*?^\}\n", SOURCE, re.S | re.M).group(0)
    assert 'ok "docker daemon reachable"' in verify and "ensure_docker_compose_macos" in verify.split('ok "docker daemon reachable"')[1]


def test_the_marker_of_a_colima_started_by_the_installer_is_written_only_then(tmp_path):
    colima = re.search(r"^install_colima_macos\(\) \{\n.*?^\}\n", SOURCE, re.S | re.M).group(0)
    assert colima.index("colima start ||") < colima.index("COLIMA_STARTED_BY_INSTALLER=1")
    block = re.search(r'(    if \[ "\$COLIMA_STARTED_BY_INSTALLER" = 1 \]; then\n.*?\n    fi)\n', SOURCE, re.S).group(1)
    for started, expected in (("1", True), ("0", False)):
        runtime = tmp_path / f"runtime{started}"
        runtime.mkdir()
        done = subprocess.run(["bash", "-c", f'RUNTIME_DIR="{runtime}"\nCOLIMA_STARTED_BY_INSTALLER={started}\n{block}\n'],
                              capture_output=True, text=True, timeout=30)
        assert done.returncode == 0, done.stderr
        marker = runtime / "colima-started"
        assert marker.exists() is expected
        if expected:
            assert marker.read_text() == "colima\ndefault\n" and oct(marker.stat().st_mode & 0o777) == "0o600"


def _link_line(done) -> str:
    return next(line for line in done.stdout.splitlines() if line.startswith("LINK="))


def test_the_link_the_installer_made_is_remembered_with_its_target_and_the_folder_it_made(tmp_path):
    home, prefix, bin_dir, log, plugin_dir = _world(tmp_path)
    done = _run(tmp_path, home, bin_dir)
    assert _link_line(done) == f"LINK={plugin_dir}/docker-compose|{prefix}/opt/docker-compose/bin/docker-compose|1"


def test_a_plugin_folder_that_was_there_is_not_remembered_as_made(tmp_path):
    home, prefix, bin_dir, log, plugin_dir = _world(tmp_path)
    plugin_dir.mkdir(parents=True)
    done = _run(tmp_path, home, bin_dir)
    assert _link_line(done).endswith("|0")


def test_a_link_of_the_person_that_the_run_replaced_is_not_remembered(tmp_path):
    home, prefix, bin_dir, log, plugin_dir = _world(tmp_path)
    plugin_dir.mkdir(parents=True)
    (plugin_dir / "docker-compose").symlink_to(tmp_path / "somewhere-else")
    done = _run(tmp_path, home, bin_dir)
    assert _link_line(done) == "LINK=||0"


def test_nothing_is_remembered_when_compose_was_already_there(tmp_path):
    home, prefix, bin_dir, log, plugin_dir = _world(tmp_path, preexisting_plugin=True)
    done = _run(tmp_path, home, bin_dir)
    assert _link_line(done) == "LINK=||0"


def test_the_marker_of_the_plugin_link_is_written_only_when_the_run_made_one(tmp_path):
    block = re.search(r'(    if \[ -n "\$COMPOSE_PLUGIN_LINK_PATH" \]; then\n.*?\n    fi)\n', SOURCE, re.S).group(1)
    for path, expected in (("/x/.docker/cli-plugins/docker-compose", True), ("", False)):
        runtime = tmp_path / f"runtime{int(expected)}"
        runtime.mkdir()
        script = (f'RUNTIME_DIR="{runtime}"\nCOMPOSE_PLUGIN_LINK_PATH="{path}"\nCOMPOSE_PLUGIN_LINK_TARGET="/p/docker-compose"\n'
                  f'COMPOSE_PLUGIN_DIR_CREATED=1\n{block}\n')
        done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)
        assert done.returncode == 0, done.stderr
        marker = runtime / "docker-compose-plugin-link"
        assert marker.exists() is expected
        if expected:
            assert marker.read_text() == "/x/.docker/cli-plugins/docker-compose\n/p/docker-compose\n1\n"
            assert oct(marker.stat().st_mode & 0o777) == "0o600"
