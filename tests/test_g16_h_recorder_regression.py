"""Contract tests for the read-only G16-H recorder regression verifier."""

from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
HARNESS = REPO_ROOT / "scripts" / "g16-h-recorder-regression.py"
WRAPPER = REPO_ROOT / "scripts" / "run-g16-h-recorder-regression.sh"
ANCHORS = """# text<TAB>x<TAB>y<TAB>width<TAB>height; native 1:1 ROI, no upscale.
SETUP\t790\t55\t120\t45
2 4\t925\t55\t75\t45
COMPLETATO\t940\t55\t155\t45
TEAM JHT\t1635\t35\t190\t42
POSIZIONI OGGI\t1635\t67\t200\t40
5\t1825\t67\t60\t40
SCORE MEDIO\t1635\t96\t200\t40
72\t1825\t96\t60\t40
SCORER\t1400\t745\t190\t75
CANDIDATURE\t1550\t745\t300\t75
"""


def load_harness():
    spec = importlib.util.spec_from_file_location("g16_h_recorder_regression", HARNESS)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load G16-H regression harness")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def harness():
    return load_harness()


def valid_recorder_sidecar(harness, reference: Path, video: Path):
    return {
        "width": harness.WIDTH,
        "height": harness.HEIGHT,
        "fps": harness.FPS,
        "eos_duration_seconds": 0.5,
        "video_bytes": video.stat().st_size,
        "diagnostic_probes": [
            {
                "seams": {
                    "pipewiresrc": {"buffers": 10, "content_changes": 8},
                    "videorate": {"buffers": 10, "content_changes": 8},
                }
            }
        ],
        "reference": {
            "format": "I420",
            "width": harness.WIDTH,
            "height": harness.HEIGHT,
            "bytes": harness.WIDTH * harness.HEIGHT * 3 // 2,
            "stage": "pre-x264",
            "sha256": hashlib.sha256(reference.read_bytes()).hexdigest(),
            "reference_video_seconds": 5.0,
            "reference_pts_ns": 5_000_000_000,
        },
        "recorder": {
            "codec": "H.264 High/Matroska",
            "source_type": "window",
            "cursor_mode": "hidden",
            "rate_control": "videorate CFR",
            "keyframe_max_distance": 60,
            "threads": 8,
            "eos_timeout_seconds": 15,
            "scaling": "disabled",
            "profile": "High",
            "rate_control_mode": "CRF 4",
            "speed_preset": "veryfast",
            "maxrate_bps": 20_000_000,
            "bufsize_bits": 40_000_000,
            "min_keyframe_distance": 60,
            "scene_cut": 0,
            "container": "Matroska",
        },
    }


def valid_manifest():
    return {
        "focus_id": "G16-H",
        "format": {"width": 1920, "height": 1080, "fps": 30, "scaling": "disabled"},
        "recorder": {
            "container": "matroska",
            "codec": "h264",
            "profile": "High",
            "pixel_format": "yuv420p",
            "crf": 4,
            "preset": "veryfast",
            "maxrate_kbps": 20_000,
            "bufsize_kbits": 40_000,
            "gop": 60,
            "source_type": "window",
            "cursor_mode": "hidden",
            "keepalive_ms": 33,
        },
        "quality_gate": {
            "ssim_min": 0.9955,
            "psnr_min_db": 46.5,
            "ocr_recall": 1.0,
            "ocr_accuracy_min": 0.99,
            "eos_seconds_max": 15,
            "anchors_min": 10,
        },
    }


def test_qualified_anchor_file_is_pinned_and_noise_does_not_lower_ocr_accuracy(
    harness, tmp_path
):
    anchors = tmp_path / "anchors.txt"
    anchors.write_text(ANCHORS, encoding="utf-8")

    loaded = harness.load_anchors(anchors)

    assert len(loaded) == 10
    assert (
        harness.expected_token_span("posizioni oggi", "sprite POSIZIONI oggi noise")
        == "posizioni oggi"
    )
    anchors.write_text(ANCHORS.replace("CANDIDATURE", "CANDIDATE"), encoding="utf-8")
    with pytest.raises(harness.GateInvalid, match="qualified G16-H"):
        harness.load_anchors(anchors)


def test_window_i420_sidecar_fails_when_the_surface_or_reference_stage_drifts(
    harness, tmp_path
):
    video = tmp_path / "take.mkv"
    video.write_bytes(b"qualified-test-video")
    reference = tmp_path / "reference.i420"
    reference.write_bytes(b"\0" * (harness.WIDTH * harness.HEIGHT * 3 // 2))
    sidecar = valid_recorder_sidecar(harness, reference, video)

    checks = harness.sidecar_contract(sidecar, video, reference)

    assert checks["recorder"]
    assert checks["reference"]
    assert checks["source_buffers"] == 10
    wrong_surface = copy.deepcopy(sidecar)
    wrong_surface["recorder"]["source_type"] = "display"
    assert not harness.sidecar_contract(wrong_surface, video, reference)["recorder"]
    wrong_stage = copy.deepcopy(sidecar)
    wrong_stage["reference"]["stage"] = "post-x264"
    assert not harness.sidecar_contract(wrong_stage, video, reference)["reference"]


def test_dynamic_manifest_and_controller_keep_the_qualified_numerical_schedule(
    harness, tmp_path
):
    manifest = valid_manifest()

    checks = harness.manifest_contract(manifest)

    assert all(checks.values())
    weak_ssim = copy.deepcopy(manifest)
    weak_ssim["quality_gate"]["ssim_min"] = 0.9954
    assert not harness.manifest_contract(weak_ssim)["quality"]

    controller = tmp_path / "controller.log"
    controller_evidence = {
        "input_requested_seconds_after_ready": 2.01,
        "reference_seconds_after_ready": 5.01,
        "stop_seconds_after_ready": 9.01,
        "stop_count": 1,
    }
    controller.write_text(
        "controller started\n" + json.dumps(controller_evidence) + "\n",
        encoding="utf-8",
    )
    timing = harness.controller_timing(harness.load_controller(controller))

    assert timing == {"input": 2.01, "reference": 5.01, "stop": 9.01, "stop_count": 1}
    controller.write_text(
        json.dumps({**controller_evidence, "stop_count": 2}), encoding="utf-8"
    )
    with pytest.raises(harness.GateInvalid, match="exactly one stop"):
        harness.controller_timing(harness.load_controller(controller))


def test_attempt_wrapper_discovers_one_closed_bundle_without_a_capture_path(tmp_path):
    attempt = tmp_path / "attempt-06"
    attempt.mkdir()
    basename = "rel-008-game-department-zoom-in-16x9-take01"
    for suffix in (
        ".mkv",
        ".reference.i420",
        ".anchors.txt",
        ".sidecar.json",
        ".controller.json",
        ".recorder.log",
        ".manifest.json",
    ):
        (attempt / f"{basename}{suffix}").write_text("fixture", encoding="utf-8")

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    arguments = tmp_path / "python-arguments.txt"
    fake_python = bin_dir / "python3"
    fake_python.write_text(
        "#!/usr/bin/env bash\n" 'printf \'%s\\n\' "$@" > "$JHT_WRAPPER_ARGUMENTS"\n',
        encoding="utf-8",
    )
    fake_python.chmod(0o755)
    result = subprocess.run(
        ["bash", str(WRAPPER), "--attempt-dir", str(attempt)],
        capture_output=True,
        text=True,
        check=False,
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "JHT_WRAPPER_ARGUMENTS": str(arguments),
        },
    )

    assert result.returncode == 0, result.stderr
    observed = arguments.read_text(encoding="utf-8")
    assert str(HARNESS) in observed
    assert "--report" in observed
    assert "portal-live" not in WRAPPER.read_text(encoding="utf-8")
    assert "mutter-node-live" not in WRAPPER.read_text(encoding="utf-8")
