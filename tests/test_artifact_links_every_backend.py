"""The defence of `shared/skills/artifact.py` against links, on every way it has of opening a file.

Linux and macOS open each component with openat + O_NOFOLLOW. Windows has none of that (no O_DIRECTORY, no O_NOFOLLOW, no
dir_fd): the skill used to stop there with an AttributeError. There it refuses a symlink or a junction in every component
under the root and then asks the OPENED file its own final path, which must be the root plus the components that were
meant. These tests run the same refusals through both: the portable way on every machine (on Linux/macOS the final path
of an open file comes from /proc or F_GETPATH, on Windows from the real GetFinalPathNameByHandle), and the openat way
wherever it exists. All files are synthetic.
"""

import importlib.util
import os
import subprocess
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "shared" / "skills" / "artifact.py"
PDF = b"%PDF-1.4\nsynthetic document\n%%EOF\n"
OUTSIDE_PDF = b"%PDF-1.4\nbelongs to somebody else\n%%EOF\n"


def load_skill():
    spec = importlib.util.spec_from_file_location("jht_artifact_links", SKILL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


artifact = load_skill()


def _final_path_here(fd: int) -> str:
    """What the real function asks Windows, asked of the system this runs on."""
    if os.name == "nt":
        return artifact._final_path_of_fd(fd)
    if Path("/proc/self/fd").is_dir():
        return os.readlink(f"/proc/self/fd/{fd}")
    import fcntl
    if not hasattr(fcntl, "F_GETPATH"):
        pytest.skip("no way to ask an open file its path on this system")
    return os.fsdecode(fcntl.fcntl(fd, fcntl.F_GETPATH, b"\0" * 1024)).split("\0", 1)[0]


def link_dir(link: Path, target: Path) -> None:
    """A folder that is a link: a junction on Windows (no privilege needed), a symlink elsewhere."""
    if os.name == "nt":
        done = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(target)], capture_output=True, text=True)
        assert done.returncode == 0, done.stdout + done.stderr
    else:
        link.symlink_to(target, target_is_directory=True)


def link_file(link: Path, target: Path) -> None:
    try:
        link.symlink_to(target)
    except OSError as error:
        if os.name == "nt":
            pytest.skip(f"a file symlink needs a privilege this account has not: {error}")
        raise


@pytest.fixture(params=["portable", "openat"])
def skill(request, tmp_path, monkeypatch):
    if request.param == "openat":
        if os.name == "nt":
            pytest.skip("openat does not exist on Windows: the portable way is the one that runs there")
        monkeypatch.setattr(artifact, "_BACKEND", "posix")
    else:
        monkeypatch.setattr(artifact, "_BACKEND", "portable")
        if os.name != "nt":
            monkeypatch.setattr(artifact, "_final_path_of_fd", _final_path_here)
    area = tmp_path / "area"
    area.mkdir()
    (area / "cv").mkdir()
    monkeypatch.setenv("JHT_ARTIFACT_ROOT", str(area))
    return artifact


@pytest.fixture
def outside(tmp_path):
    folder = tmp_path / "somebody-else"
    folder.mkdir()
    (folder / "cv.pdf").write_bytes(OUTSIDE_PDF)
    return folder


def area_of(tmp_path) -> Path:
    return tmp_path / "area"


# -- the ordinary case, or the refusals prove nothing ---------------------------------------------------------------

def test_a_document_is_written_and_replaced_in_the_upload_folder(skill, tmp_path):
    first = skill.upload("cv.pdf", PDF)
    assert first["ok"] is True and first["path"] == "/jht_user/allegati/cv.pdf", first
    assert (area_of(tmp_path) / "allegati" / "cv.pdf").read_bytes() == PDF
    longer = PDF + b"x" * 500
    assert skill.upload("cv.pdf", longer)["ok"] is True
    shorter = PDF + b"y"
    assert skill.upload("cv.pdf", shorter)["ok"] is True
    assert (area_of(tmp_path) / "allegati" / "cv.pdf").read_bytes() == shorter


def test_a_mounted_document_is_read_from_a_nested_folder(skill, tmp_path):
    nested = area_of(tmp_path) / "nested" / "deeper"
    nested.mkdir(parents=True)
    (nested / "cv.pdf").write_bytes(PDF)
    answer = skill.upload_file("nested/deeper/cv.pdf")
    assert answer["ok"] is True, answer
    assert (area_of(tmp_path) / "allegati" / "cv.pdf").read_bytes() == PDF


def test_a_team_document_is_fetched(skill, tmp_path):
    (area_of(tmp_path) / "cv" / "cv_42.pdf").write_bytes(PDF)
    answer = skill.fetch("/jht_user/cv/cv_42.pdf", "pdf")
    assert answer["ok"] is True and answer["bytes"] == len(PDF), answer


# -- links ------------------------------------------------------------------------------------------------------------

def test_the_upload_folder_that_is_a_link_gets_nothing(skill, tmp_path, outside):
    link_dir(area_of(tmp_path) / "allegati", outside)
    answer = skill.upload("cv.pdf", PDF)
    assert answer["ok"] is False, answer
    assert (outside / "cv.pdf").read_bytes() == OUTSIDE_PDF
    assert sorted(path.name for path in outside.iterdir()) == ["cv.pdf"]


def test_a_root_that_is_a_link_is_refused(skill, tmp_path, outside, monkeypatch):
    real = tmp_path / "real-root"
    real.mkdir()
    link = tmp_path / "root-link"
    link_dir(link, real)
    monkeypatch.setenv("JHT_ARTIFACT_ROOT", str(link))
    assert skill.upload("cv.pdf", PDF)["ok"] is False
    assert not (real / "allegati").exists()


def test_a_mounted_document_behind_a_link_folder_is_not_read(skill, tmp_path, outside):
    link_dir(area_of(tmp_path) / "nested", outside)
    answer = skill.upload_file("nested/cv.pdf")
    assert answer["ok"] is False, answer
    assert "artifact_source_" in answer["error"]
    assert not (area_of(tmp_path) / "allegati").exists()


def test_a_mounted_document_that_is_a_link_is_not_read(skill, tmp_path, outside):
    link_file(area_of(tmp_path) / "cv.pdf", outside / "cv.pdf")
    answer = skill.upload_file("cv.pdf")
    assert answer["ok"] is False, answer
    assert "artifact_source_" in answer["error"]
    assert not (area_of(tmp_path) / "allegati").exists()


def test_a_team_folder_that_is_a_link_leaks_nothing_through_fetch(skill, tmp_path, outside):
    (area_of(tmp_path) / "cv").rmdir()
    link_dir(area_of(tmp_path) / "cv", outside)
    answer = skill.fetch("/jht_user/cv/cv.pdf", "pdf")
    assert answer["ok"] is False and "b64" not in answer, answer


def test_an_upload_over_a_link_document_does_not_touch_its_target(skill, tmp_path, outside):
    (area_of(tmp_path) / "allegati").mkdir()
    link_file(area_of(tmp_path) / "allegati" / "cv.pdf", outside / "cv.pdf")
    answer = skill.upload("cv.pdf", PDF)
    assert answer["ok"] is False, answer
    assert (outside / "cv.pdf").read_bytes() == OUTSIDE_PDF


def test_a_directory_named_like_the_document_is_refused(skill, tmp_path):
    (area_of(tmp_path) / "cv.pdf").mkdir()
    answer = skill.upload_file("cv.pdf")
    assert answer["ok"] is False and "artifact_source_" in answer["error"], answer


# -- a link that appears AFTER the check: only the portable way has that window, and it must close it ----------------

def test_a_link_swapped_in_after_the_check_does_not_truncate_the_target(tmp_path, monkeypatch, outside):
    monkeypatch.setattr(artifact, "_BACKEND", "portable")
    if os.name != "nt":
        monkeypatch.setattr(artifact, "_final_path_of_fd", _final_path_here)
    area = area_of(tmp_path)
    area.mkdir()
    monkeypatch.setenv("JHT_ARTIFACT_ROOT", str(area))
    (area / "allegati").mkdir()
    real_check = artifact._portable_check_dirs

    def check_then_swap(real_root, parts):
        real_check(real_root, parts)
        (area / "allegati").rename(area / "allegati-old")
        link_dir(area / "allegati", outside)

    monkeypatch.setattr(artifact, "_portable_check_dirs", check_then_swap)
    answer = artifact.upload("cv.pdf", PDF)
    assert answer["ok"] is False, answer
    assert (outside / "cv.pdf").read_bytes() == OUTSIDE_PDF, "the file of somebody else was truncated or written"


def test_a_link_swapped_in_after_the_check_is_not_read(tmp_path, monkeypatch, outside):
    monkeypatch.setattr(artifact, "_BACKEND", "portable")
    if os.name != "nt":
        monkeypatch.setattr(artifact, "_final_path_of_fd", _final_path_here)
    area = area_of(tmp_path)
    (area / "nested").mkdir(parents=True)
    (area / "nested" / "cv.pdf").write_bytes(PDF)
    monkeypatch.setenv("JHT_ARTIFACT_ROOT", str(area))
    real_check = artifact._portable_check_dirs

    def check_then_swap(real_root, parts):
        real_check(real_root, parts)
        (area / "nested").rename(area / "nested-old")
        link_dir(area / "nested", outside)

    monkeypatch.setattr(artifact, "_portable_check_dirs", check_then_swap)
    answer = artifact.upload_file("nested/cv.pdf")
    assert answer["ok"] is False and "artifact_source_" in answer["error"], answer
    assert not (area / "allegati").exists()


def test_when_the_final_path_cannot_be_asked_nothing_is_written_or_left_behind(tmp_path, monkeypatch):
    monkeypatch.setattr(artifact, "_BACKEND", "portable")
    area = area_of(tmp_path)
    area.mkdir()
    monkeypatch.setenv("JHT_ARTIFACT_ROOT", str(area))

    def unknown(fd):
        raise OSError(38, "no way to ask")

    monkeypatch.setattr(artifact, "_final_path_of_fd", unknown)
    answer = artifact.upload("cv.pdf", PDF)
    assert answer["ok"] is False, answer
    assert list((area / "allegati").iterdir()) == []
    (area / "cv.pdf").write_bytes(PDF)
    assert artifact.upload_file("cv.pdf")["ok"] is False


# -- the pieces ---------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("raw, expected", [
    ("\\\\?\\C:\\Users\\Synthetic\\a.pdf", "C:\\Users\\Synthetic\\a.pdf"),
    ("\\\\?\\UNC\\server\\share\\a.pdf", "\\\\server\\share\\a.pdf"),
    ("C:\\plain\\a.pdf", "C:\\plain\\a.pdf"),
])
def test_the_extended_prefix_of_a_final_path_is_taken_off(raw, expected):
    assert artifact._strip_extended_prefix(raw) == expected


@pytest.mark.parametrize("attributes, tag, is_link", [
    (0x400, 0xA000000C, True),    # symlink
    (0x400, 0xA0000003, True),    # junction
    (0x400, None, True),          # a reparse point whose kind is not told: a link until shown otherwise
    (0x400, 0x9000001A, False),   # a cloud placeholder is a file; the final path says where it really is
    (0x20, None, False),
])
def test_which_reparse_points_count_as_links(attributes, tag, is_link):
    info = types.SimpleNamespace(st_mode=0o100644, st_file_attributes=attributes)
    if tag is not None:
        info.st_reparse_tag = tag
    assert artifact._is_link(info) is is_link


def test_a_symlink_is_a_link_wherever_it_is_seen():
    assert artifact._is_link(types.SimpleNamespace(st_mode=0o120777)) is True


def test_the_comparison_of_paths_ignores_the_case_only_where_the_system_does():
    assert artifact._same_path(os.path.join("a", "B"), os.path.join("a", "B", ".." , "B"))
    if os.name == "nt":
        assert artifact._same_path("C:\\Users\\X\\a.pdf", "c:\\users\\x\\A.PDF")


def test_the_way_of_opening_is_the_one_the_system_has():
    expected = "posix" if hasattr(os, "O_DIRECTORY") and hasattr(os, "O_NOFOLLOW") else "portable"
    assert artifact._BACKEND == expected
    if os.name == "nt":
        assert artifact._BACKEND == "portable"
