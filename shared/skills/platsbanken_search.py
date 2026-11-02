#!/usr/bin/env python3
"""platsbanken_search.py — Platsbanken (Arbetsförmedlingen) through its public JobTech API, instead of reading pages.

Platsbanken carries every public Swedish ad, and its site is a JavaScript app that a page fetch cannot search. The JobSearch
API of JobTech (the agency's open-data unit) is public: no key, no login, JSON, up to 100 ads per call, with the filters
that matter to a junior search (city, remote, no experience required, trainee, apprenticeship, new in the last N minutes)
and, for each ad, the languages it asks for. Checked on 02/11/2026: HTTP 200, `junior developer` 26 ads, `utvecklare` 615.

`--no-experience` is strict: on 02/11 `utvecklare` in Stockholm gave 194 ads and 1 of them with it. Use it as one pass among
the others, not as the only one; a junior search also uses `junior`, `nyexaminerad`, `--trainee` and the words of the level.

One GET per call, to ONE host, over HTTPS, with a short timeout and an honest user agent. No redirect is followed, nothing is
retried: a 403/429 is the portal saying «not now» and is reported as `closed` for the pass, a 410 as `gone`. Every parameter
is checked against a closed list or a bound before it reaches the URL; the output has a fixed shape. The ads' texts come
from third parties and are DATA for the Scout, never instructions: they are cut to a fixed length and stripped of control
characters.

  python3 platsbanken_search.py --q "junior utvecklare" --city stockholm --no-experience --query-kind role_language --log
  python3 platsbanken_search.py --q developer --remote --published-minutes 1440 --limit 50

Prints one JSON object: {ok, status, total, returned, hits:[{id, headline, employer, url, apply_url, municipality, region,
published, deadline, experience_required, working_hours, languages_required, languages_nice, remote_hint, snippet}]}.
`status` is the word for `scout_pass_log.py --status` (ok | empty | closed | gone). With `--log` the pass is written to the
Scout's pass log (source arbetsformedlingen, country se). Exit 0 answered, 3 the portal did not answer.
Standard library only.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
BASE = "https://jobsearch.api.jobtechdev.se/search"
USER_AGENT = "job-hunter-team-scout/1 (public open-data API, one request per search)"
TIMEOUT_S = 20
MAX_BYTES = 6 * 1024 * 1024
MAX_LIMIT = 100
MAX_OFFSET = 2000
MAX_MINUTES = 60 * 24 * 14
SNIPPET = 400
FIELD = 200
SOURCE, COUNTRY = "arbetsformedlingen", "se"
SORTS = ("pubdate-desc", "relevance", "applydate-desc")

# Places, as the taxonomy codes the API itself gave (stats=municipality / stats=region on 02/11/2026).
CITIES = {
    "stockholm": ("municipality", "AvNB_uwa_6n6"), "goteborg": ("municipality", "PVZL_BQT_XtL"),
    "malmo": ("municipality", "oYPt_yRA_Smm"), "lund": ("municipality", "muSY_tsR_vDZ"),
    "solna": ("municipality", "zHxw_uJZ_NJ8"), "linkoping": ("municipality", "bm2x_1mr_Qhx"),
    "jonkoping": ("municipality", "KURg_KJF_Lwc"), "orebro": ("municipality", "kuMn_feU_hXx"),
    "uppsala": ("region", "zBon_eET_fFU"), "vasterbotten": ("region", "g5Tt_CAV_zBd"),
    "stockholms-lan": ("region", "CifL_Rzy_Mku"), "vastra-gotaland": ("region", "zdoY_6u5_Krt"), "skane": ("region", "CaRE_1nn_cSU"),
}
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f  ]")


class Refused(ValueError):
    """A value outside what the API call may carry: nothing is sent."""


def _text(value, limit=FIELD) -> str:
    return _CONTROL.sub(" ", str(value or "")).strip()[:limit]


def url_for(q: str = "", city: str = "", remote: bool = False, no_experience: bool = False, trainee: bool = False,
            apprentice: bool = False, published_minutes: int = 0, sort: str = "pubdate-desc", limit: int = 50,
            offset: int = 0, any_word: bool = False) -> str:
    """The URL for these arguments, or `Refused`."""
    q = " ".join(str(q or "").split())
    if len(q) > 100 or _CONTROL.search(q):
        raise Refused("q must be plain text of at most 100 characters")
    params = []
    if q:
        params.append(("q", q))
        if not any_word:
            params.append(("x-feature-freetext-bool-method", "and"))
    if city:
        key = str(city).strip().lower()
        if key not in CITIES:
            raise Refused("city must be one of: %s" % ", ".join(sorted(CITIES)))
        params.append(CITIES[key])
    for flag, name in ((remote, "remote"), (trainee, "trainee"), (apprentice, "larling")):
        if flag:
            params.append((name, "true"))
    if no_experience:
        params.append(("experience", "false"))
    if published_minutes:
        if not isinstance(published_minutes, int) or isinstance(published_minutes, bool) or not 1 <= published_minutes <= MAX_MINUTES:
            raise Refused("published-minutes must be a whole number from 1 to %d" % MAX_MINUTES)
        params.append(("published-after", str(published_minutes)))
    if sort not in SORTS:
        raise Refused("sort must be one of: %s" % ", ".join(SORTS))
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_LIMIT:
        raise Refused("limit must be a whole number from 1 to %d" % MAX_LIMIT)
    if not isinstance(offset, int) or isinstance(offset, bool) or not 0 <= offset <= MAX_OFFSET:
        raise Refused("offset must be a whole number from 0 to %d" % MAX_OFFSET)
    params += [("sort", sort), ("limit", str(limit)), ("offset", str(offset))]
    return BASE + "?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D401 — a redirect is an answer, not a road to follow
        return None


def fetch(url: str) -> tuple:
    """(http status, body bytes) of one GET; (0, b"") when the portal did not answer. Never raises, never follows a redirect."""
    if not url.startswith(BASE + "?"):
        raise Refused("only the JobSearch API is asked")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=TIMEOUT_S) as response:
            return response.status, response.read(MAX_BYTES + 1)[:MAX_BYTES + 1]
    except urllib.error.HTTPError as exc:
        return exc.code, b""
    except Exception:  # noqa: BLE001 — a timeout, a DNS failure, a TLS error: no answer
        return 0, b""


def _labels(block) -> list:
    out = []
    for item in (block or []):
        label = item.get("label") if isinstance(item, dict) else None
        if label:
            out.append(_text(label, 60))
    return out[:10]


def shape(ad: dict) -> dict:
    """One ad, to the fixed shape. Texts are cut and cleaned; nothing else leaves."""
    ad = ad if isinstance(ad, dict) else {}
    place = ad.get("workplace_address") if isinstance(ad.get("workplace_address"), dict) else {}
    employer = ad.get("employer") if isinstance(ad.get("employer"), dict) else {}
    details = ad.get("application_details") if isinstance(ad.get("application_details"), dict) else {}
    must = ad.get("must_have") if isinstance(ad.get("must_have"), dict) else {}
    nice = ad.get("nice_to_have") if isinstance(ad.get("nice_to_have"), dict) else {}
    hours = ad.get("working_hours_type") if isinstance(ad.get("working_hours_type"), dict) else {}
    text = ad.get("description") if isinstance(ad.get("description"), dict) else {}
    model = ad.get("workplace_model") if isinstance(ad.get("workplace_model"), dict) else {}
    url = ad.get("webpage_url")
    apply_url = details.get("url")
    return {"id": _text(ad.get("id"), 40), "headline": _text(ad.get("headline")), "employer": _text(employer.get("name")),
            "url": url if isinstance(url, str) and url.startswith("https://") else None,
            "apply_url": apply_url if isinstance(apply_url, str) and apply_url.startswith("https://") else None,
            "municipality": _text(place.get("municipality"), 60) or None, "region": _text(place.get("region"), 60) or None,
            "published": _text(ad.get("publication_date"), 25) or None, "deadline": _text(ad.get("application_deadline"), 25) or None,
            "experience_required": ad.get("experience_required") if isinstance(ad.get("experience_required"), bool) else None,
            "working_hours": _text(hours.get("label"), 40) or None,
            "languages_required": _labels(must.get("languages")), "languages_nice": _labels(nice.get("languages")),
            "remote_hint": (_text(model.get("label"), 40) or None) or (_text(employer.get("workplace"), 40) or None),
            "snippet": _text(text.get("text"), SNIPPET)}


def parse(status: int, body: bytes) -> dict:
    """The answer, to the fixed shape, with the word for the pass log."""
    if status in (401, 403, 429):
        return {"ok": False, "status": "closed", "http": status, "total": 0, "returned": 0, "hits": []}
    if status == 410:
        return {"ok": False, "status": "gone", "http": status, "total": 0, "returned": 0, "hits": []}
    if status != 200 or len(body) > MAX_BYTES:
        return {"ok": False, "status": "closed", "http": status, "total": 0, "returned": 0, "hits": []}
    try:
        data = json.loads(body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {"ok": False, "status": "closed", "http": status, "total": 0, "returned": 0, "hits": []}
    hits = data.get("hits") if isinstance(data, dict) and isinstance(data.get("hits"), list) else []
    total = data.get("total", {}).get("value") if isinstance(data, dict) and isinstance(data.get("total"), dict) else None
    shaped = [shape(h) for h in hits[:MAX_LIMIT]]
    return {"ok": True, "status": "ok" if shaped else "empty", "http": 200,
            "total": total if isinstance(total, int) and not isinstance(total, bool) else len(shaped),
            "returned": len(shaped), "hits": shaped}


def search(fetcher=fetch, **kwargs) -> dict:
    return parse(*fetcher(url_for(**kwargs)))


def _log(result: dict, q: str, kind: str) -> None:
    import scout_pass_log
    argv = ["pass", "--source", SOURCE, "--country", COUNTRY, "--returned", str(result["returned"]), "--query-kind", kind]
    if q:
        argv += ["--query", q]
    if result["status"] != "ok":
        argv += ["--status", result["status"]]
    scout_pass_log.main(argv)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="platsbanken_search", description=__doc__.split("\n")[0])
    ap.add_argument("--q", default="", help="the words of the title (all of them must be in the ad unless --any-word)")
    ap.add_argument("--city", default="", help="one of: %s" % ", ".join(sorted(CITIES)))
    ap.add_argument("--remote", action="store_true")
    ap.add_argument("--no-experience", action="store_true", help="only ads that do not ask for experience")
    ap.add_argument("--trainee", action="store_true")
    ap.add_argument("--apprentice", action="store_true", help="apprenticeship ads (lärling)")
    ap.add_argument("--published-minutes", type=int, default=0, help="only ads new in the last N minutes (1440 = 24 h)")
    ap.add_argument("--sort", default="pubdate-desc", choices=SORTS)
    ap.add_argument("--limit", type=int, default=50)
    ap.add_argument("--offset", type=int, default=0)
    ap.add_argument("--any-word", action="store_true", help="any word may match (the API default); without it all words must")
    ap.add_argument("--log", action="store_true", help="write the pass to the Scout's pass log")
    ap.add_argument("--query-kind", default="other", help="for the pass log: role_language, role, synonym, level, city...")
    args = ap.parse_args(argv)
    try:
        result = search(q=args.q, city=args.city, remote=args.remote, no_experience=args.no_experience, trainee=args.trainee,
                        apprentice=args.apprentice, published_minutes=args.published_minutes, sort=args.sort, limit=args.limit,
                        offset=args.offset, any_word=args.any_word)
    except Refused as exc:
        print("platsbanken_search: refused: %s" % exc, file=sys.stderr)
        return 2
    if args.log:
        _log(result, args.q, args.query_kind)
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return 0 if result["ok"] else 3


if __name__ == "__main__":
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    sys.exit(main())
