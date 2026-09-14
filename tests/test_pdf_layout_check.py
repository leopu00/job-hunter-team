"""CV PDF layout: the visual gate, the render command and its toolchain.

Origin. The CV attached to application 2067 had its text squeezed into a
centred column (pandoc's HTML template: body `max-width: 36em`; wkhtmltopdf
ignores `@page`). It passed the size + Producer gate, which proves the engine,
not the layout. And after the 13/09 redeploy neither pandoc nor wkhtmltopdf
was in the container: they had never been in the image.

This suite holds:

  1. pdf_layout_check.py on PDFs printed by the REAL engine, rendered at test
     time by tests/fixtures/pdf_layout/generate.py (PDFs never enter the repo): the legacy
     command → narrow_text; the fixed command → OK; a spill onto page 2 →
     near_empty_page; three pages → too_many_pages; fonts not embedded →
     fonts_not_embedded; unmeasurable → exit 2, never a pass;
  2. one render command everywhere: the cv-structure skill (7 languages), the
     SCRITTORE prompt, the fixture generator and the tool_health build gate
     carry the same base CSS and margins, and the margins match the gate's;
  3. the image bakes pandoc + wkhtmltopdf and fails the build on cv_pdf_render;
  4. the CLOSER skill names `cv_pdf_layout_bad` and `cv_pdf_check_unavailable`
     in every language (the send-code hook is HQ-BACKEND's and HQ-BACKEND-2's).
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
CHECK = SKILLS / "pdf_layout_check.py"
CSS = SKILLS / "pdf_layout_base.css"
FIXTURES = ROOT / "tests" / "fixtures" / "pdf_layout"
LANGS = ("en", "it", "es", "fr", "de", "pt", "hu")

POPPLER = all(shutil.which(tool) for tool in ("pdftotext", "pdffonts", "pdftoppm", "pdfinfo"))
ENGINE = all(shutil.which(tool) for tool in ("pandoc", "wkhtmltopdf"))
# Skipping in CI would leave the gate untested exactly where every push runs:
# the workflow installs the toolchain, so there a missing tool is a failure.
needs_poppler = pytest.mark.skipif(
    not POPPLER and not os.environ.get("CI"), reason="poppler-utils not installed"
)
needs_engine = pytest.mark.skipif(
    not (POPPLER and ENGINE) and not os.environ.get("CI"),
    reason="pandoc + wkhtmltopdf + poppler-utils not installed (they run in CI and in the container)",
)


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(path.parent))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(path.parent))
    return module


check = _load("pdf_layout_check_under_test", CHECK)
generator = _load("pdf_layout_generate", FIXTURES / "generate.py")


@pytest.fixture(scope="session")
def pdfs(tmp_path_factory):
    """The four CVs, printed now by pandoc + wkhtmltopdf with the skill's command."""
    return generator.render_all(tmp_path_factory.mktemp("pdf_layout"), CSS)


def _cli(*args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(CHECK), *args], capture_output=True, text=True,
        env={**os.environ, **(env or {})},
    )


def _localized(directory: Path, stem: str, lang: str) -> Path:
    return directory / (f"{stem}.md" if lang == "en" else f"{stem}.{lang}.md")


def _base14_pdf(path: Path, *, lines: int = 40, chars: int = 110) -> Path:
    """A full-width text page in Helvetica, which is never embedded."""
    text = "Synthetic line of a fictional CV used only to test the embedded font check "
    content = "".join(
        f"BT /F1 9 Tf 42.5 {800 - i * 14} Td ({(text * 3)[:chars]}) Tj ET\n" for i in range(lines)
    ).encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % off for off in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    path.write_bytes(bytes(out))
    return path


# ── 1. the gate on real wkhtmltopdf output ──────────────────────────────────


@needs_engine
@pytest.mark.parametrize("name", ["narrow", "good", "spill", "three_pages"])
def test_fixtures_are_printed_by_the_real_engine(pdfs, name):
    info = subprocess.run(["pdfinfo", str(pdfs[name])], capture_output=True, text=True).stdout
    assert "Qt 5." in info and "wkhtmltopdf" in info, info


@needs_engine
def test_legacy_command_is_red_narrow_text(pdfs):
    report = check.analyze(pdfs["narrow"])
    assert not report["ok"]
    assert "narrow_text" in report["reasons"]
    assert all(p["width_ratio"] < 0.55 for p in report["per_page"] if p["width_ratio"] is not None)


@needs_engine
def test_fixed_command_is_green_and_full_width(pdfs):
    report = check.analyze(pdfs["good"])
    assert report["ok"], report
    assert report["reasons"] == []
    assert report["per_page"][0]["width_ratio"] >= 0.9
    assert report["fonts"] and all(f["embedded"] for f in report["fonts"])


@needs_engine
def test_a_spill_onto_page_two_is_red_near_empty_page(pdfs):
    report = check.analyze(pdfs["spill"])
    assert report["reasons"] == ["near_empty_page"], report
    assert report["pages"] == 2


@needs_engine
def test_three_pages_is_red_too_many_pages(pdfs):
    report = check.analyze(pdfs["three_pages"])
    assert report["reasons"] == ["too_many_pages"], report


@needs_poppler
def test_fonts_not_embedded_is_red(tmp_path):
    report = check.analyze(_base14_pdf(tmp_path / "base14.pdf"))
    assert report["reasons"] == ["fonts_not_embedded"], report


@needs_poppler
def test_a_page_without_measurable_text_is_red(tmp_path):
    report = check.analyze(_base14_pdf(tmp_path / "short.pdf", lines=3))
    assert "no_text" in report["reasons"] and "near_empty_page" in report["reasons"]


@needs_engine
def test_margins_define_the_usable_width(pdfs):
    # The same page, judged against a narrower usable width, must look wider.
    wide = check.analyze(pdfs["good"], margin_left_mm=30, margin_right_mm=30)
    assert wide["per_page"][0]["width_ratio"] > check.analyze(pdfs["good"])["per_page"][0]["width_ratio"]


# ── CLI contract ─────────────────────────────────────────────────────────────


@needs_engine
def test_cli_exit_codes_and_json(pdfs, tmp_path):
    good = _cli(str(pdfs["good"]), "--json")
    assert good.returncode == 0, good.stderr
    assert json.loads(good.stdout)["ok"] is True
    bad = _cli(str(pdfs["narrow"]), "--json")
    assert bad.returncode == 1
    assert "narrow_text" in json.loads(bad.stdout)["reasons"]
    human = _cli(str(pdfs["narrow"]))
    assert human.returncode == 1 and "LAYOUT BAD" in human.stdout


@needs_engine
def test_cli_preview_writes_page_one_png(pdfs, tmp_path):
    png = tmp_path / "preview" / "page1.png"
    done = _cli(str(pdfs["narrow"]), "--json", "--preview", str(png))
    assert done.returncode == 1
    assert json.loads(done.stdout)["preview"] == str(png)
    assert png.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"


def test_unreadable_pdf_is_never_a_pass(tmp_path):
    done = _cli(str(tmp_path / "missing.pdf"), "--json")
    assert done.returncode == 2
    assert json.loads(done.stdout)["ok"] is False


def test_missing_poppler_is_never_a_pass(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "python3").symlink_to(sys.executable)
    done = _cli(str(_base14_pdf(tmp_path / "page.pdf")), env={"PATH": str(bin_dir)})
    assert done.returncode == 2
    assert "poppler" in done.stderr


# ── 2. one render command everywhere ────────────────────────────────────────

RENDER_FLAGS = (
    "--pdf-engine=wkhtmltopdf",
    "-c /app/shared/skills/pdf_layout_base.css --self-contained",
    "-V papersize=A4",
    "-V margin-top=11mm",
    "-V margin-bottom=11mm",
    "-V margin-left=15mm",
    "-V margin-right=15mm",
    '--metadata pagetitle="CV $CANDIDATO"',
)


@pytest.mark.parametrize("lang", LANGS)
def test_cv_structure_render_command(lang):
    text = _localized(ROOT / "agents" / "_skills" / "cv-structure", "SKILL", lang).read_text(encoding="utf-8")
    start = text.index('pandoc "$SRC_MD" -o "$TMP_PDF"')
    command = " ".join(text[start:text.index("\n\n", start)].replace("\\\n", " ").split())
    for flag in RENDER_FLAGS:
        assert flag in command, f"{lang}: render command lacks {flag}"
    assert '--metadata title="CV' not in text, f"{lang}: title prints a visible 'CV …' header"
    assert "--pdf-engine=weasyprint" not in text, f"{lang}: weasyprint fails the Producer gate"
    assert 'python3 /app/shared/skills/pdf_layout_check.py "$TMP_PDF"' in text
    assert "exit 5" in text and "`5`" in text
    # The gate sits after the render and before the atomic move.
    assert start < text.index("pdf_layout_check.py \"$TMP_PDF\"") < text.index('mv "$TMP_PDF" "$FINAL_PDF"')


def test_cover_letter_uses_the_same_layout():
    text = (ROOT / "agents" / "_skills" / "cv-structure" / "SKILL.md").read_text(encoding="utf-8")
    start = text.index('pandoc "$COVER_MD"')
    command = " ".join(text[start:text.index("```", start)].replace("\\\n", " ").split())
    for flag in RENDER_FLAGS[:-1]:
        assert flag in command
    assert '--metadata pagetitle="Cover Letter $CANDIDATO"' in command


@pytest.mark.parametrize("lang", LANGS)
def test_scrittore_prompt_cites_the_command_and_the_gate(lang):
    text = _localized(ROOT / "agents" / "scrittore", "scrittore", lang).read_text(encoding="utf-8")
    rule = next(line for line in text.splitlines() if line.startswith("**S-05"))
    assert "-c /app/shared/skills/pdf_layout_base.css --self-contained" in rule
    assert "pdf_layout_check.py" in rule and "--preview" in rule
    assert '--metadata title="' not in rule


def test_gate_margins_match_the_render_command():
    assert check.DEFAULT_MARGIN_LR_MM == 15.0
    assert check.DEFAULT_MARGIN_TB_MM == 11.0


def _pandoc_argv(source: str) -> list[str]:
    """The quoted tokens of the pandoc argv in a Python source."""
    argv = re.search(r'\[\s*"pandoc",(.*?)\]', source, re.S)
    assert argv, "no pandoc argv list found"
    return re.findall(r'"([^"]+)"', argv.group(1))


ARGV_TOKENS = (
    "--pdf-engine=wkhtmltopdf", "-c", "--self-contained", "papersize=A4",
    "margin-top=11mm", "margin-bottom=11mm", "margin-left=15mm", "margin-right=15mm",
)


def test_generator_and_build_gate_render_like_the_skill():
    generate = (FIXTURES / "generate.py").read_text(encoding="utf-8")
    health = (SKILLS / "tool_health.py").read_text(encoding="utf-8")
    sources = {
        "generate.py": generate[generate.index("def render_fixed"):],
        "tool_health.py": health[health.index("def check_cv_pdf_render"):],
    }
    for name, source in sources.items():
        argv = _pandoc_argv(source)
        missing = [t for t in ARGV_TOKENS if t not in argv]
        assert not missing, f"{name}: pandoc argv lacks {missing}"
        assert any(t.startswith("pagetitle=") for t in argv), name


def test_base_css_resets_the_pandoc_column():
    css = CSS.read_text(encoding="utf-8")
    body = css[css.index("html, body {"):css.index("}", css.index("html, body {"))]
    assert re.search(r"max-width:\s*none", body)
    assert re.search(r"margin:\s*0", body)
    assert re.search(r"padding:\s*0", body)


# ── 3. toolchain in the image, loud when missing ────────────────────────────


def test_image_bakes_the_cv_toolchain_and_gates_the_build():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    apt = dockerfile[dockerfile.index("RUN apt-get update"):dockerfile.index("rm -rf /var/lib/apt/lists/*")]
    packages = {w for line in apt.splitlines() if not line.strip().startswith("#") for w in line.split()}
    assert {"pandoc", "wkhtmltopdf", "poppler-utils"} <= packages
    gate = dockerfile.index("tool_health.py --only cv_pdf_render")
    assert dockerfile.index("COPY . .") < gate
    assert "exit 1" in dockerfile[gate:dockerfile.index("\n\n", gate)]


def test_cv_pdf_render_is_broken_without_the_binaries(monkeypatch):
    health = _load("tool_health_under_test", SKILLS / "tool_health.py")
    assert health.CHECKS["cv_pdf_render"] is health.check_cv_pdf_render
    monkeypatch.setattr(health.shutil, "which", lambda name: None if name == "wkhtmltopdf" else "/usr/bin/" + name)
    status, evidence = health.check_cv_pdf_render()
    assert status == "BROKEN" and "wkhtmltopdf" in evidence


def test_ci_installs_the_toolchain_for_this_suite():
    workflow = (ROOT / ".github" / "workflows" / "test.yml").read_text(encoding="utf-8")
    job = workflow[workflow.index("  pytest:"):workflow.index("- name: Run pytest")]
    installs = [line.split() for line in job.splitlines() if "apt-get install" in line and not line.strip().startswith("#")]
    assert any({"pandoc", "wkhtmltopdf", "poppler-utils"} <= set(words) for words in installs), installs


# ── 4. the CLOSER names the stop ────────────────────────────────────────────


@pytest.mark.parametrize("lang", LANGS)
def test_apply_flow_skill_names_the_layout_stop(lang):
    text = _localized(ROOT / "agents" / "_skills" / "apply-flow", "SKILL", lang).read_text(encoding="utf-8")
    row = next(line for line in text.splitlines() if line.startswith("| `cv_pdf_layout_bad`"))
    assert "pdf_layout_check.py" in row
    # CheckError is a separate stop: nothing is sent, but the remedy is the box.
    assert any(line.startswith("| `cv_pdf_check_unavailable`") for line in text.splitlines())
