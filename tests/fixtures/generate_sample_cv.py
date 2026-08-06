#!/usr/bin/env python3
"""Generate the privacy-safe PDF used by onboarding and setup-guide E2E runs.

The writer intentionally uses only Python's standard library. CI can therefore
rebuild the fixture byte-for-byte without installing a document toolchain.
"""

from __future__ import annotations

import argparse
from pathlib import Path


OUTPUT = Path(__file__).with_name("sample-cv.pdf")
PAGE_WIDTH = 595.276
PAGE_HEIGHT = 841.89

NAVY = (0.078, 0.129, 0.239)
TEAL = (0.059, 0.545, 0.553)
INK = (0.125, 0.153, 0.208)
MUTED = (0.373, 0.420, 0.478)
PALE = (0.910, 0.949, 0.949)
RULE = (0.847, 0.871, 0.910)
WHITE = (1.0, 1.0, 1.0)


def _number(value: float) -> str:
    return f"{value:.3f}".rstrip("0").rstrip(".")


def _color(rgb: tuple[float, float, float]) -> str:
    return " ".join(_number(channel) for channel in rgb)


def _pdf_text(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


class Page:
    def __init__(self) -> None:
        self.ops: list[str] = []

    def rectangle(
        self,
        x: float,
        y: float,
        width: float,
        height: float,
        fill: tuple[float, float, float],
    ) -> None:
        self.ops.append(
            f"q {_color(fill)} rg {_number(x)} {_number(y)} "
            f"{_number(width)} {_number(height)} re f Q"
        )

    def line(
        self,
        x1: float,
        y1: float,
        x2: float,
        y2: float,
        color: tuple[float, float, float] = RULE,
        width: float = 0.7,
    ) -> None:
        self.ops.append(
            f"q {_color(color)} RG {_number(width)} w {_number(x1)} {_number(y1)} m "
            f"{_number(x2)} {_number(y2)} l S Q"
        )

    def text(
        self,
        value: str,
        x: float,
        y: float,
        *,
        font: str = "F1",
        size: float = 9.5,
        color: tuple[float, float, float] = INK,
    ) -> None:
        self.ops.append(
            f"BT /{font} {_number(size)} Tf {_color(color)} rg "
            f"1 0 0 1 {_number(x)} {_number(y)} Tm ({_pdf_text(value)}) Tj ET"
        )

    def bullet(self, text: str, y: float) -> None:
        self.rectangle(52, y + 2, 3.2, 3.2, TEAL)
        self.text(text, 63, y, size=9.2)

    def section(self, title: str, y: float) -> None:
        self.text(title.upper(), 48, y, font="F2", size=10.5, color=TEAL)
        self.line(48, y - 5, 547, y - 5)

    def role(self, title: str, organisation: str, dates: str, y: float) -> None:
        self.text(title, 48, y, font="F2", size=10.2, color=NAVY)
        self.text(dates, 487, y, size=9, color=MUTED)
        self.text(organisation, 48, y - 14, size=9, color=MUTED)

    def stream(self) -> bytes:
        return ("\n".join(self.ops) + "\n").encode("ascii")


def _page() -> Page:
    page = Page()
    page.rectangle(0, PAGE_HEIGHT - 151, PAGE_WIDTH, 151, NAVY)
    page.rectangle(0, PAGE_HEIGHT - 151, 13, 151, TEAL)

    page.text("AVERY EXAMPLE", 48, PAGE_HEIGHT - 61, font="F2", size=27, color=WHITE)
    page.text("Software Engineer", 49, PAGE_HEIGHT - 84, size=14, color=WHITE)
    page.rectangle(48, PAGE_HEIGHT - 116, 208, 18, PALE)
    page.text(
        "SYNTHETIC SAMPLE CV - PRODUCT TESTING ONLY",
        57,
        PAGE_HEIGHT - 110,
        font="F2",
        size=7.4,
        color=NAVY,
    )
    page.text("avery.example@example.com", 420, PAGE_HEIGHT - 62, size=9.2, color=WHITE)
    page.text(
        "Remote - Example Region (fictional)",
        385,
        PAGE_HEIGHT - 79,
        size=9.2,
        color=WHITE,
    )
    page.text("English / Italian", 471, PAGE_HEIGHT - 96, size=9.2, color=WHITE)

    page.section("Profile", 662)
    page.text(
        "Software engineer with four years of experience building reliable Python services, automation, and",
        48,
        638,
        size=9.5,
    )
    page.text(
        "containerized workflows. Turns ambiguous problems into maintainable systems, practical documentation,",
        48,
        625,
        size=9.5,
    )
    page.text("and clear test coverage.", 48, 612, size=9.5)

    page.section("Core skills", 588)
    page.text("Languages", 48, 564, font="F2", size=9.2, color=NAVY)
    page.text("Python, TypeScript, SQL, Bash", 117, 564, size=9.2)
    page.text("Platforms", 48, 549, font="F2", size=9.2, color=NAVY)
    page.text("Linux, Docker, GitHub Actions, REST APIs", 117, 549, size=9.2)
    page.text("Quality", 48, 534, font="F2", size=9.2, color=NAVY)
    page.text("Automated testing, integration testing, code review, observability", 117, 534, size=9.2)

    page.section("Experience", 505)
    page.role(
        "Software Engineer",
        "Example Works Studio (fictional organisation)",
        "2023 - 2026",
        479,
    )
    page.bullet(
        "Built and maintained Python services that process structured data and expose stable APIs.",
        441,
    )
    page.bullet(
        "Containerized development workflows and reduced environment setup from hours to minutes.",
        425,
    )
    page.bullet(
        "Added integration tests and operational dashboards for faster, safer releases.",
        409,
    )

    page.role(
        "QA Automation Developer",
        "Sample Systems Lab (fictional organisation)",
        "2021 - 2023",
        373,
    )
    page.bullet(
        "Designed browser and API test suites for multi-platform product workflows.",
        335,
    )
    page.bullet(
        "Worked with engineers to turn production defects into focused regression tests.",
        319,
    )

    page.section("Education", 283)
    page.text("BSc in Software Engineering", 48, 257, font="F2", size=9.8, color=NAVY)
    page.text(
        "Example Institute of Technology (fictional institution), 2021",
        48,
        243,
        size=9,
        color=MUTED,
    )

    page.line(48, 44, 547, 44)
    page.text(
        "Synthetic fixture: no real person, company, school, address, or contact details.",
        48,
        30,
        font="F3",
        size=7.5,
        color=MUTED,
    )
    page.text(
        "example.com is a reserved example domain",
        391,
        30,
        size=7.5,
        color=MUTED,
    )
    return page


def _object(number: int, payload: bytes) -> bytes:
    return f"{number} 0 obj\n".encode("ascii") + payload + b"\nendobj\n"


def build(output: Path = OUTPUT) -> None:
    stream = _page().stream()
    objects = [
        _object(1, b"<< /Type /Catalog /Pages 2 0 R >>"),
        _object(2, b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
        _object(
            3,
            (
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] "
                "/Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> "
                "/Contents 4 0 R >>"
            ).encode("ascii"),
        ),
        _object(4, f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"endstream"),
        _object(5, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
        _object(6, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"),
        _object(7, b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>"),
        _object(
            8,
            (
                "<< /Title (Synthetic Sample CV) "
                "/Author (Job Hunter Team synthetic fixture) "
                "/Subject (Privacy-safe onboarding and setup-guide test document) "
                "/Creator (Job Hunter Team fixture generator) >>"
            ).encode("ascii"),
        ),
    ]

    pdf = bytearray(b"%PDF-1.7\n%\x93\x8c\x8b\x9e\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)
    xref = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    identifier = "83FCBD2722D443F36BAC3F8719789A9D"
    pdf.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R /Info 8 0 R "
            f"/ID [<{identifier}><{identifier}>] >>\n"
            f"startxref\n{xref}\n%%EOF\n"
        ).encode("ascii")
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(pdf)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    build(args.output)


if __name__ == "__main__":
    main()
