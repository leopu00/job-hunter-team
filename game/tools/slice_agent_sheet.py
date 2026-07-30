#!/usr/bin/env python3
"""Ritaglia i fogli imagegen di Codex e li rimonta nel contratto SPRITES.md.

Le immagini sorgente sono griglie regolari (righe = down/up/side) generate
dalla skill imagegen; qui si fa SOLO post-processing deterministico:
bbox per cella, scala uniforme per riga, aggancio piedi a (64,180) e
composizione nel foglio 768x2304 a 12 righe (idle/walk/work/carry x 3).

Uso:
  python3 slice_agent_sheet.py <slug> --walk walk.png [--work work.png]
      [--idle idle.png] [--carry carry.png] -o sheets/<slug>_a.png

Tracce mancanti: idle <- primo frame walk (statico), work <- idle,
carry <- frame walk (senza fogli, placeholder finche' non c'e' l'immagine).
"""
import argparse
import sys

import numpy as np
from PIL import Image

# Celle a 4x rispetto alla resa in scena (rig scala ~0.425): gli originali
# imagegen (~300px di figura) entrano quasi 1:1 e a zoom profondo gli
# agenti reggono il confronto con gli arredi full-res (feedback 18:2x).
CELL_W, CELL_H = 256, 384
COLS, ROWS = 6, 12
FEET = (128, 360)
TARGET_H = 320.0
# riga del contratto -> (traccia, direzione, n frame)
LAYOUT = [
    ("idle", 0, 2), ("idle", 1, 2), ("idle", 2, 2),
    ("walk", 0, 6), ("walk", 1, 6), ("walk", 2, 6),
    ("work", 0, 4), ("work", 1, 4), ("work", 2, 4),
    ("carry", 0, 6), ("carry", 1, 6), ("carry", 2, 6),
]


def defringe_magenta(arr: np.ndarray) -> np.ndarray:
    """Neutralizza i residui del chroma-key magenta di imagegen (fringe
    su dita/bordi): i pixel nettamente magenta vengono riportati al grigio
    della propria luminanza, mantenendo l'alpha."""
    r = arr[:, :, 0].astype(int)
    g = arr[:, :, 1].astype(int)
    b = arr[:, :, 2].astype(int)
    a = arr[:, :, 3]
    mask = (a > 0) & (np.minimum(r, b) - g > 48)
    if mask.any():
        luma = (0.3 * r + 0.5 * g + 0.2 * b).astype(np.uint8)
        for ch in range(3):
            arr[:, :, ch][mask] = luma[mask]
    return arr


def _segments(profile: np.ndarray, min_w: int = 24):
    """Intervalli [a,b) dove il profilo è >0, ignorando i segmenti-briciola."""
    on = profile > 0
    edges = np.flatnonzero(np.diff(on.astype(int)))
    bounds = [0] + (edges + 1).tolist() + [len(on)]
    return [(a, b) for a, b in zip(bounds, bounds[1:])
            if on[a] and (b - a) >= min_w]


def _crop_main_blob(cell: np.ndarray) -> np.ndarray:
    """Tiene solo il blob verticale principale della cella: le figure
    delle righe adiacenti che sforano la banda (teste/piedi fantasma,
    audit scout_sit 20:1x) restano separate da un gap di trasparenza e
    vengono scartate qui, senza rigenerare lo sheet."""
    row_profile = (cell[:, :, 3] > 24).sum(axis=1)
    row_profile[row_profile < 3] = 0
    segs = _segments(row_profile, min_w=12)
    if segs:  # SEMPRE il segmento maggiore: un residuo sotto min_w non
        a, b = max(segs, key=lambda s: s[1] - s[0])  # fa segmento ma
        cell = cell[a:b]  # finirebbe comunque nel bbox della cella
    return cell


def load_grid(path: str, cols: int):
    """Estrae i frame (PIL RGBA) da una griglia cols x 3 righe.

    imagegen non centra le figure in celle esatte: i frame si trovano
    segmentando il profilo alpha per colonne dentro ogni banda-riga.
    Se i blob trovati non sono `cols`, fallback alla griglia fissa.
    """
    im = Image.open(path).convert("RGBA")
    arr = defringe_magenta(np.array(im))
    h, w = arr.shape[:2]
    ch = h // 3
    rows = []
    for r in range(3):
        band = arr[r * ch:(r + 1) * ch]
        col_profile = (band[:, :, 3] > 24).sum(axis=0)
        col_profile[col_profile < 3] = 0  # righe di rumore quasi-vuote
        segs = _segments(col_profile)
        if len(segs) != cols:  # blob fusi o spezzati: celle fisse
            cw = w // cols
            segs = [(c * cw, (c + 1) * cw) for c in range(cols)]
        frames = []
        for c, (x0, x1) in enumerate(segs):
            cell = _crop_main_blob(band[:, x0:x1])
            ys, xs = np.nonzero(cell[:, :, 3] > 24)
            if len(ys) == 0:
                sys.exit(f"{path}: cella r{r}c{c} vuota")
            frames.append(Image.fromarray(
                cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1]))
        rows.append(frames)
    return rows


def place(sheet: Image.Image, frame: Image.Image, row: int, col: int, scale: float):
    """Scala il frame e lo ancora coi piedi in fondo alla cella.

    La scala arriva per-riga (mediana): un frame più alto della mediana
    sforerebbe SOPRA la cella e la testa finirebbe tagliata nel rendering
    (e fantasma nella riga sopra) — feedback Leone 18:2x. Clamp per-frame:
    la figura sta sempre nella cella, con un filo di respiro.
    """
    fw, fh = frame.size
    # Il clamp verticale evita le teste nella riga precedente; quello
    # orizzontale evita il difetto speculare visto su analista_b, dove il
    # profilo destro arrivava oltre la cella e perdeva parte del volto.
    scale = min(scale, (FEET[1] - 4) / fh, (CELL_W - 8) / fw)
    nw, nh = max(1, round(fw * scale)), max(1, round(fh * scale))
    fr = frame.resize((nw, nh), Image.LANCZOS)
    x = col * CELL_W + FEET[0] - nw // 2
    y = row * CELL_H + FEET[1] - nh
    sheet.alpha_composite(fr, (x, y))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("slug")
    ap.add_argument("--walk")
    ap.add_argument("--idle")
    ap.add_argument("--work")
    ap.add_argument("--carry")
    ap.add_argument("--sit", help="foglio SEPARATO 4x3 <slug>_sit.png (SIT_TRACKS)")
    ap.add_argument("--sit-target-h", type=float, default=244.0,
                    help="altezza del seduto: ~0.76 dello standing TARGET_H, "
                         "così le proporzioni tornano col foglio principale")
    ap.add_argument("-o", "--out", required=True)
    args = ap.parse_args()

    if args.sit:
        # foglio seduto: griglia 4x3 autonoma, stesse celle e aggancio piedi
        rows = load_grid(args.sit, 4)
        sheet = Image.new("RGBA", (4 * CELL_W, 3 * CELL_H), (0, 0, 0, 0))
        for r, frames in enumerate(rows):
            med_h = float(np.median([f.size[1] for f in frames]))
            scale = args.sit_target_h / med_h
            for col, fr in enumerate(frames[:4]):
                place(sheet, fr, r, col, scale)
        sheet.save(args.out)
        print(f"scritto {args.out} ({args.slug}, sit 4x3)")
        return

    if not args.walk:
        sys.exit("serve --walk (o --sit per il foglio seduto)")
    grids = {"walk": load_grid(args.walk, 6)}
    if args.idle:
        grids["idle"] = load_grid(args.idle, 2)
    if args.work:
        grids["work"] = load_grid(args.work, 4)
    if args.carry:
        grids["carry"] = load_grid(args.carry, 6)

    # fallback per tracce mancanti (vedi docstring)
    if "idle" not in grids:
        grids["idle"] = [[r[0], r[0]] for r in grids["walk"]]
    if "work" not in grids:
        grids["work"] = [[f for f in r[:2] for _ in (0, 1)] for r in grids["idle"]]
    if "carry" not in grids:
        grids["carry"] = grids["walk"]

    sheet = Image.new("RGBA", (COLS * CELL_W, ROWS * CELL_H), (0, 0, 0, 0))
    for sheet_row, (track, direction, nframes) in enumerate(LAYOUT):
        frames = grids[track][direction][:nframes]
        # scala uniforme per riga: mediana delle altezze bbox -> TARGET_H
        med_h = float(np.median([f.size[1] for f in frames]))
        scale = TARGET_H / med_h
        for col, fr in enumerate(frames):
            place(sheet, fr, sheet_row, col, scale)
    sheet.save(args.out)
    print(f"scritto {args.out} ({args.slug}, tracce: {sorted(grids)})")


if __name__ == "__main__":
    main()
