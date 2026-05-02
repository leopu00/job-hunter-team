#!/usr/bin/env python3
"""Audit dei pacchetti Python installati in $PYTHONUSERBASE.

Lista i pacchetti in `$PYTHONUSERBASE/lib/pythonX.Y/site-packages/` (default
`/jht_home/.local/...`), li confronta con gli `import` trovati nel codice
attivo del progetto (skill condivise + agenti + tools/tmp di runtime), e
segnala come **candidates per uninstall** quelli senza riferimenti.

Uso da Capitano:
  python3 py_tools_audit.py                    # report standard
  python3 py_tools_audit.py --json             # output strutturato
  python3 py_tools_audit.py --threshold-mb 50  # avvisa se .local > N MB
  python3 py_tools_audit.py --candidates-only  # solo lista candidates
  python3 py_tools_audit.py --keep <pkg>...    # esclude pkg dalla lista

Quando lanciarlo (regola Capitano in team-rules.md sezione cleanup):
- ~weekly per igiene
- on-demand quando `du -sh ~/.jht/.local` supera 800 MB
- prima di un major release o handoff

Output canonico per il broadcast del Capitano: lista `--candidates-only`,
poi tmux-send a tutti gli agenti con tag `[KEEP <pkg>]` per eccezioni,
poi `pip uninstall` di quanto non confermato.
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from pathlib import Path


# Package → import name spesso differiscono (PIL vs pillow, beautifulsoup4
# vs bs4, ecc.). Mappa esplicita per i casi piu' comuni del progetto +
# catch-all per la normalizzazione (lower, _ → -, strip suffix).
PKG_TO_IMPORTS = {
    'beautifulsoup4': ['bs4'],
    'pillow': ['PIL'],
    'pyyaml': ['yaml'],
    'pdfminer.six': ['pdfminer'],
    'pymupdf': ['fitz', 'pymupdf'],
    'python-dateutil': ['dateutil'],
    'protobuf': ['google.protobuf'],
    'opencv-python': ['cv2'],
    'scikit-learn': ['sklearn'],
    'msgpack-python': ['msgpack'],
    'fpdf2': ['fpdf'],
    'typing-extensions': ['typing_extensions'],
}

# Whitelist: pacchetti che NON devono mai essere proposti come candidates,
# anche se nessun import diretto li referenzia. Sono:
#  - dipendenze transitive comuni (numpy/packaging/six/setuptools chiamati
#    indirettamente da matplotlib/weasyprint/playwright/altre)
#  - binary-only CLI (uv) o pacchetti caricati a runtime
#  - librerie "low-level" che vediamo poco negli import diretti
# Aggiungere qui se il --keep manuale del Capitano si ripete ad ogni audit.
ALWAYS_KEEP = {
    'uv', 'pip', 'setuptools', 'wheel',
    'numpy', 'packaging', 'six', 'python_dateutil',
    'pillow', 'fonttools', 'kiwisolver', 'cycler', 'contourpy', 'pyparsing',
    'pyphen', 'tinycss2', 'webencodings', 'cssselect2', 'tinyhtml5', 'pydyf',
    'brotli', 'zopfli', 'defusedxml', 'greenlet', 'pyee',
    'pypdfium2', 'pypdfium2_raw',
    'urllib3', 'certifi', 'charset_normalizer', 'idna', 'requests',
    'typing_extensions', 'markupsafe', 'jinja2',
}

# Cartelle dove cercare gli import. Path relativi al container (l'host vede
# gli stessi via bind mount). Il fallback all'host e' gestito sotto.
SEARCH_ROOTS_CONTAINER = [
    '/app/shared/skills',
    '/app/agents',
    '/jht_home/agents',
]
SEARCH_ROOTS_HOST = [
    str(Path.home() / 'Repos' / 'job-hunter-team' / 'master' / 'shared' / 'skills'),
    str(Path.home() / 'Repos' / 'job-hunter-team' / 'master' / 'agents'),
    str(Path.home() / '.jht' / 'agents'),
]

IMPORT_RE = re.compile(
    r'^\s*(?:from\s+([a-zA-Z_][\w.]*)|import\s+([a-zA-Z_][\w.]*))',
    re.MULTILINE,
)


def normalize(name: str) -> str:
    """pip name → confronto-friendly (lower, '-'→'_', strip version)."""
    return name.lower().replace('-', '_').replace('.', '_').split('==')[0].strip()


def expected_import_names(pkg: str):
    """Ritorna il set di possibili `import X` per un pip pkg."""
    norm = normalize(pkg)
    names = {norm}
    if pkg in PKG_TO_IMPORTS:
        names.update(PKG_TO_IMPORTS[pkg])
    if pkg.lower() in PKG_TO_IMPORTS:
        names.update(PKG_TO_IMPORTS[pkg.lower()])
    return {n.lower() for n in names}


def list_user_packages():
    """Lista i pacchetti in $PYTHONUSERBASE/lib/pythonX.Y/site-packages/."""
    # docker exec NON eredita ENV dal Dockerfile, quindi PYTHONUSERBASE
    # puo' essere vuoto nel container anche se l'image lo setta. Fallback
    # via site.getuserbase() che usa la logica canonica di Python (su
    # Linux: $HOME/.local, su macOS host: $HOME/Library/Python/X.Y).
    base = os.environ.get('PYTHONUSERBASE')
    if not base:
        import site
        base = site.getuserbase()
    lib_dir = Path(base) / 'lib'
    if not lib_dir.exists():
        return base, []

    py_dirs = sorted(lib_dir.glob('python*'))
    if not py_dirs:
        return base, []
    site_pkgs = py_dirs[-1] / 'site-packages'
    if not site_pkgs.exists():
        return base, []

    pkgs = []
    for entry in sorted(site_pkgs.iterdir()):
        # *.dist-info → pacchetto installato
        if entry.is_dir() and entry.name.endswith('.dist-info'):
            stem = entry.name[: -len('.dist-info')]
            # "weasyprint-65.2" → name=weasyprint, version=65.2
            parts = stem.rsplit('-', 1)
            name = parts[0]
            version = parts[1] if len(parts) == 2 else '?'
            # Parse RECORD per trovare i file installati (path relativi a
            # site-packages). Senza RECORD non possiamo sapere quale
            # cartella appartiene al pkg → fallback su nome cartella ==
            # nome pkg.
            installed_paths = set()
            record = entry / 'RECORD'
            if record.exists():
                try:
                    for line in record.read_text(encoding='utf-8',
                                                 errors='ignore').splitlines():
                        path = line.split(',', 1)[0].strip()
                        if path and not path.startswith('/'):
                            installed_paths.add(path)
                except OSError:
                    pass
            # Calcola bytes effettivi (dist-info + tutti i file in RECORD)
            total = 0
            try:
                total += sum(f.stat().st_size for f in entry.rglob('*') if f.is_file())
            except OSError:
                pass
            for rel in installed_paths:
                fp = site_pkgs / rel
                try:
                    if fp.is_file():
                        total += fp.stat().st_size
                except OSError:
                    pass
            try:
                mtime = entry.stat().st_mtime
            except OSError:
                mtime = 0
            pkgs.append({
                'name': name,
                'version': version,
                'dist_info': str(entry),
                'install_bytes': total,
                'mtime': mtime,
            })
    return str(site_pkgs), pkgs


def find_imports_in_tree(roots):
    """Scansiona ricorsivamente i file .py sotto roots, ritorna set di
    import root-module name (lower-cased)."""
    imports = set()
    for root in roots:
        p = Path(root)
        if not p.exists():
            continue
        for f in p.rglob('*.py'):
            # skip __pycache__ e file di backup
            if '__pycache__' in f.parts or f.name.endswith('.bak'):
                continue
            try:
                text = f.read_text(encoding='utf-8', errors='ignore')
            except OSError:
                continue
            for m in IMPORT_RE.finditer(text):
                mod = (m.group(1) or m.group(2) or '').split('.')[0].lower()
                if mod:
                    imports.add(mod)
    return imports


def fmt_size(b: int) -> str:
    if b < 1024:
        return f'{b} B'
    if b < 1048576:
        return f'{b/1024:.1f} KB'
    return f'{b/1048576:.1f} MB'


def fmt_age(mtime: float) -> str:
    if not mtime:
        return '?'
    import time
    days = (time.time() - mtime) / 86400
    if days < 1:
        return f'{int(days*24)}h'
    if days < 30:
        return f'{int(days)}d'
    return f'{int(days/30)}mo'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--json', action='store_true', help='output strutturato')
    ap.add_argument('--threshold-mb', type=int, default=0,
                    help='warna se total install bytes > N MB')
    ap.add_argument('--candidates-only', action='store_true',
                    help='solo lista candidates per uninstall, una per riga')
    ap.add_argument('--keep', nargs='*', default=[],
                    help='pacchetti da escludere dai candidates (es. --keep numpy matplotlib)')
    args = ap.parse_args()

    # Trova le roots di ricerca (preferisci container path se esiste).
    roots = [r for r in SEARCH_ROOTS_CONTAINER if Path(r).exists()]
    if not roots:
        roots = [r for r in SEARCH_ROOTS_HOST if Path(r).exists()]

    site_pkgs_dir, pkgs = list_user_packages()
    imports = find_imports_in_tree(roots)
    keep = {normalize(k) for k in args.keep}

    # Marca ogni pacchetto: usato / non usato. Un pacchetto e' "usato" se:
    #  (a) qualcuno lo importa direttamente, OPPURE
    #  (b) e' nella whitelist statica (transitive deps + binary CLI), OPPURE
    #  (c) e' stato passato in --keep dal Capitano per questa run.
    for p in pkgs:
        expected = expected_import_names(p['name'])
        p['used_by_imports'] = sorted(expected & imports)
        norm = normalize(p['name'])
        p['always_keep'] = norm in ALWAYS_KEEP
        p['used'] = (
            bool(p['used_by_imports'])
            or p['always_keep']
            or norm in keep
        )

    candidates = [p for p in pkgs if not p['used']]
    candidates.sort(key=lambda x: -x['install_bytes'])
    used = [p for p in pkgs if p['used']]
    total_bytes = sum(p['install_bytes'] for p in pkgs)
    candidates_bytes = sum(p['install_bytes'] for p in candidates)

    if args.candidates_only:
        for c in candidates:
            print(c['name'])
        return 0

    if args.json:
        out = {
            'site_packages_dir': site_pkgs_dir,
            'search_roots': roots,
            'total_packages': len(pkgs),
            'used_packages': len(used),
            'candidates': [
                {k: v for k, v in c.items() if k != 'mtime'}
                | {'age': fmt_age(c['mtime'])}
                for c in candidates
            ],
            'total_install_bytes': total_bytes,
            'candidates_install_bytes': candidates_bytes,
        }
        print(json.dumps(out, indent=2))
        return 0

    print(f"\n  py-tools-audit — {site_pkgs_dir}")
    print(f"  search roots: {', '.join(roots)}")
    print(f"  totale pacchetti: {len(pkgs)} ({fmt_size(total_bytes)} install)")
    print(f"  con import attivi: {len(used)}")
    print(f"  candidates uninstall: {len(candidates)} ({fmt_size(candidates_bytes)})")

    if candidates:
        print(f"\n  --- CANDIDATES ({len(candidates)}) — uninstall safe se nessuno protesta ---")
        print(f"  {'pkg':<25} {'ver':<12} {'size':>10} {'install age':>12}")
        print('  ' + '-' * 65)
        for c in candidates:
            print(f"  {c['name'][:25]:<25} {c['version'][:12]:<12} {fmt_size(c['install_bytes']):>10} {fmt_age(c['mtime']):>12}")

        print(f"\n  Comando broadcast suggerito (Capitano → tutto il team):")
        print(f"    'py-tools-audit candidates: {', '.join(c['name'] for c in candidates[:10])}'")
        if len(candidates) > 10:
            print(f"    + {len(candidates)-10} altri (vedi --json)")
        print(f"    'Conferma [KEEP <pkg>] entro 1h se ne usi una.'")

    if args.threshold_mb and total_bytes > args.threshold_mb * 1048576:
        print(f"\n  ⚠️  TOTALE > soglia ({args.threshold_mb} MB) — è ora di pulire.")
        return 2  # exit code per Capitano script

    return 0


if __name__ == '__main__':
    sys.exit(main() or 0)
