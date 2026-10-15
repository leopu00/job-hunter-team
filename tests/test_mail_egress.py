"""The broker's mail through the egress proxy (shared/skills/mail_egress.py).

On Windows the broker's container has no route out but its egress proxy
(HTTPS_PROXY): IMAP and SMTP must open a CONNECT tunnel through it. Here a
local CONNECT proxy and local mail servers stand in for both ends.
"""

import socket
import sys
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import mail_egress  # noqa: E402


def _listen() -> socket.socket:
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen()
    return server


def _pipe(a: socket.socket, b: socket.socket) -> None:
    try:
        while data := a.recv(65536):
            b.sendall(data)
    except OSError:
        pass
    finally:
        for end in (a, b):
            try:
                end.close()
            except OSError:
                pass


class FakeProxy:
    """A CONNECT proxy that records each request and forwards to `upstream`."""

    def __init__(self, upstream: int, status: bytes = b"200 Connection established"):
        self.requests: list[bytes] = []
        self.server = _listen()
        self.port = self.server.getsockname()[1]
        self.upstream, self.status = upstream, status
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self) -> None:
        while True:
            try:
                client, _ = self.server.accept()
            except OSError:
                return
            request = b""
            while b"\r\n\r\n" not in request:
                request += client.recv(4096)
            self.requests.append(request)
            client.sendall(b"HTTP/1.1 " + self.status + b"\r\n\r\n")
            if not self.status.startswith(b"200"):
                client.close()
                continue
            upstream = socket.create_connection(("127.0.0.1", self.upstream))
            threading.Thread(target=_pipe, args=(client, upstream), daemon=True).start()
            threading.Thread(target=_pipe, args=(upstream, client), daemon=True).start()


def _serve_lines(server: socket.socket, greeting: bytes, answer) -> None:
    def run() -> None:
        conn, _ = server.accept()
        conn.sendall(greeting)
        buffer = b""
        while True:
            data = conn.recv(4096)
            if not data:
                return
            buffer += data
            while b"\r\n" in buffer:
                line, buffer = buffer.split(b"\r\n", 1)
                reply = answer(line)
                if reply is None:
                    conn.close()
                    return
                conn.sendall(reply)

    threading.Thread(target=run, daemon=True).start()


def _smtp_server() -> int:
    server = _listen()

    def answer(line: bytes):
        verb = line.split(b" ", 1)[0].upper()
        if verb in (b"EHLO", b"HELO"):
            return b"250 mail.example.test\r\n"
        if verb == b"QUIT":
            return None
        return b"250 ok\r\n"

    _serve_lines(server, b"220 mail.example.test ready\r\n", answer)
    return server.getsockname()[1]


def _imap_server() -> int:
    server = _listen()

    def answer(line: bytes):
        tag, _, command = line.partition(b" ")
        if command.upper().startswith(b"CAPABILITY"):
            return b"* CAPABILITY IMAP4rev1\r\n" + tag + b" OK done\r\n"
        if command.upper().startswith(b"LOGOUT"):
            return b"* BYE\r\n" + tag + b" OK bye\r\n"
        return tag + b" OK\r\n"

    _serve_lines(server, b"* OK ready\r\n", answer)
    return server.getsockname()[1]


@pytest.fixture
def no_proxy_env(monkeypatch):
    for name in ("HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"):
        monkeypatch.delenv(name, raising=False)


def test_the_proxy_comes_from_https_proxy_and_respects_no_proxy(no_proxy_env, monkeypatch):
    assert mail_egress.proxy_for("imap.example.test") is None
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:3129")
    assert mail_egress.proxy_for("imap.example.test") == ("127.0.0.1", 3129)
    monkeypatch.setenv("NO_PROXY", "imap.example.test")
    assert mail_egress.proxy_for("imap.example.test") is None
    monkeypatch.delenv("NO_PROXY")
    monkeypatch.setenv("HTTPS_PROXY", "socks5://127.0.0.1:1080")
    with pytest.raises(mail_egress.ProxyRefused):
        mail_egress.proxy_for("imap.example.test")


def test_smtp_goes_through_the_tunnel_to_the_mail_server(no_proxy_env, monkeypatch):
    proxy = FakeProxy(upstream=_smtp_server())
    monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{proxy.port}")

    with mail_egress.smtp("smtp.example.test", 587, timeout=5) as smtp:
        code, _ = smtp.ehlo()

    assert code == 250
    assert proxy.requests == [b"CONNECT smtp.example.test:587 HTTP/1.1\r\nHost: smtp.example.test:587\r\n\r\n"]


def test_imap_over_tls_wraps_the_tunnel_for_the_mail_server_name(no_proxy_env, monkeypatch):
    proxy = FakeProxy(upstream=_imap_server())
    monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{proxy.port}")
    wrapped = []

    class RecordingContext:
        # TLS itself is the stdlib's; what matters here is that it is applied
        # to the tunnel, for the mail server's name (not the proxy's).
        def wrap_socket(self, sock, server_hostname):
            wrapped.append(server_hostname)
            return sock

    imap = mail_egress.imap_ssl("imap.example.test", 993, ssl_context=RecordingContext())
    imap.logout()

    assert wrapped == ["imap.example.test"]
    assert proxy.requests == [b"CONNECT imap.example.test:993 HTTP/1.1\r\nHost: imap.example.test:993\r\n\r\n"]


def test_a_refused_tunnel_never_reaches_the_mail_server(no_proxy_env, monkeypatch):
    proxy = FakeProxy(upstream=_smtp_server(), status=b"403 Forbidden")
    monkeypatch.setenv("HTTPS_PROXY", f"http://127.0.0.1:{proxy.port}")

    with pytest.raises(mail_egress.ProxyRefused, match="403"):
        mail_egress.smtp_ssl("smtp.example.test", 465, timeout=5)


def test_without_a_proxy_the_stdlib_classes_are_used_as_before(no_proxy_env, monkeypatch):
    calls = []

    class Recorder:
        def __init__(self, host, port, **kwargs):
            calls.append((host, port))

    monkeypatch.setattr(mail_egress.imaplib, "IMAP4_SSL", Recorder)
    monkeypatch.setattr(mail_egress.smtplib, "SMTP", Recorder)
    monkeypatch.setattr(mail_egress.smtplib, "SMTP_SSL", Recorder)
    mail_egress.imap_ssl("imap.example.test", 993)
    mail_egress.smtp("smtp.example.test", 587)
    mail_egress.smtp_ssl("smtp.example.test", 465)
    assert calls == [("imap.example.test", 993), ("smtp.example.test", 587), ("smtp.example.test", 465)]


def test_the_broker_mail_client_opens_its_connections_through_mail_egress():
    source = (ROOT / "shared" / "skills" / "email_monitor.py").read_text(encoding="utf-8")
    for direct in ("imaplib.IMAP4_SSL(", "smtplib.SMTP(", "smtplib.SMTP_SSL("):
        assert direct not in source, direct
    for routed in ("mail_egress.imap_ssl(", "mail_egress.smtp(", "mail_egress.smtp_ssl("):
        assert routed in source, routed
