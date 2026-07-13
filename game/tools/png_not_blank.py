#!/usr/bin/env python3
"""Exit 0 se il PNG contiene un'immagine "vera" (non vuota né uniforme).

Serve a run.sh shot per capire se il tentativo HEADLESS ha davvero
renderizzato la scena: un renderer headless senza device produce un file
nero/uniforme, che va scartato in favore del fallback a finestra.
"""
import sys

from PIL import Image

im = Image.open(sys.argv[1]).convert("RGB")
im = im.resize((64, 36))  # basta il profilo: veloce e stabile
colors = im.getcolors(64 * 36)
# uniforme (1 colore) o quasi (un colore copre >99%): non è una scena
if colors is not None:
    top = max(n for n, _ in colors)
    if len(colors) == 1 or top > 64 * 36 * 0.99:
        sys.exit(1)
sys.exit(0)
