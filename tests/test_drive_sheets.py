"""
Test unitari per db_to_drive.py e db_to_sheets.py — Job Hunter Team QA.

Verifica:
- Costanti e configurazioni (WORKTREES, HEADERS, SHEET_NAME)
- Funzioni pure: find_pdf, drive_link, drive_url, format_salary
- Guardia _require_drive_folder (sys.exit se env var mancante)
- Nessuna dipendenza da Google API (skip se credenziali assenti)

Eseguire con: pytest tests/test_drive_sheets.py -v
"""

import os
import sys
import importlib.util
import pathlib
import pytest

# ---------------------------------------------------------------------------
# Path agli script
# ---------------------------------------------------------------------------

REPO_ROOT = pathlib.Path(__file__).parent.parent
SHARED_SKILLS = REPO_ROOT / "shared" / "skills"
DRIVE_SCRIPT = SHARED_SKILLS / "db_to_drive.py"
SHEETS_SCRIPT = SHARED_SKILLS / "db_to_sheets.py"

has_drive_script = DRIVE_SCRIPT.is_file()
has_sheets_script = SHEETS_SCRIPT.is_file()

requires_drive = pytest.mark.skipif(
    not has_drive_script,
    reason=f"db_to_drive.py non trovato: {DRIVE_SCRIPT}"
)
requires_sheets = pytest.mark.skipif(
    not has_sheets_script,
    reason=f"db_to_sheets.py non trovato: {SHEETS_SCRIPT}"
)


def _load_module(path: pathlib.Path, name: str):
    """Carica un modulo da path assoluto senza eseguire __main__."""
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    # Patch sys.argv per evitare che __main__ guard esegua codice
    old_argv = sys.argv
    sys.argv = [str(path)]
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.argv = old_argv
    return mod


# ---------------------------------------------------------------------------
# Test db_to_drive.py
# ---------------------------------------------------------------------------

@requires_drive
class TestDriveConstants:
    """Verifica costanti e struttura WORKTREES."""

    @pytest.fixture(scope="class")
    def mod(self):
        return _load_module(DRIVE_SCRIPT, "db_to_drive")

    def test_worktrees_is_list(self, mod):
        assert isinstance(mod.WORKTREES, list)
        assert len(mod.WORKTREES) > 0

    def test_worktrees_contains_scrittore(self, mod):
        """Almeno uno scrittore worktree presente."""
        scrittori = [w for w in mod.WORKTREES if 'scrittore' in w]
        assert len(scrittori) >= 1, f"Nessun worktree scrittore in {mod.WORKTREES}"

    def test_worktrees_contains_critico(self, mod):
        assert 'critico' in mod.WORKTREES, f"'critico' non in WORKTREES: {mod.WORKTREES}"

    def test_worktrees_contains_alfa(self, mod):
        assert 'capitano' in mod.WORKTREES, f"'capitano' non in WORKTREES: {mod.WORKTREES}"

    def test_worktrees_contains_scout(self, mod):
        scout = [w for w in mod.WORKTREES if 'scout' in w]
        assert len(scout) >= 1, f"Nessun worktree scout in {mod.WORKTREES}"

    def test_worktrees_contains_analista(self, mod):
        analisti = [w for w in mod.WORKTREES if 'analista' in w]
        assert len(analisti) >= 1, f"Nessun worktree analista in {mod.WORKTREES}"

    def test_scopes_contains_drive(self, mod):
        assert 'https://www.googleapis.com/auth/drive' in mod.SCOPES

    def test_secrets_paths_defined(self, mod):
        assert hasattr(mod, 'OAUTH_CLIENT_PATH')
        assert hasattr(mod, 'OAUTH_TOKEN_PATH')
        assert 'google-oauth-client.json' in mod.OAUTH_CLIENT_PATH
        assert 'google-oauth-token.json' in mod.OAUTH_TOKEN_PATH


@requires_drive
class TestDriveLinkFunction:
    """Verifica drive_link() genera URL corretto."""

    @pytest.fixture(scope="class")
    def mod(self):
        return _load_module(DRIVE_SCRIPT, "db_to_drive")

    def test_drive_link_format(self, mod):
        link = mod.drive_link("abc123")
        assert link == "https://drive.google.com/file/d/abc123/view"

    def test_drive_link_contains_file_id(self, mod):
        file_id = "XyZ_myFileId-456"
        link = mod.drive_link(file_id)
        assert file_id in link

    def test_drive_link_is_string(self, mod):
        result = mod.drive_link("test")
        assert isinstance(result, str)

    def test_drive_link_starts_with_https(self, mod):
        link = mod.drive_link("anyid")
        assert link.startswith("https://")


@requires_drive
class TestFindPdf:
    """Verifica find_pdf() cerca correttamente nelle worktree."""

    @pytest.fixture(scope="class")
    def mod(self):
        return _load_module(DRIVE_SCRIPT, "db_to_drive")

    def test_find_pdf_returns_none_when_not_found(self, mod):
        result = mod.find_pdf("nonexistent/path/file.pdf")
        assert result is None

    def test_find_pdf_finds_file_in_worktree(self, mod, tmp_path):
        """Crea un PDF fake in una worktree mock e verifica che venga trovato."""
        # Crea struttura temporanea: tmp_path/scrittore-1/docs/cv.pdf
        wt_dir = tmp_path / "scrittore-1" / "docs"
        wt_dir.mkdir(parents=True)
        pdf_file = wt_dir / "cv.pdf"
        pdf_file.write_bytes(b"%PDF-1.4 fake")

        # Patch REPO_ROOT e WORKTREES nel modulo
        original_repo_root = mod.REPO_ROOT
        original_worktrees = mod.WORKTREES
        mod.REPO_ROOT = str(tmp_path)
        mod.WORKTREES = ['scrittore-1']
        try:
            result = mod.find_pdf("docs/cv.pdf")
            assert result is not None
            assert result.endswith("cv.pdf")
        finally:
            mod.REPO_ROOT = original_repo_root
            mod.WORKTREES = original_worktrees

    def test_find_pdf_priority_order(self, mod, tmp_path):
        """find_pdf deve restituire il primo match in ordine WORKTREES."""
        # Crea PDF in due worktree
        for wt in ['scrittore-1', 'scrittore-2']:
            wt_dir = tmp_path / wt / "docs"
            wt_dir.mkdir(parents=True)
            pdf = wt_dir / "test.pdf"
            pdf.write_bytes(f"PDF {wt}".encode())

        original_repo_root = mod.REPO_ROOT
        original_worktrees = mod.WORKTREES
        mod.REPO_ROOT = str(tmp_path)
        mod.WORKTREES = ['scrittore-1', 'scrittore-2']
        try:
            result = mod.find_pdf("docs/test.pdf")
            # Deve trovare scrittore-1 (primo in lista)
            assert 'scrittore-1' in result
        finally:
            mod.REPO_ROOT = original_repo_root
            mod.WORKTREES = original_worktrees


@requires_drive
class TestRequireDriveFolder:
    """Verifica _require_drive_folder() fa sys.exit se env var mancante."""

    @pytest.fixture(scope="class")
    def mod(self):
        return _load_module(DRIVE_SCRIPT, "db_to_drive")

    def test_exits_when_no_folder_id(self, mod, monkeypatch):
        """Senza JH_DRIVE_FOLDER_ID deve chiamare sys.exit(1)."""
        monkeypatch.setattr(mod, "DRIVE_FOLDER_ID", "")
        with pytest.raises(SystemExit) as exc:
            mod._require_drive_folder()
        assert exc.value.code == 1

    def test_does_not_exit_when_folder_id_set(self, mod, monkeypatch):
        """Con JH_DRIVE_FOLDER_ID configurato non deve fare sys.exit."""
        monkeypatch.setattr(mod, "DRIVE_FOLDER_ID", "1ABC2DEFfakefolderid")
        # Non deve sollevare eccezioni
        mod._require_drive_folder()


# ---------------------------------------------------------------------------
# Test db_to_sheets.py
# ---------------------------------------------------------------------------

@requires_sheets
class TestSheetsConstants:
    """Verifica costanti di configurazione."""

    @pytest.fixture(scope="class")
    def mod(self):
        return _load_module(SHEETS_SCRIPT, "db_to_sheets")

    def test_sheet_name(self, mod):
        assert mod.SHEET_NAME == "Job Applications"

    def test_headers_is_list(self, mod):
        assert isinstance(mod.HEADERS, list)

    def test_headers_count(self, mod):
        assert len(mod.HEADERS) == 15, (
            f"HEADERS: attesi 15 campi, trovati {len(mod.HEADERS)}: {mod.HEADERS}"
        )

    def test_headers_contains_required_columns(self, mod):
        required = {"#", "Status", "Azienda", "Titolo", "Link", "Score",
                    "CV Drive", "CL Drive", "Applicato"}
        for col in required:
            assert col in mod.HEADERS, f"Colonna obbligatoria mancante: {col}"

    def test_headers_order(self, mod):
        """Verifica ordine colonne chiave."""
        h = mod.HEADERS
        assert h[0] == "#"
        assert h[1] == "Status"
        assert h[2] == "Azienda"
        assert h[3] == "Titolo"

    def test_headers_has_salary(self, mod):
        assert "Stipendio" in mod.HEADERS

    def test_headers_has_critico(self, mod):
        assert "Critico" in mod.HEADERS

    def test_headers_has_verdict(self, mod):
        assert "Verdict" in mod.HEADERS

    def test_headers_has_data_applicazione(self, mod):
        assert "Data Applicazione" in mod.HEADERS


@requires_sheets
class TestSheetsDriveUrl:
    """Verifica drive_url() genera URL corretto."""

    @pytest.fixture(scope="class")
    def mod(self):
        return _load_module(SHEETS_SCRIPT, "db_to_sheets")

    def test_drive_url_with_id(self, mod):
        url = mod.drive_url("abc123")
        assert url == "https://drive.google.com/file/d/abc123/view"

    def test_drive_url_empty_string(self, mod):
        assert mod.drive_url("") == ""

    def test_drive_url_none(self, mod):
        assert mod.drive_url(None) == ""

    def test_drive_url_format(self, mod):
        file_id = "MyDriveFile_id-99"
        url = mod.drive_url(file_id)
        assert file_id in url
        assert url.startswith("https://drive.google.com/")


@requires_sheets
class TestSheetsFormatSalary:
    """Verifica format_salary() formatta correttamente lo stipendio."""

    @pytest.fixture(scope="class")
    def mod(self):
        return _load_module(SHEETS_SCRIPT, "db_to_sheets")

    def test_no_salary_returns_empty(self, mod):
        pos = {}
        assert mod.format_salary(pos) == ""

    def test_declared_salary_range(self, mod):
        pos = {
            "salary_declared_min": 50000,
            "salary_declared_max": 70000,
            "salary_declared_currency": "EUR",
        }
        result = mod.format_salary(pos)
        assert "50000" in result
        assert "70000" in result
        assert "EUR" in result

    def test_estimated_salary_range(self, mod):
        pos = {
            "salary_estimated_min": 45000,
            "salary_estimated_max": 65000,
        }
        result = mod.format_salary(pos)
        assert "45000" in result
        assert "65000" in result
        assert result.startswith("~")

    def test_both_declared_and_estimated(self, mod):
        pos = {
            "salary_declared_min": 50000,
            "salary_declared_max": 70000,
            "salary_declared_currency": "EUR",
            "salary_estimated_min": 45000,
            "salary_estimated_max": 65000,
        }
        result = mod.format_salary(pos)
        # Deve contenere entrambi separati da " | "
        assert "|" in result
        assert "EUR" in result
        assert "~" in result

    def test_missing_min_uses_question_mark(self, mod):
        pos = {
            "salary_declared_max": 70000,
            "salary_declared_currency": "EUR",
        }
        result = mod.format_salary(pos)
        assert "?" in result
        assert "70000" in result

    def test_missing_max_uses_question_mark(self, mod):
        pos = {
            "salary_declared_min": 50000,
            "salary_declared_currency": "EUR",
        }
        result = mod.format_salary(pos)
        assert "50000" in result
        assert "?" in result

    def test_default_currency_is_eur(self, mod):
        pos = {
            "salary_declared_min": 50000,
            "salary_declared_max": 70000,
        }
        result = mod.format_salary(pos)
        assert "EUR" in result

    def test_returns_string(self, mod):
        result = mod.format_salary({})
        assert isinstance(result, str)
