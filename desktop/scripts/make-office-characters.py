#!/usr/bin/env python3
"""Makes the two walking sheets of the doctor and the maintainer from the sheets the office already has.

    python3 desktop/scripts/make-office-characters.py

They are made, not painted again, so that they stand in the style of the others (the same painter, the same 128x192
cells, the same poses): the doctor is the analyst's white coat with scrubs under it, the maintainer is the other white
coat with denim and a yellow hard hat, as the painted pictures of them sitting at their furniture
(furniture/occupied/dottore_armchair_seated_v2.png, mantenitore_workbench_down_seated_v2.png) show them. The colours
are changed by what a pixel is (a very saturated orange is the sweater, a mid-grey low in the body is the trousers), never by where it is
in the cell, so every pose of the sheet follows; the hard hat is drawn on the head of each cell. The output is a PNG of
the same size as its source, named in public/office/manifest.json as `dottore_a` and `mantenitore_a`.
"""
from __future__ import annotations

import colorsys
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
CHARACTERS = HERE.parent / "public" / "office" / "characters"
CELL_W, CELL_H = 128, 192
COLS, ROWS = 6, 12
SS = 4  # supersampling of what is drawn on top (the hat)


def hsv(r: int, g: int, b: int) -> tuple[float, float, float]:
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return h * 360, s, v


def rgb(h: float, s: float, v: float) -> tuple[int, int, int]:
    r, g, b = colorsys.hsv_to_rgb((h % 360) / 360, max(0.0, min(1.0, s)), max(0.0, min(1.0, v)))
    return round(r * 255), round(g * 255), round(b * 255)


def recolour(image: Image.Image, rule) -> Image.Image:
    """`rule(h, s, v, y_in_cell)` gives a new (h, s, v) for a pixel, or None to keep it."""
    out = image.convert("RGBA")
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            new = rule(*hsv(r, g, b), y % CELL_H)
            if new is not None:
                px[x, y] = (*rgb(*new), a)
    return out


# ── the doctor: analista_c (white coat, orange sweater, olive trousers) → scrubs ─────────────────────────────────
def doctor_rule(h, s, v, y):
    if y >= 52 and 19 <= h <= 30 and s >= (0.70 if y < 92 else 0.82):  # the sweater: far more saturated than any skin, and a hue of its own
        return 203, s * 0.62, min(1.0, v * 1.18 + 0.07)  # scrub blue
    if y >= 80 and 40 <= h <= 75 and s >= 0.30 and v <= 0.62:  # the olive trousers (and what shows of them under the coat)
        return 205, s * 1.05, min(1.0, v * 1.55 + 0.05)
    return None


# ── the maintainer: analista_f (white coat, navy shirt, grey trousers) → denim, boots as they are, yellow hard hat ──
def maintainer_rule(h, s, v, y):
    if y >= 52 and 195 <= h <= 260 and s >= 0.16 and v <= 0.50:  # the navy shirt → denim (not the coat's bluish shadows: they are lighter)
        return 212, max(s, 0.30) * 0.85, min(1.0, v * 1.55 + 0.12)
    if y >= 96 and s <= 0.22 and v <= 0.56 and v >= 0.12:  # the grey trousers → jeans (the white coat is lighter than this)
        return 214, 0.50, min(1.0, v * 1.05 + 0.14)
    return None


def head_of(cell: Image.Image) -> tuple[float, int, float] | None:
    """(centre x, top y, width) of the head in a cell, from the opaque pixels; None for an empty cell."""
    alpha = cell.getchannel("A")
    box = alpha.point(lambda v: 255 if v > 20 else 0).getbbox()
    if box is None:
        return None
    top = box[1]
    a = alpha.load()

    def span(y: int) -> tuple[int, int] | None:
        xs = [x for x in range(cell.width) if a[x, y] > 20]
        return (min(xs), max(xs)) if xs else None

    rows = [span(y) for y in range(top + 6, top + 16)]
    rows = [r for r in rows if r]
    if not rows:
        return None
    left = sum(r[0] for r in rows) / len(rows)
    right = sum(r[1] for r in rows) / len(rows)
    return (left + right) / 2, top, right - left


def hard_hat(cell: Image.Image) -> Image.Image:
    """The cell with a yellow hard hat on the head."""
    found = head_of(cell)
    if found is None:
        return cell
    cx, top, width = found
    layer = Image.new("RGBA", (cell.width * SS, cell.height * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    half = width / 2 + 1.6
    y0, y1 = top - 4.5, top + 12.0  # the dome
    box = lambda x0, y0_, x1, y1_: [x0 * SS, y0_ * SS, x1 * SS, y1_ * SS]
    shadow, body, light = (178, 132, 8, 255), (240, 190, 22, 255), (255, 226, 96, 255)
    d.ellipse(box(cx - half, y0, cx + half, y1 + 4), fill=shadow)  # the dome, in its shadow colour
    d.ellipse(box(cx - half + 0.8, y0, cx + half - 0.8, y1 + 2.2), fill=body)  # the lit body
    d.ellipse(box(cx - half * 0.55, y0 + 1.2, cx + half * 0.1, y0 + 6), fill=light)  # a shine on the left
    d.rounded_rectangle(box(cx - half - 1.6, y1 + 0.2, cx + half + 1.6, y1 + 3.4), radius=1.2 * SS, fill=shadow)  # the brim
    d.rounded_rectangle(box(cx - half - 1.0, y1 + 0.2, cx + half + 1.0, y1 + 2.2), radius=1.0 * SS, fill=body)
    d.rectangle(box(cx - 0.8, y0 + 0.4, cx + 0.8, y1), fill=(214, 164, 14, 255))  # the ridge
    layer = layer.resize(cell.size, Image.LANCZOS)
    out = cell.copy()
    out.alpha_composite(layer)
    return out


def make(source: str, target: str, rule, hat: bool) -> None:
    image = recolour(Image.open(CHARACTERS / source), rule)
    if hat:
        for row in range(ROWS):
            for col in range(COLS):
                box = (col * CELL_W, row * CELL_H, (col + 1) * CELL_W, (row + 1) * CELL_H)
                image.paste(hard_hat(image.crop(box)), box[:2])
    # the same kind of file as the others: 256 colours and a transparent one
    image.save(CHARACTERS / target, optimize=True)
    print(f"{target}: {image.size[0]}x{image.size[1]}")


if __name__ == "__main__":
    make("analista_c.png", "dottore_a.png", doctor_rule, hat=False)
    make("analista_f.png", "mantenitore_a.png", maintainer_rule, hat=True)
    sys.exit(0)
