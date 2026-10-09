"""mail_egress.py — IMAP and SMTP through the egress proxy, when there is one.

On Windows (Podman in WSL) the broker's container has no route out: its only
way is the VM's egress proxy, an HTTP CONNECT proxy that filters the
destination (docker-compose.podman.yml gives the container HTTPS_PROXY).
imaplib and smtplib ignore proxy variables, so the mail connections open a
CONNECT tunnel through it first, then speak IMAP or SMTP (with TLS end to end
to the mail server) inside it.

Without a proxy in the environment (Mac, Linux, VPS) nothing changes: the
factories return the stdlib classes, looked up at call time.
"""

from __future__ import annotations

import imaplib
import smtplib
import socket
import ssl
import urllib.request
from urllib.parse import urlsplit

MAX_PROXY_REPLY = 16 * 1024


class ProxyRefused(OSError):
    """The proxy did not open the tunnel (its status, never its text)."""


def proxy_for(host: str) -> tuple[str, int] | None:
    """The CONNECT proxy for `host`, from HTTPS_PROXY/https_proxy, or None."""
    proxies = urllib.request.getproxies_environment()
    url = proxies.get("https")
    if not url or urllib.request.proxy_bypass_environment(host, proxies):
        return None
    parts = urlsplit(url if "://" in url else f"http://{url}")
    if parts.scheme != "http" or not parts.hostname:
        raise ProxyRefused("unsupported proxy scheme")
    return parts.hostname, parts.port or 80


def open_tunnel(host: str, port: int, timeout: float | None, proxy: tuple[str, int]) -> socket.socket:
    """A socket connected to host:port through the CONNECT proxy."""
    sock = socket.create_connection(proxy, timeout=timeout)
    try:
        target = f"{host}:{int(port)}"
        sock.sendall(f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n".encode("ascii"))
        reply = b""
        while b"\r\n\r\n" not in reply:
            chunk = sock.recv(1)
            if not chunk or len(reply) >= MAX_PROXY_REPLY:
                raise ProxyRefused("proxy closed the tunnel request")
            reply += chunk
        status = reply.split(b"\r\n", 1)[0].split()
        if len(status) < 2 or not status[0].startswith(b"HTTP/") or status[1] != b"200":
            code = status[1].decode("ascii", "replace") if len(status) > 1 else "?"
            raise ProxyRefused(f"proxy refused the tunnel ({code})")
        return sock
    except BaseException:
        sock.close()
        raise


class TunneledIMAP4_SSL(imaplib.IMAP4_SSL):
    def __init__(self, host: str, port: int, *, proxy: tuple[str, int], **kwargs):
        self._jht_proxy = proxy
        super().__init__(host, port, **kwargs)

    def _create_socket(self, timeout):
        sock = open_tunnel(self.host, self.port, timeout, self._jht_proxy)
        return self.ssl_context.wrap_socket(sock, server_hostname=self.host)


class TunneledSMTP(smtplib.SMTP):
    """Plain SMTP inside the tunnel, for STARTTLS (587)."""

    def __init__(self, host: str, port: int, *, proxy: tuple[str, int], **kwargs):
        self._jht_proxy = proxy
        super().__init__(host, port, **kwargs)

    def _get_socket(self, host, port, timeout):
        return open_tunnel(host, port, timeout, self._jht_proxy)


class TunneledSMTP_SSL(smtplib.SMTP_SSL):
    """SMTP over TLS inside the tunnel (465)."""

    def __init__(self, host: str, port: int, *, proxy: tuple[str, int], **kwargs):
        self._jht_proxy = proxy
        super().__init__(host, port, **kwargs)

    def _get_socket(self, host, port, timeout):
        sock = open_tunnel(host, port, timeout, self._jht_proxy)
        return self.context.wrap_socket(sock, server_hostname=self._host)


def imap_ssl(host: str, port: int, **kwargs) -> imaplib.IMAP4_SSL:
    proxy = proxy_for(host)
    if proxy is None:
        return imaplib.IMAP4_SSL(host, port, **kwargs)
    return TunneledIMAP4_SSL(host, port, proxy=proxy, **kwargs)


def smtp(host: str, port: int, **kwargs) -> smtplib.SMTP:
    proxy = proxy_for(host)
    if proxy is None:
        return smtplib.SMTP(host, port, **kwargs)
    return TunneledSMTP(host, port, proxy=proxy, **kwargs)


def smtp_ssl(host: str, port: int, **kwargs) -> smtplib.SMTP_SSL:
    proxy = proxy_for(host)
    if proxy is None:
        return smtplib.SMTP_SSL(host, port, **kwargs)
    return TunneledSMTP_SSL(host, port, proxy=proxy, **kwargs)
