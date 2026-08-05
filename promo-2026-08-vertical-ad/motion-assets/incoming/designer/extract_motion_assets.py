#!/usr/bin/env python3
"""Extract compositor-ready motion assets from the canonical JHT sheets."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).resolve().parent
SHEETS = ROOT / "game" / "assets" / "characters" / "sheets"
FONT = ROOT / "game" / "assets" / "fonts" / "JetBrainsMono-Bold.ttf"

CELL = (256, 384)
FEET = (128, 360)
FPS = 10
WALK_SIDE_ROW = 5
ROLES = {
    "scout": ("Scout", SHEETS / "scout_a.png"),
    "analyst": ("Analyst", SHEETS / "analista_a.png"),
    "scorer": ("Scorer", SHEETS / "scorer_a.png"),
    "writer": ("Writer", SHEETS / "scrittore_a.png"),
    "critic": ("Critic", SHEETS / "critico_a.png"),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def extract_role(slug: str, label: str, source: Path) -> dict:
    image = Image.open(source).convert("RGBA")
    expected = (CELL[0] * 6, CELL[1] * 12)
    if image.size != expected:
        raise SystemExit(f"{source}: expected canonical sheet {expected}, got {image.size}")

    role_dir = OUT / "characters" / slug / "walk_side"
    role_dir.mkdir(parents=True, exist_ok=True)
    frames = []
    for index in range(6):
        x0 = index * CELL[0]
        y0 = WALK_SIDE_ROW * CELL[1]
        frame = image.crop((x0, y0, x0 + CELL[0], y0 + CELL[1]))
        if frame.getchannel("A").getbbox() is None:
            raise SystemExit(f"{source}: walk_side frame {index} is empty")
        frame_path = role_dir / f"frame-{index:02d}.png"
        frame.save(frame_path, optimize=True)
        frames.append(frame)

    strip = Image.new("RGBA", (CELL[0] * 6, CELL[1]), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        strip.alpha_composite(frame, (index * CELL[0], 0))
    strip.save(role_dir / "strip.png", optimize=True)
    frames[0].save(
        role_dir / "preview.webp",
        save_all=True,
        append_images=frames[1:],
        duration=round(1000 / FPS),
        loop=0,
        lossless=True,
        method=6,
    )
    return {
        "slug": slug,
        "label": label,
        "source": str(source.relative_to(ROOT)),
        "source_sha256": sha256(source),
        "track": "walk_side",
        "row": WALK_SIDE_ROW,
        "frames": 6,
        "fps": FPS,
        "frame_glob": f"characters/{slug}/walk_side/frame-*.png",
        "strip": f"characters/{slug}/walk_side/strip.png",
        "preview": f"characters/{slug}/walk_side/preview.webp",
    }


def render_batch_preview(entries: list[dict]) -> None:
    canvas = Image.new("RGBA", (1080, 460), (6, 6, 8, 255))
    draw = ImageDraw.Draw(canvas)
    title_font = ImageFont.truetype(str(FONT), 34)
    label_font = ImageFont.truetype(str(FONT), 22)
    draw.text((540, 42), "JHT MOTION COLLAGE · WALK CYCLES", font=title_font,
              fill=(240, 240, 250, 255), anchor="mm")
    draw.rectangle((44, 72, 1036, 78), fill=(0, 232, 122, 255))

    preview_frames = []
    for frame_index in range(6):
        frame_canvas = canvas.copy()
        frame_draw = ImageDraw.Draw(frame_canvas)
        for role_index, entry in enumerate(entries):
            frame = Image.open(OUT / entry["frame_glob"].replace("*", f"{frame_index:02d}"))
            frame = frame.resize((192, 288), Image.Resampling.LANCZOS)
            x = 60 + role_index * 204
            frame_canvas.alpha_composite(frame, (x, 104))
            frame_draw.text((x + 96, 424), entry["label"].upper(), font=label_font,
                            fill=(184, 184, 208, 255), anchor="mm")
        preview_frames.append(frame_canvas)

    preview_frames[0].save(
        OUT / "batch-01-walk-cycles-preview.webp",
        save_all=True,
        append_images=preview_frames[1:],
        duration=round(1000 / FPS),
        loop=0,
        lossless=True,
        method=6,
    )
    preview_frames[0].save(OUT / "batch-01-walk-cycles-poster.png", optimize=True)


def main() -> None:
    entries = [extract_role(slug, label, source) for slug, (label, source) in ROLES.items()]
    render_batch_preview(entries)
    manifest = {
        "batch": "01-walk-cycles",
        "status": "ready",
        "source_policy": "Exact crops from canonical game sheets; no character identity was generated or altered.",
        "canvas": {"width": CELL[0], "height": CELL[1], "alpha": True},
        "anchor": {"name": "feet", "x": FEET[0], "y": FEET[1]},
        "playback": {"fps": FPS, "frame_duration_ms": round(1000 / FPS), "loop": True},
        "direction": "Characters face screen-right. Mirror at composition time for screen-left; do not create a second identity.",
        "compositing": "Keep the full 256x384 frame so every cycle shares the same feet anchor. Do not trim individual frames.",
        "palette": {"brand_green": "#00E87A", "typeface": "JetBrains Mono"},
        "entries": entries,
    }
    (OUT / "batch-01-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"ready: {len(entries)} roles, {len(entries) * 6} frames, {FPS} fps")


if __name__ == "__main__":
    main()
