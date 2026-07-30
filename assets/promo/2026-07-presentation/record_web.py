#!/usr/bin/env python3
"""Riprese delle pagine web PRIVATE per il video di presentazione.

Registra con Playwright (Chromium HEADED: serve la GPU vera per il globo
WebGL — headless cade su SwiftShader e il globo scatta) le pagine dell'area
riservata in **demo mode**: env `JHT_WEB_DEMO_PERSONA` sul server → tutte le
query servono il dataset demo (web/lib/demo/data.ts, dati INVENTATI per
costruzione). Login con l'account di test e2e (auth-state.json generato da
e2e/scripts/refresh-auth-state.mjs): il banner "Demo mode — sample data"
resta a schermo, che è la dichiarazione onesta che i dati sono finti.

NESSUN dato reale: il server gira con JHT_HOME vuota (niente SQLite
dell'utente) e la persona demo in testa alle query scavalca anche i dati
dell'account di test.

Prerequisiti:
  node e2e/scripts/refresh-auth-state.mjs      # sessione test (~60 min)
  # server dev sul worktree, porta 3007:
  #   NEXT_PUBLIC_JHT_DEPLOY=cloud NEXT_PUBLIC_APP_URL=http://localhost:3007 \
  #   JHT_HOME=~/.jht-web-dev-empty JHT_WEB_DEMO_PERSONA=software \
  #   npm run dev -- -p 3007

Output: webrec/<nome>.webm (gitignored) + webrec/<nome>.first.png di controllo.
"""
import os, shutil, sys, time

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(ROOT)))
BASE = os.environ.get("JHT_WEB_BASE", "http://localhost:3007")
AUTH = os.path.join(REPO, "e2e", "auth-state.json")
OUT = os.path.join(ROOT, "webrec")

if not os.path.isfile(AUTH):
    sys.exit("manca e2e/auth-state.json — lancia node e2e/scripts/refresh-auth-state.mjs")
os.makedirs(OUT, exist_ok=True)

# CSS iniettato in ogni pagina: spegne l'overlay dev di Next (badge/toast in
# basso a sinistra) e il cursore lampeggiante degli input, che nel video
# distrae. Nessun contenuto della pagina viene alterato.
HIDE_CSS = (
    "nextjs-portal,[data-nextjs-dev-tools-button],[data-next-badge-root],"
    "[data-nextjs-toast]{display:none!important}"
)

COOKIES = [
    # Wizard /welcome già visto: senza questo, dashboard vuota → redirect.
    {"name": "jht_welcome_seen", "value": "1", "domain": "localhost", "path": "/"},
    {"name": "NEXT_LOCALE", "value": "en", "domain": "localhost", "path": "/"},
]


def new_context(browser, w, h, dsf, rec_w, rec_h):
    ctx = browser.new_context(
        storage_state=AUTH,
        viewport={"width": w, "height": h},
        device_scale_factor=dsf,
        record_video_dir=OUT,
        record_video_size={"width": rec_w, "height": rec_h},
    )
    ctx.add_cookies(COOKIES)
    # Globo: qualità alta esplicita (deterministico, niente probe).
    # Tema DARK forzato: è il look brand e in video legge molto meglio.
    ctx.add_init_script(
        "try{localStorage.setItem('jht-map-quality','high');"
        "localStorage.setItem('jht-theme','dark')}catch(e){}"
    )
    return ctx


def settle(page, extra=1.5):
    page.wait_for_load_state("networkidle")
    time.sleep(extra)


def drag(page, x0, y0, x1, y1, steps=90, hold=0.0):
    """Trascinamento lento e continuo (steps alti = movimento fluido)."""
    page.mouse.move(x0, y0)
    page.mouse.down()
    page.mouse.move(x1, y1, steps=steps)
    if hold:
        time.sleep(hold)
    page.mouse.up()


def record(browser, name, w, h, dsf, rec_w, rec_h, run):
    ctx = new_context(browser, w, h, dsf, rec_w, rec_h)
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

def run_map(page):
    page.goto(f"{BASE}/map", wait_until="domcontentloaded")
    page.wait_for_selector("canvas", timeout=60000)
    style(page)
    settle(page, 4.0)          # tile + fit iniziale sui pin
    # 1) fuori fino a vedere la SFERA (la vista parte già sull'Europa)
    page.mouse.move(640, 400)
    for _ in range(4):
        page.mouse.wheel(0, 300)
        time.sleep(0.55)
    time.sleep(1.0)
    # 2) rotazione lenta del globo: via e ritorno (l'Europa torna in quadro)
    drag(page, 500, 400, 760, 380, steps=160)
    time.sleep(0.6)
    drag(page, 760, 390, 500, 400, steps=160)
    time.sleep(0.8)
    # 3) rientro CERTO sui fasci: il bottone "Overview — show all pins"
    #    fa un flyTo animato che riquadra tutti i pin, niente zoom alla cieca
    page.get_by_label("Overview — show all pins").click()
    # il click può auto-scrollare la pagina di ~20px (bottone a filo bordo):
    # si torna subito a 0, il flyTo della mappa non ne risente
    page.evaluate("window.scrollTo(0,0)")
    time.sleep(4.0)


def run_positions(page):
    page.goto(f"{BASE}/positions", wait_until="domcontentloaded")
    settle(page, 2.5)
    style(page)
    for dy in (500, 500, 600):
        page.mouse.wheel(0, dy)
        time.sleep(1.6)
    time.sleep(1.0)


def run_dashboard(page):
    page.goto(f"{BASE}/dashboard", wait_until="domcontentloaded")
    settle(page, 3.0)
    style(page)
    page.mouse.wheel(0, 450)
    time.sleep(2.0)
    page.mouse.wheel(0, 500)
    time.sleep(2.0)


def run_swipe(page):
    page.goto(f"{BASE}/swipe", wait_until="domcontentloaded")
    settle(page, 2.5)
    style(page)
    cx, cy = 640, 400
    drag(page, cx, cy, cx + 420, cy - 60, steps=45, hold=0.15)   # like →
    time.sleep(1.6)
    drag(page, cx, cy, cx - 420, cy - 40, steps=45, hold=0.15)   # skip ←
    time.sleep(1.6)
    drag(page, cx, cy, cx + 420, cy - 60, steps=45, hold=0.15)
    time.sleep(1.8)


# ── scene mobile 9:16 (colonna del montaggio verticale) ────────────────

def run_map_mobile(page):
    page.goto(f"{BASE}/map", wait_until="domcontentloaded")
    page.wait_for_selector("canvas", timeout=60000)
    style(page)
    settle(page, 4.0)
    page.mouse.move(195, 330)
    for _ in range(4):
        page.mouse.wheel(0, 300)
        time.sleep(0.55)
    time.sleep(1.0)
    drag(page, 110, 330, 290, 320, steps=140)
    time.sleep(0.5)
    drag(page, 290, 325, 110, 330, steps=140)
    time.sleep(0.8)
    page.get_by_label("Overview — show all pins").click()
    page.evaluate("window.scrollTo(0,0)")
    time.sleep(4.0)


def run_swipe_mobile(page):
    page.goto(f"{BASE}/swipe", wait_until="domcontentloaded")
    settle(page, 2.5)
    style(page)
    cx, cy = 195, 360
    drag(page, cx, cy, cx + 200, cy - 40, steps=40, hold=0.15)
    time.sleep(1.5)
    drag(page, cx, cy, cx - 200, cy - 30, steps=40, hold=0.15)
    time.sleep(1.5)
    drag(page, cx, cy, cx + 200, cy - 40, steps=40, hold=0.15)
    time.sleep(1.6)


DESKTOP = [
    ("web_map", run_map),
    ("web_positions", run_positions),
    ("web_dashboard", run_dashboard),
    ("web_swipe", run_swipe),
]
MOBILE = [
    ("web_map_m", run_map_mobile),
    ("web_swipe_m", run_swipe_mobile),
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
        record(browser, name, 390, 693, 2, 780, 1386, fn)
    browser.close()
print("fatto.")
