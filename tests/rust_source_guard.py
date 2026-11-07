"""Shared acquisition for QA guards that consume native Rust sources.

Paths are input manifests, not identities of symbols. The module graph resolves
the compiler's real modules; symbol acquisition rejects missing/duplicate code.
Capture/frozen-snapshot comparison lives in test-only collectors, not here.
"""

import re
from pathlib import Path

from rust_source_graph import RustTree, raw_rust_files
from rust_source_lex import mask, normalize

ROOT = Path(__file__).resolve().parents[1]
RUST = ROOT / "desktop" / "src-tauri" / "src"
_DECLARATION = re.compile(
    r"(?m)^[ \t]*(?:(?:pub(?:\([^)]*\))?|async|unsafe|extern|const)\s+)*"
    r"(fn|const|static|struct|enum|type|trait|union)\s+(?:mut\s+)?(?:r#)?([^\W\d]\w*)"
)


def _entry(path, root: Path) -> str:
    path = Path(path)
    return path.relative_to(root).as_posix() if path.is_absolute() else path.as_posix()


def compiled_records(path="lib.rs", *, root: Path = RUST, include_tests: bool = False):
    return RustTree(root).compiled_records(_entry(path, root), include_tests=include_tests)


def entrypoint_records(path, *, root: Path = RUST, include_tests: bool = False):
    return RustTree(root).entrypoint_records(_entry(path, root), include_tests=include_tests)


def production_files(path, *, root: Path = RUST, standalone: bool = False):
    return RustTree(root).family(_entry(path, root), standalone=standalone)


def read_rust(path, *, root: Path = RUST, include_tests: bool = False, standalone: bool = False) -> str:
    return RustTree(root).source(_entry(path, root), include_tests=include_tests, standalone=standalone)


def symbol_source(path, marker: str, *, root: Path = RUST, include_tests: bool = False,
                  preserve_newlines: bool = False, standalone: bool = False) -> str:
    return RustTree(root).symbol_source(_entry(path, root), marker, include_tests=include_tests,
                                        preserve_newlines=preserve_newlines, standalone=standalone)


def declarations(source: str) -> list[str]:
    return [f"{found[1]} {found[2]}" for found in _DECLARATION.finditer(mask(normalize(source)))]


def family_inputs(path, *, root: Path = RUST, standalone: bool = False) -> list[str]:
    found = [name for record in production_files(path, root=root, standalone=standalone) for name in declarations(record.source)]
    assert found, f"Rust family {path} contains no declarations"
    return found


def raw_sources(directory: Path = RUST):
    return [(path.relative_to(directory).as_posix(), normalize(path.read_text(encoding="utf-8")))
            for path in raw_rust_files(directory)]
