"""The API key of a run comes from a 0600 file on tmpfs and reaches the agent only through its environment.

The file system check reads /proc/mounts: here a fake mounts file says what is tmpfs, so the tests run on any machine.
Every refusal must happen before the key is read and must never print it.
"""

from __future__ import annotations

import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
import api_key_file as akf  # noqa: E402

SCRIPT = ROOT / "shared" / "skills" / "api_key_file.py"
KEY = "-".join(["sk", "synthetic", "ab" * 12])  # low entropy on purpose: a scanner must not take it for a real key

pytestmark = pytest.mark.skipif(os.name == "nt", reason="POSIX modes and links")


@pytest.fixture
def home(tmp_path):
    """A folder of this user that a fake mounts file declares tmpfs."""
    folder = tmp_path / "secrets"
    folder.mkdir(mode=0o700)
    mounts = tmp_path / "mounts"
    mounts.write_text("overlay / overlay rw 0 0\ntmpfs %s tmpfs rw 0 0\n" % folder, encoding="utf-8")
    return folder, mounts


def write(folder: Path, text=KEY + "\n", mode=0o600, name="key") -> Path:
    path = folder / name
    path.write_text(text, encoding="utf-8")
    path.chmod(mode)
    return path


def refused(path, mounts, **kw) -> str:
    with pytest.raises(akf.KeyFileError) as caught:
        akf.read_key(str(path), mounts=mounts, **kw)
    assert KEY not in str(caught.value)
    return str(caught.value)


# --- the good file -----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("text", [KEY, KEY + "\n", KEY + "\r\n"])
def test_a_one_line_key_is_read_without_its_newline(home, text):
    folder, mounts = home
    assert akf.read_key(str(write(folder, text)), mounts=mounts) == KEY


def test_a_read_only_file_of_the_owner_is_fine(home):
    folder, mounts = home
    assert akf.read_key(str(write(folder, mode=0o400)), mounts=mounts) == KEY


def test_the_path_comes_from_the_environment_when_not_given(home, monkeypatch):
    folder, mounts = home
    monkeypatch.setenv("JHT_API_KEY_FILE", str(write(folder)))
    assert akf.read_key(mounts=mounts) == KEY


# --- the file ----------------------------------------------------------------------------------------------------

def test_no_variable_or_a_path_that_is_not_absolute_or_climbs_is_refused(home, monkeypatch):
    folder, mounts = home
    monkeypatch.delenv("JHT_API_KEY_FILE", raising=False)
    with pytest.raises(akf.KeyFileError, match="not set"):
        akf.read_key(mounts=mounts)
    for bad in ("key", "./key", str(folder / ".." / "secrets" / "key"), "/tmp/a\0b"):
        refused(bad, mounts)


@pytest.mark.parametrize("mode", [0o640, 0o604, 0o644, 0o660, 0o666, 0o700 | 0o060])
def test_any_permission_for_group_or_others_is_refused_before_reading(home, mode):
    folder, mounts = home
    assert "permissions" in refused(write(folder, mode=mode), mounts)


def test_a_file_that_the_owner_cannot_read_is_refused(home):
    folder, mounts = home
    assert "readable" in refused(write(folder, mode=0o200), mounts)


def test_a_link_is_refused_even_to_a_good_file(home):
    folder, mounts = home
    real = write(folder, name="real")
    link = folder / "link"
    link.symlink_to(real)
    assert "link" in refused(link, mounts)


def test_a_second_hard_link_is_refused(home):
    folder, mounts = home
    real = write(folder, name="real")
    os.link(real, folder / "other")
    assert "more than one link" in refused(real, mounts)


def test_a_file_of_another_user_is_refused(home):
    folder, mounts = home
    assert "another user" in refused(write(folder), mounts, uid=os.geteuid() + 1)


@pytest.mark.parametrize("text, what", [("", "empty"), ("x" * 5000, "too big")])
def test_empty_or_huge_files_are_refused(home, text, what):
    folder, mounts = home
    assert what in refused(write(folder, text), mounts)


@pytest.mark.parametrize("text", [KEY + "\nsecond line\n", "sk test with spaces 0123456789", "short", "sk-\x01" + "a" * 30,
                                  "sk-é" + "a" * 30, "\n" + KEY, KEY + "\n\n"])
def test_content_that_is_not_one_plain_key_is_refused_without_printing_it(home, text):
    folder, mounts = home
    assert "one line" in refused(write(folder, text), mounts)


def test_a_directory_is_not_a_key_file(home):
    folder, mounts = home
    (folder / "d").mkdir(mode=0o700)
    assert "regular" in refused(folder / "d", mounts)


# --- where it lives ----------------------------------------------------------------------------------------------

def test_a_file_on_a_disk_is_refused(home, tmp_path):
    folder, _ = home
    disk = tmp_path / "mounts-disk"
    disk.write_text("overlay / overlay rw 0 0\next4 %s ext4 rw 0 0\n" % folder, encoding="utf-8")
    assert "not on tmpfs" in refused(write(folder), disk)


def test_the_longest_mount_point_decides(home, tmp_path):
    folder, _ = home
    mounts = tmp_path / "m"
    mounts.write_text("tmpfs %s tmpfs rw 0 0\next4 %s ext4 rw 0 0\n" % (folder.parent, folder), encoding="utf-8")
    assert "ext4" in refused(write(folder), mounts)
    mounts.write_text("ext4 %s ext4 rw 0 0\ntmpfs %s tmpfs rw 0 0\n" % (folder.parent, folder), encoding="utf-8")
    assert akf.read_key(str(write(folder)), mounts=mounts) == KEY


def test_ramfs_counts_and_a_mount_with_a_similar_name_does_not(home, tmp_path):
    folder, _ = home
    mounts = tmp_path / "m"
    mounts.write_text("ramfs %s ramfs rw 0 0\n" % folder, encoding="utf-8")
    assert akf.read_key(str(write(folder)), mounts=mounts) == KEY
    mounts.write_text("tmpfs %s tmpfs rw 0 0\n" % (str(folder) + "x"), encoding="utf-8")
    assert "not on tmpfs" in refused(write(folder), mounts)


def test_without_proc_mounts_the_answer_is_no(home, tmp_path):
    folder, _ = home
    assert "no " in refused(write(folder), tmp_path / "missing")


def test_a_folder_others_can_write_in_is_refused_unless_it_is_sticky(home):
    folder, mounts = home
    path = write(folder)
    folder.chmod(0o777)
    try:
        assert "writable by others" in refused(path, mounts)
        folder.chmod(0o777 | stat.S_ISVTX)
        assert akf.read_key(str(path), mounts=mounts) == KEY
    finally:
        folder.chmod(0o700)


# --- exec: the key goes to the environment of the command and nowhere else -----------------------------------------

CHILD = """\
import json, os, sys
print(json.dumps({"argv": sys.argv[1:], "has_key": os.environ.get("OPENAI_API_KEY") == %r,
                  "file_var": "JHT_API_KEY_FILE" in os.environ, "other": os.environ.get("KEEP")}))
""" % KEY


def run_exec(folder, mounts, *args, extra_env=None, drop_file=False):
    # the CLI reads the real /proc/mounts: run the module with a fake one through a tiny wrapper
    wrapper = folder.parent / "wrapper.py"
    wrapper.write_text("import sys; sys.path.insert(0, %r)\nimport api_key_file as a\nfrom pathlib import Path\n"
                       "_r = a.read_key\na.read_key = lambda *p, **k: _r(*p, mounts=Path(%r), **k)\nsys.exit(a.main(sys.argv[1:]))\n"
                       % (str(SCRIPT.parent), str(mounts)), encoding="utf-8")
    env = {**os.environ, "KEEP": "yes", **(extra_env or {})}
    env.pop("JHT_API_KEY_FILE", None)
    if not drop_file:
        env["JHT_API_KEY_FILE"] = str(folder / "key")
    return subprocess.run([sys.executable, str(wrapper), *args], capture_output=True, text=True, env=env, timeout=30)


def test_exec_starts_the_command_with_the_key_in_its_environment_and_not_in_its_arguments(home):
    folder, mounts = home
    write(folder)
    child = folder.parent / "child.py"
    child.write_text(CHILD, encoding="utf-8")
    done = run_exec(folder, mounts, "exec", "--env", "OPENAI_API_KEY", "--", sys.executable, str(child), "--model", "m")
    assert done.returncode == 0, done.stderr
    seen = __import__("json").loads(done.stdout)
    assert seen == {"argv": ["--model", "m"], "has_key": True, "file_var": False, "other": "yes"}
    assert KEY not in done.stdout + done.stderr


@pytest.mark.parametrize("break_it", ["mode", "missing", "content", "novar"])
def test_exec_starts_nothing_when_the_file_is_not_right(home, break_it):
    folder, mounts = home
    marker = folder.parent / "started"
    path = write(folder)
    if break_it == "mode":
        path.chmod(0o644)
    elif break_it == "missing":
        path.unlink()
    elif break_it == "content":
        path.write_text("short")
    done = run_exec(folder, mounts, "exec", "--env", "OPENAI_API_KEY", "--", "touch", str(marker), drop_file=break_it == "novar")
    assert done.returncode == akf.EXIT_REFUSED and not marker.exists()
    assert done.stderr.startswith("api_key_file: ") and KEY not in done.stdout + done.stderr


def test_exec_refuses_an_environment_name_that_is_not_a_key_and_a_missing_command(home):
    folder, mounts = home
    write(folder)
    bad = run_exec(folder, mounts, "exec", "--env", "PATH", "--", "true")
    assert bad.returncode == 2 and "invalid choice" in bad.stderr
    none = run_exec(folder, mounts, "exec", "--env", "OPENAI_API_KEY", "--")
    assert none.returncode == akf.EXIT_REFUSED and "no command" in none.stderr
    gone = run_exec(folder, mounts, "exec", "--env", "OPENAI_API_KEY", "--", "/nonexistent/harness")
    assert gone.returncode == 127 and KEY not in gone.stdout + gone.stderr


def test_check_says_ok_and_never_the_key(home):
    folder, mounts = home
    write(folder)
    done = run_exec(folder, mounts, "check")
    assert (done.returncode, done.stdout.strip()) == (0, "ok") and KEY not in done.stderr


def test_the_line_the_launcher_types_works_through_a_shell_and_keeps_the_key_out_of_the_pane_text(home):
    """The exact shape for start-agent: ENV assignments, then the wrapper, then the harness and its arguments."""
    folder, mounts = home
    write(folder)
    child = folder.parent / "child.py"
    child.write_text(CHILD, encoding="utf-8")
    wrapper_py = folder.parent / "wrapper.py"
    run_exec(folder, mounts, "check")  # creates the wrapper that reads the fake mounts file
    line = ("KEEP=from-prefix PI_CODING_AGENT_DIR=/x %s %s exec --env OPENAI_API_KEY -- %s %s --provider openai"
            % (sys.executable, wrapper_py, sys.executable, child))
    assert KEY not in line
    done = subprocess.run(["bash", "-c", line], capture_output=True, text=True, timeout=30,
                          env={**os.environ, "JHT_API_KEY_FILE": str(folder / "key")})
    seen = __import__("json").loads(done.stdout)
    assert seen["has_key"] and seen["argv"] == ["--provider", "openai"] and seen["other"] == "from-prefix"


# ── the key held by a variable of the container (api_key_ref of source env) ───

def run_from_env(*args, **env):
    clean = {k: v for k, v in os.environ.items() if k != "JHT_API_KEY_FILE"}
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True,
                          env={**clean, **env}, timeout=30)


def test_check_from_env_says_ok_and_never_the_key():
    done = run_from_env("check", "--from-env", "MY_RUN_KEY", MY_RUN_KEY=KEY)
    assert (done.returncode, done.stdout.strip()) == (0, "ok") and KEY not in done.stdout + done.stderr


@pytest.mark.parametrize(("value", "what"), [(None, "not set"), ("", "empty"), ("short", "short"), (KEY + " x", "space"), ("a\nb" + KEY, "newline")])
def test_a_variable_that_is_not_one_plain_key_is_refused_without_printing_it(value, what):
    env = {} if value is None else {"MY_RUN_KEY": value}
    done = run_from_env("check", "--from-env", "MY_RUN_KEY", **env)
    assert done.returncode == akf.EXIT_REFUSED, what
    assert done.stderr.startswith("api_key_file: ") and "MY_RUN_KEY" in done.stderr
    assert not value or value not in done.stdout + done.stderr


@pytest.mark.parametrize("name", ["bad name", "1BAD", "A;B", "", "x" * 70])
def test_a_name_that_is_not_a_variable_is_refused(name):
    done = run_from_env("check", "--from-env", name, MY_RUN_KEY=KEY)
    assert done.returncode == akf.EXIT_REFUSED and KEY not in done.stdout + done.stderr


def test_exec_from_env_gives_the_key_under_the_name_of_the_provider_and_drops_the_source(tmp_path):
    child = tmp_path / "child.py"
    child.write_text(CHILD + "\nprint(json.dumps({'src': os.environ.get('MY_RUN_KEY')}))\n", encoding="utf-8")
    done = run_from_env("exec", "--env", "OPENAI_API_KEY", "--from-env", "MY_RUN_KEY", "--", sys.executable, str(child), "--model", "m", MY_RUN_KEY=KEY)
    assert done.returncode == 0, done.stderr
    first, second = done.stdout.splitlines()
    assert __import__("json").loads(first) == {"argv": ["--model", "m"], "has_key": True, "file_var": False, "other": None}
    assert __import__("json").loads(second) == {"src": None}
    assert KEY not in done.stderr


def test_exec_from_env_starts_nothing_when_the_variable_is_not_right(tmp_path):
    marker = tmp_path / "started"
    done = run_from_env("exec", "--env", "OPENAI_API_KEY", "--from-env", "MY_RUN_KEY", "--", "touch", str(marker), MY_RUN_KEY="short")
    assert done.returncode == akf.EXIT_REFUSED and not marker.exists()


@pytest.mark.parametrize("name", ["PATH", "HOME", "FLEETD_TOKEN", "JHT_SECRET_KEY", "SUPABASE_SERVICE_KEY", "TELEGRAM_BOT_KEY",
                                  "NEXT_PUBLIC_KEY", "LD_PRELOAD_KEY", "PYTHONPATH_KEY", "SOME_OTHER_SECRET"])
def test_a_variable_outside_the_key_names_is_refused_with_its_value_set(name):
    done = run_from_env("check", "--from-env", name, **({} if name in ("PATH", "HOME") else {name: KEY}))
    assert done.returncode == akf.EXIT_REFUSED and KEY not in done.stdout + done.stderr


def test_the_key_variable_of_another_provider_is_not_a_source_for_this_one():
    other = run_from_env("check", "--from-env", "ANTHROPIC_API_KEY", "--env", "OPENAI_API_KEY", ANTHROPIC_API_KEY=KEY)
    assert other.returncode == akf.EXIT_REFUSED and "another provider" in other.stderr and KEY not in other.stderr
    own = run_from_env("check", "--from-env", "OPENAI_API_KEY", "--env", "OPENAI_API_KEY", OPENAI_API_KEY=KEY)
    assert own.returncode == 0
    exec_other = run_from_env("exec", "--env", "OPENAI_API_KEY", "--from-env", "MOONSHOT_API_KEY", "--", "true", MOONSHOT_API_KEY=KEY)
    assert exec_other.returncode == akf.EXIT_REFUSED
