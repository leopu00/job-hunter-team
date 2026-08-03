"""Finestre di montaggio «Now Playable» — TARATE SUI FRAME REALI.

Ogni finestra è 1:1 nel tempo (mai fattori di velocità): skip = primo
frame, dur = secondi; crop = ri-inquadratura spaziale (x0,y0,w,h) dal
nativo 1920x1080 (1440x810 → 720p resta sopra il pixel 1:1). I tagli
interni sono cut-on-action come da regia («se una camminata non sta
nella scena, se ne mostrano gli ultimi secondi»).

I tempi del puntatore della Scena 2 (CLICK_KEYS in make_show.py) sono i
tempi FISSI programmati in promo_director.gd: hover 2.0 · clic 2.6 ·
chip 5.4 · SEND 7.2 · risposta 9.0.
"""
import make_show as MS

# Scena 1 — 5.57 s: alzata → stampante (lampo, foglio) → ritorno e seduta.
OPEN = [
    {"skip": 22, "dur": 1.80, "crop": (240, 135, 1440, 810)},
    {"skip": 208, "dur": 1.80, "crop": (280, 15, 1440, 810)},
    {"skip": 356, "dur": MS.DURS[0] - 3.60, "crop": (60, 135, 1440, 810)},
]

# Scena 2 — 9.49 s: finestra unica dal secondo 1.2 del clip (la
# conversazione è programmata; il puntatore è disegnato con CLICK_KEYS:
# hover 2.0 · clic 2.6 · chip 5.4 · SEND 7.2 · risposta 9.0 — resta
# ~1.7 s per leggere l'ultima battuta).
CLICK = [
    {"skip": 36, "dur": MS.DURS[1], "crop": None, "cursor": MS.CLICK_KEYS},
]

# Scena 3 — 9.37 s: (a) prelievo dalla vaschetta, (b) arrivo e studio con
# vignetta, (c) macchina da scrivere. Da tarare sui frame del take.
PIXELS = [
    {"skip": 250, "dur": 2.4, "crop": (240, 135, 1440, 810)},
    {"skip": 430, "dur": 3.6, "crop": (240, 135, 1440, 810)},
    {"skip": 660, "dur": MS.DURS[2] - 6.0, "crop": None},
]

# Scena 4 — 11.68 s: Scorer (88) → Scrittore (CV) → Critico → scaffale.
TAILOR = [
    {"skip": 40, "dur": 3.6, "crop": None},
    {"skip": 200, "dur": 3.0, "crop": None},
    {"skip": 460, "dur": MS.DURS[3] - 6.6, "crop": (240, 135, 1440, 810)},
]

# Scena 5 — 11.96 s: quattro finestre 1:1 tarate sugli EVENTI del take
# (web_hunt 37.8 s): mezzo giro col clic Overview (onda a ~16.5), clic sul
# beacon dei Paesi Bassi (onda a 28.0) con flyTo che atterra su Amsterdam,
# poi la scheda: anello 88 + badge, e PASS → clic su «Swipe» (onda ~13.1,
# stacco SUL clic).
GLOBE = [
    (f"{MS.WEB}/web_hunt.webm", 13.6, 3.0),
    (f"{MS.WEB}/web_hunt.webm", 26.2, 3.2),
    (f"{MS.WEB}/web_sheet.webm", 2.8, 2.2),
    (f"{MS.WEB}/web_sheet.webm", 9.8, MS.DURS[4] - 8.4),
]

# Scena 6 — 8.35 s: dal take nuovo (20.1 s): la GreenGrid 88 in primo piano
# → stella (~13.4, vola a destra) → entra la 58 → X (~17.2) → entra la
# terza (63) e respira fino a fine scena.
SWIPE = (f"{MS.WEB}/web_swipe.webm", 11.5, MS.DURS[5])

# Scena 7 — 12.25 s: the-box (Ken Burns) + notte alla scrivania.
HOME_BOX_DUR = 6.1
HOME_NIGHT = {"skip": 60, "dur": MS.DURS[6] - HOME_BOX_DUR, "crop": None}

SHOTS = {
    "open": OPEN,
    "click": CLICK,
    "pixels": PIXELS,
    "tailor": TAILOR,
    "globe": GLOBE,
    "swipe": SWIPE,
    "home_box_dur": HOME_BOX_DUR,
    "home_night": HOME_NIGHT,
}

# ── VERTICALE (colonna 608 dal nativo; x0 per finestra) ────────────────
# Il tocco della Scena 2 è in coordinate OUTPUT 720x1280 del composito
# (vedi make_show_vert.chat_map): chip a (175,1131), SEND a (682,1191).
VERT_CLICK_A_KEYS = [
    (0.65, 750, 640, False),
    (2.00, 348, 598, False),
    (2.55, 348, 598, False),
    (2.60, 348, 598, True),
]
VERT_CLICK_B_KEYS = [
    (3.40, 380, 900, False),
    (4.90, 300, 1050, False),
    (5.30, 175, 1131, False),
    (5.40, 175, 1131, True),
    (6.40, 420, 1170, False),
    (7.05, 682, 1191, False),
    (7.20, 682, 1191, True),
    (8.30, 520, 800, False),
    (12.5, 540, 790, False),
]

_A_DUR = 1.87            # beat A: dal secondo 1.0 del clip fino a ~2.87
VERT = {
    "open": [
        {"skip": 22, "dur": 1.80, "x0": 656},
        {"skip": 208, "dur": 1.80, "x0": 656},
        {"skip": 356, "dur": MS.DURS[0] - 3.60, "x0": 656},
    ],
    "click_a": [
        {"skip": 30, "dur": _A_DUR, "x0": 656, "cursor": VERT_CLICK_A_KEYS},
    ],
    "click_b": {"skip": 30 + int(_A_DUR * 30), "dur": MS.DURS[1] - _A_DUR,
                "cursor": VERT_CLICK_B_KEYS},
    "pixels": [
        {"skip": 250, "dur": 2.4, "x0": 656},
        {"skip": 430, "dur": 3.6, "x0": 656},
        {"skip": 660, "dur": MS.DURS[2] - 6.0, "x0": 656},
    ],
    "tailor": [
        {"skip": 40, "dur": 3.6, "x0": 656},
        {"skip": 200, "dur": 3.0, "x0": 656},
        {"skip": 460, "dur": MS.DURS[3] - 6.6, "x0": 656},
    ],
    # Stessi eventi del desktop, sui take mobili: mezzo giro (drag di
    # ritorno), tap sul beacon (~24.4) + flyTo su Amsterdam (26), anello 88,
    # poi «Verdict: PASS» del Critico col cerchio di tocco.
    "globe": [
        (f"{MS.WEB}/web_hunt_m.webm", 11.5, 3.0),
        (f"{MS.WEB}/web_hunt_m.webm", 23.6, 3.2),
        (f"{MS.WEB}/web_sheet_m.webm", 3.0, 2.2),
        (f"{MS.WEB}/web_sheet_m.webm", 7.6, MS.DURS[4] - 8.4),
    ],
    # Take mobile (19.9 s): 88 dal 6.2, stella ~10.4, X ~14.0, terza dal
    # 14.5 — il t0 mobile NON segue quello desktop: i tap cadono prima.
    "swipe": (f"{MS.WEB}/web_swipe_m.webm", 7.0, MS.DURS[5]),
    "home_box_dur": HOME_BOX_DUR,
    "home_night": {"skip": 60, "dur": MS.DURS[6] - HOME_BOX_DUR, "x0": 656},
}
