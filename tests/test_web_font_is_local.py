"""The site's font is a file of the repo: building it must not need the network.

web/app/layout.tsx used next/font/google, which downloads JetBrains Mono from Google at
build time. On a runner that cannot reach it the build failed ("Can't resolve
'@vercel/turbopack-next/internal/font/google/font'") in the welcome wizard e2e, and passed
on the rerun. It is now next/font/local on a ttf that lives in web/app/fonts.
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).parents[1]
WEB = ROOT / "web"
FONTS = WEB / "app" / "fonts"
LAYOUT = (WEB / "app" / "layout.tsx").read_text(encoding="utf-8")
FONT_FILE = "jetbrains-mono-wght.ttf"


def _web_sources():
    for path in WEB.rglob("*"):
        if path.suffix not in {".ts", ".tsx", ".js", ".jsx", ".mjs", ".css"}:
            continue
        if {"node_modules", ".next"} & set(path.parts):
            continue
        yield path


def test_no_file_of_the_site_asks_google_for_a_font_at_build_time():
    offenders = [
        str(path.relative_to(ROOT))
        for path in _web_sources()
        if re.search(r"""(?:from|import|require\()\s*\(?\s*["']next/font/google["']|https?://fonts\.(?:googleapis|gstatic)\.com""", path.read_text(encoding="utf-8", errors="ignore"))
    ]
    assert not offenders, offenders


def test_the_layout_loads_the_font_from_a_file_that_exists():
    assert 'from "next/font/local"' in LAYOUT
    src = re.search(r'localFont\(\{[^}]*?src:\s*"([^"]+)"', LAYOUT, re.S)
    assert src, "layout.tsx must call localFont({ src: ... })"
    font = (WEB / "app" / src.group(1)).resolve()
    assert font == (FONTS / FONT_FILE).resolve(), font
    assert font.is_file() and font.stat().st_size > 10_000
    assert font.read_bytes()[:4] == b"\x00\x01\x00\x00"   # a TrueType file
    # the CSS variable the stylesheet reads, and the weights the site uses (300 to 700), are kept
    assert 'variable: "--font-mono"' in LAYOUT
    assert re.search(r'weight:\s*"300 700"', LAYOUT)


def test_the_font_file_is_the_one_the_note_says_and_comes_with_its_license():
    note = (FONTS / "SOURCE.md").read_text(encoding="utf-8")
    declared = re.search(r"sha256 of the font file: `([0-9a-f]{64})`", note)
    assert declared, "SOURCE.md must give the sha256 of the font file"
    assert hashlib.sha256((FONTS / FONT_FILE).read_bytes()).hexdigest() == declared.group(1)
    assert "JetBrains Mono" in note and "2.304" in note and "github.com/JetBrains/JetBrainsMono" in note
    # the license is reproduced as it is: every line, trailing spaces aside, hashes to what the note says
    declared_license = re.search(r"as it is here .*?: `([0-9a-f]{64})`", note, re.S)
    assert declared_license, "SOURCE.md must give the sha256 of OFL.txt"
    normalized = "\n".join(line.rstrip() for line in (FONTS / "OFL.txt").read_text(encoding="utf-8").split("\n"))
    assert hashlib.sha256(normalized.encode("utf-8")).hexdigest() == declared_license.group(1)
    license_text = (FONTS / "OFL.txt").read_text(encoding="utf-8")
    assert "SIL OPEN FONT LICENSE Version 1.1" in license_text or "SIL Open Font License, Version 1.1" in license_text
