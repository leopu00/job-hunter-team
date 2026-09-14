#!/usr/bin/env python3
"""Generic CLOSER recipe for company career sites that no ATS recipe knows.

Why. On the 14/09 live queue five of the fourteen best positions pointed at
the company's own site (a careers page with its own form), and the CLOSER
stopped on every one with `ats_unsupported`. The Ashby and Greenhouse
recipes know their markup; a company site has none in common. This recipe
reads the page the way a person does: which form is the application (a CV
upload, a name and an email, an Apply button), what each field asks (its
label), and it refuses what is not an application — a newsletter box, a
contact form, a search bar, a login.

It is driven by `apply_flow.ApplicationFlow` exactly like the other recipes
(same contract, same checkpoint and receipt): detect → open_form → fill_core
→ upload_cv → fill_screening → review → submit. The flow repeats the gate and
reserves the daily cap right before `submit`, which clicks once.

How it reads a page. One script runs in the page (`_INSPECT_JS`) and returns
every form with its questions: label (label[for], wrapping label, aria,
fieldset legend, placeholder), control type, options, required, answered.
It stamps `data-jht-form` / `data-jht-q` on the elements, so Python acts on
exactly the control it classified. Classifying is pure Python
(`classify_form`), testable without a browser.

Fail closed. Anything uncertain is a `BlockedHuman` with a stable reason:
captcha · two_factor · login_required · account_creation ·
application_form_embedded (the form lives in an iframe of another host: the
detail names it) · application_form_ambiguous · generic_form_missing ·
generic_form_unrecognised · application_redirect_untrusted ·
cover_letter_required · pre_submit_screenshot_failed · and the answer stops
shared with the other recipes (required_answer_missing with an
answer_request — also for a core field the profile lacks, answer_option_unknown,
answer_type_unknown, answer_not_accepted, unknown_required_control, cv_missing,
resume_field_missing, upload_rejected, form_error, field_invalid,
submit_unavailable). A question without a saved answer never goes to the user
from here: the flow hands it to the CLOSER as `pending_question` (CL-08).
"""

from __future__ import annotations

import os
import re
import urllib.parse
from pathlib import Path
from typing import Any, Mapping

try:
    from apply_flow import (
        AshbyRecipe,
        BlockedHuman,
        _exact_form_text,
        _inferred_answer_refused,
        _normalise_label,
        _safe_label,
    )
except ImportError:  # pragma: no cover - package import
    from shared.skills.apply_flow import (  # type: ignore[no-redef]
        AshbyRecipe,
        BlockedHuman,
        _exact_form_text,
        _inferred_answer_refused,
        _normalise_label,
        _safe_label,
    )

try:
    from profile_facts import core_answer_request, profile_value
except ImportError:  # pragma: no cover - package import
    from shared.skills.profile_facts import core_answer_request, profile_value  # type: ignore[no-redef]

PLATFORM = "generic"

# ── vocabulary (casefolded, seven languages) ───────────────────────────────

_APPLY_WORDS = (
    r"apply|application|applying|submit (?:your |my )?(?:application|cv|resume)|send (?:your |my )?(?:application|cv)"
    r"|bewerb\w*|candidat\w*|candidatur\w*|postul\w*|solicitud|inscri\w* (?:à|a) l'offre"
    r"|jelentkez\w*|pályáz\w*"
)
APPLY_LABEL = re.compile(rf"\b(?:{_APPLY_WORDS})\b", re.I)
_CV_WORDS = re.compile(
    r"\b(?:cv|c\.v\.|resume|résumé|curriculum|lebenslauf|önéletrajz|currículo|curr[íi]culum)\b", re.I
)
_COVER_WORDS = re.compile(
    r"cover letter|motivation|anschreiben|lettera di presentazione|lettre de motivation|carta de presentaci[oó]n"
    r"|carta de apresenta[cç][aã]o|motivációs levél|kísérőlevél",
    re.I,
)
_NEWSLETTER_WORDS = re.compile(
    r"newsletter|subscribe|subscription|abonn\w*|iscriviti|iscrizione alla newsletter|suscr[ií]b\w*"
    r"|inscreva-se|assine|feliratkoz\w*|job alert|stellenalarm|updates by email",
    re.I,
)
_CONTACT_WORDS = re.compile(
    r"contact us|get in touch|send (?:us )?a message|your message|kontakt\w*|nachricht|contatt\w*|messaggio"
    r"|nous contacter|votre message|cont[aá]ct\w*|mensaje|mensagem|kapcsolat|üzenet",
    re.I,
)
_SEARCH_WORDS = re.compile(r"\bsearch\b|suche|cerca|recherche|buscar|pesquisar|keres", re.I)
_ACCOUNT_WORDS = re.compile(
    r"create (?:an |your )?account|sign up|register|registrier\w*|konto erstellen|crea(?:re)? (?:un )?account"
    r"|registrati|créer un compte|inscri(?:vez|ption)|crear (?:una )?cuenta|reg[ií]strate|criar conta"
    r"|fiók létrehozása|regisztr\w*|confirm password|repeat password|passwort wiederholen",
    re.I,
)

CONFIRMATION_MARKERS = (
    "thank you for applying",
    "thanks for applying",
    "thank you for your application",
    "application submitted",
    "application received",
    "we have received your application",
    "your application has been submitted",
    "your application has been received",
    "your application is on its way",
    "grazie per la tua candidatura",
    "grazie per la candidatura",
    "candidatura inviata",
    "abbiamo ricevuto la tua candidatura",
    "vielen dank für ihre bewerbung",
    "vielen dank für deine bewerbung",
    "ihre bewerbung wurde erfolgreich",
    "deine bewerbung wurde erfolgreich",
    "wir haben ihre bewerbung erhalten",
    "merci pour votre candidature",
    "votre candidature a bien été envoyée",
    "nous avons bien reçu votre candidature",
    "gracias por tu candidatura",
    "gracias por postularte",
    "hemos recibido tu candidatura",
    "tu solicitud ha sido enviada",
    "obrigado pela sua candidatura",
    "candidatura enviada com sucesso",
    "recebemos a sua candidatura",
    "köszönjük a jelentkezését",
    "köszönjük jelentkezését",
    "jelentkezését megkaptuk",
    "sikeres jelentkezés",
)
# Only words that name a finished submission: "thanks", "danke", "merci" are
# ordinary path words on a company site (review R3, HQ-BACKEND). The flow
# still requires a changed URL and no submit on the page.
CONFIRMATION_URL_MARKERS = ("confirmation", "confirmed", "success", "submitted", "thank-you", "thank_you")
# Phrases of a form that is still there: next to one, a marker is page copy
# (an FAQ saying "thank you for applying"), not a receipt.
_SUBMIT_PHRASES = re.compile(
    r"submit (?:your |my )?application|apply now|send application|bewerbung absenden|jetzt bewerben"
    r"|invia candidatura|candidati ora|envoyer (?:ma |votre )?candidature|postuler maintenant"
    r"|enviar (?:mi )?candidatura|postularme|enviar candidatura|candidatar-me|jelentkezés elküldése|jelentkezem",
    re.I,
)

# Forms that collect a CV without applying to THIS vacancy (review R1): a talent
# pool, job alerts, a referral, a spontaneous application. Never the application.
_NOT_THIS_APPLICATION = re.compile(
    r"talent (?:pool|community|network)|join our (?:network|community)|job alerts?|stellenalarm|jobalert"
    r"|refer (?:a )?(?:friend|colleague|someone)|referral|empfehl\w* (?:einen|eine) |segnala un amico|parrain\w*"
    r"|recomendar (?:a )?(?:un )?amig\w*|indique um amigo|ajánl\w* (?:egy )?ismerős\w*"
    r"|spontaneous application|unsolicited application|open application|general application"
    r"|initiativbewerbung|candidatura spontanea|autocandidatura|candidature spontanée|candidatura espontánea"
    r"|candidatura espontânea|nyílt jelentkezés|keep me in mind|future opportunities",
    re.I,
)

# Core fields (review R2): the label has to BE the fact, not mention it.
# Filler words go, the rest must match one of these whole.
_LABEL_FILLERS = frozenset(
    "your you my the a an of for address profile url link page number optional "
    "tuo tua il la di indirizzo numero facoltativo opzionale "
    "ihre ihr deine dein adresse nummer optional "
    "votre ton ta adresse numéro facultatif "
    "tu su dirección número opcional "
    "seu sua o endereço número opcional "
    "a az cím szám opcionális de da do del della di".split()
)

# Label (normalised, fillers removed) → profile fact. Whole-label matches only.
_CORE_FIELDS: tuple[tuple[str, re.Pattern[str], tuple[tuple[str, ...], ...]], ...] = (
    ("first name", re.compile(r"first name|given name|forename|first|vorname|nome|prénom|prenom|nombre|primeiro nome|keresztnév", re.I),
     (("first_name",),)),
    ("last name", re.compile(r"last name|surname|family name|last|nachname|cognome|nom de famille|nom|apellidos?|sobrenome|apelido|vezetéknév", re.I),
     (("last_name",),)),
    ("full name", re.compile(r"full name|name|vollständiger name|vor und nachname|nome completo|nome e cognome|nom complet|nombre completo|nombre y apellidos|teljes név|név", re.I),
     (("name",),)),
    ("email", re.compile(r"e ?mail|email|correo(?: electrónico)?|courriel|mail", re.I), (("contacts", "email"), ("email",))),
    ("phone", re.compile(r"(?:mobile |cell |contact )?(?:phone|telephone)|mobile|tel|telefon(?:nummer)?|handy(?:nummer)?|telefono|cellulare|téléphone|portable|teléfono|móvil|telefone|telemóvel|celular|telefonszám|mobil", re.I),
     (("contacts", "phone"), ("phone",))),
    ("linkedin", re.compile(r"linkedin", re.I), (("contacts", "linkedin"),)),
    ("github", re.compile(r"github", re.I), (("contacts", "github"),)),
    ("website", re.compile(r"(?:personal |portfolio )?(?:website|web site|homepage|portfolio|site)|sito web|sito|webseite|site web|sitio web|weboldal", re.I),
     (("contacts", "website"),)),
)

_TEXT_TYPES = frozenset({"text", "email", "tel", "url", "number", "date", "search", ""})
_TWO_PART_SUFFIXES = frozenset({"co.uk", "org.uk", "ac.uk", "com.au", "co.nz", "co.jp", "com.br", "com.mx", "co.za", "com.tr"})
# Hosting and ATS suffixes shared by unrelated tenants (review R4): acme.github.io
# and other.github.io are two sites.
_SHARED_SUFFIXES = frozenset({
    "github.io", "gitlab.io", "notion.site", "pages.dev", "netlify.app", "vercel.app", "webflow.io",
    "wixsite.com", "azurewebsites.net", "herokuapp.com", "blogspot.com", "wordpress.com", "squarespace.com",
    "myshopify.com", "carrd.co", "framer.website", "framer.app", "super.site", "cloudfront.net", "appspot.com",
    "firebaseapp.com", "web.app", "onrender.com", "fly.dev", "glitch.me", "readthedocs.io", "substack.com",
    "personio.de", "personio.com", "recruitee.com", "teamtailor.com", "workable.com", "bamboohr.com", "breezy.hr",
    "jobs.personio.de", "jobs.personio.com", "join.com", "softgarden.io", "smartrecruiters.com", "zohorecruit.com",
    "jobvite.com", "myworkdayjobs.com", "icims.com", "applytojob.com", "hire.trakstar.com", "pinpointhq.com",
})


# ── the page inspection ─────────────────────────────────────────────────────

_INSPECT_JS = r"""
() => {
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  const rendered = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const textOf = id => { const n = document.getElementById(id); return n ? clean(n.innerText) : ''; };
  const labelFor = el => {
    const parts = [];
    if (el.labels) for (const l of el.labels) {
      const copy = l.cloneNode(true);
      copy.querySelectorAll('input,select,textarea').forEach(c => c.remove());
      parts.push(clean(copy.innerText));
    }
    if (!parts.join('') && el.getAttribute('aria-labelledby'))
      parts.push(el.getAttribute('aria-labelledby').split(/\s+/).map(textOf).join(' '));
    if (!parts.join('') && el.getAttribute('aria-label')) parts.push(clean(el.getAttribute('aria-label')));
    if (!parts.join('') && el.placeholder) parts.push(clean(el.placeholder));
    if (!parts.join('') && el.title) parts.push(clean(el.title));
    return clean(parts.join(' '));
  };
  const groupLabel = (controls, form) => {
    const first = controls[0];
    const fieldset = first.closest('fieldset');
    if (fieldset && form.contains(fieldset)) {
      const legend = fieldset.querySelector('legend');
      if (legend) return clean(legend.innerText);
    }
    const group = first.closest('[role=radiogroup],[role=group]');
    if (group && form.contains(group)) {
      if (group.getAttribute('aria-labelledby')) return textOf(group.getAttribute('aria-labelledby'));
      if (group.getAttribute('aria-label')) return clean(group.getAttribute('aria-label'));
    }
    // The nearest container holding every control of the group: its text
    // without the option labels is the question.
    let box = first.parentElement;
    while (box && box !== form && !controls.every(c => box.contains(c))) box = box.parentElement;
    if (!box) return '';
    const copy = box.cloneNode(true);
    copy.querySelectorAll('label,input,select,textarea').forEach(n => n.remove());
    return clean(copy.innerText).split(/(?<=[?:*])\s/)[0];
  };
  const skip = new Set(['hidden', 'submit', 'button', 'reset', 'image']);
  const forms = Array.from(document.querySelectorAll('form, [role=form]')).filter(f => !f.parentElement || !f.parentElement.closest('form'));
  const out = [];
  forms.forEach((form, fi) => {
    form.setAttribute('data-jht-form', String(fi));
    const controls = Array.from(form.querySelectorAll('input, textarea, select')).filter(el => {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (skip.has(type)) return false;
      if (el.disabled) return false;
      return type === 'file' || rendered(el);
    });
    const questions = [];
    const grouped = new Map();
    let qi = 0;
    for (const el of controls) {
      const tag = el.tagName.toLowerCase();
      const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;
      if ((type === 'radio' || type === 'checkbox') && el.name) {
        const key = type + '|' + el.name;
        if (!grouped.has(key)) { grouped.set(key, []); questions.push({group: key}); }
        grouped.get(key).push(el);
        continue;
      }
      questions.push({single: el, type});
    }
    const described = [];
    for (const q of questions) {
      const id = `${fi}-${qi++}`;
      if (q.group) {
        const members = grouped.get(q.group);
        const type = members[0].getAttribute('type').toLowerCase();
        members.forEach(m => m.setAttribute('data-jht-q', id));
        const options = members.map(m => labelFor(m) || clean(m.value));
        const single = type === 'checkbox' && members.length === 1;
        described.push({
          id, type: single ? 'checkbox' : (type === 'radio' ? 'radio' : 'checkboxes'),
          label: single ? labelFor(members[0]) : groupLabel(members, form),
          name: members[0].name || '', options: single ? ['Yes', 'No'] : options,
          required: members.some(m => m.required || m.getAttribute('aria-required') === 'true'),
          answered: members.some(m => m.checked), accept: '', autocomplete: '',
        });
        continue;
      }
      const el = q.single;
      el.setAttribute('data-jht-q', id);
      let options = [];
      if (q.type === 'select')
        options = Array.from(el.options).filter(o => o.value !== '').map(o => clean(o.text)).filter(Boolean);
      const label = q.type === 'checkbox' || q.type === 'radio' ? labelFor(el) : labelFor(el);
      const starred = /\*\s*$/.test(label);
      let answered = false;
      if (q.type === 'file') answered = el.files && el.files.length > 0;
      else if (q.type === 'checkbox' || q.type === 'radio') answered = el.checked;
      else answered = clean(el.value) !== '';
      described.push({
        id, type: q.type === 'radio' ? 'radio' : q.type, label, name: el.name || el.id || '',
        options: q.type === 'checkbox' ? ['Yes', 'No'] : options,
        required: el.required || el.getAttribute('aria-required') === 'true' || starred,
        answered, accept: el.getAttribute('accept') || '', autocomplete: el.getAttribute('autocomplete') || '',
      });
    }
    const submits = Array.from(form.querySelectorAll('button[type=submit], button:not([type]), input[type=submit]'))
      .filter(rendered).map(b => clean(b.innerText || b.value || b.getAttribute('aria-label')));
    let heading = '';
    let node = form;
    while (node && !heading) {
      let prev = node.previousElementSibling;
      while (prev && !heading) {
        const h = prev.matches('h1,h2,h3,h4') ? prev : prev.querySelector('h1,h2,h3,h4');
        if (h) heading = clean(h.innerText);
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
    }
    const inner = form.querySelector('h1,h2,h3,h4,legend');
    out.push({
      index: fi, questions: described, submits, heading: clean((inner ? inner.innerText : '') + ' ' + heading),
      text: clean(form.innerText).slice(0, 3000), visible: rendered(form),
    });
  });
  const frames = Array.from(document.querySelectorAll('iframe')).filter(rendered).map(f => ({
    src: f.src || '', title: clean(f.title || f.getAttribute('aria-label') || ''),
  }));
  return {forms: out, frames, title: clean(document.title), url: location.href};
}
"""


def inspect_page(page) -> dict[str, Any]:
    return page.evaluate(_INSPECT_JS)


# ── pure classification ────────────────────────────────────────────────────


def _is_cv_upload(question: Mapping[str, Any]) -> bool:
    if question.get("type") != "file":
        return False
    words = f"{question.get('label', '')} {question.get('name', '')}"
    return bool(_CV_WORDS.search(words)) and not _COVER_WORDS.search(words)


def _is_cover_upload(question: Mapping[str, Any]) -> bool:
    return question.get("type") == "file" and bool(
        _COVER_WORDS.search(f"{question.get('label', '')} {question.get('name', '')}")
    )


def _core_words(value: str) -> str:
    words = [w for w in _normalise_label(str(value).rstrip("*✱ ")).split() if w not in _LABEL_FILLERS]
    return " ".join(words)


def core_field(question: Mapping[str, Any]) -> tuple[str, tuple[tuple[str, ...], ...]] | None:
    """Which profile fact a text field IS, from its label (or name).

    The whole label, fillers removed, must be the fact: "Email address" is the
    email, "Referee email" and "How did you hear about us? (LinkedIn, …)" are
    questions about something else and go through the saved answers.
    """
    if question.get("type") not in _TEXT_TYPES:
        return None
    label = str(question.get("label") or "")
    candidates = [label] if label.strip() else [str(question.get("name") or "")]
    for candidate in candidates:
        words = _core_words(candidate)
        if not words:
            continue
        for key, pattern, paths in _CORE_FIELDS:
            if pattern.fullmatch(words):
                return key, paths
        return None
    # No label and no name at all: the input type is all there is.
    if question.get("type") == "email":
        return "email", (("contacts", "email"), ("email",))
    if question.get("type") == "tel":
        return "phone", (("contacts", "phone"), ("phone",))
    return None


def classify_form(form: Mapping[str, Any]) -> str:
    """application · talent · login · account · newsletter · contact · search · other."""
    questions = list(form.get("questions") or [])
    types = [q.get("type") for q in questions]
    words = " ".join(
        [str(form.get("text", "")), str(form.get("heading", "")), " ".join(form.get("submits") or [])]
        + [f"{q.get('label', '')} {q.get('name', '')}" for q in questions]
    )
    has_password = "password" in types
    has_cv = any(_is_cv_upload(q) for q in questions)
    cores = {field[0] for q in questions if (field := core_field(q))}
    has_email = "email" in cores
    has_name = bool(cores & {"full name", "first name", "last name"})
    if has_password:
        return "account" if _ACCOUNT_WORDS.search(words) or types.count("password") > 1 else "login"
    if _NOT_THIS_APPLICATION.search(words):
        return "talent"
    applyish = bool(APPLY_LABEL.search(" ".join(form.get("submits") or []) + " " + str(form.get("heading", ""))))
    if has_cv and applyish:
        return "application"
    if len(questions) <= 2 and (_NEWSLETTER_WORDS.search(words) or (has_email and not has_name)):
        return "newsletter"
    if _NEWSLETTER_WORDS.search(words) and not applyish:
        return "newsletter"
    if all(t in {"search", "text"} for t in types) and len(questions) <= 2 and _SEARCH_WORDS.search(words):
        return "search"
    if has_email and has_name and applyish:
        return "application"
    if has_cv and has_email and not _NEWSLETTER_WORDS.search(words):
        # A CV, a contact and a neutral "Send": the page context decides, so
        # the caller sees it but a heading-less form is never enough alone.
        return "other"
    if _CONTACT_WORDS.search(words) and "textarea" in types:
        return "contact"
    return "other"


def guard_public_url(url: str) -> str:
    """The flow's own guard for a page it opens: syntax, then a public address."""
    try:
        from safe_fetch import resolve_public_address
        from url_guard import check_url
    except ImportError:  # pragma: no cover - package import
        from shared.skills.safe_fetch import resolve_public_address
        from shared.skills.url_guard import check_url
    checked = check_url(url)
    parts = urllib.parse.urlsplit(checked)
    resolve_public_address(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
    return checked


def _site(host: str) -> str:
    labels = (host or "").casefold().rstrip(".").removeprefix("www.").split(".")
    for size in (3, 2):
        suffix = ".".join(labels[-size:])
        if len(labels) > size and suffix in _SHARED_SUFFIXES:
            return ".".join(labels[-(size + 1):])
    if len(labels) >= 3 and ".".join(labels[-2:]) in _TWO_PART_SUFFIXES:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def same_site(url_a: str, url_b: str) -> bool:
    try:
        a = urllib.parse.urlsplit(url_a).hostname or ""
        b = urllib.parse.urlsplit(url_b).hostname or ""
    except ValueError:
        return False
    return bool(a and b and _site(a) == _site(b))


# ── the recipe ──────────────────────────────────────────────────────────────


class GenericRecipe:
    PLATFORM = PLATFORM
    # "The application form is still there", for the flow's confirmation: a
    # form with a file upload (the CV), or the button review() pinned. Not
    # every form: company pages keep a newsletter or search form in the footer
    # of the thank-you page, and that must not hide the confirmation.
    SUBMIT = (
        "form:has(input[type=file]) [type=submit], form:has(input[type=file]) button:not([type]), "
        "[data-jht-submit]"
    )
    SUCCESS = ""
    CONFIRMATION_MARKERS = CONFIRMATION_MARKERS
    CONFIRMATION_URL_MARKERS = CONFIRMATION_URL_MARKERS
    FORM_WAIT_MS = 10_000

    _SEMANTIC_ANSWER_KEYS = AshbyRecipe._SEMANTIC_ANSWER_KEYS

    def __init__(self, profile: Mapping[str, Any] | None = None, cv_path: Path | str | None = None):
        self.profile = dict(profile or {})
        self.cv_path = Path(cv_path) if cv_path else Path(os.devnull)
        self.answers = AshbyRecipe._answer_index(self.profile.get("application_answers"))
        self.answer_origins: Mapping[str, str] = {}
        self.answer_sources: dict[str, str] = {}
        self.last_answer_key = ""
        # Set by the flow before review(): where the pre-submit screenshot goes.
        self.pre_submit_screenshot_path: str | Path | None = None
        self.pre_submit_screenshot = ""
        self.application_url = ""
        # Seam for tests: synthetic pages live on hosts that do not resolve.
        self.url_guard = guard_public_url

    # ── locating the application form ──

    @staticmethod
    def _application_forms(snapshot: Mapping[str, Any]) -> list[Mapping[str, Any]]:
        return [f for f in snapshot.get("forms") or [] if f.get("visible") and classify_form(f) == "application"]

    def form_present(self, page) -> bool:
        return bool(self._application_forms(inspect_page(page)))

    @staticmethod
    def _apply_controls(page) -> list[Any]:
        found = []
        for role in ("link", "button"):
            matches = page.get_by_role(role, name=APPLY_LABEL)
            for index in range(matches.count()):
                control = matches.nth(index)
                try:
                    if not control.is_visible():
                        continue
                    if control.evaluate("el => !!el.closest('form')"):
                        continue  # a submit inside a form is not the Apply entry point
                    href = control.get_attribute("href") or ""
                except Exception:
                    continue
                if href.casefold().startswith("mailto:"):
                    continue  # the flow's email channel owns these
                found.append(control)
        return found

    def apply_control_present(self, page) -> bool:
        return bool(self._apply_controls(page))

    @staticmethod
    def dom_match(page) -> bool:
        """Exactly one application form on the rendered page."""
        return len(GenericRecipe._application_forms(inspect_page(page))) == 1

    def _stop_without_form(self, page, snapshot: Mapping[str, Any], step: str) -> None:
        kinds = [classify_form(f) for f in snapshot.get("forms") or [] if f.get("visible")]
        if "account" in kinds:
            raise BlockedHuman("account_creation", "The site asks to create an account before applying", step)
        if "login" in kinds:
            raise BlockedHuman("login_required", "The site asks to sign in before applying", step)
        page_host = urllib.parse.urlsplit(str(snapshot.get("url") or page.url)).hostname or ""
        for frame in snapshot.get("frames") or []:
            src = str(frame.get("src") or "")
            host = urllib.parse.urlsplit(src).hostname or ""
            if host and _site(host) != _site(page_host) and (
                APPLY_LABEL.search(f"{src} {frame.get('title', '')}") or re.search(r"job|career|recruit|ats|talent", src, re.I)
            ):
                raise BlockedHuman(
                    "application_form_embedded",
                    f"The application form is embedded from another host ({host})",
                    step,
                )
        raise BlockedHuman("generic_form_missing", "No application form was found on the company page", step)

    def _form(self, page, step: str):
        """The one application form, stamped; every action stays inside it."""
        snapshot = inspect_page(page)
        forms = self._application_forms(snapshot)
        if len(forms) > 1:
            raise BlockedHuman(
                "application_form_ambiguous",
                f"{len(forms)} forms on the page look like an application form",
                step,
            )
        if not forms:
            self._stop_without_form(page, snapshot, step)
        form = forms[0]
        return page.locator(f"[data-jht-form='{form['index']}']").first, form

    def _handoff_or_refuse(self, target: str, step: str) -> None:
        try:
            from ats_detect import detect_ats
        except ImportError:  # pragma: no cover - package import
            from shared.skills.ats_detect import detect_ats
        platform = detect_ats(target).platform
        try:
            import apply_flow
        except ImportError:  # pragma: no cover - package import
            from shared.skills import apply_flow  # type: ignore[no-redef]
        host = urllib.parse.urlsplit(target).hostname or "?"
        handoff = getattr(apply_flow, "PlatformHandoff", None)
        if handoff is not None and platform in getattr(apply_flow, "SUPPORTED_PLATFORMS", ()) and platform != PLATFORM:
            # The flow validates the destination (https, a recipe, one handoff
            # per run) and restarts there through the gate.
            raise handoff(target, f"company Apply leads to {platform} ({host})")
        raise BlockedHuman(
            "application_redirect_untrusted",
            f"The Apply control leads to another site ({host}, platform {platform})",
            step,
        )

    def open_form(self, page) -> None:
        self.application_url = self.application_url or page.url
        if self.form_present(page):
            self._form(page, "detect")
            return
        controls = self._apply_controls(page)
        targets: dict[str, Any] = {}
        for control in controls:
            href = (control.get_attribute("href") or "").strip()
            resolved = urllib.parse.urljoin(page.url, href) if href and not href.startswith(("#", "javascript:")) else ""
            targets.setdefault(resolved.split("#")[0] if resolved else f"button:{len(targets)}", control)
        if not targets:
            self._stop_without_form(page, inspect_page(page), "detect")
        if len(targets) > 1 and len({k for k in targets if not k.startswith("button:")}) != 1:
            raise BlockedHuman(
                "application_form_ambiguous",
                f"{len(targets)} different Apply controls lead to different places",
                "detect",
            )
        target, control = next(iter(targets.items()))
        if not target.startswith("button:"):
            if not same_site(target, self.application_url):
                self._handoff_or_refuse(target, "detect")
            try:
                checked = self.url_guard(target)
            except Exception as exc:
                raise BlockedHuman("url_refused", "The Apply link failed the public-address guard", "detect") from exc
            page.goto(checked, wait_until="domcontentloaded", timeout=30_000)
        else:
            control.click(timeout=10_000)
        deadline = self.FORM_WAIT_MS
        while True:
            if not same_site(page.url, self.application_url) and page.url != "about:blank":
                self._handoff_or_refuse(page.url, "detect")
            if self.form_present(page):
                break
            if deadline <= 0:
                self._stop_without_form(page, inspect_page(page), "detect")
            page.wait_for_timeout(250)
            deadline -= 250
        self._form(page, "detect")

    # ── answers ──

    def _answer_for(self, label: str, name: str) -> tuple[bool, Any]:
        keys = [_normalise_label(label), _normalise_label(name)]
        for pattern, semantic in self._SEMANTIC_ANSWER_KEYS:
            if pattern.search(label):
                keys.append(_normalise_label(semantic))
        for key in keys:
            if key and key in self.answers:
                self.answer_sources[key] = self.answer_origins.get(key, "profile")
                self.last_answer_key = key
                return True, self.answers[key]
        return False, None

    @staticmethod
    def _profile_value(profile: Mapping[str, Any], path: tuple[str, ...]) -> str | None:
        return AshbyRecipe._profile_value(profile, path)

    @staticmethod
    def _label(question: Mapping[str, Any]) -> str:
        return str(question.get("label") or question.get("name") or "").rstrip("* ").strip()

    @staticmethod
    def _answer_request(question: Mapping[str, Any]) -> dict[str, Any] | None:
        exact = _exact_form_text(GenericRecipe._label(question))
        key = _normalise_label(exact)
        if not exact or not key:
            return None
        kind = question.get("type")
        options = [str(o) for o in question.get("options") or [] if str(o).strip()]
        if kind in {"radio", "checkboxes", "select"}:
            return {"key": key, "label": exact, "field_type": kind, "options": options} if options else None
        if kind == "checkbox":
            return {"key": key, "label": exact, "field_type": "checkbox", "options": ["Yes", "No"]}
        if kind == "textarea":
            return {"key": key, "label": exact, "field_type": "textarea", "options": []}
        if kind in {"text", "email", "tel", "url", "number", "date"}:
            return {"key": key, "label": exact, "field_type": kind, "options": []}
        return None

    def _control(self, form, question: Mapping[str, Any]):
        return form.locator(f"[data-jht-q='{question['id']}']")

    def _fill(self, page, form, question: Mapping[str, Any], answer: Any, step: str) -> None:
        label = self._label(question)
        controls = self._control(form, question)
        kind = question.get("type")
        if not controls.count():
            raise BlockedHuman("unknown_required_control", f"Field disappeared from the form: {_safe_label(label)}", step)
        if kind in {"radio", "checkboxes"}:
            values = answer if isinstance(answer, list) else [answer]
            if kind == "radio" and len(values) != 1 or any(
                isinstance(v, bool) or not isinstance(v, (str, int, float)) for v in values
            ):
                raise BlockedHuman("answer_type_unknown", f"Choice question needs exact option labels: {_safe_label(label)}", step)
            wanted = {_normalise_label(str(v)) for v in values}
            matched = {}
            for index in range(controls.count()):
                control = controls.nth(index)
                names = control.evaluate(
                    "el => Array.from(el.labels || []).map(l => l.innerText).concat([el.value || ''])"
                )
                for name in names:
                    if _normalise_label(str(name)) in wanted:
                        matched[_normalise_label(str(name))] = control
            if set(matched) != wanted:
                raise BlockedHuman("answer_option_unknown", f"No exact option matches the saved answer for: {_safe_label(label)}", step)
            for control in matched.values():
                control.check()
            return
        control = controls.first
        if kind == "checkbox":
            if isinstance(answer, str) and _normalise_label(answer) in {"yes", "no"}:
                answer = _normalise_label(answer) == "yes"
            if not isinstance(answer, bool):
                raise BlockedHuman("answer_type_unknown", f"Checkbox needs a yes/no answer: {_safe_label(label)}", step)
            control.set_checked(answer)
            return
        if kind == "select":
            try:
                control.select_option(label=str(answer))
            except Exception as exc:
                raise BlockedHuman("answer_option_unknown", f"Select has no option matching the saved answer for: {_safe_label(label)}", step) from exc
            return
        if isinstance(answer, bool) or not isinstance(answer, (str, int, float)):
            raise BlockedHuman("answer_type_unknown", f"Text field has no explicit scalar answer: {_safe_label(label)}", step)
        rendered = str(answer).strip()
        if not rendered:
            raise BlockedHuman("required_answer_missing", f"Saved answer is empty for: {_safe_label(label)}", step)
        control.fill(rendered)
        if control.input_value().strip() != rendered:
            raise BlockedHuman("answer_not_accepted", f"The form did not retain the answer for: {_safe_label(label)}", step)

    # ── steps ──

    def fill_core(self, page) -> None:
        form, described = self._form(page, "fill")
        for question in described["questions"]:
            field = core_field(question)
            if not field or question.get("answered"):
                continue
            key, _paths = field
            label = self._label(question)
            # profile_facts rule: the profile under its aliases, then a saved
            # answer, then a question the CLOSER works out (CL-08). Never a
            # hard stop for a fact the profile can give, never a split name.
            value = profile_value(self.profile, key)
            present = value is not None
            if present:
                self.answer_sources[_normalise_label(label) or key] = "profile"
            else:
                present, value = self._answer_for(label, key)
            if not present:
                if question.get("required"):
                    request = core_answer_request(label, str(question.get("type") or "text"))
                    if request is None:
                        raise BlockedHuman(
                            "unknown_required_control",
                            f"Required core field has no usable label: {_safe_label(key)}",
                            "fill",
                        )
                    raise BlockedHuman(
                        "required_answer_missing",
                        f"Required field needs a fact the profile does not state: {_safe_label(label)}",
                        "fill",
                        answer_request=request,
                    )
                continue
            try:
                self._fill(page, form, question, value, "fill")
            except BlockedHuman as refused:
                raise _inferred_answer_refused(
                    self, refused, lambda q=question: core_answer_request(self._label(q), str(q.get("type") or "text"))
                ) from None

    def upload_cv(self, page) -> None:
        if not self.cv_path.is_file() or self.cv_path.stat().st_size <= 0:
            raise BlockedHuman("cv_missing", "The selected CV file is missing or empty", "upload_cv")
        form, described = self._form(page, "upload_cv")
        uploads = [q for q in described["questions"] if _is_cv_upload(q)]
        if not uploads:
            files = [q for q in described["questions"] if q.get("type") == "file" and not _is_cover_upload(q)]
            uploads = files if len(files) == 1 else []
        if len(uploads) != 1:
            raise BlockedHuman("resume_field_missing", "The CV upload field was not found unambiguously", "upload_cv")
        control = self._control(form, uploads[0]).first
        control.set_input_files(str(self.cv_path))
        page.wait_for_timeout(100)
        if control.evaluate("el => el.files.length") != 1:
            raise BlockedHuman("upload_rejected", "The form did not retain the selected CV", "upload_cv")

    def fill_screening(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(challenge, f"The site requires human intervention ({challenge})", "screening")
        form, described = self._form(page, "screening")
        for question in described["questions"]:
            if question.get("answered") or core_field(question) or _is_cv_upload(question):
                continue
            label = self._label(question)
            if question.get("type") == "file":
                if question.get("required"):
                    if _is_cover_upload(question):
                        raise BlockedHuman("cover_letter_required", "The form requires a cover letter file", "screening")
                    raise BlockedHuman("unknown_required_control", f"Required file upload is not the CV: {_safe_label(label)}", "screening")
                continue
            present, answer = self._answer_for(label, str(question.get("name") or ""))
            if not present:
                if question.get("required"):
                    request = self._answer_request(question)
                    if request is None:
                        raise BlockedHuman(
                            "unknown_required_control",
                            f"Required question cannot be represented exactly: {_safe_label(label)}",
                            "screening",
                        )
                    raise BlockedHuman(
                        "required_answer_missing",
                        f"Required question needs an answer: {_safe_label(label)}",
                        "screening",
                        answer_request=request,
                    )
                continue
            try:
                self._fill(page, form, question, answer, "screening")
            except BlockedHuman as refused:
                raise _inferred_answer_refused(self, refused, lambda q=question: self._answer_request(q)) from None

    @staticmethod
    def _challenge_reason(page) -> str:
        common = AshbyRecipe._challenge_reason(page)
        if common:
            return common
        try:
            snapshot = inspect_page(page)
        except Exception:
            return ""
        for form in GenericRecipe._application_forms(snapshot):
            if any(q.get("type") == "password" for q in form.get("questions") or []):
                return "account_creation"
        return ""

    def review(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(challenge, f"The site requires human intervention ({challenge})", "review")
        form, described = self._form(page, "review")
        errors = form.locator("[role=alert], .error, .errors, .field-error, .error-message, [aria-invalid=true]")
        for index in range(errors.count()):
            if errors.nth(index).is_visible() and (errors.nth(index).inner_text() or "").strip():
                raise BlockedHuman("form_error", "The form reports a validation error", "review")
        for question in described["questions"]:
            if question.get("required") and not question.get("answered"):
                raise BlockedHuman(
                    "required_field_unanswered",
                    f"Required field remains unanswered: {_safe_label(self._label(question))}",
                    "review",
                )
        invalid = form.evaluate(
            "f => { const bad = Array.from(f.querySelectorAll('input,textarea,select'))"
            ".find(el => el.willValidate && !el.checkValidity()); return bad ? (bad.getAttribute('data-jht-q') || '?') : ''; }"
        )
        if invalid:
            raise BlockedHuman("field_invalid", "The form rejects the format of a field", "review")
        submits = form.locator("button[type=submit], button:not([type]), input[type=submit]")
        visible = [submits.nth(i) for i in range(submits.count()) if submits.nth(i).is_visible()]
        if len(visible) > 1:
            named = [b for b in visible if APPLY_LABEL.search(b.inner_text() or b.get_attribute("value") or "")
                     or re.search(r"submit|send|senden|invia|envoyer|enviar|küld", b.inner_text() or b.get_attribute("value") or "", re.I)]
            visible = named if len(named) == 1 else visible
        if len(visible) != 1 or not visible[0].is_enabled():
            raise BlockedHuman("submit_unavailable", "The submit button is missing, ambiguous, or disabled", "review")
        page.locator("[data-jht-submit]").evaluate_all("els => els.forEach(e => e.removeAttribute('data-jht-submit'))")
        visible[0].evaluate("el => el.setAttribute('data-jht-submit', '1')")
        if self.pre_submit_screenshot_path:
            target = Path(self.pre_submit_screenshot_path)
            try:
                target.parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(target), full_page=True)
                target.chmod(0o600)
            except Exception as exc:
                raise BlockedHuman(
                    "pre_submit_screenshot_failed",
                    "The filled form could not be photographed before submit",
                    "review",
                ) from exc
            self.pre_submit_screenshot = str(target)

    def submit(self, page) -> None:
        # The flow has persisted submit_started, repeated the gate and reserved
        # the cap before this call: one click, never a retry.
        button = page.locator("[data-jht-submit]")
        if button.count() != 1:
            raise BlockedHuman("submit_unavailable", "The reviewed submit button is gone", "submit")
        button.first.click(timeout=10_000)

    # ── confirmation, for the flow ──

    @staticmethod
    def confirmation_text(page, before: str = "") -> str:
        """Visible text that says the application went through, or "".

        Never while the application form is still on the page, never next to
        a submit phrase, never a marker that was already there before the
        click (`before`: the body text review() saw). An FAQ that says "thank
        you for applying" under the form is page copy, not a receipt (R3).
        """
        body = page.locator("body")
        visible = " ".join(body.inner_text().split()) if body.count() else ""
        lower = visible.casefold()
        if _SUBMIT_PHRASES.search(visible):
            return ""
        try:
            if GenericRecipe._application_forms(inspect_page(page)):
                return ""
        except Exception:
            pass  # a page that cannot be inspected: the text rules above decide
        earlier = (before or "").casefold()
        for marker in CONFIRMATION_MARKERS:
            offset = lower.find(marker)
            if offset >= 0 and marker not in earlier:
                return visible[offset: offset + 1000]
        return ""
