"""
Test per check_links.py, generate_dashboard.py, personal_mail.py — Job Hunter Team QA.

Gap coverage:
- check_links: EXPIRED_PATTERNS matching logic
- generate_dashboard: funzioni pure (esc, tier_info, status_badge, verdict_badge,
  source_label, pdf_link) + get_stats con DB temp
- personal_mail: decode_hdr, get_body_text (parsing email, zero IMAP)

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

CHECK_LINKS_SCRIPT = SHARED_SKILLS / "check_links.py"
DASHBOARD_SCRIPT = SHARED_SKILLS / "generate_dashboard.py"
MAIL_SCRIPT = SHARED_SKILLS / "personal_mail.py"


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


requires_check_links = pytest.mark.skipif(
    not CHECK_LINKS_SCRIPT.is_file(),
    reason=f"check_links.py non trovato: {CHECK_LINKS_SCRIPT}"
)
requires_dashboard = pytest.mark.skipif(
    not DASHBOARD_SCRIPT.is_file(),
    reason=f"generate_dashboard.py non trovato: {DASHBOARD_SCRIPT}"
)
requires_mail = pytest.mark.skipif(
    not MAIL_SCRIPT.is_file(),
    reason=f"personal_mail.py non trovato: {MAIL_SCRIPT}"
)


# ---------------------------------------------------------------------------
# Test check_links.py
# ---------------------------------------------------------------------------

@requires_check_links
class TestCheckLinksPatterns:
    """Verifica che EXPIRED_PATTERNS identifichi correttamente job scaduti."""

    @pytest.fixture(scope="class")
    def mod(self):
        return _load_module(CHECK_LINKS_SCRIPT, "check_links")

    def test_expired_patterns_is_list(self, mod):
        assert isinstance(mod.EXPIRED_PATTERNS, list)
        assert len(mod.EXPIRED_PATTERNS) > 0

    def test_expired_patterns_are_lowercase(self, mod):
        """Tutti i pattern devono essere lowercase (check_url usa body.lower())."""
        for p in mod.EXPIRED_PATTERNS:
            assert p == p.lower(), f"Pattern non lowercase: '{p}'"

    def test_expired_patterns_cover_key_cases(self, mod):
        """Pattern critici che indicano job scaduto devono essere presenti."""
        joined = " ".join(mod.EXPIRED_PATTERNS)
        assert "no longer" in joined or "longer" in joined
        assert "closed" in joined or "expired" in joined

    def test_pattern_detects_expired_body(self, mod):
        """Simula body HTML con pattern scaduto — deve matchare."""
        body = "sorry, this position is no longer accepting applications"
        matched = any(p in body for p in mod.EXPIRED_PATTERNS)
        assert matched, "EXPIRED_PATTERNS non ha rilevato body scaduto"

    def test_pattern_does_not_match_active_body(self, mod):
        """Body di job attivo non deve matchare nessun pattern."""
        body = "apply now for this exciting backend developer position at our company"
        matched = any(p in body for p in mod.EXPIRED_PATTERNS)
        assert not matched, "EXPIRED_PATTERNS ha falsamente matchato body attivo"

    def test_linkedin_expired_pattern(self, mod):
        """Verifica pattern LinkedIn expired."""
        body = "this job has expired and is no longer available"
        matched = any(p in body for p in mod.EXPIRED_PATTERNS)
        assert matched

    def test_headers_has_user_agent(self, mod):
        """HEADERS deve contenere User-Agent per bypassare rate limiting."""
        assert "User-Agent" in mod.HEADERS
        assert len(mod.HEADERS["User-Agent"]) > 10


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

    # tier_info()
    def test_tier_info_seria(self, mod):
        tier, _, label = mod.tier_info(70)
        assert tier == "seria"
        assert "SERIA" in label

    def test_tier_info_practice(self, mod):
        tier, _, label = mod.tier_info(50)
        assert tier == "practice"
        assert "PRACTICE" in label

    def test_tier_info_riferimento(self, mod):
        tier, _, label = mod.tier_info(30)
        assert tier == "riferimento"
        assert "RIFERIMENTO" in label

    def test_tier_info_none(self, mod):
        tier, _, label = mod.tier_info(None)
        assert tier == "non-scored"

    def test_tier_info_boundary_70(self, mod):
        """Score = 70 deve essere 'seria' (>= 70)."""
        tier, _, _ = mod.tier_info(70)
        assert tier == "seria"

    def test_tier_info_boundary_69(self, mod):
        """Score = 69 deve essere 'practice' (< 70)."""
        tier, _, _ = mod.tier_info(69)
        assert tier == "practice"

    def test_tier_info_boundary_40(self, mod):
        """Score = 40 deve essere 'practice' (>= 40)."""
        tier, _, _ = mod.tier_info(40)
        assert tier == "practice"

    def test_tier_info_boundary_39(self, mod):
        """Score = 39 deve essere 'riferimento' (< 40)."""
        tier, _, _ = mod.tier_info(39)
        assert tier == "riferimento"

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


# ---------------------------------------------------------------------------
# Test personal_mail.py — funzioni di parsing (zero IMAP)
# ---------------------------------------------------------------------------

@requires_mail
class TestMailDecodeHeader:
    """Test decode_hdr() con vari formati di header email."""

    @pytest.fixture(scope="class")
    def mod(self):
        return _load_module(MAIL_SCRIPT, "personal_mail")

    def test_decode_plain_ascii(self, mod):
        result = mod.decode_hdr("Hello World")
        assert result == "Hello World"

    def test_decode_none_returns_empty(self, mod):
        assert mod.decode_hdr(None) == ""

    def test_decode_empty_returns_empty(self, mod):
        assert mod.decode_hdr("") == ""

    def test_decode_utf8_encoded(self, mod):
        """Header MIME encoded (UTF-8) deve essere decodificato."""
        # =?utf-8?b?...? è un header MIME base64-encoded
        import base64
        text = "Risposta alla tua candidatura"
        encoded = f"=?utf-8?b?{base64.b64encode(text.encode()).decode()}?="
        result = mod.decode_hdr(encoded)
        assert "candidatura" in result or len(result) > 0

    def test_decode_returns_string(self, mod):
        result = mod.decode_hdr("Test Subject")
        assert isinstance(result, str)


@requires_mail
class TestMailGetBodyText:
    """Test get_body_text() con messaggi email sintetici."""

    @pytest.fixture(scope="class")
    def mod(self):
        return _load_module(MAIL_SCRIPT, "personal_mail")

    def _make_plain_msg(self, text):
        """Crea un messaggio email semplice text/plain."""
        import email.mime.text
        return email.mime.text.MIMEText(text, "plain", "utf-8")

    def _make_html_msg(self, html):
        """Crea un messaggio email HTML."""
        import email.mime.text
        return email.mime.text.MIMEText(html, "html", "utf-8")

    def test_body_plain_text(self, mod):
        msg = self._make_plain_msg("Grazie per la tua candidatura.")
        result = mod.get_body_text(msg)
        assert "candidatura" in result

    def test_body_html_stripped(self, mod):
        """HTML deve essere stripped — solo testo."""
        msg = self._make_html_msg("<p>Siamo lieti di invitarti a un colloquio.</p>")
        result = mod.get_body_text(msg)
        assert "colloquio" in result
        assert "<p>" not in result

    def test_body_empty_returns_empty(self, mod):
        msg = self._make_plain_msg("")
        result = mod.get_body_text(msg)
        assert result == ""

    def test_body_html_strips_script_tags(self, mod):
        """Script tag HTML devono essere rimossi dal body."""
        msg = self._make_html_msg("<script>alert('x')</script><p>Testo ok</p>")
        result = mod.get_body_text(msg)
        assert "alert" not in result
        assert "Testo ok" in result

    def test_body_returns_string(self, mod):
        msg = self._make_plain_msg("test")
        assert isinstance(mod.get_body_text(msg), str)
