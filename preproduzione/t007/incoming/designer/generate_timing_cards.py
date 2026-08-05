#!/usr/bin/env python3
"""Generate editable T-007 timing cards as 1920x1080 SVG and PNG files."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFont


W, H = 1920, 1080
ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
FONT_DIR = ROOT / "game" / "assets" / "fonts"

COLORS = {
    "void": "#060608",
    "deep": "#0C0C10",
    "card": "#16161D",
    "border": "#2E2E3D",
    "white": "#F0F0FA",
    "base": "#B8B8D0",
    "muted": "#7A7A96",
    "green": "#00E87A",
}
FONTS = {
    "Regular": FONT_DIR / "JetBrainsMono-Regular.ttf",
    "Medium": FONT_DIR / "JetBrainsMono-Medium.ttf",
    "Bold": FONT_DIR / "JetBrainsMono-Bold.ttf",
    "ExtraBold": FONT_DIR / "JetBrainsMono-ExtraBold.ttf",
}
WEIGHTS = {"Regular": 400, "Medium": 500, "Bold": 700, "ExtraBold": 800}


@dataclass(frozen=True)
class Line:
    text: str
    y: int
    size: int
    weight: str = "Bold"
    color: str = "white"
    editable: bool = False


@dataclass(frozen=True)
class Card:
    name: str
    lines: tuple[Line, ...]
    historical: bool = False


CARDS = (
    Card(
        "TC-00-opening-context",
        (
            Line("32:58 REAL TIME", 328, 142, "ExtraBold"),
            Line("FROM OPENING THE ARTIFACT", 448, 54),
            Line("TO COMPLETED ONBOARDING", 516, 54),
            Line("PROVIDER AUTHORIZATION WAS STILL BLOCKED", 674, 50),
            Line("AFTER 54:40 REAL TIME", 750, 68, "ExtraBold"),
            Line("HARDWARE AND NETWORK AFFECT TIMING", 930, 40, "Medium", "base"),
        ),
        historical=True,
    ),
    Card(
        "TS-00-editable-speed-template",
        (
            Line("WAIT SHOWN AT", 404, 76, "ExtraBold"),
            Line("{{SPEED}}×", 590, 154, "ExtraBold", "green", editable=True),
        ),
    ),
    Card(
        "TC-04-total-real-setup-time",
        (
            Line("TOTAL REAL SETUP TIME", 246, 72, "ExtraBold"),
            Line("{{SITE_TO_T5_REAL}}", 422, 132, "ExtraBold", "green", editable=True),
            Line("FROM THE WEBSITE TO THE FIRST REPLY", 562, 52),
            Line("THINKPAD LINUX · {{DATE}}", 758, 48, "Bold", "white", editable=True),
            Line("HARDWARE AND NETWORK AFFECT TIMING", 858, 40, "Medium", "base"),
        ),
    ),
    Card(
        "TC-01-first-complete-window",
        (
            Line("01:49 REAL TIME", 392, 154, "ExtraBold"),
            Line("FROM OPENING THE ARTIFACT", 540, 54),
            Line("TO THE FIRST COMPLETE WINDOW", 612, 54),
            Line("WAITS CONDENSED", 824, 46, "Medium", "base"),
        ),
        historical=True,
    ),
    Card(
        "TC-02-onboarding-complete",
        (
            Line("32:58 REAL TIME", 392, 154, "ExtraBold"),
            Line("FROM OPENING THE ARTIFACT", 540, 54),
            Line("TO COMPLETED ONBOARDING", 612, 54),
            Line("REPEATED TOUR STEPS CONDENSED", 824, 46, "Medium", "base"),
        ),
        historical=True,
    ),
    Card(
        "TC-03-provider-boundary",
        (
            Line("PROVIDER AUTHORIZATION WAS STILL BLOCKED", 372, 60, "ExtraBold"),
            Line("AFTER 54:40 REAL TIME", 486, 86, "ExtraBold"),
            Line("THIS WALKTHROUGH RECORDS A NEW AUTHORIZATION", 690, 48),
            Line("WITH NO CREDENTIALS RECORDED", 758, 48),
        ),
        historical=True,
    ),
    Card("TS-01-download", (Line("DOWNLOAD", 330, 92, "ExtraBold"), Line("{{DOWNLOAD_REAL}} REAL TIME", 522, 84, "ExtraBold", "green", True), Line("WAIT SHOWN AT {{DOWNLOAD_SPEED}}×", 700, 56, editable=True))),
    Card("TS-02-extraction", (Line("EXTRACTION", 330, 92, "ExtraBold"), Line("{{EXTRACTION_REAL}} REAL TIME", 522, 84, "ExtraBold", "green", True), Line("WAIT SHOWN AT {{EXTRACTION_SPEED}}×", 700, 56, editable=True))),
    Card("TS-03-first-window", (Line("FIRST WINDOW", 322, 92, "ExtraBold"), Line("{{T0_T1_REAL}} FROM ARTIFACT OPEN TO FIRST COMPLETE WINDOW", 536, 54, "Bold", "green", True), Line("WAITS CONDENSED", 718, 52, "Medium", "base"))),
    Card("TS-04-office-load", (Line("OFFICE LOAD", 330, 92, "ExtraBold"), Line("{{OFFICE_LOAD_REAL}} REAL TIME", 522, 84, "ExtraBold", "green", True), Line("WAIT SHOWN AT {{OFFICE_LOAD_SPEED}}×", 700, 56, editable=True))),
    Card("TS-05-guided-preview", (Line("GUIDED PREVIEW", 330, 92, "ExtraBold"), Line("{{TOUR_REAL}} REAL TIME", 522, 84, "ExtraBold", "green", True), Line("REPEATED DEPARTMENT BEATS CONDENSED", 700, 52, "Medium", "base"))),
    Card("TS-06-runtime-download", (Line("RUNTIME DOWNLOAD", 330, 92, "ExtraBold"), Line("{{IMAGE_PULL_REAL}} REAL TIME", 522, 84, "ExtraBold", "green", True), Line("WAIT SHOWN AT {{IMAGE_PULL_SPEED}}×", 700, 56, editable=True))),
    Card("TS-07-runtime-ready", (Line("RUNTIME READY", 330, 92, "ExtraBold"), Line("{{T2_T3_REAL}} FROM ONBOARDING COMPLETE", 522, 64, "ExtraBold", "green", True), Line("WAITS CONDENSED", 700, 52, "Medium", "base"))),
    Card("TS-08-provider-authorization", (Line("PROVIDER AUTHORIZATION", 272, 82, "ExtraBold"), Line("{{PROVIDER_AUTH_REAL}} REAL TIME", 450, 76, "ExtraBold", "green", True), Line("WAIT SHOWN AT {{PROVIDER_WAIT_SPEED}}×", 610, 54, editable=True), Line("NO CREDENTIALS RECORDED", 780, 48, "Medium", "base"))),
    Card("TS-09-profile", (Line("PROFILE COMPLETED IN {{PROFILE_REAL}} REAL TIME", 440, 68, "ExtraBold", "green", True), Line("REPETITIVE ENTRY CONDENSED", 642, 52, "Medium", "base"))),
    Card("TS-10-team-startup", (Line("TEAM STARTUP", 330, 92, "ExtraBold"), Line("{{TEAM_BOOTSTRAP_REAL}} REAL TIME", 522, 76, "ExtraBold", "green", True), Line("WAIT SHOWN AT {{TEAM_BOOTSTRAP_SPEED}}×", 700, 54, editable=True))),
    Card("TS-11-first-reply", (Line("FIRST REPLY ARRIVED AFTER {{REPLY_REAL}} REAL TIME", 450, 66, "ExtraBold", "green", True), Line("WAIT SHOWN AT {{REPLY_WAIT_SPEED}}×", 650, 56, editable=True))),
    Card("TS-12-five-stage-pipeline", (Line("FIVE REAL STAGES", 314, 88, "ExtraBold"), Line("{{PIPELINE_REAL}} ELAPSED", 500, 86, "ExtraBold", "green", True), Line("WAITS SHOWN AT {{PIPELINE_WAIT_SPEED}}×", 690, 56, editable=True))),
)

PREVIEW_NAMES = {"TC-00-opening-context", "TS-00-editable-speed-template", "TC-04-total-real-setup-time"}


def rgb(value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    value = value.removeprefix("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4)) + (alpha,)


def fitted_size(text: str, size: int, weight: str, max_width: int = 1560) -> int:
    while size > 36:
        font = ImageFont.truetype(str(FONTS[weight]), size)
        if font.getlength(text) <= max_width:
            return size
        size -= 2
    return size


def render(card: Card) -> None:
    image = Image.new("RGBA", (W, H), rgb(COLORS["void"]))
    draw = ImageDraw.Draw(image)
    for x in range(0, W + 1, 80):
        draw.line((x, 0, x, H), fill=rgb(COLORS["white"], 6), width=1)
    for y in range(0, H + 1, 80):
        draw.line((0, y, W, y), fill=rgb(COLORS["white"], 6), width=1)
    draw.rounded_rectangle((128, 94, 1792, 986), radius=28, fill=rgb(COLORS["deep"], 246), outline=rgb(COLORS["border"]), width=2)
    draw.rounded_rectangle((128, 94, 140, 986), radius=6, fill=rgb(COLORS["green"]))

    svg = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        "  <title>T-007 timing card</title>",
        "  <desc>Editable Job Hunter Team timing disclosure graphic.</desc>",
        "  <defs>",
        '    <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">',
        f'      <path d="M 80 0 L 0 0 0 80" fill="none" stroke="{COLORS["white"]}" stroke-opacity="0.024" stroke-width="1"/>',
        "    </pattern>",
        "  </defs>",
        f'  <rect width="{W}" height="{H}" fill="{COLORS["void"]}"/>',
        f'  <rect width="{W}" height="{H}" fill="url(#grid)"/>',
        f'  <rect x="128" y="94" width="1664" height="892" rx="28" fill="{COLORS["deep"]}" fill-opacity="0.965" stroke="{COLORS["border"]}" stroke-width="2"/>',
        f'  <rect x="128" y="94" width="12" height="892" rx="6" fill="{COLORS["green"]}"/>',
    ]

    if card.historical:
        draw.rounded_rectangle((566, 124, 1354, 214), radius=14, fill=rgb(COLORS["card"]), outline=rgb(COLORS["green"]), width=2)
        label_font = ImageFont.truetype(str(FONTS["ExtraBold"]), 48)
        draw.text((960, 169), "OBSERVED LINUX REHEARSAL", font=label_font, fill=rgb(COLORS["white"]), anchor="mm")
        svg.extend(
            (
                f'  <rect x="566" y="124" width="788" height="90" rx="14" fill="{COLORS["card"]}" stroke="{COLORS["green"]}" stroke-width="2"/>',
                f'  <text x="960" y="169" font-family="JetBrains Mono, monospace" font-size="48" font-weight="800" text-anchor="middle" dominant-baseline="middle" fill="{COLORS["white"]}">OBSERVED LINUX REHEARSAL</text>',
            )
        )

    for index, line in enumerate(card.lines):
        size = fitted_size(line.text, line.size, line.weight)
        color = COLORS[line.color]
        font = ImageFont.truetype(str(FONTS[line.weight]), size)
        draw.text((960, line.y), line.text, font=font, fill=rgb(color), anchor="mm")
        editable = ' data-editable="true"' if line.editable else ""
        svg.append(
            f'  <text id="line-{index + 1}"{editable} x="960" y="{line.y}" '
            f'font-family="JetBrains Mono, monospace" font-size="{size}" font-weight="{WEIGHTS[line.weight]}" '
            f'text-anchor="middle" dominant-baseline="middle" fill="{color}">{escape(line.text)}</text>'
        )

    svg.append("</svg>")
    (OUT / f"{card.name}.svg").write_text("\n".join(svg) + "\n", encoding="utf-8")
    image.save(OUT / f"{card.name}.png", optimize=True)


def write_manifest(rendered: set[str]) -> None:
    tokens = sorted({part for card in CARDS for line in card.lines for part in line.text.split() if "{{" in part})
    manifest = {
        "canvas": {"width": W, "height": H, "format": "16:9 full-frame timing card"},
        "font": {"family": "JetBrains Mono", "files": {key: str(value.relative_to(ROOT)) for key, value in FONTS.items()}},
        "colors": COLORS,
        "copy_source": "HQ-TUTORIAL preproduzione/t007/T-007-TIMING-CARDS.md",
        "timeline_change_requested": False,
        "editable_tokens": tokens,
        "editing": "Edit text nodes marked data-editable=true in the SVG. Populate only from the promoted T-007 sidecar/raw.",
        "historical_rule": "Any historic measurement card keeps OBSERVED LINUX REHEARSAL prominent. Never use 54:40 as SITE_TO_T5_REAL.",
        "cards": [{"name": card.name, "status": "rendered" if card.name in rendered else "pending"} for card in CARDS],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview", action="store_true", help="render TC-00, generic speed field, and TC-04 first")
    args = parser.parse_args()
    selected = [card for card in CARDS if not args.preview or card.name in PREVIEW_NAMES]
    for card in selected:
        render(card)
    write_manifest({card.name for card in selected})
    print(f"rendered {len(selected)} timing cards in {OUT}")


if __name__ == "__main__":
    main()
