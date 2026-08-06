"""Contracts for the reusable all-motion vertical renderer primitives."""

from __future__ import annotations

import hashlib
import json
import struct
import zlib

import pytest

from scripts.vertical_motion import (
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    PanZoom,
    SpriteMotion,
    VerticalMotionError,
    png_pan_zoom_filter,
    sprite_overlay_filter,
    validate_collage_inputs,
    verify_designer_release,
)


def _write_png(path, width: int, height: int) -> None:
    row = b"\x00" + b"\x00\x00\x00\xff" * width
    raw = row * height

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(
            ">I", zlib.crc32(kind + payload) & 0xFFFFFFFF
        )

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def _designer_release(tmp_path, *, asset: str = "pipeline-rail-state-03", revision: str = "r02",
                      canvas_width: int = 1080, canvas_height: int = 1920):
    root = tmp_path / "motion-assets" / "releases" / "designer" / "central-6p00-10p90"
    root.mkdir(parents=True)
    png_name = f"{asset}-{revision}.png"
    png = root / png_name
    _write_png(png, canvas_width, canvas_height)
    png_sha256 = hashlib.sha256(png.read_bytes()).hexdigest()
    manifest = root / f"{asset}-{revision}.manifest.json"
    manifest.write_text(json.dumps({
        "schema": "jht-motion-asset-v1",
        "asset": asset,
        "revision": revision,
        "status": "immutable-release",
        "files": {"png": {"path": png_name, "sha256": png_sha256}},
        "canvas": {"width": canvas_width, "height": canvas_height, "color_space": "sRGB"},
        "alpha_mode": "straight-unpremultiplied",
        "anchor": {"x": 0, "y": 0},
        "pivot": {"x": 0.0, "y": 0.0},
        "z_index": 10,
        "timing": {"global_start": 6.0, "global_end": 7.64},
    }), encoding="utf-8")
    (root / f"{asset}-{revision}.sha256").write_text(
        f"{png_sha256}  {png_name}\n", encoding="utf-8"
    )
    return manifest, png


def test_png_pan_zoom_is_a_per_frame_portrait_motion_filter() -> None:
    filtergraph = png_pan_zoom_filter(PanZoom(
        duration=1.65, zoom_from=1.0, zoom_to=1.12,
        pan_x_from=0.18, pan_x_to=0.76, pan_y_from=0.42, pan_y_to=0.54,
    ))

    assert "eval=frame" in filtergraph
    assert "*t/1.650000" in filtergraph
    assert f"crop={CANVAS_WIDTH}:{CANVAS_HEIGHT}" in filtergraph
    assert "fps=30" in filtergraph
    assert "setsar=1" in filtergraph


@pytest.mark.parametrize("plan", [
    PanZoom(duration=0),
    PanZoom(duration=1, source_width=1920, source_height=1080),
    PanZoom(duration=1, zoom_from=0.98),
    PanZoom(duration=1, pan_x_to=1.01),
])
def test_png_pan_zoom_rejects_any_plan_that_could_freeze_or_miss_canvas(plan: PanZoom) -> None:
    with pytest.raises(VerticalMotionError):
        png_pan_zoom_filter(plan)


def test_transparent_sprite_enters_and_exits_without_a_static_pop() -> None:
    filtergraph = sprite_overlay_filter(SpriteMotion(start=2.74, end=4.37, enter_frames=5, exit_frames=4))

    assert "format=rgba" in filtergraph
    assert "fade=t=in:st=0:d=0.166667:alpha=1" in filtergraph
    assert "fade=t=out:st=1.496667:d=0.133333:alpha=1" in filtergraph
    assert "setpts=PTS+2.740000/TB" in filtergraph


@pytest.mark.parametrize("paths", [
    ["incoming/game/motion-01-open-day-v1.mp4"],
])
def test_v020_collage_accepts_only_permitted_motion_inputs(paths: list[str]) -> None:
    validate_collage_inputs(paths)


@pytest.mark.parametrize("path", [
    "incoming/linux/G16-H/attempt-05/take.mkv",
    "incoming/linux/G17-H/attempt-01/take.mkv",
    "incoming/game/motion-02-department-zoom-v1.mp4",
    "incoming/game/motion-03-chat-v1.mp4",
    "motion-assets/incoming/designer/characters/scout.png",
    "incoming/designer/lot-01/sprite.png",
    "incoming/web/capture.mp4",
])
def test_v020_collage_rejects_banned_legacy_inputs(path: str) -> None:
    with pytest.raises(VerticalMotionError, match="forbidden collage input"):
        validate_collage_inputs([path])


def test_collage_rejects_unknown_input_even_when_not_on_denylist() -> None:
    with pytest.raises(VerticalMotionError, match="unapproved collage input"):
        validate_collage_inputs(["incoming/game/motion-04-open-day-v1.mp4"])


def test_designer_release_requires_immutable_manifest_and_both_png_hashes(tmp_path) -> None:
    manifest, png = _designer_release(tmp_path)

    release = verify_designer_release(
        manifest,
        asset="pipeline-rail-state-03",
        revision="r02",
        z_index=10,
        start=6.0,
        end=7.64,
    )

    assert release.png == png.resolve()
    assert release.start == 6.0
    assert release.end == 7.64
    assert release.z_index == 10


def test_designer_release_accepts_a_verified_natural_canvas_layer(tmp_path) -> None:
    manifest, _ = _designer_release(tmp_path, asset="control-input-empty", revision="r01",
                                    canvas_width=920, canvas_height=300)

    release = verify_designer_release(
        manifest,
        asset="control-input-empty",
        revision="r01",
        z_index=10,
        start=6.0,
        end=7.64,
        canvas_width=920,
        canvas_height=300,
    )

    assert release.asset == "control-input-empty"


def test_designer_release_rejects_a_replaced_png_even_with_the_same_filename(tmp_path) -> None:
    manifest, png = _designer_release(tmp_path)
    png.write_bytes(b"overwritten after review")

    with pytest.raises(VerticalMotionError, match="manifest SHA-256"):
        verify_designer_release(
            manifest,
            asset="pipeline-rail-state-03",
            revision="r02",
            z_index=10,
            start=6.0,
            end=7.64,
        )


def test_designer_release_rejects_corrupt_png_even_when_hashes_match(tmp_path) -> None:
    manifest, png = _designer_release(tmp_path)
    png.write_bytes(b"not a PNG")
    updated_sha = hashlib.sha256(png.read_bytes()).hexdigest()
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    payload["files"]["png"]["sha256"] = updated_sha
    manifest.write_text(json.dumps(payload), encoding="utf-8")
    manifest.with_name("pipeline-rail-state-03-r02.sha256").write_text(
        f"{updated_sha}  pipeline-rail-state-03-r02.png\n", encoding="utf-8"
    )

    with pytest.raises(VerticalMotionError, match="valid PNG"):
        verify_designer_release(
            manifest, asset="pipeline-rail-state-03", revision="r02",
            z_index=10, start=6.0, end=7.64,
        )


def test_designer_release_rejects_wrong_decoded_png_dimensions(tmp_path) -> None:
    manifest, png = _designer_release(tmp_path)
    _write_png(png, 1080, 1919)
    updated_sha = hashlib.sha256(png.read_bytes()).hexdigest()
    payload = json.loads(manifest.read_text(encoding="utf-8"))
    payload["files"]["png"]["sha256"] = updated_sha
    manifest.write_text(json.dumps(payload), encoding="utf-8")
    manifest.with_name("pipeline-rail-state-03-r02.sha256").write_text(
        f"{updated_sha}  pipeline-rail-state-03-r02.png\n", encoding="utf-8"
    )

    with pytest.raises(VerticalMotionError, match="dimensions must be"):
        verify_designer_release(
            manifest, asset="pipeline-rail-state-03", revision="r02",
            z_index=10, start=6.0, end=7.64,
        )


def test_designer_release_rejects_a_sidecar_that_disagrees_with_the_manifest(tmp_path) -> None:
    manifest, _ = _designer_release(tmp_path)
    sidecar = manifest.with_name("pipeline-rail-state-03-r02.sha256")
    sidecar.write_text(
        f"{'0' * 64}  pipeline-rail-state-03-r02.png\n", encoding="utf-8"
    )

    with pytest.raises(VerticalMotionError, match="SHA-256 sidecar"):
        verify_designer_release(
            manifest,
            asset="pipeline-rail-state-03",
            revision="r02",
            z_index=10,
            start=6.0,
            end=7.64,
        )


def test_designer_release_rejects_an_incoming_asset_even_when_its_hash_is_valid(tmp_path) -> None:
    manifest, _ = _designer_release(tmp_path)
    incoming = tmp_path / "motion-assets" / "incoming" / "designer" / "rail.manifest.json"
    incoming.parent.mkdir(parents=True)
    incoming.write_text(manifest.read_text(encoding="utf-8"), encoding="utf-8")

    with pytest.raises(VerticalMotionError, match="motion-assets/releases/designer"):
        verify_designer_release(
            incoming,
            asset="pipeline-rail-state-03",
            revision="r02",
            z_index=10,
            start=6.0,
            end=7.64,
        )
