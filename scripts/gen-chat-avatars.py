#!/usr/bin/env python3
"""
gen-chat-avatars.py — ritratti disegnati degli agenti, ritagliati al busto,
per le icone della chat web (/messages e il drawer in navbar).

Perche' esiste
--------------
La chat web mostrava emoji al posto degli agenti (👨‍✈️ 🧙‍♂️ 👩‍💼): un
segnaposto che non ha niente a che vedere col personaggio che l'utente
conosce dal videogioco. Le facce vere esistono gia' — sono i ritratti a
layer del gioco (`game/assets/characters/gen/portraits/<slug>/`), gli
stessi che PortraitView compone a schermo: `base.svg` (corpo+testa),
`pose_*.svg` (braccia/gambe), `face_*.svg` (espressione).

Questo script li compone nello STESSO ordine di
`game/scripts/dialogue/portrait_view.gd` (base → posa → faccia), ritaglia
al busto e scrive i PNG in `web/public/agents/`. Committiamo sia lo
script sia l'output: rigenerare deve essere una riga di shell, non una
sessione di lavoro.

Rasterizzazione
---------------
I ritratti sono SVG e Pillow non li rasterizza. Usiamo `magick`
(ImageMagick, gia' installato sulla macchina di sviluppo) solo per
SVG→PNG a piena risoluzione; tutto il resto (compositing, crop, resize,
quantizzazione) e' Pillow. Nessuna dipendenza Python nuova.

Il ritaglio
-----------
Il canvas dei ritratti e' 560x760 con una geometria costante fra i
personaggi: capelli a y~116, mento a y~376, spalle che partono a y~404,
corpo che esce dal frame a 760. BUST_BOX ritaglia un quadrato che tiene
testa intera + attacco delle spalle e taglia sul petto — il "busto".
Il quadrato serve alle icone tonde della chat: qualunque altra
proporzione, mascherata a cerchio, taglierebbe le orecchie.

Uso
---
    python3 scripts/gen-chat-avatars.py            # rigenera web/public/agents/
    python3 scripts/gen-chat-avatars.py --check    # verifica soltanto (CI)
"""

from __future__ import annotations

import argparse
import io
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
PORTRAITS = REPO / "game" / "assets" / "characters" / "gen" / "portraits"
OUT_DIR = REPO / "web" / "public" / "agents"

# Slug web (quello che l'agente scrive in `pending_user_messages.agent`)
# → cartella del ritratto nel gioco. Il Capitano del sistema reale e' il
# "coordinatore" del gioco: stesso disallineamento di `_agent_dir()` in
# vps_backend.gd, tenuto qui in un posto solo.
AGENTS: dict[str, str] = {
    "assistente": "assistente",
    "capitano": "coordinatore",
    "mentor": "mentor",
}

# Espressione di default: la stessa che PortraitView usa a riposo.
FACE = "face_neutro.svg"
POSE = "pose_a.svg"

# Ritaglio al busto sul canvas nativo 560x760 (left, top, right, bottom).
# Quadrato di 400px centrato sull'asse del personaggio (x=280).
#
# Il bordo superiore e' 80 e non piu' in basso perche' l'Assistente porta
# lo chignon: il suo inchiostro comincia a y=82 (misurato sull'alpha dei
# tre ritratti composti: 82 / 114 / 122). Un crop piu' aggressivo le
# tagliava i capelli. Il box e' lo STESSO per tutti e tre: le tre icone
# stanno una accanto all'altra nella sidebar e scale diverse si vedono.
BUST_BOX = (80, 80, 480, 480)

# Lato del PNG finale. Le icone si usano a 18-44 CSS px: 128 le copre
# tutte a densita' 2x-3x senza pesare.
OUT_SIZE = 128


def render_svg(path: Path) -> Image.Image:
    """SVG → RGBA a risoluzione nativa, via ImageMagick."""
    proc = subprocess.run(
        ["magick", "-background", "none", str(path), "png:-"],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"magick ha fallito su {path}: {proc.stderr.decode(errors='replace')[:300]}"
        )
    return Image.open(io.BytesIO(proc.stdout)).convert("RGBA")


def build_portrait(slug_dir: Path) -> Image.Image:
    """Compone base → posa → faccia, come portrait_view.gd."""
    layers = [slug_dir / "base.svg"]
    for optional in (POSE, FACE):
        candidate = slug_dir / optional
        if candidate.exists():
            layers.append(candidate)

    out = render_svg(layers[0])
    for layer in layers[1:]:
        out = Image.alpha_composite(out, render_svg(layer))
    return out


def bust(portrait: Image.Image) -> Image.Image:
    """Ritaglia al busto e riduce, mantenendo l'alpha (icone tonde)."""
    cropped = portrait.crop(BUST_BOX)
    return cropped.resize((OUT_SIZE, OUT_SIZE), Image.LANCZOS)


def encode(img: Image.Image) -> bytes:
    """PNG piu' leggero possibile che resti fedele.

    I ritratti sono flat-color con contorni: una palette a 128 colori e'
    indistinguibile dall'originale e pesa un terzo. `optimize=True` e
    compress_level massimo fanno il resto. Alpha preservato: `quantize`
    con method=FASTOCTREE tiene il canale alfa (gli altri metodi no).
    """
    quantized = img.quantize(colors=128, method=Image.FASTOCTREE)
    buf = io.BytesIO()
    quantized.save(buf, format="PNG", optimize=True, compress_level=9)
    return buf.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="non scrivere: fallisci se l'output su disco non e' aggiornato.",
    )
    args = parser.parse_args()

    if shutil.which("magick") is None:
        print(
            "gen-chat-avatars: serve ImageMagick (`brew install imagemagick`) "
            "per rasterizzare gli SVG dei ritratti.",
            file=sys.stderr,
        )
        return 2

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stale: list[str] = []

    for web_slug, portrait_dir in AGENTS.items():
        src = PORTRAITS / portrait_dir
        if not (src / "base.svg").exists():
            print(f"gen-chat-avatars: ritratto mancante per {web_slug} ({src})", file=sys.stderr)
            return 2

        data = encode(bust(build_portrait(src)))
        dest = OUT_DIR / f"{web_slug}.png"

        if args.check:
            if not dest.exists() or dest.read_bytes() != data:
                stale.append(dest.name)
            continue

        dest.write_bytes(data)
        print(f"  {dest.relative_to(REPO)}  {len(data) / 1024:.1f} KB  {OUT_SIZE}x{OUT_SIZE}")

    if args.check and stale:
        print(
            "gen-chat-avatars: output non aggiornato: " + ", ".join(stale) +
            " — rilancia `python3 scripts/gen-chat-avatars.py`.",
            file=sys.stderr,
        )
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
