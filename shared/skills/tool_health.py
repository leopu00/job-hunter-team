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

APP = os.environ.get("JHT_APP_DIR", "/app")
TIMEOUT = 25  # un browser headless freddo può metterci qualche secondo


def _run(cmd, timeout=TIMEOUT):
    """Esegue un comando, ritorna (rc, stdout+stderr troncato). rc=-1 su timeout/errore."""
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout + p.stderr)[-600:]
    except subprocess.TimeoutExpired:
        return -1, "timeout dopo %ds" % timeout
    except (OSError, ValueError) as e:
        return -1, "exec error: %s" % e


def check_chromium_libs():
    """Le .so di sistema del browser ci sono? (il bug libatk). ldconfig non
    richiede root. Assenza di libatk → il browser NON parte (exit 127)."""
    if not shutil.which("ldconfig"):
        return "UNKNOWN", "ldconfig assente, impossibile verificare le lib"
    rc, out = _run(["ldconfig", "-p"], timeout=10)
    if rc != 0:
        return "UNKNOWN", "ldconfig rc=%d" % rc
    missing = [lib for lib in ("libatk-1.0", "libnss3", "libgbm", "libasound") if lib not in out]
    if missing:
        return "BROKEN", "lib di sistema mancanti: %s (browser non parte)" % ", ".join(missing)
    return "OK", "lib browser presenti"


def check_playwright_browser():
    """Smoke-test reale: lancia chromium headless e basta. È il check che il gate
    build-time deve fare (se manca una .so qui FALLISCE). Graduale: prima le lib,
    poi il launch vero se node/playwright sono disponibili."""
    lib_status, lib_ev = check_chromium_libs()
    if lib_status == "BROKEN":
        return "BROKEN", lib_ev  # inutile tentare il launch, manca la .so
    # launch reale via node playwright (headless, chiude subito)
    node = shutil.which("node")
    if not node:
        return lib_status, "node assente; verifico solo le lib (%s)" % lib_ev
    snippet = (
        "const {chromium}=require('playwright');"
        "(async()=>{try{const b=await chromium.launch({headless:true});"
        "await b.close();console.log('LAUNCH_OK');process.exit(0);}"
        "catch(e){console.error('LAUNCH_FAIL '+e.message);process.exit(2);}})();"
    )
    rc, out = _run([node, "-e", snippet])
    if rc == 0 and "LAUNCH_OK" in out:
        return "OK", "chromium headless launch ok"
    return "BROKEN", "launch fallito (rc=%d): %s" % (rc, out.strip()[:200])


def check_linkedin_check():
    """Il canary applicativo: linkedin_check.py deve almeno avviarsi (--help / dry).
    È il tool che è morto col libatk. Se lo script non c'è → UNKNOWN."""
    path = os.path.join(APP, "shared", "skills", "linkedin_check.py")
    if not os.path.exists(path):
        return "UNKNOWN", "linkedin_check.py non trovato in %s" % path
    rc, out = _run([sys.executable, path, "--help"], timeout=15)
    # --help dovrebbe uscire 0; se importa playwright e fallisce all'import → rc!=0
    if rc == 0:
        return "OK", "linkedin_check importabile/avviabile"
    if "libatk" in out or "playwright" in out.lower() or rc == 127:
        return "BROKEN", "linkedin_check non parte (dep browser): %s" % out.strip()[:160]
    return "UNKNOWN", "linkedin_check --help rc=%d: %s" % (rc, out.strip()[:120])


# Registro dei tool critici. Estendibile (domanda aperta del doc: quali altri).
CHECKS = {
    "playwright_browser": check_playwright_browser,
    "linkedin_check": check_linkedin_check,
}


def collect(only=None):
    tools = {}
    for name, fn in CHECKS.items():
        if only and name not in only:
            continue
        try:
            status, evidence = fn()
        except Exception as e:  # difensivo: un check rotto non rompe lo sweep
            status, evidence = "UNKNOWN", "check error: %s" % e
        tools[name] = {"status": status, "evidence": evidence}
    broken = [n for n, t in tools.items() if t["status"] == "BROKEN"]
    return {
        "checked_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "tools": tools,
        "any_broken": bool(broken),
        "broken": broken,
    }


def main(argv=None):
    p = argparse.ArgumentParser(description="Smoke-test tool mission-critical → tools_health")
    p.add_argument("--json", action="store_true", help="stampa JSON (default)")
    p.add_argument("--only", default=None, help="lista CSV di tool da controllare")
    args = p.parse_args(argv)
    only = set(args.only.split(",")) if args.only else None
    out = collect(only)
    print(json.dumps(out, ensure_ascii=False))
    return 1 if out["any_broken"] else 0


if __name__ == "__main__":
    sys.exit(main())
