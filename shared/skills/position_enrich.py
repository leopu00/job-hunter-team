#!/usr/bin/env python3
"""position_enrich.py — the office coordinates and the company logo of a position, by code, no model (T325 A).

The Analisti skip the logo and the office (T323: 19 positions of 22 closed without geocode-check, 21 of 22 without
logo_fetch on Haiku) and the web search does not bring them back (T323 bis: 39 searches, 0 offices, 0 logos). Both can
be done without a model when the ad says enough, so they are done here, when a position becomes `checked`:

  coordinates  an office address written in the ad (street word + name + house number, followed by the position's
               city) -> Nominatim (OpenStreetMap), and the answer is kept only if it lies in that city. With the house
               number in the answer: `address`, verified (the ad itself says it is the office). The street only:
               `street`, not verified. Anything else, or two different addresses in the ad: nothing is written.
  logo         from the company's own site: the site already known in `companies.website`, or the domain of the ad
               when it is the company's (never a job board, an ATS or an agency whose domain does not carry the
               company's name) -> logo_fetch.py, which checks the image and writes it. The company is the position's
               row, or the one of the same name (_db.company_key: «Gamma Italia S.p.a.» is «Gamma Italia»). With
               no row at all, one is created from the company name of the ad (db_insert.py company --name), only when
               that name is the employer: not an agency, a head hunter, an unnamed client or a board (employer_in_ad).

A value that cannot be found stays NULL, never estimated: no site guessed from the name. The one fallback is the centre of the
position's city from the GeoNames list built into the image (city_geo.py, JHT-T351), when the ad gives no address or the
address is not found: `location_precision` city, not verified, so the Scorer can measure a distance from the residence
(an office in Rome for a person in Milan); a city the list does not know, or that is ambiguous, stays NULL. The reason is a
code from a closed list (REASONS), in the JSON answer, in `$JHT_HOME/logs/position-enrich.jsonl` and, for a step that
was tried, as a row of the maintenance history (`maintenance_events`, by_agent `position-enrich`). A position whose
office stays NULL keeps `office_geocoded=0`: the Analista and the care queue can still do it.

Nominatim (https://operations.osmfoundation.org/policies/nominatim/, read 18/11/2026): one request per second at most for
the whole application (a lock in `$JHT_HOME/state/nominatim.json` holds every process of the team to it), four a minute
for the backlog (a job that runs on a schedule), a User-Agent that says who calls, every answer cached
(`$JHT_HOME/state/nominatim-cache.json`: the same query is never sent twice), and an off switch that needs no update:
`JHT_NOMINATIM=0`. A 429, 403 or 503 pauses Nominatim for everyone (PAUSE_S). Only the street, the number and the city of
the ad are sent: a company's office, no data of the person. The site's robots.txt is for crawlers; this is the
documented search API, used as its policy allows. The geocoding switches of the enrichment policy hold here too
(`geocode_pipeline` for a new position, `geocode_missing` for the backlog; the logo has `logo` inside logo_fetch.py).

Who calls it:
  db_update.py, after the commit that moves a position to `checked`: `position <ID>` in a detached process, never
  waited for (`spawn`). JHT_POSITION_ENRICH=0 turns it off, =1 forces it; unset, it runs only inside the image (/app).
  db_insert.py / db_update.py company, after the commit that links positions to a company: `company <ID>` in a
  detached process (`spawn_company`), the logo step again with the company that was missing when the position was
  enriched (an Analista creating it in the same second).
  The Mantenitore, once a day: `backlog`, the checked positions the step never saw (at most --limit, default 20).

Usage:
  python3 position_enrich.py position <ID> [--dry-run]
  python3 position_enrich.py company <ID> [--dry-run]
  python3 position_enrich.py backlog [--limit N] [--dry-run]

Output: one JSON line. Exit 0 (a value not found is not an error), 1 for a position that does not exist or a bad call.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from datetime import datetime, timezone
from functools import partial
from pathlib import Path
from urllib.parse import urlencode, urlsplit

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

try:
    import fcntl
except ImportError:  # pragma: no cover - the team runs on Linux
    fcntl = None

ACTOR = "position-enrich"
USER_AGENT = "JobHunterTeam-enrich/1.0 (+https://github.com/leopu00/job-hunter-team)"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
DISABLE_ENV = "JHT_POSITION_ENRICH"
NOMINATIM_ENV = "JHT_NOMINATIM"
PIPELINE_GAP_S = 1.1          # one request a second, all the team together
BACKLOG_GAP_S = 15.0          # four a minute for a job that runs on a schedule
PAUSE_S = 600                 # after a 429/403/503: ten minutes without Nominatim, for everyone
LOCK_WAIT_S = 30.0
CACHE_MAX = 2000
JD_MAX_CHARS = 60_000
CITY_WINDOW = 80              # the city must follow the address within this many characters
BACKLOG_DEFAULT = 20

# Every reason a value stays NULL (or a step is not run). Closed: they are counted, not read.
REASONS = (
    "policy_off", "remote", "no_city", "no_ad_text", "no_address_in_ad", "several_addresses_in_ad",
    "not_found", "not_in_city", "rate_limited", "network_error", "nominatim_off", "already_done",
    "no_company", "no_company_site", "portal_domain", "site_not_the_company", "no_candidate", "url_refused",
    "logo_error", "not_checked", "excluded", "intermediary", "portal_name", "no_position",
)
# Outcome of the maintenance history for each reason: `unreachable` is retried by the backlog, the others are not.
OUTCOME = {
    "no_ad_text": "skipped", "no_city": "skipped", "no_address_in_ad": "skipped", "several_addresses_in_ad": "skipped",
    "not_found": "failed", "not_in_city": "failed", "rate_limited": "unreachable", "network_error": "unreachable",
    "no_company_site": "skipped", "portal_domain": "skipped", "site_not_the_company": "skipped",
    "no_candidate": "failed", "url_refused": "failed", "logo_error": "unreachable",
}
SETTLED = ("updated", "skipped", "failed")


def fold(text: str) -> str:
    """Lower case, no accents, single spaces: how a city and a company name are compared."""
    text = unicodedata.normalize("NFKD", str(text or "")).replace("ß", "ss")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"\s+", " ", text).strip()


# ── the address written in the ad ────────────────────────────────────────────────────────────────────────────────────────
_NAME = r"[A-Za-zÀ-ÖØ-öø-ÿŐőŰűÅåÄäÖöÆæØø'’.\-]+"
_NUMBER = r"(?:n\.?\s*|nr\.?\s*|no\.?\s*|num\.?\s*)?(\d{1,4}(?:\s?[a-zA-Z](?![a-zA-Z]))?(?:\s?[-/]\s?\d{1,4})?)"
# Street word BEFORE the name: it, fr, es, pt, ca.
_BEFORE = (r"via|viale|piazza|piazzale|corso|largo|vicolo|strada|contrada|lungomare|lungotevere|galleria|"
           r"rue|avenue|boulevard|bd|place|all[ée]e|chemin|quai|impasse|"
           r"calle|avenida|avda|plaza|paseo|carrer|ronda|rua|pra[çc]a|travessa|alameda|largo")
# Street word AFTER the name, separate: en, hu, nl, sv, da.
_AFTER = (r"street|st|road|rd|avenue|ave|lane|ln|way|drive|dr|place|square|sq|court|ct|row|"
          r"utca|u|út|ut|útja|tér|krt|körút|straat|laan|weg|plein|gracht|kade|gatan|vägen|gata|väg|vej|gade|allé")
# Street word glued to the end of the name: de, sv, da, nl, no.
_GLUED = (r"stra(?:ss|ß)e|str|gasse|weg|platz|allee|ring|damm|ufer|steig|"
          r"gatan|vägen|gränd|torget|plan|vej|gade|straat|laan|gracht|veien|gata|gaten|plass")

ADDRESS_PATTERNS = (
    # via Roma 12 · rue de la Paix 3 · calle Mayor, 5
    re.compile(rf"\b(?:{_BEFORE})\.?\s+(?:{_NAME}\s+){{0,4}}?{_NAME},?\s+{_NUMBER}\b", re.IGNORECASE),
    # 12 rue de la Paix · 221B Baker Street · 5 Main St.
    re.compile(rf"\b\d{{1,4}}[a-zA-Z]?,?\s+(?:(?:{_BEFORE})\.?\s+(?:{_NAME}\s+){{0,3}}{_NAME}|"
               rf"(?:{_NAME}\s+){{1,4}}?(?:{_AFTER}))\b\.?", re.IGNORECASE),
    # Váci utca 12 · Keizersgracht 123 (glued below) · Main Street 5
    re.compile(rf"\b(?:{_NAME}\s+){{1,3}}?(?:{_AFTER})\.?\s+{_NUMBER}\b", re.IGNORECASE),
    # Musterstraße 12 · Drottninggatan 5 · Keizersgracht 123
    re.compile(rf"\b{_NAME}(?:{_GLUED})\.?\s+{_NUMBER}\b", re.IGNORECASE),
)


def _clean(match: str) -> str:
    return re.sub(r"\s+", " ", match).strip(" ,.;:")


def addresses_in(text: str, city: str) -> list[str]:
    """The distinct office addresses of the ad that are followed by the position's city. Only what is written."""
    text = (text or "")[:JD_MAX_CHARS]
    target = fold(city)
    if not target:
        return []
    matches = []
    for pattern in ADDRESS_PATTERNS:
        for m in pattern.finditer(text):
            if not re.search(r"\d", m.group(0)):
                continue
            if any(s <= m.start() < e or s < m.end() <= e for s, e, _ in matches):
                continue  # the same words seen by another pattern
            matches.append((m.start(), m.end(), m.group(0)))
    matches.sort()
    found: dict[str, str] = {}
    for i, (_start, end, words) in enumerate(matches):
        # The city belongs to this address only up to the next address, the end of the sentence or line, or CITY_WINDOW.
        stop = min([end + CITY_WINDOW] + [s for s, _e, _w in matches[i + 1:i + 2]])
        tail = text[end:stop].split("\n", 1)[0]
        tail = re.split(r"[.!?;]\s+(?=[A-ZÀ-ÖØ-Þ])", tail, maxsplit=1)[0]  # the sentence ends there
        after = fold(tail)
        if not re.search(rf"(?<![a-z]){re.escape(target)}(?![a-z])", after):
            continue
        address = _clean(words)
        found.setdefault(fold(address), address)
    return list(found.values())


# ── Nominatim: one request a second for the team, every answer cached ─────────────────────────────────────────────────
def _home() -> Path:
    db = os.environ.get("JHT_DB")
    return Path(db).parent if db else Path(os.environ.get("JHT_HOME") or "/jht_home")


@contextlib.contextmanager
def _locked(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path.with_suffix(".lock"), "a+", encoding="utf-8") as lock:
        if fcntl is not None:
            deadline = time.monotonic() + LOCK_WAIT_S
            while True:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("the Nominatim lock is held") from None
                    time.sleep(0.2)
        try:
            yield
        finally:
            if fcntl is not None:
                fcntl.flock(lock, fcntl.LOCK_UN)


def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _write_json(path: Path, data: dict) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, path)


def _http_get(url: str):
    """(status, body) of one GET with our User-Agent, through the shared guarded fetcher."""
    from safe_fetch import curl_hop, walk
    status, _final, body = walk(url, hop=partial(curl_hop, user_agent=USER_AGENT))
    return status, body


def nominatim(query: dict, gap: float, fetch=_http_get, now=time.time, sleep=time.sleep) -> tuple[list | None, str]:
    """The answer of Nominatim for `query` ([] = nothing found), or (None, reason). Cached, paced, paused when refused."""
    if os.environ.get(NOMINATIM_ENV) == "0":
        return None, "nominatim_off"
    state_dir = _home() / "state"
    key = urlencode(sorted(query.items()))
    cache_path = state_dir / "nominatim-cache.json"
    rate_path = state_dir / "nominatim.json"
    try:
        with _locked(rate_path):
            cache = _read_json(cache_path)
            if key in cache and isinstance(cache[key], list):
                return cache[key], ""
            rate = _read_json(rate_path)
            if now() < float(rate.get("paused_until", 0) or 0):
                return None, "rate_limited"
            wait = float(rate.get("last", 0) or 0) + gap - now()
            if wait > 0:
                sleep(wait)
            rate["last"] = now()
            _write_json(rate_path, rate)
            try:
                status, body = fetch(f"{NOMINATIM_URL}?{urlencode(query)}")
            except Exception:  # noqa: BLE001 - refused, unreachable, curl missing: the same for the caller
                return None, "network_error"
            if status in (403, 429, 503):
                rate["paused_until"] = now() + PAUSE_S
                _write_json(rate_path, rate)
                return None, "rate_limited"
            if status != 200:
                return None, "network_error"
            try:
                answer = json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                return None, "network_error"
            if not isinstance(answer, list):
                return None, "network_error"
            kept = [_keep(item) for item in answer[:1] if isinstance(item, dict)]
            cache[key] = kept
            while len(cache) > CACHE_MAX:
                cache.pop(next(iter(cache)))
            _write_json(cache_path, cache)
            return kept, ""
    except (OSError, TimeoutError):
        return None, "network_error"


def _keep(item: dict) -> dict:
    """What the cache keeps of an answer: coordinates, the address parts we check, the name to show."""
    address = item.get("address") if isinstance(item.get("address"), dict) else {}
    return {"lat": item.get("lat"), "lon": item.get("lon"), "display_name": item.get("display_name"),
            "addresstype": item.get("addresstype"),
            "address": {k: address[k] for k in ("house_number", "road", "city", "town", "village", "municipality",
                                                "city_district", "suburb", "county", "postcode", "country_code")
                        if isinstance(address.get(k), str)}}


def place_from(answer: dict, city: str) -> tuple[dict | None, str]:
    """The office to write, or (None, reason): only inside the position's city, never a city or a district pin."""
    try:
        lat, lon = float(answer["lat"]), float(answer["lon"])
    except (KeyError, TypeError, ValueError):
        return None, "not_found"
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None, "not_found"
    parts = answer.get("address") or {}
    target = fold(city)
    places = [fold(parts.get(k, "")) for k in ("city", "town", "village", "municipality", "city_district", "county")]
    if target not in places and not re.search(rf"(?<![a-z]){re.escape(target)}(?![a-z])", fold(answer.get("display_name"))):
        return None, "not_in_city"
    if parts.get("house_number"):
        precision = "address"
    elif parts.get("road") and answer.get("addresstype") in ("road", "street", None):
        precision = "street"
    else:
        return None, "not_found"
    display = str(answer.get("display_name") or "").strip()[:300]
    return {"lat": lat, "lon": lon, "address": display, "precision": precision}, ""


# ── the company's own site ───────────────────────────────────────────────────────────────────────────────────────────
ATS_DOMAINS = (
    "greenhouse.io", "lever.co", "ashbyhq.com", "smartrecruiters.com", "myworkdayjobs.com", "myworkdaysite.com",
    "workday.com", "successfactors.com", "successfactors.eu", "taleo.net", "icims.com", "recruitee.com",
    "teamtailor.com", "personio.de", "personio.com", "workable.com", "jobvite.com", "bamboohr.com", "breezy.hr",
    "jazzhr.com", "applytojob.com", "join.com", "softgarden.io", "softgarden.de", "rexx-systems.com", "hibob.com",
    "pinpointhq.com", "oraclecloud.com", "taleo.com", "zohorecruit.com", "comeet.com", "homerun.co", "factorial.co",
    "inrecruiting.com", "altamiraweb.com", "zucchetti.it", "jobs.personio.de", "cornerstoneondemand.com",
)
BOARD_DOMAINS = (
    "linkedin.com", "indeed.com", "glassdoor.com", "monster.com", "ziprecruiter.com", "xing.com", "stepstone.com",
    "jooble.org", "talent.com", "jobrapido.com", "careerjet.com", "simplyhired.com", "adzuna.com", "google.com",
    "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "kununu.com", "trovit.com", "jobted.com",
    "infojobs.net", "subito.it", "bakeca.it", "welcometothejungle.com", "otta.com", "builtin.com", "dice.com",
    "eures.europa.eu", "europa.eu", "ec.europa.eu", "angel.co", "workingnomads.com",
)
JOB_SUBDOMAINS = ("jobs", "careers", "career", "karriere", "karriera", "lavora", "lavoraconnoi", "work", "apply", "join",
                  "empleo", "emploi", "recrutement", "talent", "hiring", "www")
NAME_STOPWORDS = {"spa", "s.p.a", "srl", "s.r.l", "gmbh", "ag", "sa", "sas", "sarl", "ltd", "limited", "inc", "llc",
                  "plc", "bv", "nv", "ab", "as", "oy", "kft", "zrt", "group", "gruppo", "holding", "the", "and", "company",
                  "co", "de", "di", "la", "le", "il", "et", "und", "italia", "italy", "international", "services"}


def _portal_domains() -> tuple[str, ...]:
    hosts = set(ATS_DOMAINS) | set(BOARD_DOMAINS)
    try:
        table = json.loads((HERE / "scout_coverage_table.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        table = None

    def walk(node):
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "host" and isinstance(v, str):
                    hosts.add(v.split("/")[0].lower().removeprefix("www."))
                else:
                    walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(table)
    return tuple(sorted(hosts))


def _is_under(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def is_portal(host: str, portals=None) -> bool:
    """A job board, an ATS or a social site: its domain is never the company's."""
    host = host.lower().rstrip(".")
    for domain in portals or _portal_domains():
        if _is_under(host, domain):
            return True
        # a board of many countries (it.indeed.com, de.indeed.com, stepstone.de...): the same name, another suffix
        label = domain.split(".")[-2] if domain.count(".") >= 1 else domain
        if label in ("indeed", "stepstone", "jooble", "talent", "glassdoor", "monster", "linkedin", "infojobs",
                     "jobrapido", "careerjet") and re.search(rf"(?:^|\.){label}\.[a-z.]+$", host):
            return True
    return False


def _name_words(company: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]+", fold(company)) if len(w) >= 3 and w not in NAME_STOPWORDS]


def carries_name(host: str, company: str) -> bool:
    """True when the domain is the company's by its name: one word of the name in the domain's main label, or the
    label in the name (acme.com for «Acme Robotics», acmerobotics.it, bending-spoons.com). An agency's domain fails."""
    labels = host.lower().split(".")
    main = labels[-2] if len(labels) >= 2 else labels[0]
    if len(labels) >= 3 and labels[-2] in ("co", "com", "org", "net", "gov", "ac") and len(labels[-1]) == 2:
        main = labels[-3]  # acme.co.uk
    squeezed = main.replace("-", "")
    words = _name_words(company)
    joined = "".join(words)
    if not words or len(squeezed) < 3:
        return False
    return any(w in squeezed for w in words) or (len(squeezed) >= 4 and squeezed in joined)


def company_site(website: str | None, ad_url: str | None, company: str, portals=None) -> tuple[str | None, str]:
    """The company's own site to take the logo from, or (None, reason). Never a portal, never guessed from the name."""
    reason = "no_company_site"
    for source in (website, ad_url):
        if not source:
            continue
        raw = source if re.match(r"^https?://", source, re.I) else "https://" + source.lstrip("/")
        try:
            host = (urlsplit(raw).hostname or "").lower()
        except ValueError:
            continue
        if not host or "." not in host:
            continue
        if is_portal(host, portals):
            reason = "portal_domain"
            continue
        if source is ad_url and not carries_name(host, company):
            reason = "site_not_the_company"
            continue
        if source is website:
            return f"https://{host}", ""  # the site already known, as it is written
        labels = host.split(".")
        while len(labels) > 2 and labels[0] in JOB_SUBDOMAINS:
            labels = labels[1:]
        return "https://" + ".".join(labels), ""
    return None, reason


# ── the employer named in the ad ─────────────────────────────────────────────────────────────────────────────────
# A position with no companies row gets one from the company name of the ad (T325 B: in a test round two direct
# employers stayed without a row and without a logo), but only when that name is the employer. An agency, a head
# hunter or a board is not: its logo next to the job would say the wrong thing. The ad (and the Scout's notes) give it
# away: «Agenzia per il Lavoro», «per conto di azienda cliente», «our client»; so does the name: «(azienda cliente non
# nominata)», «tramite <agenzia>», a known agency brand. Any of these and no row is created (reason `intermediary`).
INTERMEDIARY_TEXT = re.compile(
    r"agenzia (?:per il lavoro|di (?:somministrazione|selezione|ricerca|lavoro))|aut\.? ?min\b|autorizzazione ministeriale"
    r"|societa di (?:ricerca e )?selezione|ricerca e selezione|head ?hunt|somministrazione di lavoro"
    r"|per conto (?:di|del|della|dell) |(?:azienda|societa|realta|impresa) cliente|nostr[oa] client|per (?:una |un |un['\u2019] ?)?"
    r"(?:(?:importante|primaria|nota|solida|storica|affermata|grande|prestigiosa|dinamica|rinomata|consolidata) )?"
    r"(?:azienda|realta|societa|cliente|impresa)\b"
    r"|on behalf of (?:our|a|an|the) client|our client|recruitment (?:agency|consultancy)|staffing (?:agency|firm)"
    r"|employment agency|im auftrag (?:unseres|eines|unserer) (?:kunden|mandanten)|unser(?:e|en)? (?:kunde|mandant)"
    r"|personaldienstleist|arbeitnehmeruberlassung|personalvermittlung|zeitarbeit"
    r"|pour le compte d|notre client|agence d ?interim|cabinet de recrutement"
    r"|empresa cliente|nuestro cliente|empresa de trabajo temporal|consultora de seleccion"
    r"|nosso cliente|empresa de trabalho temporario|onze opdrachtgever|uitzendbureau|bemiddelingsbureau",
    re.I)
INTERMEDIARY_NAME = re.compile(
    r"\(|\btramite\b|\bcliente?\b|\bclient\b|non nominat|riservat|confidential|undisclosed|anonim|anonym"
    r"|agenzia|agency|\blavoro\b|lavoropiu|recruit|staffing|personnel|interim|selezione|selection|head ?hunt|zeitarbeit"
    r"|uitzend|temporary|risorse umane|human resources"
    r"|randstad|adecco|manpower|gi ?group|synergie|\bumana\b|openjobmetis|etjca|\borienta\b|kelly services|\bhays\b"
    r"|michael page|page personnel|robert half|start people|tempo ?team|eurointerim|wyser|spring professional"
    r"|\bhudson\b|\bakkodis\b|\badhr\b|\bmaw\b|\bquanta\b|\bduring\b",
    re.I)


def employer_in_ad(company: str | None, jd_text: str | None, notes: str | None, portals=None) -> tuple[str | None, str]:
    """The employer's name to create a companies row with, or (None, reason). Never a guess: the name of the ad as is."""
    name = re.sub(r"\s+", " ", (company or "")).strip()
    if len(name) < 2 or not re.search(r"[A-Za-z0-9]", fold(name)):
        return None, "no_company"
    folded = fold(name)
    if INTERMEDIARY_NAME.search(folded):
        return None, "intermediary"
    from _db import company_key
    labels = {d.split(".")[0] for d in (portals or _portal_domains())}
    if company_key(name).replace(" ", "") in labels or re.search(r"\.[a-z]{2,3}$", folded):
        return None, "portal_name"
    if INTERMEDIARY_TEXT.search(fold(jd_text or "")) or INTERMEDIARY_TEXT.search(fold(notes or "")):
        return None, "intermediary"
    return name, ""


# ── the steps ────────────────────────────────────────────────────────────────────────────────────────────────────────
def _log(row: dict) -> None:
    try:
        path = _home() / "logs" / "position-enrich.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as out:
            out.write(json.dumps({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), **row},
                                 separators=(",", ":")) + "\n")
    except OSError:
        pass


def _record(target_type: str, target_id: int, action: str, outcome: str) -> None:
    """A row of the maintenance history for a step tried without a write (the writes record their own)."""
    from _db import ensure_schema, get_db
    import maintenance_log
    conn = get_db()
    try:
        ensure_schema(conn)
        maintenance_log.record(conn, target_type, target_id, action, outcome, evidence={"kind": "api"}, by_agent=ACTOR)
        conn.commit()
    finally:
        conn.close()


def _skill(script: str, *args: str) -> subprocess.CompletedProcess:
    # DISABLE_ENV: a company this step creates must not start another logo step for itself (spawn_company).
    env = {**os.environ, "JHT_AGENT_NAME": ACTOR, "JHT_EVENT_WAKE": "0", DISABLE_ENV: "0"}
    return subprocess.run([sys.executable, str(HERE / script), *args], capture_output=True, text=True, env=env,
                          timeout=180)


# The reasons after which the centre of the city is written: the answer would not change on a retry. A network error, a rate
# limit or the policy off leave the office to the next try, which may find the address.
CITY_FALLBACK = ("not_found", "not_in_city", "nominatim_off")


def city_step(pos, city: str, dry_run: bool) -> dict | None:
    """The centre of the city from the GeoNames list (precision `city`, not verified), or None when the list does not know it."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("jht_city_geo", Path(__file__).resolve().parent / "city_geo.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    code = (pos["loc_country_code"] or "").strip().upper()
    found = module.locate(f"{city}, {code}" if re.fullmatch(r"[A-Z]{2}", code) else city)
    if found.get("status") != "found":
        return None
    if dry_run:
        return {"done": False, "would_write": {"lat": found["lat"], "lon": found["lon"], "precision": "city"}}
    done = _skill("db_update.py", "position", str(pos["id"]), "--office-lat", repr(found["lat"]),
                  "--office-lon", repr(found["lon"]), "--office-geocoded", "true", "--office-verified", "false",
                  "--location-precision", "city", "--action", "geocode", "--outcome", "updated", "--evidence-kind", "none")
    if done.returncode != 0:
        return None
    return {"done": True, "precision": "city"}


def office_step(pos, pipeline: bool, dry_run: bool, gap: float) -> dict:
    from enrichment_policy import geocode_options, is_enabled
    if pos["office_geocoded"]:
        return {"done": False, "reason": "already_done"}
    if not is_enabled("geocode_pipeline" if pipeline else "geocode_missing"):
        return {"done": False, "reason": "policy_off"}
    if geocode_options()["non_remote_only"] and (pos["work_mode"] or "").lower() == "remote":
        return {"done": False, "reason": "remote"}
    city = (pos["loc_city"] or "").strip()
    reason = ""
    if not city:
        reason = "no_city"
    elif not (pos["jd_text"] or "").strip():
        reason = "no_ad_text"
    else:
        found = addresses_in(pos["jd_text"], city)
        if not found:
            reason = "no_address_in_ad"
        elif len(found) > 1:
            reason = "several_addresses_in_ad"
    if reason:
        centre = city_step(pos, city, dry_run) if reason != "no_city" else None
        if centre:
            return centre
        if not dry_run:
            _record("position", pos["id"], "geocode", OUTCOME[reason])
        return {"done": False, "reason": reason}
    query = {"q": f"{found[0]}, {city}", "format": "jsonv2", "addressdetails": "1", "limit": "1"}
    code = (pos["loc_country_code"] or "").strip().lower()
    if re.fullmatch(r"[a-z]{2}", code):
        query["countrycodes"] = code
    answer, reason = nominatim(query, gap)
    if answer is not None:
        place, reason = place_from(answer[0], city) if answer else (None, "not_found")
    if reason:
        centre = city_step(pos, city, dry_run) if reason in CITY_FALLBACK else None
        if centre:
            return centre
        if not dry_run and reason != "nominatim_off":
            _record("position", pos["id"], "geocode", OUTCOME[reason])
        return {"done": False, "reason": reason}
    if dry_run:
        return {"done": False, "would_write": place}
    verified = "true" if place["precision"] == "address" else "false"
    done = _skill("db_update.py", "position", str(pos["id"]), "--office-lat", repr(place["lat"]),
                  "--office-lon", repr(place["lon"]), "--office-address", place["address"],
                  "--office-geocoded", "true", "--office-verified", verified,
                  "--location-precision", place["precision"], "--action", "geocode", "--outcome", "updated",
                  "--evidence-kind", "api")
    if done.returncode != 0:
        return {"done": False, "reason": "network_error", "detail": (done.stdout + done.stderr).strip()[-300:]}
    return {"done": True, "precision": place["precision"]}


def _company_row(conn, pos):
    from _db import resolve_company_id
    company_id = pos["company_id"] or resolve_company_id(conn, pos["company"])
    if not company_id:
        return None
    return conn.execute("SELECT id, name, website, logo, logo_fetched FROM companies WHERE id = ?", (company_id,)).fetchone()


def logo_step(pos, conn, dry_run: bool) -> dict:
    from enrichment_policy import is_enabled
    company = _company_row(conn, pos)
    if company is not None and (company["logo"] or company["logo_fetched"]):
        return {"done": False, "reason": "already_done"}
    if not is_enabled("logo"):
        return {"done": False, "reason": "policy_off"}
    if company is not None:
        return _logo_of(company, pos, dry_run)
    name, reason = employer_in_ad(pos["company"], pos["jd_text"], pos["notes"])
    if name is None:
        if not dry_run:
            _record("position", pos["id"], "logo_fetch", "skipped")  # settled: the backlog does not ask again
        return {"done": False, "reason": reason}
    if dry_run:
        return {"done": False, "reason": "no_company", "would_create": name}
    # db_insert.py company: the Analista's upsert on the name, which links this position (and its namesakes) too
    made = _skill("db_insert.py", "company", "--name", name)
    company = _company_row(conn, pos) if made.returncode == 0 else None
    if company is None:
        return {"done": False, "reason": "no_company"}
    return {**_logo_of(company, pos, dry_run), "company_created": company["id"]}


def _logo_of(company, pos, dry_run: bool) -> dict:
    site, reason = company_site(company["website"], pos["url"], company["name"])
    if site is None:
        if not dry_run:
            _record("company", company["id"], "logo_fetch", OUTCOME[reason])
        return {"done": False, "reason": reason}
    args = [company["name"]]
    if not company["website"] or company["website"].rstrip("/") != site:
        args += ["--website", site]
    if dry_run:
        args.append("--dry-run")
    done = _skill("logo_fetch.py", *args)
    try:
        answer = json.loads(done.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        answer = {"ok": False, "status_code": "DB_ERROR"}
    if answer.get("ok") and answer.get("written"):
        if not dry_run:
            _record("company", company["id"], "logo_fetch", "updated")
        return {"done": True, "site": site}
    if answer.get("ok"):
        return {"done": False, "reason": "already_done" if not dry_run else "", "site": site}
    reason = {"NO_CANDIDATE": "no_candidate", "URL_REFUSED": "url_refused", "POLICY_DISABLED": "policy_off"}.get(
        answer.get("status_code"), "logo_error")
    if not dry_run and reason != "policy_off":
        _record("company", company["id"], "logo_fetch", OUTCOME[reason])
    return {"done": False, "reason": reason, "site": site}


POSITION_COLUMNS = ("id, status, company, company_id, url, jd_text, notes, loc_city, loc_country_code, work_mode, "
                    "office_geocoded")


def enrich(position_id: int, pipeline: bool = True, dry_run: bool = False, gap: float = PIPELINE_GAP_S) -> dict | None:
    from _db import ensure_schema, get_db
    conn = get_db()
    try:
        ensure_schema(conn)
        pos = conn.execute(f"SELECT {POSITION_COLUMNS} FROM positions WHERE id = ?", (position_id,)).fetchone()
        if pos is None:
            return None
        if pos["status"] in ("new", "excluded"):
            office = logo = {"done": False, "reason": "not_checked" if pos["status"] == "new" else "excluded"}
        else:
            office = office_step(pos, pipeline, dry_run, gap)
            logo = logo_step(pos, conn, dry_run)
    finally:
        conn.close()
    result = {"position_id": position_id, "office": office, "logo": logo}
    if not dry_run:
        _log({"position_id": position_id, "office": office.get("reason") or "written",
              "logo": logo.get("reason") or "written", "mode": "pipeline" if pipeline else "backlog"})
    return result


def backlog(limit: int, dry_run: bool = False) -> dict:
    """The checked positions the step never settled: an office to place, a company without a logo, or no company yet."""
    from _db import ensure_schema, get_db
    conn = get_db()
    try:
        ensure_schema(conn)
        ids = [row[0] for row in conn.execute(
            """
            SELECT p.id FROM positions p
            LEFT JOIN companies c ON c.id = p.company_id
            WHERE p.status NOT IN ('new', 'excluded')
              AND (
                (COALESCE(p.office_geocoded, 0) = 0 AND NOT EXISTS (
                   SELECT 1 FROM maintenance_events e WHERE e.target_type = 'position' AND e.target_id = p.id
                     AND e.action = 'geocode' AND e.by_agent = ? AND e.outcome IN (?, ?, ?)))
                OR
                (p.company_id IS NULL AND NOT EXISTS (
                   SELECT 1 FROM maintenance_events e WHERE e.target_type = 'position' AND e.target_id = p.id
                     AND e.action = 'logo_fetch' AND e.by_agent = ? AND e.outcome IN (?, ?, ?)))
                OR
                (c.id IS NOT NULL AND c.logo IS NULL AND COALESCE(c.logo_fetched, 0) = 0 AND NOT EXISTS (
                   SELECT 1 FROM maintenance_events e WHERE e.target_type = 'company' AND e.target_id = c.id
                     AND e.action = 'logo_fetch' AND e.by_agent = ? AND e.outcome IN (?, ?, ?)))
              )
            ORDER BY p.id DESC LIMIT ?
            """, (ACTOR, *SETTLED, ACTOR, *SETTLED, ACTOR, *SETTLED, limit))]
    finally:
        conn.close()
    done = [enrich(i, pipeline=False, dry_run=dry_run, gap=BACKLOG_GAP_S) for i in ids]
    return {"positions": len(done),
            "offices_written": sum(1 for d in done if d and d["office"].get("done")),
            "logos_written": sum(1 for d in done if d and d["logo"].get("done")),
            "results": done}


def company_logo(company_id: int, dry_run: bool = False) -> dict | None:
    """The logo step again for a company that arrived after its positions were enriched (T325 B: in a test round one was
    created in the same second as the step, which did not see it). Called when positions are linked to it (spawn_company); the
    ad of its latest checked position gives the site when the company has none."""
    from _db import ensure_schema, get_db
    conn = get_db()
    try:
        ensure_schema(conn)
        if conn.execute("SELECT 1 FROM companies WHERE id = ?", (company_id,)).fetchone() is None:
            return None
        pos = conn.execute(
            f"SELECT {POSITION_COLUMNS} FROM positions WHERE company_id = ? AND status NOT IN ('new', 'excluded') "
            "ORDER BY id DESC LIMIT 1", (company_id,)).fetchone()
        logo = logo_step(pos, conn, dry_run) if pos is not None else {"done": False, "reason": "no_position"}
    finally:
        conn.close()
    if not dry_run:
        _log({"company_id": company_id, "logo": logo.get("reason") or "written", "mode": "company"})
    return {"company_id": company_id, "logo": logo}


def _detached(*args: str, environ=None) -> bool:
    try:
        env = os.environ if environ is None else environ
        flag = env.get(DISABLE_ENV)
        if flag == "0" or (flag != "1" and not str(HERE).startswith("/app/")):
            return False
        subprocess.Popen([sys.executable, str(Path(__file__).resolve()), *args],
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True, close_fds=True)
        return True
    except Exception:  # noqa: BLE001 - a writer must never fail because of this step
        return False


def spawn_company(company_id, environ=None) -> bool:
    """Called by db_insert.py / db_update.py after the commit that links positions to a company. Detached, never raises."""
    try:
        return _detached("company", str(int(company_id)), environ=environ)
    except Exception:  # noqa: BLE001
        return False


def spawn(position_id, environ=None) -> bool:
    """Called by db_update.py after the commit that makes a position `checked`. Detached, never raises."""
    try:
        return _detached("position", str(int(position_id)), environ=environ)
    except Exception:  # noqa: BLE001 - a writer must never fail because of this step
        return False


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Office coordinates and company logo of a position, by code (no model)")
    sub = parser.add_subparsers(dest="cmd", required=True)
    one = sub.add_parser("position")
    one.add_argument("id", type=int)
    one.add_argument("--dry-run", action="store_true")
    firm = sub.add_parser("company")
    firm.add_argument("id", type=int)
    firm.add_argument("--dry-run", action="store_true")
    many = sub.add_parser("backlog")
    many.add_argument("--limit", type=int, default=BACKLOG_DEFAULT)
    many.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.cmd == "position":
        result = enrich(args.id, pipeline=True, dry_run=args.dry_run)
        if result is None:
            print(json.dumps({"ok": False, "error": f"position {args.id} not found"}))
            return 1
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        return 0
    if args.cmd == "company":
        result = company_logo(args.id, dry_run=args.dry_run)
        if result is None:
            print(json.dumps({"ok": False, "error": f"company {args.id} not found"}))
            return 1
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
        return 0
    if not 1 <= args.limit <= 200:
        print(json.dumps({"ok": False, "error": "--limit must be between 1 and 200"}))
        return 1
    print(json.dumps({"ok": True, **backlog(args.limit, dry_run=args.dry_run)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
