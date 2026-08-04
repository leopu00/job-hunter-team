#!/usr/bin/env python3
"""Video «Now Playable» — versione VERTICALE 9:16 (720x1280).

Stessa timeline e stessa voce del montaggio orizzontale (make_show.py):
le durate vengono dalle durate REALI delle battute; qui ogni scena è
RICOMPOSTA per la colonna stretta:

  - riprese di gioco: ritaglio colonna 608x1080 dal nativo 1920x1080
    (fattore 1,184: sempre sopra il pixel 1:1), con la banda opaca
    «SIMULATION — not real data» ridisegnata in testa — il badge di gioco
    verrebbe mozzato dal ritaglio, la banda lo dichiara per intero
    (vincolo: banner leggibile ANCHE nel verticale);
  - Scena 2: beat A in colonna sull'ufficio (tocco sul personaggio), poi
    COMPOSITO verticale della pagina chat: header, vignette, ritratto,
    riga dei suggerimenti a grandezza NATIVA (il chip si deve leggere) e
    barra input+SEND. Il puntatore qui è un cerchio di tocco (regia §8:
    nel verticale il puntatore diventa un tocco), con onda sul click;
  - riprese web: le registrazioni MOBILI vere (viewport 390x693 @2x di
    record_web.py, cursore = cerchio di tocco iniettato in pagina);
  - regole invariate: velocità 1:1 sempre (solo finestre e ritagli, mai
    setpts divisori né atempo), stacchi netti, una sola dissolvenza (7→8).

Output: jht-play-vertical.mp4
"""
import math, os, subprocess, sys
from PIL import Image, ImageDraw

import make_show as HS
import shots_play

W, H, FPS = 720, 1280, 30
ROOT = HS.ROOT
PUB = HS.PUB
CAP = HS.CAP
WEB = HS.WEB
BUILD = os.path.join(ROOT, "build-play-vert")
os.makedirs(BUILD, exist_ok=True)

font = HS.font
ease_io = HS.ease_io
DURS, SCENES, FADE = HS.DURS, HS.SCENES, HS.FADE
NAT_W, NAT_H = 1920, 1080
CROP_W = 608
K = W / CROP_W          # 1.1842: scala colonna → 720

def ffprobe_dur(p):
    return HS.ffprobe_dur(p)

def encoder(seg):
    return subprocess.Popen(
        ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-crf", "18", "-preset", "fast",
         "-pix_fmt", "yuv420p", seg],
        stdin=subprocess.PIPE)

def pipe_scene(name, dur, frame_fn):
    seg = os.path.join(BUILD, f"{name}.mp4")
    proc = encoder(seg)
    for i in range(int(round(dur * FPS))):
        proc.stdin.write(frame_fn(i / FPS).convert("RGB").tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit(f"ffmpeg fallito su {name}")
    return seg

# ── banda SIMULATION (badge sempre completo in colonna) ────────────────
def sim_band():
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

# ── cerchio di tocco (il puntatore del verticale) ──────────────────────
def draw_touch(im, x, y, ripples, t):
    d = ImageDraw.Draw(im, "RGBA")
    for t0 in ripples:
        p = (t - t0) / 0.5
        if 0.0 <= p <= 1.0:
            r = 8 + 34 * ease_io(p)
            a = int(230 * (1.0 - p))
            d.ellipse([x - r, y - r, x + r, y + r],
                      outline=(255, 255, 255, a), width=4)
    d.ellipse([x - 15, y - 15, x + 15, y + 15],
              fill=(255, 255, 255, 92), outline=(255, 255, 255, 220), width=2)

# ── riprese di gioco in colonna ────────────────────────────────────────
def game_shot_vert(name, clip, segs):
    """segs: {skip, dur, x0 (colonna), cursor=[(t,x,y,click)] in coord
    OUTPUT 720x1280}. Tempo mai toccato: solo finestre e ritaglio."""
    seg_path = os.path.join(BUILD, f"{name}.mp4")
    proc = encoder(seg_path)
    for s in segs:
        n = int(round(s["dur"] * FPS))
        cur = s.get("cursor")
        ripples = [k[0] for k in (cur or []) if k[3]]
        for i in range(n):
            fi = s["skip"] + i
            im = Image.open(os.path.join(CAP, clip, f"f{fi:08d}.png")).convert("RGB")
            x0 = int(max(0, min(NAT_W - CROP_W, s.get("x0", 656))))
            im = im.crop((x0, 0, x0 + CROP_W, NAT_H))
            im = im.resize((W, H), Image.LANCZOS).convert("RGBA")
            im.alpha_composite(SIM_BAND, (0, 0))
            if cur:
                t_clip = fi / FPS
                st = HS.cursor_state(cur, t_clip)
                if st:
                    draw_touch(im, st[0], st[1], ripples, t_clip)
            proc.stdin.write(im.convert("RGB").tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit(f"ffmpeg fallito su {name}")
    return seg_path

# ── Scena 2: composito verticale della pagina chat ─────────────────────
# Regioni native → destinazione. La riga dei suggerimenti resta a
# grandezza NATIVA (il chip si deve leggere: è il bersaglio del tocco).
CHAT_HEADER = (20, 26, 520, 72)      # → x1.30 a (20,14)
CHAT_BUBBLES = (240, 88, 1340, 908)  # → x0.6545 a (0,96)
CHAT_PORTRAIT = (1430, 110, 1810, 975)
CHAT_CHIPROW = (25, 928, 745, 992)   # → 1:1 a (0,1102)
CHAT_INPUTROW = (25, 985, 1340, 1038)  # → x0.5475 a (0,1180)

def chat_map(nx, ny):
    """Mappa un punto nativo della pagina chat nel composito verticale."""
    if CHAT_CHIPROW[1] <= ny <= CHAT_CHIPROW[3] and nx <= CHAT_CHIPROW[2]:
        return ((nx - CHAT_CHIPROW[0]), 1102 + (ny - CHAT_CHIPROW[1]))
    if ny > CHAT_INPUTROW[1]:
        return ((nx - CHAT_INPUTROW[0]) * 0.5475,
                1180 + (ny - CHAT_INPUTROW[1]) * 0.5475)
    return ((nx - CHAT_BUBBLES[0]) * 0.6545, 96 + (ny - CHAT_BUBBLES[1]) * 0.6545)

def sc_click_vert(name, segs_a, seg_b):
    """Beat A: colonna ufficio col tocco sul personaggio. Beat B: il
    composito chat, tocco su chip e SEND."""
    seg_path = os.path.join(BUILD, f"{name}.mp4")
    proc = encoder(seg_path)
    # beat A — colonna
    for s in segs_a:
        n = int(round(s["dur"] * FPS))
        cur = s.get("cursor")
        ripples = [k[0] for k in (cur or []) if k[3]]
        for i in range(n):
            fi = s["skip"] + i
            im = Image.open(os.path.join(CAP, "click-chat",
                                         f"f{fi:08d}.png")).convert("RGB")
            x0 = int(s.get("x0", 656))
            im = im.crop((x0, 0, x0 + CROP_W, NAT_H))
            im = im.resize((W, H), Image.LANCZOS).convert("RGBA")
            im.alpha_composite(SIM_BAND, (0, 0))
            if cur:
                t_clip = fi / FPS
                st = HS.cursor_state(cur, t_clip)
                if st:
                    draw_touch(im, st[0], st[1], ripples, t_clip)
            proc.stdin.write(im.convert("RGB").tobytes())
    # beat B — composito
    n = int(round(seg_b["dur"] * FPS))
    cur = seg_b.get("cursor")
    ripples = [k[0] for k in (cur or []) if k[3]]
    for i in range(n):
        fi = seg_b["skip"] + i
        src = Image.open(os.path.join(CAP, "click-chat",
                                      f"f{fi:08d}.png")).convert("RGB")
        fr = Image.new("RGBA", (W, H), (232, 234, 240, 255))
        head = src.crop(CHAT_HEADER)
        head = head.resize((int(head.width * 1.30), int(head.height * 1.30)),
                           Image.LANCZOS)
        fr.paste(head, (20, 14))
        bub = src.crop(CHAT_BUBBLES)
        bw = int(bub.width * 0.6545)
        bub = bub.resize((bw, int(bub.height * 0.6545)), Image.LANCZOS)
        fr.paste(bub, ((W - bw) // 2, 96))
        por = src.crop(CHAT_PORTRAIT)
        ps = 430.0 / por.height
        por = por.resize((int(por.width * ps), 430), Image.LANCZOS)
        fr.paste(por, ((W - por.width) // 2, 650))
        chip = src.crop(CHAT_CHIPROW)          # 1:1 — leggibile
        fr.paste(chip, (0, 1102))
        row = src.crop(CHAT_INPUTROW)
        row = row.resize((int(row.width * 0.5475), int(row.height * 0.5475)),
                         Image.LANCZOS)
        fr.paste(row, (0, 1180))
        if cur:
            t_clip = fi / FPS
            st = HS.cursor_state(cur, t_clip)
            if st:
                draw_touch(fr, st[0], st[1], ripples, t_clip)
        proc.stdin.write(fr.convert("RGB").tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit(f"ffmpeg fallito su {name}")
    return seg_path

# ── riprese web mobili: finestre 1:1 ───────────────────────────────────
def web_segment_vert(name, src, t0, dur):
    if t0 + dur > ffprobe_dur(src) - 0.05:
        sys.exit(f"{name}: finestra {t0}+{dur:.2f}s oltre la ripresa {src}")
    seg = os.path.join(BUILD, f"{name}.mp4")
    # il setpts RIBASA solo i timestamp dopo il trim (fattore 1)
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", src, "-vf",
         f"trim=start={t0}:end={t0 + dur},setpts=PTS-STARTPTS,"
         f"crop=779:1385:0:0,scale={W}:{H},fps={FPS}",
         "-c:v", "libx264", "-crf", "18", "-preset", "fast",
         "-pix_fmt", "yuv420p", seg], check=True)
    return seg

def concat(name, parts):
    seg = os.path.join(BUILD, f"{name}.mp4")
    cmd = ["ffmpeg", "-y", "-v", "error"]
    for p in parts:
        cmd += ["-i", p]
    # `setsar=1` su OGNI ingresso prima del concat: i pezzi hanno tutti
    # 720x1280, ma non lo stesso rapporto dei PIXEL — chi nasce da PIL
    # esce con SAR 0:1, chi passa da uno scale di ffmpeg con 1556:1557.
    # concat pretende che coincidano e fallisce con "parameters do not
    # match", un errore che parla di dimensioni mentre il problema e'
    # altrove. Normalizzarlo qui costa nulla e vale per tutti i rami.
    fc = "".join(f"[{i}:v]setsar=1[v{i}];" for i in range(len(parts))) + \
         "".join(f"[v{i}]" for i in range(len(parts))) + \
         f"concat=n={len(parts)}:v=1[out]"
    subprocess.run(cmd + ["-filter_complex", fc, "-map", "[out]",
                          "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                          "-pix_fmt", "yuv420p", seg], check=True)
    return seg

# ── scene PIL ──────────────────────────────────────────────────────────
def sc_box(dur):
    src = Image.open(f"{PUB}/the-box.png").convert("RGB")
    s0 = max(W / src.width, H / src.height)
    def frame(t):
        z = 1.0 + 0.08 * ease_io(t / dur)
        cw, ch = W / (s0 * z), H / (s0 * z)
        cx, cy = src.width / 2, src.height * 0.5
        px = max(0, min(src.width - cw, cx - cw / 2))
        py = max(0, min(src.height - ch, cy - ch / 2))
        fr = src.crop((int(px), int(py), int(px + cw), int(py + ch)))
        return fr.resize((W, H), Image.LANCZOS).convert("RGBA")
    return frame

def sc_cta(dur, night_still, x0=656):
    bg = Image.open(night_still).convert("RGB").crop(
        (x0, 0, x0 + CROP_W, NAT_H)).resize((W, H), Image.LANCZOS)
    bg = Image.eval(bg, lambda v: int(v * 0.16)).convert("RGBA")
    d0 = ImageDraw.Draw(bg)
    d0.rectangle([0, 0, W, H], fill=(4, 5, 9, 150))
    items = []
    ly = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ly)
    d.text((W // 2, 470), "JOB HUNTER", font=font("ExtraBold", 64),
           fill=HS.WHITE, anchor="mm")
    d.text((W // 2, 552), "TEAM", font=font("ExtraBold", 64),
           fill=HS.GREEN, anchor="mm")
    items.append((ly, 0.0))
    ly = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ly)
    d.text((W // 2, 690), "jobhunterteam.ai", font=font("Bold", 38),
           fill=HS.GREEN, anchor="mm")
    items.append((ly, 0.35))
    ly = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ly)
    d.text((W // 2, 756), "Free · Open source · Beta",
           font=font("Regular", 23), fill=HS.MUTED, anchor="mm")
    items.append((ly, 0.6))
    def frame(t):
        fr = bg.copy()
        for ly, delay in items:
            p = ease_io((t - delay) / 0.5)
            if p <= 0:
                continue
            if p < 1:
                tmp = ly.copy()
                tmp.putalpha(tmp.getchannel("A").point(lambda v: int(v * p)))
                fr.alpha_composite(tmp, (0, int(14 * (1 - p))))
            else:
                fr.alpha_composite(ly)
        return fr
    return frame

# ── montaggio ──────────────────────────────────────────────────────────
def build_video(v):
    segs = {}
    print("scene di gioco (colonna)…")
    segs["open"] = game_shot_vert("open", "open-day", v["open"])
    segs["click"] = sc_click_vert("click", v["click_a"], v["click_b"])
    segs["pixels"] = game_shot_vert("pixels", "work-pixels", v["pixels"])
    segs["tailor"] = game_shot_vert("tailor", "tailor-88", v["tailor"])
    print("scene web (mobile)…")
    globe_parts = [web_segment_vert(f"g{i}", *w) for i, w in enumerate(v["globe"])]
    segs["globe"] = concat("globe", globe_parts)
    segs["swipe"] = web_segment_vert("swipe", *v["swipe"])
    print("scena 7 e card…")
    box = pipe_scene("home_box", v["home_box_dur"], sc_box(v["home_box_dur"]))
    night_seg = game_shot_vert("home_night", "dusk-night", [v["home_night"]])
    segs["home"] = concat("home", [box, night_seg])
    last = v["home_night"]["skip"] + int(v["home_night"]["dur"] * FPS) - 1
    night_still = os.path.join(CAP, "dusk-night", f"f{last:08d}.png")
    segs["cta"] = pipe_scene("cta", DURS[7], sc_cta(DURS[7], night_still))

    for k, (nm, dur) in enumerate(SCENES):
        got = ffprobe_dur(segs[nm])
        if got + 0.05 < dur:
            sys.exit(f"scena {nm}: girato {got:.2f}s < scena {dur:.2f}s")

    print("assemblaggio…")
    cut = []
    for k, (nm, dur) in enumerate(SCENES):
        c = os.path.join(BUILD, f"cut_{nm}.mp4")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", segs[nm],
                        "-vf", f"trim=duration={dur:.3f},setpts=PTS-STARTPTS",
                        "-c:v", "libx264", "-crf", "18", "-preset", "fast",
                        "-pix_fmt", "yuv420p", c], check=True)
        cut.append(c)
    body = concat("body", cut[:-1])
    silent = os.path.join(BUILD, "video.mp4")
    off = ffprobe_dur(body) - FADE
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", body, "-i", cut[-1],
         "-filter_complex",
         f"[0:v][1:v]xfade=transition=fade:duration={FADE}:offset={off:.3f},"
         "format=yuv420p[out]",
         "-map", "[out]", "-c:v", "libx264", "-crf", "20", "-preset", "medium",
         "-movflags", "+faststart", silent], check=True)
    return silent

if __name__ == "__main__":
    video = build_video(shots_play.VERT)
    print(f"video muto: {ffprobe_dur(video):.2f}s")
    HS.mux(video, os.path.join(ROOT, "jht-play-vertical.mp4"))
