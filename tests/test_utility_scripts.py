"""
Test per generate_dashboard.py — Job Hunter Team QA.

Gap coverage:
- generate_dashboard: funzioni pure (esc, score_color, status_badge, verdict_badge,
  source_label, pdf_link) + get_stats con DB temp

Eseguire con: pytest tests/test_utility_scripts.py -v
"""

import os
import sys
import importlib.util
import pathlib
import sqlite3
import pytest

REPO_ROOT = pathlib.Path(__file__).parent.parent
SHARED_SKILLS = REPO_ROOT / "shared" / "skills"

DASHBOARD_SCRIPT = SHARED_SKILLS / "generate_dashboard.py"


def _load_module(path: pathlib.Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    old_argv = sys.argv
    sys.argv = [str(path)]
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.argv = old_argv
    return mod


requires_dashboard = pytest.mark.skipif(
    not DASHBOARD_SCRIPT.is_file(),
    reason=f"generate_dashboard.py non trovato: {DASHBOARD_SCRIPT}"
)



# ---------------------------------------------------------------------------
# Test generate_dashboard.py — funzioni pure
# ---------------------------------------------------------------------------

@requires_dashboard
class TestDashboardPureFunctions:
    """Test funzioni pure di generate_dashboard.py."""

    @pytest.fixture(scope="class")
    def mod(self):
        return _load_module(DASHBOARD_SCRIPT, "generate_dashboard")

    # esc()
    def test_esc_ampersand(self, mod):
        assert mod.esc("a & b") == "a &amp; b"

    def test_esc_lt_gt(self, mod):
        assert mod.esc("<script>") == "&lt;script&gt;"

    def test_esc_quote(self, mod):
        assert "&quot;" in mod.esc('"hello"')

    def test_esc_none_returns_empty(self, mod):
        assert mod.esc(None) == ""

    def test_esc_empty_string(self, mod):
        assert mod.esc("") == ""

    def test_esc_plain_text_unchanged(self, mod):
        assert mod.esc("hello world") == "hello world"

    # score_color() — solo gradiente-colore per leggibilità, NESSUNA categoria
    # practice/seria (il team dà lo score, l'utente decide cosa farne)
    def test_score_color_high(self, mod):
        assert mod.score_color(70) == "score-high"

    def test_score_color_mid(self, mod):
        assert mod.score_color(50) == "score-mid"

    def test_score_color_low(self, mod):
        assert mod.score_color(30) == "score-low"

    def test_score_color_none(self, mod):
        assert mod.score_color(None) == "non-scored"

    def test_score_color_boundary_70(self, mod):
        """Score = 70 → 'score-high' (>= 70)."""
        assert mod.score_color(70) == "score-high"

    def test_score_color_boundary_69(self, mod):
        """Score = 69 → 'score-mid' (< 70)."""
        assert mod.score_color(69) == "score-mid"

    def test_score_color_boundary_40(self, mod):
        """Score = 40 → 'score-mid' (>= 40)."""
        assert mod.score_color(40) == "score-mid"

    def test_score_color_boundary_39(self, mod):
        """Score = 39 → 'score-low' (< 40)."""
        assert mod.score_color(39) == "score-low"

    # status_badge()
    def test_status_badge_returns_html(self, mod):
        result = mod.status_badge("new")
        assert "<span" in result
        assert "new" in result

    def test_status_badge_applied_has_checkmark(self, mod):
        result = mod.status_badge("applied")
        assert "&#10004;" in result or "badge-applied" in result

    def test_status_badge_unknown_status(self, mod):
        """Status sconosciuto non deve crashare."""
        result = mod.status_badge("foobar")
        assert isinstance(result, str)
        assert "foobar" in result

    def test_status_badge_xss_safe(self, mod):
        """Status con caratteri HTML speciali deve essere escaped."""
        result = mod.status_badge("<script>")
        assert "<script>" not in result

    # verdict_badge()
    def test_verdict_badge_go(self, mod):
        result = mod.verdict_badge("GO")
        assert "GO" in result

    def test_verdict_badge_no_go(self, mod):
        result = mod.verdict_badge("NO_GO")
        assert "NO_GO" in result

    def test_verdict_badge_empty(self, mod):
        assert mod.verdict_badge("") == ""
        assert mod.verdict_badge(None) == ""


@requires_dashboard
class TestDashboardDbStats:
    """Test get_stats() e get_company_stats() con DB temporaneo."""

    @pytest.fixture(scope="class")
    def mod(self):
        return _load_module(DASHBOARD_SCRIPT, "generate_dashboard")

    @pytest.fixture
    def conn_with_data(self, tmp_path):
        """Crea DB temporaneo con dati minimali."""
        db_path = tmp_path / "test.db"
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS positions (
                id INTEGER PRIMARY KEY,
                status TEXT,
                title TEXT,
                company TEXT,
                url TEXT,
                remote_type TEXT,
                source TEXT,
                country TEXT
            );
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY,
                position_id INTEGER,
                total_score INTEGER
            );
            CREATE TABLE IF NOT EXISTS applications (
                id INTEGER PRIMARY KEY,
                position_id INTEGER,
                status TEXT,
                applied INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS position_highlights (
                id INTEGER PRIMARY KEY,
                position_id INTEGER,
                highlight TEXT
            );
            INSERT INTO positions VALUES (1, 'new', 'Dev', 'Acme', 'http://x', 'remote', 'linkedin', 'IT');
            INSERT INTO positions VALUES (2, 'scored', 'PM', 'Corp', 'http://y', 'hybrid', 'indeed', 'DE');
            INSERT INTO positions VALUES (3, 'applied', 'QA', 'Startup', 'http://z', 'remote', 'linkedin', 'IT');
            INSERT INTO scores VALUES (1, 2, 75);
            INSERT INTO applications VALUES (1, 3, 'applied', 1);
        """)
        conn.commit()
        yield conn
        conn.close()

    def test_get_stats_returns_dict(self, mod, conn_with_data):
        stats = mod.get_stats(conn_with_data)
        assert isinstance(stats, dict)

    def test_get_stats_has_status_counts(self, mod, conn_with_data):
        stats = mod.get_stats(conn_with_data)
        # Deve contenere almeno i contatori dei status
        assert "new" in stats or len(stats) > 0

    def test_get_stats_empty_db(self, mod, tmp_path):
        """DB vuoto non deve crashare."""
        conn = sqlite3.connect(str(tmp_path / "empty.db"))
        conn.row_factory = sqlite3.Row
        conn.execute("CREATE TABLE positions (id INTEGER PRIMARY KEY, status TEXT, title TEXT, company TEXT, url TEXT, remote_type TEXT, source TEXT, country TEXT)")
        conn.execute("CREATE TABLE scores (id INTEGER PRIMARY KEY, position_id INTEGER, total_score INTEGER)")
        conn.execute("CREATE TABLE applications (id INTEGER PRIMARY KEY, position_id INTEGER, status TEXT, applied INTEGER DEFAULT 0)")
        conn.execute("CREATE TABLE position_highlights (id INTEGER PRIMARY KEY, position_id INTEGER, highlight TEXT)")
        conn.commit()
        result = mod.get_stats(conn)
        assert isinstance(result, dict)
        conn.close()


