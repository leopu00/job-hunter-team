#!/usr/bin/env python3
"""Audit statico del contratto grafico degli agenti in-world.

Controlla i fogli principali 6x12 descritti in docs/SPRITES.md. L'audit non
modifica gli asset: segnala celle vuote/occupate per errore, figure tagliate ai
bordi, piedi fuori ancoraggio, frammenti staccati e frame molto piu' larghi dei
vicini (sintomo tipico di due sagome sovrapposte nello stesso frame).
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from statistics import median
import sys

# Pillow non è installato ovunque: il runner Windows della CI non ce l'ha, e
# un audit che *non può* girare non è un audit fallito — è un audit assente.
# Facendolo cadere come errore, il 2026-07-30 ha bloccato una release per una
# libreria mancante invece che per un asset sbagliato. Esce 0 dicendo perché,
# e i due leg che Pillow ce l'hanno continuano a controllare davvero.
try:
    from PIL import Image
except ModuleNotFoundError:
    print("SKIP: Pillow non disponibile su questa macchina — audit non eseguito")
    raise SystemExit(0)


CELL_W = 256
CELL_H = 384
COLS = 6
ROWS = 12
FEET_Y = 360
USED_PER_ROW = (2, 2, 2, 6, 6, 6, 4, 4, 4, 6, 6, 6)
ALPHA_THRESHOLD = 24
WALK_ROWS = frozenset((3, 4, 5))
MIN_FRAGMENT_ROWS = 18
MIN_FRAGMENT_GAP = 8


@dataclass(frozen=True)
class Bounds:
    left: int
    top: int
    right: int
    bottom: int
    area: int

    @property
    def width(self) -> int:
        return self.right - self.left + 1


def alpha_bounds(alpha: Image.Image) -> Bounds | None:
    mask = alpha.point(lambda value: 255 if value > ALPHA_THRESHOLD else 0)
    box = mask.getbbox()
    if box is None:
        return None
    left, top, right, bottom = box
    return Bounds(left, top, right - 1, bottom - 1, mask.histogram()[255])


def occupied_row_segments(alpha: Image.Image) -> list[tuple[int, int]]:
    """Restituisce le bande verticali realmente occupate nella cella.

    La riduzione BOX calcola in C la densita' alpha di ogni riga. Ignorare le
    righe con meno di tre pixel opachi evita che un singolo residuo di matte
    spezzi la sagoma; una seconda banda alta e separata resta invece il segno
    misurabile di scarpe/teste fantasma montate nella stessa cella.
    """
    mask = alpha.point(lambda value: 255 if value > ALPHA_THRESHOLD else 0)
    profile = mask.resize((1, CELL_H), Image.Resampling.BOX)
    values = list(profile.tobytes())
    segments: list[tuple[int, int]] = []
    start: int | None = None
    for row, value in enumerate(values + [0]):
        occupied = value >= 3
        if occupied and start is None:
            start = row
        elif not occupied and start is not None:
            segments.append((start, row))
            start = None
    return segments


def audit_sheet(path: Path, *, strict_unused: bool = False) -> list[str]:
    errors: list[str] = []
    image = Image.open(path).convert("RGBA")
    if image.size != (COLS * CELL_W, ROWS * CELL_H):
        return [f"canvas {image.size[0]}x{image.size[1]}, atteso 1536x4608"]

    alpha = image.getchannel("A")
    row_bounds: list[list[Bounds]] = []

    for row, used_cols in enumerate(USED_PER_ROW):
        current: list[Bounds] = []
        for col in range(COLS):
            cell = alpha.crop(
                (
                    col * CELL_W,
                    row * CELL_H,
                    (col + 1) * CELL_W,
                    (row + 1) * CELL_H,
                )
            )
            bounds = alpha_bounds(cell)
            label = f"r{row:02d}c{col}"
            if col >= used_cols:
                if strict_unused and bounds is not None:
                    errors.append(f"{label}: cella inutilizzata non vuota")
                continue
            if bounds is None:
                errors.append(f"{label}: cella richiesta vuota")
                continue

            current.append(bounds)
            touched: list[str] = []
            if bounds.left == 0:
                touched.append("sinistra")
            if bounds.right == CELL_W - 1:
                touched.append("destra")
            if bounds.top == 0:
                touched.append("alto")
            if bounds.bottom == CELL_H - 1:
                touched.append("basso")
            if touched:
                errors.append(f"{label}: figura tagliata al bordo ({', '.join(touched)})")

            if not FEET_Y - 16 <= bounds.bottom <= FEET_Y + 12:
                errors.append(
                    f"{label}: piedi a y={bounds.bottom}, atteso {FEET_Y - 16}..{FEET_Y + 12}"
                )

            # Il vecchio walk_up del Coordinatore aveva il corpo e un secondo
            # frammento grafico ai piedi: bbox e aggancio restavano validi, ma
            # in animazione i due elementi tremavano fuori sequenza. Nelle
            # tracce walk una seconda banda alta e ben separata non e' un
            # dettaglio antialias, quindi deve fermare la consegna.
            if row in WALK_ROWS:
                segments = occupied_row_segments(cell)
                for previous, detached in zip(segments, segments[1:]):
                    gap = detached[0] - previous[1]
                    height = detached[1] - detached[0]
                    if gap >= MIN_FRAGMENT_GAP and height >= MIN_FRAGMENT_ROWS:
                        errors.append(
                            f"{label}: frammento grafico staccato "
                            f"(gap {gap}px, altezza {height}px)"
                        )
                        break
        row_bounds.append(current)

    for row, bounds in enumerate(row_bounds):
        if len(bounds) < 2:
            continue
        widths = [item.width for item in bounds]
        row_median = float(median(widths))
        for col, item in enumerate(bounds):
            if item.width > row_median * 1.35 and item.width - row_median >= 28:
                errors.append(
                    f"r{row:02d}c{col}: larghezza anomala {item.width}px "
                    f"(mediana traccia {row_median:.0f}px; possibile doppia sagoma)"
                )

    # Le pose work possono allargare le braccia, ma non possono contenere due
    # corpi. Il bug storico del Coordinatore aveva quattro doppie sagome nella
    # riga work_side: essendo tutte uguali, il confronto interno alla riga non
    # lo vedeva. Confrontare work contro walk della stessa angolazione rende il
    # difetto misurabile senza imporre una silhouette assoluta ai vari ruoli.
    for walk_row, work_row in ((3, 6), (4, 7), (5, 8)):
        walk = row_bounds[walk_row]
        work = row_bounds[work_row]
        if not walk or not work:
            continue
        walk_area = float(median(item.area for item in walk))
        work_area = float(median(item.area for item in work))
        walk_width = float(median(item.width for item in walk))
        work_width = float(median(item.width for item in work))
        if work_area > walk_area * 1.55 and work_width > walk_width * 1.20:
            errors.append(
                f"r{work_row:02d}: sagoma work anomala rispetto a r{walk_row:02d} "
                f"(area {work_area / walk_area:.2f}x, larghezza "
                f"{work_width / walk_width:.2f}x; possibile corpo sovrapposto)"
            )

    work_down = row_bounds[6]
    work_up = row_bounds[7]
    work_side = row_bounds[8]
    if work_down and work_up and work_side:
        front_width = max(
            float(median(item.width for item in work_down)),
            float(median(item.width for item in work_up)),
        )
        front_area = max(
            float(median(item.area for item in work_down)),
            float(median(item.area for item in work_up)),
        )
        side_width = float(median(item.width for item in work_side))
        side_area = float(median(item.area for item in work_side))
        if side_width > front_width * 1.35 and side_area > front_area * 1.15:
            errors.append(
                "r08: profilo work piu' largo delle viste frontale/posteriore "
                f"(larghezza {side_width / front_width:.2f}x, area "
                f"{side_area / front_area:.2f}x; possibile doppia sagoma)"
            )

    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "paths",
        nargs="*",
        type=Path,
        help="fogli da controllare; default: assets/characters/sheets/*_?.png",
    )
    parser.add_argument(
        "--strict-unused",
        action="store_true",
        help="considera errore anche l'arte presente nelle celle non usate dal rig",
    )
    args = parser.parse_args()

    game_dir = Path(__file__).resolve().parents[1]
    paths = args.paths or sorted((game_dir / "assets/characters/sheets").glob("*_?.png"))
    failed = 0
    for path in paths:
        errors = audit_sheet(path, strict_unused=args.strict_unused)
        if errors:
            failed += 1
            print(f"FAIL {path}")
            for error in errors:
                print(f"  - {error}")
        else:
            print(f"PASS {path}")

    print(f"\n{len(paths) - failed} PASS, {failed} FAIL, {len(paths)} fogli")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
