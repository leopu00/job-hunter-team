"""JHT-T355: the profile as it was when the run began (shared/skills/launch_profile.py). Synthetic profile, private home."""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
import launch_profile  # noqa: E402


def _profile(home, text):
    (home / "profile" / "summaries").mkdir(parents=True, exist_ok=True)
    (home / "profile" / "candidate_profile.yml").write_text(text, encoding="utf-8")
    (home / "profile" / "summaries" / "preferences.md").write_text("synthetic\n", encoding="utf-8")


def test_a_copy_is_kept_and_not_replaced_without_force(tmp_path):
    _profile(tmp_path, "target_role: A\n")
    out = launch_profile.save(tmp_path)
    assert out["saved"] and out["files"] == 2
    _profile(tmp_path, "target_role: B\n")                       # the person changes it while the team works
    assert launch_profile.save(tmp_path)["kept"] is True
    assert (tmp_path / "profile-at-start" / "candidate_profile.yml").read_text() == "target_role: A\n"
    launch_profile.save(tmp_path, force=True)                    # a new run begins
    assert (tmp_path / "profile-at-start" / "candidate_profile.yml").read_text() == "target_role: B\n"
    assert (tmp_path / "profile-at-start" / "summaries" / "preferences.md").exists()
    assert launch_profile.status(tmp_path)["saved"] is True
    assert not [p for p in tmp_path.iterdir() if p.name.startswith(".profile-at-start")], "no leftover temporary folder"


def test_no_profile_no_copy_and_a_link_is_never_followed(tmp_path):
    assert launch_profile.save(tmp_path) == {"saved": False, "reason": "no_profile"}
    _profile(tmp_path, "target_role: A\n")
    (tmp_path / "secret.txt").write_text("outside\n", encoding="utf-8")
    (tmp_path / "profile" / "link.txt").symlink_to(tmp_path / "secret.txt")
    launch_profile.save(tmp_path)
    assert not (tmp_path / "profile-at-start" / "link.txt").exists()
    assert json.loads((tmp_path / "profile-at-start" / ".saved.json").read_text())["files"] == 2



def test_a_save_that_died_leaves_nothing_behind_after_the_next_one(tmp_path):
    _profile(tmp_path, "target_role: A\n")
    launch_profile.save(tmp_path)
    # a temporary copy and an old copy left by a process that died between its renames
    (tmp_path / ".profile-at-start-abc123").mkdir()
    (tmp_path / ".profile-at-start-abc123" / "candidate_profile.yml").write_text("half\n", encoding="utf-8")
    (tmp_path / ".profile-at-start-old-4242").mkdir()
    launch_profile.save(tmp_path, force=True)
    assert not [p for p in tmp_path.iterdir() if p.name.startswith(".profile-at-start")]
    assert launch_profile.status(tmp_path)["saved"] is True


def test_an_old_copy_alone_goes_back_in_place(tmp_path):
    _profile(tmp_path, "target_role: A\n")
    launch_profile.save(tmp_path)
    # died after moving the copy aside and before putting the new one in place
    os.replace(tmp_path / "profile-at-start", tmp_path / ".profile-at-start-old-4242")
    assert launch_profile.clear_leftovers(tmp_path) == [("restored", ".profile-at-start-old-4242")]
    assert launch_profile.status(tmp_path)["saved"] is True
    _profile(tmp_path, "target_role: B\n")
    assert launch_profile.save(tmp_path)["kept"] is True        # the copy of the run going on is kept
    assert (tmp_path / "profile-at-start" / "candidate_profile.yml").read_text() == "target_role: A\n"
