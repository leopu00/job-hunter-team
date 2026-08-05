#!/usr/bin/env python3
"""Fail closed on the G16-H dynamic recorder regression contract.

This is a post-capture verifier.  It never opens a portal, starts a recorder,
or sends controller input: the Linux E2E owner supplies an already-closed
attempt package.  Keeping the gate independent from the capture process makes
the portal/window source and the qualified I420-to-x264 tail auditable after a
recorder refactor.
"""

from __future__ import annotations

import argparse
from collections import Counter
from fractions import Fraction
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unicodedata
from typing import Any, Iterable

G16_DYNAMIC_SSIM_MIN = 0.9955
PSNR_MIN_DB = 46.5
OCR_RECALL_MIN = 1.0
OCR_ACCURACY_MIN = 0.99
MAX_PTS_GAP_SECONDS = 0.050
MAX_GOP_FRAMES = 60
MAX_EOS_SECONDS = 15.0
MIN_DURATION_SECONDS = 8.0
MAX_DURATION_SECONDS = 12.0
WIDTH = 1920
HEIGHT = 1080
FPS = 30
G16_ANCHORS_SHA256 = "c18de9493f911ad2fd3740183d84a113ca1dd90dffcb3648c3ee462081701135"
TIMING_TOLERANCE_SECONDS = 0.25


class GateInvalid(RuntimeError):
    """The evidence cannot prove the regression contract."""


def run(
    command: list[str], *, allow_failure: bool = False
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    if result.returncode != 0 and not allow_failure:
        raise GateInvalid(f"{Path(command[0]).name} failed")
    return result


def require_file(path: Path, label: str) -> Path:
    resolved = path.expanduser().resolve()
    if not resolved.is_file() or resolved.stat().st_size == 0:
        raise GateInvalid(f"missing {label}")
    return resolved


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise GateInvalid(f"invalid {label}") from error
    if not isinstance(value, dict):
        raise GateInvalid(f"invalid {label}")
    return value


def load_controller(path: Path) -> dict[str, Any]:
    """Accept the persisted JSON evidence or the controller's JSON log line."""
    try:
        return load_json(path, "controller evidence")
    except GateInvalid:
        pass

    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as error:
        raise GateInvalid("invalid controller evidence") from error
    for line in reversed(lines):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise GateInvalid("invalid controller evidence")


def add_check(
    checks: list[dict[str, Any]], name: str, passed: bool, **details: Any
) -> None:
    checks.append({"name": name, "status": "PASS" if passed else "FAIL", **details})


def number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise GateInvalid(f"invalid {label}")
    try:
        result = float(value)
    except ValueError as error:
        raise GateInvalid(f"invalid {label}") from error
    if not math.isfinite(result):
        raise GateInvalid(f"invalid {label}")
    return result


def parse_rate(value: Any) -> Fraction:
    try:
        return Fraction(str(value))
    except (ValueError, ZeroDivisionError) as error:
        raise GateInvalid("invalid frame rate") from error


def probe(path: Path, ffprobe: str, *, frames: bool = False) -> dict[str, Any]:
    command = [ffprobe, "-v", "error", "-select_streams", "v:0"]
    if frames:
        command.extend(
            [
                "-show_frames",
                "-show_entries",
                "frame=key_frame,best_effort_timestamp_time",
            ]
        )
    else:
        command.extend(["-show_streams", "-show_format"])
    command.extend(["-of", "json", str(path)])
    try:
        value = json.loads(run(command).stdout)
    except json.JSONDecodeError as error:
        raise GateInvalid("ffprobe returned invalid data") from error
    if not isinstance(value, dict):
        raise GateInvalid("ffprobe returned invalid data")
    return value


def video_stream(probe_data: dict[str, Any]) -> dict[str, Any]:
    streams = probe_data.get("streams")
    if (
        not isinstance(streams, list)
        or len(streams) != 1
        or not isinstance(streams[0], dict)
    ):
        raise GateInvalid("expected one video stream")
    return streams[0]


def timeline_metrics(
    frames_probe: dict[str, Any],
) -> tuple[list[float], float, int, int]:
    raw_frames = frames_probe.get("frames")
    if not isinstance(raw_frames, list) or not raw_frames:
        raise GateInvalid("video has no frame timestamps")

    timestamps: list[float] = []
    keyframes: list[int] = []
    for index, frame in enumerate(raw_frames):
        if not isinstance(frame, dict):
            raise GateInvalid("invalid frame data")
        timestamp = number(frame.get("best_effort_timestamp_time"), "frame timestamp")
        timestamps.append(timestamp)
        if int(frame.get("key_frame", 0)) == 1:
            keyframes.append(index)

    gaps = [current - previous for previous, current in zip(timestamps, timestamps[1:])]
    nonmonotonic = sum(gap <= 0 for gap in gaps)
    max_gap = max(gaps, default=0.0)
    if not keyframes or keyframes[0] != 0:
        max_gop = len(timestamps)
    else:
        distances = [right - left for left, right in zip(keyframes, keyframes[1:])]
        distances.append(len(timestamps) - keyframes[-1])
        max_gop = max(distances)
    return timestamps, max_gap, nonmonotonic, max_gop


def convert_i420_reference(source: Path, destination: Path, ffmpeg: str) -> None:
    """Use the calibrated BT.709 conversion; omitting it changes the metric."""
    run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "rawvideo",
            "-pixel_format",
            "yuv420p",
            "-video_size",
            f"{WIDTH}x{HEIGHT}",
            "-color_range",
            "tv",
            "-colorspace",
            "bt709",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-i",
            str(source),
            "-frames:v",
            "1",
            "-vf",
            "format=rgb24",
            "-c:v",
            "png",
            "-y",
            str(destination),
        ]
    )
    if not destination.is_file() or destination.stat().st_size == 0:
        raise GateInvalid("reference conversion produced no PNG")


def extract_frame_at_index(
    video: Path, index: int, destination: Path, ffmpeg: str
) -> None:
    if index < 0:
        raise GateInvalid("invalid reference frame")
    # Selecting by decoded index, not by a keyframe seek, keeps this at the
    # same PTS as the pre-x264 I420 probe.
    run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(video),
            "-vf",
            f"select=eq(n\\,{index})",
            "-vsync",
            "0",
            "-frames:v",
            "1",
            "-c:v",
            "png",
            "-y",
            str(destination),
        ]
    )
    if not destination.is_file() or destination.stat().st_size == 0:
        raise GateInvalid("comparison extraction produced no PNG")


def metric(reference: Path, candidate: Path, filter_name: str, ffmpeg: str) -> float:
    result = run(
        [
            ffmpeg,
            "-hide_banner",
            "-i",
            str(reference),
            "-i",
            str(candidate),
            "-lavfi",
            filter_name,
            "-frames:v",
            "1",
            "-f",
            "null",
            "-",
        ],
        allow_failure=True,
    )
    if result.returncode != 0:
        raise GateInvalid(f"{filter_name} comparison failed")
    pattern = r"All:([0-9.]+)" if filter_name == "ssim" else r"average:([0-9.]+|inf)"
    matches = re.findall(pattern, result.stderr)
    if not matches:
        raise GateInvalid(f"{filter_name} metric missing")
    return math.inf if matches[-1] == "inf" else float(matches[-1])


def normalize_ocr(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def levenshtein(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for left_index, left_character in enumerate(left, start=1):
        current = [left_index]
        for right_index, right_character in enumerate(right, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_character != right_character),
                )
            )
        previous = current
    return previous[-1]


def anchor_recalled(expected: str, observed: str) -> bool:
    expected_tokens = Counter(re.findall(r"\w+", expected, flags=re.UNICODE))
    observed_tokens = Counter(re.findall(r"\w+", observed, flags=re.UNICODE))
    return bool(expected_tokens) and all(
        observed_tokens[token] >= count for token, count in expected_tokens.items()
    )


def expected_token_span(expected: str, observed: str) -> str:
    """Drop crop noise before scoring the characters that identify an anchor.

    Native game crops can contain sprite detail around their text.  The
    qualified gate evaluates accuracy on the expected-token span after recall,
    not on unrelated garbage Tesseract emits at the crop edges.  Token order
    remains significant, so a scrambled label still loses character accuracy.
    """
    expected = normalize_ocr(expected)
    observed = normalize_ocr(observed)
    remaining = Counter(re.findall(r"\w+", expected, flags=re.UNICODE))
    retained: list[str] = []
    for token in re.findall(r"\w+", observed, flags=re.UNICODE):
        if remaining[token] > 0:
            retained.append(token)
            remaining[token] -= 1
    return " ".join(retained)


def crop(
    source: Path, anchor: tuple[str, int, int, int, int], output: Path, ffmpeg: str
) -> None:
    _text, x, y, width, height = anchor
    run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(source),
            "-vf",
            f"crop={width}:{height}:{x}:{y}",
            "-frames:v",
            "1",
            "-c:v",
            "png",
            "-y",
            str(output),
        ]
    )


def ocr(image: Path, tesseract: str, language: str) -> str:
    result = run(
        [tesseract, str(image), "stdout", "-l", language, "--psm", "6"],
        allow_failure=True,
    )
    if result.returncode != 0:
        raise GateInvalid("tesseract failed")
    return normalize_ocr(result.stdout)


def load_anchors(path: Path) -> list[tuple[str, int, int, int, int]]:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != G16_ANCHORS_SHA256:
        raise GateInvalid("anchors do not match the qualified G16-H set")

    anchors: list[tuple[str, int, int, int, int]] = []
    rectangles: set[tuple[int, int, int, int]] = set()
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) != 5:
            raise GateInvalid("invalid anchors")
        text = normalize_ocr(parts[0])
        try:
            x, y, width, height = (int(value) for value in parts[1:])
        except ValueError as error:
            raise GateInvalid("invalid anchors") from error
        if not text or x < 0 or y < 0 or width <= 0 or height <= 0:
            raise GateInvalid("invalid anchors")
        if x + width > WIDTH or y + height > HEIGHT:
            raise GateInvalid("anchor outside native frame")
        rectangle = (x, y, width, height)
        if rectangle in rectangles:
            raise GateInvalid("duplicate anchor rectangle")
        rectangles.add(rectangle)
        anchors.append((text, x, y, width, height))
    if len(anchors) != 10:
        raise GateInvalid("G16-H requires exactly ten anchors")
    return anchors


def mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise GateInvalid(f"invalid {label}")
    return value


def nonnegative_integer(value: Any) -> int:
    """Use malformed diagnostic values as a failed check, never a traceback."""
    return (
        value
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0
        else 0
    )


def sidecar_contract(
    sidecar: dict[str, Any], video: Path, reference: Path
) -> dict[str, Any]:
    recorder = mapping(sidecar.get("recorder"), "recorder sidecar")
    reference_data = mapping(sidecar.get("reference"), "reference sidecar")
    probes = sidecar.get("diagnostic_probes")
    if not isinstance(probes, list) or not probes:
        raise GateInvalid("missing diagnostic probes")

    source_buffers = 0
    fixed_i420_buffers = 0
    source_changes = 0
    for entry in probes:
        if not isinstance(entry, dict):
            continue
        seams = entry.get("seams")
        if not isinstance(seams, dict):
            continue
        source = seams.get("pipewiresrc")
        fixed_i420 = seams.get("videorate")
        if isinstance(source, dict):
            source_buffers = max(
                source_buffers, nonnegative_integer(source.get("buffers"))
            )
            source_changes = max(
                source_changes, nonnegative_integer(source.get("content_changes"))
            )
        if isinstance(fixed_i420, dict):
            fixed_i420_buffers = max(
                fixed_i420_buffers, nonnegative_integer(fixed_i420.get("buffers"))
            )

    expected_reference_bytes = WIDTH * HEIGHT * 3 // 2
    portal_stream = recorder.get("portal_stream")
    portal_properties = (
        portal_stream.get("properties") if isinstance(portal_stream, dict) else None
    )
    portal_node_id = (
        portal_stream.get("node_id") if isinstance(portal_stream, dict) else None
    )
    return {
        "geometry": sidecar.get("width") == WIDTH
        and sidecar.get("height") == HEIGHT
        and sidecar.get("fps") == FPS,
        "recorder": recorder.get("codec") == "H.264 High/Matroska"
        and recorder.get("source_type") == "window"
        and recorder.get("cursor_mode") == "hidden"
        and recorder.get("rate_control") == "videorate CFR"
        and recorder.get("keyframe_max_distance") == MAX_GOP_FRAMES
        and recorder.get("threads") == 8
        and recorder.get("eos_timeout_seconds") == MAX_EOS_SECONDS
        and recorder.get("scaling") == "disabled"
        and recorder.get("profile") == "High"
        and recorder.get("rate_control_mode") == "CRF 4"
        and recorder.get("speed_preset") == "veryfast"
        and recorder.get("maxrate_bps") == 20_000_000
        and recorder.get("bufsize_bits") == 40_000_000
        and recorder.get("min_keyframe_distance") == MAX_GOP_FRAMES
        and recorder.get("scene_cut") == 0
        and recorder.get("container") == "Matroska",
        "portal_provenance": recorder.get("implementation")
        == "xdg-desktop-portal window + PipeWire/GStreamer"
        and "provider" not in recorder
        and "mutter_stream" not in recorder
        and isinstance(portal_node_id, int)
        and not isinstance(portal_node_id, bool)
        and portal_node_id > 0
        and isinstance(portal_properties, dict)
        and portal_properties.get("source_type") == 2
        and portal_properties.get("size") == [WIDTH, HEIGHT],
        "reference": reference_data.get("format") == "I420"
        and reference_data.get("width") == WIDTH
        and reference_data.get("height") == HEIGHT
        and reference_data.get("bytes") == expected_reference_bytes
        and reference_data.get("stage") == "pre-x264"
        and reference_data.get("sha256")
        == hashlib.sha256(reference.read_bytes()).hexdigest(),
        "reference_seconds": number(
            reference_data.get("reference_video_seconds"), "reference timestamp"
        ),
        "reference_pts_seconds": number(
            reference_data.get("reference_pts_ns"), "reference PTS"
        )
        / 1_000_000_000,
        "eos": number(sidecar.get("eos_duration_seconds"), "EOS duration"),
        "video_bytes": sidecar.get("video_bytes") == video.stat().st_size,
        "source_buffers": source_buffers,
        "fixed_i420_buffers": fixed_i420_buffers,
        "source_changes": source_changes,
    }


def manifest_contract(manifest: dict[str, Any]) -> dict[str, Any]:
    format_data = mapping(manifest.get("format"), "manifest format")
    recorder = mapping(manifest.get("recorder"), "manifest recorder")
    quality = mapping(manifest.get("quality_gate"), "manifest quality gate")
    return {
        "focus": manifest.get("focus_id") == "G16-H",
        "format": format_data.get("width") == WIDTH
        and format_data.get("height") == HEIGHT
        and format_data.get("fps") == FPS
        and format_data.get("scaling") == "disabled",
        "recorder": recorder.get("container") == "matroska"
        and recorder.get("codec") == "h264"
        and recorder.get("profile") == "High"
        and recorder.get("pixel_format") == "yuv420p"
        and recorder.get("crf") == 4
        and recorder.get("preset") == "veryfast"
        and recorder.get("maxrate_kbps") == 20_000
        and recorder.get("bufsize_kbits") == 40_000
        and recorder.get("gop") == MAX_GOP_FRAMES
        and recorder.get("source_type") == "window"
        and recorder.get("cursor_mode") == "hidden"
        and recorder.get("keepalive_ms") == 33,
        # A legacy a05 manifest recorded the generic static threshold.  The
        # post-refactor dynamic verifier itself always applies 0.9955, and a
        # manifest may choose a stricter threshold but never a weaker one.
        "quality": number(quality.get("ssim_min"), "manifest SSIM")
        >= G16_DYNAMIC_SSIM_MIN
        and number(quality.get("psnr_min_db"), "manifest PSNR") >= PSNR_MIN_DB
        and number(quality.get("ocr_recall"), "manifest OCR recall") >= OCR_RECALL_MIN
        and number(quality.get("ocr_accuracy_min"), "manifest OCR accuracy")
        >= OCR_ACCURACY_MIN
        and number(quality.get("eos_seconds_max"), "manifest EOS") <= MAX_EOS_SECONDS
        and quality.get("anchors_min") == 10,
    }


def controller_timing(controller: dict[str, Any]) -> dict[str, float | int]:
    reference_key = (
        "reference_requested_seconds_after_ready"
        if "reference_requested_seconds_after_ready" in controller
        else "reference_seconds_after_ready"
    )
    values = {
        "input": number(
            controller.get("input_requested_seconds_after_ready"),
            "controller input timing",
        ),
        "reference": number(
            controller.get(reference_key), "controller reference timing"
        ),
        "stop": number(
            controller.get("stop_seconds_after_ready"), "controller stop timing"
        ),
        "stop_count": controller.get("stop_count"),
    }
    if values["stop_count"] != 1:
        raise GateInvalid("controller did not issue exactly one stop")
    return {key: value for key, value in values.items() if value is not None}


def lifecycle_contract(log: Path) -> bool:
    try:
        tokens = [
            line.split(maxsplit=1)[0]
            for line in log.read_text(encoding="utf-8", errors="replace").splitlines()
            if line
        ]
    except OSError as error:
        raise GateInvalid("invalid recorder log") from error
    return (
        tokens.count("READY") == 1
        and tokens.count("REFERENCE") == 1
        and tokens.count("STOPPED") == 1
        and "ERROR" not in tokens
    )


def write_report(path: Path, report: dict[str, Any]) -> None:
    destination = path.expanduser().resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    temporary.replace(destination)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("--reference-i420", required=True, type=Path)
    parser.add_argument("--anchors", required=True, type=Path)
    parser.add_argument("--sidecar", required=True, type=Path)
    parser.add_argument("--controller", required=True, type=Path)
    parser.add_argument("--recorder-log", required=True, type=Path)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    parser.add_argument("--tesseract", default="tesseract")
    parser.add_argument("--ocr-lang", default="eng")
    args = parser.parse_args(argv)

    checks: list[dict[str, Any]] = []
    report: dict[str, Any] = {
        "contract": "g16-h-dynamic-recorder-v1",
        "status": "INVALID",
        "checks": checks,
    }
    exit_code = 2
    try:
        video = require_file(args.video, "video")
        reference_i420 = require_file(args.reference_i420, "I420 reference")
        anchors_path = require_file(args.anchors, "anchors")
        sidecar = load_json(require_file(args.sidecar, "sidecar"), "recorder sidecar")
        controller = load_controller(require_file(args.controller, "controller"))
        recorder_log = require_file(args.recorder_log, "recorder log")
        manifest = load_json(require_file(args.manifest, "manifest"), "manifest")
        anchors = load_anchors(anchors_path)

        sidecar_checks = sidecar_contract(sidecar, video, reference_i420)
        manifest_checks = manifest_contract(manifest)
        add_check(checks, "sidecar_geometry", bool(sidecar_checks["geometry"]))
        add_check(checks, "portal_window_surface", bool(sidecar_checks["recorder"]))
        add_check(
            checks, "portal_provenance", bool(sidecar_checks["portal_provenance"])
        )
        add_check(checks, "pre_x264_i420_reference", bool(sidecar_checks["reference"]))
        add_check(
            checks,
            "diagnostic_buffers",
            sidecar_checks["source_buffers"] > 0
            and sidecar_checks["fixed_i420_buffers"] > 0,
            pipewiresrc_buffers=sidecar_checks["source_buffers"],
            videorate_buffers=sidecar_checks["fixed_i420_buffers"],
        )
        add_check(
            checks,
            "dynamic_source",
            sidecar_checks["source_changes"] > 0,
            content_changes=sidecar_checks["source_changes"],
        )
        add_check(
            checks,
            "eos",
            sidecar_checks["eos"] <= MAX_EOS_SECONDS,
            seconds=round(sidecar_checks["eos"], 6),
            maximum=MAX_EOS_SECONDS,
        )
        add_check(checks, "sidecar_video_bytes", bool(sidecar_checks["video_bytes"]))
        add_check(checks, "manifest_focus", bool(manifest_checks["focus"]))
        add_check(checks, "manifest_format", bool(manifest_checks["format"]))
        add_check(checks, "manifest_recorder", bool(manifest_checks["recorder"]))
        add_check(checks, "manifest_quality_gate", bool(manifest_checks["quality"]))
        add_check(checks, "recorder_lifecycle", lifecycle_contract(recorder_log))

        timing = controller_timing(controller)
        timing_ok = (
            abs(float(timing["input"]) - 2.0) <= TIMING_TOLERANCE_SECONDS
            and abs(float(timing["reference"]) - 5.0) <= TIMING_TOLERANCE_SECONDS
            and abs(float(timing["stop"]) - 9.0) <= TIMING_TOLERANCE_SECONDS
        )
        add_check(
            checks,
            "controller_timing",
            timing_ok,
            input_after_ready=round(float(timing["input"]), 6),
            reference_after_ready=round(float(timing["reference"]), 6),
            stop_after_ready=round(float(timing["stop"]), 6),
            stop_count=1,
        )

        video_probe = probe(video, args.ffprobe)
        stream = video_stream(video_probe)
        format_data = video_probe.get("format")
        if not isinstance(format_data, dict):
            raise GateInvalid("missing video format")
        duration = number(format_data.get("duration"), "video duration")
        add_check(
            checks,
            "duration",
            MIN_DURATION_SECONDS <= duration <= MAX_DURATION_SECONDS,
            seconds=round(duration, 6),
            minimum=MIN_DURATION_SECONDS,
            maximum=MAX_DURATION_SECONDS,
        )
        add_check(
            checks,
            "video_format",
            stream.get("codec_name") == "h264"
            and str(stream.get("profile", "")).lower() == "high"
            and stream.get("pix_fmt") == "yuv420p"
            and "matroska" in str(format_data.get("format_name", "")),
        )
        add_check(
            checks,
            "native_cfr30",
            stream.get("width") == WIDTH
            and stream.get("height") == HEIGHT
            and parse_rate(stream.get("r_frame_rate")) == FPS
            and parse_rate(stream.get("avg_frame_rate")) == FPS,
        )
        decode = run(
            [
                args.ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-xerror",
                "-i",
                str(video),
                "-map",
                "0:v:0",
                "-f",
                "null",
                "-",
            ],
            allow_failure=True,
        )
        add_check(checks, "decode", decode.returncode == 0, exit_code=decode.returncode)

        timestamps, max_gap, nonmonotonic, max_gop = timeline_metrics(
            probe(video, args.ffprobe, frames=True)
        )
        add_check(checks, "pts_monotonic", nonmonotonic == 0, nonmonotonic=nonmonotonic)
        add_check(
            checks,
            "pts_gap",
            max_gap <= MAX_PTS_GAP_SECONDS,
            seconds=round(max_gap, 6),
            maximum=MAX_PTS_GAP_SECONDS,
        )
        add_check(
            checks,
            "gop",
            max_gop <= MAX_GOP_FRAMES,
            frames=max_gop,
            maximum=MAX_GOP_FRAMES,
        )

        reference_seconds = float(sidecar_checks["reference_seconds"])
        reference_pts_seconds = float(sidecar_checks["reference_pts_seconds"])
        closest_index, closest_timestamp = min(
            enumerate(timestamps), key=lambda entry: abs(entry[1] - reference_seconds)
        )
        reference_alignment = (
            abs(reference_seconds - reference_pts_seconds) <= 1e-6
            and abs(closest_timestamp - reference_seconds) <= (1 / FPS)
            and 0 <= reference_seconds < duration
        )
        add_check(
            checks,
            "reference_same_pts",
            reference_alignment,
            seconds=round(reference_seconds, 9),
            candidate_seconds=round(closest_timestamp, 9),
        )

        with tempfile.TemporaryDirectory(prefix="jht-g16-h-regression-") as temporary:
            work = Path(temporary)
            reference_png = work / "reference.png"
            candidate_png = work / "candidate.png"
            convert_i420_reference(reference_i420, reference_png, args.ffmpeg)
            reference_stream = video_stream(probe(reference_png, args.ffprobe))
            add_check(
                checks,
                "reference_png_color",
                reference_stream.get("pix_fmt") == "rgb24"
                and reference_stream.get("color_range") == "pc"
                and reference_stream.get("color_space") == "gbr"
                and reference_stream.get("color_primaries") == "bt709"
                and reference_stream.get("color_transfer") == "bt709",
            )
            extract_frame_at_index(video, closest_index, candidate_png, args.ffmpeg)
            ssim = metric(reference_png, candidate_png, "ssim", args.ffmpeg)
            psnr = metric(reference_png, candidate_png, "psnr", args.ffmpeg)
            add_check(
                checks,
                "ssim",
                ssim >= G16_DYNAMIC_SSIM_MIN,
                value=round(ssim, 6),
                minimum=G16_DYNAMIC_SSIM_MIN,
            )
            add_check(
                checks,
                "psnr",
                psnr >= PSNR_MIN_DB,
                db="inf" if math.isinf(psnr) else round(psnr, 6),
                minimum_db=PSNR_MIN_DB,
            )

            reference_recalled = 0
            candidate_recalled = 0
            candidate_distance = 0
            expected_characters = 0
            for index, anchor in enumerate(anchors):
                expected, *_coordinates = anchor
                reference_crop = work / f"reference-{index}.png"
                candidate_crop = work / f"candidate-{index}.png"
                crop(reference_png, anchor, reference_crop, args.ffmpeg)
                crop(candidate_png, anchor, candidate_crop, args.ffmpeg)
                reference_text = ocr(reference_crop, args.tesseract, args.ocr_lang)
                candidate_text = ocr(candidate_crop, args.tesseract, args.ocr_lang)
                reference_recalled += anchor_recalled(expected, reference_text)
                candidate_recalled += anchor_recalled(expected, candidate_text)
                candidate_distance += levenshtein(
                    expected, expected_token_span(expected, candidate_text)
                )
                expected_characters += len(expected)

            if expected_characters == 0:
                raise GateInvalid("empty anchors")
            reference_recall = reference_recalled / len(anchors)
            candidate_recall = candidate_recalled / len(anchors)
            accuracy = max(0.0, 1.0 - candidate_distance / expected_characters)
            add_check(
                checks,
                "reference_ocr_recall",
                reference_recall >= OCR_RECALL_MIN,
                value=round(reference_recall, 6),
                minimum=OCR_RECALL_MIN,
                anchors=len(anchors),
            )
            add_check(
                checks,
                "frame_ocr_recall",
                candidate_recall >= OCR_RECALL_MIN,
                value=round(candidate_recall, 6),
                minimum=OCR_RECALL_MIN,
                anchors=len(anchors),
            )
            add_check(
                checks,
                "ocr_accuracy",
                accuracy >= OCR_ACCURACY_MIN,
                value=round(accuracy, 6),
                minimum=OCR_ACCURACY_MIN,
            )

        passed = all(check["status"] == "PASS" for check in checks)
        report["status"] = "PASS" if passed else "FAIL"
        exit_code = 0 if passed else 1
    except GateInvalid as error:
        report["invalid_reason"] = str(error)
    finally:
        write_report(args.report, report)

    print(f"{report['status']}: {args.report.name}")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
