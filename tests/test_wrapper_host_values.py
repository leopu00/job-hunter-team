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


_LOADING = (
    "jht_host_env_value_valid",
    "jht_read_host_env_value",
    "runtime_stat",
    "runtime_node_safe",
    "jht_host_values_trusted",
    "jht_host_values_log",
    "jht_a_mac_is_never_a_vps",
    "jht_load_host_values",
    "jht_record_host_values",
)


def _functions(names) -> str:
    import re

    source = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
    return "\n".join(re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", source, re.S | re.M).group(0) for name in names)


def _load_and_record(tmp_path: Path, host_type: str, *, values: tuple[str, int] | None = None, log: str | None = None, name: str = "rt", extra_env: dict[str, str] | None = None):
    """The wrapper's own functions that load and record the values, alone, with the kernel of this machine and a `host.env`
    that says `host_type`. `values` is a host-values file already there (text, mode); `log` says what is at host-values.log."""
    runtime = tmp_path / name
    runtime.mkdir(mode=0o700)
    host_env = tmp_path / f"{name}-host.env"
    host_env.write_text(f"JHT_HOST_TYPE={host_type}\nJHT_LANG=it\nJHT_USER_TZ=Europe/Rome\n", encoding="utf-8")
    if values is not None:
        (runtime / "host-values").write_text(values[0], encoding="utf-8")
        (runtime / "host-values").chmod(values[1])
    if log == "link":
        target = tmp_path / f"{name}-elsewhere"
        target.write_text("before\n", encoding="utf-8")
        os.symlink(target, runtime / "host-values.log")
    script = (
        "set -u\n"
        f'HOST_KERNEL="$(uname -s)"; HOST_UID="$(id -u)"; RUNTIME_DIR="{runtime}"; HOST_VALUES_FILE="{runtime}/host-values"; HOST_ENV_FILE="{host_env}"\n'
        + _functions(_LOADING)
        + "\njht_load_host_values\njht_record_host_values\nprintf 'type=%s\\n' \"$JHT_HOST_TYPE\"\n"
    )
    done = subprocess.run(["bash", "-c", script], env={"PATH": "/usr/bin:/bin", **(extra_env or {})}, text=True, capture_output=True, timeout=20, check=False)
    assert done.returncode == 0, done.stderr
    return runtime, done


DARWIN = pytest.mark.skipif(os.uname().sysname != "Darwin", reason="the rule is for macOS; the kernel is the machine's own")


@DARWIN
def test_on_a_mac_a_vps_taken_from_host_env_is_recorded_as_local_and_it_is_told(tmp_path: Path):
    runtime, done = _load_and_record(tmp_path, "vps")
    assert "type=local" in done.stdout
    assert (runtime / "host-values").read_text(encoding="utf-8") == "JHT_HOST_TYPE=local\nJHT_LANG=it\nJHT_USER_TZ=Europe/Rome\n"
    assert "vps" in done.stderr and "local" in done.stderr, done.stderr
    log = (runtime / "host-values.log").read_text(encoding="utf-8")
    assert "JHT_HOST_TYPE=vps" in log and "usato local" in log
    assert stat.S_IMODE((runtime / "host-values.log").stat().st_mode) == 0o600


@DARWIN
@pytest.mark.parametrize("mode", (0o666, 0o620, 0o602, 0o662))
def test_on_a_mac_a_host_values_that_is_not_trusted_does_not_let_a_vps_of_host_env_through(tmp_path: Path, mode: int):
    """The fallback to host.env is a source an agent writes: the same rule as at the first record, and the app does the same."""
    runtime, done = _load_and_record(tmp_path, "vps", values=("JHT_HOST_TYPE=local\n", mode))
    assert "type=local" in done.stdout, oct(mode)
    assert (runtime / "host-values").read_text(encoding="utf-8") == "JHT_HOST_TYPE=local\n", "and the file is not overwritten"
    assert done.stderr == "", "the message is for the first record, when the file is not there"
    assert "JHT_HOST_TYPE=vps" in (runtime / "host-values.log").read_text(encoding="utf-8")


@DARWIN
def test_on_a_mac_a_host_values_that_is_trusted_and_says_vps_is_the_users_choice(tmp_path: Path):
    runtime, done = _load_and_record(tmp_path, "local", values=("JHT_HOST_TYPE=vps\nJHT_LANG=en\nJHT_USER_TZ=UTC\n", 0o600))
    assert "type=vps" in done.stdout
    assert not (runtime / "host-values.log").exists()


@DARWIN
def test_on_a_mac_a_trusted_host_values_that_does_not_say_the_type_does_not_let_a_vps_of_the_environment_through(tmp_path: Path):
    runtime, done = _load_and_record(tmp_path, "local", values=("JHT_LANG=en\nJHT_USER_TZ=UTC\n", 0o600), extra_env={"JHT_HOST_TYPE": "vps"})
    assert "type=local" in done.stdout
    assert "JHT_HOST_TYPE=vps" in (runtime / "host-values.log").read_text(encoding="utf-8")


@DARWIN
def test_the_log_is_not_written_through_a_link_or_into_a_folder_that_is_not_the_users(tmp_path: Path):
    runtime, done = _load_and_record(tmp_path, "vps", log="link", name="rt-link")
    assert "type=local" in done.stdout
    assert (tmp_path / "rt-link-elsewhere").read_text(encoding="utf-8") == "before\n", "the link was followed"
    other = tmp_path / "rt-open"
    other.mkdir()
    other.chmod(0o777)
    host_env = tmp_path / "rt-open-host.env"
    host_env.write_text("JHT_HOST_TYPE=vps\n", encoding="utf-8")
    script = (
        "set -u\n"
        f'HOST_KERNEL="$(uname -s)"; HOST_UID="$(id -u)"; RUNTIME_DIR="{other}"; HOST_VALUES_FILE="{other}/host-values"; HOST_ENV_FILE="{host_env}"\n'
        + _functions(_LOADING)
        + "\njht_load_host_values\nprintf 'type=%s\\n' \"$JHT_HOST_TYPE\"\n"
    )
    done = subprocess.run(["bash", "-c", script], env={"PATH": "/usr/bin:/bin"}, text=True, capture_output=True, timeout=20, check=False)
    assert "type=local" in done.stdout and not (other / "host-values.log").exists()


def test_the_rule_is_for_a_mac_only(tmp_path: Path):
    """The rule alone, whatever machine this is: Darwin turns a vps into a local, any other kernel leaves it."""
    for kernel, host_type, expected in (("Darwin", "vps", "local"), ("Linux", "vps", "vps"), ("Darwin", "local", "local"), ("Darwin", "unknown", "unknown")):
        script = (
            "set -u\n"
            f'HOST_KERNEL={kernel}; JHT_HOST_TYPE={host_type}; HOST_VALUES_FILE="{tmp_path}/host-values"; RUNTIME_DIR="{tmp_path}"\n'
            "jht_host_values_log() { :; }\n" + _functions(["jht_a_mac_is_never_a_vps"]) + '\njht_a_mac_is_never_a_vps\nprintf "%s" "$JHT_HOST_TYPE"\n'
        )
        done = subprocess.run(["bash", "-c", script], env={"PATH": "/usr/bin:/bin"}, text=True, capture_output=True, timeout=20, check=False)
        assert done.stdout == expected, (kernel, host_type, done.stderr)
        assert (done.stderr != "") == (kernel == "Darwin" and host_type == "vps")


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
