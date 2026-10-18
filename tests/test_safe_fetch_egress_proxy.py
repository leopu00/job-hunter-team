"""safe_fetch behind the JHT egress proxy (Podman on Windows).

There the agents' container has no DNS (pasta `--no-udp`): `getaddrinfo`
always fails, and safe_fetch refused every URL, which blocked every skill
that reads a job posting. Behind that proxy the resolution and the address
check are the proxy's (`scripts/wsl-interop-connect-proxy.py`); safe_fetch
keeps scheme, name, written addresses and port, and sends through it.

The skip is allowed only for the ATTESTED proxy: `JHT_EGRESS_PROXY` is
`http://127.0.0.1:<port>` and `http_proxy`/`https_proxy` say exactly that.
Any other proxy value keeps today's path (resolve, check, `--resolve`): a
tampered variable must not turn the skip into SSRF. A host in `NO_PROXY`
does not go through the proxy, so it stays refused as today.

The last tests run the real `curl` against a fake proxy on loopback: its
`403` must become a refusal (exit 1) and never a site's 403, its `502` a
network error (exit 2). No request leaves the machine.
"""

from __future__ import annotations

import importlib.util
import shutil
import socket
import sys
import threading
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = ROOT / "shared" / "skills"
COMPOSE = ROOT / "docker-compose.podman.yml"
PROXY_VARS = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
              "http_proxy", "https_proxy", "all_proxy", "no_proxy",
              "JHT_EGRESS_PROXY")


def _load(name):
    """Registered in `sys.modules` under its name, as in test_url_guard_ssrf:
    otherwise `UrlRejected` becomes two different classes."""
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


@pytest.fixture(autouse=True)
def clean_proxy_env(monkeypatch):
    for name in PROXY_VARS:
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def dns(monkeypatch):
    """The resolver, recorded. A documentation address (RFC 5737), declared
    public as in test_scrape_fetch_ssrf: no real address enters the repo."""
    calls = []

    def getaddrinfo(host, port, *args, **kwargs):
        calls.append(host)
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("192.0.2.7", port))]

    monkeypatch.setattr(safe_fetch.socket, "getaddrinfo", getaddrinfo)
    monkeypatch.setattr(safe_fetch, "address_is_reachable_from_outside",
                        lambda address: address == "192.0.2.7")
    return calls


@pytest.fixture
def no_dns(monkeypatch):
    """The container behind the egress proxy: every resolution fails."""
    calls = []

    def getaddrinfo(host, *args, **kwargs):
        calls.append(host)
        raise socket.gaierror(socket.EAI_AGAIN, "Temporary failure in name resolution")

    monkeypatch.setattr(safe_fetch.socket, "getaddrinfo", getaddrinfo)
    return calls


def _egress(monkeypatch, proxy="http://127.0.0.1:3128", attested=None,
            no_proxy="localhost,127.0.0.1,::1,host.docker.internal,host.containers.internal"):
    """The environment of docker-compose.podman.yml."""
    monkeypatch.setenv("JHT_EGRESS_PROXY", attested if attested is not None else proxy)
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        monkeypatch.setenv(name, proxy)
    monkeypatch.setenv("NO_PROXY", no_proxy)
    monkeypatch.setenv("no_proxy", no_proxy)


# ── Without the attested proxy: nothing changes ──────────────────────


def test_without_a_proxy_the_name_is_resolved_and_pinned(dns, monkeypatch):
    captured = {}

    def run(command, **kwargs):
        captured["command"], captured["env"] = command, kwargs.get("env")
        return _completed(b"<html>ok</html>\n200 000 ")

    monkeypatch.setattr(safe_fetch.subprocess, "run", run)

    status, final_url, body = safe_fetch.walk("https://jobs.example.com/1")

    assert (status, final_url, body) == (200, "https://jobs.example.com/1", b"<html>ok</html>")
    assert dns == ["jobs.example.com"]
    assert "--resolve" in captured["command"]
    assert "jobs.example.com:443:192.0.2.7" in captured["command"]
    assert "--proxy" not in captured["command"]
    assert captured["env"] is None


@pytest.mark.parametrize(
    "case",
    [
        # A proxy nobody attested: a corporate one, or a tampered variable.
        {"proxy": "http://127.0.0.1:3128", "attested": ""},
        # The attestation names a proxy, the variables another one.
        {"proxy": "http://127.0.0.1:3129", "attested": "http://127.0.0.1:3128"},
        # Not on loopback: the namespace's only way out is 127.0.0.1.
        {"proxy": "http://192.0.2.7:3128", "attested": "http://192.0.2.7:3128"},
        {"proxy": "http://localhost:3128", "attested": "http://localhost:3128"},
        # Not plain HTTP, or with userinfo or a path: not the JHT proxy.
        {"proxy": "https://127.0.0.1:3128", "attested": "https://127.0.0.1:3128"},
        {"proxy": "http://u:p@127.0.0.1:3128", "attested": "http://u:p@127.0.0.1:3128"},
        {"proxy": "http://127.0.0.1:3128/x", "attested": "http://127.0.0.1:3128/x"},
        {"proxy": "http://127.0.0.1", "attested": "http://127.0.0.1"},
    ],
    ids=["unattested", "mismatch", "not-loopback", "name-not-address",
         "https-scheme", "userinfo", "path", "no-port"],
)
def test_a_proxy_that_is_not_the_attested_one_keeps_the_resolution(dns, monkeypatch, case):
    _egress(monkeypatch, **case)

    assert safe_fetch.egress_proxy_for("jobs.example.com") is None
    if case["attested"] != "http://127.0.0.1:3128":
        # Refused by the attestation itself, not only by the comparison.
        assert safe_fetch._attested_egress_proxy() is None
    assert safe_fetch.resolve_public_address("jobs.example.com", 443) == "192.0.2.7"
    assert dns == ["jobs.example.com"]


def test_only_https_proxy_attested_is_not_enough(dns, monkeypatch):
    _egress(monkeypatch)
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9999")
    monkeypatch.setenv("http_proxy", "http://127.0.0.1:9999")

    assert safe_fetch.egress_proxy_for("jobs.example.com") is None


def test_a_name_resolving_inside_is_still_refused_without_the_proxy(monkeypatch):
    monkeypatch.setattr(
        safe_fetch.socket, "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", 443))],
    )
    _egress(monkeypatch, attested="")

    with pytest.raises(url_guard.UrlRejected, match="internal address"):
        safe_fetch.resolve_public_address("jobs.example.com", 443)


# ── Behind the attested proxy ─────────────────────────────────────────


def test_behind_the_attested_proxy_nothing_is_resolved_locally(no_dns, monkeypatch):
    _egress(monkeypatch)

    assert safe_fetch.egress_proxy_for("jobs.example.com") == "http://127.0.0.1:3128"
    assert safe_fetch.resolve_public_address("jobs.example.com", 443) is None
    assert safe_fetch.resolve_public_address("jobs.example.com", 80) is None
    assert no_dns == []


def test_the_compose_attests_the_proxy_the_wrapper_sets():
    """The marker must exist where the proxy is configured, or the mode never runs."""
    text = COMPOSE.read_text(encoding="utf-8")
    jht = text.split("\n  jht:\n", 1)[1].split("\n  jht-broker:\n", 1)[0]

    assert "      - JHT_EGRESS_PROXY=http://127.0.0.1:3128\n" in jht
    assert '"pasta:--no-udp,--no-icmp,--no-map-gw,-4,-o,127.0.0.1,-T,3128"' in jht
    wrapper = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8")
    assert "else { 'http://127.0.0.1:3128' }" in wrapper


@pytest.mark.parametrize("port", [22, 25, 3128, 5432, 6081, 8080, 8443])
def test_behind_the_proxy_a_port_outside_its_policy_is_refused_here(no_dns, monkeypatch, port):
    _egress(monkeypatch)

    with pytest.raises(url_guard.UrlRejected, match=f"port {port} not allowed"):
        safe_fetch.walk(f"https://jobs.example.com:{port}/1", hop=_never)
    assert no_dns == []


@pytest.mark.parametrize(
    "url, reason",
    [
        ("http://localhost/jobs", "internal name"),
        ("http://printer.local/jobs", "internal name"),
        ("http://db.internal/jobs", "internal name"),
        ("http://127.0.0.1/jobs", "internal address"),
        ("http://169.254.169.254/latest/", "internal address"),
        ("http://192.168.1.1/", "internal address"),
        ("http://[::1]/", "internal address"),
        ("http://0x7f.0.0.1/", "canonical form"),
        ("ftp://jobs.example.com/", "scheme not allowed"),
        ("file:///etc/passwd", "scheme not allowed"),
    ],
)
def test_behind_the_proxy_names_and_written_addresses_are_still_checked_here(
    no_dns, monkeypatch, url, reason
):
    _egress(monkeypatch)

    with pytest.raises(url_guard.UrlRejected, match=reason):
        safe_fetch.walk(url, hop=_never)


def test_a_host_in_no_proxy_does_not_take_the_proxy_and_stays_refused(no_dns, monkeypatch):
    """NO_PROXY means: not through the proxy. Then it is the old path, and
    without DNS it fails closed, as today."""
    _egress(monkeypatch, no_proxy="localhost,127.0.0.1,jobs.example.com")

    with pytest.raises(url_guard.UrlRejected, match="does not resolve"):
        safe_fetch.walk("https://jobs.example.com/1", hop=_never)
    assert no_dns == ["jobs.example.com"]


def test_every_redirect_hop_is_checked_behind_the_proxy(no_dns, monkeypatch):
    _egress(monkeypatch)
    seen = []

    def hop(url, address):
        seen.append((url, address))
        return 302, "http://169.254.169.254/latest/", b""

    with pytest.raises(url_guard.UrlRejected, match="internal address"):
        safe_fetch.walk("https://jobs.example.com/1", hop=hop)
    assert seen == [("https://jobs.example.com/1", None)]


def test_curl_goes_to_the_proxy_with_a_tunnel_and_no_pinning(no_dns, monkeypatch):
    _egress(monkeypatch)
    monkeypatch.setenv("ALL_PROXY", "http://192.0.2.9:1080")
    captured = {}

    def run(command, **kwargs):
        captured["command"], captured["env"] = command, kwargs.get("env")
        return _completed(b"<html>ok</html>\n200 200 ")

    monkeypatch.setattr(safe_fetch.subprocess, "run", run)

    status, _url, body = safe_fetch.walk("http://jobs.example.com/1")

    command = captured["command"]
    assert (status, body) == (200, b"<html>ok</html>")
    assert command[command.index("--proxy") + 1] == "http://127.0.0.1:3128"
    # A CONNECT for http:// too: otherwise the proxy's 403 would read as the site's.
    assert "--proxytunnel" in command
    assert "--resolve" not in command
    assert "--max-redirs" in command and command[command.index("--max-redirs") + 1] == "0"
    # No proxy variable reaches curl: the route is the command line's alone.
    assert [k for k in captured["env"] if k.lower().endswith("_proxy")] == []


def test_a_hop_without_an_address_and_without_the_proxy_is_refused(dns, monkeypatch):
    monkeypatch.setattr(safe_fetch.subprocess, "run", _never)

    with pytest.raises(url_guard.UrlRejected, match="no verified address"):
        safe_fetch.curl_hop("https://jobs.example.com/1", None)


# ── The real curl against a fake proxy on loopback ────────────────────


class FakeProxy:
    """Answers every CONNECT with `answer`; after a 200, serves one HTTP page."""

    def __init__(self, answer: bytes):
        self.answer = answer
        self.requests: list[str] = []
        self.server = socket.socket()
        self.server.bind(("127.0.0.1", 0))
        self.server.listen()
        self.server.settimeout(0.2)
        self.port = self.server.getsockname()[1]
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._serve, daemon=True)
        self.thread.start()

    def _read_head(self, client) -> str:
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = client.recv(4096)
            if not chunk:
                break
            data += chunk
        return data.split(b"\r\n", 1)[0].decode("ascii", "replace")

    def _serve(self):
        while not self.stop.is_set():
            try:
                client, _ = self.server.accept()
            except OSError:
                continue
            with client:
                client.settimeout(5)
                try:
                    self.requests.append(self._read_head(client))
                    client.sendall(b"HTTP/1.1 " + self.answer + b"\r\nConnection: close\r\n\r\n")
                    if self.answer.startswith(b"200"):
                        self.requests.append(self._read_head(client))
                        client.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 4\r\n"
                                       b"Connection: close\r\n\r\nsite")
                except OSError:
                    pass

    def close(self):
        self.stop.set()
        self.thread.join(timeout=5)
        self.server.close()


@pytest.fixture
def fake_proxy(request, monkeypatch, no_dns):
    proxy = FakeProxy(request.param)
    _egress(monkeypatch, proxy=f"http://127.0.0.1:{proxy.port}")
    yield proxy
    proxy.close()


needs_curl = pytest.mark.skipif(shutil.which("curl") is None, reason="curl non installato")


@needs_curl
@pytest.mark.parametrize("fake_proxy", [b"403 Forbidden"], indirect=True)
def test_the_proxy_refusal_is_a_clear_refusal(fake_proxy, no_dns, capsys):
    code = safe_fetch.main(["http://jobs.example.com/1"])

    assert code == 1
    err = capsys.readouterr().err
    assert "refused by the egress proxy (403)" in err
    assert fake_proxy.requests[0] == "CONNECT jobs.example.com:80 HTTP/1.1"
    assert no_dns == []


@needs_curl
@pytest.mark.parametrize("fake_proxy", [b"502 Bad Gateway"], indirect=True)
def test_a_proxy_that_cannot_reach_the_site_is_a_network_error(fake_proxy, capsys):
    code = safe_fetch.main(["https://jobs.example.com/1"])

    assert code == 2
    assert "egress proxy answered 502" in capsys.readouterr().err
    assert fake_proxy.requests[0] == "CONNECT jobs.example.com:443 HTTP/1.1"


@needs_curl
@pytest.mark.parametrize("fake_proxy", [b"200 Connection Established"], indirect=True)
def test_through_the_tunnel_the_site_answers_and_its_403_stays_the_sites(fake_proxy, capsys):
    """The control: the same 403, from the site, is a page status, not a refusal."""
    code = safe_fetch.main(["--status", "http://jobs.example.com/1"])

    assert code == 0
    assert capsys.readouterr().out.strip() == "HTTP:403 URL_FINALE:http://jobs.example.com/1"
    assert fake_proxy.requests[:2] == ["CONNECT jobs.example.com:80 HTTP/1.1",
                                       "GET /1 HTTP/1.1"]


def _never(*args, **kwargs):
    raise AssertionError("nothing must be sent")


class _completed:
    def __init__(self, stdout: bytes, returncode: int = 0):
        self.stdout, self.stderr, self.returncode = stdout, b"", returncode
