"""Privacy and reproducibility contract for the shared onboarding CV fixture."""

import hashlib
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "tests/fixtures/sample-cv.pdf"
GENERATOR = ROOT / "tests/fixtures/generate_sample_cv.py"
CANONICAL_SHA256 = "e07f76fecdf1543dd88e69b78825b111770438c216e902ffd8e791af3b47445e"


def _extract_literal_text(payload: bytes) -> str:
    """Extract text operands from this fixture's uncompressed PDF stream."""
    values = re.findall(rb"\(((?:\\.|[^\\)])*)\)\s*Tj", payload)
    decoded = []
    for value in values:
        value = value.replace(rb"\(", b"(").replace(rb"\)", b")")
        value = value.replace(rb"\\", bytes([92]))
        decoded.append(value.decode("ascii"))
    return "\n".join(decoded)


def test_sample_document_is_reproducible_byte_for_byte(tmp_path):
    rebuilt = tmp_path / "sample-cv.pdf"
    subprocess.run(
        [sys.executable, str(GENERATOR), "--output", str(rebuilt)],
        check=True,
    )

    committed = PDF.read_bytes()
    assert rebuilt.read_bytes() == committed
    assert hashlib.sha256(committed).hexdigest() == CANONICAL_SHA256
    assert committed.startswith(b"%PDF-1.7")
    assert committed.rstrip().endswith(b"%%EOF")
    assert b"/Count 1" in committed


def test_committed_pdf_text_is_explicitly_synthetic_and_privacy_safe():
    text = _extract_literal_text(PDF.read_bytes())
    expected = {
        "AVERY EXAMPLE",
        "avery.example@example.com",
        "SYNTHETIC SAMPLE CV - PRODUCT TESTING ONLY",
        "Remote - Example Region (fictional)",
        "Example Works Studio (fictional organisation)",
        "Sample Systems Lab (fictional organisation)",
        "Example Institute of Technology (fictional institution), 2021",
        "Synthetic fixture: no real person, company, school, address, or contact details.",
        "example.com is a reserved example domain",
    }
    for marker in expected:
        assert marker in text

    emails = set(re.findall(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", text))
    assert emails == {"avery.example@example.com"}
    for unsafe_contact in ("gmail.com", "outlook.com", "yahoo.com", "linkedin.com"):
        assert unsafe_contact not in text.lower()
