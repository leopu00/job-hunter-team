#!/usr/bin/env python3
"""
gen-chat-avatars.py — ritratti in stile fumetto degli agenti, ritagliati sul
volto, per le icone della chat web (/messages e il drawer in navbar).

Perche' esiste
--------------
Le icone della chat erano gli sprite del videogioco: testine stilizzate da
3 KB, buone dentro il gioco ma estranee al web. Gli asset art veri — le
illustrazioni in stile fumetto che la pagina /agents mostra a piena
larghezza — esistono gia' in `web/public/agents-*.png`, ed e' quella la
faccia con cui il progetto presenta ogni ruolo. La chat deve mostrare la
STESSA faccia.

Servirle intere non si puo': sono PNG da 400 KB a 1,1 MB disegnati a
30-40 px dentro un cerchio. Questo script ne ritaglia il volto, riduce a
`OUT_SIZE` e riscrive `web/public/agents/<slug>.png` — gli stessi percorsi
che `web/lib/message-display.ts` gia' referenzia, cosi' il web non cambia
sorgente, cambia soltanto il contenuto dei file. Committiamo sia lo script
sia l'output: rigenerare deve essere una riga di shell, non una sessione
di lavoro.

Il ritaglio
-----------
Le illustrazioni sono scene a figura intera (1448x1086) con il personaggio
in una posizione diversa in ognuna: un ritaglio centrato geometricamente
darebbe il torace del Capitano o la lavagna alle sue spalle. Per ogni
agente teniamo quindi tre misure prese SULL'ILLUSTRAZIONE — asse verticale
del volto, cima dei capelli, mento — e da queste deriviamo il quadrato. Cosi' la testa esce sempre alla STESSA scala apparente anche se
nelle sorgenti e' alta 126 px (Assistente) o 173 px (Mentor): le tre icone
stanno una accanto all'altra in sidebar e teste di misura diversa si
noterebbero subito.

Il quadrato serve alle icone tonde: qualunque altra proporzione,
mascherata a cerchio, taglierebbe le orecchie.

Uso
---
    python3 scripts/gen-chat-avatars.py            # rigenera web/public/agents/
    python3 scripts/gen-chat-avatars.py --check    # verifica soltanto (CI)
"""

from __future__ import annotations

import argparse
import io
import sys
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
ART_DIR = REPO / "web" / "public"
OUT_DIR = REPO / "web" / "public" / "agents"


@dataclass(frozen=True)
class Face:
    """Dove sta la faccia nell'illustrazione, in pixel nativi.

    `cx` e' l'asse verticale del volto (non del corpo: il Mentor ha un
    braccio alzato che sposterebbe il centro di massa). `top` e' il punto
    piu' alto della capigliatura, `chin` il mento — barba compresa quando
    c'e', altrimenti il crop taglierebbe il Mentor a meta' barba.
    """

    src: str
    cx: int
    top: int
    chin: int


# Slug web (quello che l'agente scrive in `pending_user_messages.agent`)
# → illustrazione + misure del volto. Il Capitano del sistema reale e' il
# "coordinatore" degli asset art: stesso disallineamento gia' presente fra
# gioco e prompt, tenuto qui in un posto solo.
#
# Sono i tre agenti che parlano con l'utente: solo assistente, capitano e
# mentor hanno la skill `notify-user`, quindi solo loro compaiono come
# mittenti in chat. Aggiungerne uno significa una riga qui piu' la sua
# voce in AGENT_META (web/lib/message-display.ts).
AGENTS: dict[str, Face] = {
    "capitano": Face("agents-coordinator.png", cx=389, top=23, chin=163),
    # Il Mentor e' spostato di ~10 px a destra rispetto all'asse vero della
    # testa (726): il suo indice alzato sta a x=550-602 e con l'asse esatto
    # ne entrava una scheggia nell'angolo in basso a sinistra. Cosi' il dito
    # cade fuori dal quadrato e la testa resta centrata a occhio.
    "mentor": Face("agents-mentor.png", cx=736, top=62, chin=235),
    "assistente": Face("agents-assistant.png", cx=790, top=70, chin=196),
}

# Quanta parte dell'altezza della cornice occupa la testa: piu' alto e'
# questo numero, piu' stretta e' l'inquadratura. 0.62 e' il valore scelto
# guardando le icone renderizzate a 22-36 px. A 0.55 la cornice si allarga
# e a quelle dimensioni la faccia diventa una macchia (oltre a far entrare
# nel quadrato del Mentor il dito alzato che gli sta a sinistra); sopra
# 0.70 spariscono le spalle e la testa sembra premuta contro il bordo del
# cerchio.
HEAD_RATIO = 0.62

# Aria sopra i capelli, in frazione del lato. Serve perche' il cerchio
# mangia gli angoli: senza margine la cima della testa finisce fuori.
TOP_MARGIN = 0.12

# Lato del PNG finale. Le icone si usano a 22-36 CSS px: 96 le copre tutte
# a densita' doppia senza far pesare una chat piena di bolle.
OUT_SIZE = 96


def crop_box(face: Face, size: tuple[int, int]) -> tuple[int, int, int, int]:
    """Quadrato inquadrato sul volto, dentro i bordi dell'illustrazione."""
    side = round((face.chin - face.top) / HEAD_RATIO)
    left = round(face.cx - side / 2)
    top = round(face.top - TOP_MARGIN * side)

    # Clamp: alcune teste sfiorano il bordo alto della tela (il Capitano
    # comincia a y=23). Trasliamo invece di rimpicciolire, cosi' la scala
    # apparente della testa resta quella decisa da HEAD_RATIO.
    width, height = size
    left = max(0, min(left, width - side))
    top = max(0, min(top, height - side))
    return (left, top, left + side, top + side)


def portrait(face: Face) -> Image.Image:
    """Illustrazione → quadrato sul volto, ridotto, alpha preservato."""
    src = Image.open(ART_DIR / face.src).convert("RGBA")
    return src.crop(crop_box(face, src.size)).resize(
        (OUT_SIZE, OUT_SIZE), Image.LANCZOS
    )


def encode(img: Image.Image) -> bytes:
    """PNG piu' leggero possibile che resti fedele.

    Diversamente dagli sprite del gioco (flat-color), queste illustrazioni
    sono sfumate e tratteggiate: una palette stretta produce banding
    visibile sugli incarnati. A 96x96 il PNG RGBA pieno resta sotto i
    30 KB, quindi non quantizziamo affatto — `optimize` + compressione
    massima bastano.
    """
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True, compress_level=9)
    return buf.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="non scrivere: fallisci se l'output su disco non e' aggiornato.",
    )
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    stale: list[str] = []

    for web_slug, face in AGENTS.items():
        if not (ART_DIR / face.src).exists():
            print(
                f"gen-chat-avatars: illustrazione mancante per {web_slug} "
                f"({ART_DIR / face.src})",
                file=sys.stderr,
            )
            return 2

        data = encode(portrait(face))
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
