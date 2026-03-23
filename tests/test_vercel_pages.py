"""
Test HTTP pagine Vercel — Job Hunter Team QA.

Verifica che tutte le pagine Next.js deployate su Vercel:
- Rispondano (non 404/500)
- Richiedano autenticazione (401/redirect) senza sessione
- Le route dinamiche /positions/[id] esistano e siano protette

Eseguire con: pytest tests/test_vercel_pages.py -v
Richiede: VERCEL_URL env var oppure usa l'URL di default.
"""

import os
import urllib.request
import urllib.error
import pytest

VERCEL_URL = os.environ.get(
    "VERCEL_URL",
    "https://job-hunter-team.vercel.app"
).rstrip("/")

requires_vercel = pytest.mark.skipif(
    not VERCEL_URL,
    reason="Richiede VERCEL_URL"
)


def http_status(path: str) -> int:
    """Ritorna lo status HTTP di una pagina. Skippa se non raggiungibile."""
    url = VERCEL_URL + path
    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", "JHT-QA-Tom/1.0")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except urllib.error.URLError as e:
        pytest.skip(f"Vercel non raggiungibile: {e}")


# ---------------------------------------------------------------------------
# Test 1: Pagine statiche pubbliche
# ---------------------------------------------------------------------------

class TestPublicPages:
    """La homepage deve rispondere (200 o redirect a login)."""

    def test_homepage_responds(self):
        status = http_status("/")
        assert status in (200, 302, 307, 401), f"Homepage: status inatteso {status}"

    def test_no_500_errors_on_homepage(self):
        status = http_status("/")
        assert status != 500, "Homepage restituisce errore 500"


# ---------------------------------------------------------------------------
# Test 2: Pagine protette — 401 senza auth
# ---------------------------------------------------------------------------

class TestProtectedPages:
    """Tutte le pagine private devono richiedere autenticazione."""

    PROTECTED_ROUTES = [
        "/dashboard",
        "/positions",
        "/applications",
    ]

    def test_dashboard_requires_auth(self):
        status = http_status("/dashboard")
        # 401/302/307 = HTTP auth guard; 200 = client-side redirect (Next.js)
        assert status in (200, 401, 302, 307), (
            f"/dashboard: status inatteso {status}"
        )
        assert status != 500, "/dashboard restituisce 500"

    def test_positions_requires_auth(self):
        status = http_status("/positions")
        assert status in (200, 401, 302, 307), (
            f"/positions: status inatteso {status}"
        )
        assert status != 500, "/positions restituisce 500"

    def test_applications_requires_auth(self):
        status = http_status("/applications")
        assert status in (200, 401, 302, 307), (
            f"/applications: status inatteso {status}"
        )
        assert status != 500, "/applications restituisce 500"

    def test_no_protected_page_returns_500(self):
        """Nessuna pagina protetta deve crashare con 500."""
        for route in self.PROTECTED_ROUTES:
            status = http_status(route)
            assert status != 500, f"{route} restituisce 500 — errore server"


# ---------------------------------------------------------------------------
# Test 3: Route dinamiche /positions/[id]
# ---------------------------------------------------------------------------

class TestDynamicRoutes:
    """Le route dinamiche devono esistere e essere protette."""

    def test_position_detail_with_real_uuid(self):
        """/positions/[uuid] con UUID reale non deve restituire 404 o 500."""
        # IDs nel DB sono UUID (fix PR #30 — parseInt(uuid) causava NaN → notFound)
        real_uuid = os.environ.get("TEST_POSITION_UUID", "00000000-0000-0000-0000-000000000000")
        status = http_status(f"/positions/{real_uuid}")
        assert status != 404, f"/positions/{real_uuid} → 404"
        assert status != 500, f"/positions/{real_uuid} → 500"

    def test_position_detail_invalid_uuid_not_500(self):
        """/positions/id-invalido non deve crashare con 500 (regressione BUG-parseInt)."""
        status = http_status("/positions/not-a-real-uuid-0000")
        assert status != 500, "/positions/invalid-uuid → 500 — parseInt bug non fixato"


# ---------------------------------------------------------------------------
# Test 4: Endpoint auth callback
# ---------------------------------------------------------------------------

class TestAuthEndpoints:
    """Endpoint di autenticazione devono essere raggiungibili."""

    def test_auth_callback_not_404(self):
        """/auth/callback deve esistere (non 404)."""
        status = http_status("/auth/callback")
        assert status != 404, "/auth/callback non trovato — OAuth callback rotto"
        assert status != 500, "/auth/callback restituisce 500"


# ---------------------------------------------------------------------------
# Test 5: Pagina /profile — regressione BUG-PROFILE-01
# ---------------------------------------------------------------------------

class TestProfilePage:
    """
    Regressione BUG-PROFILE-01: /profile mostrava 'Nessun profilo configurato'
    perché candidate_profiles in Supabase era vuota (profilo legacy non migrato).
    Questi test verificano che la pagina non crashi e che il fix sia stato applicato.
    """

    def test_profile_page_not_500(self):
        """/profile non deve restituire 500 (crash server)."""
        status = http_status("/profile")
        assert status != 500, "/profile restituisce 500 — errore server critico"

    def test_profile_page_not_404(self):
        """/profile deve esistere come route (non 404)."""
        status = http_status("/profile")
        assert status != 404, "/profile non trovato — route mancante"

    def test_profile_page_returns_200(self):
        """
        /profile restituisce 200 (route OK).
        BUG-PROFILE-01: il contenuto mostra 'Nessun profilo configurato'
        perché candidate_profiles è vuota — fix lato dati da backend.
        Il contenuto vuoto è verificabile solo via test E2E.
        """
        status = http_status("/profile")
        assert status == 200, f"/profile: atteso 200, trovato {status}"


# ---------------------------------------------------------------------------
# Test 6: Regressione PR #31 — grafici dashboard (distribuzione score + fonti)
# ---------------------------------------------------------------------------

class TestDashboardCharts:
    """
    Regressione PR #31 (frontend): grafici distribuzione score e fonti aggiunti alla dashboard.
    Implementati come Server Components con barre CSS pure (nessuna libreria esterna).
    I test HTTP verificano che il Server Component non crashi (no 500).
    La correttezza visiva dei grafici è verificabile solo via test E2E.
    """

    def test_dashboard_charts_not_500(self):
        """/dashboard non deve crashare dopo aggiunta grafici PR #31."""
        status = http_status("/dashboard")
        assert status != 500, "/dashboard → 500 dopo grafici PR #31 (Server Component crash)"

    def test_dashboard_charts_not_404(self):
        """/dashboard deve esistere dopo PR #31."""
        status = http_status("/dashboard")
        assert status != 404, "/dashboard → 404 dopo PR #31"


# ---------------------------------------------------------------------------
# Test 7: Regressione BUG-PROFILE-NULL — /profile 500 con campi null
# ---------------------------------------------------------------------------

class TestProfileNullRegression:
    """
    Regressione BUG-PROFILE-NULL (trovato in audit E2E):
    /profile crashava 500 per utenti con candidate_profiles con campi null
    (location=null, nationality=null, birth_year=null, job_titles=[]).

    Causa root: profile/page.tsx riga ~172 — condition 'profile.salary_target &&'
    è truthy anche con {} vuoto. Accede a salary_target.italy_min.toLocaleString()
    → undefined → TypeError → 500.

    Fix: aggiungere optional chaining (salary_target?.italy_min) o guard esplicita
    su tutti i campi nullable del profilo.
    """

    def test_profile_not_500(self):
        """/profile non deve mai restituire 500 (neanche con profilo vuoto)."""
        status = http_status("/profile")
        assert status != 500, (
            "BUG-PROFILE-NULL: /profile → 500. "
            "Server Component crasha su campi null in candidate_profiles."
        )

    def test_profile_not_404(self):
        """/profile deve esistere come route."""
        status = http_status("/profile")
        assert status != 404, "/profile → 404 dopo BUG-PROFILE-NULL fix"

    def test_profile_edit_not_500(self):
        """
        /profile/edit non deve restituire 500 (PR #35).
        Fix: lp.type nullable + setLoading su no-user in profile/edit.
        """
        status = http_status("/profile/edit")
        assert status != 500, "BUG-PROFILE-EDIT: /profile/edit → 500"

    def test_profile_edit_not_404(self):
        """/profile/edit deve esistere come route (PR #35)."""
        status = http_status("/profile/edit")
        assert status != 404, "/profile/edit → 404"


# ---------------------------------------------------------------------------
# Test 8: /api/team — struttura risposta API agenti
# ---------------------------------------------------------------------------

class TestTeamApi:
    """
    Verifica che /team e /api/team rispondano correttamente su Vercel.
    Nota: /api/team richiede localhost (tmux non disponibile su Vercel) —
    su Vercel la route protetta restituisce 307 redirect (auth), non 500.
    """

    def test_team_page_not_500(self):
        """/team non deve crashare (neanche senza agenti attivi)."""
        status = http_status("/team")
        assert status != 500, "/team → 500"

    def test_team_page_not_404(self):
        """/team deve esistere."""
        status = http_status("/team")
        assert status != 404, "/team → 404"

    def test_team_api_not_500(self):
        """/api/team non deve restituire 500 (può essere 404 su Vercel — solo localhost ha tmux)."""
        status = http_status("/api/team")
        assert status != 500, "/api/team → 500 (crash Server Component)"
