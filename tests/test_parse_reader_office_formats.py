"""parse-cv reads a Word, OpenDocument or RTF CV (the reader the Assistant uses for every attachment).

It called `pandoc -f auto`, which is not a format ("Unknown input format auto"): every .docx, .odt and .rtf failed with
exit 5 and nobody saw it, because a PDF was the file all the tests and runs used. The format is now named from the
content, and the codes the Assistant says in the chat (size, scan) are held here too."""

from __future__ import annotations

import os
import re
import resource
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
EXTRACT = ROOT / "agents" / "_skills" / "parse-cv" / "extract.sh"
TEXT = "Mario Rossi sviluppatore backend, sette anni di esperienza in Go e Python con PostgreSQL"

needs_pandoc = pytest.mark.skipif(shutil.which("pandoc") is None or shutil.which("file") is None, reason="pandoc and file are in the image")
needs_pdftotext = pytest.mark.skipif(shutil.which("pdftotext") is None or shutil.which("file") is None, reason="poppler is in the image")


def read(path: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(EXTRACT), str(path)], capture_output=True, text=True, timeout=60)


def make_docx(path: Path, text: str = TEXT) -> None:
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr("word/document.xml", f'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>')


def make_odt(path: Path, text: str = TEXT) -> None:
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/vnd.oasis.opendocument.text", compress_type=zipfile.ZIP_STORED)
        z.writestr("META-INF/manifest.xml", '<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>')
        z.writestr("styles.xml", '<?xml version="1.0"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" office:version="1.2"><office:styles><style:default-style style:family="paragraph"/></office:styles><office:automatic-styles/></office:document-styles>')
        z.writestr("meta.xml", '<?xml version="1.0"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2"><office:meta/></office:document-meta>')
        z.writestr("content.xml", f'<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text><text:p>{text}</text:p></office:text></office:body></office:document-content>')


@needs_pandoc
@pytest.mark.parametrize("name, build", [
    ("cv.docx", make_docx),
    ("cv.odt", make_odt),
    ("cv.rtf", lambda p: p.write_text("{\\rtf1\\ansi " + TEXT + "\\par}", encoding="utf-8")),
])
def test_a_word_opendocument_or_rtf_cv_is_read(tmp_path, name, build):
    path = tmp_path / name
    build(path)
    done = read(path)
    assert done.returncode == 0, done.stderr
    assert TEXT in done.stdout
    # the text comes fenced as external data, never as an instruction
    assert done.stdout.startswith("⟦") and "CV_UPLOAD" in done.stdout


@needs_pandoc
def test_the_file_is_read_by_what_it_is_and_not_by_its_name(tmp_path):
    path = tmp_path / "just-a-name.pdf"
    make_docx(path)
    done = read(path)
    assert done.returncode == 0 and TEXT in done.stdout, done.stderr


def test_a_file_over_five_megabytes_is_refused_with_the_code_3(tmp_path):
    path = tmp_path / "big.txt"
    path.write_bytes(b"a" * (5 * 1024 * 1024 + 1))
    done = read(path)
    assert done.returncode == 3 and "5MB" in done.stderr


@needs_pdftotext
def test_a_pdf_without_text_is_a_scan_and_says_what_to_tell_the_person(tmp_path):
    path = tmp_path / "scan.pdf"
    # a valid one-page PDF with no text on it
    path.write_bytes(
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n158\n%%EOF\n"
    )
    done = read(path)
    assert done.returncode == 4, (done.returncode, done.stderr)
    assert "scansione" in done.stderr and "incolla il testo" in done.stderr


def test_the_script_names_the_format_and_never_asks_pandoc_to_guess():
    code = [line for line in EXTRACT.read_text(encoding="utf-8").splitlines() if not line.strip().startswith("#")]
    pandoc = [line for line in code if "pandoc" in line and "command -v" not in line and "echo" not in line]
    assert pandoc and all("-f auto" not in line and "--sandbox" in line and '-f "$FORMAT"' in line for line in pandoc), pandoc


# ── what reading one file may cost ───────────────────────────────────────────────────────────────────────────────────
# A 400 KB .docx can unpack to gigabytes. These tests never run the real pandoc on such a file: the fake tool on the PATH
# records that it was called, and every run is under a CPU limit (and an address-space limit where the OS enforces it).

needs_file = pytest.mark.skipif(shutil.which("file") is None, reason="file is in the image")


def limits() -> None:
    resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS, (3 * 1024**3, 3 * 1024**3))


def run_with(path: Path, tools: Path, **env: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(EXTRACT), str(path)], capture_output=True, text=True, timeout=60, preexec_fn=limits,
        env={**os.environ, "PATH": f"{tools}{os.pathsep}{os.environ['PATH']}", **env},
    )


def fake_tool(folder: Path, name: str, body: str) -> Path:
    tool = folder / name
    tool.write_text("#!/bin/sh\n" + body, encoding="utf-8")
    tool.chmod(0o755)
    return tool


def docx_with_part(path: Path, size: int, parts: int = 1) -> None:
    make_docx(path)
    with zipfile.ZipFile(path, "a", compression=zipfile.ZIP_DEFLATED) as z:
        for i in range(parts):
            z.writestr(f"word/media/part{i}.bin", b"a" * size)


@needs_file
def test_a_zip_bomb_is_refused_from_its_table_of_contents_before_pandoc_sees_it(tmp_path):
    bomb = tmp_path / "bomb.docx"
    docx_with_part(bomb, 60 * 1024 * 1024)
    assert bomb.stat().st_size < 5 * 1024 * 1024, "it is small on disk: the 5 MB limit does not stop it"
    tools = tmp_path / "tools"
    tools.mkdir()
    fake_tool(tools, "pandoc", f'echo called > "{tmp_path}/pandoc-called"\nexit 0\n')
    started = time.time()
    done = run_with(bomb, tools)
    assert done.returncode == 5 and done.stdout == "", (done.returncode, done.stderr)
    assert time.time() - started < 15
    assert not (tmp_path / "pandoc-called").exists(), "pandoc never opened it"


@needs_file
def test_many_parts_that_add_up_to_too_much_are_refused_too(tmp_path):
    bomb = tmp_path / "many.docx"
    docx_with_part(bomb, 12 * 1024 * 1024, parts=5)          # 5 x 12 MB: no part is over 30 MB, the sum is over 50
    tools = tmp_path / "tools"
    tools.mkdir()
    fake_tool(tools, "pandoc", f'echo called > "{tmp_path}/pandoc-called"\n')
    assert run_with(bomb, tools).returncode == 5
    assert not (tmp_path / "pandoc-called").exists()


@needs_file
def test_a_reading_that_never_ends_is_stopped_at_the_time_cap_without_timeout_on_the_machine(tmp_path):
    path = tmp_path / "slow.docx"
    make_docx(path)
    tools = tmp_path / "tools"
    tools.mkdir()
    fake_tool(tools, "pandoc", f'echo $$ > "{tmp_path}/pid"\nexec sleep 300\n')
    started = time.time()
    done = run_with(path, tools, EXTRACT_READ_SECONDS="2")
    assert done.returncode == 5 and "troppo pesante" in done.stderr, (done.returncode, done.stderr)
    assert 1.5 < time.time() - started < 20
    pid = int((tmp_path / "pid").read_text())
    time.sleep(0.3)
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)                                      # the tool itself is dead, not just the shell around it


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="the address-space limit is enforced on Linux, the image")
@needs_file
def test_a_reading_that_eats_memory_is_stopped_by_the_memory_cap(tmp_path):
    path = tmp_path / "hungry.docx"
    make_docx(path)
    tools = tmp_path / "tools"
    tools.mkdir()
    fake_tool(tools, "pandoc", f'exec python3 -c "x = bytearray(2 * 1024**3); print(\'a\' * 80)"\n')
    done = run_with(path, tools, EXTRACT_MEMORY_KB="400000")
    assert done.returncode == 5 and done.stdout == "", (done.returncode, done.stdout[:100], done.stderr)


@needs_file
def test_a_pdf_is_read_for_its_first_thirty_pages_only(tmp_path):
    path = tmp_path / "long.pdf"
    path.write_bytes(
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n158\n%%EOF\n"
    )
    tools = tmp_path / "tools"
    tools.mkdir()
    fake_tool(tools, "pdftotext", f'echo "$@" > "{tmp_path}/args"\necho "Mario Rossi sviluppatore backend con sette anni di esperienza in Go e Python"\n')
    done = run_with(path, tools)
    assert done.returncode == 0, (done.returncode, done.stderr)
    assert re.search(r"(^| )-l 30( |$)", (tmp_path / "args").read_text()), (tmp_path / "args").read_text()


def test_the_size_limit_is_one_number_in_the_script_and_the_same_as_the_apps():
    script = EXTRACT.read_text(encoding="utf-8")
    assert len(re.findall(r"\b5242880\b", script)) == 1 and "MAX_BYTES=5242880" in script
    rust = (ROOT / "desktop" / "src-tauri" / "src" / "chat_attachment.rs").read_text(encoding="utf-8")
    app = re.search(r"const MAX_BYTES: u64 = (\d+) \* 1024 \* 1024;", rust)
    assert app and int(app.group(1)) * 1024 * 1024 == 5242880, "the app and the reader refuse at the same size"
