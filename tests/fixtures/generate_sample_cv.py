#!/usr/bin/env python3
"""Generate the privacy-safe PDF used by onboarding and setup-guide E2E runs."""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas


OUTPUT = Path(__file__).with_name("sample-cv.pdf")

NAVY = HexColor("#14213D")
TEAL = HexColor("#0F8B8D")
INK = HexColor("#202735")
MUTED = HexColor("#5F6B7A")
PALE = HexColor("#E8F2F2")
RULE = HexColor("#D8DEE8")
WHITE = HexColor("#FFFFFF")


def _wrapped_lines(text: str, font: str, size: float, width: float) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and stringWidth(candidate, font, size) > width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def _paragraph(
    canvas: Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    *,
    font: str = "Helvetica",
    size: float = 9.5,
    leading: float = 13.0,
    color=INK,
) -> float:
    canvas.setFillColor(color)
    canvas.setFont(font, size)
    for line in _wrapped_lines(text, font, size, width):
        canvas.drawString(x, y, line)
        y -= leading
    return y


def _section(canvas: Canvas, title: str, y: float) -> float:
    canvas.setFillColor(TEAL)
    canvas.setFont("Helvetica-Bold", 10.5)
    canvas.drawString(48, y, title.upper())
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.7)
    canvas.line(48, y - 5, 547, y - 5)
    return y - 22


def _role(canvas: Canvas, role: str, organisation: str, dates: str, y: float) -> float:
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 10.2)
    canvas.drawString(48, y, role)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 9)
    canvas.drawString(48, y - 14, organisation)
    canvas.drawRightString(547, y, dates)
    return y - 31


def _bullet(canvas: Canvas, text: str, y: float) -> float:
    canvas.setFillColor(TEAL)
    canvas.circle(53, y + 3, 1.7, stroke=0, fill=1)
    return _paragraph(canvas, text, 63, y, 484, size=9.2, leading=12.2)


def build(output: Path = OUTPUT) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas = Canvas(
        str(output),
        pagesize=A4,
        pageCompression=1,
        invariant=1,
        pdfVersion=(1, 7),
    )
    canvas.setTitle("Synthetic Sample CV")
    canvas.setAuthor("Job Hunter Team synthetic fixture")
    canvas.setSubject("Privacy-safe onboarding and setup-guide test document")
    canvas.setCreator("Job Hunter Team fixture generator")
    canvas.setKeywords("synthetic, sample, cv, test fixture")

    page_width, page_height = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, page_height - 151, page_width, 151, stroke=0, fill=1)
    canvas.setFillColor(TEAL)
    canvas.rect(0, page_height - 151, 13, 151, stroke=0, fill=1)

    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica-Bold", 27)
    canvas.drawString(48, page_height - 61, "AVERY EXAMPLE")
    canvas.setFont("Helvetica", 14)
    canvas.drawString(49, page_height - 84, "Software Engineer")

    canvas.setFillColor(PALE)
    canvas.roundRect(48, page_height - 116, 194, 18, 4, stroke=0, fill=1)
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 7.4)
    canvas.drawString(57, page_height - 110, "SYNTHETIC SAMPLE CV - PRODUCT TESTING ONLY")

    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica", 9.2)
    canvas.drawRightString(547, page_height - 62, "avery.example@example.com")
    canvas.drawRightString(547, page_height - 79, "Remote - Example Region (fictional)")
    canvas.drawRightString(547, page_height - 96, "English / Italian")

    y = page_height - 180
    y = _section(canvas, "Profile", y)
    y = _paragraph(
        canvas,
        "Software engineer with four years of experience building reliable Python services, "
        "automation, and containerized workflows. Turns ambiguous problems into maintainable "
        "systems, practical documentation, and clear test coverage.",
        48,
        y,
        499,
    ) - 12

    y = _section(canvas, "Core skills", y)
    skills = [
        ("Languages", "Python, TypeScript, SQL, Bash"),
        ("Platforms", "Linux, Docker, GitHub Actions, REST APIs"),
        ("Quality", "Automated testing, integration testing, code review, observability"),
    ]
    for label, value in skills:
        canvas.setFillColor(NAVY)
        canvas.setFont("Helvetica-Bold", 9.2)
        canvas.drawString(48, y, label)
        canvas.setFillColor(INK)
        canvas.setFont("Helvetica", 9.2)
        canvas.drawString(117, y, value)
        y -= 15
    y -= 7

    y = _section(canvas, "Experience", y)
    y = _role(
        canvas,
        "Software Engineer",
        "Example Works Studio (fictional organisation)",
        "2023 - 2026",
        y,
    )
    y = _bullet(
        canvas,
        "Built and maintained Python services that process structured data and expose stable APIs.",
        y,
    ) - 3
    y = _bullet(
        canvas,
        "Containerized development workflows and reduced environment setup from hours to minutes.",
        y,
    ) - 3
    y = _bullet(
        canvas,
        "Added integration tests and operational dashboards for faster, safer releases.",
        y,
    ) - 13

    y = _role(
        canvas,
        "QA Automation Developer",
        "Sample Systems Lab (fictional organisation)",
        "2021 - 2023",
        y,
    )
    y = _bullet(
        canvas,
        "Designed browser and API test suites for multi-platform product workflows.",
        y,
    ) - 3
    y = _bullet(
        canvas,
        "Worked with engineers to turn production defects into focused regression tests.",
        y,
    ) - 13

    y = _section(canvas, "Education", y)
    canvas.setFillColor(NAVY)
    canvas.setFont("Helvetica-Bold", 9.8)
    canvas.drawString(48, y, "BSc in Software Engineering")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 9)
    canvas.drawString(48, y - 14, "Example Institute of Technology (fictional institution), 2021")

    footer_y = 30
    canvas.setStrokeColor(RULE)
    canvas.line(48, footer_y + 14, 547, footer_y + 14)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica-Oblique", 7.5)
    canvas.drawString(
        48,
        footer_y,
        "Synthetic fixture: no real person, company, school, address, or contact details.",
    )
    canvas.drawRightString(547, footer_y, "example.com is a reserved example domain")

    canvas.showPage()
    canvas.save()


if __name__ == "__main__":
    build()
