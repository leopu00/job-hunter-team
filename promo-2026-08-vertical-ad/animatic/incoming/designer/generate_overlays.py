#!/usr/bin/env python3
"""Generate the JHT 9:16 animatic typography overlays as SVG and PNG."""

from __future__ import annotations

import json
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image, ImageDraw, ImageFont


W, H = 1080, 1920
ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
FONT_DIR = ROOT / "game" / "assets" / "fonts"

COLORS = {
    "void": "#060608",
    "white": "#F0F0FA",
    "base": "#B8B8D0",
    "muted": "#7A7A96",
    "border": "#2E2E3D",
    "green": "#00E87A",
}

SAFE = (108, 220, 972, 1580)
FONT_FILES = {
    "Regular": FONT_DIR / "JetBrainsMono-Regular.ttf",
    "Medium": FONT_DIR / "JetBrainsMono-Medium.ttf",
    "Bold": FONT_DIR / "JetBrainsMono-Bold.ttf",
    "ExtraBold": FONT_DIR / "JetBrainsMono-ExtraBold.ttf",
}


def rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    value = hex_color.removeprefix("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4)) + (alpha,)


def svg_header() -> list[str]:
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
        "  <title>Job Hunter Team vertical animatic overlay</title>",
        "  <desc>Transparent 1080 by 1920 overlay; JetBrains Mono typography.</desc>",
        "  <style>text { font-family: 'JetBrains Mono', monospace; }</style>",
    ]


def add_rect(
    image: Image.Image,
    svg: list[str],
    box: tuple[int, int, int, int],
    fill: str,
    *,
    alpha: int = 255,
    radius: int = 0,
) -> None:
    ImageDraw.Draw(image).rounded_rectangle(box, radius=radius, fill=rgba(fill, alpha))
    x0, y0, x1, y1 = box
    svg.append(
        f'  <rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" '
        f'rx="{radius}" fill="{fill}" fill-opacity="{alpha / 255:.3f}"/>'
    )


def add_text(
    image: Image.Image,
    svg: list[str],
    text: str,
    xy: tuple[int, int],
    size: int,
    weight: str,
    fill: str,
    *,
    anchor: str = "mm",
    alpha: int = 255,
) -> None:
    font = ImageFont.truetype(str(FONT_FILES[weight]), size)
    ImageDraw.Draw(image).text(xy, text, font=font, fill=rgba(fill, alpha), anchor=anchor)
    svg_anchor = {"mm": "middle", "lm": "start", "rm": "end"}[anchor]
    svg_weight = {"Regular": 400, "Medium": 500, "Bold": 700, "ExtraBold": 800}[weight]
    svg.append(
        f'  <text x="{xy[0]}" y="{xy[1]}" font-size="{size}" '
        f'font-weight="{svg_weight}" text-anchor="{svg_anchor}" '
        f'dominant-baseline="middle" fill="{fill}" fill-opacity="{alpha / 255:.3f}">'
        f"{escape(text)}</text>"
    )


def add_watermark(image: Image.Image, svg: list[str]) -> None:
    add_rect(image, svg, (108, 220, 972, 382), COLORS["void"], alpha=184, radius=18)
    add_rect(image, svg, (108, 220, 116, 382), COLORS["green"], radius=4)
    add_text(image, svg, "PREVIEW -", (540, 274), 58, "Bold", COLORS["white"], alpha=226)
    add_text(image, svg, "NOT FINAL FOOTAGE", (540, 338), 58, "Bold", COLORS["white"], alpha=226)


def add_caption_band(image: Image.Image, svg: list[str], top: int = 1176) -> None:
    add_rect(image, svg, (108, top, 972, 1580), COLORS["void"], alpha=194, radius=24)
    add_rect(image, svg, (108, top, 118, 1580), COLORS["green"], radius=5)


def write_overlay(name: str, draw_content) -> None:
    image = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    svg = svg_header()
    add_watermark(image, svg)
    draw_content(image, svg)
    svg.append("</svg>")
    image.save(OUT / f"{name}.png", optimize=True)
    (OUT / f"{name}.svg").write_text("\n".join(svg) + "\n", encoding="utf-8")


def hook(image: Image.Image, svg: list[str]) -> None:
    add_caption_band(image, svg)
    add_text(image, svg, "YOUR JOB SEARCH", (540, 1330), 78, "ExtraBold", COLORS["white"])
    add_text(image, svg, "JUST HIRED A TEAM.", (540, 1452), 72, "ExtraBold", COLORS["white"])


def reveal(image: Image.Image, svg: list[str]) -> None:
    add_caption_band(image, svg, top=1240)
    add_text(image, svg, "AI AGENTS.", (540, 1342), 104, "ExtraBold", COLORS["white"])
    add_text(image, svg, "YOUR CASE.", (540, 1472), 104, "ExtraBold", COLORS["white"])


def verb(word: str):
    def draw(image: Image.Image, svg: list[str]) -> None:
        add_caption_band(image, svg, top=1328)
        add_text(image, svg, word, (540, 1456), 144, "ExtraBold", COLORS["white"])

    return draw


def control(image: Image.Image, svg: list[str]) -> None:
    add_caption_band(image, svg, top=1240)
    add_text(image, svg, "YOU CALL", (540, 1344), 108, "ExtraBold", COLORS["white"])
    add_text(image, svg, "THE SHOTS.", (540, 1472), 108, "ExtraBold", COLORS["white"])


def end_card(image: Image.Image, svg: list[str]) -> None:
    add_rect(image, svg, (108, 690, 972, 1580), COLORS["void"], alpha=204, radius=28)
    add_rect(image, svg, (108, 690, 118, 1580), COLORS["green"], radius=5)
    add_text(image, svg, "JOB HUNTER", (540, 824), 92, "ExtraBold", COLORS["white"])
    add_text(image, svg, "TEAM", (540, 938), 92, "ExtraBold", COLORS["white"])
    add_rect(image, svg, (438, 1018, 642, 1026), COLORS["green"], radius=4)
    add_text(image, svg, "Your job hunt,", (540, 1110), 60, "Bold", COLORS["white"])
    add_text(image, svg, "now playable.", (540, 1188), 60, "Bold", COLORS["white"])
    add_text(image, svg, "jobhunterteam.ai", (540, 1316), 68, "Bold", COLORS["white"])
    add_text(image, svg, "Free", (210, 1468), 58, "Medium", COLORS["base"])
    add_text(image, svg, "·", (318, 1468), 58, "Bold", COLORS["green"])
    add_text(image, svg, "Open source", (530, 1468), 58, "Medium", COLORS["base"])
    add_text(image, svg, "·", (748, 1468), 58, "Bold", COLORS["green"])
    add_text(image, svg, "Beta", (850, 1468), 58, "Medium", COLORS["base"])


def safe_area_reference(image: Image.Image, svg: list[str]) -> None:
    # Reference only: do not composite into the animatic.
    x0, y0, x1, y1 = SAFE
    draw = ImageDraw.Draw(image)
    draw.rectangle(SAFE, outline=rgba(COLORS["green"], 255), width=4)
    svg.append(
        f'  <rect x="{x0}" y="{y0}" width="{x1 - x0}" height="{y1 - y0}" '
        f'fill="none" stroke="{COLORS["green"]}" stroke-width="4"/>'
    )
    add_text(image, svg, "SAFE AREA 108..972 / 220..1580", (540, 1720), 58, "Bold", COLORS["green"])


def main() -> None:
    overlays = [
        ("00_watermark", lambda _image, _svg: None),
        ("01_hook", hook),
        ("02_reveal", reveal),
        ("03_find", verb("FIND")),
        ("04_check", verb("CHECK")),
        ("05_score", verb("SCORE")),
        ("06_tailor", verb("TAILOR")),
        ("07_review", verb("REVIEW")),
        ("08_user_control", control),
        ("09_end_card", end_card),
        ("99_safe_area_reference_DO_NOT_COMPOSITE", safe_area_reference),
    ]
    for name, draw_content in overlays:
        write_overlay(name, draw_content)

    manifest = {
        "canvas": {"width": W, "height": H, "alpha": True, "fps_reference": 30},
        "safe_area": {"x_min": 108, "x_max": 972, "y_min": 220, "y_max": 1580},
        "font": {
            "family": "JetBrains Mono",
            "files": {weight: str(path.relative_to(ROOT)) for weight, path in FONT_FILES.items()},
            "minimum_size_px": 58,
        },
        "colors": COLORS,
        "band": {"color": COLORS["void"], "opacity": 0.76, "end_card_opacity": 0.80},
        "motion": {
            "default_enter": {
                "duration_frames": 5,
                "opacity": [0, 100],
                "translate_y_px": [18, 0],
                "easing": "easeOutCubic",
            },
            "hook_enter": {
                "duration_frames": 4,
                "opacity": [0, 100],
                "translate_y_px": [14, 0],
                "easing": "easeOutCubic",
                "note": "Fully readable by 00:00:00.133; meets the 0.2 s hook gate.",
            },
            "default_exit": {
                "duration_frames": 4,
                "opacity": [100, 0],
                "translate_y_px": [0, -8],
                "easing": "easeInQuad",
            },
            "verb_transition": "Straight cut or 3-frame opacity dissolve; no scale, bounce, glow, or glitch.",
            "end_card": {
                "start_seconds": 15.8,
                "duration_seconds": 4.2,
                "enter_frames": 8,
                "hold_note": "Keep URL continuously readable for the full hold after entry.",
            },
        },
        "usage": {
            "watermark": "Every numbered overlay already contains the watermark. Use 00_watermark only when the editor keeps one persistent global layer instead.",
            "png": "Production-ready raster reference with the bundled repo font rendered exactly.",
            "svg": "Editable source. Install/load JetBrains Mono before rendering.",
            "safe_area_reference": "Guide only; never composite 99_safe_area_reference_DO_NOT_COMPOSITE into the video.",
        },
        "overlays": [name for name, _ in overlays],
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
