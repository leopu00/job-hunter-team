#!/usr/bin/env python3
"""Generatore degli sprite SVG in-world dei personaggi di JHT: The Office.

Ogni personaggio è composto da layer separati (testa, torso+braccia, gamba)
per direzione (front / side / back); il rig Godot li impila e li anima via
codice (swing gambe, bob, respiro). Le geometrie sono condivise, le palette
per-personaggio imitano i PNG di riferimento in web/public/agents-*.png
(stile flat/inchiostrato, occhiali tondi scuri per gli agenti).

Output: game/assets/characters/gen/<slug>/<parte>_<direzione>.svg
Pipeline documentata in game/docs/ASSETS.md. Uso: python3 build.py
"""

import os
import shutil

SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(SRC), "gen")

# Canvas sprite: 64×96, piedi a y≈94, testa r≈9.5 centrata a (32,15).
W, H = 64, 96
INK = '#0c0c12'  # colore "china" per i contorni

# ── Palette per personaggio (dai PNG di riferimento) ────────────────────

CHARS = {
    "coordinatore": {
        "skin": "#e8c49a", "skin_dark": "#d3a877",
        "hair": "#4a3627", "hair_style": "short",
        "outfit": "suit",
        "coat": "#7e8a70", "coat_dark": "#66725a", "shirt": "#e8e0c8",
        "vest": "#cfc4a4", "tie": "#3f5540",
        "trouser": "#6e7a62", "shoe": "#4a3524",
        "glasses": True, "beard": None,
    },
    "scout": {
        "skin": "#e3bd92", "skin_dark": "#cda172",
        "hair": "#6b5c4c", "hair_style": "short",
        "outfit": "trench",
        "coat": "#c9b491", "coat_dark": "#af9a78", "shirt": "#e8e0c8",
        "vest": "#3d4a3f", "tie": "#2e3a30",
        "trouser": "#3d4a3f", "shoe": "#5a3e28",
        "glasses": True, "beard": "goatee",
    },
    "analista": {
        "skin": "#e6c096", "skin_dark": "#d1a575",
        "hair": "#3b2d26", "hair_style": "bun",
        "outfit": "labcoat",
        "coat": "#e9e6dc", "coat_dark": "#d3cec0", "shirt": "#ded4b8",
        "vest": "#ded4b8", "tie": None,
        "trouser": "#3a3a42", "shoe": "#22222a",
        "glasses": True, "beard": None,
    },
    "scorer": {
        "skin": "#e3bd92", "skin_dark": "#cda172",
        "hair": "#33261e", "hair_style": "wavy",
        "outfit": "casual",
        "coat": "#2e3442", "coat_dark": "#242a36", "shirt": "#2e3442",
        "vest": None, "tie": None,
        "trouser": "#2a2d38", "shoe": "#3a2e22",
        "glasses": True, "beard": None,
    },
    "mentor": {
        "skin": "#e0c09c", "skin_dark": "#caa679",
        "hair": "#d8d5cc", "hair_style": "old",
        "outfit": "robe",
        "coat": "#8a8168", "coat_dark": "#726a54", "shirt": "#d8d0b4",
        "vest": "#d8d0b4", "tie": None, "sash": "#6e5340",
        "trouser": "#8a8168", "shoe": "#4a3a2a",
        "glasses": True, "beard": "full",
    },
    "assistente": {
        "skin": "#dfb890", "skin_dark": "#c99e6e",
        "hair": "#5a4232", "hair_style": "updo",
        "outfit": "blazer",
        "coat": "#a08b76", "coat_dark": "#8a7662", "shirt": "#e2d7bd",
        "vest": None, "tie": None,
        "trouser": "#4a3d33", "shoe": "#3a2a1e",
        "glasses": True, "beard": None,
    },
    "maintainer": {
        "skin": "#e6c096", "skin_dark": "#d1a575",
        "hair": "#7a6a55", "hair_style": "short",
        "outfit": "labcoat",
        "coat": "#e9e6dc", "coat_dark": "#d3cec0", "shirt": "#b8c0cc",
        "vest": "#b8c0cc", "tie": None,
        "trouser": "#4a4e58", "shoe": "#2a2a32",
        "glasses": False, "beard": None,
    },
}

# Avatar giocatore: basi (corporatura+pelle) × capelli tintabili × giacca
# tintabile. I layer bianchi (hair/jacket) vengono colorati dal rig con
# modulate: l'ombreggiatura è nera semi-trasparente e sopravvive alla tinta.
PLAYER_BASES = {
    "a": {"skin": "#e8c49a", "skin_dark": "#d3a877"},
    "b": {"skin": "#c68d5c", "skin_dark": "#ab7444"},
    "c": {"skin": "#8d5a3b", "skin_dark": "#75482d"},
}
PLAYER_HAIR_STYLES = ["short", "long", "curly"]

# ── Helpers SVG ──────────────────────────────────────────────────────────


def svg(body: str) -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
            f'viewBox="0 0 {W} {H}">\n{body}\n</svg>\n')


def leg_svg(body: str) -> str:
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="42" '
            f'viewBox="0 0 16 42">\n{body}\n</svg>\n')


def el(tag: str, **attrs) -> str:
    parts = " ".join(f'{k.replace("_", "-")}="{v}"' for k, v in attrs.items() if v is not None)
    return f"<{tag} {parts}/>"


def outline(extra: float = 0.0):
    return {"stroke": INK, "stroke_opacity": "0.5", "stroke_width": str(1.0 + extra)}


def shade(d: str, alpha=0.16) -> str:
    return f'<path d="{d}" fill="#000000" fill-opacity="{alpha}"/>'


# ── Teste ────────────────────────────────────────────────────────────────

def hair_front(style: str, color: str) -> str:
    o = outline()
    if style == "short":
        return el("path", d="M22.5 13 Q22 4.5 32 4.5 Q42 4.5 41.5 13 Q40 8.5 32 8.5 Q24 8.5 22.5 13 Z",
                  fill=color, **o)
    if style == "wavy":
        return el("path", d="M22.5 14 Q21 4 32 4.5 Q43 4 41.5 14 Q42 9 38 8 Q40 11 36 9.5 Q37 12 32 8.5 Q26 9 25 12 Q24 9 22.5 14 Z",
                  fill=color, **o)
    if style == "bun":
        return (el("circle", cx="32", cy="4.5", r="4", fill=color, **o) +
                el("path", d="M22.5 13.5 Q22 5.5 32 5.5 Q42 5.5 41.5 13.5 Q40 9 32 9 Q24 9 22.5 13.5 Z",
                   fill=color, **o))
    if style == "updo":
        return (el("circle", cx="38", cy="5", r="3.6", fill=color, **o) +
                el("path", d="M22.5 14 Q21.5 5 32 5 Q42.5 5 41.5 14 Q40 9 32 8.7 Q24 9 22.5 14 Z",
                   fill=color, **o))
    if style == "old":  # stempiato, capelli laterali
        return el("path", d="M22.5 15 Q22 9 26 7.5 Q24.5 11 27 10 L37 10 Q39.5 11 38 7.5 Q42 9 41.5 15 Q41 11.5 39 11.5 L25 11.5 Q23 11.5 22.5 15 Z",
                  fill=color, **o)
    if style == "long":
        return el("path", d="M21.5 13 Q21 4 32 4 Q43 4 42.5 13 L42.5 24 Q40 26 39.5 22 L39 12 Q36 8.5 32 8.5 Q28 8.5 25 12 L24.5 22 Q24 26 21.5 24 Z",
                  fill=color, **o)
    if style == "curly":
        return el("path", d="M21.5 14 Q20 3.5 32 4 Q44 3.5 42.5 14 Q43.5 10 40 9 Q41 12 37.5 10 Q38.5 13 34 10.5 Q30 12.5 27.5 10.5 Q26 13 24.5 10 Q22.5 11 22.5 14 Z",
                  fill=color, **o)
    return ""


def hair_side(style: str, color: str) -> str:
    o = outline()
    if style == "short":
        return el("path", d="M25 13 Q24 4.5 33 4.5 Q41.5 5 41 14 Q41 9 36 8.5 Q27 8.5 26.5 15 Q25.5 15 25 13 Z",
                  fill=color, **o)
    if style == "wavy":
        return el("path", d="M25 14 Q23.5 4 33 4.5 Q42 4.5 41 15 Q41.5 10 37.5 9 Q39 12 34 9.5 Q28 9.5 27 15.5 Q25.5 15.5 25 14 Z",
                  fill=color, **o)
    if style == "bun":
        return (el("circle", cx="24.5", cy="6", r="4", fill=color, **o) +
                el("path", d="M25.5 12.5 Q25.5 5.5 33 5.5 Q41 6 40.5 14 Q40 9.5 34 9 Q27 9 26.5 14 Q25.8 14 25.5 12.5 Z",
                   fill=color, **o))
    if style == "updo":
        return (el("circle", cx="25", cy="6.5", r="3.6", fill=color, **o) +
                el("path", d="M25.5 13 Q25.5 5.5 33 5.5 Q41.5 6 41 14.5 Q40 10 34 9.2 Q27.5 9.2 27 14.5 Q26 14.5 25.5 13 Z",
                   fill=color, **o))
    if style == "old":
        return el("path", d="M25.5 15.5 Q25 9.5 28 8 Q27 11.5 30 10.5 Q34.5 10.5 36.5 8 Q41.5 9.5 41 16 Q40.5 12 37 12 Q32 12.5 29 13.5 Q26.5 13.5 26.8 17 Q25.8 17 25.5 15.5 Z",
                  fill=color, **o)
    if style == "long":
        return el("path", d="M24.5 13 Q24 4 33 4 Q42.5 4.5 42 14 L41.5 24 Q40 26.5 39.5 22.5 L39.5 13 Q37 8.5 32 8.7 Q27.5 9 27 14 L26.5 23 Q25 26 24.5 22 Z",
                  fill=color, **o)
    if style == "curly":
        return el("path", d="M24 14 Q22.5 3.5 33 4 Q44 4.5 41.5 15 Q42.5 10.5 39 10 Q40 12.5 36 11 Q32 12.5 29 11 Q27 13 26 10.5 Q24.8 11.5 24.5 15.5 Q24.2 15.5 24 14 Z",
                  fill=color, **o)
    return ""


def hair_back(style: str, color: str) -> str:
    o = outline()
    base = el("path", d="M22.5 17 Q21.5 4.5 32 4.5 Q42.5 4.5 41.5 17 Q41 22 38 23.5 L26 23.5 Q23 22 22.5 17 Z",
              fill=color, **o)
    if style == "bun":
        return base + el("circle", cx="32", cy="6", r="4.4", fill=color, **o)
    if style == "updo":
        return base + el("circle", cx="32", cy="6.5", r="4", fill=color, **o)
    if style == "old":
        return el("path", d="M23 16 Q23 10 26.5 9 L37.5 9 Q41 10 41 16 Q40.5 21 37.5 22.5 L26.5 22.5 Q23.5 21 23 16 Z",
                  fill=color, **o)
    if style == "long":
        return el("path", d="M21.5 16 Q21 4 32 4 Q43 4 42.5 16 L42 26 Q38 28.5 26 28.5 Q22.5 27 22 26 Z",
                  fill=color, **o)
    return base


def face_front(c: dict, player=False) -> str:
    s = ""
    # collo
    s += el("rect", x="29", y="20", width="6", height="7", rx="2", fill=c["skin_dark"])
    # orecchie
    s += el("circle", cx="22.6", cy="15.5", r="2", fill=c["skin"], **outline())
    s += el("circle", cx="41.4", cy="15.5", r="2", fill=c["skin"], **outline())
    # volto
    s += el("circle", cx="32", cy="15", r="9.5", fill=c["skin"], **outline())
    s += shade("M36 6.8 Q41.5 9.5 41 16.5 Q40.5 21.5 36.5 23.7 Q41 19 40.5 14 Q40 9.5 36 6.8 Z", 0.12)
    if c.get("beard") == "full":
        s += el("path", d="M24.5 17 Q25 24.5 32 25 Q39 24.5 39.5 17 Q39.5 22 36 26.5 L28 26.5 Q24.5 22 24.5 17 Z",
                fill=c["hair"], **outline())
        s += el("path", d="M29.5 19.4 Q32 20.6 34.5 19.4", fill="none", stroke=INK,
                stroke_opacity="0.75", stroke_width="1.1")
    elif c.get("beard") == "goatee":
        s += el("path", d="M29 21.5 Q32 23.8 35 21.5 L34.2 24 Q32 25.2 29.8 24 Z",
                fill=c["hair"], **outline())
        s += el("path", d="M29.8 19.2 Q32 20.4 34.2 19.2", fill="none", stroke=INK,
                stroke_opacity="0.75", stroke_width="1.1")
    else:
        s += el("path", d="M29.5 19.8 Q32 21.3 34.5 19.8", fill="none", stroke=INK,
                stroke_opacity="0.75", stroke_width="1.2")
    if player:
        # niente occhiali scuri: il giocatore è l'umano della box
        s += el("circle", cx="28.4", cy="14.6", r="1.25", fill=INK)
        s += el("circle", cx="35.6", cy="14.6", r="1.25", fill=INK)
        s += el("path", d="M26.3 11.8 Q28.4 10.8 30.3 11.8", fill="none", stroke=INK,
                stroke_opacity="0.8", stroke_width="1.1")
        s += el("path", d="M33.7 11.8 Q35.6 10.8 37.7 11.8", fill="none", stroke=INK,
                stroke_opacity="0.8", stroke_width="1.1")
    elif c.get("glasses"):
        s += el("line", x1="30.9", y1="14.6", x2="33.1", y2="14.6", stroke="#8a7a52",
                stroke_width="0.9")
        s += el("line", x1="24.2", y1="14.2", x2="25.6", y2="14.4", stroke="#8a7a52",
                stroke_width="0.8")
        s += el("line", x1="39.8", y1="14.2", x2="38.4", y2="14.4", stroke="#8a7a52",
                stroke_width="0.8")
        for cx in ("28.4", "35.6"):
            s += el("circle", cx=cx, cy="14.8", r="3", fill="#12121a",
                    stroke="#8a7a52", stroke_width="0.9")
            s += el("circle", cx=str(float(cx) - 1.0), cy="13.8", r="0.8",
                    fill="#b8c8d8", fill_opacity="0.85")
    return s


def face_side(c: dict, player=False) -> str:
    s = ""
    s += el("rect", x="28", y="20", width="6", height="7", rx="2", fill=c["skin_dark"])
    s += el("path", d="M23.5 15 Q23.5 5.5 33 5.5 Q42 5.5 42 15 Q42.5 17.5 44 18.5 Q42.8 19.6 41.5 19.3 Q40.5 24.5 33 24.5 Q23.5 24 23.5 15 Z",
            fill=c["skin"], **outline())  # profilo con naso verso destra
    s += shade("M36 6.5 Q42 9.5 41.8 15 Q41.5 21 35.5 24 Q40 19.5 40 14.5 Q39.8 9.5 36 6.5 Z", 0.12)
    s += el("circle", cx="27.5", cy="16", r="2", fill=c["skin_dark"])
    if c.get("beard") == "full":
        s += el("path", d="M33 24.8 Q40.5 24.5 41.3 19.5 Q43 23 40 26.8 Q36.5 28.5 33 27.5 Z",
                fill=c["hair"], **outline())
    elif c.get("beard") == "goatee":
        s += el("path", d="M38 22.5 Q41 22 41.3 20.5 Q42.3 23.5 40 25.2 Q38.5 25.8 37.5 25 Z",
                fill=c["hair"], **outline())
    s += el("path", d="M38.5 20.6 Q40 21 41 20.4", fill="none", stroke=INK,
            stroke_opacity="0.7", stroke_width="1.1")
    if player:
        s += el("circle", cx="38.6", cy="14.6", r="1.2", fill=INK)
        s += el("path", d="M36.8 11.9 Q38.6 11 40.4 12", fill="none", stroke=INK,
                stroke_opacity="0.8", stroke_width="1.1")
    elif c.get("glasses"):
        s += el("line", x1="27", y1="14.5", x2="35.5", y2="14.6", stroke="#8a7a52",
                stroke_width="0.8")
        s += el("circle", cx="37.8", cy="14.8", r="3", fill="#12121a",
                stroke="#8a7a52", stroke_width="0.9")
        s += el("circle", cx="36.9", cy="13.8", r="0.8", fill="#b8c8d8", fill_opacity="0.85")
    return s


def head_front(c: dict, player=False, hair=True) -> str:
    body = face_front(c, player)
    if hair:
        body += hair_front(c["hair_style"], c["hair"])
    return svg(body)


def head_side(c: dict, player=False, hair=True) -> str:
    body = face_side(c, player)
    if hair:
        body += hair_side(c["hair_style"], c["hair"])
    return svg(body)


def head_back(c: dict, hair=True) -> str:
    body = el("rect", x="29", y="20", width="6", height="7", rx="2", fill=c["skin_dark"])
    body += el("circle", cx="32", cy="15", r="9.5", fill=c["skin"], **outline())
    if hair:
        body += hair_back(c["hair_style"], c["hair"])
    return svg(body)


# ── Torsi (con braccia) ─────────────────────────────────────────────────

def arms_front(c: dict, sleeve: str, length=26) -> str:
    s = ""
    for x in (17.5, 39.5):
        s += el("rect", x=str(x), y="28", width="7", height=str(length), rx="3.5",
                fill=sleeve, **outline())
    hy = 28 + length + 1.5
    for cx in (21, 43):
        s += el("circle", cx=str(cx), cy=str(hy), r="2.8", fill=c["skin"], **outline())
    return s


def arm_side(c: dict, sleeve: str, length=26) -> str:
    s = el("rect", x="28.5", y="28", width="7", height=str(length), rx="3.5",
           fill=sleeve, **outline())
    s += el("circle", cx="32", cy=str(28 + length + 1.5), r="2.8", fill=c["skin"], **outline())
    return s


def torso_front(c: dict) -> str:
    o = outline()
    fit = c["outfit"]
    s = ""
    if fit == "suit" or fit == "blazer":
        s += el("path", d="M23 27 Q32 23.5 41 27 L43.5 57 L20.5 57 Z", fill=c["coat"], **o)
        s += shade("M37 25.5 L43.5 57 L36 57 Q39.5 42 37 25.5 Z")
        if c.get("vest"):
            s += el("path", d="M27.5 26 L32 33 L36.5 26 L38.5 50 L25.5 50 Z", fill=c["vest"], **o)
        s += el("path", d="M28.5 25.5 L32 31.5 L35.5 25.5 Q32 23.8 28.5 25.5 Z", fill=c["shirt"], **o)
        if c.get("tie"):
            s += el("path", d="M30.8 27.5 L33.2 27.5 L33.8 41 L32 44 L30.2 41 Z", fill=c["tie"], **o)
        # revers
        s += el("path", d="M28.5 25.5 L32 31.5 L26.5 34 L25.5 27.2 Z", fill=c["coat_dark"], **o)
        s += el("path", d="M35.5 25.5 L32 31.5 L37.5 34 L38.5 27.2 Z", fill=c["coat_dark"], **o)
        s += arms_front(c, c["coat_dark"])
    elif fit == "trench":
        s += el("path", d="M22.5 27 Q32 23.5 41.5 27 L45 72 L19 72 Z", fill=c["coat"], **o)
        s += shade("M37 25.5 L45 72 L36.5 72 Q40.5 46 37 25.5 Z")
        s += el("line", x1="32", y1="34", x2="32", y2="71", stroke=c["coat_dark"], stroke_width="1.4")
        s += el("path", d="M28.5 25.5 L32 31 L35.5 25.5 Q32 23.8 28.5 25.5 Z", fill=c["shirt"], **o)
        s += el("path", d="M30 26.5 L32 31 L34 26.5 L34.5 33 L29.5 33 Z", fill=c["vest"], **o)
        s += el("path", d="M28.5 25.5 L32 31 L26 33.5 L25 27.2 Z", fill=c["coat_dark"], **o)
        s += el("path", d="M35.5 25.5 L32 31 L38 33.5 L39 27.2 Z", fill=c["coat_dark"], **o)
        s += el("rect", x="24", y="44", width="4.5", height="2", fill=c["coat_dark"])
        s += el("rect", x="35.5", y="44", width="4.5", height="2", fill=c["coat_dark"])
        s += arms_front(c, c["coat"])
    elif fit == "labcoat":
        s += el("path", d="M22.5 27 Q32 23.5 41.5 27 L44.5 74 L19.5 74 Z", fill=c["coat"], **o)
        s += shade("M37 25.5 L44.5 74 L36.5 74 Q40.5 47 37 25.5 Z", 0.10)
        s += el("path", d="M29 25.8 L32 31 L35 25.8 Q32 24 29 25.8 Z", fill=c["shirt"], **o)
        s += el("path", d="M29 25.8 L32 31 L26.5 34.5 L25.2 27.2 Z", fill=c["coat_dark"], **o)
        s += el("path", d="M35 25.8 L32 31 L37.5 34.5 L38.8 27.2 Z", fill=c["coat_dark"], **o)
        s += el("line", x1="32", y1="33", x2="32", y2="73", stroke=c["coat_dark"], stroke_width="1.2")
        s += el("rect", x="24.5", y="48", width="5", height="6", fill="none",
                stroke=c["coat_dark"], stroke_width="0.9")  # taschino
        s += arms_front(c, c["coat"])
    elif fit == "robe":
        # tunica lunga fino alle caviglie: copre le gambe
        s += el("path", d="M23 27 Q32 23.5 41 27 L47 89 L17 89 Z", fill=c["coat"], **o)
        s += shade("M36.5 25.5 L47 89 L36 89 Q41 52 36.5 25.5 Z")
        s += el("path", d="M28 26 L32 36 L36 26 Q32 24 28 26 Z", fill=c["shirt"], **o)
        s += el("path", d="M30 27 L32 36 L34 27 L35.5 88 L28.5 88 Z", fill=c["vest"], **o)
        s += el("rect", x="25", y="50", width="14", height="4", fill=c.get("sash", c["coat_dark"]), **o)
        s += arms_front(c, c["coat_dark"], length=28)
    else:  # casual
        s += el("path", d="M23 27 Q32 23.5 41 27 L43 58 L21 58 Z", fill=c["coat"], **o)
        s += shade("M36.5 25.5 L43 58 L35.5 58 Q39.5 42 36.5 25.5 Z")
        s += el("path", d="M28.5 25.5 Q32 28.5 35.5 25.5", fill="none",
                stroke=c["coat_dark"], stroke_width="1.4")
        s += arms_front(c, c["coat"])
        s += el("rect", x="17.8", y="44", width="6.4", height="2.4", rx="1.2", fill="#8a7a52")
    return svg(s)


def torso_side(c: dict) -> str:
    o = outline()
    fit = c["outfit"]
    s = ""
    hem = {"suit": 57, "blazer": 57, "casual": 58, "trench": 72, "labcoat": 74, "robe": 89}[fit]
    w_top, w_bot = 13, 15 if hem < 60 else 18
    if fit == "robe":
        w_bot = 24
    x0t, x1t = 32 - w_top / 2, 32 + w_top / 2
    x0b, x1b = 32 - w_bot / 2, 32 + w_bot / 2
    s += el("path", d=f"M{x0t} 27 Q32 24 {x1t} 27 L{x1b} {hem} L{x0b} {hem} Z",
            fill=c["coat"], **o)
    s += shade(f"M{x1t - 3} 26 L{x1b} {hem} L{x1b - 4} {hem} Q{x1t - 1} 42 {x1t - 3} 26 Z")
    if fit in ("trench", "labcoat"):
        s += el("line", x1=str(x1b - 3), y1="34", x2=str(x1b - 2.2), y2=str(hem - 1),
                stroke=c["coat_dark"], stroke_width="1.2")
    if fit == "robe":
        s += el("rect", x=str(x0b + 2), y="50", width=str(w_bot - 6), height="4",
                fill=c.get("sash", c["coat_dark"]), **o)
    s += arm_side(c, c["coat_dark"] if fit in ("suit", "blazer", "robe") else c["coat"],
                  28 if fit == "robe" else 26)
    return svg(s)


def leg(c: dict, side_view=False) -> str:
    s = el("rect", x="5", y="1", width="6", height="33", rx="3", fill=c["trouser"], **outline())
    if side_view:
        s += el("path", d="M4 32 Q4 37.5 8 38 L13.5 38 Q15 36 12.5 34.5 L10.5 33 Z",
                fill=c["shoe"], **outline())
    else:
        s += el("ellipse", cx="8", cy="36.5", rx="5", ry="3.2", fill=c["shoe"], **outline())
    return leg_svg(s)


# ── Layer tintabili del giocatore (bianco + ombre nere trasparenti) ─────

def player_hair(style: str, view: str) -> str:
    fn = {"front": hair_front, "side": hair_side, "back": hair_back}[view]
    return svg(fn(style, "#ffffff"))


def player_jacket(view: str) -> str:
    o = outline()
    if view == "front":
        s = el("path", d="M23 27 Q32 24 41 27 L43 57 L36.5 57 L36 32 L28 32 L27.5 57 L21 57 Z",
               fill="#ffffff", **o)
        s += shade("M37.5 26 L43 57 L36.5 57 L36.2 33 Q37.5 29.5 37.5 26 Z", 0.22)
        s += arms_front({"skin": "#00000000"}, "#ffffff").replace(
            'fill="#00000000"', 'fill="#ffffff" fill-opacity="0"')
    else:
        s = el("path", d="M25.5 27 Q32 24 38.5 27 L39.5 57 L24.5 57 Z", fill="#ffffff", **o)
        s += shade("M36 26 L39.5 57 L35.5 57 Q37.5 40 36 26 Z", 0.22)
        s += el("rect", x="28.5", y="28", width="7", height="26", rx="3.5", fill="#ffffff", **o)
    return svg(s)


def player_torso(base: dict, view: str) -> str:
    o = outline()
    c = {"skin": base["skin"], "skin_dark": base["skin_dark"]}
    tee = "#c8c8d4"
    tee_dark = "#a8a8b8"
    if view == "front":
        s = el("path", d="M23.5 27 Q32 23.5 40.5 27 L42.5 57 L21.5 57 Z", fill=tee, **o)
        s += shade("M36.5 25.5 L42.5 57 L35.5 57 Q39 42 36.5 25.5 Z", 0.14)
        s += el("path", d="M29 25.5 Q32 27.8 35 25.5", fill="none", stroke=tee_dark,
                stroke_width="1.3")
        for x in (18.5, 39.5):
            s += el("rect", x=str(x), y="28", width="6", height="14", rx="3", fill=tee_dark, **o)
        for cx, cy in ((21.5, 49), (42.5, 49)):
            s += el("rect", x=str(cx - 2.4), y="41", width="4.8", height="8", rx="2.4",
                    fill=c["skin"], **o)
            s += el("circle", cx=str(cx), cy="51", r="2.8", fill=c["skin"], **o)
    else:
        s = el("path", d="M26 27 Q32 24 38 27 L39 57 L25 57 Z", fill=tee, **o)
        s += shade("M35.5 26 L39 57 L35 57 Q37 40 35.5 26 Z", 0.14)
        s += el("rect", x="28.8", y="28", width="6.4", height="14", rx="3", fill=tee_dark, **o)
        s += el("rect", x="29.6", y="41", width="4.8", height="9", rx="2.4", fill=c["skin"], **o)
        s += el("circle", cx="32", cy="52", r="2.8", fill=c["skin"], **o)
    return svg(s)


# ── Prop: clipboard dei maintainer ──────────────────────────────────────

def clipboard() -> str:
    s = el("rect", x="36", y="38", width="11", height="15", rx="1", fill="#8a7050",
           **outline(), transform="rotate(-12 41 45)")
    s += el("rect", x="37.5", y="40", width="8", height="11.5", fill="#e8e4d4",
            transform="rotate(-12 41 45)")
    for i in range(3):
        y = 42.5 + i * 2.6
        s += el("line", x1="38.5", y1=str(y), x2="44.5", y2=str(y), stroke="#7a7a96",
                stroke_width="0.8", transform="rotate(-12 41 45)")
    return svg(s)


# ── Main ────────────────────────────────────────────────────────────────

def write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)


def main() -> None:
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)

    for slug, c in CHARS.items():
        d = os.path.join(OUT, slug)
        write(os.path.join(d, "head_front.svg"), head_front(c))
        write(os.path.join(d, "head_side.svg"), head_side(c))
        write(os.path.join(d, "head_back.svg"), head_back(c))
        write(os.path.join(d, "torso_front.svg"), torso_front(c))
        write(os.path.join(d, "torso_side.svg"), torso_side(c))
        if c["outfit"] != "robe":  # la tunica del Mentor copre le gambe
            write(os.path.join(d, "leg_front.svg"), leg(c))
            write(os.path.join(d, "leg_side.svg"), leg(c, side_view=True))

    d = os.path.join(OUT, "player")
    for key, base in PLAYER_BASES.items():
        pc = {"skin": base["skin"], "skin_dark": base["skin_dark"],
              "hair": "#ffffff", "hair_style": "short"}
        write(os.path.join(d, f"head_{key}_front.svg"), head_front(pc, player=True, hair=False))
        write(os.path.join(d, f"head_{key}_side.svg"), head_side(pc, player=True, hair=False))
        write(os.path.join(d, f"head_{key}_back.svg"), head_back(pc, hair=False))
        write(os.path.join(d, f"torso_{key}_front.svg"), player_torso(base, "front"))
        write(os.path.join(d, f"torso_{key}_side.svg"), player_torso(base, "side"))
    for style in PLAYER_HAIR_STYLES:
        for view in ("front", "side", "back"):
            write(os.path.join(d, f"hair_{style}_{view}.svg"), player_hair(style, view))
    write(os.path.join(d, "jacket_front.svg"), player_jacket("front"))
    write(os.path.join(d, "jacket_side.svg"), player_jacket("side"))
    pl = {"trouser": "#3a3a46", "shoe": "#2a2a32"}
    write(os.path.join(d, "leg_front.svg"), leg(pl))
    write(os.path.join(d, "leg_side.svg"), leg(pl, side_view=True))

    write(os.path.join(OUT, "maintainer", "clipboard.svg"), clipboard())

    count = sum(len(files) for _, _, files in os.walk(OUT))
    print(f"OK: generati {count} SVG in {OUT}")


if __name__ == "__main__":
    main()
