"""I CV dello SCRITTORE hanno bisogno di pandoc + wkhtmltopdf NELL'IMMAGINE.

La skill cv-structure e shared/skills/pdf_gen.py producono i CV con
`pandoc input.md -o out.pdf --pdf-engine=wkhtmltopdf`, ma il Dockerfile non li
aveva mai installati: nel container lo SCRITTORE non produceva il PDF del CV.

Due livelli, come per Chromium:
- il Dockerfile li installa e ha un build gate che fa un render VERO (forma);
- `tool_health.py cv_pdf_render` — lo stesso check del gate e dello sweep del
  Mantenitore — dice OK solo se esce un PDF non vuoto, e lavora in una cwd
  scrivibile perche' pandoc scrive li' l'HTML intermedio (comportamento).
"""
import importlib.util
import os
import re
import shutil
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
DOCKERFILE = (ROOT / "Dockerfile").read_text(encoding="utf-8")
TOOL_HEALTH = ROOT / "shared" / "skills" / "tool_health.py"


def _apt_block() -> str:
    start = DOCKERFILE.index("RUN apt-get update && apt-get install -y --no-install-recommends \\")
    return DOCKERFILE[start : DOCKERFILE.index("&& rm -rf /var/lib/apt/lists/*", start)]


def _gate() -> str:
    start = DOCKERFILE.index("--only cv_pdf_render")
    run = DOCKERFILE.rindex("\nRUN ", 0, start)
    return DOCKERFILE[run : DOCKERFILE.index("\n\n", start)]


def test_the_image_installs_pandoc_and_wkhtmltopdf_in_the_system_apt_block():
    code = "\n".join(
        line for line in _apt_block().splitlines() if not line.strip().startswith("#")
    )
    assert re.search(r"\bpandoc\b", code), "pandoc non e' piu' installato nell'immagine"
    assert re.search(r"\bwkhtmltopdf\b", code), "wkhtmltopdf non e' piu' installato nell'immagine"


def test_the_build_fails_if_the_cv_render_fails():
    gate = _gate()
    assert "python3 shared/skills/tool_health.py --only cv_pdf_render" in gate
    assert "BUILD GATE FAILED" in gate and "exit 1" in gate
    # dopo l'installazione, non prima
    assert DOCKERFILE.index("pandoc wkhtmltopdf") < DOCKERFILE.index("--only cv_pdf_render")


def test_the_emulated_layer_still_renders_with_wkhtmltopdf_and_checks_pandoc():
    """Sotto QEMU pandoc (runtime GHC) viene ucciso anche su --version: il ramo
    emulato non deve saltare tutto, ma provare cio' che li' puo' girare."""
    gate = _gate()
    assert '"$TARGETARCH" != "$BUILDARCH"' in gate
    emulated = gate[gate.index('!= "$BUILDARCH"') : gate.index("else")]
    assert "wkhtmltopdf" in emulated and "%PDF" in emulated
    assert 'command -v pandoc' in emulated
    assert "CV_PDF_RENDER_EMULATED" in emulated
    assert DOCKERFILE.index("ARG TARGETARCH") < DOCKERFILE.index("--only cv_pdf_render")


def test_tool_health_registers_the_cv_render_check():
    source = TOOL_HEALTH.read_text(encoding="utf-8")
    assert '"cv_pdf_render": check_cv_pdf_render' in source


# ── Comportamento del check ─────────────────────────────────────────────────

pytestmark_posix = pytest.mark.skipif(sys.platform == "win32", reason="binari finti via shebang")


def _load_tool_health():
    spec = importlib.util.spec_from_file_location("tool_health_cv_test", TOOL_HEALTH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _fake_bins(tmp_path: Path, pandoc_body: str, with_wkhtmltopdf: bool = True) -> Path:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "pandoc").write_text("#!/bin/sh\n" + pandoc_body, encoding="utf-8")
    (bin_dir / "pandoc").chmod(0o755)
    if with_wkhtmltopdf:
        (bin_dir / "wkhtmltopdf").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        (bin_dir / "wkhtmltopdf").chmod(0o755)
    return bin_dir


# Il pandoc finto scrive nella cwd, come quello vero: da una cwd non
# scrivibile fallirebbe. Poi scrive il PDF nel path di `-o`.
WRITES_PDF_FROM_CWD = (
    'touch ./.intermediate.html || { echo "openTempFile: permission denied" >&2; exit 1; }\n'
    'out=""; while [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done\n'
    'printf "%%PDF-1.4 fake" > "$out"\n'
)


@pytestmark_posix
def test_a_real_pdf_is_ok_and_rendered_from_a_writable_cwd(tmp_path, monkeypatch):
    bin_dir = _fake_bins(tmp_path, WRITES_PDF_FROM_CWD)
    locked = tmp_path / "locked"
    locked.mkdir()
    locked.chmod(0o555)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}/usr/bin:/bin")
    monkeypatch.chdir(locked)
    try:
        status, evidence = _load_tool_health().check_cv_pdf_render()
    finally:
        locked.chmod(0o755)
    assert status == "OK", evidence


@pytestmark_posix
def test_an_empty_pdf_is_broken(tmp_path, monkeypatch):
    bin_dir = _fake_bins(
        tmp_path,
        'out=""; while [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done\n: > "$out"\n',
    )
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}/usr/bin:/bin")
    status, evidence = _load_tool_health().check_cv_pdf_render()
    assert status == "BROKEN" and "0 bytes" in evidence, evidence


@pytestmark_posix
def test_a_failed_render_is_broken(tmp_path, monkeypatch):
    bin_dir = _fake_bins(tmp_path, 'echo "wkhtmltopdf: cannot connect to X server" >&2\nexit 83\n')
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}/usr/bin:/bin")
    status, evidence = _load_tool_health().check_cv_pdf_render()
    assert status == "BROKEN" and "rc=83" in evidence, evidence


@pytestmark_posix
def test_a_missing_engine_is_broken(tmp_path, monkeypatch):
    bin_dir = _fake_bins(tmp_path, WRITES_PDF_FROM_CWD, with_wkhtmltopdf=False)
    monkeypatch.setenv("PATH", str(bin_dir))
    status, evidence = _load_tool_health().check_cv_pdf_render()
    assert status == "BROKEN" and "wkhtmltopdf" in evidence, evidence


@pytest.mark.skipif(
    not (shutil.which("pandoc") and shutil.which("wkhtmltopdf")),
    reason="pandoc/wkhtmltopdf non installati su questo host (il render vero lo fa il build gate)",
)
def test_the_real_chain_renders_when_installed():
    status, evidence = _load_tool_health().check_cv_pdf_render()
    assert status == "OK", evidence
