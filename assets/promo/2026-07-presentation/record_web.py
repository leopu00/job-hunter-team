#!/usr/bin/env python3
"""Riprese web per il video «Now Playable» (regia 03/08) — demo mode.

Registra con Playwright (Chromium HEADED: serve la GPU vera per il globo
WebGL — headless cade su SwiftShader e il globo scatta) le pagine dell'area
riservata in **demo mode** (env `JHT_WEB_DEMO_PERSONA=software` sul server):
dati INVENTATI per costruzione, banner "DEMO MODE — sample data" sempre in
quadro. Login con l'account di test e2e (auth-state.json).

IL PUNTATORE (regia §7.3/§9): Playwright non registra il cursore, quindi lo
DISEGNIAMO — un solo meccanismo per tutte le scene web: un cursore DOM
iniettato che SEGUE gli eventi mouse veri (mousemove/mousedown) e disegna
l'onda al click. I movimenti sono a passi con easing (mai teletrasporti),
con una pausa prima di ogni click. Nelle riprese mobili (verticale) la
freccia diventa un cerchio di tocco, stessa coreografia.

Scene (regia §5):
  web_hunt    Scena 5 — /map: mezzo giro del globo (velocità naturale),
              rientro sull'Europa, CLICK sul beacon di Amsterdam (flyTo in
              città), pannello POSITIONS, CLICK sulla riga GreenGrid.
  web_sheet   Scena 5b — la scheda GreenGrid (anello 88, badge salario e
              remote): scroll sul breakdown, fermo su "CV ready · Critic:
              PASS", CLICK su "Swipe" nella nav (stacco SUL clic).
              NB: "Download CV" NON esiste in demo (cv_pdf_path null) e in
              demo non si finge un download (§9): il clic di chiusura è la
              navigazione vera verso il mazzo.
  web_swipe   Scena 6 — /swipe filtrato sulla categoria DevOps / Cloud
              (fallback previsto dalla regia: il mazzo non è ordinabile
              sulla 88), navigato fino alla card GreenGrid 88 PRIMA della
              finestra di montaggio: stella (vola a destra) → entra la 22
              (bassa) → X (vola a sinistra). Il drag del prodotto è
              NAVIGAZIONE, non verdetto: i verdetti sono i bottoni, e la
              regia prevede la stella come alternativa al trascinamento.
  *_m         Varianti mobili 390x693@2x per il montaggio verticale.

Prerequisiti:
  node e2e/scripts/refresh-auth-state.mjs      # sessione test (~60 min)
  # server dev sul worktree, porta 3007:
  #   NEXT_PUBLIC_JHT_DEPLOY=cloud NEXT_PUBLIC_APP_URL=http://localhost:3007 \
  #   JHT_HOME=<vuota con i18n-prefs.json {"locale":"en"}> \
  #   JHT_WEB_DEMO_PERSONA=software npm run dev -- -p 3007

Output: webrec/<nome>.webm (gitignored) + webrec/<nome>.first.png di controllo.
"""
import math, os, re, shutil, sys, time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(ROOT)))
BASE = os.environ.get("JHT_WEB_BASE", "http://localhost:3007")
AUTH = os.path.join(REPO, "e2e", "auth-state.json")
OUT = os.path.join(ROOT, "webrec")
GREENGRID_ID = "demo-software-003"   # Platform Engineer, Kubernetes — 88

if not os.path.isfile(AUTH):
    sys.exit("manca e2e/auth-state.json — lancia node e2e/scripts/refresh-auth-state.mjs")
os.makedirs(OUT, exist_ok=True)

HIDE_CSS = (
    "nextjs-portal,[data-nextjs-dev-tools-button],[data-next-badge-root],"
    "[data-nextjs-toast]{display:none!important}"
)

COOKIES = [
    {"name": "jht_welcome_seen", "value": "1", "domain": "localhost", "path": "/"},
    {"name": "NEXT_LOCALE", "value": "en", "domain": "localhost", "path": "/"},
]

# ── Cursore DOM ────────────────────────────────────────────────────────
# Segue gli eventi mouse VERI: la coreografia in Python muove il mouse di
# Playwright e il cursore la rispecchia 1:1 (drag compresi). L'onda del
# click nasce su mousedown. touch=true → cerchio di tocco al posto della
# freccia (riprese mobili per il verticale).
CURSOR_JS = """
(() => {
  if (window.__jhtCur) return; window.__jhtCur = true;
  const TOUCH = %s;
  const install = () => {
    const cur = document.createElement('div');
    cur.style.cssText = 'position:fixed;left:-100px;top:-100px;z-index:2147483647;'
      + 'pointer-events:none;';
    if (TOUCH) {
      cur.style.width = '34px'; cur.style.height = '34px';
      cur.style.marginLeft = '-17px'; cur.style.marginTop = '-17px';
      cur.style.borderRadius = '50%%';
      cur.style.background = 'rgba(255,255,255,0.35)';
      cur.style.border = '2px solid rgba(255,255,255,0.9)';
      cur.style.boxShadow = '0 0 6px rgba(0,0,0,0.5)';
    } else {
      cur.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30">'
        + '<path d="M2 1 L2 24 L8 19 L12 28 L16 26 L12 17 L20 16 Z"'
        + ' fill="#ffffff" stroke="#111111" stroke-width="1.6"/></svg>';
    }
    document.body.appendChild(cur);
    addEventListener('mousemove', e => {
      cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px';
    }, true);
    addEventListener('mousedown', e => {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;left:' + e.clientX + 'px;top:' + e.clientY
        + 'px;width:10px;height:10px;border:3px solid #fff;border-radius:50%%;'
        + 'z-index:2147483646;pointer-events:none;transform:translate(-50%%,-50%%);'
        + 'box-shadow:0 0 0 1.5px rgba(0,0,0,.55);opacity:.95;'
        + 'transition:width .5s ease-out,height .5s ease-out,opacity .5s ease-out';
      document.body.appendChild(r);
      requestAnimationFrame(() => { r.style.width = '72px';
        r.style.height = '72px'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 700);
    }, true);
  };
  if (document.body) install();
  else addEventListener('DOMContentLoaded', install);
})();
"""


def new_context(browser, w, h, dsf, rec_w, rec_h, touch=False):
    ctx = browser.new_context(
        storage_state=AUTH,
        viewport={"width": w, "height": h},
        device_scale_factor=dsf,
        record_video_dir=OUT,
        record_video_size={"width": rec_w, "height": rec_h},
    )
    ctx.add_cookies(COOKIES)
    ctx.add_init_script(
        "try{localStorage.setItem('jht-map-quality','high');"
        "localStorage.setItem('jht-theme','dark')}catch(e){}"
    )
    ctx.add_init_script(CURSOR_JS % ("true" if touch else "false"))
    return ctx


def settle(page, extra=1.5):
    page.wait_for_load_state("networkidle")
    time.sleep(extra)


class Pointer:
    """Coreografia del puntatore: movimenti a PASSI con easing (mai salti),
    pausa prima del click, onda visibile (dal mousedown vero)."""

    def __init__(self, page, x=200.0, y=200.0):
        self.page = page
        self.x, self.y = x, y
        page.mouse.move(x, y)

    def glide(self, x, y, dur=0.7, steps=28):
        for i in range(1, steps + 1):
            p = i / steps
            e = 0.5 - 0.5 * math.cos(math.pi * p)   # ease in-out
            self.page.mouse.move(self.x + (x - self.x) * e,
                                 self.y + (y - self.y) * e)
            time.sleep(max(0.0, dur / steps))
        self.x, self.y = x, y

    def click(self, x=None, y=None, dur=0.7, hold=0.35):
        if x is not None:
            self.glide(x, y, dur=dur)
        time.sleep(hold)                 # respiro PRIMA del click (regia §7.3)
        self.page.mouse.down()
        time.sleep(0.12)
        self.page.mouse.up()

    def drag(self, x0, y0, x1, y1, dur=0.8, steps=32, hold=0.15):
        self.glide(x0, y0, dur=0.5)
        time.sleep(0.25)
        self.page.mouse.down()
        for i in range(1, steps + 1):
            p = i / steps
            e = 0.5 - 0.5 * math.cos(math.pi * p)
            self.page.mouse.move(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e)
            time.sleep(max(0.0, dur / steps))
        if hold:
            time.sleep(hold)
        self.page.mouse.up()
        self.x, self.y = x1, y1


def record(browser, name, w, h, dsf, rec_w, rec_h, run, touch=False):
    ctx = new_context(browser, w, h, dsf, rec_w, rec_h, touch=touch)
    page = ctx.new_page()
    try:
        run(page)
        page.screenshot(path=os.path.join(OUT, f"{name}.first.png"))
    finally:
        video = page.video
        page.close()
        path = video.path()
        ctx.close()
        dst = os.path.join(OUT, f"{name}.webm")
        shutil.move(path, dst)
        print(f"{name}: {dst} ({os.path.getsize(dst)/1e6:.1f} MB)")


def style(page):
    page.add_style_tag(content=HIDE_CSS)


# ── scene desktop 1280x720 ─────────────────────────────────────────────

def run_hunt(page):
    """Scena 5a: globo → beacon Amsterdam → pannello POSITIONS → riga 88."""
    page.goto(f"{BASE}/map", wait_until="domcontentloaded")
    page.wait_for_selector("canvas", timeout=60000)
    style(page)
    settle(page, 4.0)
    ptr = Pointer(page, 300, 300)
    # 1) fuori fino alla SFERA: pin su più continenti
    ptr.glide(640, 400, dur=0.8)
    for _ in range(4):
        page.mouse.wheel(0, 300)
        time.sleep(0.55)
    time.sleep(0.8)
    # 2) MEZZO GIRO lento del globo, velocità naturale, e ritorno all'Europa
    ptr.drag(760, 400, 420, 390, dur=2.4, steps=110)
    time.sleep(0.5)
    ptr.drag(420, 395, 770, 400, dur=2.4, steps=110)
    time.sleep(0.6)
    # 3) rientro certo sui fasci europei — anche questo è un click del
    #    puntatore: mai teletrasporti in quadro
    ov = page.get_by_label("Overview — show all pins")
    bb = ov.bounding_box()
    ptr.click(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2, dur=0.8)
    page.evaluate("window.scrollTo(0,0)")
    time.sleep(3.5)
    # 4) CLICK sul beacon dei Paesi Bassi (Amsterdam · 5) → flyTo in città
    ptr.click(650, 418, dur=0.9)
    time.sleep(3.0)
    # 5) pannello POSITIONS → CLICK sulla riga GreenGrid (88)
    panel = page.get_by_text("POSITIONS", exact=False).last
    bb = panel.bounding_box()
    ptr.click(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2, dur=0.8)
    time.sleep(1.2)
    row = page.get_by_text("Platform Engineer, Kubernetes", exact=False).first
    bb = row.bounding_box()
    ptr.click(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2, dur=0.9)
    time.sleep(1.2)   # la scheda si apre in nuova tab: qui si STACCA


def run_sheet(page):
    """Scena 5b: la scheda GreenGrid — 88, badge, breakdown, PASS, via."""
    page.goto(f"{BASE}/positions/{GREENGRID_ID}", wait_until="domcontentloaded")
    settle(page, 2.5)
    style(page)
    ptr = Pointer(page, 980, 250)
    time.sleep(1.6)                      # anello 88 + salario + Full remote
    ptr.glide(640, 420, dur=0.7)
    page.mouse.wheel(0, 620)             # SCORE BREAKDOWN
    time.sleep(1.8)
    page.mouse.wheel(0, 620)             # APPLICATION: CV ready · Critic: PASS
    time.sleep(0.9)
    pass_el = page.get_by_text("Critic: PASS", exact=False).first
    bb = pass_el.bounding_box()
    if bb:
        ptr.glide(bb["x"] + bb["width"] + 30, bb["y"] + bb["height"] / 2, dur=0.8)
    time.sleep(1.5)                      # fermo sul verdetto
    # chiusura SUL clic: navigazione vera verso il mazzo (il Download CV
    # non esiste in demo e non si finge — vedi docstring)
    nav = page.get_by_role("link", name="Swipe").first
    bb = nav.bounding_box()
    ptr.click(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2, dur=0.9)
    time.sleep(1.5)


def _swipe_prepare(page, ptr, star_xy, x_xy):
    """Porta la GreenGrid 88 in primo piano PRIMA della finestra di
    montaggio: categoria DevOps / Cloud (fallback della regia) + ordina
    «Newest first» — il mazzo «to review» diventa [88 GreenGrid, 58, 63,
    92] e la coreografia in quadro è esattamente quella della scaletta:
    stella sulla 88 → entra la 58 (bassa) → X → entra la terza."""
    def _raw_click(pattern):
        """Click grezzo via bounding box: i chip in fondo al pannello
        restano mezzi tagliati dal bordo e l'actionability di Playwright
        gira a vuoto — scroll esplicito + mouse.click alle coordinate."""
        el = page.get_by_role("button", name=pattern).first
        el.scroll_into_view_if_needed()
        time.sleep(0.3)
        bb = el.bounding_box()
        page.mouse.click(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2)

    page.get_by_role("button", name="Filters").click()
    time.sleep(0.9)
    # le sezioni del pannello sono CHIUSE di default: si apre l'header
    # (bottone «Sorting …» / «Category»; il maiuscolo è solo CSS), poi si
    # sceglie il chip
    _raw_click(re.compile("^sorting", re.I))
    time.sleep(0.6)
    _raw_click(re.compile("^newest first", re.I))
    time.sleep(0.6)
    _raw_click(re.compile("^category", re.I))
    time.sleep(0.7)
    # NB: niente "/" letterale nel pattern — il role-selector di Playwright
    # serializza il regex fra barre e una barra interna spezza il parsing
    # (visto dal vivo: il take moriva sul chip categoria).
    _raw_click(re.compile(r"DevOps . Cloud"))
    time.sleep(0.7)
    _raw_click(re.compile("^done", re.I))
    time.sleep(1.6)
    # Guardia di regia: la prima card DEVE essere la GreenGrid 88 («Newest
    # first» sul mazzo DevOps: h=20 è la più giovane). Se non lo è, il take
    # è da buttare: meglio saperlo dal log che dai frame.
    try:
        first = page.get_by_text("Platform Engineer, Kubernetes",
                                 exact=False).first
        print("[swipe] prima card GreenGrid:", first.is_visible())
    except Exception as e:
        print("[swipe] ATTENZIONE: prima card non verificabile:", e)
    # ── da qui la finestra di montaggio: la 88 è già in primo piano ──
    # Il beat di presentazione + le pause lunghe portano la parte in quadro
    # a ~10,5 s: la scena ne usa 8,35 e il trim sceglie dove tagliare.
    card_x = (star_xy[0] + x_xy[0]) / 2
    card_y = max(200, star_xy[1] - 270)
    ptr.glide(card_x, card_y, dur=1.1)   # presentazione: la 88 in primo piano
    time.sleep(0.8)
    ptr.click(*star_xy, dur=0.9)         # stella: la 88 vola a destra
    time.sleep(1.9)                      # entra la 58, la si guarda
    ptr.click(*x_xy, dur=0.8)            # X sulla 58: vola a sinistra
    time.sleep(2.6)                      # la terza card è entrata e respira


def run_swipe(page):
    page.goto(f"{BASE}/swipe", wait_until="domcontentloaded")
    settle(page, 2.5)
    style(page)
    ptr = Pointer(page, 980, 500)
    # bottoni: X a (471,705), stella a (719,705) — misurati sulla sonda
    star = page.get_by_role("button", name="Very interesting").first
    bs = star.bounding_box()
    xbtn = page.get_by_role("button", name="Not interesting").first
    bx = xbtn.bounding_box()
    _swipe_prepare(page, ptr,
                   (bs["x"] + bs["width"] / 2, bs["y"] + bs["height"] / 2),
                   (bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2))


# ── scene mobile 9:16 (colonna del montaggio verticale) ────────────────

def run_hunt_m(page):
    page.goto(f"{BASE}/map", wait_until="domcontentloaded")
    page.wait_for_selector("canvas", timeout=60000)
    style(page)
    settle(page, 4.0)
    ptr = Pointer(page, 120, 260)
    ptr.glide(195, 330, dur=0.6)
    for _ in range(4):
        page.mouse.wheel(0, 300)
        time.sleep(0.55)
    time.sleep(0.8)
    ptr.drag(280, 330, 110, 325, dur=2.0, steps=90)
    time.sleep(0.5)
    ptr.drag(110, 328, 285, 330, dur=2.0, steps=90)
    time.sleep(0.6)
    ov = page.get_by_label("Overview — show all pins")
    bb = ov.bounding_box()
    ptr.click(bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2, dur=0.7)
    page.evaluate("window.scrollTo(0,0)")
    time.sleep(3.5)
    # beacon Paesi Bassi sul viewport mobile: poco sopra il centro
    bb = page.locator("canvas").first.bounding_box()
    ptr.click(bb["x"] + bb["width"] * 0.50, bb["y"] + bb["height"] * 0.42,
              dur=0.8)
    time.sleep(3.0)


def run_sheet_m(page):
    page.goto(f"{BASE}/positions/{GREENGRID_ID}", wait_until="domcontentloaded")
    settle(page, 2.5)
    style(page)
    ptr = Pointer(page, 330, 200)
    time.sleep(1.6)
    ptr.glide(195, 360, dur=0.6)
    page.mouse.wheel(0, 700)
    time.sleep(1.6)
    page.mouse.wheel(0, 700)
    time.sleep(1.2)
    try:
        pass_el = page.get_by_text("Critic: PASS", exact=False).first
        bb = pass_el.bounding_box()
        if bb:
            page.mouse.wheel(0, max(0, bb["y"] - 400))
            time.sleep(1.4)
    except Exception:
        pass
    time.sleep(1.2)


def run_swipe_m(page):
    page.goto(f"{BASE}/swipe", wait_until="domcontentloaded")
    settle(page, 2.5)
    style(page)
    ptr = Pointer(page, 330, 420)
    star = page.get_by_role("button", name="Very interesting").first
    bs = star.bounding_box()
    xbtn = page.get_by_role("button", name="Not interesting").first
    bx = xbtn.bounding_box()
    _swipe_prepare(page, ptr,
                   (bs["x"] + bs["width"] / 2, bs["y"] + bs["height"] / 2),
                   (bx["x"] + bx["width"] / 2, bx["y"] + bx["height"] / 2))


DESKTOP = [
    ("web_hunt", run_hunt),
    ("web_sheet", run_sheet),
    ("web_swipe", run_swipe),
]
MOBILE = [
    ("web_hunt_m", run_hunt_m),
    ("web_sheet_m", run_sheet_m),
    ("web_swipe_m", run_swipe_m),
]

only = set(sys.argv[1:])
with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    for name, fn in DESKTOP:
        if only and name not in only:
            continue
        record(browser, name, 1280, 720, 1, 1280, 720, fn)
    for name, fn in MOBILE:
        if only and name not in only:
            continue
        record(browser, name, 390, 693, 2, 780, 1386, fn, touch=True)
    browser.close()
print("fatto.")
