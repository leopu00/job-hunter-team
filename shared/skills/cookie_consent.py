#!/usr/bin/env python3
"""A cookie banner over a careers page: refuse what is not essential, never accept all.

Why. 1843 (AXA) and 1944 (DNV), 14/09: the company pages opened under a
OneTrust banner ("Rechazarlas todas / Aceptar todas las cookies", "Reject All
Cookies / Accept All Cookies"). The CLOSER acts for the user: it may not
consent to tracking in their name, and a banner over the page is not a
reason to stop.

dismiss(page) looks only inside a visible consent container (a known consent
tool, or an element whose id, class or label names cookies or consent) and
clicks, in this order:
  1. the reject control of a known consent tool (OneTrust, Cookiebot, Didomi,
     Complianz, CookieFirst, Osano, TrustArc, cookieconsent);
  2. a control whose whole text refuses: "Reject all", "Rechazarlas todas",
     "Rifiuta", "Alle ablehnen", "Tout refuser", "Only necessary",
     "Continuar sin aceptar"… in the product languages;
  3. the container's close control ("Close", "×").
A control that accepts ("Accept all", "Aceptar", "Allow all", "Agree", "OK")
and does not refuse is never clicked. Nothing found: nothing clicked. Returns
what it did, for the log; it never raises.
"""

from __future__ import annotations

import re
from typing import Any

REJECTED = "rejected"
CLOSED = "closed"

KNOWN_REJECT = (
    "#onetrust-reject-all-handler",
    "#CybotCookiebotDialogBodyButtonDecline",
    "#didomi-notice-disagree-button",
    ".cmplz-btn.cmplz-deny",
    "[data-cookiefirst-action='reject']",
    ".osano-cm-denyAll",
    "#truste-consent-required",
    ".cc-btn.cc-deny",
)

_REJECT_TEXT = (
    r"reject(?: all)?(?: cookies)?|reject (?:all )?(?:non-essential|optional) cookies|decline(?: all)?(?: cookies)?"
    r"|deny(?: all)?|refuse(?: all)?(?: cookies)?|(?:use )?(?:only |strictly )?necessary(?: cookies)?(?: only)?"
    r"|essential cookies only|continue without accepting"
    r"|rechazar(?: todas)?(?: las cookies)?|rechazarlas todas|rechazar todo|solo (?:las )?(?:cookies )?necesarias|continuar sin aceptar"
    r"|rifiuta(?: tutti| tutto| tutte)?|rifiuta i cookie|solo (?:i )?(?:cookie )?necessari|continua senza accettare"
    r"|ablehnen|alle ablehnen|nur (?:notwendige|essenzielle)(?: cookies)?|weiter ohne zustimmung"
    r"|refuser(?: tout)?|tout refuser|continuer sans accepter|uniquement les cookies nécessaires"
    r"|recusar(?: todos| tudo)?|rejeitar(?: todos)?|apenas (?:os )?(?:cookies )?necessários"
    r"|elutasít(?:om|ás)?|összes elutasítása|csak a szükséges(?:ek)?(?: sütik)?"
)
REJECT_TEXT = re.compile(rf"^\s*(?:{_REJECT_TEXT})\s*$", re.I)
ACCEPT_TEXT = re.compile(
    r"accept|aceptar|acepto|accetta|akzeptier|zustimm|accepter|j'accepte|aceitar|elfogad|allow|agree|consent|\bok\b|got it|verstanden",
    re.I,
)
CLOSE_TEXT = re.compile(r"^\s*(?:×|✕|x|close|cerrar|chiudi|schließen|fermer|fechar|bezárás)\s*$", re.I)

_CONTAINERS = (
    "#onetrust-banner-sdk, #onetrust-consent-sdk, #CybotCookiebotDialog, #didomi-notice, #didomi-popup, "
    ".cmplz-cookiebanner, .osano-cm-dialog, #truste-consent-track, .cc-window, "
    "[id*=cookie i], [class*=cookie i], [id*=consent i], [class*=consent i], [aria-label*=cookie i], [aria-label*=consent i]"
)

# Marks the one control to click; Python then clicks it like a person would.
_PICK_JS = r"""
({containers, known, reject, accept, close}) => {
  const rejectRe = new RegExp(reject, 'i'), acceptRe = new RegExp(accept, 'i'), closeRe = new RegExp(close, 'i');
  const shown = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
    && getComputedStyle(el).visibility !== 'hidden';
  const text = el => ((el.innerText || el.value || '') + '').replace(/\s+/g, ' ').trim();
  document.querySelectorAll('[data-jht-consent]').forEach(el => el.removeAttribute('data-jht-consent'));
  const boxes = Array.from(document.querySelectorAll(containers)).filter(shown);
  if (!boxes.length) return '';
  const inBox = el => boxes.some(b => b.contains(el));
  for (const selector of known) {
    const hit = Array.from(document.querySelectorAll(selector)).find(el => shown(el) && inBox(el));
    if (hit) { hit.setAttribute('data-jht-consent', '1'); return 'rejected'; }
  }
  const controls = boxes.flatMap(b => Array.from(b.querySelectorAll('button, a, [role=button], input[type=button], input[type=submit]')))
    .filter(shown).filter(el => !el.closest('form') || el.closest('form').closest('[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i]'));
  const refusing = controls.find(el => rejectRe.test(text(el)));
  if (refusing) { refusing.setAttribute('data-jht-consent', '1'); return 'rejected'; }
  const closing = controls.find(el => {
    const label = text(el) || el.getAttribute('aria-label') || el.getAttribute('title') || '';
    return !acceptRe.test(label) && (closeRe.test(label) || /close|cerrar|chiudi|schließen|fermer|fechar/i.test(el.getAttribute('aria-label') || ''));
  });
  if (closing) { closing.setAttribute('data-jht-consent', '1'); return 'closed'; }
  return '';
}
"""


def dismiss(page: Any, *, settle_ms: int = 500) -> str:
    """Refuse (or close) a visible cookie banner. "rejected", "closed" or ""."""
    try:
        picked = page.evaluate(
            _PICK_JS,
            {
                "containers": _CONTAINERS,
                "known": list(KNOWN_REJECT),
                "reject": REJECT_TEXT.pattern,
                "accept": ACCEPT_TEXT.pattern,
                "close": CLOSE_TEXT.pattern,
            },
        )
    except Exception:
        return ""
    if picked not in {REJECTED, CLOSED}:
        return ""
    control = page.locator("[data-jht-consent='1']").first
    try:
        label = " ".join((control.inner_text(timeout=2_000) or "").split())
        if label and ACCEPT_TEXT.search(label) and not REJECT_TEXT.match(label):
            return ""  # last guard: whatever the page says, never accept
        control.click(timeout=5_000)
        page.wait_for_timeout(settle_ms)
    except Exception:
        return ""
    return picked
