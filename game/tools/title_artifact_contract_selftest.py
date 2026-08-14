#!/usr/bin/env python3
"""Fail closed if the tagged desktop artifact loses its title contract gate."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/release.yml"
GAME_WORKFLOW = ROOT / ".github/workflows/game.yml"


def contract_failures(source: str, game_source: str) -> list[str]:
    gate = "- name: Gate packaged title footer and version"
    required = (
        "EXPECTED_GAME_VERSION: ${{ github.ref_name }}",
        'expected_version="${EXPECTED_GAME_VERSION#v}"',
        'case "${{ runner.os }}" in',
        "job-hunter-team-windows-x64-portable.exe",
        "job-hunter-team-linux-x64.tar.gz",
        "job-hunter-team.zip",
        "JHT_LANGUAGE_PICKER_TEST=1",
        'JHT_EXPECTED_GAME_VERSION="$expected_version"',
        'test "$title_rc" -eq 0',
        'grep -Fx "LANGUAGE-PICKER-TITLE-VERSION v${expected_version}"',
        'grep -Fx "LANGUAGE-PICKER-TITLE-TEST PASS"',
        "bash game/tools/run.sh test gate",
        "./game/tools/run.ps1 test gate",
    )
    missing = [token for token in (gate, *required) if token not in source]
    if game_source.count('- ".github/workflows/release.yml"') != 2:
        missing.append("game workflow push+PR paths for release.yml")

    if not missing:
        gate_at = source.index(gate)
        before_gate = (
            "- name: Sign, notarize and staple macOS game",
            "- name: Preserve Linux executable permissions",
            "- name: Build and smoke-test Windows installer",
        )
        for step in before_gate:
            if step not in source:
                missing.append(step)
            elif source.index(step) > gate_at:
                missing.append(f"{step} must precede artifact title gate")
        provenance = "- name: Record immutable build identity"
        if provenance not in source:
            missing.append(provenance)
        elif source.index(provenance) < gate_at:
            missing.append("artifact title gate must precede provenance recording")
    return missing


def main() -> int:
    source = WORKFLOW.read_text(encoding="utf-8")
    game_source = GAME_WORKFLOW.read_text(encoding="utf-8")
    missing = contract_failures(source, game_source)

    if missing:
        for item in missing:
            print(f"TITLE-ARTIFACT-CONTRACT-TEST missing: {item}")
        return 1

    print("TITLE-ARTIFACT-CONTRACT-TEST PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
