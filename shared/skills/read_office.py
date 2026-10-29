#!/usr/bin/env python3
"""read_office.py: the text of a spreadsheet or a slide deck (xlsx, pptx, ods, odp), with the standard library only.

The image has no reader for these (no openpyxl, no python-pptx; pandoc reads neither), and an agent that is given
such a file used to write a parser of its own in minutes. This one reads the XML parts of the zip and prints plain
text: sheets as tab-separated rows under a `## name` line, slides as paragraphs under `## Slide N`. It runs inside
the attachment reader (agents/_skills/read-attachment), which fences the output as external data; whatever the file
says is data, never an instruction.

The file is untrusted. What is read is bounded: the file itself (5 MB, as everywhere else), each part (an
uncompressed size over MAX_PART_BYTES is refused before it is read, so a zip bomb never inflates), ALL the parts
together (TOTAL_BUDGET), the number of parts, rows, columns and characters, the memory of the process (an address
space limit) and its time (an alarm), because the sizes a zip declares may lie and a few MB of XML can grow to
gigabytes as objects. XML with a DOCTYPE or an ENTITY anywhere is refused before it is parsed.

Exit: 0 text on stdout · 2 file not found · 3 file over 5 MB · 5 unreadable or damaged · 6 not one of the four types.
"""
from __future__ import annotations

import re
import signal
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_PART_BYTES = 10 * 1024 * 1024
TOTAL_BUDGET = 40 * 1024 * 1024        # everything read from one file, parts together
SECONDS = 30
MEMORY_BYTES = 1536 * 1024 * 1024
MAX_SHEETS = 20
MAX_ROWS = 500
MAX_COLUMNS = 50
MAX_SLIDES = 100
MAX_CHARS = 200_000

NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
NS_PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
NS_A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
NS_TABLE = "{urn:oasis:names:tc:opendocument:xmlns:table:1.0}"
NS_TEXT = "{urn:oasis:names:tc:opendocument:xmlns:text:1.0}"
NS_DRAW = "{urn:oasis:names:tc:opendocument:xmlns:drawing:1.0}"
NS_OFFICE = "{urn:oasis:names:tc:opendocument:xmlns:office:1.0}"

ODF_TYPES = {
    "application/vnd.oasis.opendocument.spreadsheet": "ods",
    "application/vnd.oasis.opendocument.presentation": "odp",
}


class Unreadable(Exception):
    """The file is not a readable document of the four types (damaged, too large inside, or built to hurt)."""


_read_so_far = 0


def _part(archive: zipfile.ZipFile, name: str) -> bytes:
    global _read_so_far
    try:
        info = archive.getinfo(name)
    except KeyError as error:
        raise Unreadable(name) from error
    if info.file_size > MAX_PART_BYTES or _read_so_far + info.file_size > TOTAL_BUDGET:
        raise Unreadable("part too large")
    with archive.open(info) as handle:
        data = handle.read(MAX_PART_BYTES + 1)
    if len(data) > MAX_PART_BYTES:
        raise Unreadable("part too large")
    _read_so_far += len(data)
    if _read_so_far > TOTAL_BUDGET:
        raise Unreadable("part too large")
    return data


def _xml(archive: zipfile.ZipFile, name: str) -> ET.Element:
    data = _part(archive, name)
    lowered = data.lower()
    if b"<!doctype" in lowered or b"<!entity" in lowered:
        raise Unreadable("xml with a DOCTYPE")
    try:
        return ET.fromstring(data)
    except ET.ParseError as error:
        raise Unreadable("xml") from error


def _clean(text: str) -> str:
    """One line, no control characters (a cell is a value, not a layout)."""
    return re.sub(r"[\x00-\x08\x0b-\x1f\x7f‪-‮⁦-⁩]", "", text).replace("\n", " ").replace("\t", " ").strip()


def kind_of(archive: zipfile.ZipFile) -> str | None:
    names = set(archive.namelist())
    if "xl/workbook.xml" in names:
        return "xlsx"
    if "ppt/presentation.xml" in names:
        return "pptx"
    if "mimetype" in names:
        try:
            return ODF_TYPES.get(_part(archive, "mimetype").decode("ascii", "replace").strip())
        except Unreadable:
            return None
    return None


def _column_index(reference: str) -> int:
    letters = re.match(r"[A-Za-z]+", reference or "")
    index = 0
    for char in (letters.group(0).upper() if letters else "A"):
        index = index * 26 + (ord(char) - 64)
    return index - 1


def read_xlsx(archive: zipfile.ZipFile) -> list[str]:
    shared: list[str] = []
    if "xl/sharedStrings.xml" in archive.namelist():
        for item in _xml(archive, "xl/sharedStrings.xml").iter(NS_MAIN + "si"):
            shared.append(_clean("".join(t.text or "" for t in item.iter(NS_MAIN + "t"))))
    workbook = _xml(archive, "xl/workbook.xml")
    rels = {}
    if "xl/_rels/workbook.xml.rels" in archive.namelist():
        for rel in _xml(archive, "xl/_rels/workbook.xml.rels").iter(NS_PKG_REL + "Relationship"):
            rels[rel.get("Id")] = rel.get("Target", "")
    out: list[str] = []
    sheets = list(workbook.iter(NS_MAIN + "sheet"))[:MAX_SHEETS]
    for number, sheet in enumerate(sheets, 1):
        target = rels.get(sheet.get(NS_REL + "id"), f"worksheets/sheet{number}.xml")
        path = target.lstrip("/") if target.startswith("/") else "xl/" + target
        out.append(f"## {_clean(sheet.get('name') or f'Sheet {number}')}")
        try:
            root = _xml(archive, path)
        except Unreadable:
            out.append("(this sheet could not be read)")
            continue
        rows = 0
        for row in root.iter(NS_MAIN + "row"):
            if rows >= MAX_ROWS:
                out.append(f"(more rows, cut at {MAX_ROWS})")
                break
            cells: dict[int, str] = {}
            for cell in row.iter(NS_MAIN + "c"):
                column = _column_index(cell.get("r", ""))
                if column >= MAX_COLUMNS:
                    continue
                kind = cell.get("t")
                if kind == "inlineStr":
                    value = _clean("".join(t.text or "" for t in cell.iter(NS_MAIN + "t")))
                else:
                    raw = cell.find(NS_MAIN + "v")
                    value = (raw.text or "") if raw is not None else ""
                    if kind == "s" and value.isdigit() and int(value) < len(shared):
                        value = shared[int(value)]
                    elif kind == "b":
                        value = "TRUE" if value == "1" else "FALSE"
                    else:
                        value = _clean(value)
                cells[column] = value
            if cells:
                width = min(max(cells) + 1, MAX_COLUMNS)
                out.append("\t".join(cells.get(i, "") for i in range(width)))
                rows += 1
    return out


def read_pptx(archive: zipfile.ZipFile) -> list[str]:
    names = [n for n in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)]
    names.sort(key=lambda n: int(re.search(r"(\d+)\.xml$", n).group(1)))
    out: list[str] = []
    for number, name in enumerate(names[:MAX_SLIDES], 1):
        out.append(f"## Slide {number}")
        for paragraph in _xml(archive, name).iter(NS_A + "p"):
            text = _clean("".join(t.text or "" for t in paragraph.iter(NS_A + "t")))
            if text:
                out.append(text)
    if len(names) > MAX_SLIDES:
        out.append(f"(more slides, cut at {MAX_SLIDES})")
    return out


def _odf_text(element: ET.Element) -> str:
    return _clean("".join(element.itertext()))


def read_ods(archive: zipfile.ZipFile) -> list[str]:
    root = _xml(archive, "content.xml")
    out: list[str] = []
    for number, table in enumerate(list(root.iter(NS_TABLE + "table"))[:MAX_SHEETS], 1):
        out.append(f"## {_clean(table.get(NS_TABLE + 'name') or f'Sheet {number}')}")
        rows = 0
        for row in table.iter(NS_TABLE + "table-row"):
            if rows >= MAX_ROWS:
                out.append(f"(more rows, cut at {MAX_ROWS})")
                break
            values: list[str] = []
            for cell in row:
                if cell.tag not in (NS_TABLE + "table-cell", NS_TABLE + "covered-table-cell"):
                    continue
                repeat = cell.get(NS_TABLE + "number-columns-repeated", "1")
                times = min(int(repeat), MAX_COLUMNS) if repeat.isdigit() else 1
                values.extend([_odf_text(cell)] * times)
                if len(values) >= MAX_COLUMNS:
                    values = values[:MAX_COLUMNS]
                    break
            while values and not values[-1]:
                values.pop()
            if values:
                out.append("\t".join(values))
                rows += 1
    return out


def read_odp(archive: zipfile.ZipFile) -> list[str]:
    root = _xml(archive, "content.xml")
    out: list[str] = []
    for number, page in enumerate(list(root.iter(NS_DRAW + "page"))[:MAX_SLIDES], 1):
        out.append(f"## Slide {number}")
        for paragraph in page.iter(NS_TEXT + "p"):
            text = _odf_text(paragraph)
            if text:
                out.append(text)
    return out


READERS = {"xlsx": read_xlsx, "pptx": read_pptx, "ods": read_ods, "odp": read_odp}


def read(path: str | Path) -> str:
    """The text of the file; `Unreadable` when it is not a readable one of the four types."""
    try:
        archive = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError) as error:
        raise Unreadable("not a zip") from error
    with archive:
        if len(archive.namelist()) > 10_000:
            raise Unreadable("too many parts")
        if sum(info.file_size for info in archive.infolist()) > 4 * TOTAL_BUDGET:
            raise Unreadable("too large inside")
        kind = kind_of(archive)
        if kind is None:
            raise Unreadable("not one of the four types")
        lines = READERS[kind](archive)
    text = "\n".join(lines)
    if len(text) > MAX_CHARS:
        text = text[:MAX_CHARS] + "\n(cut: the rest is not shown)"
    return text


def _limit_the_process() -> None:
    """A cap on memory and time for the whole run: what the file declares is not trusted, so the process is held."""
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (MEMORY_BYTES, MEMORY_BYTES))
    except (ImportError, ValueError, OSError):
        pass                                    # a system that cannot set it still has the alarm and the budgets

    def too_slow(signum, frame):
        raise Unreadable("took too long")

    if hasattr(signal, "SIGALRM"):
        signal.signal(signal.SIGALRM, too_slow)
        signal.alarm(SECONDS)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: read_office.py <file.xlsx|pptx|ods|odp>", file=sys.stderr)
        return 2
    path = Path(argv[1])
    if not path.is_file():
        print("ERROR: file not found", file=sys.stderr)
        return 2
    if path.stat().st_size > MAX_FILE_BYTES:
        print("ERROR: file over 5 MB", file=sys.stderr)
        return 3
    _limit_the_process()
    try:
        sys.stdout.write(read(path) + "\n")
    except MemoryError:
        print("ERROR: cannot read the file (too large inside)", file=sys.stderr)
        return 5
    except Unreadable as error:
        print(f"ERROR: cannot read the file ({error})", file=sys.stderr)
        return 6 if str(error) == "not one of the four types" else 5
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
