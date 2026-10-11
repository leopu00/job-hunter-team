"""Subprocess lifecycle fixture: real Chromium, local HTML, actual product gates."""
import contextlib
import json
from pathlib import Path
import sys
import faulthandler

faulthandler.dump_traceback_later(8)

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "shared" / "skills"), str(ROOT / "tests")]
import apply_assisted
from test_apply_flow import ashby_form

config = Path(sys.argv[1])
options = json.loads(config.read_text())
original = apply_assisted.ApplicationFlow


def fixture_flow(**kwargs):
    flow = original(**kwargs)
    flow.headless = True  # same Chromium version, no local display needed
    flow.essentials_checker = lambda **_kw: []
    flow.cv_checker = lambda _path: {"ok": True, "reasons": []}
    flow.notifier = lambda **_kw: "local-fixture"

    def navigate(page):
        page.set_content(ashby_form(captcha=True))
        if options.get("fixture_slow_navigation"):
            page.wait_for_timeout(10000)

    flow._navigate = navigate
    flow._check_page_access = lambda *a, **k: None
    flow._assert_not_redirected_away = lambda *a, **k: None
    managed = flow._managed_page

    @contextlib.contextmanager
    def remember_browser():
        with managed() as page:
            cdp = page.context.browser.new_browser_cdp_session()
            pids = [row["id"] for row in cdp.send("SystemInfo.getProcessInfo")["processInfo"]]
            (config.parent / "browser-pids.json").write_text(json.dumps(pids))
            cdp.detach()
            yield page

    flow._managed_page = remember_browser
    return flow


apply_assisted.ApplicationFlow = fixture_flow
apply_assisted._serve(config)
