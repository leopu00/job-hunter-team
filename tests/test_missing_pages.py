"""
Test pagine mancanti dalla migrazione legacy — Job Hunter Team QA.

Traccia tutte le route/feature presenti nel legacy (dashboard.html + app.html)
ma assenti nel nuovo frontend. Ogni test è marcato @pytest.mark.xfail finché
la feature non viene implementata dal team frontend.

Quando viene implementata una pagina, il test diventa XPASS → rimuovere xfail.

Legacy: dashboard.html (3.338 LOC) + app.html (5.428 LOC) = 8.766 LOC
Nuovo: ~3.000 LOC (35% migrato)

Eseguire con: pytest tests/test_missing_pages.py -v
"""

import os
import urllib.request
import urllib.error
import pytest

VERCEL_URL = os.environ.get(
    "VERCEL_URL",
    "https://jobhunterteam.ai"
).rstrip("/")


def http_status(path: str) -> int:
    url = VERCEL_URL + path
    req = urllib.request.Request(url, method="GET")
    req.add_header("User-Agent", "JHT-QA/1.0")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except urllib.error.URLError as e:
        pytest.skip(f"Vercel non raggiungibile: {e}")


# ---------------------------------------------------------------------------
# GRAVITÀ MOLTO ALTA — route mancanti critiche
# ---------------------------------------------------------------------------

class TestMissingRoutesCritical:
    """Route mancanti di gravità molto alta dal legacy."""

    def test_team_monitor_page_exists(self):
        """/team Monitor Pipeline — dati reali posizioni per status + scout activity (PR #33)."""
        assert http_status("/team") != 404, "/team → 404"

    @pytest.mark.xfail(reason="mai implementata: non c'è nessuna route /ready "
                              "sotto web/app — resta una voce del legacy",
                       strict=False)
    def test_ready_page_exists(self):
        """/ready deve esistere (applicazioni pronte — PR #29)."""
        assert http_status("/ready") != 404, "/ready → 404"

    @pytest.mark.xfail(reason="mai implementata: non c'è nessuna route /risposte "
                              "sotto web/app — resta una voce del legacy",
                       strict=False)
    def test_risposte_page_exists(self):
        """/risposte deve esistere (risposte aziende — PR #29)."""
        assert http_status("/risposte") != 404, "/risposte → 404"

    # Le cinque pagine di ruolo ESISTONO, ma sotto `/team/<ruolo>`
    # (`web/app/(protected)/team/<ruolo>`), non alla radice: la radice non le
    # ha mai servite. Il test le cercava dove il legacy le teneva e per questo
    # è rosso — la feature c'è, l'indirizzo è un altro.
    def test_analista_page_exists(self):
        """/team/analista deve esistere (PR #38 — fix URL singolare)."""
        assert http_status("/team/analista") != 404

    def test_scout_page_exists(self):
        """/team/scout deve esistere (PR #36)."""
        assert http_status("/team/scout") != 404

    def test_scorer_page_exists(self):
        """/team/scorer deve esistere (PR #36)."""
        assert http_status("/team/scorer") != 404

    def test_scrittore_page_exists(self):
        """/team/scrittore deve esistere (PR #36)."""
        assert http_status("/team/scrittore") != 404

    def test_critico_page_exists(self):
        """/team/critico deve esistere (PR #36)."""
        assert http_status("/team/critico") != 404


# ---------------------------------------------------------------------------
# GRAVITÀ ALTA — filtri e analytics
# ---------------------------------------------------------------------------

class TestMissingRoutesHigh:
    """Route/feature di gravità alta dal legacy.

    NB: i filtri `?tier=seria|practice|riferimento` di PR #33 e il relativo "tier
    breakdown" sono stati DISMESSI — /positions filtra ora per range numerico di
    score (`band`) scelto dall'utente. Niente più categorizzazione practice/seria:
    il team dà lo score, l'utente decide. I relativi test sono stati rimossi."""

    def test_positions_salary_filter(self):
        """/positions?salary_min=40000 deve rispondere."""
        status = http_status("/positions?salary_min=40000")
        assert status not in (404, 500)


# ---------------------------------------------------------------------------
# Test che DEVONO già passare — verifica regressioni
# ---------------------------------------------------------------------------

class TestMigratedFeaturesStillWork:
    """
    Feature già migrate — devono rimanere verdi.
    Se questi test diventano rossi, è una regressione.
    """

    def test_dashboard_still_works(self):
        assert http_status("/dashboard") not in (404, 500)

    def test_positions_still_works(self):
        assert http_status("/positions") not in (404, 500)

    def test_position_detail_still_works(self):
        assert http_status("/positions/1") not in (404, 500)

    def test_notifications_still_works(self):
        assert http_status("/notifications") not in (404, 500)

    def test_profile_still_works(self):
        assert http_status("/profile") not in (404, 500)


# ---------------------------------------------------------------------------
# Test 6: Regressione BUG-MIDDLEWARE-01 — middleware.ts mancante
# ---------------------------------------------------------------------------

class TestMiddlewareRegression:
    """
    Regressione BUG-MIDDLEWARE-01: dashboard mostrava 0 dati dopo login.
    CAUSA ROOT: proxy.ts esporta 'proxy' non 'middleware' → Next.js non lo
    eseguiva → sessione non propagata → auth.uid()=null → RLS bloccava tutto.
    Fix (PR #28): middleware.ts che re-esporta proxy.ts correttamente.
    """

    def test_dashboard_after_middleware_fix_not_500(self):
        """/dashboard non deve crashare dopo il fix middleware."""
        status = http_status("/dashboard")
        assert status != 500, "/dashboard → 500 dopo fix middleware"

    def test_positions_after_middleware_fix_not_500(self):
        """/positions non deve crashare dopo il fix middleware."""
        status = http_status("/positions")
        assert status != 500, "/positions → 500 dopo fix middleware"

    def test_auth_callback_still_works(self):
        """/auth/callback deve continuare a rispondere dopo il fix."""
        status = http_status("/auth/callback")
        assert status not in (404, 500), f"/auth/callback → {status} dopo fix middleware"
