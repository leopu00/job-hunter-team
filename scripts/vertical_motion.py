#!/usr/bin/env python3
"""Compose deterministic ffmpeg filter fragments for moving vertical promos.

Still imagery is never emitted as a frozen portrait card: a 1600x900 PNG is
continuously scaled, panned and cropped into the 1080x1920 canvas.  Callers
can combine the returned filters in their campaign-specific renderer without
duplicating the error-prone expression maths.
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass


CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920
FPS = 30
SOURCE_WIDTH = 1600
SOURCE_HEIGHT = 900
# The current v0.2 gate has promoted only motion-01 (the walking Scout).  A
# later VIDEO promotion must update this explicit list together with its test;
# a silent fallback to another Game clip would defeat the review gate.
FORBIDDEN_COLLAGE_INPUTS = (
    "g16", "g17", "motion-02", "motion-03", "characters/", "designer/lot-01", "web/"
)


class VerticalMotionError(ValueError):
    """The requested animation would violate the portrait-render contract."""


@dataclass(frozen=True)
class PanZoom:
    duration: float
    zoom_from: float = 1.0
    zoom_to: float = 1.08
    pan_x_from: float = 0.5
    pan_x_to: float = 0.5
    pan_y_from: float = 0.5
    pan_y_to: float = 0.5
    source_width: int = SOURCE_WIDTH
    source_height: int = SOURCE_HEIGHT

    def validate(self) -> None:
        if self.duration <= 0:
            raise VerticalMotionError("duration must be positive")
        if (self.source_width, self.source_height) != (SOURCE_WIDTH, SOURCE_HEIGHT):
            raise VerticalMotionError("PNG source must be exactly 1600x900")
        if min(self.zoom_from, self.zoom_to) < 1:
            raise VerticalMotionError("zoom must cover the portrait canvas (>= 1)")
        for name, value in (
            ("pan_x_from", self.pan_x_from), ("pan_x_to", self.pan_x_to),
            ("pan_y_from", self.pan_y_from), ("pan_y_to", self.pan_y_to),
        ):
            if not 0 <= value <= 1:
                raise VerticalMotionError(f"{name} must be normalized between 0 and 1")


@dataclass(frozen=True)
class SpriteMotion:
    start: float
    end: float
    enter_frames: int = 5
    exit_frames: int = 4
    slide_y_px: int = 18

    def validate(self) -> None:
        if self.start < 0 or self.end <= self.start:
            raise VerticalMotionError("sprite timing must be a positive interval")
        if self.enter_frames < 1 or self.exit_frames < 0:
            raise VerticalMotionError("sprite frame counts are invalid")


def _linear(from_value: float, to_value: float, duration: float) -> str:
    return f"{from_value:.6f}+({to_value:.6f}-{from_value:.6f})*t/{duration:.6f}"


def png_pan_zoom_filter(plan: PanZoom) -> str:
    """Return a per-frame 1600x900-to-portrait Ken-Burns filter fragment."""
    plan.validate()
    cover_width = math.ceil(CANVAS_HEIGHT * SOURCE_WIDTH / SOURCE_HEIGHT / 2) * 2
    zoom = _linear(plan.zoom_from, plan.zoom_to, plan.duration)
    pan_x = _linear(plan.pan_x_from, plan.pan_x_to, plan.duration)
    pan_y = _linear(plan.pan_y_from, plan.pan_y_to, plan.duration)
    return (
        "scale="
        f"w='trunc({cover_width}*({zoom})/2)*2':"
        f"h='trunc({CANVAS_HEIGHT}*({zoom})/2)*2':eval=frame,"
        f"crop={CANVAS_WIDTH}:{CANVAS_HEIGHT}:"
        f"x='(in_w-out_w)*({pan_x})':"
        f"y='(in_h-out_h)*({pan_y})',"
        f"fps={FPS},setsar=1"
    )


def sprite_overlay_filter(plan: SpriteMotion) -> str:
    """Return the alpha/slide transform for a transparent PNG sprite layer."""
    plan.validate()
    enter = plan.enter_frames / FPS
    exit_duration = plan.exit_frames / FPS
    filters = ["format=rgba", f"fade=t=in:st=0:d={enter:.6f}:alpha=1"]
    if plan.exit_frames:
        filters.append(
            f"fade=t=out:st={plan.end - plan.start - exit_duration:.6f}:"
            f"d={exit_duration:.6f}:alpha=1"
        )
    filters.append(f"setpts=PTS+{plan.start:.6f}/TB")
    return ",".join(filters)


def validate_collage_inputs(paths: list[str]) -> None:
    """Fail closed when a v0.2 collage accidentally reintroduces banned media."""
    for path in paths:
        normalized = path.replace("\\", "/").lower()
        if any(token in normalized for token in FORBIDDEN_COLLAGE_INPUTS):
            raise VerticalMotionError(f"forbidden collage input: {path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration", type=float, required=True)
    parser.add_argument("--zoom-from", type=float, default=1.0)
    parser.add_argument("--zoom-to", type=float, default=1.08)
    parser.add_argument("--pan-x-from", type=float, default=0.5)
    parser.add_argument("--pan-x-to", type=float, default=0.5)
    parser.add_argument("--pan-y-from", type=float, default=0.5)
    parser.add_argument("--pan-y-to", type=float, default=0.5)
    args = parser.parse_args()
    print(png_pan_zoom_filter(PanZoom(
        duration=args.duration, zoom_from=args.zoom_from, zoom_to=args.zoom_to,
        pan_x_from=args.pan_x_from, pan_x_to=args.pan_x_to,
        pan_y_from=args.pan_y_from, pan_y_to=args.pan_y_to,
    )))


if __name__ == "__main__":
    main()
