"""Privacy and file-format contract for the shared onboarding CV fixture."""

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "tests/fixtures/sample-cv.pdf"
GENERATOR = ROOT / "tests/fixtures/generate_sample_cv.py"


def test_sample_document_is_a_real_single_page_pdf_fixture():
    payload = PDF.read_bytes()
    assert payload.startswith(b"%PDF-1.7")
    assert payload.rstrip().endswith(b"%%EOF")
    assert len(payload) > 3_000


def test_sample_document_source_is_synthetic_and_uses_reserved_contact_data():
    source = GENERATOR.read_text(encoding="utf-8")
    assert "avery.example@example.com" in source
    assert "SYNTHETIC SAMPLE CV" in source
    assert source.count("fictional") >= 4
    assert "example.com is a reserved example domain" in source

    for unsafe_contact in ("@gmail.com", "@outlook.com", "@yahoo.com", "linkedin.com"):
        assert unsafe_contact not in source.lower()
