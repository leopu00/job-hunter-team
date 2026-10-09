"""The data folders are fixed, and every piece must agree on them.

docker-compose.yml binds ${HOME}/.jht and ${HOME}/Documents/Job Hunter Team,
the desktop app reads ~/.jht, and on macOS the Podman machine declares exactly
those two folders (any other bind dies with «statfs ... no such file or
directory»). The wrapper alone used to follow JHT_HOME_HOST / JHT_USER_DIR_HOST
wherever they pointed: a moved folder put it out of step with all the others.
Now it refuses that case before any bind, with an error that says what to do.
"""

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"


def functions(*names: str) -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    out = []
    for fn in names:
        match = re.search(rf"^{fn}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        assert match, fn
        out.append(match.group(0))
    return "\n".join(out)


def check(home: Path, **env: str) -> subprocess.CompletedProcess:
    script = ('err() { echo "error: $*" >&2; }\n'
              + functions("host_data_dir_same", "host_data_dirs_supported")
              + "\nhost_data_dirs_supported && echo ok\n")
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30,
                          env={"PATH": "/usr/bin:/bin", "HOME": str(home), **env})


def make_home(tmp_path: Path) -> Path:
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True)
    (home / "Documents" / "Job Hunter Team").mkdir(parents=True)
    return home


def test_no_override_and_the_standard_folders_are_accepted(tmp_path):
    home = make_home(tmp_path)
    assert check(home).stdout.strip() == "ok"
    same = check(home, JHT_HOME_HOST=f"{home}/.jht/",
                 JHT_USER_DIR_HOST=f"{home}/Documents/Job Hunter Team")
    assert same.stdout.strip() == "ok", same.stderr


def test_a_link_to_the_standard_folder_is_the_same_folder(tmp_path):
    home = make_home(tmp_path)
    link = tmp_path / "link-to-jht"
    link.symlink_to(home / ".jht")
    assert check(home, JHT_HOME_HOST=str(link)).stdout.strip() == "ok"


def test_a_moved_jht_home_is_refused_with_a_clear_error(tmp_path):
    home = make_home(tmp_path)
    moved = tmp_path / "elsewhere" / "jht"
    moved.mkdir(parents=True)
    result = check(home, JHT_HOME_HOST=str(moved))
    assert result.returncode == 1 and "ok" not in result.stdout
    assert "data_dir_moved" in result.stderr
    assert str(moved) in result.stderr and f"{home}/.jht" in result.stderr
    assert "statfs" not in result.stderr


def test_a_moved_documents_folder_is_refused_too(tmp_path):
    home = make_home(tmp_path)
    result = check(home, JHT_USER_DIR_HOST=str(tmp_path / "Docs"))
    assert result.returncode == 1
    assert "data_dir_moved" in result.stderr and "JHT_USER_DIR_HOST" in result.stderr


def test_every_start_and_the_only_wrapper_bind_check_before_mounting():
    text = WRAPPER.read_text(encoding="utf-8")
    bind_owner = functions("ensure_bind_owner")
    # ensure_up, up and upgrade all go through ensure_bind_owner, on every OS.
    assert bind_owner.index("host_data_dirs_supported") < bind_owner.index('uname -s')
    for caller in ("ensure_up", "upgrade_activate"):
        body = re.search(rf"^{caller}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        if body:
            assert "ensure_bind_owner" in body.group(0), caller
    legacy = functions("telegram_legacy")
    assert legacy.index("host_data_dirs_supported") < legacy.index("--volume")


def test_compose_wrapper_installer_and_app_name_the_same_two_folders():
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert "- ${HOME}/.jht:/jht_home" in compose
    assert "- ${HOME}/Documents/Job Hunter Team:/jht_user" in compose
    wrapper = WRAPPER.read_text(encoding="utf-8")
    assert 'PODMAN_MOUNT_JHT_HOME="$HOME/.jht"' in wrapper
    assert 'PODMAN_MOUNT_JHT_DOCS="$HOME/Documents/Job Hunter Team"' in wrapper
    supported = functions("host_data_dirs_supported")
    assert 'expected_home="$HOME/.jht"' in supported
    assert 'expected_user="$HOME/Documents/Job Hunter Team"' in supported
    installer = (ROOT / "scripts" / "install.sh").read_text(encoding="utf-8")
    assert 'jht_home_dir="$HOME/.jht" jht_docs_dir="$HOME/Documents/Job Hunter Team"' in installer
    assert '--volume "$jht_home_dir:$jht_home_dir"' in installer
    app = (ROOT / "desktop" / "src-tauri" / "src" / "account_scope.rs").read_text(encoding="utf-8")
    assert '.map(|home| home.join(".jht"))' in app
