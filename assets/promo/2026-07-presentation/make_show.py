#!/usr/bin/env python3
"""Video «Now Playable» (regia 03/08) — montaggio orizzontale 1280x720.

Otto scene, stacchi netti (una sola dissolvenza: Scena 7 → 8, come da
regia §9), durate calcolate dalle durate REALI della voce (durations.txt
della versione `play`). REGOLE NON NEGOZIABILI ereditate dai tre rifiuti:

  1. MAI accelerare: ogni ripresa gira 1:1 (nessun setpts divisore, nessun
     atempo). Se una ripresa è più lunga della scena si TAGLIA sul gesto
     (finestre multiple, cut on action), non si comprime il tempo. Le
     ri-inquadrature sono CROP spaziali (zoom digitale dal master 1080p →
     720p, mai sotto il rapporto 1:1 dei pixel), non manipolazioni del tempo.
  2. La voce non molla mai: gap tra battute ≤ 1,5 s (misurati in mux).
  3. Il puntatore si VEDE cliccare: nelle riprese web è il cursore DOM
     registrato in pagina (record_web.py); nella Scena 2 del gioco è
     DISEGNATO qui, sui frame noti della regia (promo_director.gd), con
     onda di clic. Movimenti a passi con easing, mai salti.
  4. Niente numeri aggregati, niente rassegna ruoli, niente frasi vietate
     (§7.4): il testo in quadro è solo diegetico + la card finale.

Prerequisiti:
  scenes/capture/{open-day,click-chat,work-pixels,tailor-88,dusk-night}/
  webrec/web_{hunt,sheet,swipe}.webm     riprese web (record_web.py)
  audio/play/segNN.wav                   voce (make_voiceover.py)

Output: jht-play.mp4 accanto allo script.
"""
import math, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

W, H, FPS = 1280, 720, 30
ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(ROOT)))
PUB = f"{REPO}/web/public"
CAP = os.path.join(ROOT, "scenes", "capture")
WEB = os.path.join(ROOT, "webrec")
AUD = os.path.join(ROOT, "audio")
BUILD = os.path.join(ROOT, "build-play")
FDIR = os.path.expanduser("~/Library/Fonts")
NATIVE_W, NATIVE_H = 1920, 1080

def font(weight, size):
    return ImageFont.truetype(os.path.join(FDIR, f"JetBrainsMono-{weight}.ttf"), size)

GREEN = (14, 200, 92)
WHITE = (240, 242, 248)
MUTED = (150, 155, 175)

def ease_io(p):
    p = max(0.0, min(1.0, p))
    return 0.5 - 0.5 * math.cos(math.pi * p)

# ── timeline ───────────────────────────────────────────────────────────
# (nome, lead, tail): durata scena = lead + voce reale + tail. Lead e coda
# corti: la copertura voce misurata deve restare ≥ 85%% (vincolo committente),
# e il gap fra due battute (tail + lead successivo) resta ≤ 1,2 s.
FADE = 0.5      # unica dissolvenza: home → cta
SPEC = [
    ("open",   0.4, 0.9),
    ("click",  0.3, 0.8),
    ("pixels", 0.3, 0.7),
    ("tailor", 0.3, 0.7),
    ("globe",  0.3, 0.8),
    ("swipe",  0.3, 0.8),
    ("home",   0.4, 0.8),
    ("cta",    0.4, 2.4),
]
VERSION = "play"

def vo_durs():
    dpath = os.path.join(AUD, VERSION, "durations.txt")
    if not os.path.isfile(dpath):
        sys.exit(f"manca {dpath} — lancia prima make_voiceover.py")
    vo = [float(l.split()[1]) for l in open(dpath)]
    if len(vo) != len(SPEC):
        sys.exit("durations.txt non allineato alla timeline")
    return vo

VO = vo_durs()
DURS = [lead + VO[k] + tail for k, (n, lead, tail) in enumerate(SPEC)]
SCENES = [(n, DURS[k]) for k, (n, _, _) in enumerate(SPEC)]
LEADS = [lead for _, lead, _ in SPEC]

def scene_start(k):
    # stacchi netti fino alla 7; l'unica sovrapposizione è la dissolvenza
    # home→cta (l'ultima scena parte FADE prima della fine di home)
    s = sum(DURS[:k])
    if k == len(DURS) - 1:
        s -= FADE
    return s

os.makedirs(BUILD, exist_ok=True)

# ── util ───────────────────────────────────────────────────────────────
def ffprobe_dur(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                          "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True)
    return float(out.stdout.strip())

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

# ── puntatore disegnato (Scena 2 del gioco) ────────────────────────────
# Stessa freccia del cursore DOM delle riprese web: bianca bordata di
# scuro, con onda di clic che si espande. Le coordinate sono in pixel del
# montaggio (1280x720); i tempi in secondi del CLIP (non della finestra).
CURSOR_POLY = [(0, 0), (0, 23), (6, 18), (10, 27), (14, 25), (10, 16), (18, 15)]

def draw_cursor(im, x, y, ripples, t):
    d = ImageDraw.Draw(im, "RGBA")
    for t0 in ripples:
        p = (t - t0) / 0.5
        if 0.0 <= p <= 1.0:
            r = 5 + 26 * ease_io(p)
            a = int(235 * (1.0 - p))
            d.ellipse([x - r, y - r, x + r, y + r],
                      outline=(255, 255, 255, a), width=3)
            d.ellipse([x - r - 1, y - r - 1, x + r + 1, y + r + 1],
                      outline=(20, 20, 20, a // 2), width=1)
    poly = [(x + px, y + py) for px, py in CURSOR_POLY]
    d.polygon(poly, fill=(255, 255, 255, 255), outline=(17, 17, 17, 255))

def cursor_state(keys, t):
    """Posizione del puntatore al tempo t: easing fra keyframe successivi.
    keys: [(t, x, y, click)] ordinati. Ritorna (x, y) o None se prima del
    primo keyframe (puntatore non ancora in scena)."""
    if t < keys[0][0]:
        return None
    for a, b in zip(keys, keys[1:]):
        if t <= b[0]:
            p = ease_io((t - a[0]) / max(1e-6, b[0] - a[0]))
            return (a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p)
    return (keys[-1][1], keys[-1][2])

# ── riprese di gioco: finestre 1:1 con crop e puntatore ────────────────
def game_shot(name, clip, segs):
    """Concatena finestre 1:1 dal clip PNG nativo. Ogni seg:
    {skip, dur, crop=(x0,y0,w,h)|None, cursor=[(t,x,y,click)]|None}.
    Il crop è una RI-INQUADRATURA spaziale (1440x810 → 720p resta sopra
    il pixel 1:1); il tempo non viene mai toccato."""
    seg_path = os.path.join(BUILD, f"{name}.mp4")
    proc = encoder(seg_path)
    for s in segs:
        n = int(round(s["dur"] * FPS))
        crop = s.get("crop")
        cur = s.get("cursor")
        ripples = [k[0] for k in (cur or []) if k[3]]
        # Il girato puo' essere piu' corto della finestra: una ripresa
        # interrotta, o una scena rifatta piu' breve. Prima si moriva con
        # FileNotFoundError sul singolo file, che dice QUALE fotogramma manca
        # ma non che il problema e' la scena intera. Qui si tiene l'ULTIMO
        # fotogramma disponibile per il tempo restante: il movimento si ferma
        # invece di interrompersi, e la voce non resta senza immagine.
        # Il fermo si vede nel log, cosi' chi taratura le finestre sa che
        # quella scena e' da rigirare o da riaccorciare.
        disponibili = len([f for f in os.listdir(os.path.join(CAP, clip))
                           if f.endswith(".png")])
        ultimo = disponibili - 1
        fermi = 0
        for i in range(n):
            fi = s["skip"] + i
            if fi > ultimo:
                fi = ultimo
                fermi += 1
            im = Image.open(os.path.join(CAP, clip, f"f{fi:08d}.png")).convert("RGB")
            if crop:
                x0, y0, cw, ch = crop
                im = im.crop((x0, y0, x0 + cw, y0 + ch))
            im = im.resize((W, H), Image.LANCZOS).convert("RGBA")
            if cur:
                t_clip = fi / FPS
                st = cursor_state(cur, t_clip)
                if st:
                    draw_cursor(im, st[0], st[1], ripples, t_clip)
            proc.stdin.write(im.convert("RGB").tobytes())
        if fermi:
            print(f"  ⚠ {clip}: {fermi} fotogrammi in fermo immagine "
                  f"(girato {disponibili}, finestra fino a {s['skip'] + n})")
    proc.stdin.close()
    if proc.wait() != 0:
        sys.exit(f"ffmpeg fallito su {name}")
    return seg_path

# ── riprese web: finestre 1:1 ──────────────────────────────────────────
def web_segment(name, src, t0, dur):
    """Finestra [t0, t0+dur] dalla ripresa web A VELOCITÀ NATURALE: il
    setpts qui RIBASA solo i timestamp dopo il trim (fattore 1)."""
    if t0 + dur > ffprobe_dur(src) - 0.05:
        sys.exit(f"{name}: finestra {t0}+{dur:.2f}s oltre la ripresa {src}")
    seg = os.path.join(BUILD, f"{name}.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", src, "-vf",
         f"trim=start={t0}:end={t0 + dur},setpts=PTS-STARTPTS,"
         f"scale={W}:{H},fps={FPS}",
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

# ── scene PIL: the-box (7a) e card finale (8) ──────────────────────────
def sc_box(dur):
    """L'illustrazione the-box, lenta spinta 1.0 → 1.08, nessun testo."""
    src = Image.open(f"{PUB}/the-box.png").convert("RGB")
    s0 = max(W / src.width, H / src.height)
    def frame(t):
        z = 1.0 + 0.08 * ease_io(t / dur)
        cw, ch = W / (s0 * z), H / (s0 * z)
        cx, cy = src.width / 2, src.height * 0.48
        px = max(0, min(src.width - cw, cx - cw / 2))
        py = max(0, min(src.height - ch, cy - ch / 2))
        fr = src.crop((int(px), int(py), int(px + cw), int(py + ch)))
        return fr.resize((W, H), Image.LANCZOS).convert("RGBA")
    return frame

F_T = font("ExtraBold", 76)

def sc_cta(dur, night_still):
    """Card di chiusura su fondo scuro: dietro, quasi nero, l'ultimo
    respiro dell'ufficio notturno (still dell'ultima finestra della Scena
    7b). URL a schermo per tutta la scena (≥ 3 s pieni)."""
    bg = Image.open(night_still).convert("RGB").resize((W, H), Image.LANCZOS)
    bg = Image.eval(bg, lambda v: int(v * 0.16))
    bg = bg.convert("RGBA")
    d0 = ImageDraw.Draw(bg)
    d0.rectangle([0, 0, W, H], fill=(4, 5, 9, 150))
    w1 = ImageDraw.Draw(bg).textlength("JOB HUNTER ", font=F_T)
    w2 = ImageDraw.Draw(bg).textlength("TEAM", font=F_T)
    tx = (W - (w1 + w2)) / 2
    items = []
    ly = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ly)
    d.text((tx, 250), "JOB HUNTER ", font=F_T, fill=WHITE)
    d.text((tx + w1, 250), "TEAM", font=F_T, fill=GREEN)
    items.append((ly, 0.0))
    ly = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ly)
    d.text((W // 2, 420), "jobhunterteam.ai", font=font("Bold", 40),
           fill=GREEN, anchor="mm")
    items.append((ly, 0.35))
    ly = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(ly)
    d.text((W // 2, 486), "Free · Open source · Beta",
           font=font("Regular", 24), fill=MUTED, anchor="mm")
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

# ── coordinate della Scena 2 (misurate sui frame del clip click-chat) ──
# Native 1920x1080 → montaggio /1.5. Tempi = secondi del clip:
#   2.0 hover (l'anello si accende) · 2.6 CLIC → si apre la chat ·
#   5.4 CLIC sul chip → il testo entra nell'input · 7.2 CLIC su SEND.
def _n(x, y):
    return (x / 1.5, y / 1.5)

CLICK_KEYS = [
    (0.65, *_n(1990, 700), False),   # entra da destra, fuori quadro
    (2.00, *_n(950, 505), False),    # hover sullo Scout (l'anello si accende)
    (2.55, *_n(950, 505), False),
    (2.60, *_n(950, 505), True),     # CLIC: si apre la pagina chat
    (3.40, *_n(1000, 600), False),
    (4.90, *_n(760, 830), False),    # scende verso i suggerimenti
    (5.30, *_n(200, 957), False),    # sul chip «Show me the best one first.»
    (5.40, *_n(200, 957), True),     # CLIC: il testo scorre nell'input
    (6.40, *_n(640, 950), False),
    (7.05, *_n(1271, 1005), False),  # su SEND
    (7.20, *_n(1271, 1005), True),   # CLIC: parte la bolla verde
    (8.30, *_n(1120, 780), False),   # si scosta e attende la risposta
    (12.5, *_n(1150, 770), False),
]

# ── montaggio ──────────────────────────────────────────────────────────
def build_video(shots):
    """shots: dict di parametri di finestra (tarati sui frame reali)."""
    segs = {}
    print("scene di gioco…")
    segs["open"] = game_shot("open", "open-day", shots["open"])
    segs["click"] = game_shot("click", "click-chat", shots["click"])
    segs["pixels"] = game_shot("pixels", "work-pixels", shots["pixels"])
    segs["tailor"] = game_shot("tailor", "tailor-88", shots["tailor"])
    print("scene web…")
    globe_parts = [web_segment(f"g{i}", *w) for i, w in enumerate(shots["globe"])]
    segs["globe"] = concat("globe", globe_parts)
    segs["swipe"] = web_segment("swipe", *shots["swipe"])
    print("scena 7 e card…")
    box_dur = shots["home_box_dur"]
    night = shots["home_night"]
    box = pipe_scene("home_box", box_dur, sc_box(box_dur))
    night_seg = game_shot("home_night", "dusk-night", [night])
    segs["home"] = concat("home", [box, night_seg])
    # still per lo sfondo della card: ultimo frame della finestra notturna
    last = night["skip"] + int(night["dur"] * FPS) - 1
    night_still = os.path.join(CAP, "dusk-night", f"f{last:08d}.png")
    segs["cta"] = pipe_scene("cta", DURS[7], sc_cta(DURS[7], night_still))

    # verifica durate: ogni segmento deve coprire la sua scena
    for k, (nm, dur) in enumerate(SCENES):
        got = ffprobe_dur(segs[nm])
        if got + 0.05 < dur:
            sys.exit(f"scena {nm}: girato {got:.2f}s < scena {dur:.2f}s")

    print("assemblaggio (stacchi netti + una dissolvenza)…")
    # tronca ogni scena alla sua durata esatta (trim senza fattori di
    # velocità), poi concat 1..7 e xfade con la card
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

# ── audio ──────────────────────────────────────────────────────────────
def vo_gain(path, target_db=-18.0):
    out = subprocess.run(
        ["ffmpeg", "-i", path, "-af", "astats=metadata=1", "-f", "null", "-"],
        capture_output=True, text=True)
    for line in out.stderr.splitlines():
        if "RMS level dB" in line:
            try:
                return 10 ** ((target_db - float(line.split(":")[1])) / 20)
            except ValueError:
                continue
    return 1.0

def vo_schedule(verbose=False):
    GAP = 0.7
    starts, prev_end = [], 0.0
    for k in range(len(SCENES)):
        s = max(scene_start(k) + LEADS[k], prev_end + GAP)
        starts.append(s)
        prev_end = s + VO[k]
    total = scene_start(len(SCENES) - 1) + DURS[-1]
    if prev_end > total - 0.1:
        sys.exit(f"la voce sborda dal video ({prev_end:.1f}s)")
    if verbose:
        print("pause fra le battute (vincolo ≤ 1,5 s):")
        for k in range(1, len(SCENES)):
            gap = starts[k] - (starts[k - 1] + VO[k - 1])
            print(f"  V{k} → V{k+1}: {gap:5.2f}s")
    return starts

def mux(video, out_path):
    vdir = os.path.join(AUD, VERSION)
    total = ffprobe_dur(video)
    starts = vo_schedule(verbose=True)
    inputs, fparts, mixin = ["-i", video], [], []
    for k in range(len(SCENES)):
        wav = os.path.join(vdir, f"seg{k:02d}.wav")
        delay_ms = int(starts[k] * 1000)
        g = vo_gain(wav)
        inputs += ["-i", wav]
        fparts.append(f"[{k+1}:a]volume={g:.3f},adelay={delay_ms}|{delay_ms}[vo{k}]")
        mixin.append(f"[vo{k}]")
    fparts.append("".join(mixin) + f"amix=inputs={len(mixin)}:normalize=0[vo]")
    fparts.append(f"[vo]apad=whole_dur={total:.2f},"
                  "alimiter=limit=0.93:level=disabled[aout]")
    subprocess.run((["ffmpeg", "-y", "-v", "error"] + inputs +
                    ["-filter_complex", ";".join(fparts),
                     "-map", "0:v", "-map", "[aout]", "-c:v", "copy",
                     "-c:a", "aac", "-b:a", "160k", "-shortest", out_path]),
                   check=True)
    print(f"→ {out_path} · {ffprobe_dur(out_path):.1f}s · "
          f"{os.path.getsize(out_path)/1e6:.1f} MB")

# ── finestre (tarate sui frame delle riprese reali) ────────────────────
# Le finestre sono nel modulo separato shots_play.py: si ritarano lì
# senza toccare la macchina del montaggio.
if __name__ == "__main__":
    import shots_play
    video = build_video(shots_play.SHOTS)
    print(f"video muto: {ffprobe_dur(video):.2f}s")
    mux(video, os.path.join(ROOT, "jht-play.mp4"))
