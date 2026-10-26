"""What the broker needs from outside the standard library, for the live tests.

tests/test_broker_socket_live.py starts the real `shared/broker` code in a bare
python:3.11-slim container, with no network.  When the notary began to import
tldextract (T68) that image could not start the broker any more, and the ten
live cases were red for two days: the product image has the dependency, the
test image did not.  This module keeps the list in one place, builds the pinned
and hashed requirements the test installs into a volume, and reads the broker's
sources to say which third-party import is missing from that list.
"""

from __future__ import annotations

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BROKER = ROOT / "shared" / "broker"
PINS = ROOT / "tests" / "requirements-app-ci.txt"

# import name -> the distribution that provides it.  Every third-party module
# the broker imports (directly) is a key here; a new import is a red test
# (test_broker_test_stack.py) until it is added.
IMPORTS = {"tldextract": "tldextract"}

# The distributions installed into the test stack: the ones above and what they
# need to be imported.  All pure Python or wheels with a pure fallback; versions
# and hashes come from tests/requirements-app-ci.txt, the file the CI already
# installs with --require-hashes.
DISTRIBUTIONS = (
    "tldextract",
    "requests",
    "requests-file",
    "idna",
    "filelock",
    "urllib3",
    "certifi",
    "charset-normalizer",
)


def _blocks(text: str) -> dict[str, str]:
    """name -> its whole block (`name==version \\` and the --hash lines) in a pip-compile file."""
    blocks: dict[str, list[str]] = {}
    current = None
    for line in text.splitlines():
        if line and not line[0].isspace() and not line.startswith("#"):
            current = line.split("==", 1)[0].strip().lower().replace("_", "-")
            blocks[current] = [line]
        elif current and line.strip().startswith("--hash="):
            blocks[current].append(line)
        elif current and not line.strip():
            current = None
    return {name: "\n".join(lines) for name, lines in blocks.items()}


def requirements_text() -> str:
    """The pinned, hashed requirements of DISTRIBUTIONS, for `pip install --require-hashes --no-deps`."""
    blocks = _blocks(PINS.read_text(encoding="utf-8"))
    missing = [name for name in DISTRIBUTIONS if name not in blocks]
    if missing:
        raise AssertionError(
            f"{PINS.relative_to(ROOT)} has no pinned entry for {', '.join(missing)}: "
            "the broker's live test installs these into its container"
        )
    return "\n".join(blocks[name] for name in DISTRIBUTIONS) + "\n"


def third_party_imports() -> dict[str, list[str]]:
    """Top-level modules the broker's sources import that are not the standard library or the repository's own."""
    # The repository's own modules (the broker puts shared/skills on its path by itself).
    shared = ROOT / "shared"
    local = {p.stem for p in shared.rglob("*.py") if "node_modules" not in p.parts} | {
        p.name for p in shared.iterdir() if p.is_dir()
    }
    found: dict[str, list[str]] = {}
    for path in sorted(BROKER.glob("*.py")):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                names = [node.module]
            else:
                continue
            for name in names:
                top = name.split(".")[0]
                if top in sys.stdlib_module_names or top in local or top == "__future__":
                    continue
                found.setdefault(top, []).append(path.name)
    return found
