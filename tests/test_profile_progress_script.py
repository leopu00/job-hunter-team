"""The script the app sends into the team to read how far the candidate profile is (desktop/src-tauri/src/profile_progress.rs).

It runs here as it runs in the container, against the real ``validate_profile.py`` of the repository: the rows it
answers must agree with the shared list of cases (``shared/config/profile-minimum.json``, the same one the web, the
game's wizard and ``validate_profile.py --minimum`` are proved against), and the email must never be previewed.
Run with: pytest tests/test_profile_progress_script.py -v
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
RUST = (ROOT / "desktop" / "src-tauri" / "src" / "profile_progress.rs").read_text(encoding="utf-8")
SCRIPT = re.search(r'PROFILE_PROGRESS_PY: &str = r#"(.*?)"#;', RUST, re.S).group(1)
SHARED = json.loads((ROOT / "shared" / "config" / "profile-minimum.json").read_text(encoding="utf-8"))
KEYS = SHARED["required"]


def run(home: Path, request: str = '{"op":"read"}', app: Path = ROOT) -> dict:
    env = {**os.environ, "JHT_HOME": str(home), "JHT_APP": str(app), "PYTHONDONTWRITEBYTECODE": "1"}
    done = subprocess.run([sys.executable, "-I", "-c", SCRIPT], input=request + "\n", capture_output=True, text=True,
                          env=env, timeout=60, check=False)
    assert done.returncode == 0, done.stderr
    lines = done.stdout.strip().splitlines()
    assert len(lines) == 1, done.stdout
    return json.loads(lines[0])


def profile_at(tmp_path: Path, content) -> Path:
    folder = tmp_path / "profile"
    folder.mkdir(parents=True, exist_ok=True)
    text = content if isinstance(content, str) else yaml.safe_dump(content, allow_unicode=True)
    (folder / "candidate_profile.yml").write_text(text, encoding="utf-8")
    return tmp_path


def test_the_eight_keys_of_the_script_are_the_shared_list_in_order():
    assert re.search(r"for key in \(" + ",".join(f"'{key}'" for key in KEYS) + r"\):", SCRIPT)


@pytest.mark.parametrize("case", SHARED["cases"], ids=lambda case: case["name"][:60])
def test_every_shared_case_gives_the_rows_the_app_gives(case, tmp_path):
    answer = run(profile_at(tmp_path, case["profile"]))
    if case["profile"] in ({}, None):
        assert answer == {"ok": False, "error": "profile_unavailable"}
        return
    assert answer["ok"] is True
    assert [row["key"] for row in answer["fields"]] == KEYS
    assert {row["key"] for row in answer["fields"] if not row["ok"]} == set(case["missing"]), case["name"]


def test_no_file_and_an_empty_file_are_unavailable_and_a_broken_one_is_unreadable(tmp_path):
    assert run(tmp_path) == {"ok": False, "error": "profile_unavailable"}
    assert run(profile_at(tmp_path, "")) == {"ok": False, "error": "profile_unavailable"}
    assert run(profile_at(tmp_path, "{}")) == {"ok": False, "error": "profile_unavailable"}
    assert run(profile_at(tmp_path, "name: [unclosed")) == {"ok": False, "error": "profile_unreadable"}
    assert run(profile_at(tmp_path, "just a sentence")) == {"ok": False, "error": "profile_unreadable"}
    assert run(profile_at(tmp_path, "- a\n- list")) == {"ok": False, "error": "profile_unreadable"}


def test_an_image_without_the_checker_is_unavailable(tmp_path):
    assert run(profile_at(tmp_path, {"name": "A B"}), app=tmp_path / "no-app") == {"ok": False, "error": "profile_unavailable"}


def test_only_the_read_request_is_answered(tmp_path):
    home = profile_at(tmp_path, {"name": "A B"})
    for bad in ['{"op":"write"}', '{"op":"read","path":"/etc/passwd"}', "{}", "[]", "not json", ""]:
        assert run(home, request=bad) == {"ok": False, "error": "profile_unavailable"}, bad


def test_previews_for_five_counts_for_two_and_the_email_never_shown(tmp_path):
    answer = run(profile_at(tmp_path, {
        "name": "Persona Esempio", "email": "persona@example.invalid", "target_role": "Backend Engineer",
        "location": "Roma, Italia", "experience_years": 4, "seniority_target": "mid",
        "skills": {"primary": ["Python", "SQL"]}, "languages": [{"language": "it", "level": "native"}],
    }))
    rows = {row["key"]: row for row in answer["fields"]}
    assert rows["name"]["preview"] == "Persona Esempio"
    assert rows["target_role"]["preview"] == "Backend Engineer"
    assert rows["location"]["preview"] == "Roma, Italia"
    assert rows["seniority_target"]["preview"] == "mid" and rows["experience_years"]["preview"] == "4"
    assert "preview" not in rows["email"] and rows["email"]["ok"] is True
    assert rows["skills"]["count"] == 2 and rows["languages"]["count"] == 1
    assert "preview" not in rows["skills"] and "preview" not in rows["languages"]
    assert "example.invalid" not in json.dumps(answer)
    assert all(row["ok"] for row in answer["fields"])


def test_a_long_or_unprintable_value_is_cut_to_a_line_of_sixty(tmp_path):
    answer = run(profile_at(tmp_path, {"name": "x" * 200, "location": "Roma\x07\x1b[31m rosso"}))
    rows = {row["key"]: row for row in answer["fields"]}
    assert len(rows["name"]["preview"]) == 60
    assert "\x07" not in rows["location"]["preview"] and "\x1b" not in rows["location"]["preview"]
    assert answer["fields"][3]["ok"] is True


def test_a_profile_file_over_a_megabyte_is_not_loaded_and_is_said_unreadable(tmp_path):
    big = "name: A B\nnotes: " + "x" * (1_048_576 + 10) + "\n"
    assert run(profile_at(tmp_path, big)) == {"ok": False, "error": "profile_unreadable"}
    assert run(profile_at(tmp_path, "name: A B\nnotes: " + "x" * 1000 + "\n"))["ok"] is True


def test_the_skills_folder_is_looked_in_after_the_system_not_before_it(tmp_path):
    assert re.search(r"import yaml\s+sys\.path\.append\(skills\)", SCRIPT)
    assert "sys.path.insert(0" not in SCRIPT


def test_invisible_direction_and_zero_width_characters_are_taken_out_of_a_preview(tmp_path):
    answer = run(profile_at(tmp_path, {"name": "Maria\u202egnirts\u200b ok", "location": "\ufeffRoma"}))
    rows = {row["key"]: row for row in answer["fields"]}
    for text in (rows["name"]["preview"], rows["location"]["preview"]):
        assert not any(ch in text for ch in "\u202e\u200b\ufeff"), repr(text)
