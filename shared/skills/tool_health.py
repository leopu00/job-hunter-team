#!/usr/bin/env python3
"""tool_health.py — smoke-test dei tool mission-critical → segnale strutturato.

Parte dev2 del redesign Mantenitore (design 2026-06-13). Il bug libatk è rimasto
invisibile per ore perché un tool critico (browser/Playwright per linkedin_check)
era morto e nessuno lo SAPEVA — lo si è scoperto a valle da 13 report analisti.
Questo script trasforma quel fallimento-silenzioso in un SEGNALE STRUTTURATO, come
`weekly_pace` ha fatto per il burn: il Mantenitore lo esegue, il bridge lo espone
nel tick (`tools_health`), Sentinella/Capitano lo vedono SUBITO.

Riusabile da: (a) gate build-time (dev1, fail-the-build), (b) Mantenitore sweep
runtime, (c) esposizione nel [BRIDGE TICK].

Uso:
    python3 tool_health.py [--json] [--only TOOL[,TOOL...]]

Output JSON:
    {
      "checked_at": "ISO-UTC",
      "tools": {
        "playwright_browser": {"status": "OK|BROKEN|UNKNOWN", "evidence": "..."},
        "linkedin_check":     {"status": "...", "evidence": "..."},
        ...
      },
      "any_broken": true|false,
      "broken": ["playwright_browser", ...]
    }

Exit code: 0 se nessun tool BROKEN, 1 se almeno uno BROKEN (così il gate
build-time può fare `python3 tool_health.py || exit 1`). Difensivo: un check che
solleva non fa crashare lo script — diventa UNKNOWN con l'evidenza dell'errore.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

APP = os.environ.get("JHT_APP_DIR", "/app")
TIMEOUT = 25  # un browser headless freddo può metterci qualche secondo


def _run(cmd, timeout=TIMEOUT, cwd=None):
    """Esegue un comando, ritorna (rc, stdout+stderr troncato). rc=-1 su timeout/errore."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd)
        return p.returncode, (p.stdout + p.stderr)[-600:]
    except subprocess.TimeoutExpired:
        return -1, "timeout after %ds" % timeout
    except (OSError, ValueError) as e:
        return -1, "exec error: %s" % e


def check_chromium_libs():
    """Le .so di sistema del browser ci sono? (il bug libatk). ldconfig non
    richiede root. Assenza di libatk → il browser NON parte (exit 127)."""
    if not shutil.which("ldconfig"):
        return "UNKNOWN", "ldconfig is missing; unable to verify system libraries"
    # NB: NON passare per _run() — tronca agli ultimi 600 char e `ldconfig -p`
    # elenca centinaia di lib ordinate: libatk/libnss3/libgbm/libasound stanno
    # in testa all'alfabeto e venivano tagliate via → falsi "mancanti" anche a
    # lib installate. Qui leggiamo l'output COMPLETO.
    try:
        p = subprocess.run(["ldconfig", "-p"], capture_output=True, text=True, timeout=10)
    except (subprocess.TimeoutExpired, OSError, ValueError) as e:
        return "UNKNOWN", "unable to run ldconfig: %s" % e
    if p.returncode != 0:
        return "UNKNOWN", "ldconfig rc=%d" % p.returncode
    out = p.stdout + p.stderr
    missing = [lib for lib in ("libatk-1.0", "libnss3", "libgbm", "libasound") if lib not in out]
    if missing:
        return "BROKEN", "missing system libraries: %s (browser cannot start)" % ", ".join(missing)
    return "OK", "browser libraries are present"


def check_playwright_browser():
    """Smoke-test reale: lancia chromium headless e basta. È il check che il gate
    build-time deve fare (se manca una .so qui FALLISCE). Graduale: prima le lib,
    poi il launch vero.

    Playwright in questo repo è PYTHON-only (`requirements.txt`; linkedin_check.py
    usa `from playwright.sync_api`). NON c'è un node playwright installato, quindi
    il launch DEVE passare per Python: testare il path reale del tool, non un node
    require che fallirebbe per "module not found" segnalando BROKEN a vuoto."""
    lib_status, lib_ev = check_chromium_libs()
    if lib_status == "BROKEN":
        return "BROKEN", lib_ev  # inutile tentare il launch, manca la .so
    # launch reale via Python playwright headless (chiude subito) — identico al
    # path di linkedin_check.py (headless=True + only-shell baked nell'immagine).
    snippet = (
        "from playwright.sync_api import sync_playwright\n"
        "try:\n"
        "    with sync_playwright() as p:\n"
        "        b = p.chromium.launch(headless=True); b.close()\n"
        "    print('LAUNCH_OK')\n"
        "except Exception as e:\n"
        "    import sys; print('LAUNCH_FAIL %s' % e, file=sys.stderr); sys.exit(2)\n"
    )
    rc, out = _run([sys.executable, "-c", snippet])
    if rc == 0 and "LAUNCH_OK" in out:
        return "OK", "chromium headless launch ok (python)"
    return "BROKEN", "launch failed (rc=%d): %s" % (rc, out.strip()[:200])


def check_linkedin_check():
    """Il canary applicativo: linkedin_check.py deve avviarsi e caricare le sue
    deps (playwright incluso). NON usiamo `--help`: lo script non ha argparse e
    tratta argv[1] come URL → con "--help" naviga verso un URL invalido e dà un
    falso BROKEN (verificato a terra 2026-06-13). Usiamo `--batch` SENZA id:
    batch vuoto fa importare playwright, parsare gli args ed uscire 0 senza
    navigare. Il launch REALE del browser (il bug libatk) è già coperto da
    check_playwright_browser, quindi qui basta che lo script applicativo si
    avvii e carichi le sue dipendenze."""
    path = os.path.join(APP, "shared", "skills", "linkedin_check.py")
    if not os.path.exists(path):
        return "UNKNOWN", "linkedin_check.py not found at %s" % path
    rc, out = _run([sys.executable, path, "--batch"], timeout=20)
    # batch vuoto → exit 0 ("Verifica batch: 0 posizioni"); se playwright non
    # importa o manca una .so → rc!=0 con traccia dell'import.
    if rc == 0:
        return "OK", "linkedin_check starts successfully (Playwright loaded, empty batch OK)"
    if "libatk" in out or "playwright" in out.lower() or rc == 127:
        return "BROKEN", "linkedin_check cannot start (browser dependency): %s" % out.strip()[:160]
    return "UNKNOWN", "linkedin_check --batch rc=%d: %s" % (rc, out.strip()[:120])


def check_cv_pdf_render():
    """Il CV esce davvero, e largo quanto la pagina: pandoc + wkhtmltopdf + il
    CSS base + pdf_layout_check.py, sullo stesso comando della skill cv-structure.

    Nessuno dei due binari era nell'immagine: erano arrivati con un `sudo
    apt-get` degli agenti dentro il container, e il redeploy del 13/09 (container
    ricreato) li ha persi in silenzio — lo Scrittore trovava solo weasyprint.
    Ora sono nel Dockerfile e questo check e' il gate di build: se manca un
    pezzo, o il layout torna una colonna stretta, il BUILD va rosso."""
    missing = [b for b in ("pandoc", "wkhtmltopdf", "pdftotext", "pdffonts") if not shutil.which(b)]
    if missing:
        return "BROKEN", "missing CV PDF toolchain: %s (CVs cannot be rendered or checked)" % ", ".join(missing)
    skills = os.path.join(APP, "shared", "skills")
    css = os.path.join(skills, "pdf_layout_base.css")
    if not os.path.isfile(css):
        return "BROKEN", "pdf_layout_base.css not found at %s" % css
    import tempfile
    sys.path.insert(0, skills)
    try:
        import pdf_layout_check
    finally:
        sys.path.remove(skills)
    bullet = ("- Synthetic health-check line that wraps across the whole usable width of the page "
              "so the gate can measure the text column of the real renderer.")
    body = "\n".join("## Section %d\n\n%s\n" % (i, "\n".join([bullet] * 4)) for i in range(1, 7))
    with tempfile.TemporaryDirectory() as tmp:
        md = os.path.join(tmp, "health.md")
        pdf = os.path.join(tmp, "health.pdf")
        with open(md, "w", encoding="utf-8") as fh:
            # Same small type a Writer's <style> uses: at the template's 36em the
            # column is only narrow when the font is small, so the gate needs it.
            fh.write("<style>body { font-size: 9.3pt; }</style>\n\n# Health Check\n\n" + body)
        rc, out = _run([
            "pandoc", md, "-o", pdf, "--pdf-engine=wkhtmltopdf",
            "-c", css, "--self-contained",
            "-V", "papersize=A4", "-V", "margin-top=11mm", "-V", "margin-bottom=11mm",
            "-V", "margin-left=15mm", "-V", "margin-right=15mm",
            "--metadata", "pagetitle=health",
        ], timeout=60, cwd=tmp)  # pandoc writes its temp HTML in the cwd: /app is read-only for jht
        if rc != 0 or not os.path.isfile(pdf):
            return "BROKEN", "pandoc/wkhtmltopdf render failed (rc=%d): %s" % (rc, out.strip()[-200:])
        try:
            report = pdf_layout_check.analyze(Path(pdf))
        except pdf_layout_check.CheckError as e:
            return "BROKEN", "pdf_layout_check cannot measure the render: %s" % e
    if not report["ok"]:
        widths = [p["width_ratio"] for p in report["per_page"]]
        return "BROKEN", "rendered CV fails the layout gate: %s (width %s)" % (",".join(report["reasons"]), widths)
    return "OK", "CV render ok (width %s of the usable page)" % report["per_page"][0]["width_ratio"]


# Registro dei tool critici. Estendibile (domanda aperta del doc: quali altri).
CHECKS = {
    "playwright_browser": check_playwright_browser,
    "linkedin_check": check_linkedin_check,
    "cv_pdf_render": check_cv_pdf_render,
}


def collect(only=None):
    tools = {}
    for name, fn in CHECKS.items():
        if only and name not in only:
            continue
        try:
            status, evidence = fn()
        except Exception as e:  # difensivo: un check rotto non rompe lo sweep
            status, evidence = "UNKNOWN", "check failed: %s" % e
        tools[name] = {"status": status, "evidence": evidence}
    broken = [n for n, t in tools.items() if t["status"] == "BROKEN"]
    return {
        "checked_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "tools": tools,
        "any_broken": bool(broken),
        "broken": broken,
    }


def main(argv=None):
    p = argparse.ArgumentParser(description="Smoke-test mission-critical tools → tools_health")
    p.add_argument("--json", action="store_true", help="print JSON (default)")
    p.add_argument("--only", default=None, help="CSV list of tools to check")
    args = p.parse_args(argv)
    only = set(args.only.split(",")) if args.only else None
    out = collect(only)
    print(json.dumps(out, ensure_ascii=False))
    return 1 if out["any_broken"] else 0


if __name__ == "__main__":
    sys.exit(main())
