"""Test-only Rust acquisition: mask tokens and remove only test-only items."""

import re
from functools import lru_cache

_RAW = re.compile(r'(?:br|r)(#*)"')
_CHAR = re.compile(r"'(?:\\(?:u\{[\da-f]+\}|x[\da-f]{2}|.)|[^'\\\n])'", re.I)


def normalize(source: str) -> str:
    return source.removeprefix("\ufeff").replace("\r\n", "\n")


# Cache only exact text transformations. Filesystem reads, module membership
# and symbol selection remain fresh in RustTree, including mutation fixtures.
# A crate traversal visits many distinct modules before querying one again.
_SOURCE_CACHE_ITEMS = 256


@lru_cache(maxsize=_SOURCE_CACHE_ITEMS)
def mask(source: str) -> str:
    chars = list(source)
    i = 0
    while i < len(source):
        start = i
        if source.startswith("//", i):
            end = source.find("\n", i)
            i = len(source) if end < 0 else end
        elif source.startswith("/*", i):
            depth = 1
            i += 2
            while i < len(source) and depth:
                if source.startswith("/*", i):
                    depth += 1
                    i += 2
                elif source.startswith("*/", i):
                    depth -= 1
                    i += 2
                else:
                    i += 1
            if depth:
                raise AssertionError("Unclosed Rust block comment")
        else:
            raw = _RAW.match(source, i)
            char = _CHAR.match(source, i)
            if raw:
                end = source.find('"' + raw[1], raw.end())
                if end < 0:
                    raise AssertionError("Unclosed Rust raw string")
                i = end + len(raw[1]) + 1
            elif char:
                i = char.end()
            elif source[i] == '"':
                i += 1
                while i < len(source) and source[i] != '"':
                    i += 2 if source[i] == "\\" else 1
                if i >= len(source):
                    raise AssertionError("Unclosed Rust string")
                i += 1
            else:
                i += 1
                continue
        for at in range(start, min(i, len(chars))):
            if chars[at] != "\n":
                chars[at] = " "
    return "".join(chars)


def closing(code: str, start: int, left: str, right: str) -> int:
    depth = 0
    for i in range(start, len(code)):
        if code[i] == left:
            depth += 1
        if code[i] == right:
            depth -= 1
            if not depth:
                return i
    raise AssertionError(f"Unclosed Rust {left}")


def _cfg_value(tokens: list[str], cursor: list[int]):
    name = tokens[cursor[0]]
    cursor[0] += 1
    if cursor[0] < len(tokens) and tokens[cursor[0]] == "=":
        cursor[0] += 2
        return None
    if cursor[0] >= len(tokens) or tokens[cursor[0]] != "(":
        return False if name == "test" else None
    cursor[0] += 1
    values = []
    while cursor[0] < len(tokens) and tokens[cursor[0]] != ")":
        if tokens[cursor[0]] == ",":
            cursor[0] += 1
        else:
            values.append(_cfg_value(tokens, cursor))
    if cursor[0] >= len(tokens):
        raise AssertionError("Unclosed Rust cfg expression")
    cursor[0] += 1
    if name == "not":
        assert len(values) == 1, "not() needs one cfg operand"
        return None if values[0] is None else not values[0]
    if name == "all":
        return False if False in values else None if None in values else True
    if name == "any":
        return True if True in values else None if None in values else False
    return None


def _test_only(attribute: str) -> bool:
    cfg = re.fullmatch(r"#\s*\[\s*cfg\s*\((.*)\)\s*\]", attribute, re.S)
    if not cfg:
        return False
    tokens = re.findall(r'"(?:\\.|[^"\\])*"|\w+|[(),=]', cfg[1])
    assert tokens, "empty Rust cfg expression"
    return _cfg_value(tokens, [0]) is False


def item_end(code: str, start: int) -> int:
    i = start
    while i < len(code):
        if code[i].isspace():
            i += 1
        elif code.startswith("#[", i):
            i = closing(code, i + 1, "[", "]") + 1
        else:
            break
    item = re.match(r"(?:(?:pub(?:\([^)]*\))?|async|unsafe|extern|default)\s+)*"
                    r"(?:fn|struct|enum|impl|const|static|type|mod|use|trait|union)\b", code[i:])
    parens = brackets = 0
    for at in range(i, len(code)):
        token = code[at]
        parens += (token == "(") - (token == ")")
        brackets += (token == "[") - (token == "]")
        if not parens and not brackets:
            if token == ";" or (not item and token == ","):
                return at + 1
            if token == "}":
                return at
            if token == "{":
                return closing(code, at, "{", "}") + 1
    raise AssertionError("Rust test attribute has no item")


def _attributes_start(code: str, before: int) -> int:
    start = before
    i = before - 1
    while i >= 0:
        while i >= 0 and code[i].isspace():
            i -= 1
        if i < 0 or code[i] != "]":
            break
        depth = 1
        i -= 1
        while i >= 0 and depth:
            depth += (code[i] == "]") - (code[i] == "[")
            i -= 1
        while i >= 0 and code[i].isspace():
            i -= 1
        if i < 0 or code[i] != "#":
            break
        start = i
        i -= 1
    return start


def test_item_ranges(source: str):
    code = mask(source)
    kept = 0
    for attr in re.finditer(r"#\s*\[", code):
        if attr.start() < kept:
            continue
        bracket = code.index("[", attr.start())
        end = closing(code, bracket, "[", "]") + 1
        if _test_only(source[attr.start():end]):
            until = item_end(code, end)
            yield _attributes_start(code, attr.start()), until
            kept = until


@lru_cache(maxsize=_SOURCE_CACHE_ITEMS)
def production(source: str) -> str:
    source = normalize(source)
    chunks = []
    kept = 0
    for start, end in test_item_ranges(source):
        chunks.extend((source[kept:start], "\n"))
        kept = end
    return "".join(chunks) + source[kept:]


@lru_cache(maxsize=_SOURCE_CACHE_ITEMS)
def production_mask(source: str) -> str:
    """Select code on original offsets, including original CRLF literal bytes."""
    code = list(mask(source))
    for start, end in test_item_ranges(source):
        for at in range(start, end):
            if code[at] not in "\r\n":
                code[at] = " "
    if code and code[0] == "\ufeff":
        code[0] = " "
    return "".join(code)
