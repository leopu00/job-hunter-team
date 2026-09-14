#!/usr/bin/env python3
"""Visual gate for CV / cover-letter PDFs: measure the layout, not the engine.

Why. The PDF attached to application 2067 passed every existing check (size
≥ 20 KB, Producer "Qt": the engine was right) and still had its text squeezed
into a ~41-57% column in the middle of the sheet — pandoc's HTML template caps
the body at `max-width: 36em`. Nobody measured where the text actually sits.
This script does, with poppler (baked in the image):

  1. page count between 1 and --max-pages (default 2);
  2. on every page with enough lines, the text column spans at least
     --min-width-ratio (default 0.75) of the USABLE width (page width minus
     the left/right margins the render command passes to wkhtmltopdf);
  3. no nearly empty page (a spill of a few lines onto page 2);
  4. every font is embedded;
  5. the body font prints at ≥ --min-body-font-pt (default 9.5pt). wkhtmltopdf
     with an unpatched Qt shrinks everything by ~0.744: a 9.3pt <style> printed
     at 6.9pt, unreadable yet full width. The size is estimated from the word
     boxes of `pdftotext -bbox`: the most common word height, divided by the
     height of one point of DejaVu Sans (the base CSS font).

Usage:
  python3 pdf_layout_check.py <file.pdf> [--json] [--preview page1.png]
                          [--margin-left-mm 15] [--margin-right-mm 15]

Exit codes:
  0 → layout OK
  1 → layout bad; `reasons` lists the stable codes:
        too_many_pages · narrow_text · near_empty_page ·
        small_body_font · fonts_not_embedded · no_text
  2 → cannot check (file unreadable, poppler missing): NOT a pass.

The SCRITTORE runs it after every render and regenerates on exit 1. The
sending code imports `analyze` / `CheckError` before attaching a CV: not ok →
blocked_human `cv_pdf_layout_bad`, CheckError → `cv_pdf_check_unavailable`
(skills cv-structure and apply-flow).
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

PT_PER_MM = 72 / 25.4
# Must match the margins of the render command in the cv-structure skill.
DEFAULT_MARGIN_LR_MM = 15.0
DEFAULT_MARGIN_TB_MM = 11.0
MIN_WIDTH_RATIO = 0.75
MAX_PAGES = 2
# A page is "nearly empty" below this share of the usable height or line count.
MIN_FILL_RATIO = 0.20
MIN_LINES_PER_PAGE = 4
# Width is judged only on pages with enough lines to have wrapped at least once:
# a page of five short lines says nothing about the column.
MIN_LINES_FOR_WIDTH = 8
MIN_BODY_FONT_PT = 9.5
# Word-box height per point of font size in poppler's -bbox output, measured on
# DejaVu Sans from wkhtmltopdf (6.92pt → 8.1, 9.80pt → 11.4, 10.95pt → 12.8).
# A font with a shorter ascent + descent reads slightly smaller: the error is
# on the strict side, never a small font passed as readable.
BBOX_HEIGHT_PER_PT = 1.17

REASONS = ("too_many_pages", "narrow_text", "near_empty_page", "small_body_font", "fonts_not_embedded", "no_text")

_PAGE_RE = re.compile(r'<page width="([\d.]+)" height="([\d.]+)">(.*?)</page>', re.S)
_WORD_RE = re.compile(r'<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)">([^<]*)</word>')
_LINE_RE = re.compile(r'<line xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">')


class CheckError(Exception):
    """The PDF could not be measured: the caller must treat it as a failure."""


def _tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise CheckError(f"{name} not found (poppler-utils missing)")
    return path


def _run(cmd: list[str]) -> str:
    try:
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise CheckError(f"{Path(cmd[0]).name} failed: {exc}") from exc
    if done.returncode != 0:
        raise CheckError(f"{Path(cmd[0]).name} exit {done.returncode}: {done.stderr.strip()[:200]}")
    return done.stdout


def read_pages(pdf: Path) -> list[dict]:
    """Page size and text line boxes, from `pdftotext -bbox-layout`."""
    xhtml = _run([_tool("pdftotext"), "-bbox-layout", str(pdf), "-"])
    pages = []
    for width, height, body in _PAGE_RE.findall(xhtml):
        lines = [tuple(float(v) for v in m) for m in _LINE_RE.findall(body)]
        pages.append({"width": float(width), "height": float(height), "lines": lines})
    return pages


def body_font_pt(pdf: Path) -> float | None:
    """Printed size of the body font: the word height carried by most words."""
    xhtml = _run([_tool("pdftotext"), "-bbox", str(pdf), "-"])
    heights: dict[float, int] = {}
    for top, bottom, text in _WORD_RE.findall(xhtml):
        if text.strip():
            height = round(float(bottom) - float(top), 1)
            heights[height] = heights.get(height, 0) + 1
    if not heights:
        return None
    # Ties go to the smaller height: a CV split evenly between two sizes is
    # judged by the one that has to be readable.
    height = max(heights, key=lambda h: (heights[h], -h))
    return round(height / BBOX_HEIGHT_PER_PT, 2)


def read_fonts(pdf: Path) -> list[dict]:
    """Font names and embedded flag, from `pdffonts` (fixed-width columns)."""
    rows = _run([_tool("pdffonts"), str(pdf)]).splitlines()
    if len(rows) < 2:
        return []
    header, dashes = rows[0], rows[1]
    # Column spans come from the dashes row: names may contain spaces.
    spans = [(m.start(), m.end()) for m in re.finditer(r"-+", dashes)]
    titles = [header[a:b].strip() for a, b in spans]
    emb = titles.index("emb")
    fonts = []
    for row in rows[2:]:
        cells = [row[a:b + 1].strip() for a, b in spans]
        fonts.append({"name": cells[0], "embedded": cells[emb] == "yes"})
    return fonts


def analyze(
    pdf: Path,
    *,
    margin_left_mm: float = DEFAULT_MARGIN_LR_MM,
    margin_right_mm: float = DEFAULT_MARGIN_LR_MM,
    margin_tb_mm: float = DEFAULT_MARGIN_TB_MM,
    min_width_ratio: float = MIN_WIDTH_RATIO,
    max_pages: int = MAX_PAGES,
    min_body_font_pt: float = MIN_BODY_FONT_PT,
) -> dict:
    if not pdf.is_file():
        raise CheckError(f"not a file: {pdf}")
    pages = read_pages(pdf)
    if not pages:
        raise CheckError("no pages found")
    fonts = read_fonts(pdf)
    body_pt = body_font_pt(pdf)

    reasons: list[str] = []
    per_page = []
    judged = 0
    # The column's left edge is shared by every page: taking it per page would
    # let a page of indented bullets look narrower than it is.
    all_lines = [l for page in pages for l in page["lines"]]
    left = min((l[0] for l in all_lines), default=0.0)
    for number, page in enumerate(pages, start=1):
        usable_w = page["width"] - (margin_left_mm + margin_right_mm) * PT_PER_MM
        usable_h = page["height"] - 2 * margin_tb_mm * PT_PER_MM
        lines = page["lines"]
        entry = {"page": number, "lines": len(lines), "text_width_pt": None,
                 "width_ratio": None, "fill_ratio": 0.0}
        if lines:
            right = max(l[2] for l in lines)
            top = min(l[1] for l in lines)
            bottom = max(l[3] for l in lines)
            entry["fill_ratio"] = round((bottom - top) / usable_h, 3)
            if len(lines) >= MIN_LINES_FOR_WIDTH:
                judged += 1
                entry["text_width_pt"] = round(right - left, 1)
                entry["width_ratio"] = round((right - left) / usable_w, 3)
                if entry["width_ratio"] < min_width_ratio:
                    reasons.append("narrow_text")
        if len(lines) < MIN_LINES_PER_PAGE or entry["fill_ratio"] < MIN_FILL_RATIO:
            reasons.append("near_empty_page")
        per_page.append(entry)

    if len(pages) > max_pages:
        reasons.append("too_many_pages")
    if not judged:
        reasons.append("no_text")
    if body_pt is not None and body_pt < min_body_font_pt:
        reasons.append("small_body_font")
    if not fonts or not all(f["embedded"] for f in fonts):
        reasons.append("fonts_not_embedded")

    first = pages[0]
    return {
        "ok": not reasons,
        "reasons": [r for r in REASONS if r in reasons],
        "pages": len(pages),
        "usable_width_pt": round(first["width"] - (margin_left_mm + margin_right_mm) * PT_PER_MM, 1),
        "min_width_ratio": min_width_ratio,
        "body_font_pt": body_pt,
        "min_body_font_pt": min_body_font_pt,
        "per_page": per_page,
        "fonts": fonts,
    }


def render_preview(pdf: Path, png: Path) -> Path:
    """Page 1 as PNG, for the eyes of whoever attaches the PDF."""
    try:
        png.parent.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise CheckError(f"preview directory: {exc}") from exc
    stem = png.with_suffix("")
    _run([_tool("pdftoppm"), "-png", "-r", "60", "-f", "1", "-l", "1", "-singlefile", str(pdf), str(stem)])
    return stem.with_suffix(".png")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Visual layout gate for CV PDFs")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--json", action="store_true", help="print the full report as JSON")
    parser.add_argument("--preview", type=Path, help="also write page 1 as PNG here")
    parser.add_argument("--margin-left-mm", type=float, default=DEFAULT_MARGIN_LR_MM)
    parser.add_argument("--margin-right-mm", type=float, default=DEFAULT_MARGIN_LR_MM)
    parser.add_argument("--min-width-ratio", type=float, default=MIN_WIDTH_RATIO)
    parser.add_argument("--max-pages", type=int, default=MAX_PAGES)
    parser.add_argument("--min-body-font-pt", type=float, default=MIN_BODY_FONT_PT)
    args = parser.parse_args(argv)

    try:
        report = analyze(
            args.pdf,
            margin_left_mm=args.margin_left_mm,
            margin_right_mm=args.margin_right_mm,
            min_width_ratio=args.min_width_ratio,
            max_pages=args.max_pages,
            min_body_font_pt=args.min_body_font_pt,
        )
        if args.preview:
            report["preview"] = str(render_preview(args.pdf, args.preview))
    except CheckError as exc:
        report = {"ok": False, "reasons": ["check_failed"], "error": str(exc)}
        print(json.dumps(report) if args.json else f"[pdf_layout_check] CANNOT CHECK: {exc}",
              file=sys.stdout if args.json else sys.stderr)
        return 2

    if args.json:
        print(json.dumps(report, ensure_ascii=False))
    else:
        widths = ", ".join(
            f"p{p['page']} {p['width_ratio']:.0%}" if p["width_ratio"] is not None else f"p{p['page']} -"
            for p in report["per_page"]
        )
        verdict = "OK" if report["ok"] else "LAYOUT BAD: " + ", ".join(report["reasons"])
        print(f"[pdf_layout_check] {verdict} · pages {report['pages']} · text width {widths}"
              f" · body font {report['body_font_pt']}pt")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
