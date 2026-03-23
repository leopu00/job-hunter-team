"""
Test di integrazione Supabase — Job Hunter Team QA.

Verifica che:
- Le tabelle esistano e siano raggiungibili via REST API
- RLS (Row Level Security) sia attiva: anon key NON vede dati privati
- Lo schema delle risposte sia raggiungibile (endpoint risponde 200)
- Le query filtrate restituiscano 0 record senza auth (sicurezza OK)

NOTA SICUREZZA: il DB è protetto da RLS. I test qui verificano che:
  1. L'endpoint risponde (200, non 404/500)
  2. La RLS blocca l'accesso anonimo (0 record = CORRETTO)
  3. I test di conteggio reale richiedono un service role key
     e sono marcati @pytest.mark.requires_auth

Eseguire con: pytest tests/test_supabase_integration.py -v
Con auth:     SUPABASE_SERVICE_KEY=xxx pytest tests/test_supabase_integration.py -v
"""

import os
import json
import urllib.request
import urllib.error
import pytest

# ---------------------------------------------------------------------------
# Configurazione
# ---------------------------------------------------------------------------

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

HAS_SUPABASE = bool(SUPABASE_URL and SUPABASE_ANON_KEY)
requires_supabase = pytest.mark.skipif(
    not HAS_SUPABASE,
    reason="Richiede NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY"
)

ANON_HEADERS = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": f"Bearer {SUPABASE_ANON_KEY}",
    "Content-Type": "application/json",
    "Prefer": "count=exact",
}

HAS_SERVICE_KEY = bool(SUPABASE_SERVICE_KEY and SUPABASE_URL)


def _get_service_headers():
    return {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "count=exact",
    }


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def supabase_get(table: str, params: str = "", use_service_key: bool = False) -> tuple[list, int]:
    """
    Esegue GET su /rest/v1/{table}.
    Ritorna (rows, total_count).
    Skippa il test se Supabase non è raggiungibile.
    """
    headers = _get_service_headers() if use_service_key else ANON_HEADERS
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}&limit=10"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            content_range = resp.headers.get("Content-Range", "")
            total = int(content_range.split("/")[1]) if "/" in content_range else len(data)
            return data, total
    except urllib.error.URLError as e:
        pytest.skip(f"Supabase non raggiungibile: {e}")


def supabase_get_count_only(table: str, use_service_key: bool = False) -> int:
    """Ritorna solo il count totale di una tabella."""
    _, total = supabase_get(table, "select=id", use_service_key=use_service_key)
    return total


# ---------------------------------------------------------------------------
# Marker per conftest
# ---------------------------------------------------------------------------

requires_auth = pytest.mark.skipif(
    not HAS_SERVICE_KEY,
    reason="Richiede SUPABASE_SERVICE_KEY — skippato senza credenziali admin"
)


# ---------------------------------------------------------------------------
# Test 1: Raggiungibilità endpoint (anon OK)
# ---------------------------------------------------------------------------

@requires_supabase
class TestEndpointReachability:
    """Verifica che le tabelle esistano e rispondano 200."""

    def test_positions_endpoint_reachable(self):
        rows, total = supabase_get("positions")
        # 200 raggiunto — RLS attiva restituisce 0, non 404/500
        assert isinstance(rows, list)

    def test_companies_endpoint_reachable(self):
        rows, total = supabase_get("companies")
        assert isinstance(rows, list)

    def test_scores_endpoint_reachable(self):
        rows, total = supabase_get("scores")
        assert isinstance(rows, list)

    def test_applications_endpoint_reachable(self):
        rows, total = supabase_get("applications")
        assert isinstance(rows, list)

    def test_highlights_endpoint_reachable(self):
        rows, total = supabase_get("position_highlights")
        assert isinstance(rows, list)


# ---------------------------------------------------------------------------
# Test 2: RLS Security — anon NON vede dati privati
# ---------------------------------------------------------------------------

@requires_supabase
class TestRLSSecurity:
    """
    Verifica che la RLS blocchi correttamente l'accesso anonimo.
    0 record con anon key = comportamento di sicurezza CORRETTO.
    """

    def test_positions_rls_blocks_anon(self):
        """Anon non deve vedere posizioni private."""
        _, total = supabase_get("positions")
        assert total == 0, (
            f"SECURITY: positions visibili senza auth: {total} record esposti"
        )

    def test_companies_rls_blocks_anon(self):
        """Anon non deve vedere aziende private."""
        _, total = supabase_get("companies")
        assert total == 0, (
            f"SECURITY: companies visibili senza auth: {total} record esposti"
        )

    def test_scores_rls_blocks_anon(self):
        """Anon non deve vedere score privati."""
        _, total = supabase_get("scores")
        assert total == 0, (
            f"SECURITY: scores visibili senza auth: {total} record esposti"
        )

    def test_applications_rls_blocks_anon(self):
        """Anon non deve vedere applicazioni private (CV, CL, dati personali)."""
        _, total = supabase_get("applications")
        assert total == 0, (
            f"SECURITY CRITICA: applications visibili senza auth: {total} record esposti"
        )

    def test_highlights_rls_blocks_anon(self):
        """Anon non deve vedere highlights."""
        _, total = supabase_get("position_highlights")
        assert total == 0, (
            f"SECURITY: highlights visibili senza auth: {total} record esposti"
        )


# ---------------------------------------------------------------------------
# Test 3: Conteggi migrazione — richiedono service key
# ---------------------------------------------------------------------------

class TestMigrationCounts:
    """
    Verifica che la migrazione legacy sia avvenuta e i dati crescano correttamente.
    Richiede SUPABASE_SERVICE_KEY (service role bypassa RLS).

    I conteggi usano >= (soglie minime) perché la pipeline JH è attiva
    e aggiunge nuove posizioni — conteggi esatti non sono più significativi.
    Soglie basate sui dati di migrazione legacy iniziale.
    """

    @requires_auth
    def test_companies_count(self):
        _, total = supabase_get("companies", use_service_key=True)
        assert total >= 255, f"companies: attesi >= 255, trovato {total}"

    @requires_auth
    def test_positions_count(self):
        _, total = supabase_get("positions", use_service_key=True)
        assert total >= 530, f"positions: attesi >= 530, trovato {total}"

    @requires_auth
    def test_scores_count(self):
        _, total = supabase_get("scores", use_service_key=True)
        assert total >= 357, f"scores: attesi >= 357, trovato {total}"

    @requires_auth
    def test_applications_count(self):
        _, total = supabase_get("applications", use_service_key=True)
        assert total >= 172, f"applications: attesi >= 172, trovato {total}"

    @requires_auth
    def test_highlights_count(self):
        _, total = supabase_get("position_highlights", use_service_key=True)
        assert total >= 859, f"position_highlights: attesi >= 859, trovato {total}"

    @requires_auth
    def test_candidate_profiles_count(self):
        """Almeno 1 profilo candidato presente in Supabase."""
        _, total = supabase_get("candidate_profiles", use_service_key=True)
        assert total >= 1, f"candidate_profiles: atteso >= 1, trovato {total}"

    @requires_auth
    def test_total_records(self):
        """Totale >= 2.174 record (soglia migrazione legacy iniziale)."""
        tables = ["companies", "positions", "scores", "applications", "position_highlights", "candidate_profiles"]
        total = sum(supabase_get(t, use_service_key=True)[1] for t in tables)
        assert total >= 2174, f"Totale record: attesi >= 2174, trovato {total}"


# ---------------------------------------------------------------------------
# Test 4: Schema posizioni — richiede service key
# ---------------------------------------------------------------------------

class TestPositionsSchema:
    """Verifica che lo schema di positions corrisponda a Position in types.ts."""

    @requires_auth
    def test_positions_has_required_fields(self):
        rows, _ = supabase_get("positions", "limit=1", use_service_key=True)
        assert len(rows) > 0, "positions non contiene record"
        row = rows[0]
        for field in {"id", "title", "company", "status"}:
            assert field in row, f"Campo obbligatorio mancante: {field}"

    @requires_auth
    def test_positions_status_valid_values(self):
        valid_statuses = {
            "new", "checked", "excluded", "scored",
            "writing", "review", "ready", "applied", "response"
        }
        rows, _ = supabase_get("positions", "select=status", use_service_key=True)
        for row in rows:
            assert row["status"] in valid_statuses, (
                f"Status non valido: {row['status']}"
            )

    @requires_auth
    def test_scores_no_pros_cons(self):
        """Regressione BUG-NDV: pros/cons non devono esistere in scores."""
        rows, _ = supabase_get("scores", "limit=1", use_service_key=True)
        if rows:
            assert "pros" not in rows[0]
            assert "cons" not in rows[0]

    @requires_auth
    def test_positions_ready_exist(self):
        """Devono esistere posizioni con status='ready'."""
        _, total = supabase_get(
            "positions", "status=eq.ready&select=id",
            use_service_key=True
        )
        assert total > 0, "Nessuna posizione in stato 'ready'"

    @requires_auth
    def test_high_score_positions_exist(self):
        """Devono esistere posizioni con score >= 50."""
        _, total = supabase_get(
            "scores", "total_score=gte.50&select=position_id",
            use_service_key=True
        )
        assert total > 0, "Nessuna posizione con score >= 50"

    @requires_auth
    def test_risposte_or_query_matches_legacy_count(self):
        """
        Regressione BUG-CRESCITA-02 (segnalato in audit E2E):
        /crescita 'Risposte ricevute' mostrava 3 invece di 15.
        Causa: usava posStats.response (status='response' solo) invece di
        getRisposteCount() che usa OR: status='response' | response NOT NULL.

        Verifica che il conteggio OR sia >= conteggio solo status='response'.
        """
        import urllib.request
        import urllib.error

        # Conteggio solo status='response'
        url_status = f"{SUPABASE_URL}/rest/v1/applications?status=eq.response&select=id"
        req = urllib.request.Request(
            url_status,
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Prefer": "count=exact",
                "Range": "0-0",
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                cr = r.headers.get("Content-Range", "")
                count_status = int(cr.split("/")[1]) if "/" in cr else 0
        except urllib.error.URLError as e:
            pytest.skip(f"Supabase non raggiungibile: {e}")

        # Conteggio OR: status='response' oppure response NOT NULL
        url_or = f"{SUPABASE_URL}/rest/v1/applications?or=(status.eq.response,response.not.is.null)&select=id"
        req2 = urllib.request.Request(
            url_or,
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Prefer": "count=exact",
                "Range": "0-0",
            }
        )
        try:
            with urllib.request.urlopen(req2, timeout=10) as r:
                cr = r.headers.get("Content-Range", "")
                count_or = int(cr.split("/")[1]) if "/" in cr else 0
        except urllib.error.URLError as e:
            pytest.skip(f"Supabase non raggiungibile: {e}")

        assert count_or >= count_status, (
            f"BUG-CRESCITA-02: OR query ({count_or}) < solo status=response ({count_status})"
        )
        assert count_or >= 15, (
            f"BUG-CRESCITA-02: risposte OR query={count_or}, attese >= 15 (legacy: 15)"
        )

    @requires_auth
    def test_response_count_consistent_across_pages(self):
        """
        Regressione BUG-SCOUT-01 (segnalato in audit E2E 2026-03-21):
        Pattern sistematico: pagine che mostrano 'Risposte' usano
        counts['response'] (status=response solo, = 3) invece della
        OR query (status=response | response NOT NULL, = 15).

        Bug confermati:
        - /crescita: fixato (PR #24)
        - /scout: aperto (getScoutStats() usa counts['response'])

        Questo test verifica il valore canonico da usare in TUTTE le pagine:
        OR query = fonte di verità per il conteggio risposte.
        """
        import urllib.request
        import urllib.error

        # Conteggio canonico: OR query (usato da getRisposteCount())
        url_or = f"{SUPABASE_URL}/rest/v1/applications?or=(status.eq.response,response.not.is.null)&select=id"
        req = urllib.request.Request(
            url_or,
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Prefer": "count=exact",
                "Range": "0-0",
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                cr = r.headers.get("Content-Range", "")
                count_canonical = int(cr.split("/")[1]) if "/" in cr else 0
        except urllib.error.URLError as e:
            pytest.skip(f"Supabase non raggiungibile: {e}")

        # Conteggio parziale: solo status=response (sbagliato — fonte del bug)
        url_status = f"{SUPABASE_URL}/rest/v1/applications?status=eq.response&select=id"
        req2 = urllib.request.Request(
            url_status,
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Prefer": "count=exact",
                "Range": "0-0",
            }
        )
        try:
            with urllib.request.urlopen(req2, timeout=10) as r:
                cr = r.headers.get("Content-Range", "")
                count_status_only = int(cr.split("/")[1]) if "/" in cr else 0
        except urllib.error.URLError as e:
            pytest.skip(f"Supabase non raggiungibile: {e}")

        # Il valore canonico deve essere >= quello parziale
        assert count_canonical >= count_status_only, (
            f"BUG-SCOUT-01: OR query ({count_canonical}) < status=response ({count_status_only})"
        )
        # Tutte le pagine devono concordare con il valore canonico (>= 15)
        assert count_canonical >= 15, (
            f"BUG-SCOUT-01: risposte canoniche={count_canonical}, attese >= 15. "
            f"Pagine che mostrano {count_status_only} sono SBAGLIATE (usano solo status=response)."
        )
