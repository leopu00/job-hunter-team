#!/usr/bin/env python3
"""Verifica il contratto dei ritratti per istanza usati dalla chat."""

from __future__ import annotations

import hashlib
from pathlib import Path
import sys

from PIL import Image


ROLES = ("scout", "analista", "scorer", "scrittore", "critico")
EMOTIONS = ("neutro", "pensieroso")
LEAD_INSTANCE = {
    "scout": 2,
    "analista": 2,
    "scorer": 2,
    "scrittore": 2,
    "critico": 1,
}
EXPECTED_SIZE = (1120, 1520)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def audit_portrait(path: Path) -> list[str]:
    errors: list[str] = []
    if not path.is_file():
        return ["file mancante"]
    if not Path(f"{path}.import").is_file():
        errors.append("import Godot mancante")

    with Image.open(path) as image:
        if image.size != EXPECTED_SIZE:
            errors.append(f"canvas {image.size}, atteso {EXPECTED_SIZE}")
        if image.mode != "RGBA":
            errors.append(f"modo {image.mode}, atteso RGBA")
            return errors
        alpha = image.getchannel("A")
        extrema = alpha.getextrema()
        if extrema != (0, 255):
            errors.append(f"alpha incompleto {extrema}, atteso (0, 255)")
        width, height = image.size
        # Il crop approvato puo' far uscire il busto dai due angoli inferiori
        # (per esempio il trench dello Scout). Gli angoli superiori, invece,
        # devono sempre appartenere allo sfondo rimosso.
        top_corners = (
            alpha.getpixel((0, 0)),
            alpha.getpixel((width - 1, 0)),
        )
        if any(value != 0 for value in top_corners):
            errors.append(f"angoli superiori non trasparenti: {top_corners}")
    return errors


def main() -> int:
    game_dir = Path(__file__).resolve().parents[1]
    root = game_dir / "assets/gen-art/portraits"
    failed = 0
    checked = 0

    for role in ROLES:
        for number in range(1, 7):
            for emotion in EMOTIONS:
                checked += 1
                path = root / f"{role}-{number}" / f"full_{emotion}.png"
                errors = audit_portrait(path)
                if errors:
                    failed += 1
                    print(f"FAIL {path}")
                    for error in errors:
                        print(f"  - {error}")

        lead = LEAD_INSTANCE[role]
        for emotion in EMOTIONS:
            generic = root / role / f"full_{emotion}.png"
            instance = root / f"{role}-{lead}" / f"full_{emotion}.png"
            if generic.is_file() and instance.is_file() and digest(generic) != digest(instance):
                failed += 1
                print(
                    f"FAIL {instance}: la variante a non coincide con il ritratto "
                    f"principale {generic}"
                )

    if failed:
        print(f"\n{checked} ritratti controllati, {failed} errori")
        return 1
    print(f"PASS: {checked} ritratti per istanza, formato/alpha/import/lead corretti")
    return 0


if __name__ == "__main__":
    sys.exit(main())
