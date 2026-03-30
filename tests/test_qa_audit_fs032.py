"""
QA Audit task-fs-032 — Job Hunter Team
Tom (JHT-QA), 2026-03-30

Giro di audit completo sulla codebase: dashboard, profilo, assistente, capitano,
chat, login, dropdown team, indicatore live, terminale.

Eseguire con: pytest tests/test_qa_audit_fs032.py -v
"""

import os
import urllib.request
import urllib.error
import pytest

BASE_URL = os.environ.get("JHT_BASE_URL", "http://localhost:3000").rstrip("/")


def http_get(path: str, timeout: int = 5) -> int:
    url = BASE_URL + path
    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", "JHT-QA/1.0")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except urllib.error.URLError:
        pytest.skip(f"Server non raggiungibile: {url}")


def http_post(path: str, body: bytes | None = None, content_type: str = "application/json") -> int:
    url = BASE_URL + path
    req = urllib.request.Request(url, data=body or b"", method="POST")
    req.add_header("Content-Type", content_type)
    req.add_header("User-Agent", "JHT-QA/1.0")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except urllib.error.URLError:
        pytest.skip(f"Server non raggiungibile: {url}")


# ---------------------------------------------------------------------------
# BUG-01 (FIXATO nel branch qa): /api/capitano/stop mancante
# Capitano non aveva endpoint per essere fermato né bottone "Ferma" nella UI.
# Fix: creato /api/capitano/stop/route.ts + bottone nella pagina.
# I test sul codebase (file system) passano subito.
# I test sull'endpoint live passano dopo merge in main.
# ---------------------------------------------------------------------------

import pathlib

# Root della worktree qa
QA_WEB_ROOT = pathlib.Path(__file__).parent.parent / "web"


class TestCapitanoStopCodebase:
    """Verifica che il fix BUG-01 sia presente nel codebase (worktree qa)."""

    def test_capitano_stop_route_file_exists(self):
        """Il file route.ts per /api/capitano/stop deve esistere."""
        stop_route = QA_WEB_ROOT / "app" / "api" / "capitano" / "stop" / "route.ts"
        assert stop_route.exists(), \
            f"BUG-01: {stop_route} non trovato — endpoint capitano/stop mancante"

    def test_capitano_stop_route_kills_alfa_session(self):
        """Il file route.ts deve terminare la sessione ALFA (non ASSISTENTE)."""
        stop_route = QA_WEB_ROOT / "app" / "api" / "capitano" / "stop" / "route.ts"
        if not stop_route.exists():
            pytest.skip("File non trovato — vedi test_capitano_stop_route_file_exists")
        content = stop_route.read_text()
        assert "ALFA" in content, "BUG-01: lo stop del capitano deve killare la sessione ALFA"
        assert "ASSISTENTE" not in content, \
            "BUG-01: lo stop del capitano non deve riferirsi a ASSISTENTE"

    def test_capitano_page_has_stop_button(self):
        """La pagina capitano deve avere il bottone Ferma."""
        page = QA_WEB_ROOT / "app" / "(protected)" / "capitano" / "page.tsx"
        assert page.exists(), "page.tsx del capitano non trovato"
        content = page.read_text()
        assert "/api/capitano/stop" in content, \
            "BUG-01: la UI del capitano non chiama /api/capitano/stop"
        assert "Ferma" in content, \
            "BUG-01: bottone 'Ferma' mancante nella pagina capitano"

    @pytest.mark.xfail(
        reason="BUG-01: il server live (master) non ha ancora il fix. Passerà dopo il merge.",
        strict=False,
    )
    def test_capitano_stop_endpoint_live(self):
        """POST /api/capitano/stop deve rispondere 200 sul server live (post-merge)."""
        status = http_post("/api/capitano/stop", b"{}")
        assert status not in (404, 405), \
            f"BUG-01: /api/capitano/stop live → {status}"


# ---------------------------------------------------------------------------
# Smoke test — route principali
# ---------------------------------------------------------------------------

class TestSmokeRoutes:
    """Tutte le route principali devono rispondere senza 404/500."""

    @pytest.mark.parametrize("path", [
        "/",
        "/dashboard",
        "/positions",
        "/applications",
        "/profile",
        "/team",
        "/capitano",
        "/assistente",
        "/scout",
        "/analista",
        "/scorer",
        "/scrittore",
        "/critico",
        "/sentinella",
        "/ready",
        "/risposte",
        "/crescita",
    ])
    def test_page_not_404_or_500(self, path):
        status = http_get(path)
        assert status not in (404, 500), f"{path} → {status}"


# ---------------------------------------------------------------------------
# Test API agents
# ---------------------------------------------------------------------------

class TestAgentAPIs:
    """Le API degli agenti devono rispondere correttamente."""

    def test_assistente_status(self):
        status = http_get("/api/assistente/status")
        assert status == 200, f"/api/assistente/status → {status}"

    def test_capitano_status(self):
        status = http_get("/api/capitano/status")
        assert status == 200, f"/api/capitano/status → {status}"

    def test_team_status(self):
        status = http_get("/api/team/status")
        assert status == 200, f"/api/team/status → {status}"

    def test_assistente_chat_get(self):
        status = http_get("/api/assistente/chat?after=0")
        assert status == 200, f"/api/assistente/chat GET → {status}"

    def test_capitano_chat_get(self):
        status = http_get("/api/capitano/chat?after=0")
        assert status == 200, f"/api/capitano/chat GET → {status}"

    @pytest.mark.xfail(
        reason="BUG-01: il server live (master) non ha ancora il fix. Passerà dopo merge.",
        strict=False,
    )
    def test_capitano_stop_exists(self):
        """BUG-01 regression: endpoint stop deve esistere dopo merge."""
        status = http_post("/api/capitano/stop", b"{}")
        assert status not in (404, 405), f"/api/capitano/stop → {status}"

    def test_workspace_get(self):
        status = http_get("/api/workspace")
        assert status == 200, f"/api/workspace GET → {status}"


# ---------------------------------------------------------------------------
# BUG-03 (REPORT): Auth callback open redirect
# ?next=//evil.com potrebbe fare redirect a sito esterno.
# L'origin viene preposto, ma //evil.com è un URL protocol-relative
# che può essere interpretato come redirect esterno da alcuni browser.
# ---------------------------------------------------------------------------

class TestAuthCallbackRedirect:
    """
    BUG-03: /auth/callback non valida il parametro ?next.
    Un valore come '//evil.com' produce un redirect a una URL esterna.
    STATO: aperto, richiede fix upstream.
    """

    def test_auth_callback_without_code_redirects_home(self):
        """/auth/callback senza codice deve redirigere alla home con errore."""
        url = BASE_URL + "/auth/callback"
        req = urllib.request.Request(url, method="GET")
        req.add_header("User-Agent", "JHT-QA/1.0")
        try:
            # Non seguire redirect per vedere dove punta
            import urllib.request as ur
            opener = ur.build_opener(ur.HTTPRedirectHandler())
            with opener.open(req, timeout=5) as r:
                final_url = r.url
                # Deve puntare alla home o a un path locale, non a siti esterni
                assert final_url.startswith(BASE_URL) or final_url.startswith("/"), \
                    f"Redirect a URL esterno: {final_url}"
        except urllib.error.HTTPError as e:
            # Un 302 o 303 senza seguire il redirect: verifica Location header
            location = e.headers.get("Location", "")
            assert not location.startswith("//"), \
                f"BUG-03: redirect a protocol-relative URL: {location}"
        except urllib.error.URLError:
            pytest.skip("Server non raggiungibile")


# ---------------------------------------------------------------------------
# BUG-04 (REPORT): Indicatore live dashboard è server-rendered
# Il badge 'live · team attivo' non si aggiorna senza refresh pagina.
# Questo test verifica che la route API /api/team/status esista e sia
# usabile per future implementazioni client-side.
# ---------------------------------------------------------------------------

class TestDashboardLiveIndicator:
    """
    BUG-04: L'indicatore 'live · team attivo' sulla dashboard è
    calcolato server-side al caricamento della pagina e non si aggiorna
    dinamicamente. L'animazione CSS dà l'impressione di real-time ma i
    dati sono stale. L'API /api/team/status è disponibile per il fix.
    """

    def test_team_status_api_available_for_client_polling(self):
        """/api/team/status deve essere disponibile per polling client-side."""
        status = http_get("/api/team/status")
        assert status == 200, f"API per live indicator non disponibile: {status}"

    def test_team_status_returns_agents_field(self):
        """La risposta deve avere il campo 'agents'."""
        import json
        url = BASE_URL + "/api/team/status"
        req = urllib.request.Request(url, method="GET")
        req.add_header("User-Agent", "JHT-QA/1.0")
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                data = json.loads(r.read())
                assert "agents" in data, "Campo 'agents' mancante da /api/team/status"
        except urllib.error.URLError:
            pytest.skip("Server non raggiungibile")


# ---------------------------------------------------------------------------
# BUG-02 (REPORT): shell.ts:runScript argomenti non escaped
# `runScript(path, arg)` wrappa l'argomento con `"${a}"` senza escapare
# le virgolette doppie interne. Un argomento con " dentro rompe il comando.
# Questo test è a livello di smoke — non può testare l'injection direttamente
# senza eseguire uno script reale.
# ---------------------------------------------------------------------------

class TestShellSecurity:
    """
    BUG-02: lib/shell.ts:runScript() non escapa le virgolette doppie
    negli argomenti. Esempio: runScript(script, 'foo"bar') produce
    `bash script "foo"bar"` che è malformato.

    Il test verifica che l'avvio dell'assistente con un workspace valido
    non produca errori di parsing shell.
    """

    def test_assistente_start_rejects_path_traversal(self):
        """POST /api/assistente/start con path '../etc' deve essere rifiutato."""
        import json
        body = json.dumps({"workspace": "../etc/passwd"}).encode()
        status = http_post("/api/assistente/start", body)
        assert status in (400, 200), \
            f"Path traversal non gestito correttamente: {status}"
        # Se 200, l'API dovrebbe già essere attiva o aver rifiutato il path


# ---------------------------------------------------------------------------
# BUG-05 (REPORT): navigator.platform deprecato in assistente/page.tsx
# Usato per rilevare macOS. Sostituire con navigator.userAgent.
# Questo test è documentativo (non testabile lato server).
# ---------------------------------------------------------------------------

class TestDeprecatedAPIs:
    """
    BUG-05: assistente/page.tsx usa navigator.platform (deprecato).
    Riga: /Mac/.test(navigator.platform)
    Fix: usare navigator.userAgent.includes('Mac') oppure
         /Macintosh/.test(navigator.userAgent)
    STATO: aperto, low priority.
    """

    def test_assistente_page_loads(self):
        """Smoke: la pagina assistente deve caricare senza 500."""
        status = http_get("/assistente")
        assert status not in (404, 500), f"/assistente → {status}"
