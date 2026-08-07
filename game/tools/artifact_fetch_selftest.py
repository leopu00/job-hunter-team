#!/usr/bin/env python3
"""Esegue il payload artifact reale contro root sintetiche POSIX.

Il payload gira nel container Linux, quindi questo test e' POSIX: verifica il
confine openat/O_NOFOLLOW, non una sua copia semplificata lato host.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
import subprocess
import sys
import tempfile


GAME = Path(__file__).resolve().parents[1]
PAYLOAD = GAME / "scripts/backend/payloads/artifact.py"
PRODUCTION_ROOTS = (
    "/jht_user/cv",
    "/jht_user/allegati",
    "/jht_user/output",
    "/jht_user/critiche",
)
ROOT_LINE = "ROOTS = " + repr(PRODUCTION_ROOTS)
MAX_BYTES = 1024 * 1024
PDF = b"%PDF-1.4\n1 0 obj <<>> endobj\nstartxref\n0\n%%EOF\n"


def run_payload(source: str, roots: tuple[Path, ...], path: Path | str,
                kind: str) -> dict:
    test_roots = tuple(str(root) for root in roots)
    source = source.replace(ROOT_LINE, "ROOTS = " + repr(test_roots))
    if "ROOTS = " + repr(test_roots) not in source:
        raise AssertionError("root payload non sostituite: il test non e' fedele")
    path_b64 = base64.b64encode(str(path).encode()).decode()
    kind_b64 = base64.b64encode(kind.encode()).decode()
    rendered = source % (MAX_BYTES, path_b64, kind_b64)
    proc = subprocess.run(
        [sys.executable, "-c", rendered],
        check=False,
        capture_output=True,
        text=True,
        timeout=5,
    )
    if proc.returncode != 0:
        raise AssertionError(f"payload rc={proc.returncode}: {proc.stderr}")
    lines = [line for line in proc.stdout.splitlines() if line.startswith("{")]
    if len(lines) != 1:
        raise AssertionError(f"risposta payload ambigua: {proc.stdout!r}")
    return json.loads(lines[0])


def expect_denied(source: str, roots: tuple[Path, ...], path: Path | str,
                  kind: str, label: str) -> None:
    result = run_payload(source, roots, path, kind)
    if result.get("ok") or result.get("b64"):
        raise AssertionError(f"{label}: input accettato: {result}")


def main() -> None:
    source = PAYLOAD.read_text(encoding="utf-8")
    for anchor in ("os.O_NOFOLLOW", "dir_fd=fd", "stat.S_ISREG",
                   "data.startswith(b'%%PDF-')", "b'%%%%EOF'",
                   "'/jht_user/cv'", "'/jht_user/allegati'",
                   "'/jht_user/output'", "'/jht_user/critiche'"):
        if anchor not in source:
            raise AssertionError(f"guard payload assente: {anchor}")
    if "/jht_home" in source:
        raise AssertionError("il payload accetta ancora /jht_home")

    with tempfile.TemporaryDirectory(prefix="jht-artifact-") as tmp:
        base = Path(tmp)
        roots = tuple(base / name for name in ("cv", "allegati", "output", "critiche"))
        for root in roots:
            root.mkdir()

        valid_pdf = roots[0] / "CV_Test.pdf"
        valid_pdf.write_bytes(PDF)
        result = run_payload(source, roots, valid_pdf, "pdf")
        if not result.get("ok") or base64.b64decode(result["b64"]) != PDF:
            raise AssertionError(f"PDF valido rifiutato: {result}")

        valid_md = roots[1] / "CL_Test.md"
        valid_md.write_text("# Cover letter\n", encoding="utf-8")
        if not run_payload(source, roots, valid_md, "markdown").get("ok"):
            raise AssertionError("markdown canonico rifiutato")

        generic = roots[0] / "payload.txt"
        generic.write_bytes(PDF)
        expect_denied(source, roots, generic, "pdf", "file generico")

        for name in ("payload.pdf.exe", "payload.exe.pdf"):
            polymorph = roots[0] / name
            polymorph.write_bytes(PDF)
            expect_denied(source, roots, polymorph, "pdf", "doppia estensione")

        fake_pdf = roots[0] / "fake.pdf"
        fake_pdf.write_bytes(b"<html>not pdf</html>")
        expect_denied(source, roots, fake_pdf, "pdf", "magic assente")
        polyglot = roots[0] / "polyglot.pdf"
        polyglot.write_bytes(b"MZ" + PDF)
        expect_denied(source, roots, polyglot, "pdf", "magic non al byte zero")
        no_eof = roots[0] / "truncated.pdf"
        no_eof.write_bytes(b"%PDF-1.4\ntruncated")
        expect_denied(source, roots, no_eof, "pdf", "EOF assente")

        outside = base / "outside.pdf"
        outside.write_bytes(PDF)
        expect_denied(source, roots, outside, "pdf", "fuori root")
        traversal = str(roots[0] / ".." / "allegati" / valid_md.name)
        expect_denied(source, roots, traversal, "markdown", "path traversal")

        link = roots[0] / "linked.pdf"
        link.symlink_to(valid_pdf)
        expect_denied(source, roots, link, "pdf", "symlink file")
        real_dir = roots[0] / "real"
        real_dir.mkdir()
        nested = real_dir / "nested.pdf"
        nested.write_bytes(PDF)
        dir_link = roots[0] / "linked-dir"
        dir_link.symlink_to(real_dir, target_is_directory=True)
        expect_denied(source, roots, dir_link / "nested.pdf", "pdf",
                      "symlink directory")

        expect_denied(source, roots, valid_pdf, "generic", "tipo generico")
        expect_denied(source, roots, valid_pdf, "markdown", "tipo discordante")

    print("ARTIFACT-FETCH-SECURITY-TEST PASS")


if __name__ == "__main__":
    main()
