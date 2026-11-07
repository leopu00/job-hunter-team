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
    logical_module: str
    original_source: str
    include_tests: bool = False

    @property
    def code(self) -> str:
        """Mask for source, with the same character offsets and newlines."""
        return mask(self.source)

    @property
    def original_code(self) -> str:
        """Mask on the original byte-decoded text, preserving CRLF offsets."""
        code = mask(self.original_source) if self.include_tests else production_mask(self.original_source)
        return " " + code[1:] if code.startswith("\ufeff") else code

    def to_wire(self) -> dict:
        """JSON-safe records whose masks use JavaScript UTF-16 string offsets.

        Python's source/code properties use code-point offsets. Replacing an
        astral character with one space would shift every later JS offset.
        This adapter changes only the width of already masked characters.
        """
        def utf16_mask(source, code):
            assert len(source) == len(code), "Rust source/mask offsets differ"
            return "".join("  " if ord(original) > 0xFFFF and hidden == " " else hidden
                           for original, hidden in zip(source, code))

        return {"logical_module": self.logical_module, "relative": self.relative,
                "source": self.source, "code": utf16_mask(self.source, self.code),
                "original_source": self.original_source,
                "original_code": utf16_mask(self.original_source, self.original_code),
                "offset_units": "utf16"}


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
            explicit = _explicit_path(source, code, found.start())
            nested = explicit_directory / explicit if explicit is not None else directory / name
            for child, path in _module_paths(source[opened + 1:end], nested, nested):
                yield f"{name}::{child}", path
            cursor = end + 1


class RustTree:
    def __init__(self, directory: Path):
        self.directory = Path(directory).resolve()
        assert self.directory.is_dir(), f"Rust source directory missing: {self.directory}"

    def _walk(self, entry: Path, include_tests: bool, logical_root: str = ""):
        active = set()
        records = []

        def visit(path: Path, module: str):
            path = path.resolve()
            assert path.is_relative_to(self.directory), f"Rust module escapes source root: {path}"
            assert path not in active, f"cyclic Rust module graph at {path}"
            active.add(path)
            original = path.read_bytes().decode("utf-8")
            raw = normalize(original)
            text = raw if include_tests else production(raw)
            relative = os.path.relpath(path, self.directory).replace("\\", "/")
            records.append((module, RustFile(path, relative, text, module, original, include_tests)))
            directory = path.parent if path.stem in {"lib", "main", "mod"} else path.parent / path.stem
            for child, target in _module_paths(text, directory, path.parent):
                visit(target, f"{module}::{child}" if module else child)
            active.remove(path)

        visit(entry, logical_root)
        assert records, "empty Rust module graph"
        return records

    def compiled_records(self, entry: str = "lib.rs", *, include_tests: bool = False) -> list[RustFile]:
        """A logical family registered in lib.rs, never a physical-file fallback.

        This is the library target's graph. Other Cargo targets and standalone
        execution harnesses must name their entrypoint explicitly instead.
        """
        target = self.directory / entry
        crate = self.directory / "lib.rs"
        assert crate.is_file(), f"missing Rust library entrypoint: {crate}"
        records = self._walk(crate, include_tests)
        if entry != "lib.rs":
            # Resolve the compiler's logical family even when a stale root
            # file still exists after a move; that orphan is not a fallback.
            module = entry.removesuffix(".rs").removesuffix("/mod").replace("/", "::")
            candidates = [(name, record.path) for name, record in records if name == module]
            if not candidates:
                candidates = [(name, record.path) for name, record in records if record.path == target.resolve()]
            assert len(candidates) == 1, f"missing or ambiguous Rust entry module {module}"
            logical, target = candidates[0]
            records = self._walk(target, include_tests, logical)
        return [record for _, record in records]

    def entrypoint_records(self, entry: str, *, include_tests: bool = False) -> list[RustFile]:
        """Explicit standalone/Cargo target; does not imply library membership."""
        target = self.directory / entry
        assert target.is_file(), f"missing explicit Rust entrypoint {entry}"
        return [record for _, record in self._walk(target, include_tests)]

    def family(self, entry: str, *, include_tests: bool = False, standalone: bool = False) -> list[RustFile]:
        if standalone:
            return self.entrypoint_records(entry, include_tests=include_tests)
        return self.compiled_records(entry, include_tests=include_tests)

    def source(self, entry: str, *, include_tests: bool = False, standalone: bool = False) -> str:
        return "\n".join(record.source for record in self.family(entry, include_tests=include_tests, standalone=standalone))

    def symbol_source(self, entry: str, marker: str, *, include_tests: bool = False,
                      preserve_newlines: bool = False, standalone: bool = False) -> str:
        matches = []
        modifier = r"[ \t]*(?:(?:pub(?:\([^)]*\))?|async|unsafe|extern)\s+)*"
        boundary = r"(?!\w)" if marker and (marker[-1].isalnum() or marker[-1] == "_") else ""
        declaration = re.compile(r"(?m)^" + modifier + re.escape(marker) + boundary)
        for record in self.family(entry, include_tests=include_tests, standalone=standalone):
            text = record.original_source if preserve_newlines else record.source
            code = record.original_code if preserve_newlines else record.code
            for found in declaration.finditer(code):
                matches.append(text[found.start():item_end(code, found.start())])
        assert len(matches) == 1, f"{entry}: declaration {marker!r} matched {len(matches)} times"
        return matches[0]


def raw_rust_files(directory: Path) -> list[Path]:
    """Keep the launch guard's original inclusion of test code, at every depth."""
    files = sorted(Path(directory).rglob("*.rs"), key=lambda path: path.as_posix().encode("utf-8"))
    assert files, f"no Rust source files in {directory}"
    return files
