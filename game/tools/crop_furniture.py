#!/usr/bin/env python3
"""Rifinisce gli asset arredo di imagegen per FurnitureNode.

FurnitureNode scala la texture sull'ingombro del rect: margini vuoti
enormi rimpiccioliscono l'oggetto disegnato. Qui: defringe magenta,
crop al bbox dell'alpha con un piccolo pad, salvataggio al path di
destinazione (game/assets/gen-art/furniture/<kind>.png).

Uso: python3 crop_furniture.py <sorgente.png> <destinazione.png> [pad]
"""
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from slice_agent_sheet import defringe_magenta  # noqa: E402


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    pad = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    arr = defringe_magenta(np.array(Image.open(src).convert("RGBA")))
    ys, xs = np.nonzero(arr[:, :, 3] > 24)
    if len(ys) == 0:
        sys.exit(f"{src}: nessun contenuto opaco")
    y0, y1 = max(0, ys.min() - pad), min(arr.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(arr.shape[1], xs.max() + 1 + pad)
    out = Image.fromarray(arr[y0:y1, x0:x1])
    out.save(dst)
    print(f"scritto {dst} {out.size[0]}x{out.size[1]}")


if __name__ == "__main__":
    main()
