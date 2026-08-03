#!/usr/bin/env python3
"""Versione VERTICALE 9:16 (720x1280) del video finale (sober, senza musica).

Stessa timeline e stessa voce di make_show.py (la traccia si riusa pari
pari: durate identiche scena per scena — ora calcolate dalla durata REALE
delle battute); ogni scena è RICOMPOSTA per la colonna stretta.

Tornata 03/08-bis:
  - RIPRESE A VELOCITÀ NATURALE: come nell'orizzontale, web_segment_vert
    non ha più il parametro speed — si sceglie la finestra, non si comprime;
  - residuo segnalato dall'utente (~24 s, lettere mozzate in basso a
    sinistra): era la scritta a pavimento del reparto RESEARCH ("They scout
    the web for openings for you") che transita nel girato durante il push
    della camera di gioco; il vecchio sweep della colonna la incrociava a
    metà transito lasciando frammenti fermi sul bordo. Ora lo sweep parte
    QUANDO la scritta scivola via (f150) e la insegue verso destra: il testo
    esce dal bordo in movimento (pan naturale), mai frammenti statici; la
    chiusura a x0=455 tiene in quadro ENTRAMBE le vignette (la 2ª,
    "Two look promising…", occupa x605-1058 nei frame nativi);
  - didascalie tolte dove ora parla la voce (meeting, chat); su dept la
    banda al piede resta (copre la scritta APPLICATIONS mozzata dal
    ritaglio) ma con testo NON doppione della battuta;
  - la banda opaca "SIMULATION — not real data" in alto resta: badge
    sempre completo anche in colonna (soluzione già confermata).

Chat: composito (header + vignette a tutta larghezza + ritratto).
Web: riprese MOBILI vere (viewport 390x693 dsf2 di record_web.py).

Output: jht-show-vertical-sober.mp4
"""
import math, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

import make_show as HS          # timeline, audio, palette, helpers

W, H, FPS = 720, 1280, 30
ROOT = HS.ROOT
PUB = HS.PUB
CAP = HS.CAP
WEB = HS.WEB
BUILD = os.path.join(ROOT, "build-vert")
os.makedirs(BUILD, exist_ok=True)

font = HS.font
ease_out, ease_io = HS.ease_out, HS.ease_io
(BG, GRID, CARD, BORDER, TITLE, BASE, MUTED, DIM, GREEN, STRONG, BLUE) = (
    HS.BG, HS.GRID, HS.CARD, HS.BORDER, HS.TITLE, HS.BASE, HS.MUTED,
    HS.DIM, HS.GREEN, HS.STRONG, HS.BLUE)

DURS = HS.DURS
FADE = HS.FADE
SCENES = HS.SCENES

def bg_frame():
    im = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(im)
    for x in range(0, W, 80):
        d.line([(x, 0), (x, H)], fill=GRID, width=1)
    for y in range(0, H, 80):
        d.line([(0, y), (W, y)], fill=GRID, width=1)
    return im

BGF = bg_frame()

def layer():
    return Image.new("RGBA", (W, H), (0, 0, 0, 0))

alpha_paste = HS.alpha_paste

def pipe_scene(name, dur, frame_fn):
    seg = os.path.join(BUILD, f"{name}.mp4")
    n = int(round(dur * FPS))
    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-crf", "18", "-preset", "fast",
         "-pix_fmt", "yuv420p", seg],
        stdin=subprocess.PIPE)
    for i in range(n):
        proc.stdin.write(frame_fn(i / FPS).convert("RGB").tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit(f"ffmpeg fallito su {name}")
    return seg

# ── finestra 9:16 sulle riprese del gioco ──────────────────────────────
# x0 è un PERCORSO DIRETTO nel tempo di ripresa, tarato sui frame nativi
# 1920x1080. Taratura 03/08-bis per la scena office (residuo segnalato):
#   - f40-150: x0=60 — panoramica; a 60 la pillola "→ QUALITY CHECK"
#     (x570-660) entra INTERA nel quadro invece di restare mozzata al bordo;
#     la scritta RESEARCH piccola (x185-400) resta in campo per intero;
#   - f135-150: la scritta a pavimento del Research cresce ed entra dal
#     bordo sinistro del girato: a colonna ferma è un ingresso dal bordo
#     (pan naturale), nessun frammento statico;
#   - f150-176: lo sweep INSEGUE la scritta che scivola in basso a destra
#     (x0 60→455): il testo esce di quadro in movimento, mentre la vignetta
#     "Boards swept…" (x548-1010) viene rivelata dallo sweep;
#   - f176+: fermo a 455: entrambe le vignette complete (la 2ª occupa
#     x605-1058) e tutti e due gli scout in campo.
CAP_W, CAP_H = 1920, 1080
CROP_W = 608

def office_x0(t):
    # chiusura a f172 (t=5.73): a quel punto la scritta a pavimento è già
    # tutta a sinistra di x455 — niente sliver d'angolo dopo lo sweep
    if t <= 5.0:
        return 60.0
    return 60.0 + 395.0 * ease_io((t - 5.0) / 0.72)

def dept_x0(t):
    p = max(0.0, min(1.0, (t - 3.33) / 4.0))
    return 265.0 - 23.0 * p

# ── didascalie (lower third, colonna) ──────────────────────────────────
def caption_layer(lines, y_bottom=1225, size=22):
    ly = layer()
    d = ImageDraw.Draw(ly)
    f_ = font("Medium", size)
    lh = int(size * 1.5)
    tw = max(d.textlength(s, font=f_) for s in lines)
    pad_x, pad_y = 22, 13
    bh = lh * len(lines) + 2 * pad_y - (lh - size)
    x0 = (W - tw) / 2 - pad_x
    y0 = y_bottom - bh
    d.rounded_rectangle([x0, y0, x0 + tw + 2 * pad_x, y_bottom], radius=12,
                        fill=(16, 18, 30, 235))
    for i, s in enumerate(lines):
        d.text((W / 2, y0 + pad_y + size / 2 + i * lh + 2), s, font=f_,
               fill=(225, 228, 242), anchor="mm")
    return ly

def caption_band(lines, size=22):
    """Variante a BANDA piena al piede del quadro (come la banda SIMULATION
    in testa): serve dove il ritaglio 9:16 lascia sul fondo testo di scena
    non componibile — nella scena dept la scritta APPLICATIONS sul pavimento
    spuntava mozzata ai lati della pillola. La banda opaca la copre tutta."""
    ly = layer()
    d = ImageDraw.Draw(ly)
    f_ = font("Medium", size)
    lh = int(size * 1.5)
    pad_y = 16
    # minimo 118px: con lo skip anticipato di dept (f74) la scritta
    # APPLICATIONS a pavimento parte con le cime a y display ~1185 e scende
    # col lento zoom del girato — la banda deve coprirla dal primo frame
    ch = lh * len(lines) - (lh - size)
    bh = max(118, ch + 2 * pad_y)
    d.rectangle([0, H - bh, W, H], fill=(16, 18, 30, 255))
    y0 = H - bh + (bh - ch) / 2          # testo centrato nella banda
    for i, s in enumerate(lines):
        d.text((W / 2, y0 + size / 2 + i * lh + 2), s, font=f_,
               fill=(225, 228, 242), anchor="mm")
    return ly

# ── banda SIMULATION (fix del badge mozzato) ───────────────────────────
def sim_band():
    """Striscia alta 64px con il badge COMPLETO centrato: copre il badge di
    gioco tagliato dal ritaglio 9:16 e dichiara la simulazione per intero."""
    # OPACA al 100%: sotto c'è il badge di gioco mozzato dal ritaglio, e
    # con l'alpha a 235 il giallo del badge trapelava accanto alla pillola.
    band = Image.new("RGBA", (W, 64), (16, 18, 30, 255))
    d = ImageDraw.Draw(band)
    txt = "SIMULATION — not real data"
    f_ = font("Bold", 22)
    tw = d.textlength(txt, font=f_)
    pad_x = 18
    x0 = (W - tw) / 2 - pad_x
    d.rounded_rectangle([x0, 12, x0 + tw + 2 * pad_x, 52], radius=10,
                        fill=(243, 236, 200, 255))
    d.text((W / 2, 32), txt, font=f_, fill=(60, 54, 20), anchor="mm")
    return band

SIM_BAND = sim_band()

def game_scene_vert(name, clip, skip, dur, x0_fn, caption=None, band=False):
    files = sorted(f for f in os.listdir(os.path.join(CAP, clip))
                   if f.endswith(".png"))
    n = int(dur * FPS)
    if skip + n > len(files):
        sys.exit(f"clip '{clip}': servono {skip + n} frame, trovati {len(files)}")
    cdir = os.path.join(CAP, clip)
    if caption:
        cap_ly = caption_band(caption) if band else caption_layer(caption)
    else:
        cap_ly = None
    def frame(t):
        # clamp: pipe_scene arrotonda la durata al frame (int(round)) e può
        # chiedere UN frame oltre la clip — si ripete l'ultimo, mai IndexError
        i = min(skip + int(t * FPS), len(files) - 1)
        t_cap = i / FPS
        src = Image.open(os.path.join(cdir, files[i])).convert("RGB")
        x0 = max(0.0, min(CAP_W - CROP_W, x0_fn(t_cap)))
        fr = src.crop((int(x0), 0, int(x0) + CROP_W, CAP_H))
        fr = fr.resize((W, H), Image.LANCZOS).convert("RGBA")
        fr.alpha_composite(SIM_BAND, (0, 0))
        if cap_ly is not None:
            fr.alpha_composite(cap_ly)
        return fr
    return pipe_scene(name, dur, frame)

# ── scene testo (colonna) ──────────────────────────────────────────────
def sc_hook(dur):
    t1 = layer(); d = ImageDraw.Draw(t1)
    d.text((W//2, 420), "Job hunting", font=font("ExtraBold", 58), fill=TITLE, anchor="mm")
    d.text((W//2, 498), "is a second job.", font=font("ExtraBold", 58), fill=TITLE, anchor="mm")
    sub = layer(); d = ImageDraw.Draw(sub)
    d.text((W//2, 610), "boards · postings · CVs", font=font("Regular", 26), fill=DIM, anchor="mm")
    d.text((W//2, 650), "every day", font=font("Regular", 26), fill=DIM, anchor="mm")
    def frame(t):
        fr = BGF.copy()
        p = ease_out(t / 0.6)
        alpha_paste(fr, t1, p, dy=22 * (1 - p))
        alpha_paste(fr, sub, ease_out((t - 1.1) / 0.5))
        return fr
    return frame

def sc_reveal(dur):
    lyr_title = layer(); d = ImageDraw.Draw(lyr_title)
    d.text((W//2, 460), "Job Hunter", font=font("ExtraBold", 72), fill=TITLE, anchor="mm")
    d.text((W//2, 552), "Team", font=font("ExtraBold", 72), fill=GREEN, anchor="mm")
    lyr_tag = layer(); d = ImageDraw.Draw(lyr_tag)
    d.text((W//2, 680), "a team of AI agents", font=font("Regular", 26), fill=MUTED, anchor="mm")
    d.text((W//2, 718), "that hunts jobs for you", font=font("Regular", 26), fill=MUTED, anchor="mm")
    f_p = font("Regular", 24)
    prompt = "$ jht team start"
    pw = ImageDraw.Draw(BGF).textlength(prompt + " ", font=f_p)
    px = (W - pw) / 2
    lyr_prompt = layer(); d = ImageDraw.Draw(lyr_prompt)
    d.text((px, 800), prompt, font=f_p, fill=GREEN)
    cursor = layer(); d = ImageDraw.Draw(cursor)
    d.rectangle([px + pw, 802, px + pw + 12, 826], fill=GREEN)
    def frame(t):
        fr = BGF.copy()
        p = ease_out(t / 0.55)
        alpha_paste(fr, lyr_title, p, dy=24 * (1 - p))
        alpha_paste(fr, lyr_tag, ease_out((t - 0.4) / 0.5))
        pp = ease_out((t - 0.8) / 0.4)
        alpha_paste(fr, lyr_prompt, pp)
        if pp >= 1 and (t % 1.0) < 0.6:
            alpha_paste(fr, cursor, 1)
        return fr
    return frame

def sc_meeting(dur):
    # niente didascalia: la scena ora è parlata (battuta 3) — il testo a
    # schermo duplicherebbe la voce.
    src = Image.open(f"{PUB}/landing-hero.png").convert("RGB")
    def frame(t):
        p = ease_io(t / dur)
        # Colonna ancorata al CAPITANO (x≈450-760 nell'illustrazione): il
        # vecchio pan cx 0.50→0.55 lo spingeva fuori quadro — a fine scena
        # restava solo il braccio (segnalato dall'utente). Zoom più sobrio
        # (1.05) e deriva minima: lui e la mano sulla lavagna restano dentro.
        z = 1.0 + 0.05 * p
        ch = src.height / z
        cw = ch * W / H
        cx = 560.0 + 15.0 * p
        cy = 0.46 * src.height
        px0 = max(0, min(src.width - cw, cx - cw / 2))
        py0 = max(0, min(src.height - ch, cy - ch / 2))
        fr = src.crop((int(px0), int(py0), int(px0 + cw), int(py0 + ch)))
        fr = fr.resize((W, H), Image.LANCZOS).convert("RGBA")
        return fr
    return frame

STEPS = HS.STEPS
def pipeline_bar(active, y=1180):
    ly = layer(); d = ImageDraw.Draw(ly)
    f_on, f_off = font("Bold", 18), font("Medium", 18)
    sep = " → "
    widths, total = [], 0
    for i, s in enumerate(STEPS):
        f_ = f_on if i in active else f_off
        w_ = d.textlength(s, font=f_)
        widths.append(w_)
        total += w_
        if i < len(STEPS) - 1:
            total += d.textlength(sep, font=f_off)
    x = (W - total) / 2
    for i, s in enumerate(STEPS):
        d.text((x, y), s, font=(f_on if i in active else f_off),
               fill=(GREEN if i in active else DIM))
        x += widths[i]
        if i < len(STEPS) - 1:
            d.text((x, y), sep, font=f_off, fill=DIM)
            x += d.textlength(sep, font=f_off)
    return ly

def sc_roles(dur):
    # cambi carta sulle cesure REALI della battuta (HS.ROLE_SWITCH)
    cards = []
    for i, (img, role, duty) in enumerate((
            ("agents-scouts.png", "The Scouts", "sweep the job boards"),
            ("agents-analyst.png", "The Analysts", "read every posting"),
            ("agents-scorer.png", "The Scorers", "rate the fit — 0 to 100"))):
        # Ritratti DENTRO la colonna: prima si scalava solo sull'altezza e
        # Analysts/Scorers sbordavano; peggio, il PNG degli Scouts è già
        # tagliato a x=0 nel sorgente e il ritaglio centrato mostrava la
        # scrivania mozzata a mezz'aria sul fondo a griglia (segnalato).
        # Ora: Scouts a filo del bordo sinistro (il taglio del disegno
        # coincide col bordo del quadro), gli altri adattati a 720x560.
        if img == "agents-scouts.png":
            ag = Image.open(f"{PUB}/{img}").convert("RGBA")
            bb = ag.getchannel("A").getbbox()
            if bb:
                ag = ag.crop(bb)
            r = W / ag.width
            ag = ag.resize((W, int(ag.height * r)), Image.LANCZOS)
            lyr_ag = layer()
            lyr_ag.alpha_composite(ag, (0, 150 + (610 - ag.height) // 2))
        else:
            ag = Image.open(f"{PUB}/{img}").convert("RGBA")
            bb = ag.getchannel("A").getbbox()
            if bb:
                ag = ag.crop(bb)
            r = min((W - 20) / ag.width, 560 / ag.height)
            ag = ag.resize((int(ag.width * r), int(ag.height * r)),
                           Image.LANCZOS)
            lyr_ag = layer()
            lyr_ag.alpha_composite(ag, ((W - ag.width) // 2,
                                        150 + (560 - ag.height) // 2))
        lyr_txt = layer(); d = ImageDraw.Draw(lyr_txt)
        d.text((W//2, 800), role, font=font("ExtraBold", 46), fill=TITLE, anchor="mm")
        d.text((W//2, 852), duty, font=font("Regular", 24), fill=MUTED, anchor="mm")
        cards.append((lyr_txt, lyr_ag, pipeline_bar({i})))
    def frame(t):
        k = HS.role_idx(t)
        tk = t - (0 if k == 0 else HS.ROLE_SWITCH[k - 1])
        lyr_txt, lyr_ag, bar = cards[k]
        fr = BGF.copy()
        q = ease_out(tk / 0.45)
        alpha_paste(fr, lyr_ag, min(1, q * 2.2), dy=-30 * (1 - q))
        p = ease_out((tk - 0.05) / 0.4)
        alpha_paste(fr, lyr_txt, p, dy=20 * (1 - p))
        alpha_paste(fr, bar, 1)
        if k == 2:
            a = ease_out((tk - 0.5) / 0.4)
            if a > 0:
                ly = layer(); d = ImageDraw.Draw(ly)
                d.rectangle([60, 880, 660, 980], fill=CARD, outline=BORDER, width=2)
                n = int(round(84 * ease_out((tk - 0.6) / 1.2)))
                d.text((92, 930), f"{n:2d}/100", font=font("ExtraBold", 44),
                       fill=GREEN, anchor="lm")
                d.text((300, 930), "match with\nyour profile",
                       font=font("Regular", 20), fill=MUTED, anchor="lm")
                alpha_paste(fr, ly, a)
        return fr
    return frame

# chat: composito verticale (header + vignette a tutta larghezza + ritratto)
CHAT_HEADER = (20, 28, 480, 68)
CHAT_BUBBLES = (240, 95, 1100, 680)
CHAT_PORTRAIT = (1425, 115, 1815, 970)

def sc_chat(name, skip, dur):
    cdir = os.path.join(CAP, "chat")
    files = sorted(f for f in os.listdir(cdir) if f.endswith(".png"))
    n = int(dur * FPS)
    if skip + n > len(files):
        sys.exit(f"clip 'chat': servono {skip + n} frame, trovati {len(files)}")
    bw = CHAT_BUBBLES[2] - CHAT_BUBBLES[0]
    bh = CHAT_BUBBLES[3] - CHAT_BUBBLES[1]
    bscale = W / bw
    pw_ = CHAT_PORTRAIT[2] - CHAT_PORTRAIT[0]
    ph_ = CHAT_PORTRAIT[3] - CHAT_PORTRAIT[1]
    pscale = 560.0 / ph_
    # niente didascalia: la battuta 7 dice già ask/steer/approve
    def frame(t):
        # stesso clamp di game_scene_vert (pipe_scene arrotonda al frame)
        i = min(skip + int(t * FPS), len(files) - 1)
        src = Image.open(os.path.join(cdir, files[i])).convert("RGB")
        fr = BGF.copy()
        head = src.crop(CHAT_HEADER).resize(
            (int((CHAT_HEADER[2] - CHAT_HEADER[0]) * 1.2),
             int((CHAT_HEADER[3] - CHAT_HEADER[1]) * 1.2)), Image.LANCZOS)
        fr.paste(head, (24, 26))
        bub = src.crop(CHAT_BUBBLES).resize((W, int(bh * bscale)), Image.LANCZOS)
        fr.paste(bub, (0, 96))
        por = src.crop(CHAT_PORTRAIT).resize(
            (int(pw_ * pscale), int(ph_ * pscale)), Image.LANCZOS)
        fr.paste(por, ((W - por.width) // 2, 620))
        return fr
    return pipe_scene(name, dur, frame)

def sc_results(dur):
    head = layer(); d = ImageDraw.Draw(head)
    d.text((W//2, 200), "One real month, hands-off", font=font("Bold", 30), fill=TITLE, anchor="mm")
    d.text((W//2, 248), "public, anonymised data", font=font("Regular", 20), fill=DIM, anchor="mm")
    d.text((W//2, 280), "one beta tester · Jun 3 → Jul 3, 2026", font=font("Regular", 20), fill=DIM, anchor="mm")
    stats = [("658", "positions found", TITLE), ("520", "analysed and scored", BLUE),
             ("307", "strong matches · ≥70", STRONG), ("71/100", "average match", GREEN)]
    cw_, ch_, gap = 620, 168, 26
    gx, gy = (W - cw_)//2, 340
    cards = []
    for i, (num, lab, col) in enumerate(stats):
        y = gy + i * (ch_ + gap)
        ly = layer(); d = ImageDraw.Draw(ly)
        d.rectangle([gx, y, gx + cw_, y + ch_], fill=CARD, outline=BORDER, width=2)
        d.text((gx + cw_//2, y + 66), num, font=font("ExtraBold", 52), fill=col, anchor="mm")
        d.text((gx + cw_//2, y + 122), lab, font=font("Regular", 19), fill=MUTED, anchor="mm")
        cards.append(ly)
    def frame(t):
        fr = BGF.copy()
        alpha_paste(fr, head, ease_out(t / 0.45))
        for k, ly in enumerate(cards):
            p = ease_out((t - 0.25 - 0.15 * k) / 0.45)
            alpha_paste(fr, ly, p, dy=36 * (1 - p))
        return fr
    return frame

def sc_box(dur):
    head = layer(); d = ImageDraw.Draw(head)
    d.text((W//2, 260), "Open source (MIT)", font=font("ExtraBold", 42), fill=TITLE, anchor="mm")
    box = Image.open(f"{PUB}/the-box.png").convert("RGBA")
    bb = box.getchannel("A").getbbox()
    if bb:
        box = box.crop(bb)
    r = 640 / box.width
    box = box.resize((640, int(box.height * r)), Image.LANCZOS)
    lyr_box = layer()
    lyr_box.alpha_composite(box, ((W - box.width) // 2, 400))
    def frame(t):
        fr = BGF.copy()
        alpha_paste(fr, head, ease_out(t / 0.5))
        p = ease_out((t - 0.2) / 0.6)
        alpha_paste(fr, lyr_box, p, dy=40 * (1 - p))
        return fr
    return frame

def sc_cta(dur):
    items = []
    ly = layer(); d = ImageDraw.Draw(ly)
    d.text((W//2, 440), "Job Hunter", font=font("ExtraBold", 72), fill=TITLE, anchor="mm")
    d.text((W//2, 532), "Team", font=font("ExtraBold", 72), fill=GREEN, anchor="mm")
    items.append((ly, 0.0))
    ly = layer(); d = ImageDraw.Draw(ly)
    d.text((W//2, 660), "free · open source · in beta", font=font("Regular", 25), fill=MUTED, anchor="mm")
    items.append((ly, 0.3))
    ly = layer(); d = ImageDraw.Draw(ly)
    d.text((W//2, 760), "jobhunterteam.ai", font=font("Bold", 38), fill=GREEN, anchor="mm")
    items.append((ly, 0.55))
    ly = layer(); d = ImageDraw.Draw(ly)
    d.text((W//2, 828), "github.com/leopu00/", font=font("Medium", 26), fill=BASE, anchor="mm")
    d.text((W//2, 866), "job-hunter-team", font=font("Medium", 26), fill=BASE, anchor="mm")
    items.append((ly, 0.75))
    def frame(t):
        fr = BGF.copy()
        for ly, delay in items:
            p = ease_out((t - delay) / 0.5)
            alpha_paste(fr, ly, p, dy=26 * (1 - p))
        return fr
    return frame

# ── riprese web mobili ─────────────────────────────────────────────────
def web_segment_vert(name, src, t0, dur, caption=None):
    """Ripresa mobile 780x1386 → 720x1280 (ritaglio 9:16 esatto + scala),
    A VELOCITÀ NATURALE: si sceglie la finestra [t0, t0+dur], mai comprimere
    (il vecchio parametro speed è stato eliminato di proposito)."""
    if t0 + dur > HS.ffprobe_dur(src) - 0.1:
        sys.exit(f"{name}: finestra {t0}+{dur:.2f}s oltre la ripresa {src}")
    seg = os.path.join(BUILD, f"{name}.mp4")
    # setpts qui RIBASA solo i timestamp dopo il trim: nessun fattore di
    # velocità.
    vf = (f"trim=start={t0}:end={t0 + dur},setpts=PTS-STARTPTS,"
          f"crop=779:1385:0:0,scale={W}:{H},fps={FPS}")
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", src]
    if caption:
        png = os.path.join(BUILD, f"{name}_cap.png")
        caption_layer(caption).save(png)
        cmd += ["-i", png, "-filter_complex",
                f"[0:v]{vf}[v];[v][1:v]overlay=0:0[out]", "-map", "[out]"]
    else:
        cmd += ["-vf", vf]
    subprocess.run(cmd + ["-c:v", "libx264", "-crf", "18", "-preset", "fast",
                          "-pix_fmt", "yuv420p", seg], check=True)
    return seg

# ── montaggio ──────────────────────────────────────────────────────────
def build_video():
    segs = {}
    print("scene testo…")
    segs["hook"] = pipe_scene("hook", DURS[0], sc_hook(DURS[0]))
    segs["reveal"] = pipe_scene("reveal", DURS[1], sc_reveal(DURS[1]))
    segs["meeting"] = pipe_scene("meeting", DURS[2], sc_meeting(DURS[2]))
    segs["roles"] = pipe_scene("roles", DURS[3], sc_roles(DURS[3]))
    segs["results"] = pipe_scene("results", DURS[9], sc_results(DURS[9]))
    segs["box"] = pipe_scene("box", DURS[10], sc_box(DURS[10]))
    segs["cta"] = pipe_scene("cta", DURS[11], sc_cta(DURS[11]))
    print("riprese del gioco (finestra tarata sui nativi + banda SIMULATION)…")
    # stessi skip di make_show.py (dept allineata alla fine della clip,
    # chat a f115 — taratura approvata). La banda dept resta perché copre
    # la scritta APPLICATIONS mozzata dal ritaglio, ma il testo NON è più
    # il doppione della battuta (ora parlata): etichetta il reparto.
    dept_skip = max(0, 270 - int(DURS[4] * HS.FPS))
    segs["dept"] = game_scene_vert("dept", "dept", dept_skip, DURS[4], dept_x0,
                                   caption=["the Applications department"],
                                   band=True)
    segs["office"] = game_scene_vert("office", "office", 40, DURS[5],
                                     office_x0)
    segs["chat"] = sc_chat("chat", 115, DURS[6])
    print("riprese web mobili (velocità naturale)…")
    # globe 6,0→: fine vista Europa → zoom-out alla sfera → rotazione
    segs["globe"] = web_segment_vert("globe", f"{WEB}/web_map_m.webm",
                                     6.0, DURS[7])
    # swipe: finestra allineata alla FINE della clip così ogni carta appare
    # una volta sola (prima del rewind finale la ML card torna in scena)
    sd = HS.ffprobe_dur(f"{WEB}/web_swipe_m.webm")
    segs["webpages"] = web_segment_vert("webpages", f"{WEB}/web_swipe_m.webm",
                                        sd - 0.15 - DURS[8], DURS[8],
                                        caption=["match scores · salaries",
                                                 "swipe to decide"])

    print("assemblaggio con xfade…")
    order = [segs[name] for name, _ in SCENES]
    durs = [HS.ffprobe_dur(p) for p in order]
    cmd = ["ffmpeg", "-y", "-v", "error"]
    for p in order:
        cmd += ["-i", p]
    trans = ["fade", "slideleft", "slideleft", "fade", "fade", "fade",
             "fade", "fade", "slideleft", "fade", "smoothup"]
    fc, prev, offset = [], "[0:v]", 0.0
    for i in range(1, len(order)):
        offset += durs[i-1] - FADE
        out = f"[v{i}]" if i < len(order) - 1 else "[vout]"
        fc.append(f"{prev}[{i}:v]xfade=transition={trans[i-1]}:duration={FADE}:offset={offset:.3f}{out}")
        prev = out
    silent = os.path.join(BUILD, "video.mp4")
    cmd += ["-filter_complex", ";".join(fc) + ";[vout]format=yuv420p[final]",
            "-map", "[final]", "-c:v", "libx264", "-crf", "20",
            "-preset", "medium", "-movflags", "+faststart", silent]
    subprocess.run(cmd, check=True)
    return silent

if __name__ == "__main__":
    video = build_video()
    print(f"video muto: {HS.ffprobe_dur(video):.2f}s")
    for v in HS.VERSIONS:
        HS.mux(video, v, os.path.join(ROOT, f"jht-show-vertical-{v}.mp4"))
