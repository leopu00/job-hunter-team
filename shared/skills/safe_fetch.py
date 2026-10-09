#!/usr/bin/env python3
"""Scarica una pagina pubblica senza poter finire dentro la rete del container.

Sostituisce `curl -s -L <url>` nelle skill che leggono annunci. Le differenze
sono tre, e nessuna e' cosmetica:

1. **Ogni salto viene controllato, non solo il primo.** `curl -L` segue i
   redirect da solo: un URL pubblico che rimanda a `http://169.254.169.254/`
   passa qualunque controllo fatto sull'indirizzo di partenza. Qui i redirect
   li seguiamo noi, uno alla volta, e ogni destinazione ripassa dal guard.
2. **Il nome viene risolto e l'indirizzo controllato.** `url_guard` non puo'
   sapere dove punta un nome — lo dice il DNS al momento della richiesta. Qui
   si risolve, si guarda ogni indirizzo, e si rifiuta se anche uno solo e'
   privato, loopback o link-local.
3. **L'indirizzo verificato e' quello che viene usato.** `--resolve` inchioda
   la connessione a quell'IP, cosi' fra il controllo e la richiesta non c'e'
   una seconda risoluzione che puo' rispondere un'altra cosa (DNS rebinding).

⚠️ **Il punto 3 vale finche' non c'e' un proxy.** Con `http_proxy` impostato
`curl` non risolve niente in locale: manda un CONNECT al proxy, che risolve per
conto suo, e `--resolve` diventa lettera morta. Con un proxy qualunque (quello
aziendale di chi lo usa) resta cosi': non lo si chiude con `--noproxy`, che
romperebbe chi gira dietro quel proxy, ed e' una scelta di prodotto.

**Dietro il proxy di uscita di JHT** (Podman su Windows) il container non ha
DNS: `getaddrinfo` fallisce sempre, e i punti 2 e 3 rifiuterebbero ogni URL.
Li' la risoluzione e il controllo degli indirizzi li fa il proxy
(`scripts/wsl-interop-connect-proxy.py`: un solo IPv4 risolto e verificato,
privati, loopback, link-local e CGNAT rifiutati con `403`). Qui restano lo
schema, il nome e gli indirizzi scritti nell'URL (`url_guard`), piu' la porta
(80 e 443, la policy del proxy per gli agenti), PRIMA di mandare; poi la
richiesta va al proxy con `--proxytunnel`, cosi' anche un `http://` passa da un
CONNECT e il `403` del proxy non si confonde con quello di un sito.

Saltare la risoluzione per qualunque proxy trasformerebbe il salto in SSRF: una
variabile alterata manderebbe la richiesta a un proxy che non filtra niente.
Vale solo se il proxy e' **attestato** (`egress_proxy_for`): `JHT_EGRESS_PROXY`,
che mette il compose di Windows, e' `http://127.0.0.1:<porta>` (l'unica strada
fuori dal namespace di pasta), `http_proxy` e `https_proxy` dicono esattamente
quello, e `no_proxy` non esclude l'host. Altrimenti si torna al comportamento
di sempre, che li' fallisce chiuso: un host in `NO_PROXY` resta rifiutato.

Uso:
    python3 /app/shared/skills/safe_fetch.py '<URL>' > pagina.html
    python3 /app/shared/skills/safe_fetch.py --status '<URL>'
    python3 /app/shared/skills/safe_fetch.py --user-agent 'jht-analyst/1.0' '<URL>'

Exit code: 0 pagina su stdout · 1 rifiutata dal guard o dal proxy di uscita (il
motivo su stderr) · 2 errore di rete o di `curl`.
"""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import urllib.request
from functools import partial
from urllib.parse import urljoin, urlsplit

sys.path.insert(0, os.path.dirname(__file__))

from url_guard import (  # noqa: E402  (dopo sys.path, per costruzione)
    UrlRejected,
    address_is_reachable_from_outside,
    check_url,
)


MAX_REDIRECTS = 5
MAX_SECONDS = 20
MAX_BYTES = 5_000_000
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
# Le porte che il proxy di uscita lascia agli agenti (POLICY_PORTS["agent"]):
# controllate qui prima di mandare, cosi' il rifiuto ha un motivo chiaro.
EGRESS_PROXY_PORTS = (80, 443)


def _attested_egress_proxy() -> str | None:
    """`JHT_EGRESS_PROXY` se ha la forma del proxy di uscita di JHT, se no `None`.

    Solo `http://127.0.0.1:<porta>`: nel namespace di pasta e' l'unica strada
    verso il proxy (`-T`). Un altro host vorrebbe dire un proxy che nessuno
    ha controllato.
    """
    value = os.environ.get("JHT_EGRESS_PROXY", "").strip()
    if not value:
        return None
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError:
        return None
    if (
        parts.scheme != "http"
        or parts.hostname != "127.0.0.1"
        or port is None
        or parts.username is not None
        or parts.password is not None
        or parts.path not in ("", "/")
        or parts.query
        or parts.fragment
    ):
        return None
    return f"http://127.0.0.1:{port}"


def _same_proxy(value: str | None, attested: str) -> bool:
    return bool(value) and value.strip().lower().rstrip("/") == attested


def egress_proxy_for(host: str) -> str | None:
    """Il proxy di uscita di JHT, se questa richiesta passa di li'.

    Tre condizioni insieme: il proxy e' attestato, `http_proxy` e
    `https_proxy` (quelli che leggono `curl` e urllib) sono proprio lui, e
    `no_proxy` non esclude `host`. Basta che una manchi e la richiesta resta
    sulla strada di sempre, risoluzione e `--resolve` compresi.
    """
    attested = _attested_egress_proxy()
    if attested is None:
        return None
    proxies = urllib.request.getproxies_environment()
    if not (_same_proxy(proxies.get("http"), attested)
            and _same_proxy(proxies.get("https"), attested)):
        return None
    if urllib.request.proxy_bypass_environment(host, proxies):
        return None
    return attested


def resolve_public_address(host: str, port: int) -> str | None:
    """Un indirizzo pubblico per quell'host, o `UrlRejected`.

    Bastano un privato o un link-local fra quelli restituiti per rifiutare:
    non sappiamo quale sceglierebbe il sistema, e un round-robin che una volta
    su tre risponde `127.0.0.1` non e' un caso limite — e' il modo in cui si
    fa passare un nome pubblico per un servizio interno.

    Dietro il proxy di uscita di JHT (`egress_proxy_for`) non si risolve: il
    container non ha DNS e a controllare l'indirizzo e' il proxy. Si guarda
    solo la porta, e si ritorna `None`: nessun indirizzo da inchiodare.
    """
    if egress_proxy_for(host) is not None:
        if port not in EGRESS_PROXY_PORTS:
            raise UrlRejected(f"port {port} not allowed through the egress proxy")
        return None
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise UrlRejected(f"host does not resolve: {exc.strerror}") from exc
    addresses = [info[4][0] for info in infos]
    if not addresses:
        raise UrlRejected("host resolves to nothing")
    for address in addresses:
        if not address_is_reachable_from_outside(address):
            raise UrlRejected("host resolves to an internal address")
    return addresses[0]


def curl_hop(url: str, address: str | None, user_agent: str = USER_AGENT) -> tuple[int, str, bytes]:
    """Un solo salto: nessun redirect seguito, connessione inchiodata a `address`.

    Con `address` a `None` (dietro il proxy di uscita, vedi
    `resolve_public_address`) la connessione va al proxy, con un CONNECT anche
    per `http://`: il `403` del proxy arriva in `%{http_connect}` e diventa un
    rifiuto (exit 1), il `502` un errore di rete (exit 2).

    Ritorna `(status, location, body)`. `--proto` e `--proto-redir` tengono
    fuori `file:`, `gopher:` e compagnia anche se il server prova a mandarci
    li' con un `Location:`.

    `user_agent` esiste perche' alcuni servizi lo richiedono per policy e
    rifiutano quelli generici — Nominatim vuole un UA che identifichi chi
    chiama. Senza questo parametro quelle skill resterebbero su `curl` nudo,
    e un fetcher condiviso che la maggior parte del codice non puo' usare
    non e' un fetcher condiviso.
    """
    # Uno UA con un a capo dentro non e' uno UA: `curl` lo passa com'e', e la
    # riga dopo l'a capo diventa un header in piu' nella richiesta verso il
    # terzo. Chi sceglie lo UA e' la skill, ma questa funzione e' quella che
    # possiede la richiesta — stesso motivo per cui il guard sull'URL sta qui
    # e non nel chiamante.
    if any(not ch.isprintable() for ch in user_agent):
        raise UrlRejected("user-agent contains control characters")
    parts = urlsplit(url)
    port = parts.port or (443 if parts.scheme == "https" else 80)
    env = None
    if address is None:
        proxy = egress_proxy_for(parts.hostname)
        if proxy is None:
            raise UrlRejected("no verified address and no egress proxy")
        # Il proxy lo dice la riga di comando, non l'ambiente: `curl`
        # applicherebbe `NO_PROXY` per conto suo, con regole sue.
        env = {key: value for key, value in os.environ.items()
               if not key.lower().endswith("_proxy")}
        route = ["--proxy", proxy, "--proxytunnel"]
    else:
        route = ["--resolve", f"{parts.hostname}:{port}:{address}"]
    command = [
        "curl",
        "--silent",
        "--show-error",
        "--proto", "=http,https",
        "--proto-redir", "=http,https",
        "--max-redirs", "0",
        "--max-time", str(MAX_SECONDS),
        "--max-filesize", str(MAX_BYTES),
        "--user-agent", user_agent,
        *route,
        # L'a capo davanti rende separabile l'uscita: il corpo e' tutto quello
        # che sta prima dell'ULTIMO a capo, il resto e' questa riga.
        "--write-out", "\n%{http_code} %{http_connect} %{redirect_url}",
        url,
    ]
    result = subprocess.run(command, capture_output=True, env=env)
    body, _, trailer = result.stdout.rpartition(b"\n")
    fields = trailer.decode("utf-8", "replace").split(" ", 2)
    if address is None and len(fields) > 1 and fields[1] not in ("", "000", "200"):
        # La risposta del proxy al CONNECT, non del sito: 403 e' la sua policy
        # (indirizzo non pubblico, porta, nome locale), il resto e' rete.
        if fields[1] == "403":
            raise UrlRejected("refused by the egress proxy (403): "
                              "the destination is not a public address it allows")
        raise RuntimeError(f"egress proxy answered {fields[1]} to CONNECT")
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode("utf-8", "replace").strip())
    status = int(fields[0] or 0)
    location = fields[2].strip() if len(fields) > 2 else ""
    return status, location, body


REDIRECT_CODES = (301, 302, 303, 307, 308)


def walk(url: str, hop=curl_hop, resolve=resolve_public_address):
    """Percorre la catena controllando OGNI salto. `(status, url finale, corpo)`.

    `hop` e `resolve` sono parametri perche' i test devono poter percorrere
    una catena di redirect ostile senza rete e senza un server vero: la parte
    da provare e' la decisione, non `curl`.
    """
    current = check_url(url)
    for _ in range(MAX_REDIRECTS + 1):
        parts = urlsplit(current)
        port = parts.port or (443 if parts.scheme == "https" else 80)
        address = resolve(parts.hostname, port)
        status, location, body = hop(current, address)
        if status in REDIRECT_CODES and location:
            # `urljoin` perche' `Location:` puo' essere relativo: risolverlo
            # contro l'URL corrente e' l'unico modo di sapere dove si finisce.
            current = check_url(urljoin(current, location))
            continue
        return status, current, body
    raise UrlRejected(f"more than {MAX_REDIRECTS} redirects")


def fetch(url: str, hop=curl_hop, resolve=resolve_public_address) -> bytes:
    """La pagina, dopo aver controllato ogni salto della catena."""
    return walk(url, hop, resolve)[2]


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Fetch a public page, refusing anything inside the network"
    )
    parser.add_argument("url")
    parser.add_argument(
        "--status",
        action="store_true",
        help="stato HTTP e URL finale invece del corpo (verifica del link)",
    )
    parser.add_argument(
        "--user-agent",
        default=USER_AGENT,
        help="User-Agent for the request (Nominatim and similar services "
             "require one that identifies the caller)",
    )
    args = parser.parse_args(argv)
    try:
        status, final_url, body = walk(
            args.url, hop=partial(curl_hop, user_agent=args.user_agent)
        )
        if args.status:
            # Stessa forma del `curl -w` che sostituisce: le tabelle di
            # decisione nelle skill leggono queste due parole.
            print(f"HTTP:{status} URL_FINALE:{final_url}")
        else:
            sys.stdout.buffer.write(body)
    except UrlRejected as exc:
        print(f"safe_fetch: refused: {exc}", file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(f"safe_fetch: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
