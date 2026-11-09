"""The `web/` tree stays out of the runtime image, and nothing that runs in the container reads it.

~46 MB of site, routes and assets were copied into every image and downloaded at every first setup. The check that the
layer really has no `app/web` is in test_image_context.py (it needs docker); this one needs nothing: the ignore line is
there, the two exceptions that brought parts of it back are gone, and no runtime file names a path under `/app/web`
(the Dockerfile only makes the empty `.next` folder the old dev compose chowns).
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ("cli/src", "shared", ".launcher", "agents/_tools", "agents/_skills", "agent-harness/runtime/src")
SOURCE_SUFFIXES = {".py", ".js", ".mjs", ".ts", ".sh", ""}


def _ignore_lines() -> list[str]:
    return [line.strip() for line in (ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.lstrip().startswith("#")]


def test_the_web_tree_is_ignored_and_not_brought_back():
    lines = _ignore_lines()
    assert "web/" in lines
    assert not [line for line in lines if line.startswith("!web")], lines


def test_nothing_that_runs_in_the_container_reads_app_web():
    readers = []
    for folder in RUNTIME:
        for path in (ROOT / folder).rglob("*"):
            if path.is_file() and path.suffix in SOURCE_SUFFIXES and "node_modules" not in path.parts:
                try:
                    text = path.read_text(encoding="utf-8")
                except (UnicodeDecodeError, OSError):
                    continue
                if "/app/web" in text:
                    readers.append(str(path.relative_to(ROOT)))
    assert readers == []
