#!/usr/bin/env python3
"""Lettore PDF canonico per il Critico (e per chiunque debba estrarre testo
da un PDF prima di valutarlo).

Skill di livello 1: usa `pypdfium2` (gia' nel magazzino .local, in
ALWAYS_KEEP di py-tools-audit). Lightweight, no dipendenze native extra,
veloce.

Uso:
  python3 pdf_read.py <input.pdf>                    # tutto il testo a stdout
  python3 pdf_read.py <input.pdf> --pages 1-2        # solo range
  python3 pdf_read.py <input.pdf> --json             # {pages: [{n,text}], meta}
  python3 pdf_read.py <input.pdf> --meta             # solo metadata + page count

Quando NON usare questa skill (caso raro):
  - Estrazione di tabelle strutturate → usa `pdfplumber`
  - OCR su PDF scansionati → serve tesseract + altra pipeline
  → in quel caso scrivi script in `$JHT_AGENT_DIR/tools/`. NON installare
  `pypdf` o `pdfminer.six` solo per leggere testo: pypdfium2 lo fa.

Output: testo a stdout (UTF-8), exit 0 se ok, exit 1 in caso di errore.
"""

import argparse
import json
import sys
from pathlib import Path


def parse_pages(arg: str, n_pages: int):
    """'1-3,5,7-9' → [0,1,2,4,6,7,8] (zero-indexed)."""
    if not arg or arg == 'all':
        return list(range(n_pages))
    out = set()
    for part in arg.split(','):
        part = part.strip()
        if '-' in part:
            a, b = part.split('-', 1)
            for i in range(int(a), int(b) + 1):
                out.add(i - 1)
        else:
            out.add(int(part) - 1)
    return sorted(p for p in out if 0 <= p < n_pages)


def extract(pdf_path: Path, pages_arg: str | None, want_meta: bool, as_json: bool) -> int:
    try:
        import pypdfium2 as pdfium
    except ImportError:
        print('ERRORE: pypdfium2 mancante. Installa con:', file=sys.stderr)
        print('  uv pip install --user pypdfium2', file=sys.stderr)
        return 1

    if not pdf_path.exists():
        print(f'ERRORE: pdf non trovato: {pdf_path}', file=sys.stderr)
        return 1

    try:
        doc = pdfium.PdfDocument(str(pdf_path))
    except Exception as e:
        print(f'ERRORE apertura PDF: {e}', file=sys.stderr)
        return 1

    n_pages = len(doc)
    meta = {}
    try:
        meta = {k: v for k, v in (doc.get_metadata_dict() or {}).items() if v}
    except Exception:
        pass

    if want_meta and not as_json:
        print(f'pages: {n_pages}')
        for k, v in meta.items():
            print(f'{k}: {v}')
        doc.close()
        return 0

    pages_idx = parse_pages(pages_arg or 'all', n_pages)

    pages_data = []
    for i in pages_idx:
        page = doc[i]
        textpage = page.get_textpage()
        text = textpage.get_text_range()
        textpage.close()
        page.close()
        pages_data.append({'n': i + 1, 'text': text})

    if as_json:
        out = {
            'path': str(pdf_path),
            'n_pages_total': n_pages,
            'meta': meta,
            'pages': pages_data,
        }
        print(json.dumps(out, ensure_ascii=False, indent=2))
    else:
        # Testo concatenato, separatore form-feed (\f) tra pagine — standard
        # per lettori downstream che vogliono distinguerle.
        for p in pages_data:
            sys.stdout.write(p['text'])
            sys.stdout.write('\n\f\n')

    doc.close()
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('pdf')
    ap.add_argument('--pages', help='range pagine, es. "1-3,5" (1-indexed). Default: tutte')
    ap.add_argument('--meta', action='store_true', help='solo metadata + page count')
    ap.add_argument('--json', action='store_true', help='output strutturato')
    args = ap.parse_args()
    return extract(Path(args.pdf), args.pages, args.meta, args.json)


if __name__ == '__main__':
    sys.exit(main() or 0)
