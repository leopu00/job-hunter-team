#!/usr/bin/env python3
"""Minimal fallback PDF generator for quick technical documents (NOT CVs).

⚠️  Do NOT use this for professional user-facing CVs. It produces a plain
one-page layout without CSS or fine spacing. For CVs, use `wkhtmltopdf`
through pandoc (see the `cv-structure` skill):
   pandoc input.md -o out.pdf --pdf-engine=wkhtmltopdf
   → approximately 30 KB / 2 pages with full HTML and CSS.

Appropriate uses (Markdown to PDF through pure-Python `fpdf2`):
  - Quick cover letters when design does not matter
  - Technical reports, notes, and debug output
  - Document-style attachments without branding

This module remains only as a fallback for non-CV documents.

Usage:
  python3 pdf_gen.py <input.md> <output.pdf>

Supported Markdown subset (intentionally small and predictable):
  # Title       (H1, large header)
  ## Section    (H2 with underline)
  ### Subsection(H3)
  - bullet
  **bold**, *italic*, `code` inline
  ---           (horizontal rule)

Output: writes the PDF; exits 0 on success or 1 with an error on stderr.
"""

import argparse
import re
import sys
from pathlib import Path


def _resolve_unicode_font_dir() -> Path | None:
    """Trova la cartella TTF DejaVu (per Unicode). Prima preference:
    matplotlib (gia' nel magazzino .local). Fallback: font system.
    Senza Unicode, fpdf2 con Helvetica core fallisce su qualunque char
    fuori da latin-1 (bullet •, accenti, ecc.)."""
    candidates = []
    # matplotlib bundle: praticamente sempre presente nel container
    try:
        import matplotlib
        mpl = Path(matplotlib.__file__).parent / 'mpl-data' / 'fonts' / 'ttf'
        candidates.append(mpl)
    except ImportError:
        pass
    # font system Linux/macOS comuni
    for p in (
        '/usr/share/fonts/truetype/dejavu',
        '/usr/share/fonts/dejavu',
        '/Library/Fonts',
    ):
        candidates.append(Path(p))
    for d in candidates:
        if (d / 'DejaVuSans.ttf').exists():
            return d
    return None


def render(md_text: str, pdf_path: Path):
    from fpdf import FPDF

    pdf = FPDF(unit='mm', format='A4')
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(15, 18, 15)
    pdf.add_page()

    # Carica DejaVu (Unicode-safe). Senza, Helvetica core di fpdf2 e' latin-1
    # only e qualunque markdown realistico (bullet, accenti, em-dash) crasha.
    font_dir = _resolve_unicode_font_dir()
    if font_dir is not None:
        pdf.add_font('DejaVu', '', str(font_dir / 'DejaVuSans.ttf'))
        pdf.add_font('DejaVu', 'B', str(font_dir / 'DejaVuSans-Bold.ttf'))
        pdf.add_font('DejaVu', 'I', str(font_dir / 'DejaVuSans-Oblique.ttf'))
        pdf.add_font('DejaVu', 'BI', str(font_dir / 'DejaVuSans-BoldOblique.ttf'))
        font_main = 'DejaVu'
    else:
        # Fallback latin-1: l'agente vedra' un errore se il markdown ha
        # caratteri unicode. Meglio chiaro che muto.
        font_main = 'Helvetica'

    def set_font(size: float, style: str = ''):
        pdf.set_font(font_main, style, size)

    def write_inline(text: str):
        # **bold**, *italic*, `code` (semplice — niente nesting)
        # Tokenizza: emette segmenti con stile diverso.
        tokens = re.split(r'(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)', text)
        for tok in tokens:
            if not tok:
                continue
            if tok.startswith('**') and tok.endswith('**'):
                set_font(10, 'B')
                pdf.write(5, tok[2:-2])
            elif tok.startswith('*') and tok.endswith('*') and len(tok) > 2:
                set_font(10, 'I')
                pdf.write(5, tok[1:-1])
            elif tok.startswith('`') and tok.endswith('`'):
                # codice inline: monospace + sfondo grigio chiaro
                pdf.set_font('Courier', '', 9.5)
                pdf.write(5, tok[1:-1])
                set_font(10)
            else:
                set_font(10)
                pdf.write(5, tok)
        pdf.ln(5)

    for raw in md_text.splitlines():
        line = raw.rstrip()
        if not line:
            pdf.ln(3)
        elif line.startswith('# '):
            set_font(18, 'B')
            pdf.cell(0, 10, line[2:], new_x='LMARGIN', new_y='NEXT')
        elif line.startswith('## '):
            set_font(12, 'B')
            pdf.cell(0, 7, line[3:], new_x='LMARGIN', new_y='NEXT')
            y = pdf.get_y()
            pdf.set_draw_color(160, 160, 160)
            pdf.line(15, y, 195, y)
            pdf.ln(2)
        elif line.startswith('### '):
            set_font(11, 'B')
            pdf.cell(0, 6, line[4:], new_x='LMARGIN', new_y='NEXT')
        elif line.strip() == '---':
            y = pdf.get_y() + 2
            pdf.set_draw_color(200, 200, 200)
            pdf.line(15, y, 195, y)
            pdf.ln(4)
        elif line.lstrip().startswith(('- ', '* ')):
            indent = len(line) - len(line.lstrip())
            content = line.lstrip()[2:]
            set_font(10)
            pdf.set_x(15 + 4 + indent)
            pdf.cell(3, 5, '•')
            pdf.set_x(15 + 8 + indent)
            write_inline(content)
        else:
            write_inline(line)

    pdf_path.parent.mkdir(parents=True, exist_ok=True)
    pdf.output(str(pdf_path))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('input_md')
    ap.add_argument('output_pdf')
    ap.add_argument('--force-cv', action='store_true',
                    help='Bypass the "CV path refused" guard. Intended only '
                         'for deliberate use or tests; do NOT use for production CVs.')
    args = ap.parse_args()

    md_path = Path(args.input_md)
    if not md_path.exists():
        print(f'ERROR: input Markdown file not found: {md_path}', file=sys.stderr)
        return 1

    pdf_path = Path(args.output_pdf)

    # Guard 2026-05-18: refuse CV paths. Post-mortem "CV estetica
    # semplificata" — gli Scrittori cadevano qui per fallback quando
    # cv-structure citava typst (non disponibile in pandoc 2.17),
    # producendo CV brutti 1 pagina invece di wkhtmltopdf 2 pagine.
    # Da oggi pdf_gen.py rifiuta esplicitamente di scrivere CV_* (e
    # qualsiasi path che contiene /cv/), suggerendo il comando giusto.
    name = pdf_path.name.lower()
    parent = str(pdf_path.parent).lower()
    looks_like_cv = name.startswith('cv_') or '/cv/' in parent or parent.endswith('/cv')
    if looks_like_cv and not args.force_cv:
        print('━' * 60, file=sys.stderr)
        print('ERROR: pdf_gen.py REFUSED — output path looks like a CV.',
              file=sys.stderr)
        print(f'  path: {pdf_path}', file=sys.stderr)
        print('', file=sys.stderr)
        print('pdf_gen.py (fpdf2) produces a basic one-page layout without CSS,',
              file=sys.stderr)
        print('which is NOT suitable for a user-facing professional CV.', file=sys.stderr)
        print('', file=sys.stderr)
        print('Use this command for CVs (cv-structure skill):', file=sys.stderr)
        print(f'  pandoc "{md_path}" -o "{pdf_path}" \\', file=sys.stderr)
        print('         --pdf-engine=wkhtmltopdf \\', file=sys.stderr)
        print('         --metadata title="CV ..."', file=sys.stderr)
        print('', file=sys.stderr)
        print('Expected output: ≥20 KB, 2 pages, Producer="Qt 5.x.x".',
              file=sys.stderr)
        print('If you must use fpdf2 for a CV: --force-cv (not recommended).',
              file=sys.stderr)
        print('━' * 60, file=sys.stderr)
        return 2

    try:
        from fpdf import FPDF  # noqa: F401
    except ImportError:
        print('ERROR: fpdf2 is missing. Install it with:', file=sys.stderr)
        print('  uv pip install --user fpdf2', file=sys.stderr)
        return 1

    md_text = md_path.read_text(encoding='utf-8')
    render(md_text, pdf_path)
    size = pdf_path.stat().st_size
    print(f'  ✓ {pdf_path}  ({size/1024:.1f} KB)')
    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
