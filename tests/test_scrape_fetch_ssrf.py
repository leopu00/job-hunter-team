"""#179 — logo_fetch e web_scrape_robust non devono bussare dentro la rete.

#169 ha chiuso il canale email: un guard che rifiuta gli indirizzi interni e
un fetcher che percorre i redirect un salto per volta. Questi due moduli
facevano la stessa cosa senza nessuno dei due controlli, e `logo_fetch` e' il
piu' esposto perche' il sito glielo da' la colonna `companies.website`, cioe'
un valore che arriva da un annuncio scrapato: l'indirizzo lo sceglie chi ha
pubblicato l'annuncio.

Qui non si monta un server: si prova la DECISIONE. Il guard e il fetcher sono
quelli veri — a essere finti sono la rete (`requests.get`, l'hop di `curl`) e
il resolver, perche' e' l'unico modo di percorrere una catena di redirect
ostile senza uscire dalla macchina.

`allow_redirects=True` e' il difetto che questi test presidiano: con quello la
destinazione finale la sceglieva il server remoto, quindi controllare l'URL di
partenza non diceva niente su dove si finiva.

Eseguire:
    pytest tests/test_scrape_fetch_ssrf.py -v
"""

import importlib.util
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = ROOT / "shared" / "skills"

# Rete di documentazione (RFC 5737), come in test_url_guard_ssrf: nel repo
# pubblico non entrano indirizzi veri. Qui non viene giudicato — a giudicare
# sarebbe il resolver, e in questi test il resolver e' finto: viene solo
# passato all'`hop`, anch'esso finto.
PUBLIC_ADDRESS = "192.0.2.7"


def _load(name):
    """Come in test_url_guard_ssrf: registrato in `sys.modules` col suo nome.

    `safe_fetch` fa `from url_guard import ...` e i moduli delle skill fanno
    lo stesso fra loro: senza registrarli, `UrlRejected` diventa due classi
    diverse e `pytest.raises` non prende l'eccezione giusta.
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


@pytest.fixture
def logo_fetch(tmp_path, monkeypatch):
    """Il modulo con un database vuoto suo: `_db` risolve il path all'import."""
    monkeypatch.setenv("JHT_DB", str(tmp_path / "jobs.db"))
    monkeypatch.delenv("JHT_HOME", raising=False)
    for name in ("_db", "enrichment_policy", "logo_fetch"):
        sys.modules.pop(name, None)
    return _load("logo_fetch")


@pytest.fixture
def scraper():
    return _load("web_scrape_robust")


def chain(hops):
    """Un `hop` finto: `{url: (status, location)}`, e ricorda cosa ha visitato.

    Quello che i test guardano non e' il corpo restituito ma **quali URL sono
    stati chiesti**: fermarsi prima del salto interno e' la differenza fra
    controllare la partenza e controllare la catena.
    """
    seen = []

    def hop(url, address):
        seen.append(url)
        status, location = hops.get(url, (200, ""))
        return status, location, b"\x89PNG\r\n\x1a\n" + b"x" * 400

    hop.seen = seen
    return hop


def public_resolver(host, port):
    return PUBLIC_ADDRESS


def walking(hop):
    """`safe_walk` con la rete finta ma il guard vero."""
    return lambda url: safe_fetch.walk(url, hop=hop, resolve=public_resolver)


# ── logo_fetch: il sito lo sceglie chi ha pubblicato l'annuncio ─────────

INTERNAL_WEBSITES = [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:3000/",
    "http://192.168.1.1/",
    "http://localhost/",
    "http://intranet/",
    "http://2130706433/",
]


@pytest.mark.parametrize("url", INTERNAL_WEBSITES)
def test_logo_fetch_non_scarica_da_un_indirizzo_interno(logo_fetch, monkeypatch, url):
    hop = chain({})
    monkeypatch.setattr(logo_fetch, "safe_walk", walking(hop))

    assert logo_fetch.fetch_bytes(url, logo_fetch.MAX_LOGO_BYTES) is None
    # E non ci ha nemmeno provato: la richiesta non parte.
    assert hop.seen == []


def test_logo_fetch_un_redirect_verso_i_metadati_ferma_il_download(
    logo_fetch, monkeypatch
):
    """Il caso che `allow_redirects=True` lasciava passare: partenza pubblica,
    arrivo scelto dal server remoto."""
    hop = chain(
        {"https://acme.example.com/logo.png": (302, "http://169.254.169.254/latest/")}
    )
    monkeypatch.setattr(logo_fetch, "safe_walk", walking(hop))

    assert (
        logo_fetch.fetch_bytes(
            "https://acme.example.com/logo.png", logo_fetch.MAX_LOGO_BYTES
        )
        is None
    )
    # Il primo salto e' partito, il secondo no.
    assert hop.seen == ["https://acme.example.com/logo.png"]


def test_logo_fetch_un_logo_vero_passa_ancora(logo_fetch, monkeypatch):
    # Il costo di un filtro e' quello che blocca per sbaglio: se un sito
    # normale smette di funzionare, la feature muore e nessuno la collega
    # al guard.
    hop = chain({})
    monkeypatch.setattr(logo_fetch, "safe_walk", walking(hop))

    data = logo_fetch.fetch_bytes(
        "https://acme.example.com/apple-touch-icon.png", logo_fetch.MAX_LOGO_BYTES
    )

    assert data is not None and data.startswith(b"\x89PNG")
    assert hop.seen == ["https://acme.example.com/apple-touch-icon.png"]


def test_il_website_della_riga_companies_e_giudicato_prima_di_ogni_tentativo(
    logo_fetch, monkeypatch
):
    """Il percorso che il ticket chiede: il valore arriva dal database, dove
    l'ha messo un annuncio scrapato.

    `URL_REFUSED` e non `NO_CANDIDATE`: «non si scarica» e «non ha un logo»
    portano l'agente a fare due cose diverse — col secondo riproverebbe domani.
    """
    conn = logo_fetch.get_db()
    logo_fetch.ensure_schema(conn)
    conn.execute(
        "INSERT INTO companies (name, website) VALUES (?, ?)",
        ("Acme", "http://169.254.169.254/"),
    )
    conn.commit()
    conn.close()
    hop = chain({})
    monkeypatch.setattr(logo_fetch, "safe_walk", walking(hop))

    result = logo_fetch.run(
        _args(company="Acme", website=None, from_url=None, force=True)
    )

    assert result["status_code"] == "URL_REFUSED"
    assert result["ok"] is False
    assert hop.seen == []


def test_un_sito_senza_schema_viene_normalizzato_non_rifiutato(logo_fetch):
    """`companies.website` spesso e' `wizzair.com`: senza schema non c'e' URL
    da giudicare, e giudicarlo prima della normalizzazione lo rifiuterebbe per
    il motivo sbagliato."""
    assert logo_fetch.refusal(logo_fetch.with_scheme("wizzair.com")) is None
    assert logo_fetch.refusal(logo_fetch.with_scheme("127.0.0.1")) is not None


class _args:  # noqa: N801 — sta al posto di argparse.Namespace, e si legge meglio
    def __init__(self, **kwargs):
        self.company = kwargs.get("company")
        self.website = kwargs.get("website")
        self.from_url = kwargs.get("from_url")
        self.force = kwargs.get("force", False)
        self.mark_attempted = kwargs.get("mark_attempted", False)
        self.dry_run = kwargs.get("dry_run", True)


# ── web_scrape_robust: il guard prima dei livelli, non dentro uno ───────


def test_lo_scraper_rifiuta_prima_di_qualunque_livello(scraper, monkeypatch):
    """I livelli 2 e 3 navigano con Playwright, che e' un browser vero: se il
    controllo stesse solo nel livello 1, basterebbe `--level 2` per saltarlo."""
    eseguiti = []
    for level in (1, 2, 3):
        monkeypatch.setattr(
            scraper,
            f"fetch_level{level}",
            lambda *a, _l=level, **k: eseguiti.append(_l),
        )

    result = scraper.fetch("http://169.254.169.254/latest/meta-data/")

    assert result["refused"] is True
    assert result["blocked"] is True
    assert result["status"] == 0
    assert eseguiti == []


def test_lo_scraper_livello1_ricontrolla_ogni_redirect(scraper, monkeypatch):
    """Il difetto era `requests.get(..., allow_redirects=True)`: la libreria
    percorreva la catena da sola, e nessuno guardava dove finiva."""
    visitati = []

    class _Response:
        def __init__(self, status, location):
            self.status_code = status
            self.headers = {"Location": location} if location else {}
            self.content = b"<html>ok</html>"

    catena = {
        "https://boards.example.com/1": (302, "http://192.168.1.1/internal"),
    }

    def fake_get(url, **kwargs):
        visitati.append(url)
        assert kwargs.get("allow_redirects") is False, (
            "il livello 1 deve fare UN salto per volta: i redirect li percorre "
            "safe_fetch, ricontrollandoli"
        )
        return _Response(*catena.get(url, (200, "")))

    monkeypatch.setattr(_requests(), "get", fake_get)
    # Il resolver e' finto, il guard no: qui si prova che ogni salto ripassa
    # dal controllo, non che `getaddrinfo` funzioni.
    monkeypatch.setattr(scraper, "safe_walk", _walk_with_fake_dns())

    result = scraper.fetch_level1("https://boards.example.com/1")

    assert result["status"] == 0 and result["blocked"] is True
    assert "internal address" in result["error"]
    assert visitati == ["https://boards.example.com/1"]


def test_lo_scraper_una_pagina_pubblica_arriva_ancora(scraper, monkeypatch):
    class _Response:
        status_code = 200
        headers: dict = {}
        content = b"<html><title>Backend Engineer</title></html>"

    monkeypatch.setattr(_requests(), "get", lambda url, **k: _Response())
    monkeypatch.setattr(scraper, "safe_walk", _walk_with_fake_dns())

    result = scraper.fetch_level1("https://boards.example.com/1")

    assert result["status"] == 200
    assert result["blocked"] is False
    assert "Backend Engineer" in result["html"]
    assert result["url_final"] == "https://boards.example.com/1"


def _requests():
    import requests

    return requests


def _walk_with_fake_dns():
    """`safe_walk` col guard vero e il DNS finto.

    Il default di `resolve` e' legato alla definizione di `walk`, quindi
    sostituire `resolve_public_address` nel modulo non basterebbe: si passa
    dal parametro, che e' li' per questo.
    """

    def walk(url, hop):
        return safe_fetch.walk(url, hop=hop, resolve=public_resolver)

    return walk


def test_lo_user_agent_richiesto_da_nominatim_arriva_a_curl(monkeypatch):
    """#176: senza questo, office-geocoding resterebbe su `curl` nudo.

    Nominatim pretende un User-Agent che identifichi il chiamante e rifiuta
    quelli generici. Un fetcher condiviso che quelle skill non possono usare
    non e' condiviso: sarebbero tornate al comando di prima, che i redirect
    non li controlla.
    """
    catturato = {}

    class _Result:
        returncode = 0
        stdout = b"{}\n200 "
        stderr = b""

    def fake_run(command, **kwargs):
        catturato["command"] = command
        return _Result()

    monkeypatch.setattr(safe_fetch.subprocess, "run", fake_run)
    monkeypatch.setattr(safe_fetch.socket, "getaddrinfo", _resolves(PUBLIC_ADDRESS))
    # La rete di documentazione non e' `is_global`, e qui l'indirizzo fa da
    # indirizzo pubblico finto: cio' che si prova e' l'User-Agent, e nel repo
    # pubblico un indirizzo vero non entra. Il giudizio sugli indirizzi ha i
    # suoi test, in test_url_guard_ssrf.
    monkeypatch.setattr(
        safe_fetch, "address_is_reachable_from_outside", lambda address: True
    )

    exit_code = safe_fetch.main(
        [
            "--user-agent",
            "jht-analyst/1.0 (+https://github.com/leopu00/job-hunter-team)",
            "https://nominatim.openstreetmap.org/search?q=roma&format=json",
        ]
    )

    command = catturato["command"]
    assert exit_code == 0
    assert command[command.index("--user-agent") + 1] == (
        "jht-analyst/1.0 (+https://github.com/leopu00/job-hunter-team)"
    )
    # E il resto della difesa resta dov'era: un UA su misura non e' il permesso
    # di seguire i redirect da soli.
    assert command[command.index("--max-redirs") + 1] == "0"
    assert "--resolve" in command


def _resolves(address):
    return lambda host, port, **kwargs: [(0, 0, 0, "", (address, port))]


def test_nessuno_dei_due_moduli_segue_piu_i_redirect_da_solo():
    """La chiamata, non la parola: l'AST invece di un grep.

    Una `requests.get` che segue i redirect da sola rimette la catena in mano
    alla libreria, e il controllo torna a valere solo per l'URL di partenza —
    il difetto di #179. Cercarlo nel testo pescherebbe anche i commenti che lo
    raccontano (questi file ne hanno), quindi qui si guardano le chiamate vere.
    """
    import ast

    for name in ("logo_fetch.py", "web_scrape_robust.py"):
        tree = ast.parse((SKILLS_DIR / name).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if not (
                isinstance(func, ast.Attribute)
                and isinstance(func.value, ast.Name)
                and func.value.id == "requests"
            ):
                continue
            follows = [
                kw.value
                for kw in node.keywords
                if kw.arg == "allow_redirects"
            ]
            assert follows, f"{name}: requests.{func.attr} senza allow_redirects"
            assert all(
                isinstance(value, ast.Constant) and value.value is False
                for value in follows
            ), f"{name}: requests.{func.attr} segue ancora i redirect da solo"
