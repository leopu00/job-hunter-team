#!/usr/bin/env python3
"""Is this URL something we may fetch from inside the container?

Il canale email accetta qualunque URL che *sembri* un annuncio, e chi lo
scrive e' chiunque conosca l'indirizzo della casella: la destinazione la
sceglie lui. Chi poi lo scarica e' lo Scout, con `curl`, da dentro il
container — dove `192.168.x`, `127.0.0.1` e l'endpoint dei metadati
`169.254.169.254` sono raggiungibili e la rete pubblica non li vede.

Questo modulo e' la meta' deterministica della difesa: non dipende dal
giudizio di un modello e non ha bisogno della rete. La meta' che la rete ce
l'ha e' `safe_fetch.py`, che risolve i nomi e ricontrolla ogni redirect —
qui un nome non lo si puo' giudicare, perche' dove punta lo dice il DNS al
momento della richiesta, non la stringa.
"""

from __future__ import annotations

import ipaddress
import re
from urllib.parse import urlsplit


ALLOWED_SCHEMES = ("http", "https")

# Nomi che, per definizione o per convenzione, stanno dentro la rete: RFC 6761
# (`localhost`, `.invalid`), RFC 8375 (`.home.arpa`), mDNS (`.local`) e i
# suffissi che i container e le reti aziendali si danno da soli.
INTERNAL_SUFFIXES = (
    ".localhost",
    ".local",
    ".internal",
    ".intranet",
    ".lan",
    ".home.arpa",
    ".invalid",
)
INTERNAL_NAMES = ("localhost",)

# Un host il cui ULTIMO pezzo e' tutto cifre (o esadecimale) non e' un nome: e'
# un indirizzo scritto in una delle forme che `curl` accetta e che
# `ipaddress` non riconosce — `0x7f.0.0.1`, `127.1`, `2130706433` sono tutti
# 127.0.0.1. Trattarli come nomi vorrebbe dire lasciarli passare.
_NUMERIC_LAST_LABEL = re.compile(r"^(?:0[xX][0-9a-fA-F]+|\d+)$")


class UrlRejected(ValueError):
    """Perche' quell'URL non si scarica. Il messaggio e' per un log, non per
    un utente: dice la regola violata, non l'host."""


def _host_of(url: str):
    parts = urlsplit(url.strip())
    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise UrlRejected(f"scheme not allowed: {parts.scheme or '(none)'}")
    try:
        host = parts.hostname
    except ValueError as exc:  # URL malformato: porta non numerica, IPv6 rotto
        raise UrlRejected("host unparsable") from exc
    if not host:
        raise UrlRejected("no host")
    # Il punto finale e' la radice del DNS scritta per esteso: `localhost.` e
    # `localhost` sono lo stesso nome per il resolver, ma non per noi. Con il
    # punto l'ultima etichetta e' la stringa vuota — quindi non sembra
    # numerica — e `endswith` sui suffissi interni non trova piu' niente:
    # `http://localhost./jobs` e `http://db.internal./jobs` passerebbero
    # entrambi. Toglierlo PRIMA dei controlli e' l'unico posto in cui la
    # normalizzazione vale per tutti e tre.
    host = host.lower().rstrip(".")
    if not host:
        raise UrlRejected("no host")
    return host, parts


def address_is_reachable_from_outside(address) -> bool:
    """`True` solo per gli indirizzi che esistono anche fuori dal container.

    `is_global` copre in un colpo solo privati, loopback, link-local (dove
    vive l'endpoint dei metadati), multicast, riservati e non specificati. Gli
    IPv4 mappati in IPv6 (`::ffff:127.0.0.1`) vengono srotolati prima, se no
    passerebbero come indirizzi v6 qualsiasi.
    """
    ip = ipaddress.ip_address(address)
    if getattr(ip, "ipv4_mapped", None):
        ip = ip.ipv4_mapped
    return bool(ip.is_global)


def check_url(url: str) -> str:
    """L'URL, normalizzato, se e' scaricabile. Altrimenti `UrlRejected`.

    Un nome che non si riconosce come interno passa di qui: dove punta lo
    decide il DNS, e a guardarlo e' `safe_fetch` quando risolve.
    """
    host, parts = _host_of(url)

    if host in INTERNAL_NAMES or host.endswith(INTERNAL_SUFFIXES):
        raise UrlRejected("internal name")

    last_label = host.rsplit(".", 1)[-1]
    looks_numeric = bool(_NUMERIC_LAST_LABEL.match(last_label)) or ":" in host
    if looks_numeric:
        try:
            reachable = address_is_reachable_from_outside(host)
        except ValueError as exc:
            # Numerico ma non un indirizzo in forma canonica: e' una delle
            # scritture che solo il resolver di `curl` accetta — `0x7f.0.0.1`,
            # `127.1` — e da qui non sappiamo dove porta. Fail-closed.
            #
            # `UrlRejected` eredita da `ValueError`, quindi il controllo vero
            # sta FUORI dal try: dentro, verrebbe riclassificato come errore di
            # forma, e il log direbbe la cosa sbagliata sul caso piu' comune.
            raise UrlRejected("address not in canonical form") from exc
        if not reachable:
            raise UrlRejected("internal address")
        return parts.geturl()

    if "." not in host:
        # Nome a un'etichetta sola: `http://intranet/jobs` esiste solo dentro
        # la rete. Un annuncio pubblico ha sempre un dominio.
        raise UrlRejected("single-label host")

    return parts.geturl()


def is_fetchable(url: str) -> bool:
    """Comodo per i filtri: la stessa decisione, senza eccezione."""
    try:
        check_url(url)
    except UrlRejected:
        return False
    return True


def rejection_reason(url: str):
    """La regola violata, o `None` se l'URL va bene. Per i log e i test."""
    try:
        check_url(url)
    except UrlRejected as exc:
        return str(exc)
    return None
