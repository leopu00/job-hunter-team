#!/usr/bin/env python3
"""Static/canonical gate for the PowerShell singleton source embedded in PCK."""

from __future__ import annotations

import base64
import hashlib
import re
from pathlib import Path


GAME = Path(__file__).resolve().parents[1]
SOURCE = GAME / "scripts/support/windows_instance_guard.ps1"
CONSUMER = GAME / "scripts/support/windows_instance_guard.gd"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    raw = SOURCE.read_bytes()
    consumer = CONSUMER.read_text(encoding="utf-8")
    project = (GAME / "project.godot").read_text(encoding="utf-8")
    export = (GAME / "export_presets.cfg").read_text(encoding="utf-8")
    log = (GAME / "scripts/log.gd").read_text(encoding="utf-8")
    game = (GAME / "scripts/game.gd").read_text(encoding="utf-8")
    pck_gate = (GAME / "tools/windows_update_health_pck_test.ps1").read_text(
        encoding="utf-8")

    require(0 < len(raw) < 10_000, f"guard source size={len(raw)}")
    require(not raw.startswith(b"\xef\xbb\xbf"), "guard source has UTF-8 BOM")
    require(raw.endswith(b"\n") and b"\r" not in raw and b"\0" not in raw,
            "guard source is not LF/no-NUL canonical")
    require(all(byte < 128 for byte in raw), "guard source must remain ASCII/UTF-8")
    source = raw.decode("utf-8", errors="strict")
    digest = hashlib.sha256(raw).hexdigest()
    pins = re.findall(r'const SOURCE_SHA256 := "([0-9a-f]{64})"', consumer)
    require(pins == [digest], f"consumer pin mismatch: {pins} != {digest}")

    encoded = base64.b64encode(source.encode("utf-16le")).decode("ascii")
    require(base64.b64decode(encoded).decode("utf-16le") == source,
            "EncodedCommand round-trip changed source")
    powershell = "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
    args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded]
    argv_chars = len(powershell) + 1 + sum(len(arg) + 3 for arg in args)
    require(argv_chars < 30_000, f"modeled UTF-16 argv={argv_chars}")

    autoload = project.split("[autoload]", 1)[1].split("[", 1)[0]
    require(autoload.index("WindowsInstanceGuard=") < autoload.index("Log=")
            < autoload.index("Game="), "guard is not the first autoload")
    require(export.count("*scripts/support/windows_instance_guard.ps1") == 1,
            "Windows export must include exactly one canonical guard source")
    census = (f"bytes={len(raw)} argv_utf16={argv_chars} sha256={digest}")
    require(census in pck_gate and "source=exported-pck" in pck_gate,
            "post-export PCK census is not pinned to the canonical source")
    require("WindowsInstanceGuard.normal_work_allowed()" in log
            and "WindowsInstanceGuard.normal_work_allowed()" in game,
            "Log/Game do not fail closed behind the first autoload")

    required_consumer = [
        "FileAccess.get_file_as_bytes(SOURCE_PATH)",
        "HashingContext.HASH_SHA256",
        "Marshalls.raw_to_base64(utf16le)",
        '"-EncodedCommand", encoded',
        "OS.execute_with_pipe(powershell, args, false)",
        '(request + "\\n").to_utf8_buffer()',
        "OS.is_process_running(_guard_pid)",
        "HEARTBEAT_TIMEOUT_MSEC",
    ]
    for seam in required_consumer:
        require(seam in consumer, f"missing consumer seam: {seam}")
    require("ExecutionPolicy" not in consumer and "Bypass" not in consumer,
            "consumer must not override PowerShell policy")
    require("OS.create_process" not in consumer and '"-File"' not in consumer,
            "guard must run only from fixed in-memory EncodedCommand")

    required_source = [
        "Read-LineBounded", "ConvertFrom-Json", "input_canonical",
        "Security.AccessControl.MutexSecurity", ".WaitOne(0)",
        "Threading.AbandonedMutexException", "Assert-Mutex $Mutex $mutexAcl",
        "[Diagnostics.Process]::GetProcessById", "[void]$Desktop.Handle",
        "Write-New $ackPath $json $fileAcl", "[Console]::Out.WriteLine('ALIVE')",
        "request_binding", "request_squat",
    ]
    for seam in required_source:
        require(seam in source, f"missing source seam: {seam}")
    require(source.index("$Mutex.WaitOne(0)") < source.index("Write-New $ackPath"),
            "ACK can be written before mutex acquisition")
    for forbidden in ["Invoke-Expression", "iex ", "ExecutionPolicy", "Bypass",
                      "Start-Process", "-Command"]:
        require(forbidden not in source, f"forbidden guard seam: {forbidden}")

    print("WINDOWS-INSTANCE-GUARD-SELFTEST PASS"
          f" bytes={len(raw)} argv_utf16={argv_chars} sha256={digest}")


if __name__ == "__main__":
    main()
