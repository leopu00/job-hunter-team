#!/usr/bin/env python3
"""Fail closed if the tagged desktop artifact loses its title contract gate."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github/workflows/release.yml"
PUBLISH_WORKFLOW = ROOT / ".github/workflows/publish-signed-release.yml"
GAME_WORKFLOW = ROOT / ".github/workflows/game.yml"
POSIX_RUNNER = ROOT / "game/tools/run.sh"
WINDOWS_RUNNER = ROOT / "game/tools/run.ps1"


def contract_failures(
    source: str,
    publish_source: str,
    game_source: str,
    posix_runner: str,
    windows_runner: str,
) -> list[str]:
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
    publish_required = (
        "Verify offline signature and immutable source",
        "Decode and verify detached signature before publication",
        "Build installer from signed authority",
        "Build and smoke-test installer containing exact signed authority",
        "./scripts/build-windows-installer.ps1 -Version $version",
        "job-hunter-team-windows-x64-setup.exe",
    )
    missing.extend(
        f"signed publish workflow: {token}"
        for token in publish_required
        if token not in publish_source
    )
    if game_source.count('- ".github/workflows/release.yml"') != 2:
        missing.append("game workflow push+PR paths for release.yml")
    if '[ "$platform" = "windows" ]' not in posix_runner:
        missing.append("POSIX runner must skip platform=windows")
    if 'if ($T.Platform -eq "posix")' not in windows_runner:
        missing.append("Windows runner must skip only platform=posix")
    if 'if ($T.Platform -eq "windows")' in windows_runner:
        missing.append("Windows runner must execute platform=windows")

    if not missing:
        gate_at = source.index(gate)
        before_gate = (
            "- name: Sign, notarize and staple macOS game",
            "- name: Preserve Linux executable permissions",
            "- name: Preserve Windows portable artifact",
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

        # release.yml produces portable/title/provenance only. The installer
        # is deliberately downstream of the independently verified signature.
        if "build-windows-installer.ps1" in source:
            missing.append("unsigned Release workflow must not build installer")
        authorize = "Decode and verify detached signature before publication"
        installer = "Build and smoke-test installer containing exact signed authority"
        if authorize in publish_source and installer in publish_source:
            if publish_source.index(authorize) > publish_source.index(installer):
                missing.append("signed authority verification must precede installer build")
    return missing


def main() -> int:
    source = WORKFLOW.read_text(encoding="utf-8")
    publish_source = PUBLISH_WORKFLOW.read_text(encoding="utf-8")
    game_source = GAME_WORKFLOW.read_text(encoding="utf-8")
    posix_runner = POSIX_RUNNER.read_text(encoding="utf-8")
    windows_runner = WINDOWS_RUNNER.read_text(encoding="utf-8")
    missing = contract_failures(
        source, publish_source, game_source, posix_runner, windows_runner
    )

    if missing:
        for item in missing:
            print(f"TITLE-ARTIFACT-CONTRACT-TEST missing: {item}")
        return 1

    print("TITLE-ARTIFACT-CONTRACT-TEST PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
