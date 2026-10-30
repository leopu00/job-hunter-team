"""host-setup.sh writes ~/.jht/host.env without ever following a link an agent put in its place.

`~/.jht` is mounted read-write in the container, so an agent can replace `host.env` with a link: relative to the container it
dangles, on the host it points into the person's home. The old `> "$HOST_ENV_PATH"` followed it and truncated the file it named
(`.zshrc`, `.ssh/authorized_keys`). The file is now written to a temporary OUTSIDE the mounted folder (an agent could swap a temporary
inside it for a link as soon as it appears) and put in place with `ln`, after the link itself has been removed.
"""

from __future__ import annotations

import os
import stat
import subprocess
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HOST_SETUP = ROOT / "scripts" / "host-setup.sh"
VICTIM = b"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample person@laptop\n"


def _setup(home: Path, *args: str) -> subprocess.CompletedProcess:
    jht_home = home / ".jht"
    env = {**os.environ, "HOME": str(home), "JHT_HOME_HOST": str(jht_home), "TERM": "dumb"}
    for name in ("JHT_LANG", "JHT_USER_TZ", "JHT_HOST_TYPE", "JHT_SKIP_HOST_SETUP"):
        env.pop(name, None)
    return subprocess.run(
        ["bash", str(HOST_SETUP), "--host-type=local", "--non-interactive", *args],
        env=env, capture_output=True, text=True, timeout=30, check=False, stdin=subprocess.DEVNULL,
    )


@pytest.fixture()
def home(tmp_path: Path) -> Path:
    (tmp_path / "home" / ".jht").mkdir(parents=True)
    return tmp_path / "home"


def _victim(home: Path) -> Path:
    path = home / ".ssh" / "authorized_keys"
    path.parent.mkdir()
    path.write_bytes(VICTIM)
    return path


def _assert_regular_host_env(home: Path):
    host_env = home / ".jht" / "host.env"
    assert not host_env.is_symlink() and host_env.is_file()
    text = host_env.read_text(encoding="utf-8")
    assert "JHT_LANG=" in text and "JHT_HOST_TYPE=local" in text and "JHT_USER_TZ=" in text
    assert stat.S_IMODE(host_env.stat().st_mode) == 0o644
    return host_env


def _no_leftovers(home: Path):
    assert sorted(p.name for p in (home / ".jht").iterdir()) == ["host.env", "i18n-prefs.json"]
    assert [p.name for p in home.iterdir() if p.name.startswith(".jht-host-file.")] == []


@pytest.mark.parametrize("target", ("relative", "absolute"))
def test_a_link_to_a_file_outside_the_mounted_folders_is_replaced_and_the_file_stays_intact(home: Path, target: str):
    victim = _victim(home)
    link = home / ".jht" / "host.env"
    link.symlink_to("../.ssh/authorized_keys" if target == "relative" else str(victim))

    done = _setup(home)

    assert done.returncode == 0, done.stderr
    assert victim.read_bytes() == VICTIM, "the file the link named was written through"
    _assert_regular_host_env(home)
    _no_leftovers(home)


def test_a_dangling_link_creates_nothing_where_it_points(home: Path):
    link = home / ".jht" / "host.env"
    link.symlink_to("../created-by-the-link")

    done = _setup(home)

    assert done.returncode == 0, done.stderr
    assert not (home / "created-by-the-link").exists()
    _assert_regular_host_env(home)


def test_a_link_to_a_folder_does_not_receive_the_file(home: Path):
    folder = home / "Documents"
    folder.mkdir()
    (folder / "note.txt").write_text("keep\n", encoding="utf-8")
    (home / ".jht" / "host.env").symlink_to("../Documents")

    done = _setup(home)

    assert done.returncode == 0, done.stderr
    assert sorted(p.name for p in folder.iterdir()) == ["note.txt"]
    assert (folder / "note.txt").read_text(encoding="utf-8") == "keep\n"
    _assert_regular_host_env(home)


def test_a_link_is_not_read_as_the_persons_language(home: Path):
    victim = home / "elsewhere.env"
    victim.write_text("JHT_LANG=pt\nJHT_USER_TZ=America/Sao_Paulo\n", encoding="utf-8")
    (home / ".jht" / "host.env").symlink_to(victim)

    done = _setup(home)

    assert done.returncode == 0, done.stderr
    text = _assert_regular_host_env(home).read_text(encoding="utf-8")
    assert "JHT_LANG=pt" not in text and "Sao_Paulo" not in text
    assert victim.read_text(encoding="utf-8") == "JHT_LANG=pt\nJHT_USER_TZ=America/Sao_Paulo\n"


def test_a_regular_host_env_is_replaced_with_the_three_values_and_no_temporary_is_left(home: Path):
    # a zone no machine running the tests is in: the one chosen earlier has to win over the machine's
    (home / ".jht" / "host.env").write_text("JHT_LANG=it\nJHT_USER_TZ=Pacific/Auckland\n", encoding="utf-8")

    done = _setup(home)

    assert done.returncode == 0, done.stderr
    text = _assert_regular_host_env(home).read_text(encoding="utf-8")
    assert "JHT_LANG=it" in text and "JHT_USER_TZ=Pacific/Auckland" in text
    _no_leftovers(home)


def test_a_folder_in_place_of_host_env_is_refused_and_left_alone(home: Path):
    folder = home / ".jht" / "host.env"
    folder.mkdir()
    (folder / "inside").write_text("keep\n", encoding="utf-8")

    done = _setup(home)

    assert done.returncode != 0
    assert (folder / "inside").read_text(encoding="utf-8") == "keep\n"
    assert sorted(p.name for p in folder.iterdir()) == ["inside"]


def _shim(home: Path, name: str, body: str) -> Path:
    real = subprocess.run(["sh", "-c", f"command -v {name}"], capture_output=True, text=True, check=True).stdout.strip()
    shim_dir = home.parent / "shims"
    shim_dir.mkdir(exist_ok=True)
    shim = shim_dir / name
    shim.write_text("#!/bin/sh\n" + body.replace("@REAL@", real), encoding="utf-8")
    shim.chmod(0o755)
    return shim_dir


def _setup_with_path(home: Path, shim_dir: Path, **extra: str) -> subprocess.CompletedProcess:
    jht_home = home / ".jht"
    env = {**os.environ, "HOME": str(home), "JHT_HOME_HOST": str(jht_home), "TERM": "dumb",
           "PATH": f"{shim_dir}{os.pathsep}{os.environ['PATH']}", **extra}
    for name in ("JHT_LANG", "JHT_USER_TZ", "JHT_HOST_TYPE", "JHT_SKIP_HOST_SETUP"):
        env.pop(name, None)
    return subprocess.run(["bash", str(HOST_SETUP), "--host-type=local", "--non-interactive"],
                          env=env, capture_output=True, text=True, timeout=30, check=False, stdin=subprocess.DEVNULL)


def test_the_temporary_is_created_outside_the_folder_the_agents_can_write(home: Path):
    log = home.parent / "mktemp.log"
    shim_dir = _shim(home, "mktemp", 'printf "%s\\n" "$*" >> "$MKTEMP_LOG"\nexec @REAL@ "$@"\n')

    done = _setup_with_path(home, shim_dir, MKTEMP_LOG=str(log))

    assert done.returncode == 0, done.stderr
    templates = [line for line in log.read_text(encoding="utf-8").splitlines() if "host-file" in line]
    assert templates, "host.env was not written through a temporary"
    assert all(Path(t).parent == home for t in templates), templates
    _assert_regular_host_env(home)


def test_a_link_put_back_while_the_file_is_being_placed_is_not_followed_nor_filled(home: Path):
    # the agent is faster than the installer: right after the old entry is removed it puts a link to a folder there again
    folder = home / "Documents"
    folder.mkdir()
    (folder / "note.txt").write_text("keep\n", encoding="utf-8")
    shim_dir = _shim(home, "rm", '@REAL@ "$@"; rc=$?\ncase "$*" in *host.env) ln -s "$RACE_TARGET" "${@: -1}" ;; esac\nexit $rc\n')
    shim = shim_dir / "rm"
    shim.write_text(shim.read_text(encoding="utf-8").replace("#!/bin/sh", "#!/bin/bash", 1), encoding="utf-8")
    (home / ".jht" / "host.env").write_text("JHT_LANG=it\n", encoding="utf-8")

    done = _setup_with_path(home, shim_dir, RACE_TARGET=str(folder))

    assert done.returncode != 0, "the write went on although the path had changed"
    assert sorted(p.name for p in folder.iterdir()) == ["note.txt"], "the file went into the folder the link names"
    assert [p.name for p in home.iterdir() if p.name.startswith(".jht-host-file.")] == []


def test_the_wrapper_does_not_read_through_a_link_either(home: Path):
    wrapper = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
    start = wrapper.index("jht_host_env_value_valid() {")
    end = wrapper.index("\n}\n", wrapper.index("jht_read_host_env_value() {")) + 3
    functions = wrapper[start:end]
    victim = home / "elsewhere.env"
    victim.write_text("JHT_HOST_TYPE=vps\n", encoding="utf-8")
    link = home / ".jht" / "host.env"
    link.symlink_to(victim)
    plain = home / ".jht" / "plain.env"
    plain.write_text("JHT_HOST_TYPE=local\n", encoding="utf-8")

    def read(path: Path) -> subprocess.CompletedProcess:
        return subprocess.run(["bash", "-c", functions + f'\njht_read_host_env_value "{path}" JHT_HOST_TYPE'],
                              capture_output=True, text=True, timeout=10, check=False)

    assert read(link).returncode != 0 and read(link).stdout == ""
    assert read(plain).stdout == "local"


def test_a_zone_chosen_earlier_survives_the_first_write_of_the_language(home: Path):
    # the first write of host-setup.sh only has the language: it must not drop the zone before it is read
    (home / ".jht" / "host.env").write_text("JHT_USER_TZ=Asia/Kolkata\n", encoding="utf-8")

    done = _setup(home)

    assert done.returncode == 0, done.stderr
    assert "JHT_USER_TZ=Asia/Kolkata" in _assert_regular_host_env(home).read_text(encoding="utf-8")


# ── i18n-prefs.json, the other file host-setup.sh writes in ~/.jht ────────────

def test_the_language_preferences_are_not_written_through_a_link_planted_for_the_pid(home: Path):
    # the old temporary was «i18n-prefs.json.tmp-<pid>» inside the mounted folder: a link planted for the pid made
    # the `>` truncate the file it names. The script is started with a known pid, the link is planted, then it runs.
    victim = _victim(home)
    prefs = home / ".jht" / "i18n-prefs.json"
    prefs.write_text("not json", encoding="utf-8")                 # invalid: host-setup writes it again
    pidfile, go = home.parent / "pid", home.parent / "go"
    env = {**os.environ, "HOME": str(home), "JHT_HOME_HOST": str(home / ".jht"), "TERM": "dumb"}
    for name in ("JHT_LANG", "JHT_USER_TZ", "JHT_HOST_TYPE", "JHT_SKIP_HOST_SETUP"):
        env.pop(name, None)
    script = (f'echo $$ > "{pidfile}"; while [ ! -e "{go}" ]; do sleep 0.02; done; '
              f'exec bash "{HOST_SETUP}" --host-type=local --non-interactive')
    proc = subprocess.Popen(["sh", "-c", script], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, text=True)
    deadline = time.time() + 10
    while not pidfile.exists() or not pidfile.read_text().strip():
        assert time.time() < deadline, "the script did not start"
        time.sleep(0.02)
    pid = pidfile.read_text().strip()
    (home / ".jht" / f"i18n-prefs.json.tmp-{pid}").symlink_to("../.ssh/authorized_keys")
    go.write_text("", encoding="utf-8")
    out, err = proc.communicate(timeout=30)

    assert proc.returncode == 0, err
    assert victim.read_bytes() == VICTIM, "the file the planted link names was written through"
    assert not prefs.is_symlink() and '"locale"' in prefs.read_text(encoding="utf-8")
    assert [p.name for p in home.iterdir() if p.name.startswith(".jht-host-file.")] == []


def test_a_link_in_place_of_the_language_preferences_is_replaced_and_its_target_stays(home: Path):
    victim = _victim(home)
    prefs = home / ".jht" / "i18n-prefs.json"
    prefs.symlink_to("../.ssh/authorized_keys")

    done = _setup(home)

    assert done.returncode == 0, done.stderr
    assert victim.read_bytes() == VICTIM
    assert not prefs.is_symlink() and '"locale"' in prefs.read_text(encoding="utf-8")
    assert stat.S_IMODE(prefs.stat().st_mode) == 0o644


def test_host_setup_writes_nothing_in_the_mounted_folder_by_a_redirect():
    # every file host-setup.sh puts in ~/.jht goes through the one function; a `>` or a `mv` onto them is the old defect
    source = HOST_SETUP.read_text(encoding="utf-8")
    assert '> "$HOST_ENV_PATH"' not in source and '> "$I18N_PREFS' not in source
    assert ".tmp-$$" not in source and "mv -f \"$I18N" not in source
