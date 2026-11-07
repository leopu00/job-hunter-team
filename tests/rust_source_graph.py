"""The real Rust module graph used only by source-reading QA tests."""

import os
import re
from dataclasses import dataclass
from pathlib import Path

from rust_source_lex import closing, item_end, mask, normalize, production, production_mask

_MOD = re.compile(r"\b(?:pub(?:\([^)]*\))?\s+)?mod\s+(?:r#)?(\w+)\s*(;|\{)")


@dataclass(frozen=True)
class RustFile:
    path: Path
    relative: str
    source: str


def _explicit_path(source: str, code: str, before: int):
    i = before - 1
    while i >= 0:
        while i >= 0 and code[i].isspace():
            i -= 1
        if i < 0 or code[i] != "]":
            return None
        end = i + 1
        depth = 1
        i -= 1
        while i >= 0 and depth:
            depth += (code[i] == "]") - (code[i] == "[")
            i -= 1
        attribute = source[i + 1:end]
        found = re.fullmatch(r'\[\s*path\s*=\s*(.*?)\s*\]', attribute, re.S)
        if found:
            literal = found[1]
            raw = re.fullmatch(r'r(?P<hashes>#{0,255})"(?P<path>.*?)"(?P=hashes)', literal, re.S)
            if raw:
                return raw["path"]
            quoted = re.fullmatch(r'"((?:\\.|[^"\\])*)"', literal, re.S)
            assert quoted, f"unsupported Rust path literal {literal}"
            return quoted[1].replace("\\\\", "\\").replace('\\"', '"')
        while i >= 0 and code[i].isspace():
            i -= 1
        if i >= 0 and code[i] == "#":
            i -= 1
        else:
            return None
    return None


def _module_paths(source: str, directory: Path, explicit_directory: Path):
    code = mask(source)
    cursor = depth = 0
    for found in _MOD.finditer(code):
        if found.start() < cursor:
            continue
        span = code[cursor:found.start()]
        depth += span.count("{") - span.count("}")
        cursor = found.start()
        if depth:
            continue
        name = found[1]
        if found[2] == ";":
            explicit = _explicit_path(source, code, found.start())
            candidates = [explicit_directory / explicit] if explicit is not None else [
                directory / f"{name}.rs", directory / name / "mod.rs",
            ]
            existing = [path for path in candidates if path.is_file()]
            assert len(existing) == 1, f"missing or ambiguous Rust module {name}: {candidates}"
            yield name, existing[0].resolve()
        else:
            opened = found.end() - 1
            end = closing(code, opened, "{", "}")
            for child, path in _module_paths(source[opened + 1:end], directory / name, directory / name):
                yield f"{name}::{child}", path
            cursor = end + 1


class RustTree:
    def __init__(self, directory: Path):
        self.directory = Path(directory).resolve()
        assert self.directory.is_dir(), f"Rust source directory missing: {self.directory}"

    def _walk(self, entry: Path, include_tests: bool):
        active = set()
        records = []

        def visit(path: Path, module: str):
            path = path.resolve()
            assert path.is_relative_to(self.directory), f"Rust module escapes source root: {path}"
            assert path not in active, f"cyclic Rust module graph at {path}"
            active.add(path)
            raw = normalize(path.read_text(encoding="utf-8"))
            text = raw if include_tests else production(raw)
            relative = os.path.relpath(path, self.directory).replace("\\", "/")
            records.append((module, RustFile(path, relative, text)))
            directory = path.parent if path.stem in {"lib", "main", "mod"} else path.parent / path.stem
            for child, target in _module_paths(text, directory, path.parent):
                visit(target, f"{module}::{child}" if module else child)
            active.remove(path)

        visit(entry, "")
        assert records, "empty Rust module graph"
        return records

    def family(self, entry: str, *, include_tests: bool = False) -> list[RustFile]:
        target = self.directory / entry
        crate = self.directory / "lib.rs"
        if crate.is_file() and entry != "lib.rs":
            # Resolve the compiler's logical family even when a stale root
            # file still exists after a move; that orphan is not a fallback.
            module = entry.removesuffix(".rs").removesuffix("/mod").replace("/", "::")
            records = self._walk(crate, include_tests)
            candidates = [record.path for name, record in records if name == module]
            if not candidates:
                candidates = [record.path for _, record in records if record.path == target.resolve()]
            assert len(candidates) == 1, f"missing or ambiguous Rust entry module {module}"
            target = candidates[0]
        assert target.is_file(), f"missing Rust entry {entry}"
        return [record for _, record in self._walk(target, include_tests)]

    def source(self, entry: str, *, include_tests: bool = False) -> str:
        return "\n".join(record.source for record in self.family(entry, include_tests=include_tests))

    def symbol_source(self, entry: str, marker: str, *, include_tests: bool = False,
                      preserve_newlines: bool = False) -> str:
        matches = []
        modifier = r"[ \t]*(?:(?:pub(?:\([^)]*\))?|async|unsafe|extern)\s+)*"
        declaration = re.compile(r"(?m)^" + modifier + re.escape(marker))
        for record in self.family(entry, include_tests=include_tests):
            text = record.path.read_bytes().decode("utf-8") if preserve_newlines else record.source
            code = (mask(text) if include_tests else production_mask(text)) if preserve_newlines else mask(text)
            for found in declaration.finditer(code):
                matches.append(text[found.start():item_end(code, found.start())])
        assert len(matches) == 1, f"{entry}: declaration {marker!r} matched {len(matches)} times"
        return matches[0]


def raw_rust_files(directory: Path) -> list[Path]:
    """Keep the launch guard's original inclusion of test code, at every depth."""
    files = sorted(Path(directory).rglob("*.rs"), key=lambda path: path.as_posix().encode("utf-8"))
    assert files, f"no Rust source files in {directory}"
    return files
