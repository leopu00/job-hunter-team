#!/usr/bin/env python3
"""Freeze the visual contract for the Scout walk-cycle gate.

This exporter only crops existing canonical runtime art.  It deliberately does
not synthesize, redraw, resize, or retouch a character frame.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


CELL = (256, 384)
PIVOT = (128, 360)
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[6]
SHEET = ROOT / "game/assets/characters/sheets/scout_a.png"
SEMANTIC = ROOT / "agents/scout/scout.it.md"
FONT = ROOT / "game/assets/fonts/JetBrainsMono-Bold.ttf"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_revision(path: Path) -> str:
    return subprocess.check_output(
        ["git", "log", "-1", "--format=%H", "--", str(path.relative_to(ROOT))],
        cwd=ROOT,
        text=True,
    ).strip()


def compact_palette(image: Image.Image) -> list[str]:
    """Return stable representative source colours without inventing colours."""
    bins: Counter[tuple[int, int, int]] = Counter()
    for red, green, blue, alpha in image.getdata():
        if alpha >= 250:
            bins[(red // 16, green // 16, blue // 16)] += 1
    return [
        "#{:02X}{:02X}{:02X}FF".format(red * 16 + 8, green * 16 + 8, blue * 16 + 8)
        for (red, green, blue), _ in bins.most_common(16)
    ]


def label(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font: ImageFont.FreeTypeFont, fill: tuple[int, int, int, int]) -> None:
    draw.text(xy, text, font=font, fill=fill)


def render_card(crops: dict[str, Image.Image], palette: list[str]) -> None:
    canvas = Image.new("RGBA", (1280, 1120), (6, 6, 8, 255))
    draw = ImageDraw.Draw(canvas)
    title = ImageFont.truetype(str(FONT), 38)
    copy = ImageFont.truetype(str(FONT), 19)
    small = ImageFont.truetype(str(FONT), 15)
    ink = (240, 240, 250, 255)
    muted = (184, 184, 208, 255)
    green = (0, 232, 122, 255)

    label(draw, (44, 36), "SCOUT · REFERENCE CARD · WALK-SIDE GATE", title, ink)
    draw.rectangle((44, 96, 1236, 102), fill=green)
    label(draw, (44, 124), "Canonical runtime sheet · no generated or redrawn sprite pixels", copy, muted)
    for index, (name, crop) in enumerate(crops.items()):
        x = 44 + index * 400
        panel = Image.new("RGBA", (256, 384), (22, 22, 27, 255))
        panel.alpha_composite(crop)
        canvas.alpha_composite(panel, (x, 170))
        draw.rectangle((x, 170 + PIVOT[1], x + 256, 171 + PIVOT[1]), fill=(0, 232, 122, 160))
        draw.line((x + PIVOT[0], 170 + 342, x + PIVOT[0], 170 + 378), fill=green, width=1)
        label(draw, (x, 570), name.upper(), copy, ink)
        label(draw, (x, 598), "native 256×384 · pivot (128,360)", small, muted)

    label(draw, (44, 666), "INVARIANTS", copy, green)
    invariants = [
        "dark oval sunglasses · dark swept hair · warm medium complexion",
        "beige trench coat · charcoal trousers · brown oxford shoes",
        "top-down ¾ side faces screen-right · one head / two limbs per side",
        "opaque painterly edge · feet stay at y=359 above baseline y=360",
    ]
    for index, line in enumerate(invariants):
        label(draw, (44, 700 + index * 28), "• " + line, small, ink)

    label(draw, (680, 666), "PROPOSED SIX-PHASE MAP", copy, green)
    phases = [
        "F00 contact A · lead/right heel · left arm forward",
        "F01 load A · right support · root lowest",
        "F02 passing · right support · left knee forward",
        "F03 contact B · lead/left heel · right arm forward",
        "F04 load B · left support · root lowest",
        "F05 passing · left support · right knee forward",
    ]
    for index, line in enumerate(phases):
        label(draw, (680, 700 + index * 28), "• " + line, small, ink)

    label(draw, (44, 872), "APPROVED REFERENCE PALETTE · representative opaque source swatches", copy, green)
    for index, colour in enumerate(palette):
        x = 44 + index * 74
        draw.rectangle((x, 910, x + 56, 966), fill=colour[:7])
        draw.rectangle((x, 910, x + 56, 966), outline=(240, 240, 250, 100), width=1)
        label(draw, (x, 978), colour[1:7], small, muted)
    label(draw, (44, 1030), "Landmark tolerances: head ±2 px · glasses ±2 px · shoulders ±3 px · hip ±3 px · support contact ±1 px", small, muted)
    label(draw, (44, 1060), "Runtime scale 0.425 · native cell edges and transparent padding must remain unchanged", small, muted)
    canvas.save(HERE / "reference-card.png", optimize=True)


def main() -> None:
    image = Image.open(SHEET).convert("RGBA")
    if image.size != (CELL[0] * 6, CELL[1] * 12):
        raise SystemExit(f"unexpected source sheet size: {image.size}")
    positions = {"idle_down": (0, 0), "idle_up": (0, 1), "idle_side": (0, 2)}
    crops: dict[str, Image.Image] = {}
    for name, (column, row) in positions.items():
        crop = image.crop((column * CELL[0], row * CELL[1], (column + 1) * CELL[0], (row + 1) * CELL[1]))
        if crop.getchannel("A").getbbox() is None:
            raise SystemExit(f"empty reference crop: {name}")
        crop.save(HERE / f"{name}.png", optimize=True)
        crops[name] = crop

    palette = compact_palette(image)
    palette_contract = {
        "role": "scout",
        "source": str(SHEET.relative_to(ROOT)),
        "source_sha256": sha256(SHEET),
        "method": "most frequent 4-bit RGB bins among source pixels with alpha >= 250; swatches are source-derived reference colours, not a redraw palette",
        "rgba_hex": palette,
    }
    palette_path = HERE / "palette-rgba.json"
    palette_path.write_text(json.dumps(palette_contract, indent=2) + "\n", encoding="utf-8")
    render_card(crops, palette)

    reference = {
        "gate": "sprite-frame-gate phase 0",
        "role": "scout",
        "semantic_reference": {
            "path": str(SEMANTIC.relative_to(ROOT)),
            "sha256": sha256(SEMANTIC),
        },
        "visual_reference": {
            "path": str(SHEET.relative_to(ROOT)),
            "sha256": sha256(SHEET),
            "git_revision": source_revision(SHEET),
            "stable_native_crops": {name: f"{name}.png" for name in crops},
        },
        "canvas": {"width": CELL[0], "height": CELL[1], "alpha": True, "pivot_feet": list(PIVOT), "baseline_y": 360},
        "view": {"projection": "top-down 3/4", "native_facing": "screen-right", "runtime_scale": 0.425},
        "invariants": {
            "face_and_head": "one profile, dark oval sunglasses, swept dark hair, warm medium complexion",
            "wardrobe": "beige trench coat, charcoal trousers, brown oxford shoes",
            "anatomy": "one head, one torso, two arms, two hands, two legs, two feet; no detached components",
            "edge_and_padding": "painterly opaque source edges; full 256x384 canvas retained; max opaque y=359",
        },
        "landmarks_native_px": {
            "head_center": {"x": 126, "y": 78, "tolerance": 2},
            "glasses_center": {"x": 151, "y": 90, "tolerance": 2},
            "shoulder_center": {"x": 130, "y": 126, "tolerance": 3},
            "hip_center": {"x": 130, "y": 235, "tolerance": 3},
            "support_contact": {"x": 128, "y": 359, "tolerance": 1},
        },
        "phase_map": [
            {"frame": "F00", "phase": "contact A", "support": "lead/right heel", "counterphase": "left arm forward"},
            {"frame": "F01", "phase": "load A", "support": "right", "counterphase": "root lowest"},
            {"frame": "F02", "phase": "passing", "support": "right", "counterphase": "left knee forward"},
            {"frame": "F03", "phase": "contact B", "support": "lead/left heel", "counterphase": "right arm forward"},
            {"frame": "F04", "phase": "load B", "support": "left", "counterphase": "root lowest"},
            {"frame": "F05", "phase": "passing", "support": "left", "counterphase": "right knee forward"},
        ],
        "palette": {"path": "palette-rgba.json", "sha256": sha256(palette_path)},
        "evidence": {"card": "reference-card.png", "sha256": sha256(HERE / "reference-card.png")},
        "source_policy": "Existing canonical runtime pixels only. No image generation, redrawing, retouching, scaling, or trimming.",
        "next_submission": "F00 only, after written REFERENCE PASS.",
    }
    (HERE / "reference.json").write_text(json.dumps(reference, indent=2) + "\n", encoding="utf-8")
    print("reference ready")


if __name__ == "__main__":
    main()
