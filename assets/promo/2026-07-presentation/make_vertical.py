#!/usr/bin/env python3
"""Video di presentazione JHT — versione VERTICALE 9:16 (720x1280) per
cellulare. Stessa scaletta e stessi tempi dell'orizzontale
(make_presentation.py), ma OGNI scena è ricomposta per la colonna stretta:

  - le scene di testo sono reimpaginate (titoli su due righe, corpi più
    grandi in proporzione), non rimpicciolite — lezione di
    regia/lanci/2026-07-v0.2.0/promo-video/make_tiktok.py;
  - le riprese del gioco NON sono un ritaglio centrale: il ritaglio 9:16
    SEGUE il soggetto, ricalcolando a ogni fotogramma dove sta la colonna
    degli agenti dal percorso camera di game/tools/promo_director.gd
    (replicato qui in _office_cam/_dept_cam — stessa easing sinusoidale);
  - la chat è un COMPOSITO: colonna vignette (ritaglio 860px riscalato a
    tutta larghezza: il testo risulta PIÙ grande che nell'orizzontale),
    ritratto con targa sotto, header in alto.

Richiede le stesse riprese di make_presentation.py:
  ./record_clips.sh          # → scenes/capture/{office,dept,chat}/f*.png

Output: jht-presentation-vertical.mp4 accanto allo script (JHT_OUT per
cambiarlo). I frame intermedi vivono in scenes-vert/ (gitignored).
"""
import math, os, shutil, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 720, 1280, 30
ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("JHT_REPO",
                      os.path.dirname(os.path.dirname(os.path.dirname(ROOT))))
OUT_BASE = os.environ.get("JHT_OUT", os.path.join(ROOT, "jht-presentation-vertical"))
PUB = f"{REPO}/web/public"
SC = os.path.join(ROOT, "scenes-vert")
CAP = os.path.join(ROOT, "scenes", "capture")
FDIR = os.path.expanduser("~/Library/Fonts")

def font(weight, size):
    return ImageFont.truetype(os.path.join(FDIR, f"JetBrainsMono-{weight}.ttf"), size)

# palette light del sito (identica al montaggio orizzontale)
BG      = (240, 240, 247, 255)
GRID    = (228, 228, 235)
CARD    = (255, 255, 255, 255)
BORDER  = (200, 200, 220)
TITLE   = (10, 10, 32)
BASE    = (40, 40, 72)
MUTED   = (80, 80, 112)
DIM     = (128, 128, 168)
GREEN   = (14, 200, 92)
STRONG  = (21, 128, 61)
BLUE    = (77, 159, 255)
CAPTION = (244, 246, 250)
PILL    = (10, 12, 28, 205)

def ease_out(p):
    p = max(0.0, min(1.0, p))
    return 1 - (1 - p) ** 3

def ease_io(p):
    p = max(0.0, min(1.0, p))
    return 0.5 - 0.5 * math.cos(math.pi * p)

def fade_io(t, t_in, t_out, d=0.45):
    return ease_out((t - t_in) / d) * (1 - ease_out((t - t_out) / d))

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

def alpha_paste(base, lyr, f, dx=0, dy=0):
    if f <= 0:
        return
    if f < 1:
        lyr = lyr.copy()
        lyr.putalpha(lyr.getchannel("A").point(lambda v: int(v * f)))
    base.alpha_composite(lyr, (int(dx), int(dy)))

def agent_img(name, height):
    ag = Image.open(f"{PUB}/{name}").convert("RGBA")
    bb = ag.getchannel("A").getbbox()
    if bb:
        ag = ag.crop(bb)
    r = height / ag.height
    return ag.resize((int(ag.width * r), int(ag.height * r)), Image.LANCZOS)

def save_scene(name, frames, hold):
    d = os.path.join(SC, name)
    os.makedirs(d, exist_ok=True)
    for i, fr in enumerate(frames):
        fr.convert("RGB").save(f"{d}/{i:04d}.png")
    return d, hold

if os.path.isdir(SC):
    shutil.rmtree(SC)
os.makedirs(SC)

for clip in ("office", "dept", "chat"):
    if not os.path.isdir(os.path.join(CAP, clip)):
        sys.exit(f"manca scenes/capture/{clip}/ — lancia prima ./record_clips.sh")

scenes = []   # (dir, hold_sec, xfade_transition_to_next)

# ---------------------------------------------------------------- helpers UI
STEPS = ["Scouts", "Analysts", "Scorers", "Writers", "Critics"]

def pipeline_bar(active, y=1210):
    """Barra pipeline: sul 9:16 corpo 18, separatore corto, un'unica riga."""
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
        col = GREEN if i in active else DIM
        d.text((x, y), s, font=(f_on if i in active else f_off), fill=col)
        x += widths[i]
        if i < len(STEPS) - 1:
            d.text((x, y), sep, font=f_off, fill=DIM)
            x += d.textlength(sep, font=f_off)
    return ly

def pill_layer(text, y_center, size=26):
    """Didascalia su pastiglia scura, mai testo sopra testo del gioco."""
    ly = layer(); d = ImageDraw.Draw(ly)
    f_ = font("Bold", size)
    lines = text.split("\n")
    lh = int(size * 1.5)
    tw = max(d.textlength(ln, font=f_) for ln in lines)
    th = lh * len(lines)
    pad_x, pad_y = 24, 13
    x0 = (W - tw) / 2 - pad_x
    y0 = y_center - th / 2 - pad_y
    d.rounded_rectangle([x0, y0, x0 + tw + pad_x * 2, y0 + th + pad_y * 2],
                        radius=14, fill=PILL)
    y = y_center - (lh * (len(lines) - 1)) / 2
    for ln in lines:
        d.text((W // 2, y), ln, font=f_, fill=CAPTION, anchor="mm")
        y += lh
    return ly

# ------------------------------------------------- percorso camera del gioco
# Copia fedele di game/tools/promo_director.gd (stesse costanti, stessa
# easing TRANS_SINE/EASE_IN_OUT): serve a sapere, fotogramma per fotogramma,
# DOVE sta il soggetto sullo schermo 1920x1080 per farci seguire il ritaglio.
CAP_W, CAP_H = 1920, 1080
CROP_W = 608                      # 9:16 di un fotogramma alto 1080

OFF_HOLD, OFF_PUSH, OFF_DRIFT = 2.6, 3.6, 6.8
OFF_WIDE = (1700.0, 950.0, 1920.0 / 3400.0)
OFF_CLOSE = (660.0, 528.0, 1.95)
OFF_DRIFT_TO = (640.0, 520.0, 2.02)
OFFICE_SUBJECT_X = 555.0          # colonna dei due Scout (sedute x 542/569)

DEPT_SECONDS = 9.0
DEPT_FROM = (620.0, 1640.0, 2.05)
DEPT_TO = (700.0, 1655.0, 2.18)
# Colonna dei due Scrittori (sedute x 503/523) spostata un filo a destra:
# le vignette sono centrate sugli agenti ma la prima riga lunga sborda a
# destra — a 513 il bordo destro della vignetta usciva dal ritaglio.
DEPT_SUBJECT_X = 528.0

def _lerp3(a, b, p):
    return tuple(a[k] + (b[k] - a[k]) * p for k in range(3))

def office_cam(t):
    if t <= OFF_HOLD:
        return OFF_WIDE
    if t <= OFF_HOLD + OFF_PUSH:
        return _lerp3(OFF_WIDE, OFF_CLOSE, ease_io((t - OFF_HOLD) / OFF_PUSH))
    return _lerp3(OFF_CLOSE, OFF_DRIFT_TO,
                  ease_io((t - OFF_HOLD - OFF_PUSH) / OFF_DRIFT))

def dept_cam(t):
    return _lerp3(DEPT_FROM, DEPT_TO, ease_io(t / DEPT_SECONDS))

def subject_crop_x(cam, subject_x):
    """Ascissa (sinistra) del ritaglio 9:16 che insegue il soggetto."""
    cx, _cy, z = cam
    sx = (subject_x - cx) * z + CAP_W / 2.0
    return max(0.0, min(CAP_W - CROP_W, sx - CROP_W / 2.0))

def game_scene_vert(name, clip, skip, dur, cam_fn, subject_x, captions,
                    trans, pill_y=1150):
    """RIPRESA VERA in verticale: ritaglio 608x1080 che segue il soggetto,
    riscalato a 720x1280. captions = [(testo, t_in, t_out), …]"""
    cdir = os.path.join(CAP, clip)
    files = sorted(f for f in os.listdir(cdir) if f.endswith(".png"))
    n = int(dur * FPS)
    if skip + n > len(files):
        sys.exit(f"clip '{clip}': servono {skip + n} frame, trovati {len(files)}")
    caps = [(pill_layer(txt, pill_y), t_in, t_out) for txt, t_in, t_out in captions]
    frames = []
    for i in range(n):
        t = i / FPS
        t_cap = (skip + i) / FPS          # tempo della ripresa, non del montaggio
        src = Image.open(os.path.join(cdir, files[skip + i])).convert("RGB")
        x0 = subject_crop_x(cam_fn(t_cap), subject_x)
        fr = src.crop((int(x0), 0, int(x0) + CROP_W, CAP_H))
        fr = fr.resize((W, H), Image.LANCZOS).convert("RGBA")
        for ly, t_in, t_out in caps:
            alpha_paste(fr, ly, fade_io(t, t_in, t_out))
        frames.append(fr)
    scenes.append((*save_scene(name, frames, 0.0), trans))

# ================================================================ S1 hook
t1 = layer(); d = ImageDraw.Draw(t1)
d.text((W//2, 350), "Job hunting", font=font("ExtraBold", 54), fill=TITLE, anchor="mm")
d.text((W//2, 424), "is a second job.", font=font("ExtraBold", 54), fill=TITLE, anchor="mm")
bullets = ["job boards to sweep,\nevery day",
           "postings to read\nand qualify",
           "CVs and letters to tailor,\nrole by role"]
b_layers = []
y = 560
for b in bullets:
    ly = layer(); d = ImageDraw.Draw(ly)
    for ln in b.split("\n"):
        d.text((W//2, y), ln, font=font("Regular", 26), fill=MUTED, anchor="mm")
        y += 40
    y += 26
    b_layers.append(ly)
frames = []
for i in range(int(3.4 * FPS)):
    t = i / FPS
    fr = BGF.copy()
    p = ease_out(t / 0.6)
    alpha_paste(fr, t1, p, dy=22 * (1 - p))
    for k, ly in enumerate(b_layers):
        q = ease_out((t - 0.9 - 0.45 * k) / 0.5)
        alpha_paste(fr, ly, q, dy=14 * (1 - q))
    frames.append(fr)
scenes.append((*save_scene("s01", frames, 1.4), "fade"))

# ================================================================ S2 reveal
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
frames = []
for i in range(int(3.4 * FPS)):
    t = i / FPS
    fr = BGF.copy()
    p = ease_out(t / 0.55)
    alpha_paste(fr, lyr_title, p, dy=24 * (1 - p))
    alpha_paste(fr, lyr_tag, ease_out((t - 0.4) / 0.5))
    pp = ease_out((t - 0.8) / 0.4)
    alpha_paste(fr, lyr_prompt, pp)
    if pp >= 1 and (t % 1.0) < 0.6:
        alpha_paste(fr, cursor, 1)
    frames.append(fr)
scenes.append((*save_scene("s02", frames, 0.6), "fade"))

# ================================================================ S3 la squadra (riunione)
# Ken Burns VERTICALE su landing-hero: la colonna 9:16 insegue il tavolo
# della riunione (centro dell'illustrazione), niente ritaglio cieco.
src3 = Image.open(f"{PUB}/landing-hero.png").convert("RGB")
cap3 = pill_layer("A real team: clear roles,\na Captain, a weekly\nbudget to respect.", 1120)
frames = []
DUR3 = 4.6
for i in range(int(DUR3 * FPS)):
    t = i / FPS
    p = ease_io(t / DUR3)
    z = 1.0 + 0.12 * p
    ch = src3.height / z
    cw = ch * W / H
    cx = (0.50 + 0.05 * p) * src3.width
    cy = 0.46 * src3.height
    px0 = max(0, min(src3.width - cw, cx - cw / 2))
    py0 = max(0, min(src3.height - ch, cy - ch / 2))
    fr = src3.crop((int(px0), int(py0), int(px0 + cw), int(py0 + ch)))
    fr = fr.resize((W, H), Image.LANCZOS).convert("RGBA")
    alpha_paste(fr, cap3, fade_io(t, 0.6, 4.2))
    frames.append(fr)
scenes.append((*save_scene("s03", frames, 0.0), "slideleft"))

# ================================================================ ruoli (pipeline)
def role_scene(name, img, role, desc, active, trans, hold=1.8,
               render=1.0, extra=None):
    """Ritratto sopra, testo sotto: la colonna stretta impagina in verticale."""
    ag = agent_img(img, 520)
    lyr_ag = layer()
    lyr_ag.alpha_composite(ag, ((W - ag.width) // 2, 130))
    lyr_txt = layer(); d = ImageDraw.Draw(lyr_txt)
    d.text((W//2, 740), role, font=font("ExtraBold", 44), fill=TITLE, anchor="mm")
    y = 812
    for ln in desc.split("\n"):
        d.text((W//2, y), ln, font=font("Regular", 26), fill=MUTED, anchor="mm")
        y += 42
    bar = pipeline_bar(active)
    frames = []
    for i in range(int(render * FPS)):
        t = i / FPS
        fr = BGF.copy()
        q = ease_out(t / 0.6)
        alpha_paste(fr, lyr_ag, min(1, q * 2.5), dy=-40 * (1 - q))
        p = ease_out((t - 0.15) / 0.5)
        alpha_paste(fr, lyr_txt, p, dy=26 * (1 - p))
        alpha_paste(fr, bar, ease_out((t - 0.25) / 0.5))
        if extra:
            extra(fr, t)
        frames.append(fr)
    scenes.append((*save_scene(name, frames, hold), trans))

role_scene("s04", "agents-scouts.png", "The Scouts",
           "They sweep the job boards.\nDay and night.", {0}, "slideleft")
role_scene("s05", "agents-analyst.png", "The Analysts",
           "They read every posting.\nThey extract what matters.", {1}, "slideleft")

def scorer_badge(fr, t):
    a = ease_out((t - 0.6) / 0.4)
    if a <= 0:
        return
    ly = layer(); d = ImageDraw.Draw(ly)
    d.rectangle([60, 940, 660, 1040], fill=CARD, outline=BORDER, width=2)
    n = int(round(84 * ease_out((t - 0.7) / 1.5)))
    d.text((92, 990), f"{n:2d}/100", font=font("ExtraBold", 44), fill=GREEN, anchor="lm")
    d.text((300, 990), "match with\nyour profile", font=font("Regular", 20), fill=MUTED, anchor="lm")
    alpha_paste(fr, ly, a)

role_scene("s06", "agents-scorer.png", "The Scorers",
           "A score for every position:\nhow well it fits you, 0-100.", {2}, "slideleft",
           hold=0.6, render=2.6, extra=scorer_badge)

# ================================================================ S7 Scrittori — RIPRESA VERA
game_scene_vert("s07", "dept", 40, 7.0, dept_cam, DEPT_SUBJECT_X,
                [("The Writers tailor CVs and\ncover letters, position\nby position.", 0.5, 3.4),
                 ("The Critics blind-review\nevery document.\nThree rounds, no mercy.", 3.8, 6.7)],
                "fade")

# ================================================================ S8 l'ufficio — RIPRESA VERA
game_scene_vert("s08", "office", 40, 10.0, office_cam, OFFICE_SUBJECT_X,
                [("Not a dashboard: an office,\ninside a video game.", 0.7, 5.0),
                 ("Watch them work for you,\nwhile you do\nsomething else.", 5.5, 9.6)],
                "fade")

# ================================================================ S9 la chat — COMPOSITO VERTICALE
# Niente ritaglio cieco: colonna vignette a tutta larghezza (il testo esce
# PIÙ GRANDE che nel montaggio orizzontale), ritratto+targa sotto, header
# in alto, sfondo brand. Le regioni sono fisse: la conversazione si scrive
# dentro la finestra vignette, il resto della pagina non si muove.
CHAT_HEADER = (20, 28, 480, 68)      # "CHAT — HOLMES · SCOUT-1"
CHAT_BUBBLES = (240, 95, 1100, 680)  # colonna della conversazione
CHAT_PORTRAIT = (1425, 115, 1815, 970)  # ritratto + targa HOLMES · SCOUT-1

def chat_scene_vert(name, skip, dur, captions, trans):
    cdir = os.path.join(CAP, "chat")
    files = sorted(f for f in os.listdir(cdir) if f.endswith(".png"))
    n = int(dur * FPS)
    if skip + n > len(files):
        sys.exit(f"clip 'chat': servono {skip + n} frame, trovati {len(files)}")
    caps = [(pill_layer(txt, 1205), t_in, t_out) for txt, t_in, t_out in captions]
    bw = CHAT_BUBBLES[2] - CHAT_BUBBLES[0]
    bh = CHAT_BUBBLES[3] - CHAT_BUBBLES[1]
    bscale = W / bw
    pw_ = CHAT_PORTRAIT[2] - CHAT_PORTRAIT[0]
    ph_ = CHAT_PORTRAIT[3] - CHAT_PORTRAIT[1]
    pscale = 560.0 / ph_
    frames = []
    for i in range(n):
        t = i / FPS
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
        fr.paste(por, ((W - por.width) // 2, 590))
        for ly, t_in, t_out in caps:
            alpha_paste(fr, ly, fade_io(t, t_in, t_out))
        frames.append(fr)
    scenes.append((*save_scene(name, frames, 0.0), trans))

chat_scene_vert("s09", 40, 9.5,
                [("And you talk to them,\nlike teammates.", 0.6, 4.4),
                 ("Ask, steer, approve —\nin plain language.", 5.0, 9.1)],
                "fade")

# ================================================================ S10 il sito
head9 = layer(); d = ImageDraw.Draw(head9)
d.text((W//2, 300), "Follow the hunt from", font=font("Bold", 34), fill=TITLE, anchor="mm")
d.text((W//2, 348), "the web, anywhere.", font=font("Bold", 34), fill=TITLE, anchor="mm")
d.text((W//2, 404), "the hunt map · the scores · the budget",
       font=font("Regular", 19), fill=DIM, anchor="mm")
shot = Image.open(f"{REPO}/assets/screenshots/beta2-map.png").convert("RGB")
sw = 660
sh_ = int(shot.height * sw / shot.width)
shot = shot.resize((sw, sh_), Image.LANCZOS)
card9 = layer(); d = ImageDraw.Draw(card9)
cx0, cy0 = (W - sw - 4) // 2, 470
d.rectangle([cx0, cy0, cx0 + sw + 4, cy0 + 34 + sh_ + 2], fill=CARD, outline=BORDER, width=2)
for k in range(3):
    d.ellipse([cx0 + 14 + k * 20, cy0 + 11, cx0 + 25 + k * 20, cy0 + 22], fill=BORDER)
d.text((cx0 + 84, cy0 + 17), "jobhunterteam.ai/case-studies", font=font("Regular", 15), fill=DIM, anchor="lm")
card9.paste(shot, (cx0 + 2, cy0 + 34))
frames = []
for i in range(int(1.4 * FPS)):
    t = i / FPS
    fr = BGF.copy()
    alpha_paste(fr, head9, ease_out(t / 0.45))
    p = ease_out((t - 0.2) / 0.6)
    alpha_paste(fr, card9, p, dy=46 * (1 - p))
    frames.append(fr)
scenes.append((*save_scene("s10", frames, 2.4), "slideleft"))

# ================================================================ S11 risultati (dati pubblici e anonimi)
def kpi_card_layer(x, y, cw, ch, num, lab, col):
    ly = layer(); d = ImageDraw.Draw(ly)
    d.rectangle([x, y, x + cw, y + ch], fill=CARD, outline=BORDER, width=2)
    d.text((x + cw//2, y + 66), num, font=font("ExtraBold", 52), fill=col, anchor="mm")
    d.text((x + cw//2, y + 122), lab, font=font("Regular", 19), fill=MUTED, anchor="mm")
    return ly

head10 = layer(); d = ImageDraw.Draw(head10)
d.text((W//2, 200), "One real month, hands-off", font=font("Bold", 30), fill=TITLE, anchor="mm")
d.text((W//2, 248), "public, anonymised data", font=font("Regular", 20), fill=DIM, anchor="mm")
d.text((W//2, 280), "one beta tester · Jun 3 → Jul 3, 2026", font=font("Regular", 20), fill=DIM, anchor="mm")
stats = [("658", "positions found", TITLE), ("520", "analysed and scored", BLUE),
         ("307", "strong matches · ≥70", STRONG), ("71/100", "average match", GREEN)]
cw_, ch_, gap = 620, 168, 26
gx, gy = (W - cw_)//2, 340
cards10 = []
for i, (num, lab, col) in enumerate(stats):
    cards10.append(kpi_card_layer(gx, gy + i * (ch_ + gap), cw_, ch_, num, lab, col))
frames = []
for i in range(int(1.8 * FPS)):
    t = i / FPS
    fr = BGF.copy()
    alpha_paste(fr, head10, ease_out(t / 0.45))
    for k, ly in enumerate(cards10):
        p = ease_out((t - 0.25 - 0.15 * k) / 0.45)
        alpha_paste(fr, ly, p, dy=36 * (1 - p))
    frames.append(fr)
scenes.append((*save_scene("s11", frames, 2.8), "fade"))

# ================================================================ S12 open source / il container
head11 = layer(); d = ImageDraw.Draw(head11)
d.text((W//2, 240), "Open source (MIT).", font=font("ExtraBold", 42), fill=TITLE, anchor="mm")
d.text((W//2, 306), "Runs in a container on your", font=font("Regular", 24), fill=MUTED, anchor="mm")
d.text((W//2, 342), "machine: your data stays yours.", font=font("Regular", 24), fill=MUTED, anchor="mm")
box = Image.open(f"{PUB}/the-box.png").convert("RGBA")
bb = box.getchannel("A").getbbox()
if bb:
    box = box.crop(bb)
r = 640 / box.width
box = box.resize((640, int(box.height * r)), Image.LANCZOS)
lyr_box = layer()
lyr_box.alpha_composite(box, ((W - box.width) // 2, 440))
frames = []
for i in range(int(1.4 * FPS)):
    t = i / FPS
    fr = BGF.copy()
    alpha_paste(fr, head11, ease_out(t / 0.5))
    p = ease_out((t - 0.25) / 0.6)
    alpha_paste(fr, lyr_box, p, dy=40 * (1 - p))
    frames.append(fr)
scenes.append((*save_scene("s12", frames, 2.2), "smoothup"))

# ================================================================ S13 CTA
cta = []
ly = layer(); d = ImageDraw.Draw(ly)
d.text((W//2, 440), "Job Hunter", font=font("ExtraBold", 72), fill=TITLE, anchor="mm")
d.text((W//2, 532), "Team", font=font("ExtraBold", 72), fill=GREEN, anchor="mm")
cta.append((ly, 0.0))
ly = layer(); d = ImageDraw.Draw(ly)
d.text((W//2, 660), "free · open source · in beta", font=font("Regular", 25), fill=MUTED, anchor="mm")
cta.append((ly, 0.3))
ly = layer(); d = ImageDraw.Draw(ly)
d.text((W//2, 760), "jobhunterteam.ai", font=font("Bold", 38), fill=GREEN, anchor="mm")
cta.append((ly, 0.55))
ly = layer(); d = ImageDraw.Draw(ly)
d.text((W//2, 828), "github.com/leopu00/", font=font("Medium", 26), fill=BASE, anchor="mm")
d.text((W//2, 866), "job-hunter-team", font=font("Medium", 26), fill=BASE, anchor="mm")
cta.append((ly, 0.75))
frames = []
for i in range(int(2.0 * FPS)):
    t = i / FPS
    fr = BGF.copy()
    for ly, delay in cta:
        p = ease_out((t - delay) / 0.5)
        alpha_paste(fr, ly, p, dy=26 * (1 - p))
    frames.append(fr)
scenes.append((*save_scene("s13", frames, 2.6), None))

# ================================================================ assembly
print("scene renderizzate, assemblo…")
seg_files = []
for k, (d_, hold, _) in enumerate(scenes):
    seg = os.path.join(SC, f"seg{k:02d}.mp4")
    vf = f"tpad=stop_mode=clone:stop_duration={hold}," if hold > 0 else ""
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", str(FPS),
                    "-i", f"{d_}/%04d.png", "-vf", f"{vf}format=yuv420p",
                    "-c:v", "libx264", "-crf", "18", "-preset", "fast", seg], check=True)
    seg_files.append(seg)

FADE = 0.5
durs = []
for seg in seg_files:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                          "-of", "csv=p=0", seg], capture_output=True, text=True)
    durs.append(float(out.stdout.strip()))

cmd = ["ffmpeg", "-y", "-v", "error"]
for seg in seg_files:
    cmd += ["-i", seg]
fc, prev, offset = [], "[0:v]", 0.0
for i in range(1, len(seg_files)):
    trans = scenes[i-1][2] or "fade"
    offset += durs[i-1] - FADE
    out = f"[v{i}]" if i < len(seg_files)-1 else "[vout]"
    fc.append(f"{prev}[{i}:v]xfade=transition={trans}:duration={FADE}:offset={offset:.3f}{out}")
    prev = out
cmd += ["-filter_complex", ";".join(fc) + ";[vout]format=yuv420p[final]", "-map", "[final]",
        "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-movflags", "+faststart",
        f"{OUT_BASE}.mp4"]
subprocess.run(cmd, check=True)

tot = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                      "-of", "csv=p=0", f"{OUT_BASE}.mp4"], capture_output=True, text=True)
size_mb = os.path.getsize(f"{OUT_BASE}.mp4") / 1e6
print("MP4 OK — durata segmenti:", [round(x, 1) for x in durs])
print(f"→ {OUT_BASE}.mp4 · {float(tot.stdout):.1f}s · {size_mb:.1f} MB")
