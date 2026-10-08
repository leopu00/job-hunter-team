"""What `mail.poll` may hand to an agent (P1 portal secrets, broker phase 1).

A message in the user's mailbox can be the equivalent of a password: a reset
link, a verification code, a magic link. An agent that can ask a site for
"forgot password" and then read the mailbox takes the account without ever
seeing the password. Three layers stand between the mailbox and the agent:

1. **Admission**, a parameter of the mailbox that only the host sets
   (`jht-broker-admin mailbox admission`, stored in the broker's state):
   - `allowlist`: only replies to sent applications, the domains of the
     positions the user authorised, and the senders the user added;
   - `whole_mailbox`: a mailbox dedicated to forwarded job alerts, any board.
2. **The security filter**, always on, for every sender and every policy:
   resets, verification, one-time codes, new sign-ins, 2FA, magic links, and
   links whose query carries a token. A match withholds the whole message.
3. **The reduction**, always on, on everything that is returned: URLs lose
   their fragment, their query (except a named list of offer ids) and any path
   segment that looks like a token; codes in the text become `[codice]`.

There is no switch for 2 and 3, on purpose: the dedicated-mailbox mark is the
only thing that widens what is read, and it does not narrow what is hidden.

Declared residue (P2): a secret written in the text in a shape none of this
recognises (not a link, not a code).
"""

from __future__ import annotations

import html
import math
import re
from dataclasses import dataclass, field
from email.utils import parseaddr
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ADMISSION_POLICIES = ("allowlist", "whole_mailbox")

# ── 2. The security filter ───────────────────────────────────────────────
# One alternation per kind, in the seven product languages (en, it, de, es,
# fr, hu, pt). Matched case-insensitively against subject and body together.
_SECURITY_PHRASES = [
    # password reset / recovery
    r"reset\s+(?:your\s+|the\s+)?password", r"password\s+reset", r"forgot\s+(?:your\s+)?password",
    r"change\s+(?:your\s+)?password", r"recover\s+(?:your\s+)?(?:account|password)",
    r"reimposta(?:re)?\s+(?:la\s+)?password", r"recupero\s+(?:della\s+)?password", r"password\s+dimenticata",
    r"passwort\s+(?:zur(?:ü|ue)cksetzen|vergessen|(?:ä|ae)ndern)", r"neues\s+passwort",
    r"restablecer\s+(?:tu\s+|la\s+)?contrase(?:ñ|n)a", r"recuperar\s+(?:tu\s+|la\s+)?contrase(?:ñ|n)a",
    r"olvidaste\s+tu\s+contrase(?:ñ|n)a",
    r"r(?:é|e)initialis(?:er|ation)\s+(?:de\s+)?(?:votre\s+)?mot\s+de\s+passe", r"mot\s+de\s+passe\s+oubli(?:é|e)",
    r"jelsz(?:ó|o)\s*(?:-\s*)?(?:vissza(?:állítás|allitas)|csere|m(?:ó|o)dos(?:í|i)t(?:á|a)s)", r"(?:ú|u)j\s+jelsz(?:ó|o)",
    r"elfelejtett\s+jelsz(?:ó|o)",
    r"redefini(?:r|ção|cao)\s+(?:de\s+|a\s+|sua\s+)?senha", r"recupera(?:r|ção|cao)\s+(?:de\s+|a\s+|sua\s+)?senha",
    r"esqueceu\s+(?:a\s+|sua\s+)?senha",
    # verification / confirmation of the address or the account
    r"verif(?:y|ication)\s+(?:your\s+)?(?:e-?mail|account|address|identity)", r"verification\s+code",
    r"confirm\s+(?:your\s+)?(?:e-?mail|account|address)", r"activate\s+(?:your\s+)?account",
    r"codice\s+di\s+(?:verifica|conferma|sicurezza|accesso)", r"verifica\s+(?:il\s+tuo|la\s+tua|l')",
    r"conferma\s+(?:il\s+tuo|la\s+tua)\s+(?:e-?mail|indirizzo|account)",
    r"best(?:ä|ae)tigungs(?:code|link)", r"verifizierungs?code", r"sicherheitscode",
    r"(?:e-?mail|konto)\s*(?:-\s*adresse)?\s+(?:best(?:ä|ae)tigen|verifizieren)",
    r"c(?:ó|o)digo\s+de\s+(?:verificaci(?:ó|o)n|confirmaci(?:ó|o)n|seguridad|acceso|verifica(?:ção|cao)|confirma(?:ção|cao)|seguran(?:ç|c)a)",
    r"verifica\s+tu\s+(?:correo|cuenta)", r"confirma\s+tu\s+(?:correo|cuenta)",
    r"code\s+de\s+(?:v(?:é|e)rification|confirmation|s(?:é|e)curit(?:é|e))", r"v(?:é|e)rifiez\s+votre",
    r"confirmez\s+votre\s+(?:adresse|e-?mail|compte)",
    r"(?:ellen(?:ő|o)rz(?:ő|o)|meger(?:ő|o)s(?:í|i)t(?:ő|o)|biztons(?:á|a)gi)\s+k(?:ó|o)d",
    r"e-?mail\s*(?:-\s*c(?:í|i)m)?\s+meger(?:ő|o)s(?:í|i)t", r"fi(?:ó|o)k\s+meger(?:ő|o)s(?:í|i)t",
    r"verifique\s+(?:o\s+|seu\s+|sua\s+)", r"confirme\s+(?:o\s+|seu\s+|sua\s+)(?:e-?mail|endere(?:ç|c)o|conta)",
    # one-time codes
    r"one[-\s]?time\s+(?:pass(?:word|code)?|code|pin)", r"\botp\b", r"\bpin\s+code\b", r"security\s+code",
    r"your\s+(?:login\s+|sign[-\s]?in\s+|access\s+)?code\s+is", r"use\s+(?:this|the\s+following)\s+code",
    r"codice\s+(?:monouso|temporaneo|otp)", r"il\s+tuo\s+codice", r"einmal(?:code|passwort|kennwort)",
    r"(?:dein|ihr)\s+code", r"c(?:ó|o)digo\s+(?:de\s+un\s+solo\s+uso|de\s+uso\s+(?:ú|u)nico|tempor(?:á|a)rio)",
    r"tu\s+c(?:ó|o)digo", r"seu\s+c(?:ó|o)digo", r"code\s+(?:à|a)\s+usage\s+unique", r"votre\s+code",
    r"egyszer\s+haszn(?:á|a)latos", r"a\s+k(?:ó|o)dod", r"az\s+(?:ön|on)\s+k(?:ó|o)dja",
    # new sign-in / login alerts
    r"new\s+(?:sign[-\s]?in|login|log[-\s]?in|device)", r"sign[-\s]?in\s+attempt", r"login\s+attempt",
    r"unusual\s+(?:sign[-\s]?in|activity)", r"nuovo\s+accesso", r"tentativo\s+di\s+accesso",
    r"neue\s+anmeldung", r"anmeldeversuch", r"nuevo\s+inicio\s+de\s+sesi(?:ó|o)n", r"intento\s+de\s+inicio",
    r"nouvelle\s+connexion", r"tentative\s+de\s+connexion", r"(?:ú|u)j\s+bejelentkez(?:é|e)s",
    r"bejelentkez(?:é|e)si\s+k(?:í|i)s(?:é|e)rlet", r"novo\s+(?:acesso|login|in(?:í|i)cio\s+de\s+sess(?:ã|a)o)",
    r"tentativa\s+de\s+(?:acesso|login)",
    # two-factor / two-step
    r"two[-\s]?(?:factor|step)", r"\b2fa\b", r"\bmfa\b", r"multi[-\s]?factor", r"due\s+fattori",
    r"zwei[-\s]?(?:faktor|stufig)", r"dos\s+(?:factores|pasos)", r"deux\s+(?:facteurs|(?:é|e)tapes)",
    r"k(?:é|e)t(?:l(?:é|e)pcs(?:ő|o)s|faktoros)", r"dois\s+(?:fatores|passos)",
    # magic / sign-in links
    r"magic\s+link", r"(?:sign[-\s]?in|log[-\s]?in|login)\s+link", r"link\s+(?:di|per\s+l')\s*accesso",
    r"anmelde-?link", r"enlace\s+(?:de|para)\s+(?:inicio\s+de\s+sesi(?:ó|o)n|acceso)",
    r"lien\s+de\s+connexion", r"bejelentkez(?:é|e)si\s+link", r"link\s+de\s+(?:acesso|login)",
]
_SECURITY_RE = re.compile("|".join(f"(?:{p})" for p in _SECURITY_PHRASES), re.I)

_URL_RE = re.compile(r"""https?://[^\s"'<>)\]]+""", re.I)

# Query keys that carry the secret in a reset/verify/magic link.
_SECRET_QUERY_KEYS = re.compile(
    r"^(?:token|access_token|id_token|auth|authtoken|auth_token|key|code|otp|pin|reset|reset_token|"
    r"verify|verification|verification_code|confirm|confirmation|magic|magic_link|signature|sig|"
    r"nonce|ticket|session|sso|login_token|t)$",
    re.I,
)


# Paths of sign-in, reset and verification pages. A secret-bearing query key
# counts only on one of these: newsletters put a token on every unsubscribe
# link, and the reduction strips those queries anyway.
_AUTH_PATH_RE = re.compile(
    r"(?:^|[/_.-])(?:auth|oauth|login|log-?in|sign-?in|signon|sso|magic|password|passwd|reset|recover|"
    r"verify|verification|confirm|activate|activation|otp|2fa|mfa|session|token|invite|accept)(?:$|[/_.-])",
    re.I,
)


_HTML_TAG = re.compile(r"<[^<>]*>")
# Characters that render as nothing and would split a phrase: zero-width
# space/joiners, word joiner, BOM, soft hyphen.
_INVISIBLE = re.compile("[\u00ad\u200b-\u200d\u2060\ufeff]")


def _readings(subject: str, body: str) -> tuple[str, ...]:
    """The text as the user would read it (audit M8): the raw source, and the
    HTML without tags and entities, once with each tag as a space (`<br>`
    between words) and once with tags dropped (`re<b>set</b>` inside a
    word). Invisible characters go, and runs of whitespace (`&nbsp;`
    included) become one space."""
    raw = f"{subject or ''}\n{body or ''}"

    def clean(text: str) -> str:
        return " ".join(_INVISIBLE.sub("", html.unescape(text)).split())

    return raw, clean(_HTML_TAG.sub(" ", raw)), clean(_HTML_TAG.sub("", raw))


def is_security_message(subject: str, body: str) -> bool:
    """True when the message reads like a reset, a verification, a one-time
    code, a sign-in alert, 2FA or a magic link, or links to a sign-in, reset
    or verification page with a secret-bearing query key. Withholds the whole
    message: subject and links included. HTML is read without its tags and
    entities, so markup cannot split a phrase or hide `&amp;token=`."""
    if any(_SECURITY_RE.search(text) for text in _readings(subject, body)):
        return True
    links = f"{body or ''}\n{html.unescape(body or '')}"
    for match in _URL_RE.finditer(links):
        try:
            parts = urlsplit(match.group(0).rstrip(".,);'\""))
        except ValueError:
            continue
        if not _AUTH_PATH_RE.search(parts.path or "/"):
            continue
        for key, _ in parse_qsl(parts.query, keep_blank_values=True):
            if _SECRET_QUERY_KEYS.match(key):
                return True
    return False


# ── 3. The reduction ─────────────────────────────────────────────────────
# Query parameters that identify an offer and nothing else, by name. Kept only
# when the value is short and has no room for a token.
OFFER_QUERY_KEYS = ("jk", "vjk", "gh_jid", "jobId", "currentJobId", "jobListingId")
_OFFER_VALUE_RE = re.compile(r"^[A-Za-z0-9_-]{1,19}$")
_JWT_RE = re.compile(r"^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$")
_TOKEN_PIECE_MIN = 20


def _entropy(piece: str) -> float:
    counts: dict[str, int] = {}
    for ch in piece:
        counts[ch] = counts.get(ch, 0) + 1
    n = len(piece)
    return -sum(c / n * math.log2(c / n) for c in counts.values())


def looks_like_token(segment: str) -> bool:
    """A path segment that carries a secret: a JWT, or a piece of ≥ 20
    characters that is not a plain lowercase word and has high entropy.
    Slugs (`senior-backend-engineer`) and UUIDs split into short pieces."""
    if _JWT_RE.match(segment):
        return True
    for piece in re.split(r"[-_.~]", segment):
        if len(piece) < _TOKEN_PIECE_MIN or not piece.isalnum():
            continue
        if piece.isalpha() and piece.islower():
            continue
        if _entropy(piece) >= 3.0:
            return True
    return False


def reduce_url(url: str) -> str:
    """The URL with no fragment, only the named offer-id query parameters
    with a short value, and `[token]` for any token-like path segment."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return "[token]"
    path = "/".join("[token]" if looks_like_token(seg) else seg for seg in parts.path.split("/"))
    kept = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=False)
        if key in OFFER_QUERY_KEYS and _OFFER_VALUE_RE.match(value) and not looks_like_token(value)
    ]
    return urlunsplit((parts.scheme, parts.netloc, path, urlencode(kept), ""))


_CODE_WORDS = (
    r"code|codes|codice|codici|c(?:ó|o)digo|k(?:ó|o)d|k(?:ó|o)dja|k(?:ó|o)dod|pin|otp|passcode|"
    r"kennwort|token"
)
_CODE_WORD_RE = re.compile(rf"\b(?:{_CODE_WORDS})\b", re.I)
_ISOLATED_DIGITS_RE = re.compile(r"(?<![\w-])\d{4,8}(?![\w-])")
_SPLIT_DIGITS_RE = re.compile(r"(?<![\w-])\d{3}[ -]\d{3}(?![\w-])")
_ALNUM_CODE_RE = re.compile(r"(?<![\w-])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{6,10}(?![\w-])|(?<![\w-])[A-Z]{6,10}(?![\w-])")
_CODE_WINDOW = 40


def reduce_text(text: str) -> str:
    """Isolated 4–8 digit runs (and 3+3 split ones) become `[codice]`, and so do
    6–10 character codes within a short window of a code word. Links inside
    the text are reduced as URLs, not as text."""
    if not text:
        return text
    urls: list[str] = []

    def stash(match: re.Match) -> str:
        urls.append(reduce_url(match.group(0)))
        return f"\x00{len(urls) - 1}\x00"

    out = _URL_RE.sub(stash, text)
    spans: list[tuple[int, int]] = []
    for word in _CODE_WORD_RE.finditer(out):
        lo, hi = max(0, word.start() - _CODE_WINDOW), min(len(out), word.end() + _CODE_WINDOW)
        for code in _ALNUM_CODE_RE.finditer(out, lo, hi):
            if not _CODE_WORD_RE.fullmatch(code.group(0)):
                spans.append(code.span())
    for start, end in sorted(set(spans), reverse=True):
        out = out[:start] + "[codice]" + out[end:]
    out = _SPLIT_DIGITS_RE.sub("[codice]", out)
    out = _ISOLATED_DIGITS_RE.sub("[codice]", out)
    return re.sub(r"\x00(\d+)\x00", lambda m: urls[int(m.group(1))], out)


# ── 1. Admission ─────────────────────────────────────────────────────────
def sender_address(sender: str) -> str:
    return (parseaddr(sender or "")[1] or "").strip().lower()


def _domain_of(address: str) -> str:
    return address.rsplit("@", 1)[-1] if "@" in address else ""


def _domain_matches(domain: str, allowed: str) -> bool:
    return bool(domain) and (domain == allowed or domain.endswith("." + allowed))


@dataclass(frozen=True)
class Admission:
    """Who may be read. Built by the broker from its own state, never from a
    request or from `/jht_home`."""

    policy: str = "allowlist"
    addresses: frozenset[str] = field(default_factory=frozenset)
    domains: frozenset[str] = field(default_factory=frozenset)
    thread_ids: frozenset[str] = field(default_factory=frozenset)
    # No "registered domains" here (audit M7): in phase 1a the broker logs
    # into no site, and a list nobody writes would be a promise, not a check.
    # Phase 2, when the broker holds LinkedIn/ATS accounts, adds it together
    # with the command that writes it.

    def __post_init__(self) -> None:
        if self.policy not in ADMISSION_POLICIES:
            raise ValueError("admission_policy_unknown")


def _thread_refs(in_reply_to: str, references: str) -> set[str]:
    return {ref.strip().lower() for ref in re.findall(r"<[^<>\s]+>", f"{in_reply_to or ''} {references or ''}")}


def admitted(admission: Admission, sender: str, in_reply_to: str = "", references: str = "") -> bool:
    address = sender_address(sender)
    domain = _domain_of(address)
    if admission.policy == "whole_mailbox":
        return True
    if address in admission.addresses:
        return True
    if any(_domain_matches(domain, allowed) for allowed in admission.domains):
        return True
    return bool(_thread_refs(in_reply_to, references) & admission.thread_ids)


def verdict(admission: Admission, *, sender: str, subject: str, body: str,
            in_reply_to: str = "", references: str = "") -> str:
    """`ok`, `withheld` (not admitted) or `security` (the filter). Only `ok`
    messages are opened for extraction, and their output is reduced."""
    if not admitted(admission, sender, in_reply_to, references):
        return "withheld"
    if is_security_message(subject, body):
        return "security"
    return "ok"


def reduce_row(row: dict) -> dict:
    """The reduction applied to one row `mail.poll` returns."""
    out = dict(row)
    if isinstance(out.get("url"), str):
        out["url"] = reduce_url(out["url"])
    if isinstance(out.get("subject"), str):
        out["subject"] = reduce_text(out["subject"])
    return out
