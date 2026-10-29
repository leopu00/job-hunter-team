"""The provider's sign-in on the team's home (shared/skills/provider_signin.py): see it, and take it off.

Every test runs on a private scratch home of synthetic files; nothing here can reach a real home. The race
tests swap a folder for a link WHILE the script runs and check that the link is not followed.
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location("provider_signin", ROOT / "shared" / "skills" / "provider_signin.py")
ps = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ps)


def home_with(tmp_path: Path, config: dict | str | None = None) -> Path:
    home = tmp_path / "home"
    home.mkdir()
    text = config if isinstance(config, str) else json.dumps({"active_provider": "codex"} if config is None else config)
    (home / "jht.config.json").write_text(text)
    return home


def put(home: Path, relative: str, text: str = '{"token":"synthetic"}') -> None:
    (home / relative).parent.mkdir(parents=True, exist_ok=True)
    (home / relative).write_text(text)


def test_status_signed_in_means_the_marker_of_the_active_provider_is_there_and_a_vendor_name_counts_as_its_cli(tmp_path):
    home = home_with(tmp_path, {"active_provider": "openai"})
    assert ps.status(str(home)) == {"ok": True, "provider": "codex", "authenticated": False}
    put(home, ".codex/auth.json")
    assert ps.status(str(home)) == {"ok": True, "provider": "codex", "authenticated": True}


def test_logout_removes_the_files_of_the_active_provider_and_no_others_and_says_the_truth(tmp_path):
    home = home_with(tmp_path)
    put(home, ".codex/auth.json")
    put(home, ".config/codex/credentials.json")
    put(home, ".codex/config.toml", 'model = "synthetic"')
    put(home, ".claude/.credentials.json")
    put(home, "profile/candidate_profile.yml", "name: Synthetic")
    assert ps.logout(str(home)) == {"ok": True, "provider": "codex", "authenticated": False, "removed": 2}
    assert not (home / ".codex/auth.json").exists() and not (home / ".config/codex/credentials.json").exists()
    for kept in (".codex/config.toml", ".claude/.credentials.json", "profile/candidate_profile.yml", "jht.config.json"):
        assert (home / kept).exists(), kept
    assert ps.status(str(home)) == {"ok": True, "provider": "codex", "authenticated": False}


@pytest.mark.parametrize("provider", sorted(ps.CREDENTIAL_FILES))
def test_each_provider_has_its_own_closed_list_of_six_files_at_most(tmp_path, provider):
    files = ps.CREDENTIAL_FILES[provider]
    assert 3 <= len(files) <= 6
    home = home_with(tmp_path, {"active_provider": provider})
    for relative in files:
        put(home, relative)
    assert ps.logout(str(home)) == {"ok": True, "provider": provider, "authenticated": False, "removed": len(files)}


def test_kimi_takes_off_the_credentials_and_never_the_settings_of_its_cli(tmp_path):
    home = home_with(tmp_path, {"active_provider": "kimi"})
    for relative in (".kimi/credentials/kimi-code.json", ".kimi/credentials.json"):
        put(home, relative)
    for settings in (".kimi/config.json", ".config/kimi/config.json", ".kimi/kimi.json", ".kimi/config.toml"):
        put(home, settings, '{"default_model":"synthetic","work_dirs":[]}')
    assert ps.logout(str(home))["removed"] == 2
    for settings in (".kimi/config.json", ".config/kimi/config.json", ".kimi/kimi.json", ".kimi/config.toml"):
        assert (home / settings).read_text() == '{"default_model":"synthetic","work_dirs":[]}', settings


def test_nothing_to_remove_is_a_sign_out_already_and_not_an_error(tmp_path):
    home = home_with(tmp_path, {"active_provider": "kimi"})
    assert ps.logout(str(home)) == {"ok": True, "provider": "kimi", "authenticated": False, "removed": 0}


def test_a_folder_on_the_way_that_is_a_link_is_not_followed_and_the_answer_is_not_disconnected(tmp_path):
    home = home_with(tmp_path)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "auth.json").write_text("not the home")
    os.symlink(elsewhere, home / ".codex")
    assert (home / ".codex/auth.json").read_text() == "not the home"
    assert ps.logout(str(home)) == {"ok": False, "error": "provider_logout_incomplete"}
    assert (elsewhere / "auth.json").read_text() == "not the home"
    assert ps.status(str(home))["authenticated"] is True


def test_a_link_in_place_of_the_file_is_left_alone_and_the_answer_is_not_disconnected(tmp_path):
    home = home_with(tmp_path)
    outside = tmp_path / "outside.json"
    outside.write_text("outside")
    (home / ".codex").mkdir()
    os.symlink(outside, home / ".codex/auth.json")
    put(home, ".config/codex/credentials.json")
    assert ps.logout(str(home)) == {"ok": False, "error": "provider_logout_incomplete"}
    assert outside.read_text() == "outside"
    assert not (home / ".config/codex/credentials.json").exists(), "the plain file of the list still went"


def test_a_folder_in_place_of_the_file_is_left_alone_and_the_answer_is_not_disconnected(tmp_path):
    home = home_with(tmp_path)
    (home / ".codex/auth.json").mkdir(parents=True)
    (home / ".codex/auth.json/inside").write_text("x")
    assert ps.logout(str(home)) == {"ok": False, "error": "provider_logout_incomplete"}
    assert (home / ".codex/auth.json/inside").exists()


def test_a_file_written_back_by_an_agent_that_was_still_running_is_not_told_as_disconnected(tmp_path):
    home = home_with(tmp_path)
    put(home, ".codex/auth.json")

    def writes_back(name, dir_fd):
        os.unlink(name, dir_fd=dir_fd)
        fd = os.open(name, os.O_WRONLY | os.O_CREAT, 0o600, dir_fd=dir_fd)
        os.write(fd, b'{"token":"renewed"}')
        os.close(fd)

    assert ps.logout(str(home), unlink=writes_back) == {"ok": False, "error": "provider_logout_incomplete"}
    assert ps.status(str(home))["authenticated"] is True


def test_an_unlink_that_fails_for_any_reason_but_not_there_is_a_failure_and_not_a_disconnection(tmp_path):
    home = home_with(tmp_path)
    put(home, ".codex/auth.json")

    def denied(name, dir_fd):
        raise PermissionError("denied")

    assert ps.logout(str(home), unlink=denied) == {"ok": False, "error": "provider_logout_failed"}
    assert (home / ".codex/auth.json").exists()


def test_a_folder_swapped_for_a_link_while_the_file_is_being_removed_is_not_followed(tmp_path):
    """The window the walk by folder closes: between the look and the unlink an agent that runs puts a link where
    the folder was, to a folder with a file of the same name. The unlink goes to the folder already open."""
    home = home_with(tmp_path)
    put(home, ".codex/auth.json", "the team's own")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "auth.json").write_text("not the home")

    def swaps_then_unlinks(name, dir_fd):
        os.rename(home / ".codex", home / ".codex.moved")
        os.symlink(elsewhere, home / ".codex")
        os.unlink(name, dir_fd=dir_fd)

    result = ps.logout(str(home), unlink=swaps_then_unlinks)
    assert (elsewhere / "auth.json").read_text() == "not the home", "the file the link leads to must stay"
    assert not (home / ".codex.moved/auth.json").exists(), "the file of the team went, through the folder held open"
    assert result == {"ok": False, "error": "provider_logout_incomplete"}, "a link is where the folder was: not told as disconnected"


def test_a_folder_swapped_for_a_link_between_the_look_and_the_open_is_not_followed(tmp_path, monkeypatch):
    home = home_with(tmp_path)
    put(home, ".codex/auth.json")
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "auth.json").write_text("not the home")
    real_stat = os.stat
    swapped = []

    def stat_then_swap(path, *args, **kwargs):
        result = real_stat(path, *args, **kwargs)
        if path == ".codex" and not swapped:
            swapped.append(True)
            os.rename(home / ".codex", home / ".codex.moved")
            os.symlink(elsewhere, home / ".codex")
        return result

    monkeypatch.setattr(os, "stat", stat_then_swap)
    assert ps.classify(str(home), ".codex/auth.json") == "unsafe"
    assert swapped
    monkeypatch.undo()
    assert (elsewhere / "auth.json").read_text() == "not the home"


@pytest.mark.parametrize(
    "config", [{"active_provider": "../../etc"}, {"active_provider": ""}, {"active_provider": "codex/../claude"}, {}, {"active_provider": 7}, [], "{not json"]
)
def test_the_provider_comes_from_the_config_alone_and_a_config_an_agent_wrote_cannot_name_a_path(tmp_path, config):
    home = home_with(tmp_path, config)
    put(home, ".codex/auth.json")
    assert ps.logout(str(home)) == {"ok": False, "error": "provider_unknown"}
    assert (home / ".codex/auth.json").exists()


def test_a_config_that_holds_paths_of_its_own_is_read_for_the_name_only(tmp_path):
    home = home_with(tmp_path, {"active_provider": "codex", "providers": {"codex": {"auth_method": "subscription", "path": "/etc/passwd", "files": ["../x"]}}})
    put(home, ".codex/auth.json")
    assert ps.logout(str(home))["ok"] is True


def test_only_a_subscription_sign_in_is_taken_off_an_api_key_is_not_a_login_to_remove(tmp_path):
    home = home_with(tmp_path, {"active_provider": "codex", "providers": {"codex": {"auth_method": "api_key"}}})
    put(home, ".codex/auth.json")
    assert ps.logout(str(home)) == {"ok": False, "error": "provider_not_subscription"}
    assert (home / ".codex/auth.json").exists()


def test_the_door_takes_status_or_logout_and_no_more(tmp_path, capsys):
    home = home_with(tmp_path)
    for argv in ([], ["reset"], ["logout", "claude"], ["status", "--all"], ["logout", "../x"], [""], ["LOGOUT"]):
        assert ps.main(argv, str(home)) == 100
        assert json.loads(capsys.readouterr().out) == {"ok": False, "error": "agent_control_invalid"}
    put(home, ".codex/auth.json")
    assert ps.main(["status"], str(home)) == 0
    assert json.loads(capsys.readouterr().out) == {"ok": True, "provider": "codex", "authenticated": True}
    assert ps.main(["logout"], str(home)) == 0
    assert json.loads(capsys.readouterr().out)["removed"] == 1
    assert ps.main(["logout"], str(home)) == 0
    assert json.loads(capsys.readouterr().out)["removed"] == 0


def test_a_failure_exits_one_with_its_closed_code(tmp_path, capsys):
    home = home_with(tmp_path, {})
    assert ps.main(["logout"], str(home)) == 1
    assert json.loads(capsys.readouterr().out) == {"ok": False, "error": "provider_unknown"}


def test_the_script_never_names_a_path_from_outside_and_never_walks_by_a_whole_path():
    source = (ROOT / "shared" / "skills" / "provider_signin.py").read_text()
    code = source.split('"""', 2)[2]
    # the removal is relative to a folder already open, never a path
    assert "dir_fd=fd" in code and "O_NOFOLLOW" in code
    for forbidden in ("os.remove(", "shutil", "os.walk", "subprocess", "os.system", "rmtree", "os.environ", "sys.argv[2"):
        assert forbidden not in code, forbidden
