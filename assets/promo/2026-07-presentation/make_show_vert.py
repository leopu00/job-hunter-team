#!/usr/bin/env python3
"""Versione VERTICALE 9:16 (720x1280) del video finale (sober, senza musica).

Stessa timeline e stessa voce di make_show.py (la traccia si riusa pari
pari: durate identiche scena per scena), stesse didascalie a schermo;
ogni scena è RICOMPOSTA per la colonna stretta, mai un ritaglio cieco.

Tornata 03/08 — l'utente ha segnalato SEZIONI MALE INQUADRATE; riviste
tutte le scene fotogramma per fotogramma e ritarate qui:
  - meeting: il pan Ken Burns spingeva il Capitano FUORI dal quadro (a fine
    scena restava solo il braccio); ora la colonna è ancorata a lui;
  - roles/Scouts: l'illustrazione è tagliata a x=0 già nel PNG sorgente e
    il ritaglio centrato mostrava la scrivania mozzata a mezz'aria; ora il
    bordo tagliato coincide col bordo sinistro del quadro;
  - office: la finestra non replica più la camera del gioco (che lasciava
    la targa RESEARCH mozzata a metà parola e la vignetta fuori quadro):
    x0 è un percorso diretto misurato sui frame nativi — panoramica piena,
    sweep rapido, chiusura con vignetta e TUTTI e due gli scout in campo;
  - dept: finestra misurata sui frame nativi: due vignette complete,
    Scrittore intero e scritta APPLICATIONS sul pavimento per INTERO
    (prima era mozzata a entrambi i lati);
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
# Non si replica più la camera del gioco proiettando un soggetto fisso:
# quel mapping, durante push e drift, lasciava testi mozzati e vignette
# fuori quadro (segnalato dall'utente). x0 è ora un PERCORSO DIRETTO nel
# tempo di ripresa, tarato misurando i frame nativi 1920x1080:
#   - office: 0 in panoramica (targa RESEARCH e bottone menu interi),
#     sweep rapido durante il push-in, poi 450 fisso: vignetta "Boards
#     swept…" completa (x 548-1010) e tutti e due gli scout in campo;
#   - dept: da 265 a 242 (il girato zooma piano): vignette complete,
#     Scrittore intero, APPLICATIONS sul pavimento tutta leggibile.
CAP_W, CAP_H = 1920, 1080
CROP_W = 608

def office_x0(t):
    # lo sweep chiude a t=5.2, PRIMA che la vignetta compaia (t≈5.4):
    # così il fumetto nasce già tutto dentro il quadro.
    if t <= 3.0:
        return 0.0
    return 450.0 * ease_io((t - 3.0) / 2.2)

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
    bh = lh * len(lines) + 2 * pad_y - (lh - size)
    d.rectangle([0, H - bh, W, H], fill=(16, 18, 30, 255))
    for i, s in enumerate(lines):
        d.text((W / 2, H - bh + pad_y + size / 2 + i * lh + 2), s, font=f_,
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
        i = int(t * FPS)
        t_cap = (skip + i) / FPS
        src = Image.open(os.path.join(cdir, files[skip + i])).convert("RGB")
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
    src = Image.open(f"{PUB}/landing-hero.png").convert("RGB")
    cap = caption_layer(["clear roles · a captain", "a weekly budget"],
                        y_bottom=1180)
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
        alpha_paste(fr, cap, ease_out((t - 0.9) / 0.5))
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
    sub = dur / 3.0
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
        k = min(2, int(t / sub))
        tk = t - k * sub
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
    cap = caption_layer(["chat with your team", "ask · steer · approve"],
                        y_bottom=1258)
    def frame(t):
        i = int(t * FPS)
        src = Image.open(os.path.join(cdir, files[skip + i])).convert("RGB")
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
        fr.alpha_composite(cap)
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
def web_segment_vert(name, src, t0, t1, speed, caption=None):
    """Ripresa mobile 780x1386 → 720x1280 (ritaglio 9:16 esatto + scala),
    con didascalia opzionale in basso."""
    seg = os.path.join(BUILD, f"{name}.mp4")
    vf = (f"trim=start={t0}:end={t1},setpts=(PTS-STARTPTS)/{speed},"
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
    # stessi skip di make_show.py: dept a f100 (due vignette subito),
    # chat a f115 (scambio già avviato, chiude sull'ultima risposta).
    # band=True: la didascalia dept è una banda piena al piede che copre la
    # scritta APPLICATIONS sul pavimento, altrimenti mozzata ai lati.
    segs["dept"] = game_scene_vert("dept", "dept", 100, DURS[4], dept_x0,
                                   caption=["Writers tailor your CV",
                                            "Critics review every draft"],
                                   band=True)
    segs["office"] = game_scene_vert("office", "office", 40, DURS[5],
                                     office_x0)
    segs["chat"] = sc_chat("chat", 115, DURS[6])
    print("riprese web mobili…")
    md = HS.ffprobe_dur(f"{WEB}/web_map_m.webm")
    t0, t1 = 5.0, min(15.5, md - 0.2)
    segs["globe"] = web_segment_vert("globe", f"{WEB}/web_map_m.webm",
                                     t0, t1, (t1 - t0) / DURS[7])
    sd = HS.ffprobe_dur(f"{WEB}/web_swipe_m.webm")
    s0, s1 = 3.6, min(9.4, sd - 0.2)
    segs["webpages"] = web_segment_vert("webpages", f"{WEB}/web_swipe_m.webm",
                                        s0, s1, (s1 - s0) / DURS[8],
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
