#!/usr/bin/env python3
"""Render the CV PDFs of tests/test_pdf_layout_check.py with the REAL engine.

The layout defect only exists in what pandoc + wkhtmltopdf actually print, so
the PDFs are rendered by them, not drawn by hand, and at test time: PDFs never
enter the repo (the pre-commit hook refuses them), and every run proves the
skill's command on the toolchain it has. The pytest CI job installs pandoc,
wkhtmltopdf and poppler-utils; the container has them since this change.

    python3 tests/fixtures/pdf_layout/generate.py --out DIR [--css PATH]

Every CV is fictional (example.invalid): no profile data is ever involved.
"""

from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CSS = ROOT / "shared" / "skills" / "pdf_layout_base.css"
NAMES = ("narrow", "good", "spill", "three_pages")

# The <style> a Writer typically puts in the .md: small type and @page margins
# that wkhtmltopdf ignores. It is exactly what shipped the narrow CV.
STYLE = """<style>
@page { size: A4; margin: 11mm 15mm; }
body { font-family: "DejaVu Sans", Arial, sans-serif; font-size: 9.3pt; line-height: 1.35; color: #222; }
h1 { font-size: 20pt; margin: 0 0 2pt; }
h2 { font-size: 11.5pt; border-bottom: 1px solid #999; margin: 10pt 0 4pt; }
h3 { font-size: 10pt; margin: 6pt 0 1pt; }
ul { margin: 2pt 0 4pt 14pt; padding: 0; }
</style>"""

BULLETS = (
    "Built a fictional data pipeline processing sample records for demo purposes across several teams and regions.",
    "Reduced synthetic latency by a made-up percentage by rewriting a placeholder service in a generic language.",
    "Led a team of imaginary colleagues through a migration that never happened, documented for testing only.",
    "Designed an example dashboard used by pretend stakeholders to monitor invented metrics every single day.",
)


def cv_markdown(jobs: int) -> str:
    blocks = [
        f"### Senior Example Engineer — Acme Widgets {i}\n*2015 – 2020 · Sample City*\n\n"
        + "\n".join(f"- {b}" for b in BULLETS)
        for i in range(1, jobs + 1)
    ]
    return (
        f"{STYLE}\n\n# Jane Example\nExample Engineer · jane@example.invalid · Sample City\n\n"
        "## Profile\nFictional candidate used only to test PDF layout. This paragraph is long enough "
        "to wrap across the full width of the page so the measured text column reflects the real "
        "usable width of an A4 sheet in the renderer.\n\n## Experience\n\n"
        + "\n\n".join(blocks)
        + "\n\n## Education\n**MSc Example Studies** — University of Nowhere, 2014\n"
    )


def render_fixed(md: Path, pdf: Path, css: Path) -> None:
    """The render command of the cv-structure skill (keep the two in step)."""
    subprocess.run(
        ["pandoc", str(md), "-o", str(pdf), "--pdf-engine=wkhtmltopdf",
         "--metadata", "pagetitle=CV Jane Example", "-c", str(css), "--self-contained",
         "-V", "papersize=A4", "-V", "margin-top=11mm", "-V", "margin-bottom=11mm",
         "-V", "margin-left=15mm", "-V", "margin-right=15mm"],
        check=True, capture_output=True, cwd=md.parent,  # pandoc writes its temp HTML in the cwd
    )


def render_legacy(md: Path, pdf: Path) -> None:
    """The command the skill carried before: pandoc's template, 36em column."""
    subprocess.run(
        ["pandoc", str(md), "-o", str(pdf), "--pdf-engine=wkhtmltopdf",
         "--metadata", "title=CV Jane Example"],
        check=True, capture_output=True, cwd=md.parent,  # pandoc writes its temp HTML in the cwd
    )


def render_all(out: Path, css: Path = DEFAULT_CSS, jobs: tuple[int, int, int] = (5, 10, 24)) -> dict[str, Path]:
    """narrow (legacy command), good, spill (a few lines on page 2), three_pages."""
    good, spill, long = jobs
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        def md(count: int) -> Path:
            path = Path(tmp) / f"example_{count}.md"
            path.write_text(cv_markdown(count), encoding="utf-8")
            return path

        render_legacy(md(good), out / "narrow.pdf")
        render_fixed(md(good), out / "good.pdf", css)
        render_fixed(md(spill), out / "spill.pdf", css)
        render_fixed(md(long), out / "three_pages.pdf", css)
    return {name: out / f"{name}.pdf" for name in NAMES}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--css", type=Path, default=DEFAULT_CSS)
    parser.add_argument("--jobs", type=int, nargs=3, default=(5, 10, 24), metavar=("GOOD", "SPILL", "LONG"))
    args = parser.parse_args()
    for name, path in render_all(args.out, args.css, tuple(args.jobs)).items():
        print(name, path)


if __name__ == "__main__":
    main()
