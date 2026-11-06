"""Constants, imports and clock/hash helpers — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import hashlib
import logging
import re
from dataclasses import field, replace
from datetime import datetime, timezone
from pathlib import Path


try:
    from ats_detect import detect_ats
except ImportError:  # pragma: no cover - package-style import outside the CLI
    from shared.skills.ats_detect import detect_ats
try:
    import application_answers
except ImportError:  # pragma: no cover - package-style import outside the CLI
    from shared.skills import application_answers
try:
    import profile_facts
except ImportError:  # pragma: no cover - package-style import outside the CLI
    from shared.skills import profile_facts
try:
    import apply_vocabulary
except ImportError:  # pragma: no cover - package-style import outside the CLI
    from shared.skills import apply_vocabulary
try:
    import page_failure
except ImportError:  # pragma: no cover - package-style import outside the CLI
    from shared.skills import page_failure
try:
    import location_choice
except ImportError:  # pragma: no cover - package-style import outside the CLI
    from shared.skills import location_choice


LOG = logging.getLogger("jht.apply_flow")
CHECKPOINT_VERSION = 1
SUPPORTED_PLATFORMS = frozenset(
    {"ashby", "greenhouse", "lever", "linkedin", "generic", "workday", "oracle_ce", "icims"}
)
GREENHOUSE_HOSTS = frozenset(
    {
        "job-boards.greenhouse.io",
        "job-boards.eu.greenhouse.io",
        "boards.greenhouse.io",
    }
)
# Lever's US and EU public boards.  Separate instances: a confirmation on one
# never proves a submit made on the other.
LEVER_HOSTS = frozenset({"jobs.lever.co", "jobs.eu.lever.co"})
LINKEDIN_HOSTS = frozenset({"www.linkedin.com", "linkedin.com"})
# The country pages the Scout's links also use (es.linkedin.com, nl.linkedin.com).
_LINKEDIN_COUNTRY_HOST = re.compile(r"^[a-z]{2}\.linkedin\.com$")
STEP_ORDER = ("detect", "fill", "upload_cv", "screening", "review", "submit")
EMAIL_CHANNEL_STATE = "email_channel"
# A company contact form is the application channel (1800): no file field, so
# no CV upload step and no CV in the receipt.
CONTACT_FORM_CHANNEL = "contact_form"
RECEIPT_CHANNELS = frozenset({"web_form", CONTACT_FORM_CHANNEL})
RETRY_LATER_EXIT = 5

# Collect every control that would hand the application to a mail client: an
# anchor, a form action, or a button whose click handler/data attribute holds a
# mailto: target.  Only the raw attribute text is returned — parsing To, CC,
# subject and body belongs to the email channel, not to the browser flow.
_MAILTO_CONTROLS_JS = r"""
() => {
  const out = [];
  const rawMailto = (value) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (/^mailto:/i.test(trimmed)) return trimmed;
    const inScript = trimmed.match(/mailto:[^'"`]*/i);
    return inScript ? inScript[0] : null;
  };
  const labelOf = (element) => [
    element.innerText || "",
    element.getAttribute("value") || "",
    element.getAttribute("aria-label") || "",
    element.getAttribute("title") || "",
  ].join(" ").replace(/\s+/g, " ").trim().slice(0, 200);
  const push = (element, href) => { if (href) out.push({ href, label: labelOf(element) }); };
  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (/^\s*mailto:/i.test(href)) push(a, href.trim());
  });
  document.querySelectorAll("button, input[type=button], input[type=submit], [role=button]").forEach((el) => {
    const direct = ["onclick", "formaction", "data-href", "data-url", "data-mailto"]
      .map((name) => rawMailto(el.getAttribute(name))).find(Boolean);
    if (direct) push(el, direct);
  });
  document.querySelectorAll("form[action]").forEach((form) => {
    const href = rawMailto(form.getAttribute("action"));
    if (!href || !/^mailto:/i.test(href)) return;
    const submit = form.querySelector("button[type=submit], input[type=submit], button:not([type])");
    push(submit || form, href);
  });
  return out;
}
"""
# An application control, not "email us with questions": the visible label must
# say apply/application (a few languages the CLOSER meets).  A bare address in
# the footer is a contact, and a contact is not a channel.
_MAILTO_APPLY_LABEL = re.compile(
    r"\b(apply|application|send\s+(?:us\s+)?(?:your\s+)?(?:cv|resume|application)|"
    r"candidat\w*|bewerb\w*|postul\w*|solicit\w*|invia\w*\s+(?:il\s+)?cv)\b"
    # Czech, Polish, Slovak, Nordic, Baltic, Balkan, Greek, Cyrillic… (2071:
    # "Poslat přihlášku"), bounded for Python and for the browser alike.
    rf"|{apply_vocabulary.MORE_APPLY}",
    re.I,
)


# A vacancy that is no longer open.  Seen live (13-14/09): the page said so, or
# the vacancy URL redirected to the generic careers page, and the flow went on
# looking for a form.  Each phrase names the posting AND says it is gone, so a
# job description that merely contains "no longer" does not match.
# Pattern text for page INPUT in several languages, not user-visible copy.
_NOUNS_EN = r"(?:job|position|posting|vacancy|role|opening|listing|requisition)"
_NOUNS_IT = r"(?:posizione|offerta|annuncio|ruolo|lavoro|selezione)"
_NOUNS_DE = r"(?:stelle|stellenanzeige|stellenangebot|position|job|ausschreibung|anzeige)"
_NOUNS_FR = r"(?:offre|poste|annonce|emploi)"
_NOUNS_ES = r"(?:oferta|vacante|puesto|empleo)"
_NOUNS_PT = r"(?:vaga|oferta|posição|posicao|emprego)"
_NOUNS_HU = r"(?:állás\w*|pozíció\w*|hirdetés\w*)"
_NEAR = r"\b[^.!?,;:\n]{0,40}?"
_VACANCY_CLOSED_PATTERNS = tuple(
    (lang, re.compile(pattern, re.I))
    for lang, pattern in (
        ("en", r"\bno longer (?:accepting|taking|receiving) (?:new )?applications\b(?! (?:from|by|via|through|at|on)\b)"),
        # LinkedIn's signed-in notice on a closed vacancy (seen live, 14/09).
        ("en", r"\bnot currently accepting (?:new )?applications\b(?! (?:from|by|via|through|at|on)\b)"),
        ("en", rf"\b{_NOUNS_EN}{_NEAR}\b(?:is|has been|was) no longer (?:available|open|active|live|online)\b"),
        ("en", rf"\b{_NOUNS_EN} (?:has|have) (?:expired|been filled|been closed)\b"),
        ("en", r"\bapplications (?:for this \w+ )?(?:are|have been) (?:now )?closed\b"),
        ("it", rf"\b{_NOUNS_IT}{_NEAR}\bnon (?:è|e'|risulta) più (?:disponibile|attiv[ao]|apert[ao])\b"),
        ("it", r"\bnon (?:accetta|riceve) più candidature\b"),
        ("it", r"\b(?:al momento|attualmente) non (?:accetta|riceve) candidature\b"),
        ("it", r"\bcandidature (?:sono )?chiuse\b"),
        ("it", r"\b(?:annuncio|offerta|posizione) (?:è )?(?:scadut[ao]|chius[ao])\b"),
        ("it", r"\bposizione (?:è )?(?:stata )?(?:coperta|chiusa)\b"),
        ("de", rf"\b{_NOUNS_DE}{_NEAR}\bnicht mehr (?:verfügbar|aktiv|online|offen|ausgeschrieben)\b"),
        ("de", r"\b(?:stelle|position) (?:ist )?(?:bereits )?(?:besetzt|vergeben)\b"),
        ("de", r"\bbewerbungsfrist (?:ist )?abgelaufen\b"),
        ("de", r"\bkeine (?:weiteren )?bewerbungen mehr (?:an|entgegen)\b"),
        ("fr", rf"\b{_NOUNS_FR}{_NEAR}\bn'est plus (?:disponible|active|ouverte?|en ligne)\b"),
        ("fr", r"\bn'accept(?:e|ons) plus de candidatures\b"),
        ("fr", r"\b(?:poste|offre) (?:a été |est )?(?:pourvue?|expirée?|clôturée?)\b"),
        ("fr", r"\bcandidatures (?:sont )?(?:closes|clôturées)\b"),
        ("es", rf"\b{_NOUNS_ES}{_NEAR}\bya no (?:está|esta) (?:disponible|activa?|abierta?)\b"),
        ("es", r"\bya no (?:acepta|aceptamos|admite) (?:candidaturas|solicitudes|postulaciones)\b"),
        ("es", r"\b(?:oferta|vacante) (?:ha )?(?:expirado|caducado|cerrada)\b"),
        ("es", r"\bpuesto (?:ha sido )?cubierto\b"),
        ("pt", rf"\b{_NOUNS_PT}{_NEAR}\bnão (?:está|esta) mais (?:disponível|disponivel|aberta|ativa)\b"),
        ("pt", r"\b(?:vaga|oferta) (?:foi )?(?:encerrada|preenchida|expirada)\b"),
        ("pt", r"\bnão (?:aceita|aceitamos) mais candidaturas\b"),
        ("hu", rf"\b{_NOUNS_HU}{_NEAR}\b(?:már nem (?:elérhető|aktív|érhető el)|lejárt|betöltésre került)\b"),
    )
)


_NOTICE_CONDITION = re.compile(
    r"\b(?:until|till|once|when|whenever|after|before|if|unless|as soon as|"
    r"bis|sobald|wenn|falls|nachdem|finché|fino a quando|quando|una volta che|se|dopo che|"
    r"jusqu'à ce que|dès que|lorsque|quand|si|hasta que|cuando|una vez que|en cuanto|"
    r"até que|quando|assim que|amíg|miután|ha)\b",
    re.I,
)
_NOTICE_DATE_AFTER = re.compile(
    r"\s*(?:on|by|at|from|as of|am|ab|il|entro|dal|le|à partir du|el|a partir del|em|a partir de)\b[^.!?]{0,15}\d",
    re.I,
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# Profile path a recipe reads → the profile_facts fact with its aliases.
_CORE_PATH_FACTS = {
    ("name",): "full name",
    ("first_name",): "first name",
    ("last_name",): "last name",
    **{path: "email" for path in profile_facts.EMAIL_PATHS},
    ("contacts", "phone"): "phone",
    ("contacts", "linkedin"): "linkedin",
    ("contacts", "github"): "github",
    ("contacts", "website"): "website",
    ("location",): "location",
}


ANSWER_ORIGINS = ("user", "profile", "agent_inferred")
_REFUSED_ANSWER_REASONS = frozenset(
    {"answer_option_unknown", "answer_type_unknown", "answer_not_accepted"}
)



# The same worked-out value refused this many times for the same question
# stops the loop: the question then needs the CLOSER's explicit ask.
MAX_INFERRED_REFUSALS = 2



_CV_REASON = re.compile(r"^[a-z][a-z0-9_]{0,40}$")


def _parse_utc(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value or "").strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _file_sha256(path: Path) -> str:
    """sha256 of a file, or "" when it cannot be read (the upload step then stops)."""
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 16), b""):
                digest.update(chunk)
    except OSError:
        return ""
    return digest.hexdigest()


# Why an optional module could not be imported: logged, never a silent downgrade.
_OPTIONAL_IMPORT_ERRORS: dict[str, str] = {}


def _linkedin_module():
    """`linkedin_apply`, imported only for a LinkedIn position; None when it is absent."""
    try:
        import linkedin_apply
    except ImportError:
        try:
            from shared.skills import linkedin_apply
        except ImportError:
            return None
    return linkedin_apply


def _optional_module(name: str):
    """A sibling skill module imported only when needed; None when it is absent."""
    import importlib

    for qualified in (name, f"shared.skills.{name}"):
        try:
            return importlib.import_module(qualified)
        except ImportError as exc:
            _OPTIONAL_IMPORT_ERRORS[name] = f"{type(exc).__name__}: {exc}"
            continue
    return None
