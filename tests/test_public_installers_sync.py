"""Verifica che scripts/install.{sh,ps1} == web/public/install.{sh,ps1}.

Origin: WIN-E2E 2026-05-22 — jobhunterteam.ai/install.ps1 era 404 perche'
install.ps1 esisteva solo in scripts/ ma NON in web/public/. Master ha
aggiunto la copia (a95fb028) ma senza automazione le 2 copie divergono
silenziosamente al prossimo edit.

Questo test fa fail in CI se le copie divergono. Fix: run
`bash scripts/sync-public-installers.sh` e ri-committare web/public/.
"""

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / 'scripts'
PUBLIC_DIR = REPO_ROOT / 'web' / 'public'

INSTALLERS = ['install.sh', 'install.ps1']


def _read_bytes(path: Path) -> bytes:
    """Read file as bytes, normalize CRLF -> LF per evitare drift line ending.

    Git su Windows puo' convertire LF -> CRLF al checkout (vedi warning
    "LF will be replaced by CRLF the next time Git touches it"). Il file
    served da Vercel deve essere identico al source nei contenuti, ma
    line endings sono OK divergano cross-platform. Normalizziamo per il
    confronto.
    """
    return path.read_bytes().replace(b'\r\n', b'\n')


def test_install_sh_in_sync():
    """scripts/install.sh deve essere identico (content-wise) a web/public/install.sh."""
    src = SCRIPTS_DIR / 'install.sh'
    dst = PUBLIC_DIR / 'install.sh'
    assert src.exists(), f"source mancante: {src}"
    assert dst.exists(), (
        f"mirror mancante: {dst}\n"
        "Run: bash scripts/sync-public-installers.sh"
    )
    src_content = _read_bytes(src)
    dst_content = _read_bytes(dst)
    assert src_content == dst_content, (
        f"DRIFT detected: {src} != {dst}\n"
        f"  src size: {len(src_content)} bytes\n"
        f"  dst size: {len(dst_content)} bytes\n"
        "Run: bash scripts/sync-public-installers.sh"
    )


def test_install_ps1_in_sync():
    """scripts/install.ps1 deve essere identico (content-wise) a web/public/install.ps1."""
    src = SCRIPTS_DIR / 'install.ps1'
    dst = PUBLIC_DIR / 'install.ps1'
    assert src.exists(), f"source mancante: {src}"
    assert dst.exists(), (
        f"mirror mancante: {dst}\n"
        "Run: bash scripts/sync-public-installers.sh"
    )
    src_content = _read_bytes(src)
    dst_content = _read_bytes(dst)
    assert src_content == dst_content, (
        f"DRIFT detected: {src} != {dst}\n"
        f"  src size: {len(src_content)} bytes\n"
        f"  dst size: {len(dst_content)} bytes\n"
        "Run: bash scripts/sync-public-installers.sh"
    )


def test_sync_script_exists_and_executable():
    """Lo script di sync deve esistere e essere eseguibile su Unix."""
    sync_script = SCRIPTS_DIR / 'sync-public-installers.sh'
    assert sync_script.exists(), f"sync script mancante: {sync_script}"
    # mode check: salta su Windows dove gli execute bit non sono significativi
    if os.name != 'nt':
        mode = sync_script.stat().st_mode
        assert mode & 0o111, f"sync script non eseguibile: {sync_script} (mode={oct(mode)})"
