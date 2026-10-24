"""nessuno skill scrive sotto la propria cartella (`/app` e' di root nell'immagine).

`linkedin_check.py` metteva il profilo del browser in `<skills>/../secrets/linkedin-profile`, cioe'
`/app/shared/secrets/...`: gli agenti girano come utente non root, `launch_persistent_context` dava EACCES
e il Capitano saltava LinkedIn a tutta la squadra. Qui:

- una guardia statica: nessuno script in `shared/skills` e `agents/_skills` scrive su un percorso derivato da
  `__file__` o da una costante `/app/...` (e la guardia stessa e' provata su codice di esempio, compreso il
  vecchio `linkedin_check`: una guardia che non vede il difetto non protegge);
- `linkedin_check.py` eseguito come utente non root con la cartella degli script IN SOLA LETTURA: il profilo
  nasce sotto `$JHT_HOME` (0700) e sotto gli script non compare niente;
- cartella dei dati non scrivibile: uscita 4 con la sigla `LINKEDIN_PROFILE_NOT_WRITABLE` e `tool_health` la
  legge come BROKEN (prima il canary `--batch` vuoto diceva OK e nessuno vedeva il guasto).

Sintetico: un finto `playwright` che scrive un file nel profilo, niente rete, niente browser.
"""

from __future__ import annotations

import ast
import importlib.util
import os
import shutil
import stat
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"

POSIX_PERMS = os.name != "nt"
NOT_ROOT = POSIX_PERMS and os.geteuid() != 0


# ── la guardia statica ──────────────────────────────────────────────────────

WRITE_FUNCS = {
    "os.makedirs", "os.mkdir", "os.replace", "os.rename", "os.remove", "os.unlink", "os.chmod",
    "os.symlink", "shutil.copy", "shutil.copy2", "shutil.copyfile", "shutil.copytree", "shutil.move",
    "shutil.rmtree", "sqlite3.connect",
}
# `replace`/`rename` fuori: sulle stringhe e sulle date `.replace()` e' ovunque e non scrive niente.
PATH_WRITE_METHODS = {"mkdir", "write_text", "write_bytes", "touch", "unlink", "chmod", "rmdir"}
APP_NAMES = {"__file__", "APP", "APP_DIR"}


def _dotted(node):
    if isinstance(node, ast.Attribute):
        base = _dotted(node.value)
        return f"{base}.{node.attr}" if base else None
    if isinstance(node, ast.Name):
        return node.id
    return None


def _is_app_path(expr, tainted):
    for n in ast.walk(expr):
        if isinstance(n, ast.Name) and (n.id in APP_NAMES or n.id in tainted):
            return True
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and n.value.startswith("/app/"):
            return True
    return False


def _write_mode(mode):
    return bool(mode) and any(c in str(mode) for c in "wax+")


def writes_under_app(source: str):
    """(riga, cosa) per ogni scrittura su un percorso che nasce da `__file__` o da `/app/...`."""
    tree = ast.parse(source)
    tainted: set[str] = set()
    changed = True
    while changed:  # i nomi assegnati da un'espressione "sporca" lo diventano a loro volta
        changed = False
        for n in ast.walk(tree):
            if isinstance(n, ast.Assign):
                targets, value = n.targets, n.value
            elif isinstance(n, ast.AnnAssign) and n.value is not None:
                targets, value = [n.target], n.value
            else:
                continue
            if _is_app_path(value, tainted):
                for t in targets:
                    for x in ast.walk(t):
                        if isinstance(x, ast.Name) and x.id not in tainted:
                            tainted.add(x.id)
                            changed = True
    found = set()
    for n in ast.walk(tree):
        if not isinstance(n, ast.Call):
            continue
        name = _dotted(n.func)
        if name == "open" and n.args and _is_app_path(n.args[0], tainted):
            mode = n.args[1].value if len(n.args) > 1 and isinstance(n.args[1], ast.Constant) else None
            for kw in n.keywords:
                if kw.arg == "mode" and isinstance(kw.value, ast.Constant):
                    mode = kw.value.value
            if _write_mode(mode):
                found.add((n.lineno, f"open(..., {mode!r})"))
        elif name in WRITE_FUNCS and any(_is_app_path(a, tainted) for a in n.args):
            found.add((n.lineno, name))
        elif isinstance(n.func, ast.Attribute):
            attr = n.func.attr
            if attr in PATH_WRITE_METHODS and _is_app_path(n.func.value, tainted):
                found.add((n.lineno, f".{attr}()"))
            elif attr == "open" and _is_app_path(n.func.value, tainted):
                mode = n.args[0].value if n.args and isinstance(n.args[0], ast.Constant) else None
                if _write_mode(mode):
                    found.add((n.lineno, f"Path.open({mode!r})"))
            elif attr == "launch_persistent_context" and n.args and _is_app_path(n.args[0], tainted):
                found.add((n.lineno, "launch_persistent_context"))
    return sorted(found)


def test_the_guard_sees_the_old_linkedin_check_defect():
    """Controprova della guardia: il vecchio codice di `linkedin_check` deve essere segnalato."""
    old = textwrap.dedent(
        """
        import os
        PROFILE_PATH = os.environ.get(
            "LINKEDIN_PROFILE_PATH",
            os.path.join(os.path.dirname(__file__), '..', 'secrets', 'linkedin-profile')
        )
        def check_job(p):
            context = p.chromium.launch_persistent_context(PROFILE_PATH, headless=True)
        """
    )
    assert [what for _, what in writes_under_app(old)] == ["launch_persistent_context"]


@pytest.mark.parametrize(
    "snippet, expected",
    [
        ("import os\nD = os.path.join(os.path.dirname(__file__), 'x')\nopen(D, 'w')", ["open(..., 'w')"]),
        ("from pathlib import Path\nH = Path(__file__).resolve().parent\n(H / 'a').write_text('x')", [".write_text()"]),
        ("import os\nos.makedirs('/app/shared/secrets/x')", ["os.makedirs"]),
        ("import shutil\nAPP = '/app'\nshutil.copy('a', APP + '/b')", ["shutil.copy"]),
        # letture e percorsi sotto $JHT_HOME: nessun rilievo
        ("import os\nD = os.path.join(os.path.dirname(__file__), 'x')\nopen(D)\nopen(D, 'r')", []),
        ("import os\nh = os.environ['JHT_HOME']\nopen(os.path.join(h, 'a'), 'w')\nos.makedirs(h + '/s')", []),
        ("when = '2026'.replace('Z', '+00:00')\nS = '/app/x'.replace('x', 'y')", []),
    ],
)
def test_the_guard_flags_writes_and_only_writes(snippet, expected):
    assert [what for _, what in writes_under_app(snippet)] == expected


def _python_files():
    for base in (SKILLS, ROOT / "agents" / "_skills"):
        for path in sorted(base.rglob("*.py")):
            if "node_modules" in path.parts or "__pycache__" in path.parts:
                continue
            yield path


def test_no_skill_writes_under_its_own_directory_or_app():
    offenders = []
    scanned = 0
    for path in _python_files():
        scanned += 1
        for line, what in writes_under_app(path.read_text(encoding="utf-8")):
            offenders.append(f"{path.relative_to(ROOT)}:{line}: {what}")
    assert scanned > 50, "the guard scanned almost nothing: wrong root?"
    assert not offenders, (
        "skills write under __file__ or /app (read-only in the image for the non-root agents; "
        "use $JHT_HOME):\n  " + "\n  ".join(offenders)
    )


# ── linkedin_check eseguito davvero, con gli script in sola lettura ─────────

FAKE_PLAYWRIGHT = '''
import contextlib, os, pathlib

class _Page:
    def goto(self, url, **kw): pass
    def screenshot(self, path=None, **kw): pathlib.Path(path).write_bytes(b"png")
    def text_content(self, sel): return "an open position"

class _Context:
    pages = []
    def new_page(self): return _Page()
    def close(self): pass

class _Chromium:
    def launch_persistent_context(self, user_data_dir, **kw):
        pathlib.Path(os.environ["FAKE_PW_LOG"]).write_text(str(user_data_dir))
        (pathlib.Path(user_data_dir) / "Cookies").write_bytes(b"x")  # come farebbe Chromium
        return _Context()

class _P:
    chromium = _Chromium()

@contextlib.contextmanager
def sync_playwright():
    yield _P()
'''


def _tree(root: Path):
    return sorted((str(p.relative_to(root)), p.stat().st_mtime_ns) for p in root.rglob("*"))


def _lock_read_only(root: Path):
    for p in sorted(root.rglob("*"), reverse=True):
        p.chmod(0o555 if p.is_dir() else 0o444)
    root.chmod(0o555)


def _unlock(root: Path):
    root.chmod(0o755)
    for p in root.rglob("*"):
        p.chmod(0o755 if p.is_dir() else 0o644)


@pytest.fixture
def read_only_app(tmp_path):
    """Una copia degli script come nell'immagine: di sola lettura, e un `playwright` finto accanto."""
    app = tmp_path / "app"
    shutil.copytree(
        SKILLS, app / "shared" / "skills",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "node_modules"),
    )
    fake = tmp_path / "fake_pw" / "playwright"
    fake.mkdir(parents=True)
    (fake / "__init__.py").write_text("")
    (fake / "sync_api.py").write_text(FAKE_PLAYWRIGHT)
    if POSIX_PERMS:
        _lock_read_only(app)
    try:
        yield app
    finally:
        if POSIX_PERMS:
            _unlock(app)


def _env(tmp_path: Path, home: Path, **extra):
    env = dict(os.environ)
    for name in ("JHT_DB", "LINKEDIN_PROFILE_PATH", "JHT_APP_DIR"):
        env.pop(name, None)
    env.update(
        JHT_HOME=str(home),
        PYTHONPATH=str(tmp_path / "fake_pw"),
        PYTHONDONTWRITEBYTECODE="1",
        FAKE_PW_LOG=str(tmp_path / "pw.log"),
    )
    env.update(extra)
    return env


def _run_check(app: Path, env, *argv):
    return subprocess.run(
        [sys.executable, str(app / "shared" / "skills" / "linkedin_check.py"), *argv],
        env=env, capture_output=True, text=True, timeout=60, cwd=str(app.parent),
    )


@pytest.mark.skipif(not NOT_ROOT, reason="needs POSIX permissions and a non-root user")
def test_linkedin_check_runs_with_read_only_app_and_keeps_the_profile_under_jht_home(read_only_app, tmp_path):
    home = tmp_path / "jht_home"
    home.mkdir()
    before = _tree(read_only_app)
    out_png = tmp_path / "out.png"

    r = _run_check(read_only_app, _env(tmp_path, home), "https://www.linkedin.com/jobs/view/1", str(out_png))

    assert r.returncode == 0, r.stderr
    assert "Status: ACTIVE" in r.stdout
    profile = Path((tmp_path / "pw.log").read_text())
    assert profile == home / "secrets" / "linkedin-profile"
    assert (profile / "Cookies").exists()
    assert stat.S_IMODE(profile.stat().st_mode) == 0o700
    assert stat.S_IMODE(profile.parent.stat().st_mode) == 0o700
    assert _tree(read_only_app) == before, "something was written under the scripts directory"


@pytest.mark.skipif(not NOT_ROOT, reason="needs POSIX permissions and a non-root user")
def test_an_explicit_profile_path_still_wins(read_only_app, tmp_path):
    home = tmp_path / "jht_home"
    home.mkdir()
    mine = tmp_path / "mine" / "profile"

    r = _run_check(
        read_only_app, _env(tmp_path, home, LINKEDIN_PROFILE_PATH=str(mine)),
        "https://www.linkedin.com/jobs/view/1", str(tmp_path / "o.png"),
    )

    assert r.returncode == 0, r.stderr
    assert Path((tmp_path / "pw.log").read_text()) == mine
    assert not (home / "secrets").exists()


@pytest.mark.skipif(not NOT_ROOT, reason="needs POSIX permissions and a non-root user")
@pytest.mark.parametrize("argv", [("--batch",), ("https://www.linkedin.com/jobs/view/1",)])
def test_an_unwritable_data_directory_is_one_clear_error_with_its_own_exit_code(read_only_app, tmp_path, argv):
    home = tmp_path / "jht_home"
    home.mkdir()
    home.chmod(0o555)  # niente `secrets/` possibile
    try:
        r = _run_check(read_only_app, _env(tmp_path, home), *argv)
    finally:
        home.chmod(0o755)

    assert r.returncode == 4
    assert "LINKEDIN_PROFILE_NOT_WRITABLE" in r.stderr
    assert not (tmp_path / "pw.log").exists(), "the browser must not start without a profile directory"


def _load_tool_health():
    spec = importlib.util.spec_from_file_location("tool_health_t131", SKILLS / "tool_health.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.mark.skipif(not NOT_ROOT, reason="needs POSIX permissions and a non-root user")
def test_tool_health_canary_is_ok_when_writable_and_broken_when_not(read_only_app, tmp_path, monkeypatch):
    th = _load_tool_health()
    monkeypatch.setattr(th, "APP", str(read_only_app))
    home = tmp_path / "jht_home"
    home.mkdir()
    for k, v in _env(tmp_path, home).items():
        monkeypatch.setenv(k, v)

    status, evidence = th.check_linkedin_check()
    assert status == "OK", evidence
    assert (home / "secrets" / "linkedin-profile").is_dir()

    broken = tmp_path / "jht_ro"
    broken.mkdir()
    broken.chmod(0o555)
    monkeypatch.setenv("JHT_HOME", str(broken))
    try:
        status, evidence = th.check_linkedin_check()
    finally:
        broken.chmod(0o755)
    assert status == "BROKEN", evidence
    assert "not writable" in evidence


# ── db_to_drive: il token si riscrive a ogni refresh ────────────────────────

def test_db_to_drive_keeps_credentials_and_token_under_jht_home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path / "home"))
    monkeypatch.setenv("JHT_DB", str(tmp_path / "jobs.db"))
    sys.path.insert(0, str(SKILLS))
    try:
        spec = importlib.util.spec_from_file_location("db_to_drive_t131", SKILLS / "db_to_drive.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    finally:
        sys.path.remove(str(SKILLS))

    home = tmp_path / "home"
    assert Path(mod.OAUTH_TOKEN_PATH) == home / "secrets" / "google-oauth-token.json"
    assert Path(mod.OAUTH_CLIENT_PATH) == home / "secrets" / "google-oauth-client.json"

    class Creds:
        @staticmethod
        def to_json():
            return '{"token": "synthetic"}'

    mod._write_token(Creds())
    token = Path(mod.OAUTH_TOKEN_PATH)
    assert token.read_text() == '{"token": "synthetic"}'
    if POSIX_PERMS:
        assert stat.S_IMODE(token.stat().st_mode) == 0o600
        assert stat.S_IMODE(token.parent.stat().st_mode) == 0o700
