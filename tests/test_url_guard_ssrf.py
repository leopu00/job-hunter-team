"""Il canale email non deve poter far bussare lo Scout dentro la rete.

La barriera d'ingresso di quel canale e' conoscere l'indirizzo della casella,
e chi scrive la mail sceglie l'URL. A scaricarlo e' lo Scout, da dentro il
container, dove `192.168.x`, `127.0.0.1` e l'endpoint dei metadati su
`169.254.169.254` esistono e la rete pubblica non li vede.

Qui si prova la meta' deterministica della difesa — quella che non chiede a un
modello di riconoscere un indirizzo interno. Nessuna prova end-to-end con un
agente vero contro dati ostili: le nostre regole non la permettono, e non
servirebbe, perche' quello che conta e' che l'URL non venga nemmeno emesso e
che, se un redirect ci prova, il fetch si fermi.
"""

import importlib.util
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = ROOT / "shared" / "skills"


def _load(name):
    """Caricato con il suo nome in `sys.modules`, non solo dal file.

    `safe_fetch` fa `from url_guard import ...`: senza registrarlo qui, quello
    import ricaricherebbe il file una seconda volta e `UrlRejected` sarebbe due
    classi diverse — `pytest.raises` non prenderebbe l'eccezione giusta e i test
    del redirect fallirebbero pur essendo il codice corretto.
    """
    if name in sys.modules:
        return sys.modules[name]
    sys.path.insert(0, str(SKILLS_DIR))
    spec = importlib.util.spec_from_file_location(name, SKILLS_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


url_guard = _load("url_guard")
safe_fetch = _load("safe_fetch")
email_monitor = _load("email_monitor")


# Gli indirizzi che dal container si raggiungono e da fuori no, scritti nei
# modi in cui `curl` li accetta: decimale, esadecimale, ottetti mancanti,
# IPv4 mappato in IPv6. `ipaddress` ne riconosce solo due — gli altri
# passerebbero per nomi.
INTERNAL_URLS = [
    "http://192.168.1.1/jobs",
    "http://10.0.0.5/careers",
    "http://172.16.0.9/vacancies",
    "http://127.0.0.1:3000/api/positions",
    "http://169.254.169.254/latest/meta-data/?job=1",
    "http://[::1]/jobs",
    "http://[::ffff:127.0.0.1]/jobs",
    "http://localhost/jobs",
    "http://jobs.localhost/apply",
    "http://careers.internal/jobs",
    "http://board.local/jobs",
    "http://intranet/jobs",
    "http://2130706433/jobs",
    "http://0x7f.0.0.1/jobs",
    "http://127.1/jobs",
    "http://good.example.com@192.168.1.1/jobs",
    # Il punto finale e' la radice del DNS scritta per esteso: per `getaddrinfo`
    # e' lo stesso nome, per `endswith` e per l'ultima etichetta no.
    "http://localhost./jobs",
    "http://db.internal./jobs",
    "http://127.0.0.1./jobs",
    "http://./jobs",
]

PUBLIC_URLS = [
    "https://boards.greenhouse.io/acme/jobs/4381470286",
    "https://www.linkedin.com/jobs/view/4381470286",
    "https://jobs.example.co.uk/vacancy/1",
    "https://acme.workable.com/j/ABC123",
    "http://abc.de/jobs",
    # Un punto finale su un dominio vero e' legittimo — e' la stessa pagina:
    # il filtro lo normalizza, non lo rifiuta.
    "https://boards.greenhouse.io./acme/jobs/1",
]


@pytest.mark.parametrize("url", INTERNAL_URLS)
def test_an_address_inside_the_network_is_refused(url):
    assert url_guard.rejection_reason(url) is not None, url


@pytest.mark.parametrize("url", PUBLIC_URLS)
def test_a_real_job_url_still_goes_through(url):
    # Il costo di un filtro e' quello che blocca per sbaglio: se questi non
    # passano, il canale email smette di funzionare e nessuno lo collega al
    # filtro.
    assert url_guard.rejection_reason(url) is None, url


@pytest.mark.parametrize(
    "url", ["file:///etc/passwd", "gopher://x/jobs", "ftp://host/jobs", "//host/jobs"]
)
def test_only_http_and_https_are_fetchable(url):
    assert url_guard.rejection_reason(url) is not None, url


# ── L'estrattore: quello che l'email riesce a far uscire ────────────────


HOSTILE_EMAIL = """
<html><body>
  <a href="http://192.168.1.1/jobs">Backend Engineer</a>
  <a href="http://169.254.169.254/latest/meta-data/?job=1">Careers</a>
  <a href="http://127.0.0.1:3000/api/positions">Apply now</a>
  <a href="http://localhost/careers">Open vacancy</a>
  <a href="http://0x7f.0.0.1/jobs">Job offer</a>
  <a href="https://boards.greenhouse.io/acme/jobs/123">Real job</a>
</body></html>
"""


def test_a_hostile_email_yields_nothing_that_points_inside():
    jobs = email_monitor._extract_generic(HOSTILE_EMAIL, "evil.tld")

    assert [j["url"] for j in jobs] == [
        "https://boards.greenhouse.io/acme/jobs/123"
    ]


def test_the_known_sender_branch_still_rebuilds_the_url():
    """La difesa che c'era gia' non va indebolita.

    Nel ramo dei mittenti noti l'URL non viene copiato dalla mail: viene
    ricostruito dal codice a partire dall'id. Il filtro nuovo non deve
    toglierlo di mezzo — e non deve nemmeno lasciar passare l'URL interno che
    sta nella stessa mail.
    """
    body = (
        "https://www.linkedin.com/comm/jobs/view/4381470286?trk=eml-x "
        "and also http://169.254.169.254/latest/meta-data/?job=1"
    )

    jobs = email_monitor._extract_jobs(body, "jobs-listings@linkedin.com")

    assert jobs == [
        {
            "url": "https://www.linkedin.com/jobs/view/4381470286",
            "source": "linkedin-email",
            "job_id": "4381470286",
        }
    ]


# ── Il fetch: il redirect e' un secondo URL, e va controllato uguale ────


def public_resolver(host, port):
    """Un DNS che risponde sempre lo stesso indirizzo.

    E' della rete di documentazione (RFC 5737) perche' nel repo pubblico non
    entrano indirizzi veri: qui non viene giudicato — a giudicare e' il
    resolver, e questo lo sostituisce — viene solo passato al finto `hop`.
    """
    return "192.0.2.7"


def chain(hops):
    """Un `hop` finto che percorre la catena data. Nessuna rete, nessun server."""
    seen = []

    def hop(url, address):
        seen.append(url)
        status, location = hops.get(url, (200, ""))
        return status, location, b"<html>ok</html>"

    hop.seen = seen
    return hop


def test_a_redirect_towards_the_metadata_endpoint_stops_the_fetch():
    hop = chain(
        {
            "https://jobs.example.com/1": (302, "http://169.254.169.254/latest/"),
        }
    )

    with pytest.raises(url_guard.UrlRejected) as refused:
        safe_fetch.walk("https://jobs.example.com/1", hop=hop, resolve=public_resolver)

    assert "internal address" in str(refused.value)
    # Il primo salto e' stato fatto, il secondo no: e' esattamente la
    # differenza fra controllare l'URL di partenza e controllare la catena.
    assert hop.seen == ["https://jobs.example.com/1"]


def test_a_relative_redirect_is_resolved_before_being_judged():
    hop = chain(
        {
            "https://jobs.example.com/1": (301, "/2"),
            "https://jobs.example.com/2": (200, ""),
        }
    )

    status, final_url, body = safe_fetch.walk(
        "https://jobs.example.com/1", hop=hop, resolve=public_resolver
    )

    assert (status, final_url) == (200, "https://jobs.example.com/2")
    assert body == b"<html>ok</html>"


def test_a_name_that_resolves_inside_the_network_is_refused():
    """Il guard non puo' saperlo: lo dice il DNS, e lo dice al fetch."""

    def rebinding_resolver(host, port):
        return safe_fetch.resolve_public_address(host, port)

    monkey = {"infos": [(0, 0, 0, "", ("127.0.0.1", 80))]}
    original = safe_fetch.socket.getaddrinfo
    safe_fetch.socket.getaddrinfo = lambda *a, **k: monkey["infos"]
    try:
        with pytest.raises(url_guard.UrlRejected) as refused:
            safe_fetch.walk(
                "https://jobs.example.com/1",
                hop=chain({}),
                resolve=rebinding_resolver,
            )
    finally:
        safe_fetch.socket.getaddrinfo = original

    assert "internal address" in str(refused.value)


def test_a_redirect_loop_ends_instead_of_spinning():
    hop = chain(
        {
            "https://jobs.example.com/1": (302, "https://jobs.example.com/2"),
            "https://jobs.example.com/2": (302, "https://jobs.example.com/1"),
        }
    )

    with pytest.raises(url_guard.UrlRejected) as refused:
        safe_fetch.walk("https://jobs.example.com/1", hop=hop, resolve=public_resolver)

    assert "redirects" in str(refused.value)


def test_curl_is_told_not_to_follow_and_which_address_to_use(monkeypatch):
    """`--resolve` non e' un dettaglio: e' quello che chiude il rebinding.

    Fra il controllo dell'indirizzo e la richiesta c'e' una seconda
    risoluzione, e senza inchiodarla puo' rispondere un'altra cosa. E
    `--max-redirs 0` deve restare: se `curl` seguisse i redirect da solo, la
    catena la percorrerebbe lui, senza controlli.
    """
    captured = {}

    class Result:
        returncode = 0
        stdout = b"<html>ok</html>\n200 "
        stderr = b""

    def fake_run(command, **kwargs):
        captured["command"] = command
        return Result()

    monkeypatch.setattr(safe_fetch.subprocess, "run", fake_run)

    safe_fetch.curl_hop("https://jobs.example.com/1", "192.0.2.7")

    command = captured["command"]
    assert "--resolve" in command
    assert command[command.index("--resolve") + 1] == (
        "jobs.example.com:443:192.0.2.7"
    )
    assert command[command.index("--max-redirs") + 1] == "0"
    assert command[command.index("--proto") + 1] == "=http,https"
    assert command[command.index("--proto-redir") + 1] == "=http,https"


def test_the_skills_no_longer_reach_the_network_with_bare_curl():
    """Il comando documentato E il permesso, non solo il comando.

    Una skill che spiega `safe_fetch.py` ma tiene `Bash(curl *)` fra gli
    allowed-tools lascia aperta la strada vecchia: la difesa tornerebbe a
    dipendere da cosa si ricorda l'agente.
    """
    for skill in ("position-insert", "application-flow"):
        for path in sorted((ROOT / "agents" / "_skills" / skill).glob("SKILL*.md")):
            text = path.read_text(encoding="utf-8")
            assert "Bash(curl" not in text, path
            assert "curl -s -L" not in text, path
            assert "safe_fetch.py" in text, path
