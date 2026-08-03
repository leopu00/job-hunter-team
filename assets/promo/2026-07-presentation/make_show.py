#!/usr/bin/env python3
"""Video di presentazione JHT — versione DENSA (sober), 1280x720, ~53 s.

Tornata del 03/08 sul feedback utente: la versione da 73,5 s aveva pause di
2,4-16 s e cinque scene mute — "il silenzio serve a far respirare, non a far
aspettare". Qui:
  - il copione NON cambia (le 7 battute approvate, stessa voce Daniel);
  - le pause fra le battute scendono a ~1-1,5 s dove le scene adiacenti sono
    parlate; le scene mute si accorciano a 3,5-4,6 s invece di correre vuote;
  - dove una battuta non sta nella sua scena NON si accelera il parlato:
    la voce scavalca il taglio (L-cut sulla scena office→chat, J-cut della
    battuta box che parte sul finale di results) — è montaggio, non fretta;
  - il ritmo del PARLATO resta quello scelto dall'utente (rate 155): il
    guadagno viene tutto dal togliere i vuoti.

Il video si monta UNA volta; poi si muxa la traccia voce. Le durate della
voce si rileggono SEMPRE da audio/<v>/durations.txt: cambiare motore vocale
(make_voiceover.py) riflow-a la schedule senza toccare questo file.
I frame non toccano mai il disco: ogni scena PIL viene piped a ffmpeg
(rawvideo su stdin) — il disco della macchina è quasi pieno.

Prerequisiti:
  scenes/capture/{office,dept,chat}/   riprese del gioco (record_clips.sh)
  webrec/web_{map,positions,swipe}.webm  riprese web (record_web.py)
  audio/sober/segNN.wav                voce (make_voiceover.py)

Output: jht-show-sober.mp4 accanto allo script.
"""
import math, os, shutil, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1280, 720, 30
ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(ROOT)))
PUB = f"{REPO}/web/public"
CAP = os.path.join(ROOT, "scenes", "capture")
WEB = os.path.join(ROOT, "webrec")
AUD = os.path.join(ROOT, "audio")
BUILD = os.path.join(ROOT, "build")
FDIR = os.path.expanduser("~/Library/Fonts")

def font(weight, size):
    return ImageFont.truetype(os.path.join(FDIR, f"JetBrainsMono-{weight}.ttf"), size)

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
DARKBAR = (16, 18, 30)

def ease_out(p):
    p = max(0.0, min(1.0, p))
    return 1 - (1 - p) ** 3

def ease_io(p):
    p = max(0.0, min(1.0, p))
    return 0.5 - 0.5 * math.cos(math.pi * p)

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

def agent_img(name, box_w, box_h):
    ag = Image.open(f"{PUB}/{name}").convert("RGBA")
    bb = ag.getchannel("A").getbbox()
    if bb:
        ag = ag.crop(bb)
    r = min(box_w / ag.width, box_h / ag.height)
    return ag.resize((int(ag.width * r), int(ag.height * r)), Image.LANCZOS)

# ── timeline ───────────────────────────────────────────────────────────
# (nome, durata_s). Tornata 03/08: scene mute corte (3,5-4,6 s), scene
# parlate dimensionate su lead + durata REALE della battuta + coda ~1-1,3 s.
# La battuta office (7,5 s) NON sta nella sua scena: prosegue di proposito
# sulla scena chat (L-cut). xfade 0.5 s fra tutte le scene.
FADE = 0.5
SCENES = [
    ("hook",     3.6),
    ("reveal",   4.4),
    ("meeting",  3.5),   # muta: didascalia roles/captain/budget
    ("roles",    6.6),
    ("dept",     4.0),   # muta: didascalia Writers/Critics + 2 vignette
    ("office",   6.5),   # la voce prosegue sulla scena chat (L-cut)
    ("chat",     4.6),   # coda della voce office + didascalia ask·steer·approve
    ("globe",    6.5),
    ("webpages", 4.6),   # muta: didascalie scores·salaries / swipe
    ("results",  4.4),   # muta: parlano i numeri grandi
    ("box",      5.6),   # la voce parte 1,4 s PRIMA della scena (J-cut)
    ("cta",      5.0),
]
DURS = [d for _, d in SCENES]
VO_LEAD = 0.5      # attacco voce di default: 0.5 s dopo l'inizio scena
# Offset per-scena rispetto all'inizio scena: negativo = J-cut (la battuta
# comincia sul finale della scena precedente, da manuale di montaggio).
VO_OFF = {"box": -1.4}

def scene_start(k):
    return sum(DURS[:k]) - FADE * k

# Una sola versione: la "sober" scelta dall'utente — Daniel, senza musica.
VERSIONS = {
    "sober": {"music": None, "gain": 0.0},
}

# Le durate della voce arrivano SEMPRE dai file (durations.txt): se si
# rigenera l'audio con un altro motore, la schedule si riadatta da sola.
def vo_durs(version):
    dpath = os.path.join(AUD, version, "durations.txt")
    if not os.path.isfile(dpath):
        sys.exit(f"manca {dpath} — lancia prima make_voiceover.py")
    vo = [float(l.split()[1]) for l in open(dpath)]
    if len(vo) != len(SCENES):
        sys.exit(f"durations.txt ha {len(vo)} segmenti, la timeline "
                 f"{len(SCENES)} scene: riallineare make_voiceover.py")
    return vo

os.makedirs(BUILD, exist_ok=True)

# ── renderer: frame PIL → ffmpeg via pipe (niente PNG su disco) ────────
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
        fr = frame_fn(i / FPS)
        proc.stdin.write(fr.convert("RGB").tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit(f"ffmpeg fallito su {name}")
    return seg

def ffprobe_dur(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                          "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True)
    return float(out.stdout.strip())

# ── didascalie (lower third) ───────────────────────────────────────────
# Le informazioni TOLTE dal parlato non spariscono: diventano didascalie.
# Pillola scura centrata in basso, una o due righe, JetBrains Mono.
def caption_layer(lines, y_bottom=700, size=25):
    ly = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ly)
    f_ = font("Medium", size)
    lh = int(size * 1.5)
    tw = max(d.textlength(s, font=f_) for s in lines)
    pad_x, pad_y = 26, 14
    bh = lh * len(lines) + 2 * pad_y - (lh - size)
    x0 = (W - tw) / 2 - pad_x
    y0 = y_bottom - bh
    d.rounded_rectangle([x0, y0, x0 + tw + 2 * pad_x, y_bottom], radius=12,
                        fill=(16, 18, 30, 235))
    for i, s in enumerate(lines):
        d.text((W / 2, y0 + pad_y + size / 2 + i * lh + 2), s, font=f_,
               fill=(225, 228, 242), anchor="mm")
    return ly

# ── browser bar per le scene web ───────────────────────────────────────
BAR_H = 40
def browser_bar(url):
    bar = Image.new("RGBA", (W, BAR_H), DARKBAR)
    d = ImageDraw.Draw(bar)
    for k, col in enumerate(((255, 96, 88), (255, 189, 46), (39, 201, 63))):
        d.ellipse([18 + k * 22, 14, 30 + k * 22, 26], fill=col)
    d.rounded_rectangle([100, 7, W - 100, BAR_H - 7], radius=8,
                        fill=(30, 33, 48))
    d.text((W // 2, BAR_H // 2), url, font=font("Regular", 16),
           fill=(200, 205, 220), anchor="mm")
    return bar

def _overlay_png(name, caption):
    """PNG full-frame con la didascalia, per l'overlay ffmpeg."""
    png = os.path.join(BUILD, f"{name}_cap.png")
    caption_layer(caption).save(png)
    return png

def web_segment(name, src, t0, t1, speed, url, caption=None):
    """Ritaglia [t0,t1] dalla ripresa web, la accelera di `speed`, taglia i
    40px in basso (barra controlli mozzata dal viewport) e mette la barra
    browser disegnata in alto (+ didascalia opzionale). Ritorna il path."""
    seg = os.path.join(BUILD, f"{name}.mp4")
    bar_png = os.path.join(BUILD, f"{name}_bar.png")
    browser_bar(url).save(bar_png)
    vf = (f"trim=start={t0}:end={t1},setpts=(PTS-STARTPTS)/{speed},"
          f"crop={W}:{H - BAR_H}:0:0,pad={W}:{H}:0:{BAR_H}:color=#101220,"
          f"fps={FPS}")
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", src, "-i", bar_png]
    fc = f"[0:v]{vf}[v];[v][1:v]overlay=0:0"
    if caption:
        cmd += ["-i", _overlay_png(name, caption)]
        fc += "[vb];[vb][2:v]overlay=0:0"
    subprocess.run(
        cmd + ["-filter_complex", fc + "[out]",
               "-map", "[out]", "-c:v", "libx264", "-crf", "18",
               "-preset", "fast", "-pix_fmt", "yuv420p", seg], check=True)
    return seg

def game_segment(name, clip, skip, dur, caption=None):
    """Ripresa del gioco: PNG 1920x1080 → 1280x720, dal frame `skip`,
    con didascalia opzionale in basso (le scene mute la usano al posto
    della voce)."""
    seg = os.path.join(BUILD, f"{name}.mp4")
    cmd = ["ffmpeg", "-y", "-v", "error", "-framerate", str(FPS),
           "-start_number", str(skip), "-i", f"{CAP}/{clip}/f%08d.png"]
    if caption:
        cmd += ["-i", _overlay_png(name, caption),
                "-filter_complex",
                f"[0:v]scale={W}:{H}[v];[v][1:v]overlay=0:0[out]",
                "-map", "[out]"]
    else:
        cmd += ["-vf", f"scale={W}:{H}"]
    subprocess.run(cmd + ["-frames:v", str(int(dur * FPS)),
                          "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                          "-pix_fmt", "yuv420p", seg], check=True)
    return seg

# ── scene PIL ──────────────────────────────────────────────────────────
def sc_hook(dur):
    t1 = layer(); d = ImageDraw.Draw(t1)
    d.text((W//2, 280), "Job hunting", font=font("ExtraBold", 68), fill=TITLE, anchor="mm")
    d.text((W//2, 370), "is a second job.", font=font("ExtraBold", 68), fill=TITLE, anchor="mm")
    sub = layer(); d = ImageDraw.Draw(sub)
    d.text((W//2, 480), "boards · postings · CVs — every day",
           font=font("Regular", 26), fill=DIM, anchor="mm")
    def frame(t):
        fr = BGF.copy()
        p = ease_out(t / 0.6)
        alpha_paste(fr, t1, p, dy=22 * (1 - p))
        alpha_paste(fr, sub, ease_out((t - 1.1) / 0.5))
        return fr
    return frame

F_T = font("ExtraBold", 82)
_w1 = ImageDraw.Draw(BGF).textlength("Job Hunter ", font=F_T)
_w2 = ImageDraw.Draw(BGF).textlength("Team", font=F_T)
_tx = (W - (_w1 + _w2)) / 2

def sc_reveal(dur):
    lyr_title = layer(); d = ImageDraw.Draw(lyr_title)
    d.text((_tx, H//2 - 130), "Job Hunter ", font=F_T, fill=TITLE)
    d.text((_tx + _w1, H//2 - 130), "Team", font=F_T, fill=GREEN)
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
    s0 = max(W / src.width, H / src.height)
    cap = caption_layer(["clear roles · a captain · a weekly budget"])
    def frame(t):
        p = ease_io(t / dur)
        z = 1.0 + 0.12 * p
        cx = (0.50 + 0.05 * p) * src.width
        cy = (0.46 - 0.02 * p) * src.height
        cw, ch = W / (s0 * z), H / (s0 * z)
        px = max(0, min(src.width - cw, cx - cw / 2))
        py = max(0, min(src.height - ch, cy - ch / 2))
        fr = src.crop((int(px), int(py), int(px + cw), int(py + ch)))
        fr = fr.resize((W, H), Image.LANCZOS).convert("RGBA")
        alpha_paste(fr, cap, ease_out((t - 0.9) / 0.5))
        return fr
    return frame

STEPS = ["Scouts", "Analysts", "Scorers", "Writers", "Critics"]
def pipeline_bar(active):
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
    for i, s in enumerate(STEPS):
        d.text((x, 662), s, font=(f_on if i in active else f_off),
               fill=(GREEN if i in active else DIM))
        x += widths[i]
        if i < len(STEPS) - 1:
            d.text((x, 662), sep, font=f_off, fill=DIM)
            x += d.textlength(sep, font=f_off)
    return ly

def sc_roles(dur):
    """Tre ritratti in staffetta (Scouts→Analysts→Scorers): nome del ruolo,
    MANSIONE sotto (era una battuta della voce, ora è testo) + barra
    pipeline + badge punteggio."""
    sub = dur / 3.0
    cards = []
    for i, (img, role, duty) in enumerate((
            ("agents-scouts.png", "The Scouts", "sweep the job boards"),
            ("agents-analyst.png", "The Analysts", "read every posting"),
            ("agents-scorer.png", "The Scorers", "rate the fit — 0 to 100"))):
        ag = agent_img(img, 620, 560)
        lyr_ag = layer()
        lyr_ag.alpha_composite(ag, (620 + (620 - ag.width) // 2,
                                    80 + (560 - ag.height) // 2))
        lyr_txt = layer(); d = ImageDraw.Draw(lyr_txt)
        d.text((80, 300), role, font=font("ExtraBold", 54), fill=TITLE)
        d.text((80, 378), duty, font=font("Regular", 27), fill=MUTED)
        cards.append((lyr_txt, lyr_ag, pipeline_bar({i})))
    badge = layer(); dbadge = ImageDraw.Draw(badge)
    def frame(t):
        k = min(2, int(t / sub))
        tk = t - k * sub
        lyr_txt, lyr_ag, bar = cards[k]
        fr = BGF.copy()
        p = ease_out(tk / 0.4)
        alpha_paste(fr, lyr_txt, p, dx=-60 * (1 - p))
        q = ease_out((tk - 0.05) / 0.45)
        alpha_paste(fr, lyr_ag, min(1, q * 2.2), dx=300 * (1 - q))
        alpha_paste(fr, bar, 1)
        if k == 2:                      # badge punteggio sul terzo ritratto
            a = ease_out((tk - 0.5) / 0.4)
            if a > 0:
                ly = layer(); d = ImageDraw.Draw(ly)
                d.rectangle([80, 420, 560, 510], fill=CARD, outline=BORDER, width=2)
                n = int(round(84 * ease_out((tk - 0.6) / 1.2)))
                d.text((108, 465), f"{n:2d}/100", font=font("ExtraBold", 42),
                       fill=GREEN, anchor="lm")
                d.text((290, 465), "match with your profile",
                       font=font("Regular", 20), fill=MUTED, anchor="lm")
                alpha_paste(fr, ly, a)
        return fr
    return frame

def sc_results(dur):
    head = layer(); d = ImageDraw.Draw(head)
    d.text((W//2, 74), "One real month, hands-off", font=font("Bold", 36), fill=TITLE, anchor="mm")
    d.text((W//2, 124), "public, anonymised data · one beta tester · Jun 3 → Jul 3, 2026",
           font=font("Regular", 23), fill=DIM, anchor="mm")
    stats = [("658", "positions found", TITLE), ("520", "analysed and scored", BLUE),
             ("307", "strong matches · score ≥70", STRONG), ("71/100", "average match", GREEN)]
    cw_, ch_, gap = 520, 190, 36
    gx, gy = (W - cw_*2 - gap)//2, 172
    cards = []
    for i, (num, lab, col) in enumerate(stats):
        x = gx + (i % 2) * (cw_ + gap)
        y = gy + (i // 2) * (ch_ + gap)
        ly = layer(); d = ImageDraw.Draw(ly)
        d.rectangle([x, y, x + cw_, y + ch_], fill=CARD, outline=BORDER, width=2)
        d.text((x + cw_//2, y + 78), num, font=font("ExtraBold", 64), fill=col, anchor="mm")
        d.text((x + cw_//2, y + 144), lab, font=font("Regular", 24), fill=MUTED, anchor="mm")
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
    d.text((W//2, 84), "Open source (MIT)", font=font("ExtraBold", 46), fill=TITLE, anchor="mm")
    box = Image.open(f"{PUB}/the-box.png").convert("RGBA")
    bb = box.getchannel("A").getbbox()
    if bb:
        box = box.crop(bb)
    r = 520 / box.height
    box = box.resize((int(box.width * r), 520), Image.LANCZOS)
    lyr_box = layer()
    lyr_box.alpha_composite(box, ((W - box.width) // 2, 160))
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
    d.text((_tx, 232), "Job Hunter ", font=F_T, fill=TITLE)
    d.text((_tx + _w1, 232), "Team", font=F_T, fill=GREEN)
    items.append((ly, 0.0))
    ly = layer(); d = ImageDraw.Draw(ly)
    d.text((W//2, 402), "free · open source · in beta", font=font("Regular", 26), fill=MUTED, anchor="mm")
    items.append((ly, 0.3))
    ly = layer(); d = ImageDraw.Draw(ly)
    d.text((W//2, 490), "jobhunterteam.ai", font=font("Bold", 38), fill=GREEN, anchor="mm")
    items.append((ly, 0.55))
    ly = layer(); d = ImageDraw.Draw(ly)
    d.text((W//2, 552), "github.com/leopu00/job-hunter-team", font=font("Medium", 27), fill=BASE, anchor="mm")
    items.append((ly, 0.75))
    def frame(t):
        fr = BGF.copy()
        for ly, delay in items:
            p = ease_out((t - delay) / 0.5)
            alpha_paste(fr, ly, p, dy=26 * (1 - p))
        return fr
    return frame

# ── montaggio video ────────────────────────────────────────────────────
def build_video():
    segs = {}
    print("scene PIL…")
    segs["hook"] = pipe_scene("hook", DURS[0], sc_hook(DURS[0]))
    segs["reveal"] = pipe_scene("reveal", DURS[1], sc_reveal(DURS[1]))
    segs["meeting"] = pipe_scene("meeting", DURS[2], sc_meeting(DURS[2]))
    segs["roles"] = pipe_scene("roles", DURS[3], sc_roles(DURS[3]))
    segs["results"] = pipe_scene("results", DURS[9], sc_results(DURS[9]))
    segs["box"] = pipe_scene("box", DURS[10], sc_box(DURS[10]))
    segs["cta"] = pipe_scene("cta", DURS[11], sc_cta(DURS[11]))
    print("riprese del gioco…")
    # skip tarati sulla timeline corta: dept parte a f100 così ENTRAMBE le
    # vignette compaiono nei primi 1,1 s (a f40 la seconda arrivava a scena
    # quasi finita); chat parte a f115 con lo scambio già avviato e chiude
    # sull'ultima risposta. office resta a f40: panoramica + push-in.
    segs["dept"] = game_segment("dept", "dept", 100, DURS[4],
                                caption=["Writers tailor your CV, position by position",
                                         "Critics review every draft"])
    segs["office"] = game_segment("office", "office", 40, DURS[5])
    segs["chat"] = game_segment("chat", "chat", 115, DURS[6],
                                caption=["chat with your team — ask · steer · approve"])
    print("riprese web (demo mode)…")
    g1 = min(15.7, ffprobe_dur(f"{WEB}/web_map.webm") - 0.3)
    segs["globe"] = web_segment("globe", f"{WEB}/web_map.webm",
                                5.2, g1, (g1 - 5.2) / DURS[7],
                                "jobhunterteam.ai/map — your private hunt map")
    # webpages: positions + swipe in un segmento solo, stacco secco interno
    half = DURS[8] / 2
    pos = web_segment("wp_pos", f"{WEB}/web_positions.webm",
                      3.8, 7.3, (7.3 - 3.8) / half,
                      "jobhunterteam.ai/positions",
                      caption=["every position · match score · salary"])
    swi = web_segment("wp_swipe", f"{WEB}/web_swipe.webm",
                      4.4, 7.9, (7.9 - 4.4) / half,
                      "jobhunterteam.ai/swipe",
                      caption=["swipe to decide"])
    both = os.path.join(BUILD, "webpages.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", pos, "-i", swi,
                    "-filter_complex", "[0:v][1:v]concat=n=2:v=1[out]",
                    "-map", "[out]", "-c:v", "libx264", "-crf", "18",
                    "-preset", "fast", "-pix_fmt", "yuv420p", both], check=True)
    segs["webpages"] = both

    print("assemblaggio con xfade…")
    order = [segs[name] for name, _ in SCENES]
    durs = [ffprobe_dur(p) for p in order]
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

# ── mix audio e mux ────────────────────────────────────────────────────
def vo_gain(path, target_db=-18.0):
    out = subprocess.run(
        ["ffmpeg", "-i", path, "-af", "astats=metadata=1", "-f", "null", "-"],
        capture_output=True, text=True)
    for line in out.stderr.splitlines():
        if "RMS level dB" in line:
            try:
                rms = float(line.split(":")[1])
            except ValueError:
                continue
            return 10 ** ((target_db - rms) / 20)
    return 1.0

def vo_schedule(version, verbose=False):
    """Attacchi della voce: ancorati all'inizio scena (+VO_LEAD, o l'offset
    per-scena di VO_OFF per i J-cut) e mai sovrapposti al segmento
    precedente (GAP minimo 0.9 s). Le battute possono scavalcare i tagli
    (L-cut): il vincolo è il flusso del parlato, non la gabbia della scena."""
    GAP = 0.9
    vo = vo_durs(version)
    starts, prev_end = [], 0.0
    for k in range(len(SCENES)):
        off = VO_OFF.get(SCENES[k][0], VO_LEAD)
        s = max(scene_start(k) + off, prev_end + GAP)
        starts.append(s)
        if vo[k] > 0:
            prev_end = s + vo[k]
    if prev_end > sum(DURS) - FADE * (len(SCENES) - 1) - 0.1:
        sys.exit(f"[{version}] la voce sborda dal video ({prev_end:.1f}s)")
    if verbose:
        # Profilo delle pause: è il numero che l'utente ha contestato
        # (prima 2,4-16 s), quindi lo stampiamo a ogni build.
        print("pause fra le battute:")
        last_end, last_k = None, None
        for k in range(len(SCENES)):
            if vo[k] <= 0:
                continue
            if last_end is not None:
                print(f"  {SCENES[last_k][0]:>8} → {SCENES[k][0]:<8} "
                      f"{starts[k] - last_end:5.2f}s")
            last_end, last_k = starts[k] + vo[k], k
    return starts


def mux(video, version, out_path):
    cfg = VERSIONS[version]
    vdir = os.path.join(AUD, version)
    total = ffprobe_dur(video)
    starts = vo_schedule(version, verbose=True)
    inputs, fparts, mixin = ["-i", video], [], []
    idx = 1
    for k in range(len(SCENES)):
        wav = os.path.join(vdir, f"seg{k:02d}.wav")
        if not os.path.isfile(wav):
            continue
        delay_ms = int(starts[k] * 1000)
        g = vo_gain(wav)
        inputs += ["-i", wav]
        fparts.append(f"[{idx}:a]volume={g:.3f},adelay={delay_ms}|{delay_ms}[vo{k}]")
        mixin.append(f"[vo{k}]")
        idx += 1
    n_vo = len(mixin)
    fparts.append("".join(mixin) + f"amix=inputs={n_vo}:normalize=0[vo]")
    if cfg["music"]:
        inputs += ["-i", cfg["music"]]
        fparts.append(
            f"[{idx}:a]volume={cfg['gain']},atrim=0:{total:.2f},"
            f"afade=t=out:st={total-2.5:.2f}:d=2.5[mus]")
        fparts.append("[vo][mus]amix=inputs=2:normalize=0[mix]")
    else:
        fparts.append("[vo]anull[mix]")
    # pad LIMITATO alla durata video: apad "infinito" + -shortest a volte
    # non termina (ffmpeg macina silenzio per sempre); whole_dur è certo.
    # level=disabled: senza, alimiter RIALZA tutto al limit (auto-level di
    # default) e la musica finisce a 3 dB dalla voce invece che a ~9.
    fparts.append(f"[mix]apad=whole_dur={total:.2f},"
                  "alimiter=limit=0.93:level=disabled[aout]")
    cmd = (["ffmpeg", "-y", "-v", "error"] + inputs +
           ["-filter_complex", ";".join(fparts),
            "-map", "0:v", "-map", "[aout]", "-c:v", "copy",
            "-c:a", "aac", "-b:a", "160k", "-shortest", out_path])
    subprocess.run(cmd, check=True)
    print(f"→ {out_path} · {ffprobe_dur(out_path):.1f}s · "
          f"{os.path.getsize(out_path)/1e6:.1f} MB")

if __name__ == "__main__":
    video = build_video()
    print(f"video muto: {ffprobe_dur(video):.2f}s")
    for v in VERSIONS:
        mux(video, v, os.path.join(ROOT, f"jht-show-{v}.mp4"))
