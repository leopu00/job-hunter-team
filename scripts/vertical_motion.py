#!/usr/bin/env python3
"""Compose deterministic ffmpeg filter fragments for moving vertical promos.

Still imagery is never emitted as a frozen portrait card: a 1600x900 PNG is
continuously scaled, panned and cropped into the 1080x1920 canvas.  Callers
can combine the returned filters in their campaign-specific renderer without
duplicating the error-prone expression maths.
"""

from __future__ import annotations

import argparse
import binascii
import hashlib
import json
import math
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path


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
PROMOTED_COLLAGE_INPUTS = frozenset({"incoming/game/motion-01-open-day-v1.mp4"})
IMMUTABLE_RELEASE_PATH = ("motion-assets", "releases", "designer")


class VerticalMotionError(ValueError):
    """The requested animation would violate the portrait-render contract."""


@dataclass(frozen=True)
class ImmutableDesignerRelease:
    """Verified identity and placement contract for a Designer overlay."""

    asset: str
    revision: str
    png: Path
    png_sha256: str
    start: float
    end: float
    z_index: int


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
    """Fail closed unless every collage input is an explicitly promoted identity."""
    for path in paths:
        normalized = path.replace("\\", "/").lower()
        if any(token in normalized for token in FORBIDDEN_COLLAGE_INPUTS):
            raise VerticalMotionError(f"forbidden collage input: {path}")
        if normalized not in PROMOTED_COLLAGE_INPUTS and not any(
            normalized.endswith(f"/{allowed}") for allowed in PROMOTED_COLLAGE_INPUTS
        ):
            raise VerticalMotionError(f"unapproved collage input: {path}")


def _decode_png_dimensions(path: Path) -> tuple[int, int]:
    """Decode PNG framing and compressed scanlines without trusting extension.

    The renderer only needs identity/dimensions here, but a signature check is
    insufficient: a corrupt or non-PNG fixture must never pass a release gate.
    """
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise VerticalMotionError("release PNG is not a valid PNG")
    offset = 8
    width = height = None
    bit_depth = color_type = interlace = None
    idat = bytearray()
    saw_iend = False
    while offset < len(data):
        if offset + 12 > len(data):
            raise VerticalMotionError("release PNG is truncated")
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(data):
            raise VerticalMotionError("release PNG chunk is truncated")
        payload = data[offset + 8:offset + 8 + length]
        crc = struct.unpack(">I", data[offset + 8 + length:end])[0]
        if (binascii.crc32(kind + payload) & 0xFFFFFFFF) != crc:
            raise VerticalMotionError("release PNG has an invalid chunk CRC")
        if kind == b"IHDR":
            if length != 13 or width is not None:
                raise VerticalMotionError("release PNG has an invalid IHDR")
            width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", payload
            )
            if not width or not height or compression != 0 or filtering != 0 or interlace != 0:
                raise VerticalMotionError("release PNG uses unsupported framing")
        elif kind == b"IDAT":
            idat.extend(payload)
        elif kind == b"IEND":
            saw_iend = True
            break
        offset = end
    if width is None or not saw_iend or not idat:
        raise VerticalMotionError("release PNG is missing IHDR/IDAT/IEND")
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color_type)
    if channels is None or bit_depth not in (1, 2, 4, 8, 16):
        raise VerticalMotionError("release PNG color format is unsupported")
    row_bytes = (width * channels * bit_depth + 7) // 8
    try:
        decoded = zlib.decompress(bytes(idat))
    except zlib.error as error:
        raise VerticalMotionError("release PNG IDAT does not decode") from error
    if len(decoded) != (row_bytes + 1) * height:
        raise VerticalMotionError("release PNG decoded scanlines have the wrong size")
    return width, height


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _release_root_is_immutable(path: Path) -> bool:
    parts = path.resolve().parts
    width = len(IMMUTABLE_RELEASE_PATH)
    return any(parts[index:index + width] == IMMUTABLE_RELEASE_PATH
               for index in range(len(parts) - width + 1))


def verify_designer_release(
    manifest_path: str | Path,
    *,
    asset: str,
    revision: str,
    z_index: int,
    start: float,
    end: float,
    canvas_width: int = CANVAS_WIDTH,
    canvas_height: int = CANVAS_HEIGHT,
) -> ImmutableDesignerRelease:
    """Return a Designer release only after its immutable render contract passes.

    The renderer accepts a component solely from the versioned ``releases``
    tree.  It checks both the manifest-declared PNG hash and the independently
    delivered SHA-256 sidecar before a compositing command is built.  This
    prevents an ``incoming`` replacement or an overwritten revision from
    silently changing a cut that was already reviewed.
    """
    manifest_file = Path(manifest_path).resolve()
    if not manifest_file.is_file():
        raise VerticalMotionError(f"missing release manifest: {manifest_file}")
    if not _release_root_is_immutable(manifest_file):
        raise VerticalMotionError(f"release must be under motion-assets/releases/designer: {manifest_file}")

    try:
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise VerticalMotionError(f"invalid release manifest: {manifest_file}") from error

    if manifest.get("schema") != "jht-motion-asset-v1" or manifest.get("status") != "immutable-release":
        raise VerticalMotionError("release manifest is not immutable jht-motion-asset-v1")
    if manifest.get("asset") != asset or manifest.get("revision") != revision:
        raise VerticalMotionError("release asset or revision does not match the requested overlay")
    if manifest.get("canvas") != {"width": canvas_width, "height": canvas_height, "color_space": "sRGB"}:
        raise VerticalMotionError(f"release canvas must be {canvas_width}x{canvas_height} sRGB")
    if manifest.get("alpha_mode") != "straight-unpremultiplied":
        raise VerticalMotionError("release alpha must be straight-unpremultiplied")
    if manifest.get("anchor") != {"x": 0, "y": 0} or manifest.get("pivot") != {"x": 0.0, "y": 0.0}:
        raise VerticalMotionError("release anchor and pivot must be 0,0")
    if manifest.get("z_index") != z_index:
        raise VerticalMotionError(f"release z-index must be {z_index}")

    timing = manifest.get("timing")
    if not isinstance(timing, dict) or timing.get("global_start") != start or timing.get("global_end") != end:
        raise VerticalMotionError(f"release timing must be {start:.2f}-{end:.2f}")

    png = manifest.get("files", {}).get("png", {})
    png_name = png.get("path") if isinstance(png, dict) else None
    expected_sha = png.get("sha256") if isinstance(png, dict) else None
    expected_name = f"{asset}-{revision}.png"
    if png_name != expected_name or not isinstance(expected_sha, str) or len(expected_sha) != 64:
        raise VerticalMotionError("release PNG identity is malformed")
    png_file = (manifest_file.parent / png_name).resolve()
    if png_file.parent != manifest_file.parent or not png_file.is_file():
        raise VerticalMotionError("release PNG is missing or outside its manifest directory")
    actual_sha = _sha256(png_file)
    if actual_sha != expected_sha:
        raise VerticalMotionError("release PNG does not match its manifest SHA-256")
    actual_dimensions = _decode_png_dimensions(png_file)
    if actual_dimensions != (canvas_width, canvas_height):
        raise VerticalMotionError(
            f"release PNG dimensions must be {canvas_width}x{canvas_height}, got "
            f"{actual_dimensions[0]}x{actual_dimensions[1]}"
        )

    sidecar = manifest_file.with_name(f"{asset}-{revision}.sha256")
    if not sidecar.is_file():
        raise VerticalMotionError("release SHA-256 sidecar is missing")
    sidecar_entries = {
        line.split(maxsplit=1)[1]: line.split(maxsplit=1)[0]
        for line in sidecar.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#") and len(line.split(maxsplit=1)) == 2
    }
    if sidecar_entries.get(expected_name) != actual_sha:
        raise VerticalMotionError("release PNG does not match its SHA-256 sidecar")

    return ImmutableDesignerRelease(
        asset=asset,
        revision=revision,
        png=png_file,
        png_sha256=actual_sha,
        start=start,
        end=end,
        z_index=z_index,
    )


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
