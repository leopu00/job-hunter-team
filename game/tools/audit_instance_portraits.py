#!/usr/bin/env python3
"""Verifica il contratto dei ritratti per istanza usati dalla chat."""

from __future__ import annotations

import hashlib
from pathlib import Path
import sys

# Un cancello che non puo' girare NON e' un cancello verde: il 21/09 questo
# audit era rosso in locale su dieci file e muto in CI, perche' senza Pillow
# usciva 0 dicendo "SKIP". Ora fallisce chiuso, e la CI installa Pillow: se
# manca, il rosso dice cosa installare invece di nascondere cosa manca.
try:
    from PIL import Image
except ModuleNotFoundError:
    print(
        "FAIL: Pillow non e' installato, quindi questo audit non puo' girare.\n"
        "  - installalo con `python3 -m pip install Pillow` (in CI lo fa il workflow)\n"
        "  - un audit che non gira non prova niente: qui e' rosso, non saltato",
        file=sys.stderr,
    )
    raise SystemExit(1)


ROLES = ("scout", "analista", "scorer", "scrittore", "critico")
EMOTIONS = ("neutro", "pensieroso")
# Il ruolo porta anche l'espressione che le cartelle d'istanza del lead non
# avevano, ed e' la ragione per cui quelle cartelle sono state tolte.
ROLE_EMOTIONS = ("neutro", "pensieroso", "caldo")
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
        lead = LEAD_INSTANCE[role]
        for number in range(1, 7):
            # Il ritratto d'istanza del LEAD non esiste per scelta (78a8a0e07,
            # 17/08): era una copia byte-identica di quello di ruolo e, avendo
            # solo due espressioni, impediva il fallback su full_caldo.
            # ComicChat.portrait_slug() ripiega sul ruolo, che li' e' la
            # risposta giusta. Chi lo ricreasse tornerebbe a quel difetto.
            instance_dir = root / f"{role}-{number}"
            if number == lead:
                if instance_dir.is_dir():
                    failed += 1
                    print(
                        f"FAIL {instance_dir}: e' la postazione del lead, che ripiega sul "
                        f"ritratto di ruolo {root / role} — questa cartella e' stata rimossa "
                        "apposta il 17/08 (78a8a0e07) perche' copriva le espressioni in piu'"
                    )
                continue
            for emotion in EMOTIONS:
                checked += 1
                path = instance_dir / f"full_{emotion}.png"
                errors = audit_portrait(path)
                if errors:
                    failed += 1
                    print(f"FAIL {path}")
                    for error in errors:
                        print(f"  - {error}")

        # La cartella di ruolo e' cio' su cui il lead ripiega: deve portare le
        # espressioni che la chat usa, comprese quelle che l'istanza non aveva.
        for emotion in ROLE_EMOTIONS:
            checked += 1
            path = root / role / f"full_{emotion}.png"
            errors = audit_portrait(path)
            if errors:
                failed += 1
                print(f"FAIL {path} (ritratto di ruolo, il lead ripiega qui)")
                for error in errors:
                    print(f"  - {error}")

    if failed:
        print(f"\n{checked} ritratti controllati, {failed} errori")
        return 1
    print(
        f"PASS: {checked} ritratti controllati (istanze dei worker + ritratto di ruolo), "
        "formato/alpha/import corretti e nessuna cartella d'istanza per i lead"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
