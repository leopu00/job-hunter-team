"""Contracts for the reusable all-motion vertical renderer primitives."""

from __future__ import annotations

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
)


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
    ["incoming/game/motion-02-department-zoom-v1.mp4", "incoming/game/motion-03-chat-v1.mp4"],
])
def test_v020_collage_accepts_only_permitted_motion_inputs(paths: list[str]) -> None:
    validate_collage_inputs(paths)


@pytest.mark.parametrize("path", [
    "incoming/linux/G16-H/attempt-05/take.mkv",
    "incoming/linux/G17-H/attempt-01/take.mkv",
    "incoming/designer/lot-01/sprite.png",
    "incoming/web/capture.mp4",
])
def test_v020_collage_rejects_banned_legacy_inputs(path: str) -> None:
    with pytest.raises(VerticalMotionError, match="forbidden collage input"):
        validate_collage_inputs([path])
