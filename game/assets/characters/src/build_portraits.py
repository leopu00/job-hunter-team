#!/usr/bin/env python3
"""Generatore dei ritratti da dialogo (mezzo busto, stile inchiostrato).

Ogni ritratto è un pila di layer allineati sullo stesso canvas 560×760:
  base.svg    — busto, testa, capelli, barba, occhiali (sempre visibile)
  pose_<x>.svg — solo braccia/mani/oggetti (una posa per file)
  face_<y>.svg — solo sopracciglia+bocca (una espressione per file)

Il runner Godot (PortraitView) compone base+posa+espressione e anima
respiro/tilt/transizioni. Con gli occhiali tondi scuri (firma del brand)
le espressioni vivono su sopracciglia, bocca e inclinazione della testa.

Output: game/assets/characters/gen/portraits/<slug>/…
Uso: python3 build_portraits.py
"""

import os
import shutil

from build import CHARS, INK

SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(SRC), "gen", "portraits")

W, H = 560, 760
# Geometria condivisa del volto
HEAD_C = (280, 236)
HEAD_R = 94


def svg(body: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
            f'viewBox="0 0 {W} {H}">\n{body}\n</svg>\n')


def el(tag: str, **attrs) -> str:
    parts = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items() if v is not None)
    return f"<{tag} {parts}/>"


def outline(w=3.0):
    return {"stroke": INK, "stroke_opacity": "0.55", "stroke_width": str(w)}


def shade(d: str, alpha=0.14) -> str:
    return f'<path d="{d}" fill="#000000" fill-opacity="{alpha}"/>'


def lite(d: str, alpha=0.10) -> str:
    return f'<path d="{d}" fill="#ffffff" fill-opacity="{alpha}"/>'


# ── Testa condivisa ──────────────────────────────────────────────────────

def head_base(c: dict) -> str:
    cx, cy = HEAD_C
    s = ""
    # collo
    s += el("path", d=f"M{cx-38} {cy+70} L{cx-34} {cy+140} L{cx+34} {cy+140} L{cx+38} {cy+70} Z",
            fill=c["skin_dark"], **outline())
    # orecchie
    for ex in (cx - HEAD_R - 6, cx + HEAD_R + 6):
        s += el("ellipse", cx=str(ex), cy=str(cy + 8), rx="16", ry="26",
                fill=c["skin"], **outline())
    # volto: ovale morbido
    s += el("path",
            d=f"M{cx-HEAD_R} {cy-20} Q{cx-HEAD_R-4} {cy-110} {cx} {cy-112} "
              f"Q{cx+HEAD_R+4} {cy-110} {cx+HEAD_R} {cy-20} "
              f"Q{cx+HEAD_R-6} {cy+60} {cx} {cy+86} "
              f"Q{cx-HEAD_R+6} {cy+60} {cx-HEAD_R} {cy-20} Z",
            fill=c["skin"], **outline(3.4))
    # ombra lato destro del volto
    s += shade(f"M{cx+40} {cy-104} Q{cx+HEAD_R+2} {cy-90} {cx+HEAD_R-2} {cy-10} "
               f"Q{cx+HEAD_R-8} {cy+56} {cx+8} {cy+84} "
               f"Q{cx+70} {cy+30} {cx+64} {cy-40} Q{cx+60} {cy-90} {cx+40} {cy-104} Z", 0.10)
    # naso
    s += el("path", d=f"M{cx-4} {cy+2} Q{cx-10} {cy+34} {cx-2} {cy+40} Q{cx+8} {cy+42} {cx+10} {cy+34}",
            fill="none", stroke=INK, stroke_opacity="0.5", stroke_width="3")
    return s


def glasses(cx=None, cy=None) -> str:
    if cx is None:
        cx, cy = HEAD_C
    s = ""
    # aste verso le orecchie
    s += el("line", x1=str(cx - 104), y1=str(cy - 6), x2=str(cx - 66), y2=str(cy - 10),
            stroke="#8a7a52", stroke_width="5")
    s += el("line", x1=str(cx + 104), y1=str(cy - 6), x2=str(cx + 66), y2=str(cy - 10),
            stroke="#8a7a52", stroke_width="5")
    # ponte
    s += el("path", d=f"M{cx-14} {cy-12} Q{cx} {cy-22} {cx+14} {cy-12}",
            fill="none", stroke="#8a7a52", stroke_width="6")
    for gx in (cx - 40, cx + 40):
        s += el("circle", cx=str(gx), cy=str(cy - 6), r="34", fill="#101018",
                fill_opacity="0.96", stroke="#8a7a52", stroke_width="6")
        # riflesso
        s += el("path", d=f"M{gx-20} {cy-18} Q{gx-6} {cy-30} {gx+10} {cy-24} "
                          f"Q{gx-8} {cy-24} {gx-14} {cy-10} Z",
                fill="#b8c8d8", fill_opacity="0.5")
    return s


# ── Capigliature / barbe (per personaggio) ──────────────────────────────

def hair_portrait(c: dict) -> str:
    cx, cy = HEAD_C
    style = c["hair_style"]
    col = c["hair"]
    o = outline(3.4)
    if style == "old":  # Mentor: stempiato, ciuffi laterali folti
        return (
            el("path", d=f"M{cx-HEAD_R-10} {cy+6} Q{cx-HEAD_R-22} {cy-70} {cx-58} {cy-96} "
                         f"Q{cx-72} {cy-52} {cx-96} {cy-40} Q{cx-HEAD_R-2} {cy-20} {cx-HEAD_R-10} {cy+6} Z",
               fill=col, **o) +
            el("path", d=f"M{cx+HEAD_R+10} {cy+6} Q{cx+HEAD_R+22} {cy-70} {cx+58} {cy-96} "
                         f"Q{cx+72} {cy-52} {cx+96} {cy-40} Q{cx+HEAD_R+2} {cy-20} {cx+HEAD_R+10} {cy+6} Z",
               fill=col, **o) +
            el("path", d=f"M{cx-60} {cy-98} Q{cx} {cy-124} {cx+60} {cy-98} "
                         f"Q{cx+30} {cy-108} {cx} {cy-106} Q{cx-30} {cy-108} {cx-60} {cy-98} Z",
               fill=col, fill_opacity="0.85")
        )
    if style == "updo":  # Assistente: raccolto con chignon
        return (
            el("circle", cx=str(cx + 66), cy=str(cy - 118), r="34", fill=col, **o) +
            el("path", d=f"M{cx-HEAD_R-6} {cy+10} Q{cx-HEAD_R-14} {cy-96} {cx} {cy-124} "
                         f"Q{cx+HEAD_R+14} {cy-96} {cx+HEAD_R+6} {cy-6} "
                         f"Q{cx+82} {cy-64} {cx+40} {cy-86} Q{cx-20} {cy-98} {cx-64} {cy-74} "
                         f"Q{cx-88} {cy-56} {cx-HEAD_R-6} {cy+10} Z",
               fill=col, **o) +
            lite(f"M{cx-40} {cy-104} Q{cx} {cy-116} {cx+40} {cy-102} "
                 f"Q{cx} {cy-110} {cx-40} {cy-104} Z", 0.12)
        )
    if style == "bun":  # Analista
        return (
            el("circle", cx=str(cx), cy=str(cy - 132), r="36", fill=col, **o) +
            el("path", d=f"M{cx-HEAD_R-6} {cy+4} Q{cx-HEAD_R-16} {cy-92} {cx} {cy-122} "
                         f"Q{cx+HEAD_R+16} {cy-92} {cx+HEAD_R+6} {cy+4} "
                         f"Q{cx+80} {cy-58} {cx+30} {cy-84} Q{cx-30} {cy-84} {cx-80} {cy-58} "
                         f"Q{cx-96} {cy-40} {cx-HEAD_R-6} {cy+4} Z",
               fill=col, **o)
        )
    if style == "wavy":  # Scorer
        return el("path",
                  d=f"M{cx-HEAD_R-4} {cy-2} Q{cx-HEAD_R-18} {cy-88} {cx-30} {cy-116} "
                    f"Q{cx+20} {cy-130} {cx+70} {cy-104} Q{cx+HEAD_R+18} {cy-78} {cx+HEAD_R+2} {cy-6} "
                    f"Q{cx+HEAD_R+10} {cy-56} {cx+62} {cy-78} Q{cx+70} {cy-58} {cx+40} {cy-74} "
                    f"Q{cx-10} {cy-92} {cx-56} {cy-72} Q{cx-84} {cy-52} {cx-HEAD_R-4} {cy-2} Z",
                  fill=c["hair"], **outline(3.4))
    # short (Coordinatore, Scout, Maintainer)
    return el("path",
              d=f"M{cx-HEAD_R-4} {cy-6} Q{cx-HEAD_R-14} {cy-92} {cx} {cy-120} "
                f"Q{cx+HEAD_R+14} {cy-92} {cx+HEAD_R+4} {cy-6} "
                f"Q{cx+86} {cy-58} {cx+34} {cy-82} Q{cx-34} {cy-82} {cx-86} {cy-58} "
                f"Q{cx-100} {cy-40} {cx-HEAD_R-4} {cy-6} Z",
              fill=c["hair"], **outline(3.4))


def beard_portrait(c: dict) -> str:
    if c.get("beard") != "full":
        if c.get("beard") == "goatee":
            cx, cy = HEAD_C
            return el("path",
                      d=f"M{cx-26} {cy+44} Q{cx} {cy+58} {cx+26} {cy+44} "
                        f"L{cx+18} {cy+78} Q{cx} {cy+90} {cx-18} {cy+78} Z",
                      fill=c["hair"], **outline(3))
        return ""
    cx, cy = HEAD_C
    return (
        el("path",
           d=f"M{cx-92} {cy+8} Q{cx-96} {cy+92} {cx-40} {cy+124} "
             f"Q{cx} {cy+142} {cx+40} {cy+124} Q{cx+96} {cy+92} {cx+92} {cy+8} "
             f"Q{cx+80} {cy+64} {cx+40} {cy+56} L{cx-40} {cy+56} Q{cx-80} {cy+64} {cx-92} {cy+8} Z",
           fill=c["hair"], **outline(3.4)) +
        shade(f"M{cx+30} {cy+58} Q{cx+80} {cy+66} {cx+90} {cy+16} "
              f"Q{cx+92} {cy+88} {cx+38} {cy+120} Z", 0.12) +
        # baffi
        el("path", d=f"M{cx-34} {cy+46} Q{cx} {cy+62} {cx+34} {cy+46} "
                     f"Q{cx+16} {cy+58} {cx} {cy+56} Q{cx-16} {cy+58} {cx-34} {cy+46} Z",
           fill=c["hair"], **outline(2.4))
    )


# ── Busti per archetipo ─────────────────────────────────────────────────

def bust(c: dict) -> str:
    fit = c["outfit"]
    o = outline(3.4)
    s = ""
    ny = 390  # attaccatura collo/spalle
    if fit == "robe":  # Mentor
        s += el("path", d=f"M60 760 Q54 520 150 430 Q220 386 280 384 Q340 386 410 430 "
                          f"Q506 520 500 760 Z", fill=c["coat"], **o)
        s += shade("M350 400 Q470 480 468 760 L500 760 Q506 520 410 430 Q380 410 350 400 Z")
        # scollo interno chiaro a V + fascia
        s += el("path", d=f"M226 400 Q280 380 334 400 L360 560 Q280 600 200 560 Z",
                fill=c["shirt"], **o)
        s += el("path", d=f"M244 402 L280 470 L316 402 L342 760 L218 760 Z",
                fill=c["vest"], fill_opacity="0.9")
        s += el("path", d=f"M180 650 Q280 700 380 650 L380 700 Q280 748 180 700 Z",
                fill=c.get("sash", "#6e5340"), **o)
        # scialle sulle spalle
        s += el("path", d=f"M118 760 Q120 520 214 424 L250 400 Q180 470 168 760 Z",
                fill=c["coat_dark"], **o)
        s += el("path", d=f"M442 760 Q440 520 346 424 L310 400 Q380 470 392 760 Z",
                fill=c["coat_dark"], **o)
    elif fit == "trench":  # Scout
        s += el("path", d=f"M70 760 Q66 540 160 446 Q225 400 280 398 Q335 400 400 446 "
                          f"Q494 540 490 760 Z", fill=c["coat"], **o)
        s += shade("M340 414 Q460 500 458 760 L490 760 Q494 540 400 446 Q370 424 340 414 Z")
        # colletto alzato
        s += el("path", d=f"M186 470 L254 402 L262 448 L206 506 Z", fill=c["coat_dark"], **o)
        s += el("path", d=f"M374 470 L306 402 L298 448 L354 506 Z", fill=c["coat_dark"], **o)
        # camicia + gilet + cravatta
        s += el("path", d=f"M252 404 L280 448 L308 404 Q280 392 252 404 Z", fill=c["shirt"], **o)
        s += el("path", d=f"M262 416 L280 448 L298 416 L306 520 L254 520 Z", fill=c["vest"])
        s += el("path", d=f"M274 430 L286 430 L292 500 L280 516 L268 500 Z", fill=c["tie"], **o)
        # bottoni doppio petto
        for by in (560, 640, 720):
            s += el("circle", cx="232", cy=str(by), r="7", fill=c["coat_dark"])
            s += el("circle", cx="328", cy=str(by), r="7", fill=c["coat_dark"])
    elif fit == "labcoat":  # Analista
        s += el("path", d=f"M74 760 Q70 540 164 448 Q228 402 280 400 Q332 402 396 448 "
                          f"Q490 540 486 760 Z", fill=c["coat"], **o)
        s += shade("M336 416 Q456 502 454 760 L486 760 Q490 540 396 448 Q366 426 336 416 Z", 0.10)
        # revers bianchi
        s += el("path", d=f"M196 480 L258 404 L268 452 L224 540 Z", fill=c["coat_dark"], **o)
        s += el("path", d=f"M364 480 L302 404 L292 452 L336 540 Z", fill=c["coat_dark"], **o)
        # blusa interna
        s += el("path", d=f"M256 406 L280 452 L304 406 Q280 394 256 406 Z", fill=c["shirt"], **o)
        s += el("path", d=f"M268 424 L280 452 L292 424 L296 760 L264 760 Z", fill=c["shirt"])
        # taschino con penne
        s += el("rect", x="150", y="600", width="56", height="66", fill="none",
                stroke=c["coat_dark"], stroke_width="4")
        s += el("rect", x="162", y="586", width="8", height="28", fill="#3f5540")
        s += el("rect", x="176", y="586", width="8", height="28", fill="#8a7a52")
    elif fit == "casual":  # Scorer
        s += el("path", d=f"M80 760 Q76 545 170 455 Q232 408 280 406 Q328 408 390 455 "
                          f"Q484 545 480 760 Z", fill=c["coat"], **o)
        s += shade("M330 420 Q450 510 448 760 L480 760 Q484 545 390 455 Q360 432 330 420 Z")
        # colletto morbido
        s += el("path", d=f"M240 412 Q280 436 320 412 Q300 448 280 450 Q260 448 240 412 Z",
                fill=c["coat_dark"], **o)
        # smartwatch al polso (se la posa mostra il braccio, resta sotto)
        s += lite("M120 700 Q180 660 240 690 L240 720 Q180 690 120 730 Z", 0.05)
    else:  # suit / blazer (Coordinatore, Assistente)
        s += el("path", d=f"M76 760 Q72 545 166 452 Q230 406 280 404 Q330 406 394 452 "
                          f"Q488 545 484 760 Z", fill=c["coat"], **o)
        s += shade("M332 418 Q452 508 450 760 L484 760 Q488 545 394 452 Q364 430 332 418 Z")
        # revers
        s += el("path", d=f"M198 486 L258 408 L270 462 L226 552 Z", fill=c["coat_dark"], **o)
        s += el("path", d=f"M362 486 L302 408 L290 462 L334 552 Z", fill=c["coat_dark"], **o)
        # camicia/blusa
        s += el("path", d=f"M254 410 L280 458 L306 410 Q280 396 254 410 Z", fill=c["shirt"], **o)
        if c.get("vest"):
            s += el("path", d=f"M240 448 L280 500 L320 448 L338 620 L222 620 Z",
                    fill=c["vest"], fill_opacity="0.95")
        if c.get("tie"):
            s += el("path", d=f"M272 434 L288 434 L296 540 L280 566 L264 540 Z",
                    fill=c["tie"], **outline(2.6))
        else:
            # collana sottile (Assistente)
            s += el("path", d=f"M258 428 Q280 470 302 428", fill="none",
                    stroke="#c8a84a", stroke_width="3")
            s += el("circle", cx="280", cy="470", r="5", fill="#c8a84a")
    return s


# ── Pose (solo braccia/mani/oggetti) ────────────────────────────────────

def sleeve(x0, y0, x1, y1, width, color, o=None):
    """Manica come nastro spesso da (x0,y0) a (x1,y1)."""
    import math
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy) or 1
    nx, ny = -dy / L * width / 2, dx / L * width / 2
    d = (f"M{x0+nx:.0f} {y0+ny:.0f} L{x1+nx:.0f} {y1+ny:.0f} "
         f"Q{x1+nx+dx/L*width*0.4:.0f} {y1+ny+dy/L*width*0.4:.0f} {x1:.0f} {y1+width*0:.0f} "
         f"L{x1-nx:.0f} {y1-ny:.0f} L{x0-nx:.0f} {y0-ny:.0f} Z")
    return el("path", d=d, fill=color, **(o or outline(3.2)))


def hand(x, y, c, r=24) -> str:
    return el("circle", cx=str(x), cy=str(y), r=str(r), fill=c["skin"], **outline(3))


def poses_for(slug: str, c: dict) -> dict:
    sl = c["coat_dark"] if c["outfit"] in ("suit", "blazer", "robe") else c["coat"]
    p = {}
    if slug == "mentor":
        # a. mani giunte in basso
        p["a"] = (sleeve(150, 480, 240, 660, 78, sl) + sleeve(410, 480, 320, 660, 78, sl) +
                  hand(258, 668, c) + hand(302, 668, c) +
                  el("path", d="M240 700 Q280 716 320 700", fill="none",
                     stroke=INK, stroke_opacity="0.3", stroke_width="3"))
        # b. indice alzato (la posa del PNG di riferimento)
        p["b"] = (sleeve(150, 480, 240, 660, 78, sl) + hand(258, 668, c) +
                  sleeve(414, 490, 434, 330, 80, sl) +
                  hand(438, 300, c, 26) +
                  el("path", d="M436 306 L430 236 Q438 224 448 234 L452 302 Z",
                     fill=c["skin"], **outline(3)))
        # c. libro aperto nella sinistra
        p["c"] = (sleeve(150, 480, 226, 620, 78, sl) +
                  el("path", d="M150 640 L280 610 L282 700 L156 734 Z", fill="#6e5340", **outline(3)) +
                  el("path", d="M158 646 L272 620 L274 690 L162 718 Z", fill="#e8e0c8") +
                  el("line", x1="180", y1="650", x2="250", y2="636", stroke="#7a7a96", stroke_width="3") +
                  el("line", x1="182", y1="668", x2="252", y2="654", stroke="#7a7a96", stroke_width="3") +
                  hand(230, 700, c) +
                  sleeve(410, 480, 330, 650, 78, sl) + hand(316, 660, c))
        # d. entrambe le mani sul bastone
        p["d"] = (el("rect", x="270", y="560", width="14", height="200", rx="7",
                     fill="#8a6a48", **outline(3)) +
                  el("circle", cx="277", cy="556", r="16", fill="#a8865c", **outline(3)) +
                  sleeve(150, 480, 246, 560, 78, sl) + sleeve(410, 480, 314, 570, 78, sl) +
                  hand(266, 552, c) + hand(292, 566, c))
    elif slug == "assistente":
        # a. gesto d'accoglienza (mano aperta di lato, come il PNG)
        p["a"] = (sleeve(400, 490, 480, 600, 70, sl) +
                  el("path", d="M478 606 Q520 596 538 570 Q548 580 538 594 Q560 588 566 596 "
                              "Q568 606 552 612 Q568 612 566 624 Q560 632 540 630 "
                              "Q520 640 494 636 Q472 630 478 606 Z",
                     fill=c["skin"], **outline(3)) +
                  sleeve(160, 490, 210, 640, 70, sl) +
                  el("path", d="M168 620 L262 620 L268 700 L174 700 Z", fill="#2e3442", **outline(3)) +
                  el("rect", x="180", y="632", width="70", height="8", fill="#7fffb2", fill_opacity="0.5") +
                  hand(226, 648, c, 22))
        # b. tablet a due mani
        p["b"] = (sleeve(160, 490, 220, 630, 70, sl) + sleeve(400, 490, 340, 630, 70, sl) +
                  el("path", d="M200 610 L360 610 L376 720 L184 720 Z", fill="#2e3442", **outline(3)) +
                  el("path", d="M214 622 L346 622 L358 706 L202 706 Z", fill="#0e1a14") +
                  el("line", x1="224", y1="640", x2="330", y2="640", stroke="#00e87a",
                     stroke_width="4", stroke_opacity="0.8") +
                  el("line", x1="226", y1="658", x2="320", y2="658", stroke="#7fffb2",
                     stroke_width="3", stroke_opacity="0.5") +
                  hand(206, 640, c, 22) + hand(354, 640, c, 22))
    else:
        # posa unica: mani abbassate/incrociate
        p["a"] = (sleeve(160, 490, 236, 650, 72, sl) + sleeve(400, 490, 324, 650, 72, sl) +
                  hand(250, 660, c, 22) + hand(310, 660, c, 22))
    return p


# ── Espressioni (sopracciglia + bocca) ──────────────────────────────────

def brow(x, y, ang=0.0, width=52, thick=9, col=INK) -> str:
    import math
    a = math.radians(ang)
    dx, dy = math.cos(a) * width / 2, math.sin(a) * width / 2
    return el("path",
              d=f"M{x-dx:.0f} {y-dy:.0f} Q{x:.0f} {y-10:.0f} {x+dx:.0f} {y+dy:.0f}",
              fill="none", stroke=col, stroke_opacity="0.85",
              stroke_width=str(thick), stroke_linecap="round")


def faces_for(c: dict) -> dict:
    cx, cy = HEAD_C
    bl, br = cx - 40, cx + 40      # x sopracciglia
    by = cy - 56                    # y sopracciglia (sopra gli occhiali)
    my = cy + 50                    # y bocca
    bcol = c["hair"] if c.get("beard") else INK
    F = {}
    F["neutro"] = (brow(bl, by, 0) + brow(br, by, 0) +
                   el("path", d=f"M{cx-22} {my} Q{cx} {my+6} {cx+22} {my}",
                      fill="none", stroke=INK, stroke_opacity="0.8", stroke_width="5",
                      stroke_linecap="round"))
    F["caldo"] = (brow(bl, by - 4, -6) + brow(br, by - 4, 6) +
                  el("path", d=f"M{cx-26} {my-4} Q{cx} {my+18} {cx+26} {my-4}",
                     fill="none", stroke=INK, stroke_opacity="0.85", stroke_width="6",
                     stroke_linecap="round"))
    F["pensieroso"] = (brow(bl, by - 14, -12) + brow(br, by + 2, -4) +
                       el("path", d=f"M{cx-18} {my+4} Q{cx+2} {my-2} {cx+20} {my+6}",
                          fill="none", stroke=INK, stroke_opacity="0.8", stroke_width="5",
                          stroke_linecap="round"))
    F["sorpreso"] = (brow(bl, by - 22, 0, 48) + brow(br, by - 22, 0, 48) +
                     el("ellipse", cx=str(cx), cy=str(my + 4), rx="14", ry="20",
                        fill=INK, fill_opacity="0.85"))
    F["severo"] = (brow(bl, by + 4, 14) + brow(br, by + 4, -14) +
                   el("path", d=f"M{cx-22} {my+6} L{cx+22} {my+6}",
                      fill="none", stroke=INK, stroke_opacity="0.85", stroke_width="6",
                      stroke_linecap="round"))
    F["divertito"] = (brow(bl, by - 12, -8) + brow(br, by - 12, 8) +
                      el("path", d=f"M{cx-30} {my-6} Q{cx} {my+30} {cx+30} {my-6} "
                                   f"Q{cx} {my+10} {cx-30} {my-6} Z",
                         fill=INK, fill_opacity="0.85") +
                      el("path", d=f"M{cx-18} {my+1} Q{cx} {my+10} {cx+18} {my+1}",
                         fill="#f0f0fa", fill_opacity="0.9",
                         stroke="none"))
    return F


# ── Main ────────────────────────────────────────────────────────────────

# Quali pose/espressioni servono a ogni personaggio nel vertical slice
ROSTER = {
    "mentor": {"poses": ["a", "b", "c", "d"],
               "faces": ["neutro", "caldo", "pensieroso", "sorpreso", "severo", "divertito"]},
    "assistente": {"poses": ["a", "b"],
                   "faces": ["neutro", "caldo", "sorpreso", "divertito"]},
    "scout": {"poses": ["a"], "faces": ["neutro", "caldo", "pensieroso"]},
    "scorer": {"poses": ["a"], "faces": ["neutro", "pensieroso", "caldo"]},
    "coordinatore": {"poses": ["a"], "faces": ["neutro", "caldo", "severo"]},
    "analista": {"poses": ["a"], "faces": ["neutro", "pensieroso", "caldo"]},
}


def write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)


def main() -> None:
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    for slug, spec in ROSTER.items():
        c = CHARS[slug]
        d = os.path.join(OUT, slug)
        base = bust(c) + head_base(c) + beard_portrait(c) + hair_portrait(c) + glasses()
        write(os.path.join(d, "base.svg"), svg(base))
        poses = poses_for(slug, c)
        for pk in spec["poses"]:
            write(os.path.join(d, f"pose_{pk}.svg"), svg(poses[pk]))
        faces = faces_for(c)
        for fk in spec["faces"]:
            write(os.path.join(d, f"face_{fk}.svg"), svg(faces[fk]))
    count = sum(len(files) for _, _, files in os.walk(OUT))
    print(f"OK: generati {count} SVG ritratto in {OUT}")


if __name__ == "__main__":
    main()
