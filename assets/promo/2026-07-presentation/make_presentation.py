#!/usr/bin/env python3
"""Video di presentazione JHT — 60 s, 1280x720, testo a schermo in INGLESE.

Impianto ripreso da regia/lanci/2026-07-v0.2.0/promo-video/make_video.py
(frame PIL a 30 fps per scena + montaggio ffmpeg con xfade).

Tre scene sono RIPRESE VERE del gioco (Movie Maker mode di Godot, vedi
record_clips.sh): l'ufficio in movimento, il reparto Scrittori/Critici e la
chat a fumetti che si scrive da sola. Vanno registrate PRIMA del montaggio:

  ./record_clips.sh          # → scenes/capture/{office,dept,chat}/f*.png

Percorsi configurabili via env:
  JHT_REPO   root del repo da cui leggere le immagini
             (default: tre livelli sopra questo script)
  JHT_OUT    basename di output senza estensione
             (default: jht-presentation accanto allo script)

Asset statici (tutti illustrazioni o screenshot pubblici/anonimi già nel repo):
  web/public/landing-hero.png            riunione della squadra (fumetto)
  web/public/agents-{scouts,analyst,scorer}.png
  assets/screenshots/beta2-map.png       case study pubblico e anonimo
  web/public/the-box.png                 il container/sandbox
"""
import math, os, shutil, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1280, 720, 30
ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.environ.get("JHT_REPO",
                      os.path.dirname(os.path.dirname(os.path.dirname(ROOT))))
OUT_BASE = os.environ.get("JHT_OUT", os.path.join(ROOT, "jht-presentation"))
PUB = f"{REPO}/web/public"
SC = os.path.join(ROOT, "scenes")
CAP = os.path.join(SC, "capture")
FDIR = os.path.expanduser("~/Library/Fonts")

def font(weight, size):
    return ImageFont.truetype(os.path.join(FDIR, f"JetBrainsMono-{weight}.ttf"), size)

# palette light del sito (identica al promo v0.2.0)
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
        d.line([(0, y), (H * 2, y)], fill=GRID, width=1)
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

def agent_img(name, box_w, box_h, height=None):
    ag = Image.open(f"{PUB}/{name}").convert("RGBA")
    bb = ag.getchannel("A").getbbox()
    if bb:
        ag = ag.crop(bb)
    r = (height / ag.height) if height else min(box_w / ag.width, box_h / ag.height)
    return ag.resize((int(ag.width * r), int(ag.height * r)), Image.LANCZOS)

def save_scene(name, frames, hold):
    d = os.path.join(SC, name)
    os.makedirs(d, exist_ok=True)
    for i, fr in enumerate(frames):
        fr.convert("RGB").save(f"{d}/{i:04d}.png")
    return d, hold

# le riprese del gioco vivono in scenes/capture/ e NON vanno rifatte a ogni
# montaggio: si azzera tutto tranne capture/
if os.path.isdir(SC):
    for entry in os.listdir(SC):
        if entry != "capture":
            p = os.path.join(SC, entry)
            shutil.rmtree(p) if os.path.isdir(p) else os.remove(p)
else:
    os.makedirs(SC)

for clip in ("office", "dept", "chat"):
    if not os.path.isdir(os.path.join(CAP, clip)):
        sys.exit(f"manca scenes/capture/{clip}/ — lancia prima ./record_clips.sh")

scenes = []   # (dir, hold_sec, xfade_transition_to_next)

# ---------------------------------------------------------------- helpers UI
STEPS = ["Scouts", "Analysts", "Scorers", "Writers", "Critics"]

def pipeline_bar(active):
    """Barra pipeline in basso; `active` = set di indici evidenziati."""
    ly = layer(); d = ImageDraw.Draw(ly)
    f_on, f_off = font("Bold", 23), font("Medium", 23)
    sep = "  →  "
    widths, total = [], 0
    for i, s in enumerate(STEPS):
        f_ = f_on if i in active else f_off
        w_ = d.textlength(s, font=f_)
        widths.append(w_)
        total += w_
        if i < len(STEPS) - 1:
            total += d.textlength(sep, font=f_off)
    x = (W - total) / 2
    y = 662
    for i, s in enumerate(STEPS):
        col = GREEN if i in active else DIM
        d.text((x, y), s, font=(f_on if i in active else f_off), fill=col)
        x += widths[i]
        if i < len(STEPS) - 1:
            d.text((x, y), sep, font=f_off, fill=DIM)
            x += d.textlength(sep, font=f_off)
    return ly

SCRIM = layer()
_d = ImageDraw.Draw(SCRIM)
for i in range(250):
    a = int(165 * (i / 250) ** 1.4)
    _d.line([(0, H - 250 + i), (W, H - 250 + i)], fill=(4, 6, 14, a))

def caption_layer(text, y_bottom=668, size=31):
    ly = layer(); d = ImageDraw.Draw(ly)
    lines = text.split("\n")
    lh = int(size * 1.45)
    y = y_bottom - lh * (len(lines) - 1)
    for ln in lines:
        d.text((W // 2, y), ln, font=font("Bold", size), fill=CAPTION, anchor="mm")
        y += lh
    return ly

def pill_layer(text, y_center, size=29):
    """Didascalia su pastiglia scura: leggibile sopra le riprese del gioco
    senza oscurarle con lo scrim, e mai testo-su-testo (la pastiglia copre)."""
    ly = layer(); d = ImageDraw.Draw(ly)
    f_ = font("Bold", size)
    lines = text.split("\n")
    lh = int(size * 1.5)
    tw = max(d.textlength(ln, font=f_) for ln in lines)
    th = lh * len(lines)
    pad_x, pad_y = 30, 14
    x0 = (W - tw) / 2 - pad_x
    y0 = y_center - th / 2 - pad_y
    d.rounded_rectangle([x0, y0, x0 + tw + pad_x * 2, y0 + th + pad_y * 2],
                        radius=14, fill=PILL)
    y = y_center - (lh * (len(lines) - 1)) / 2
    for ln in lines:
        d.text((W // 2, y), ln, font=f_, fill=CAPTION, anchor="mm")
        y += lh
    return ly

def kb_scene(name, img_path, dur, z0, z1, c0, c1, captions, hold, trans):
    """Ken Burns: crop-cover animato + scrim + didascalie con fade in/out.
    captions = [(testo, t_in, t_out), …]"""
    src = Image.open(img_path).convert("RGB")
    s0 = max(W / src.width, H / src.height)
    caps = [(caption_layer(txt), t_in, t_out) for txt, t_in, t_out in captions]
    frames = []
    for i in range(int(dur * FPS)):
        t = i / FPS
        p = ease_io(t / dur)
        z = z0 + (z1 - z0) * p
        cx = (c0[0] + (c1[0] - c0[0]) * p) * src.width
        cy = (c0[1] + (c1[1] - c0[1]) * p) * src.height
        cw, ch = W / (s0 * z), H / (s0 * z)
        px = max(0, min(src.width - cw, cx - cw / 2))
        py = max(0, min(src.height - ch, cy - ch / 2))
        fr = src.crop((int(px), int(py), int(px + cw), int(py + ch)))
        fr = fr.resize((W, H), Image.LANCZOS).convert("RGBA")
        fr.alpha_composite(SCRIM)
        for ly, t_in, t_out in caps:
            alpha_paste(fr, ly, fade_io(t, t_in, t_out))
        frames.append(fr)
    scenes.append((*save_scene(name, frames, hold), trans))

def game_scene(name, clip, skip, dur, captions, trans, pill_y=648):
    """RIPRESA VERA del gioco: monta i frame di scenes/capture/<clip>/
    (1920x1080, Movie Maker di Godot) riscalati a 1280x720, saltando i primi
    `skip` frame di caricamento. captions = [(testo, t_in, t_out), …] su
    pastiglia scura centrata a pill_y."""
    cdir = os.path.join(CAP, clip)
    files = sorted(f for f in os.listdir(cdir) if f.endswith(".png"))
    n = int(dur * FPS)
    if skip + n > len(files):
        sys.exit(f"clip '{clip}': servono {skip + n} frame, trovati {len(files)}")
    caps = [(pill_layer(txt, pill_y), t_in, t_out) for txt, t_in, t_out in captions]
    frames = []
    for i in range(n):
        t = i / FPS
        fr = Image.open(os.path.join(cdir, files[skip + i])).convert("RGB")
        fr = fr.resize((W, H), Image.LANCZOS).convert("RGBA")
        for ly, t_in, t_out in caps:
            alpha_paste(fr, ly, fade_io(t, t_in, t_out))
        frames.append(fr)
    scenes.append((*save_scene(name, frames, 0.0), trans))

# ================================================================ S1 hook
# "Job hunting is a second job." + le tre incombenze quotidiane
t1 = layer(); d = ImageDraw.Draw(t1)
d.text((W//2, 240), "Job hunting", font=font("ExtraBold", 64), fill=TITLE, anchor="mm")
d.text((W//2, 325), "is a second job.", font=font("ExtraBold", 64), fill=TITLE, anchor="mm")
bullets = ["job boards to sweep, every day",
           "postings to read and qualify",
           "CVs and letters to tailor, role by role"]
b_layers = []
for k, b in enumerate(bullets):
    ly = layer(); d = ImageDraw.Draw(ly)
    d.text((W//2, 448 + k * 52), b, font=font("Regular", 27), fill=MUTED, anchor="mm")
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
f_t = font("ExtraBold", 82)
w1 = ImageDraw.Draw(BGF).textlength("Job Hunter ", font=f_t)
w2 = ImageDraw.Draw(BGF).textlength("Team", font=f_t)
tx = (W - (w1 + w2)) / 2
lyr_title = layer(); d = ImageDraw.Draw(lyr_title)
d.text((tx, H//2 - 130), "Job Hunter ", font=f_t, fill=TITLE)
d.text((tx + w1, H//2 - 130), "Team", font=f_t, fill=GREEN)
lyr_tag = layer(); d = ImageDraw.Draw(lyr_tag)
d.text((W//2, H//2 + 40), "a team of AI agents that hunts jobs for you",
       font=font("Regular", 27), fill=MUTED, anchor="mm")
f_p = font("Regular", 25)
prompt = "$ jht team start"
pw = ImageDraw.Draw(BGF).textlength(prompt + " ", font=f_p)
px = (W - pw) / 2
lyr_prompt = layer(); d = ImageDraw.Draw(lyr_prompt)
d.text((px, H//2 + 110), prompt, font=f_p, fill=GREEN)
cursor = layer(); d = ImageDraw.Draw(cursor)
d.rectangle([px + pw, H//2 + 112, px + pw + 13, H//2 + 138], fill=GREEN)
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
kb_scene("s03", f"{PUB}/landing-hero.png", 4.6, 1.0, 1.12,
         (0.50, 0.46), (0.55, 0.44),
         [("A real team: clear roles, a Captain,\na weekly budget to respect.", 0.6, 4.2)],
         0.0, "slideleft")

# ================================================================ ruoli (pipeline)
def role_scene(name, img, role, desc, active, trans, hold=1.8,
               render=1.0, extra=None):
    lyr_txt = layer(); d = ImageDraw.Draw(lyr_txt)
    d.text((72, 235), role, font=font("ExtraBold", 52), fill=TITLE)
    y = 340
    for ln in desc.split("\n"):
        d.text((72, y), ln, font=font("Regular", 28), fill=MUTED)
        y += 46
    ag = agent_img(img, 610, 540)
    ax = 620 + (610 - ag.width) // 2
    ay = 95 + (540 - ag.height) // 2
    lyr_ag = layer()
    lyr_ag.alpha_composite(ag, (ax, ay))
    bar = pipeline_bar(active)
    frames = []
    for i in range(int(render * FPS)):
        t = i / FPS
        fr = BGF.copy()
        p = ease_out(t / 0.5)
        alpha_paste(fr, lyr_txt, p, dx=-70 * (1 - p))
        q = ease_out((t - 0.1) / 0.6)
        alpha_paste(fr, lyr_ag, min(1, q * 2.5), dx=380 * (1 - q))
        alpha_paste(fr, bar, ease_out((t - 0.25) / 0.5))
        if extra:
            extra(fr, t)
        frames.append(fr)
    scenes.append((*save_scene(name, frames, hold), trans))

role_scene("s04", "agents-scouts.png", "The Scouts",
           "They sweep the job boards.\nDay and night.", {0}, "slideleft")
role_scene("s05", "agents-analyst.png", "The Analysts",
           "They read every posting.\nThey extract what matters.", {1}, "slideleft")

# Scorer: badge col punteggio che sale
def scorer_badge(fr, t):
    a = ease_out((t - 0.6) / 0.4)
    if a <= 0:
        return
    ly = layer(); d = ImageDraw.Draw(ly)
    d.rectangle([72, 470, 560, 562], fill=CARD, outline=BORDER, width=2)
    n = int(round(84 * ease_out((t - 0.7) / 1.5)))
    d.text((100, 516), f"{n:2d}/100", font=font("ExtraBold", 42), fill=GREEN, anchor="lm")
    d.text((280, 516), "match with your profile", font=font("Regular", 20), fill=MUTED, anchor="lm")
    alpha_paste(fr, ly, a)

role_scene("s06", "agents-scorer.png", "The Scorers",
           "A score for every position:\nhow well it fits you, 0-100.", {2}, "slideleft",
           hold=0.6, render=2.6, extra=scorer_badge)

# ================================================================ S7 Scrittori e Critici — RIPRESA VERA
# La fabbrica dei CV vista da vicino: carrellata sul reparto Scrittori.
game_scene("s07", "dept", 40, 7.0,
           [("The Writers tailor CVs and cover letters,\nposition by position.", 0.5, 3.4),
            ("The Critics blind-review every document.\nThree rounds, no mercy.", 3.8, 6.7)],
           "fade")

# ================================================================ S8 l'ufficio — RIPRESA VERA
# Il punto emotivo: l'ufficio del videogioco in movimento, coi reparti che
# chiacchierano in inglese.
game_scene("s08", "office", 40, 10.0,
           [("Not a dashboard: an office, inside a video game.", 0.7, 5.0),
            ("Watch them work for you,\nwhile you do something else.", 5.5, 9.6)],
           "fade")

# ================================================================ S9 la chat — RIPRESA VERA
# La pagina a fumetti che si scrive da sola: vignette, "sta scrivendo…",
# risposta. Pastiglia più in alto: la barra di input vive a fondo pagina e la
# targa "HOLMES · SCOUT-1" sta a y≈603 — a 560 la pastiglia non la tocca.
game_scene("s09", "chat", 40, 9.5,
           [("And you talk to them, like teammates.", 0.6, 4.4),
            ("Ask, steer, approve — in plain language.", 5.0, 9.1)],
           "fade", pill_y=560)

# ================================================================ S10 il sito
head9 = layer(); d = ImageDraw.Draw(head9)
d.text((W//2, 64), "Follow the hunt from the web, anywhere.", font=font("Bold", 40), fill=TITLE, anchor="mm")
d.text((W//2, 116), "the hunt map · the scores · the budget", font=font("Regular", 24), fill=DIM, anchor="mm")
shot = Image.open(f"{REPO}/assets/screenshots/beta2-map.png").convert("RGB")
sw = 800
sh_ = int(shot.height * sw / shot.width)
shot = shot.resize((sw, sh_), Image.LANCZOS)
card9 = layer(); d = ImageDraw.Draw(card9)
cx0, cy0 = (W - sw - 4) // 2, 150
d.rectangle([cx0, cy0, cx0 + sw + 4, cy0 + 36 + sh_ + 2], fill=CARD, outline=BORDER, width=2)
for k in range(3):
    d.ellipse([cx0 + 16 + k * 22, cy0 + 12, cx0 + 28 + k * 22, cy0 + 24], fill=BORDER)
d.text((cx0 + 90, cy0 + 18), "jobhunterteam.ai/case-studies", font=font("Regular", 17), fill=DIM, anchor="lm")
card9.paste(shot, (cx0 + 2, cy0 + 36))
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
    d.text((x + cw//2, y + 78), num, font=font("ExtraBold", 64), fill=col, anchor="mm")
    d.text((x + cw//2, y + 144), lab, font=font("Regular", 24), fill=MUTED, anchor="mm")
    return ly

head10 = layer(); d = ImageDraw.Draw(head10)
d.text((W//2, 74), "One real month, hands-off", font=font("Bold", 36), fill=TITLE, anchor="mm")
d.text((W//2, 124), "public, anonymised data · one beta tester · Jun 3 → Jul 3, 2026",
       font=font("Regular", 23), fill=DIM, anchor="mm")
stats = [("658", "positions found", TITLE), ("520", "analysed and scored", BLUE),
         ("307", "strong matches · score ≥70", STRONG), ("71/100", "average match", GREEN)]
cw_, ch_, gap = 520, 190, 36
gx, gy = (W - cw_*2 - gap)//2, 172
cards10 = []
for i, (num, lab, col) in enumerate(stats):
    x = gx + (i % 2) * (cw_ + gap)
    y = gy + (i // 2) * (ch_ + gap)
    cards10.append(kpi_card_layer(x, y, cw_, ch_, num, lab, col))
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
d.text((W//2, 74), "Open source (MIT).", font=font("ExtraBold", 46), fill=TITLE, anchor="mm")
d.text((W//2, 134), "Runs in a container on your machine: your data stays yours.",
       font=font("Regular", 26), fill=MUTED, anchor="mm")
box = Image.open(f"{PUB}/the-box.png").convert("RGBA")
bb = box.getchannel("A").getbbox()
if bb:
    box = box.crop(bb)
r = 500 / box.height
box = box.resize((int(box.width * r), 500), Image.LANCZOS)
lyr_box = layer()
lyr_box.alpha_composite(box, ((W - box.width) // 2, 195))
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
d.text((tx, 232), "Job Hunter ", font=f_t, fill=TITLE)
d.text((tx + w1, 232), "Team", font=f_t, fill=GREEN)
cta.append((ly, 0.0))
ly = layer(); d = ImageDraw.Draw(ly)
d.text((W//2, 402), "free · open source · in beta", font=font("Regular", 26), fill=MUTED, anchor="mm")
cta.append((ly, 0.3))
ly = layer(); d = ImageDraw.Draw(ly)
d.text((W//2, 490), "jobhunterteam.ai", font=font("Bold", 38), fill=GREEN, anchor="mm")
cta.append((ly, 0.55))
ly = layer(); d = ImageDraw.Draw(ly)
d.text((W//2, 552), "github.com/leopu00/job-hunter-team", font=font("Medium", 27), fill=BASE, anchor="mm")
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
