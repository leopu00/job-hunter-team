"""The full Chromium of the closer in the volume of the extras image (shared/skills/playwright_extras.py): trusted only when it is in the
folder of the digest the host gave, with the marker written last and a plain executable; the closer opens it as `executable_path` only
for a browser with a window. Made-up trees under tmp_path, nothing real is launched."""
from __future__ import annotations

import importlib.util
import os
import stat
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
spec = importlib.util.spec_from_file_location("playwright_extras", SKILLS / "playwright_extras.py")
extras = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extras)

DIGEST = "sha256:" + "ab12" * 16
OTHER = "sha256:" + "cd34" * 16


def make_image(tmp_path: Path) -> Path:
    source = tmp_path / "image-playwright"
    chrome = source / "chromium-1187" / "chrome-linux"
    chrome.mkdir(parents=True)
    (chrome / "chrome").write_text("#!/bin/sh\n", encoding="utf-8")
    (chrome / "chrome").chmod(0o755)
    (chrome / "icudtl.dat").write_text("data", encoding="utf-8")
    (chrome / "rpm.deps").write_text("libs", encoding="utf-8")  # the installer's lists, readable by root only in the real image
    (chrome / "deb.deps").write_text("libs", encoding="utf-8")
    (source / "chromium_headless_shell-1187").mkdir()  # the shell of the scout is not copied
    (source / "chromium_headless_shell-1187" / "headless").write_text("x", encoding="utf-8")
    return source


def env_for(volume: Path) -> dict:
    return {"JHT_PLAYWRIGHT_EXTRAS": str(volume)}


def test_populate_copies_the_full_browser_and_the_marker_is_there_and_the_closer_finds_it(tmp_path):
    source, volume = make_image(tmp_path), tmp_path / "volume"
    volume.mkdir()
    assert extras.populate(DIGEST, source, volume) == 0
    folder = volume / extras.folder_name(DIGEST)
    assert (folder / ".complete").read_text(encoding="ascii") == DIGEST + "\n"
    assert sorted(entry.name for entry in folder.iterdir() if entry.name != ".complete") == ["chromium-1187"], "the headless shell stays in the image"
    assert extras.headful_executable(env_for(volume)) == str(folder / "chromium-1187" / "chrome-linux" / "chrome")
    copied = sorted(entry.name for entry in (folder / "chromium-1187" / "chrome-linux").iterdir())
    assert copied == ["chrome", "icudtl.dat"], "the browser and its data, not the lists of packages only root reads"


def test_a_copy_that_breaks_leaves_no_folder_and_no_marker(tmp_path, monkeypatch):
    source, volume = make_image(tmp_path), tmp_path / "volume"
    volume.mkdir()
    def broken(*_a, **_k):
        raise OSError("disk full")
    monkeypatch.setattr(extras.shutil, "copytree", broken)
    assert extras.populate(DIGEST, source, volume) == 1
    assert list(volume.iterdir()) == []
    assert extras.headful_executable(env_for(volume)) is None


def test_the_marker_is_the_last_thing_written(tmp_path, monkeypatch):
    source, volume = make_image(tmp_path), tmp_path / "volume"
    volume.mkdir()
    real_copytree, seen, depth = extras.shutil.copytree, [], []
    def watching(src, dst, *args, **kwargs):  # shutil calls itself for the folders inside: only the outermost call is watched
        outer = not depth
        depth.append(1)
        try:
            if outer:
                seen.append((Path(dst).parent / extras.MARKER).exists())
            out = real_copytree(src, dst, *args, **kwargs)
            if outer:
                seen.append((Path(dst).parent / extras.MARKER).exists())
            return out
        finally:
            depth.pop()
    monkeypatch.setattr(extras.shutil, "copytree", watching)
    assert extras.populate(DIGEST, source, volume) == 0
    assert seen == [False, False] and (volume / extras.folder_name(DIGEST) / extras.MARKER).is_file()


def test_a_folder_without_the_marker_is_never_trusted_and_is_made_again(tmp_path):
    source, volume = make_image(tmp_path), tmp_path / "volume"
    half = volume / extras.folder_name(DIGEST) / "chromium-1187" / "chrome-linux"
    half.mkdir(parents=True)
    (half / "chrome").write_text("#!/bin/sh\n", encoding="utf-8")
    (half / "chrome").chmod(0o755)
    assert extras.headful_executable(env_for(volume)) is None
    assert extras.populate(DIGEST, source, volume) == 0
    assert extras.headful_executable(env_for(volume)) is not None


def test_populate_twice_is_a_no_op_and_a_new_digest_drops_the_old_folder_only_after_the_new_one_is_whole(tmp_path):
    source, volume = make_image(tmp_path), tmp_path / "volume"
    volume.mkdir()
    extras.populate(DIGEST, source, volume)
    first = volume / extras.folder_name(DIGEST)
    stamp = (first / ".complete").stat().st_mtime_ns
    assert extras.populate(DIGEST, source, volume) == 0 and (first / ".complete").stat().st_mtime_ns == stamp
    assert extras.populate(OTHER, source, volume) == 0
    assert [entry.name for entry in volume.iterdir()] == [extras.folder_name(OTHER)]
    assert extras.headful_executable(env_for(volume)) == str(volume / extras.folder_name(OTHER) / "chromium-1187" / "chrome-linux" / "chrome")


def test_the_old_folder_stays_when_the_new_copy_fails(tmp_path, monkeypatch):
    source, volume = make_image(tmp_path), tmp_path / "volume"
    volume.mkdir()
    extras.populate(DIGEST, source, volume)
    monkeypatch.setattr(extras.shutil, "copytree", lambda *_a, **_k: (_ for _ in ()).throw(OSError("x")))
    assert extras.populate(OTHER, source, volume) == 1
    assert [entry.name for entry in volume.iterdir()] == [extras.folder_name(DIGEST)]


@pytest.mark.parametrize("digest", ["", "latest", "sha256:abc", "sha256:" + "G" * 64, "sha256:" + "ab" * 32 + "\n; rm"])
def test_populate_refuses_a_digest_that_is_not_one(tmp_path, digest):
    source, volume = make_image(tmp_path), tmp_path / "volume"
    volume.mkdir()
    assert extras.populate(digest, source, volume) == 2 and list(volume.iterdir()) == []


@pytest.mark.parametrize("written", ["", "latest", "sha256:abc", OTHER, "sha256:" + "ab12" * 15 + "ab1g"])
def test_a_marker_that_is_not_the_digest_of_its_own_folder_is_not_trusted(tmp_path, written):
    source, volume = make_image(tmp_path), tmp_path / "volume"
    volume.mkdir()
    extras.populate(DIGEST, source, volume)
    (volume / extras.folder_name(DIGEST) / ".complete").write_text(written + "\n", encoding="ascii")
    assert extras.headful_executable(env_for(volume)) is None


def test_a_folder_that_is_not_named_with_sixteen_hex_is_not_looked_at(tmp_path):
    source, volume = make_image(tmp_path), tmp_path / "volume"
    volume.mkdir()
    extras.populate(DIGEST, source, volume)
    (volume / extras.folder_name(DIGEST)).rename(volume / "latest")
    assert extras.headful_executable(env_for(volume)) is None


def test_with_two_whole_folders_the_newer_marker_wins(tmp_path):
    source, volume = make_image(tmp_path), tmp_path / "volume"
    volume.mkdir()
    extras.populate(DIGEST, source, volume)
    older = volume / extras.folder_name(DIGEST)
    newer = volume / extras.folder_name(OTHER)
    import shutil
    shutil.copytree(older, newer, symlinks=True)
    (newer / ".complete").write_text(OTHER + "\n", encoding="ascii")
    os.utime(older / ".complete", (1_000_000_000, 1_000_000_000))
    assert extras.headful_executable(env_for(volume)).startswith(str(newer))


@pytest.mark.skipif(sys.platform == "win32", reason="links and modes of the Linux container")
def test_a_link_in_place_of_the_folder_the_marker_or_the_binary_is_refused_and_so_is_a_binary_that_cannot_run(tmp_path):
    source, volume = make_image(tmp_path), tmp_path / "volume"
    volume.mkdir()
    extras.populate(DIGEST, source, volume)
    folder = volume / extras.folder_name(DIGEST)
    chrome = folder / "chromium-1187" / "chrome-linux" / "chrome"
    chrome.chmod(0o644)
    assert extras.headful_executable(env_for(volume)) is None
    chrome.chmod(0o755)
    assert extras.headful_executable(env_for(volume)) is not None
    real = tmp_path / "elsewhere"
    folder.rename(real)
    folder.symlink_to(real, target_is_directory=True)
    assert extras.headful_executable(env_for(volume)) is None
    folder.unlink()
    real.rename(folder)
    marker = folder / ".complete"
    marker.rename(tmp_path / "marker")
    marker.symlink_to(tmp_path / "marker")
    assert extras.headful_executable(env_for(volume)) is None


def test_an_image_without_a_browser_makes_nothing(tmp_path):
    empty, volume = tmp_path / "empty", tmp_path / "volume"
    empty.mkdir()
    volume.mkdir()
    assert extras.populate(DIGEST, empty, volume) == 3 and list(volume.iterdir()) == []


def test_the_command_line_refuses_anything_but_populate_with_three_arguments():
    assert extras.main([]) == 2 and extras.main(["populate", DIGEST]) == 2 and extras.main(["run", "a", "b", "c"]) == 2


def test_only_a_window_browser_gets_the_executable_of_the_volume(tmp_path, monkeypatch):
    sys.path.insert(0, str(SKILLS))
    try:
        import apply_flow_browser
    finally:
        sys.path.remove(str(SKILLS))
    source, volume = make_image(tmp_path), tmp_path / "volume"
    volume.mkdir()
    extras.populate(DIGEST, source, volume)
    monkeypatch.setenv("JHT_PLAYWRIGHT_EXTRAS", str(volume))
    window = type("Flow", (), {"headless": False})()
    headless = type("Flow", (), {"headless": True})()
    expected = {"executable_path": extras.headful_executable(env_for(volume))}
    assert apply_flow_browser.FlowBrowserMixin._window_browser(window) == expected
    assert apply_flow_browser.FlowBrowserMixin._window_browser(headless) == {}
    monkeypatch.setenv("JHT_PLAYWRIGHT_EXTRAS", str(tmp_path / "empty-volume"))
    assert apply_flow_browser.FlowBrowserMixin._window_browser(window) == {}, "nothing in the volume: the browser the image always had"
