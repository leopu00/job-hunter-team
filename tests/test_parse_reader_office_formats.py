"""parse-cv reads a Word, OpenDocument or RTF CV (the reader the Assistant uses for every attachment).

It called `pandoc -f auto`, which is not a format ("Unknown input format auto"): every .docx, .odt and .rtf failed with
exit 5 and nobody saw it, because a PDF was the file all the tests and runs used. The format is now named from the
content, and the codes the Assistant says in the chat (size, scan) are held here too."""

from __future__ import annotations

import shutil
import subprocess
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
