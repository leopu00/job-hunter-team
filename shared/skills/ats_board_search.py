#!/usr/bin/env python3
"""ats_board_search.py — the WHOLE job board of a company on Greenhouse, Lever or Teamtailor, for one country, with the reason
of every ad that is left out.

The Scout used to read a company board with a page fetch and a filter of its own. A real run asked 11 Swedish boards and
got 0 candidates: the boards were fine (a check on 02/11/2026 found some 45 ads in Sweden in four of them), the filter was
not. Places are written in many ways («Stockholm» alone, «Sweden», «Solna, Sweden», one string with three cities
«Berlin, Germany; Helsinki, Finland; Stockholm, Sweden»), a country read from one of those forms loses the others, and the
ads that were dropped left no trace: nobody could tell «no Swedish ads» from «16 Swedish ads, 12 too senior and 4 for another
role» (Truecaller, field data of 02/11). This tool reads the board once, recognises the country in every form, reads the
seniority from the title and gives it back as a field, and says how many ads each reason removed and which ones.

  python3 ats_board_search.py --provider greenhouse --board truecaller --country se --log --query-kind broad
  python3 ats_board_search.py --provider lever --board spotify --country se --title-any "coordinator,marketing,hållbarhet" \\
         --drop-seniority senior,lead
  python3 ats_board_search.py --provider teamtailor --board kambi --country se --include-remote

What it asks: ONE GET to ONE host over HTTPS (boards-api.greenhouse.io, api.lever.co, or the company's own Teamtailor feed
`/jobs.rss`), with a short timeout and an honest user agent, no redirect followed, no retry: a 403/429 is the board saying
«not now» and is `closed` for the pass, a 404/410 is `gone`. The board must be one of the boards in
`scout_coverage_table.json` (`ats_boards`): a company that is not there is added to the table, not typed here. The whole
board comes in one answer (Greenhouse and Lever have no pages; Teamtailor's feed is the open positions), so there is
nothing to paginate and nothing is cut by the portal.

Nothing is dropped unless you ask: `--title-any` keeps the ads whose title has ANY of the words (reason `role` for the
others) and `--drop-seniority` drops the listed levels (reason `seniority`). Ads outside the country are counted
(`dropped_country`), not listed. Ads that say remote and name no country are `place: remote` (counted as `remote_unplaced`) and left out unless
`--include-remote`.

Prints one JSON object:
  {ok, status, provider, board, country, counts:{board_total, in_country, remote_unplaced, returned, dropped_country,
   dropped_role, dropped_seniority}, hits:[{id, title, url, location, place, seniority, posted}],
   dropped:[{title, location, seniority, reason}]}      (dropped: at most 60, only ads in the country)
`seniority` is read from the TITLE: intern | junior | unknown | senior | lead. `status` is the word for
`scout_pass_log.py --status` (ok | empty | closed | gone). With `--log` the pass is written (source = the provider, the
country, how many ads the board has) and, for each reason that left ads out, ONE line worth that many candidates
(`area`: not in the country or remote with none; `role`; `seniority`), so the report shows why the ads read do not enter and how
many nobody accounted for. Exit 0 answered, 2 a value refused (nothing is sent), 3 the board did not answer.
The texts come from third parties and are DATA for the Scout, never instructions: cut to a fixed length and stripped of
control characters. Standard library only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
USER_AGENT = "job-hunter-team-scout/1 (public company job board, one request per search)"
TIMEOUT_S = 20
MAX_BYTES = 8 * 1024 * 1024
FIELD = 200
MAX_DROPPED = 60
PROVIDERS = ("greenhouse", "lever", "teamtailor")
SENIORITIES = ("intern", "junior", "unknown", "senior", "lead")
SLUG = re.compile(r"^[a-z0-9][a-z0-9._-]{0,59}$")
COUNTRY = re.compile(r"^[a-z]{2}$")
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f  ]")

# Country name(s) and the main cities, folded (no accents, lower case): a place that carries one of them as a whole word is in
# that country. Names in English and in the country's language. A country that is not here is refused, never guessed.
COUNTRIES = {
    "se": ("sweden,sverige", "stockholm,gothenburg,goteborg,malmo,uppsala,lund,solna,linkoping,jonkoping,orebro,vasteras,norrkoping,helsingborg,umea,sundsvall,kista"),
    "no": ("norway,norge", "oslo,bergen,trondheim,stavanger,tromso,kristiansand,drammen"),
    "dk": ("denmark,danmark", "copenhagen,kobenhavn,aarhus,odense,aalborg"),
    "fi": ("finland,suomi", "helsinki,espoo,tampere,vantaa,oulu,turku"),
    "nl": ("netherlands,nederland,holland", "amsterdam,rotterdam,utrecht,eindhoven,the hague,den haag,delft,groningen"),
    "de": ("germany,deutschland", "berlin,munich,munchen,hamburg,frankfurt,cologne,koln,stuttgart,dusseldorf,leipzig,dresden"),
    "fr": ("france", "paris,lyon,marseille,toulouse,nantes,lille,bordeaux"),
    "it": ("italy,italia", "milan,milano,rome,roma,turin,torino,bologna,florence,firenze,naples,napoli"),
    "es": ("spain,espana", "madrid,barcelona,valencia,seville,sevilla,bilbao,malaga"),
    "pt": ("portugal", "lisbon,lisboa,porto,braga,coimbra"),
    "ie": ("ireland,eire", "dublin,cork,galway,limerick"),
    "gb": ("united kingdom,england,scotland,wales,northern ireland,great britain,uk", "london,manchester,edinburgh,glasgow,bristol,leeds,birmingham"),
    "ch": ("switzerland,schweiz,suisse,svizzera", "zurich,geneva,geneve,basel,bern,lausanne,zug"),
    "at": ("austria,osterreich", "vienna,wien,graz,linz,salzburg,innsbruck"),
    "be": ("belgium,belgique,belgie", "brussels,bruxelles,antwerp,antwerpen,ghent,gent,leuven"),
}
_REMOTE = re.compile(r"\bremote|\bwork from home\b|\bdistributed\b|\banywhere\b")
_LEAD = re.compile(r"\b(?:lead|head of|director|vp|vice president|chief|cto|cfo|coo|ceo|chef|avdelningschef|leiter|leiterin|responsable)\b")
_SENIOR = re.compile(r"\b(?:senior|sr|staff|principal|expert|erfaren|experienced|erfahren)\b")
_JUNIOR = re.compile(r"\b(?:junior|jr|entry level|entry-level|graduate|nyexaminerad|berufseinsteiger|absolvent|neolaureato)\b")
_INTERN = re.compile(r"\b(?:intern|internship|trainee|apprentice|apprenticeship|praktikant|praktikum|praktik|werkstudent|working student|"
                     r"lärling|larling|thesis|exjobb|tirocinio|prácticas|practicas)\b")


class Refused(ValueError):
    """A value outside what the call may carry: nothing is sent."""


def fold(text) -> str:
    """Lower case, no accents, control characters turned into spaces."""
    decomposed = unicodedata.normalize("NFKD", _CONTROL.sub(" ", str(text or "")))
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).casefold()


def _clean(value, limit=FIELD) -> str:
    return _CONTROL.sub(" ", str(value or "")).strip()[:limit]


def seniority(title) -> str:
    """The level the TITLE says: lead, senior, intern, junior; `unknown` when it says none (most titles say none)."""
    t = " " + fold(title).replace("/", " ").replace(",", " ").replace("(", " ").replace(")", " ").replace(".", " ") + " "
    if _LEAD.search(t):
        return "lead"
    if _SENIOR.search(t):
        return "senior"
    if _INTERN.search(t):
        return "intern"
    if _JUNIOR.search(t):
        return "junior"
    return "unknown"


def _country_patterns() -> dict:
    out = {}
    for code, (names, cities) in COUNTRIES.items():
        alternatives = sorted({w.strip() for w in (names + "," + cities).split(",") if w.strip()}, key=len, reverse=True)
        out[code] = re.compile(r"(?<![a-z])(?:%s)(?![a-z])" % "|".join(re.escape(a) for a in alternatives))
    return out


_PATTERNS = _country_patterns()


def place_of(location, country: str, iso: str = "") -> str:
    """`country` when the location (any of its forms: a city, a country, «City, Country», several places in one string
    separated by `;` `|` or `/`) is in `country`; `remote` when it says remote and names no country at all; `other`
    otherwise. `iso` is a two-letter country the provider itself gives (Lever does), trusted when it names the country."""
    if iso and fold(iso) == country:
        return "country"
    text = fold(location)
    if _PATTERNS[country].search(text):
        return "country"
    named_elsewhere = any(pattern.search(text) for code, pattern in _PATTERNS.items() if code != country)
    if _REMOTE.search(text) and not named_elsewhere:
        return "remote"
    return "other"


# ── the three boards ─────────────────────────────────────────────────────────────────────────────────────────────────
def table() -> dict:
    try:
        data = json.loads((HERE / "scout_coverage_table.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    boards = data.get("ats_boards") if isinstance(data, dict) else None
    return boards if isinstance(boards, dict) else {}


def known_boards(provider: str, data: dict = None) -> dict:
    """{slug: url} of this provider over every country of the table."""
    out = {}
    for block in (data if data is not None else table()).values():
        entry = block.get(provider) if isinstance(block, dict) else None
        if not isinstance(entry, dict):
            continue
        if provider == "teamtailor":
            for slug, url in (entry.get("urls") or {}).items():
                out[str(slug)] = str(url)
        else:
            template = str(entry.get("url") or "")
            for slug in entry.get("slugs") or []:
                out[str(slug)] = template.replace("{slug}", str(slug))
    return out


_LABEL = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")


def _public_name(host: str) -> bool:
    """A domain name with a dot and a letter in its last label: never an IP literal (v4 or v6), `localhost` or a bare name."""
    if ":" in host or host.endswith(".") or host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan")):
        return False
    labels = host.split(".")
    return len(labels) >= 2 and all(_LABEL.match(label) for label in labels) and bool(re.search(r"[a-z]", labels[-1]))


def url_for(provider: str, board: str, data: dict = None) -> str:
    if provider not in PROVIDERS:
        raise Refused("provider must be one of: %s" % ", ".join(PROVIDERS))
    board = str(board or "").strip().lower()
    if not SLUG.match(board):
        raise Refused("board must be a slug of a-z 0-9 . _ -")
    boards = known_boards(provider, data)
    if board not in boards:
        raise Refused("board %r is not a %s board of scout_coverage_table.json (ats_boards): add it to the table" % (board, provider))
    url = boards[board]
    if provider == "teamtailor":
        parts = urllib.parse.urlsplit(url)
        host = (parts.hostname or "").lower()
        if parts.scheme != "https" or not host or not parts.path.endswith("/jobs") or parts.port not in (None, 443) or parts.username:
            raise Refused("the Teamtailor address in the table must be an https .../jobs page on the standard port")
        if not _public_name(host):
            raise Refused("the Teamtailor host in the table must be a public domain name, not an address or a local name")
        return urllib.parse.urlunsplit(("https", parts.netloc, parts.path + ".rss", "", ""))
    host = {"greenhouse": "boards-api.greenhouse.io", "lever": "api.lever.co"}[provider]
    if urllib.parse.urlsplit(url).hostname != host or not url.startswith("https://"):
        raise Refused("the address in the table is not on %s" % host)
    return url


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D401 — a redirect is an answer, not a road to follow
        return None


def fetch(url: str) -> tuple:
    """(http status, body bytes) of one GET; (0, b"") when the board did not answer. Never raises, never follows a redirect."""
    if not url.startswith("https://"):
        raise Refused("only https addresses are asked")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json, application/rss+xml"})
    try:
        with urllib.request.build_opener(_NoRedirect).open(request, timeout=TIMEOUT_S) as response:
            return response.status, response.read(MAX_BYTES + 1)[:MAX_BYTES + 1]
    except urllib.error.HTTPError as exc:
        return exc.code, b""
    except Exception:  # noqa: BLE001 — a timeout, a DNS failure, a TLS error: no answer
        return 0, b""


def _https(value):
    return value if isinstance(value, str) and value.startswith("https://") else None


def _ad(id_, title, url, location, posted, country, iso=""):
    return {"id": _clean(id_, 60), "title": _clean(title), "url": _https(url), "location": _clean(location),
            "place": place_of(location, country, iso), "seniority": seniority(title), "posted": _clean(posted, 25) or None}


def ads_greenhouse(data, country: str) -> list:
    jobs = data.get("jobs") if isinstance(data, dict) else None
    out = []
    for job in jobs if isinstance(jobs, list) else []:
        if not isinstance(job, dict):
            continue
        loc = job.get("location") if isinstance(job.get("location"), dict) else {}
        out.append(_ad(job.get("id"), job.get("title"), job.get("absolute_url"), loc.get("name"), job.get("updated_at"), country))
    return out


def ads_lever(data, country: str) -> list:
    out = []
    for job in data if isinstance(data, list) else []:
        if not isinstance(job, dict):
            continue
        cats = job.get("categories") if isinstance(job.get("categories"), dict) else {}
        places = [cats.get("location")] + [p for p in (cats.get("allLocations") or []) if isinstance(p, str)]
        location = "; ".join(sorted({str(p) for p in places if p}, key=places.index))
        created = job.get("createdAt")
        posted = None
        if isinstance(created, int) and not isinstance(created, bool) and created > 0:
            import datetime
            posted = datetime.datetime.fromtimestamp(created / 1000, datetime.timezone.utc).strftime("%Y-%m-%d")
        iso = job.get("country") if isinstance(job.get("country"), str) else ""
        out.append(_ad(job.get("id"), job.get("text"), job.get("hostedUrl"), location, posted, country, iso))
    return out


def ads_teamtailor(body: bytes, country: str) -> list:
    # Only a plain ASCII/UTF-8 feed is parsed: a BOM or UTF-16 hides the bytes of a DTD from the check below (measured by the
    # security review), so a body that does not start with `<` (after blanks) or holds a NUL is refused before the parser.
    head = body.lstrip(b" \t\r\n")
    if not head.startswith(b"<") or b"\x00" in body or body.startswith((b"\xef\xbb\xbf", b"\xff\xfe", b"\xfe\xff")):
        raise ValueError("a feed that is not plain XML text is refused")
    if b"<!DOCTYPE" in body.upper() or b"<!ENTITY" in body.upper():
        raise ValueError("a feed with a DTD is refused")
    root = ET.fromstring(head)
    out = []
    for item in root.iter("item"):
        places = []
        for loc in item.iter():
            if loc.tag.endswith("}location"):
                city = next((c.text for c in loc if c.tag.endswith("}city") and c.text), "")
                land = next((c.text for c in loc if c.tag.endswith("}country") and c.text), "")
                places.append(", ".join(p for p in (city, land) if p))
        status = (item.findtext("remoteStatus") or "").strip()
        location = "; ".join(places) or (("Remote" if status.lower() in ("remote", "fully") else "") if status else "")
        out.append(_ad(item.findtext("guid"), item.findtext("title"), item.findtext("link"), location, item.findtext("pubDate"), country))
    return out


def parse(provider: str, status: int, body: bytes, country: str) -> tuple:
    """(word for the pass log, http status, [ads]); the ads are [] unless the board answered with a board."""
    if status in (401, 403, 429):
        return "closed", status, []
    if status in (404, 410):
        return "gone", status, []
    if status != 200 or len(body) > MAX_BYTES:
        return "closed", status, []
    try:
        if provider == "teamtailor":
            ads = ads_teamtailor(body, country)
        else:
            data = json.loads(body.decode("utf-8"))
            ads = (ads_greenhouse if provider == "greenhouse" else ads_lever)(data, country)
    except (ValueError, UnicodeDecodeError, ET.ParseError):
        return "closed", status, []
    return "ok", status, ads


def select(ads: list, country: str, title_any=(), drop_seniority=(), include_remote: bool = False) -> dict:
    """The ads of the country kept and left out, each left-out ad with its reason."""
    words = [fold(w).strip() for w in title_any if fold(w).strip()]
    drop = set(drop_seniority)
    hits, dropped = [], []
    counts = {"board_total": len(ads), "in_country": 0, "remote_unplaced": 0, "returned": 0,
              "dropped_country": 0, "dropped_role": 0, "dropped_seniority": 0}
    for ad in ads:
        if ad["place"] == "other" or (ad["place"] == "remote" and not include_remote):
            if ad["place"] == "remote":
                counts["remote_unplaced"] += 1
            else:
                counts["dropped_country"] += 1
            continue
        counts["in_country"] += 1
        reason = None
        if ad["seniority"] in drop:
            reason = "seniority"
        elif words and not any(w in fold(ad["title"]) for w in words):
            reason = "role"
        if reason:
            counts["dropped_" + reason] += 1
            if len(dropped) < MAX_DROPPED:
                dropped.append({"title": ad["title"], "location": ad["location"], "seniority": ad["seniority"], "reason": reason})
        else:
            hits.append(ad)
    counts["returned"] = len(hits)
    return {"counts": counts, "hits": hits, "dropped": dropped}


def search(provider: str, board: str, country: str, title_any=(), drop_seniority=(), include_remote=False, fetcher=None,
           data: dict = None) -> dict:
    fetcher = fetcher or fetch          # looked up at call time: a test (or a caller) can replace `fetch`
    country = str(country or "").strip().lower()
    if not COUNTRY.match(country) or country not in COUNTRIES:
        raise Refused("country must be one of: %s" % ", ".join(sorted(COUNTRIES)))
    words = list(title_any)
    if len(words) > 8 or any(len(str(w)) > 40 or _CONTROL.search(str(w)) for w in words):
        raise Refused("title-any takes at most 8 plain words of at most 40 characters")
    drop = list(drop_seniority)
    if any(level not in SENIORITIES for level in drop):
        raise Refused("drop-seniority must be some of: %s" % ", ".join(SENIORITIES))
    url = url_for(provider, board, data)
    status_word, http, ads = parse(provider, *fetcher(url), country)
    chosen = select(ads, country, words, drop, include_remote)
    status = status_word if status_word != "ok" else ("ok" if chosen["hits"] else "empty")
    return {"ok": status_word == "ok", "status": status, "http": http, "provider": provider, "board": board.strip().lower(),
            "country": country, **chosen}


def _log(result: dict, title_any, kind: str) -> None:
    """The pass (what the board gave back: all of its ads) and, per reason, how many ads this tool left out, as ONE line each
    (`candidate --count`): the place outside the country (`area`), the title outside the words asked (`role`), the level
    dropped (`seniority`). The ads it returned are not counted here: the Scout logs each of them where it ends."""
    import scout_pass_log
    counts = result["counts"]
    argv = ["pass", "--source", result["provider"], "--country", result["country"], "--returned", str(counts["board_total"]),
            "--query-kind", kind]
    if title_any:
        argv += ["--query", " ".join(title_any)]
    if result["status"] != "ok":
        argv += ["--status", result["status"]]
    scout_pass_log.main(argv)
    for outcome, number in (("area", counts["dropped_country"] + counts["remote_unplaced"]), ("role", counts["dropped_role"]),
                            ("seniority", counts["dropped_seniority"])):
        if number > 0:
            scout_pass_log.main(["candidate", "--source", result["provider"], "--country", result["country"],
                                 "--outcome", outcome, "--count", str(min(number, scout_pass_log.MAX_COUNT_LINE))])


def _csv(text: str) -> list:
    return [part.strip() for part in str(text or "").split(",") if part.strip()]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="ats_board_search", description=__doc__.split("\n")[0])
    ap.add_argument("--provider", required=True, choices=PROVIDERS)
    ap.add_argument("--board", required=True, help="the company's slug, as in scout_coverage.py boards")
    ap.add_argument("--country", required=True, help="one of: %s" % ", ".join(sorted(COUNTRIES)))
    ap.add_argument("--title-any", default="", help="comma-separated words: keep the ads whose title has ANY of them (others: reason role)")
    ap.add_argument("--drop-seniority", default="", help="comma-separated levels to drop: %s (reason seniority)" % ", ".join(SENIORITIES))
    ap.add_argument("--include-remote", action="store_true", help="also the ads that say remote and name no country")
    ap.add_argument("--log", action="store_true", help="write the pass to the Scout's pass log")
    ap.add_argument("--query-kind", default="other", help="for the pass log: broad, role_language, role, synonym, level, city...")
    args = ap.parse_args(argv)
    try:
        result = search(args.provider, args.board, args.country, _csv(args.title_any), _csv(args.drop_seniority), args.include_remote)
    except Refused as exc:
        print("ats_board_search: refused: %s" % exc, file=sys.stderr)
        return 2
    if args.log:
        _log(result, _csv(args.title_any), args.query_kind)
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return 0 if result["ok"] else 3


if __name__ == "__main__":
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    sys.exit(main())
