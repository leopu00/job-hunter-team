#!/usr/bin/env python3
"""Generatore PDF canonico per CV/Cover Letter da markdown.

Skill di livello 1 (caso 80%): markdown -> PDF via `fpdf2` (pure
Python, gia' nel magazzino .local, no dipendenze native — funziona
out-of-the-box nel container senza apt extra).

Uso:
  python3 pdf_gen.py <input.md> <output.pdf>

Quando NON usare questa skill (livello 2 — caso 20%):
  - Layout custom richiesto dall'utente (timeline, colonne, font particolari)
  - Asset immagini posizionati, header/footer custom
  - HTML/CSS complessi (in quel caso valuta `weasyprint` MA richiede
    `apt install libpango-1.0-0 libpangoft2-1.0-0` nel Dockerfile)
  → in quel caso scrivi script in `$JHT_AGENT_DIR/tools/` usando una
  libreria gia' nel magazzino. NON installare nuove librerie senza
  prima `pip show <pkg>` e check whitelist (RULE-T13).

Subset markdown supportato (volutamente piccolo per essere predicibile):
  # Title       (H1, large header — usato per il nome candidato)
  ## Section    (H2, sezione con linea sotto)
  ### Subsection(H3, ruolo/azienda)
  - bullet
  **bold**, *italic*, `code` inline
  ---           (regola orizzontale)

Output: scrive il PDF, exit 0 se ok, exit 1 con stderr in caso di errore.
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
    args = ap.parse_args()

    md_path = Path(args.input_md)
    if not md_path.exists():
        print(f'ERRORE: input md non trovato: {md_path}', file=sys.stderr)
        return 1

    try:
        from fpdf import FPDF  # noqa: F401
    except ImportError:
        print('ERRORE: fpdf2 mancante. Installa con:', file=sys.stderr)
        print('  uv pip install --user fpdf2', file=sys.stderr)
        return 1

    pdf_path = Path(args.output_pdf)
    md_text = md_path.read_text(encoding='utf-8')
    render(md_text, pdf_path)
    size = pdf_path.stat().st_size
    print(f'  ✓ {pdf_path}  ({size/1024:.1f} KB)')
    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
