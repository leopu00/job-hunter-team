#!/usr/bin/env python3
"""Versione VERTICALE 9:16 (720x1280) del video finale (sober, senza musica).

Stessa timeline e stessa voce di make_show.py (la traccia si riusa pari
pari: durate identiche scena per scena), stesse didascalie a schermo;
ogni scena è RICOMPOSTA per la colonna stretta, mai un ritaglio cieco:

  - riprese del gioco: ritaglio 608x1080 che SEGUE il soggetto (replica del
    percorso camera di game/tools/promo_director.gd) + BANDA "SIMULATION —
    not real data" disegnata per intero in alto: nel montaggio precedente il
    badge di gioco veniva mozzato dal ritaglio («SIMULATION — not real (»),
    che è peggio di niente. La banda copre il badge tagliato e dichiara
    la simulazione con il testo COMPLETO;
  - chat: composito (header + colonna vignette a tutta larghezza + ritratto);
  - web: riprese MOBILI vere (viewport 390x693 dsf2 di record_web.py):
    il globo e lo swipe come li vede un telefono;
  - scene testo reimpaginate in colonna.

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

def agent_img(name, height):
    ag = Image.open(f"{PUB}/{name}").convert("RGBA")
    bb = ag.getchannel("A").getbbox()
    if bb:
        ag = ag.crop(bb)
    r = height / ag.height
    return ag.resize((int(ag.width * r), int(ag.height * r)), Image.LANCZOS)

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

# ── percorso camera del gioco (copia di promo_director.gd) ─────────────
CAP_W, CAP_H = 1920, 1080
CROP_W = 608

OFF_HOLD, OFF_PUSH, OFF_DRIFT = 2.6, 3.6, 6.8
OFF_WIDE = (1700.0, 950.0, 1920.0 / 3400.0)
OFF_CLOSE = (660.0, 528.0, 1.95)
OFF_DRIFT_TO = (640.0, 520.0, 2.02)
OFFICE_SUBJECT_X = 555.0

DEPT_SECONDS = 9.0
DEPT_FROM = (700.0, 1650.0, 1.80)
DEPT_TO = (715.0, 1660.0, 1.92)
# 500, non il centro dei due Scrittori (~470): le vignette dei fumetti si
# appoggiano a destra delle scrivanie e a 470 la seconda usciva dal ritaglio
# tagliata a metà parola (misurato sul frame nativo 103: vignetta fino a
# x≈865 col crop che chiudeva a 832).
DEPT_SUBJECT_X = 500.0

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
    cx, _cy, z = cam
    sx = (subject_x - cx) * z + CAP_W / 2.0
    return max(0.0, min(CAP_W - CROP_W, sx - CROP_W / 2.0))

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

def game_scene_vert(name, clip, skip, dur, cam_fn, subject_x, caption=None):
    files = sorted(f for f in os.listdir(os.path.join(CAP, clip))
                   if f.endswith(".png"))
    n = int(dur * FPS)
    if skip + n > len(files):
        sys.exit(f"clip '{clip}': servono {skip + n} frame, trovati {len(files)}")
    cdir = os.path.join(CAP, clip)
    cap_ly = caption_layer(caption) if caption else None
    def frame(t):
        i = int(t * FPS)
        t_cap = (skip + i) / FPS
        src = Image.open(os.path.join(cdir, files[skip + i])).convert("RGB")
        x0 = subject_crop_x(cam_fn(t_cap), subject_x)
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
        z = 1.0 + 0.12 * p
        ch = src.height / z
        cw = ch * W / H
        cx = (0.50 + 0.05 * p) * src.width
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
        ag = agent_img(img, 560)
        lyr_ag = layer()
        lyr_ag.alpha_composite(ag, ((W - ag.width) // 2, 150))
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
    print("riprese del gioco (ritaglio a seguire + banda SIMULATION)…")
    segs["dept"] = game_scene_vert("dept", "dept", 40, DURS[4],
                                   dept_cam, DEPT_SUBJECT_X,
                                   caption=["Writers tailor your CV",
                                            "Critics review every draft"])
    segs["office"] = game_scene_vert("office", "office", 40, DURS[5],
                                     office_cam, OFFICE_SUBJECT_X)
    segs["chat"] = sc_chat("chat", 70, DURS[6])
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
