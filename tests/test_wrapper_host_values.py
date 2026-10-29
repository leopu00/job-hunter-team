"""The three values that decide how the container is created and attested (host type, language, time zone) come from a file
the agents cannot write (`$RUNTIME_DIR/host-values`), not from `host.env` (scripts/jht-wrapper.sh `jht_load_host_values`).

`~/.jht` is mounted read-write in the container: an agent that writes `JHT_HOST_TYPE=vps` into `host.env` would turn the
computer's runtime into a «vps» at the next creation of the container, and a changed language or time zone changes the
expected configuration hash, so the app stops attesting. The runtime folder is not mounted.
"""

from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path

import pytest

from test_wrapper_attest_cache import _calls, _complete, _fresh, _panel, _read

ROOT = Path(__file__).resolve().parents[1]


def _host_env(tmp_path: Path, env: dict[str, str], text: str) -> Path:
    path = tmp_path / "jht-home" / "host.env"
    path.parent.mkdir(exist_ok=True)
    path.write_text(text, encoding="utf-8")
    env["JHT_HOST_ENV_FILE"] = str(path)
    return path


def _values(runtime: Path) -> Path:
    return runtime / "host-values"


def _host_type_of_exec(log: Path) -> str:
    execs = [c for c in _calls(log) if c.startswith("docker exec")]
    assert execs, "no exec"
    return next(part.split("=", 1)[1] for part in execs[-1].split() if part.startswith("JHT_HOST_TYPE="))


def test_the_first_run_after_an_update_records_the_values_in_use_in_a_private_file_of_the_runtime_folder(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    _host_env(tmp_path, env, "JHT_HOST_TYPE=local\nJHT_LANG=it\nJHT_USER_TZ=Europe/Rome\n")
    assert not _values(runtime).exists()
    done = _read(wrapper, env)
    assert done.returncode == 0, done.stderr
    assert _values(runtime).read_text(encoding="utf-8") == "JHT_HOST_TYPE=local\nJHT_LANG=it\nJHT_USER_TZ=Europe/Rome\n"
    assert stat.S_IMODE(_values(runtime).stat().st_mode) == 0o600
    assert not list(runtime.glob("host-values.tmp.*"))
    assert Path(env["HOME"]) not in _values(runtime).parents, "outside every folder the container mounts"


def test_an_agent_that_rewrites_host_env_changes_neither_the_host_type_nor_what_the_app_attests(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    host_env = _host_env(tmp_path, env, "JHT_HOST_TYPE=local\nJHT_LANG=it\nJHT_USER_TZ=Europe/Rome\n")
    _read(wrapper, env)
    assert _host_type_of_exec(log) == "local"
    _read(wrapper, env)  # the cache is written
    _fresh(log)
    # what an agent can do: the file is in a folder the container mounts read-write
    host_env.write_text("JHT_HOST_TYPE=vps\nJHT_LANG=pt\nJHT_USER_TZ=UTC\n", encoding="utf-8")
    done = _read(wrapper, env)
    assert done.returncode == 0, done.stderr
    assert _host_type_of_exec(log) == "local", "the container is still a computer's"
    assert not _complete(_calls(log)), "same values, same key: the app still attests (and from the cache)"
    assert _values(runtime).read_text(encoding="utf-8").startswith("JHT_HOST_TYPE=local\n")


def test_a_host_env_created_by_an_agent_where_there_was_none_does_not_count_either(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    env["JHT_HOST_ENV_FILE"] = str(tmp_path / "jht-home" / "host.env")  # no such file yet
    _read(wrapper, env)
    assert _values(runtime).read_text(encoding="utf-8") == "JHT_HOST_TYPE=unknown\nJHT_LANG=en\nJHT_USER_TZ=UTC\n"
    (tmp_path / "jht-home").mkdir(exist_ok=True)
    Path(env["JHT_HOST_ENV_FILE"]).write_text("JHT_HOST_TYPE=vps\n", encoding="utf-8")
    _fresh(log)
    _read(wrapper, env)
    assert _host_type_of_exec(log) == "unknown"


def test_the_recorded_file_wins_over_host_env_and_the_values_it_holds_are_used(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    _host_env(tmp_path, env, "JHT_HOST_TYPE=local\nJHT_LANG=en\nJHT_USER_TZ=UTC\n")
    _values(runtime).write_text("JHT_HOST_TYPE=vps\nJHT_LANG=de\nJHT_USER_TZ=Europe/Berlin\n", encoding="utf-8")
    _values(runtime).chmod(0o600)
    _read(wrapper, env)
    assert _host_type_of_exec(log) == "vps", "set by the host setup, it is the one that counts"


def test_a_value_out_of_its_domain_is_not_used(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    _host_env(tmp_path, env, "JHT_HOST_TYPE=local\n")
    _values(runtime).write_text('JHT_HOST_TYPE=local" --user root "\nJHT_LANG=xx\nJHT_USER_TZ=a b\n', encoding="utf-8")
    _values(runtime).chmod(0o600)
    _read(wrapper, env)
    assert _host_type_of_exec(log) == "unknown", "not local|vps: the default, never the text"
    execs = " ".join(c for c in _calls(log) if c.startswith("docker exec"))
    assert "--user" not in execs


def test_a_file_that_is_a_link_is_neither_read_nor_overwritten(tmp_path: Path):
    wrapper, env, log, runtime = _panel(tmp_path)
    _host_env(tmp_path, env, "JHT_HOST_TYPE=local\nJHT_LANG=fr\nJHT_USER_TZ=UTC\n")
    target = tmp_path / "elsewhere"
    target.write_text("JHT_HOST_TYPE=vps\n", encoding="utf-8")
    os.symlink(target, _values(runtime))
    _read(wrapper, env)
    assert os.path.islink(_values(runtime)) and target.read_text(encoding="utf-8") == "JHT_HOST_TYPE=vps\n"
    assert _host_type_of_exec(log) == "local", "the link is not the source"


@pytest.mark.parametrize("mode", (0o666, 0o662, 0o664, 0o620, 0o602, 0o660, 0o606, 0o622))
def test_a_file_the_group_or_the_others_can_write_is_neither_read_nor_overwritten(tmp_path: Path, mode: int):
    """Any write bit of the group or of the others, alone as well as together: the find with `-perm -022` let 0620 and 0602 through."""
    wrapper, env, log, runtime = _panel(tmp_path)
    _host_env(tmp_path, env, "JHT_HOST_TYPE=local\nJHT_LANG=fr\nJHT_USER_TZ=UTC\n")
    _values(runtime).write_text("JHT_HOST_TYPE=vps\n", encoding="utf-8")
    _values(runtime).chmod(mode)
    _read(wrapper, env)
    assert _host_type_of_exec(log) == "local", oct(mode)
    assert _values(runtime).read_text(encoding="utf-8") == "JHT_HOST_TYPE=vps\n", "and not overwritten"


@pytest.mark.parametrize("mode", (0o600, 0o640, 0o644, 0o400))
def test_a_file_nobody_else_can_write_is_read(tmp_path: Path, mode: int):
    wrapper, env, log, runtime = _panel(tmp_path)
    _host_env(tmp_path, env, "JHT_HOST_TYPE=local\n")
    _values(runtime).write_text("JHT_HOST_TYPE=vps\nJHT_LANG=en\nJHT_USER_TZ=UTC\n", encoding="utf-8")
    _values(runtime).chmod(mode)
    _read(wrapper, env)
    assert _host_type_of_exec(log) == "vps", oct(mode)


def _record(tmp_path: Path, kernel: str, host_type: str):
    """The wrapper's own `jht_record_host_values`, alone, as if the kernel were `kernel` and the value in use `host_type`."""
    import re

    source = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
    function = re.search(r"^jht_record_host_values\(\) \{\n.*?^\}\n", source, re.S | re.M).group(0)
    runtime = tmp_path / f"rt-{kernel}-{host_type}"
    runtime.mkdir(mode=0o700)
    script = (
        "set -u\n"
        f'HOST_KERNEL={kernel}; RUNTIME_DIR="{runtime}"; HOST_VALUES_FILE="{runtime}/host-values"\n'
        f"JHT_HOST_TYPE={host_type}; JHT_LANG=en; JHT_USER_TZ=UTC\n" + function + 'jht_record_host_values\nprintf "type=%s\\n" "$JHT_HOST_TYPE"\n'
    )
    done = subprocess.run(["bash", "-c", script], env={"PATH": "/usr/bin:/bin"}, text=True, capture_output=True, timeout=20, check=False)
    assert done.returncode == 0, done.stderr
    return runtime, done


def test_on_a_mac_a_vps_taken_from_host_env_is_recorded_as_local_and_it_is_told(tmp_path: Path):
    runtime, done = _record(tmp_path, "Darwin", "vps")
    assert "type=local" in done.stdout
    assert (runtime / "host-values").read_text(encoding="utf-8") == "JHT_HOST_TYPE=local\nJHT_LANG=en\nJHT_USER_TZ=UTC\n"
    assert "vps" in done.stderr and "local" in done.stderr, done.stderr
    log = (runtime / "host-values.log").read_text(encoding="utf-8")
    assert "JHT_HOST_TYPE=vps" in log and "registrato local" in log
    assert stat.S_IMODE((runtime / "host-values.log").stat().st_mode) == 0o600


@pytest.mark.parametrize("kernel,host_type", (("Linux", "vps"), ("Darwin", "local"), ("Darwin", "unknown"), ("Linux", "local")))
def test_every_other_case_is_recorded_as_it_is_and_told_nothing(tmp_path: Path, kernel: str, host_type: str):
    runtime, done = _record(tmp_path, kernel, host_type)
    assert f"type={host_type}" in done.stdout
    assert (runtime / "host-values").read_text(encoding="utf-8").startswith(f"JHT_HOST_TYPE={host_type}\n")
    assert done.stderr == ""
    assert not (runtime / "host-values.log").exists()


def test_host_setup_writes_the_same_values_next_to_host_env_and_in_the_runtime_folder(tmp_path: Path):
    runtime = tmp_path / "runtime"
    runtime.mkdir(mode=0o700)
    home = tmp_path / "home"
    jht_home = home / ".jht"
    jht_home.mkdir(parents=True)
    env = {
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "HOME": str(home),
        "JHT_RUNTIME_DIR": str(runtime),
        "JHT_HOME_HOST": str(jht_home),
        "JHT_LANG": "it",
        "JHT_USER_TZ": "Europe/Rome",
    }
    done = subprocess.run(
        ["bash", str(ROOT / "scripts" / "host-setup.sh"), "--host-type=local"], env=env, text=True, capture_output=True, timeout=60, check=False, stdin=subprocess.DEVNULL
    )
    assert done.returncode == 0, done.stdout + done.stderr
    written = (jht_home / "host.env").read_text(encoding="utf-8")
    values = (runtime / "host-values").read_text(encoding="utf-8")
    assert values == written, (written, values)
    assert "JHT_HOST_TYPE=local" in values
    assert stat.S_IMODE((runtime / "host-values").stat().st_mode) == 0o600
    assert not list(runtime.glob("host-values.tmp.*"))


def test_the_source_never_reads_host_env_for_the_three_values_once_the_file_is_there():
    source = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
    load = source.split("jht_load_host_values() {")[1].split("\n}\n")[0]
    assert '! jht_host_values_trusted || source_file="$HOST_VALUES_FILE"' in load
    assert load.count("jht_read_host_env_value") == 1, "one reader, on the one file chosen above"
    # no other place of the wrapper reads the three values from host.env
    assert source.count('jht_read_host_env_value "$HOST_ENV_FILE"') == 0
