#!/usr/bin/env python3
"""scout_language.py — which countries to search for this profile's languages, and drop an ad by language BEFORE opening it.

Measured on a real profile (Swedish native, English fluent): of 100 candidates a Europe-wide job portal returned,
100 were dropped for language, and the same for every ATS list of a country whose language the profile does not speak.
Each one had cost a search, the fetch of the full ad, and often an INSERT and the Analista's work before it was dropped.
Until now the language rule was a paragraph in the Scout's prompt: no code applied it, and the Scout chose countries
and queries on its own.

Two commands, both reading `languages` from `$JHT_HOME/profile/candidate_profile.yml`:

  plan     for every country in the table: `local` (the profile speaks one of its working languages at business
           level), `english_friendly` (English roles are common there and the profile speaks English) or `english_only`
           (only ads in English are worth opening). Nothing is excluded: this is a PRIORITY, as the Scout's rule SC-04
           asks (priority yes, exclusion no); the per-ad `screen` below is the cut.
  portal   one job board in one country: `skip` when it is a portal in the language of its country (jobs.ch, jobup,
           jobnet, stepstone-de...; EURES by the country searched) and the profile does not speak it. `plan` lists them
           all. ATS lists are never excluded here: the per-ad `screen` cuts them. A portal not in the table is not excluded.
  screen   one candidate, from what the LIST shows (title, and the snippet if the source gives one): `skip_language`
           when the ad needs a language the profile does not speak, `ok`, or `unknown` (not enough text to say). It is
           run before `safe_fetch`/the full JD, so a dropped candidate costs nothing more. It only drops on evidence:
             - an explicit requirement ("native French", "fliessend Deutsch", "Deutschkenntnisse") for a language the
               profile does not speak at business level, unless the same sentence offers a language it does speak
               ("fluent German or English") or says it is a plus;
             - an ad written in a language the profile does not speak (and not English), seen in enough words;
             - a title with the job words of such a language and none of English.
           A language the profile speaks, an English ad, a short or mixed text: never dropped.

Levels are free text in the profile (`native`, `fluent`, `C1`, `madrelingua`, `beginner`...): business level is B2 and
above, an unknown wording gets the benefit of the doubt (it counts as spoken).

What it outputs is a closed set of codes (language codes, a verdict, a reason): never the text it was given. With
`--log` a dropped candidate also leaves its line in the Scout's pass log (`scout_pass_log.py`, outcome `language`, not
opened), so the saving shows in the numbers.

Use:
  python3 scout_language.py plan
  python3 scout_language.py portal --source jobs.ch --country ch        # exit 10 = do not search it
  python3 scout_language.py screen --title "Backend-Entwickler (m/w/d)" --snippet "Wir suchen ..." --country de
  python3 scout_language.py screen --title "..." --source greenhouse --country nl --log     # exit 10 = skip_language
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ── the languages, by the names people write for them (in the product's seven languages and in themselves) ────────────
# The words themselves (the names of each language, its distinctive function words, the job words of its titles) are data,
# not code: they live in scout_language_lexicon.json beside this file. A language is added there.
def _lexicon() -> dict:
    return json.loads((HERE / "scout_language_lexicon.json").read_text(encoding="utf-8"))


_LEXICON = _lexicon()
LANGUAGE_NAMES = _LEXICON["names"]

# ── where a language is a working language ───────────────────────────────────────────────────────────────────────────
COUNTRY_LANGUAGES = {
    "de": ("de",), "at": ("de",), "ch": ("de", "fr", "it"), "li": ("de",), "lu": ("fr", "de"),
    "be": ("nl", "fr", "de"), "nl": ("nl",), "fr": ("fr",), "es": ("es",), "pt": ("pt",), "it": ("it",),
    "se": ("sv",), "dk": ("da",), "no": ("no",), "fi": ("fi", "sv"), "is": (),
    "pl": ("pl",), "cz": ("cs",), "sk": ("sk",), "hu": ("hu",), "ro": ("ro",), "bg": ("bg",), "hr": ("hr",),
    "si": ("sl",), "gr": ("el",), "cy": ("el", "tr", "en"), "ee": ("et",), "lv": ("lv",), "lt": ("lt",),
    "ie": ("en",), "gb": ("en",), "mt": ("en",), "tr": ("tr",),
}
# Where roles in English are common enough that an English-speaking profile is worth a query (Amsterdam, Zurich,
# Luxembourg, Lisbon, the Nordics...). Elsewhere only the ads that are in English are worth opening.
ENGLISH_FRIENDLY = frozenset({"nl", "se", "dk", "fi", "no", "lu", "ie", "gb", "mt", "ch", "be", "pt", "ee", "lv", "lt", "cy", "is"})
ENGLISH_QUALIFIERS = ("English-speaking", "international team", "English required")

# ── levels ───────────────────────────────────────────────────────────────────────────────────────────────────────────
_NATIVE = ("native", "mother", "madrelingua", "bilingual", "bilingue", "c2", "muttersprach", "maternelle", "materna",
           "anyanyelv", "nativo", "moedertaal", "modersmal", "ana dili", "lingua materna")
_BUSINESS = ("fluent", "fluente", "fluido", "courant", "fliessend", "flytande", "vloeiend", "advanced", "avanzado",
             "avance", "avanzato", "c1", "proficient", "professional", "business", "working", "folyekony", "full", "excellent",
             "ottimo", "perfect", "upper", "b2", "good", "buono", "bueno", "bon", "gut", "jo", "intermediate", "medio")
_BASIC = ("beginner", "basic", "elementary", "a1", "a2", "b1", "scolastico", "notions", "base", "principiante",
          "conversational", "conversazione", "basico", "debutant", "anfanger", "alapfok", "limited", "survival")


def fold(text: str) -> str:
    """Lowercase, without accents: `Español` and `espanol` are the same word."""
    text = unicodedata.normalize("NFKD", str(text or "").lower().replace("ß", "ss"))
    return "".join(c for c in text if not unicodedata.combining(c))


def level_score(level: str) -> int:
    """0-5; business level is 3 and above. Unknown wording: 3 (the benefit of the doubt: never drop on a guess)."""
    text = fold(level)
    if any(k in text for k in _NATIVE):
        return 5
    if any(re.search(r"\b%s\b" % re.escape(k), text) for k in _BASIC):
        return 1
    if any(k in text for k in _BUSINESS):
        return 4
    return 3


_NAME_TO_CODE = {name: code for code, names in LANGUAGE_NAMES.items() for name in names.split()}
# Word forms that are not safe as stand-alone names ("dan", "roman", "finn", "sved", "lett"...) are matched whole.


def language_code(name: str):
    folded = fold(name).strip()
    if folded in _NAME_TO_CODE:
        return _NAME_TO_CODE[folded]
    for token in re.findall(r"[a-z]+", folded):
        if token in _NAME_TO_CODE:
            return _NAME_TO_CODE[token]
    return None


def read_languages(profile_path=None) -> dict:
    """{code: level score} from the profile's `languages`. {} when the profile or the field cannot be read."""
    path = Path(profile_path) if profile_path else Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht")) / "profile" / "candidate_profile.yml"
    try:
        import yaml
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:  # noqa: BLE001 — no profile, no yaml, a broken file: no answer, never a guess
        return {}
    raw = data.get("languages") if isinstance(data, dict) else None
    if raw is None and isinstance(data, dict) and isinstance(data.get("candidate"), dict):
        raw = data["candidate"].get("languages")
    raw = raw if isinstance(raw, list) else ([raw] if raw else [])
    spoken = {}
    for item in raw:
        if isinstance(item, dict):
            name, level = item.get("language", item.get("name")), item.get("level", "")
        else:
            name, level = str(item), str(item)
        code = language_code(name)
        if code:
            spoken[code] = max(spoken.get(code, 0), level_score(level))
    return spoken


def business_languages(spoken: dict) -> frozenset:
    return frozenset(code for code, score in spoken.items() if score >= 3)


# ── plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
def plan(spoken: dict) -> dict:
    ok = business_languages(spoken)
    countries = {}
    for country, langs in COUNTRY_LANGUAGES.items():
        local = sorted(set(langs) & ok)
        if local:
            mode = "local"
        elif "en" in ok and country in ENGLISH_FRIENDLY:
            mode = "english_friendly"
        else:
            mode = "english_only"
        entry = {"mode": mode, "languages": list(langs)}
        if mode != "local":
            entry["qualifiers"] = list(ENGLISH_QUALIFIERS)
        countries[country] = entry
    order = {"local": 0, "english_friendly": 1, "english_only": 2}
    ranked = sorted(countries, key=lambda c: (order[countries[c]["mode"]], c))
    eures = {c: portal_verdict("eures", c, spoken)["verdict"] for c in COUNTRY_LANGUAGES}
    return {"spoken": sorted(ok), "english": "en" in ok, "order": ranked, "countries": countries,
            "portals": portals(spoken), "eures": eures}


# ── the job boards written in the language of their country ──────────────────────────────────────────────────────────
# A portal of ONE country whose ads are in that country's language is worth searching only when the profile speaks it:
# on a real run jobs.ch dropped 6 of 7 for language, jobup 4 of 4, jobnet 2 of 2, jobscout24 3 of 3. The ATS lists
# (Greenhouse, Lever, Ashby, Workday, SmartRecruiters...) are NOT here: they carry ads in several languages, English among
# them, and the per-ad `screen` is what cuts them. A portal that is not in this table is never excluded.
# slug (lowercase, dots and spaces as dashes) -> (country, the languages its ads are in)
LOCAL_PORTALS = {
    "jobs-ch": ("ch", ("de", "fr", "it")), "jobup": ("ch", ("fr",)), "jobscout24": ("ch", ("de",)),
    "jobnet": ("dk", ("da",)), "jobindex": ("dk", ("da",)),
    "stepstone-de": ("de", ("de",)), "stepstone-at": ("at", ("de",)), "stepstone-nl": ("nl", ("nl",)),
    "xing": ("de", ("de",)), "karriere-at": ("at", ("de",)),
    "infojobs": ("es", ("es",)), "francetravail": ("fr", ("fr",)), "pole-emploi": ("fr", ("fr",)), "apec": ("fr", ("fr",)),
    "profession-hu": ("hu", ("hu",)), "pracuj-pl": ("pl", ("pl",)), "net-empregos": ("pt", ("pt",)),
    "finn-no": ("no", ("no",)), "nav-no": ("no", ("no",)),
    "jobbsafari": ("se", ("sv",)), "arbetsformedlingen-se": ("se", ("sv",)), "arbetsformedlingen": ("se", ("sv",)),
}
# EURES lists the ads of every country in the language of that country: what it is worth depends on the country searched.
COUNTRY_PORTALS = frozenset({"eures"})


def portal_slug(source: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", fold(source)).strip("-")


def portal_verdict(source: str, country: str, spoken: dict) -> dict:
    """`search`, `skip` (a local-language portal the profile cannot read) or `unknown` (not in the table, or no way to say)."""
    ok = business_languages(spoken)
    if not ok:
        return {"verdict": "unknown", "reason": "no_profile_languages"}
    slug = portal_slug(source)
    country = fold(country).strip()
    if slug in COUNTRY_PORTALS:
        langs = COUNTRY_LANGUAGES.get(country)
        if not langs:
            return {"verdict": "unknown", "reason": "country_needed"}
    elif slug in LOCAL_PORTALS:
        langs = LOCAL_PORTALS[slug][1]
    else:
        return {"verdict": "unknown", "reason": "not_in_table"}
    if set(langs) & ok or "en" in langs:
        return {"verdict": "search", "reason": "language_spoken"}
    return {"verdict": "skip", "reason": "local_language_required", "languages": sorted(langs)}


def portals(spoken: dict) -> dict:
    return {slug: portal_verdict(slug, "", spoken)["verdict"] for slug in LOCAL_PORTALS}


# ── screen ───────────────────────────────────────────────────────────────────────────────────────────────────────────
# Distinctive function words (not English, not shared between the neighbours) and the job words that give a language away in
# a title with nothing else, each specific to its language: folded, in the lexicon.
STOPWORDS = _LEXICON["stopwords"]
TITLE_WORDS = _LEXICON["title_words"]
GENDER_MARKS = {"de": re.compile(r"\((?:m/w/d|w/m/d|m/w/x|d/m/w)\)"), "nl": re.compile(r"\((?:m/v/x|m/v)\)"),
                "fr": re.compile(r"\((?:h/f|f/h)\)")}
ENGLISH_TITLE = frozenset("software engineer developer manager analyst designer scientist consultant specialist lead "
                          "architect intern director product data security devops".split())

# Words that say HOW WELL the language is needed, close to its name ("fluent Czech", "Deutsch fliessend"), and words that
# only say it is needed ("required", "mandatory"), which count only right next to the name: "a Czech company, English
# required" asks for English, not for Czech.
_LEVEL_WORDS = [fold(w) for w in (
    "native", "mother tongue", "fluent", "fluency", "proficiency", "proficient", "advanced", "c1", "c2", "excellent",
    "bilingual", "business level", "business fluent", "verhandlungssicher", "fliessend", "muttersprachlich",
    "sehr gute", "kenntnisse", "vloeiend", "moedertaal", "uitstekende", "goede beheersing", "courant", "bilingue",
    "maitrise", "langue maternelle", "fluido", "nativo", "dominio", "madrelingua", "ottima conoscenza", "fluente",
    "flytande", "goda kunskaper", "flydende", "sujuva", "biegla znajomosc", "plynule")]
_NEED_WORDS = [fold(w) for w in (
    "mandatory", "required", "must", "imprescindible", "obligatoire", "erforderlich", "voraussetzung", "vereist",
    "requerido", "richiesto", "obbligatoria", "necessary", "essential")]
_SOFT = [fold(w) for w in (
    "nice to have", "a plus", "is a plus", "plus", "advantage", "bonus", "preferred", "desirable", "von vorteil",
    "wunschenswert", "pluspunt", "atout", "deseable", "gradito", "vantaggio", "meriterande", "mit fordel", "ein plus")]
_ALTERNATIVES = ("or", "oder", "ou", "o", "of", "eller", "vagy", "oppure", "ofwel", "sau", "/")
_LEVEL_REACH = 24
_NEED_REACH = 14
_SENTENCE_END = ".!?;\n"


def _name_pattern(names: str):
    """The names of a language that are safe to find inside running text (the short ambiguous ones are left out)."""
    safe = [n for n in names.split() if len(n) >= 5]
    if not safe:
        return None
    return re.compile(r"\b(?:%s)\w*" % "|".join(re.escape(n) for n in sorted(safe, key=len, reverse=True)))


_NAME_PATTERN = {code: pattern for code, pattern in
                 ((code, _name_pattern(names)) for code, names in LANGUAGE_NAMES.items()) if pattern}
_COMPOUND = re.compile(r"\b(deutsch|niederlandisch|franzosisch|englisch|spanisch|italienisch|schwedisch|polnisch)kenntnisse")


_SENTENCE_REACH = 400   # a sentence longer than this is cut: a text with no full stop must not cost a scan of all of it per match


def _sentence(folded: str, start: int, end: int) -> tuple:
    floor = max(0, start - _SENTENCE_REACH)
    left = max((folded.rfind(c, floor, start) for c in _SENTENCE_END), default=-1) + 1
    left = max(left, floor)
    ceil = min(len(folded), end + _SENTENCE_REACH)
    rights = [i for i in (folded.find(c, end, ceil) for c in _SENTENCE_END) if i != -1]
    return left, (min(rights) if rights else ceil)


def _needs(folded: str, match, left: int, right: int) -> bool:
    """The sentence asks for the language of `match` by degree ("fluent Czech") or flatly right next to it."""
    near = folded[max(left, match.start() - _LEVEL_REACH): min(right, match.end() + _LEVEL_REACH)]
    if any(word in near for word in _LEVEL_WORDS):
        return True
    close = folded[max(left, match.start() - _NEED_REACH): min(right, match.end() + _NEED_REACH)]
    return any(word in close for word in _NEED_WORDS)


TEXT_CAP = 20000   # characters read of an ad: the requirements are at the top, and a 120 KB hostile text cost 11.6 s of CPU


def required_missing(text: str, ok: frozenset) -> list:
    """Languages the text asks for in so many words that the profile does not speak at business level.

    Reads the first TEXT_CAP characters, and stops looking for a language at the first sentence that asks for it."""
    folded = fold((text or "")[:TEXT_CAP])
    missing = set()
    for code, pattern in _NAME_PATTERN.items():
        if code in ok:
            continue
        for match in pattern.finditer(folded):
            left, right = _sentence(folded, match.start(), match.end())
            if not _needs(folded, match, left, right):
                continue
            sentence = folded[left:right]
            if any(soft in sentence for soft in _SOFT):
                continue
            if (any(f" {w} " in f" {sentence} " or w == "/" and "/" in sentence for w in _ALTERNATIVES)
                    and any(other in ok and other in _NAME_PATTERN and _NAME_PATTERN[other].search(sentence)
                            for other in LANGUAGE_NAMES)):
                continue  # "fluent German or English": it offers a language the profile speaks (but "German AND English" does not)
            missing.add(code)
            break         # asked for once is enough: the rest of the text cannot change the answer for this language
    for match in _COMPOUND.finditer(folded):
        code = language_code(match.group(1))
        if code and code not in ok:
            left, right = _sentence(folded, match.start(), match.end())
            if not any(soft in folded[left:right] for soft in _SOFT):
                missing.add(code)
    return sorted(missing)


_STOPWORD_SETS = {code: frozenset(words) for code, words in STOPWORDS.items()}


def ad_language(text: str):
    """(code, hits) of the language the text is written in, or (None, 0) when it cannot say."""
    tokens = re.findall(r"[a-z]+", fold((text or "")[:TEXT_CAP]))
    if len(tokens) < 12:
        return None, 0
    hits = {code: sum(1 for t in tokens if t in words) for code, words in _STOPWORD_SETS.items()}
    ranked = sorted(hits.items(), key=lambda kv: -kv[1])
    (best, top), (_, second) = ranked[0], ranked[1]
    if top >= 4 and top >= 2 * second + 1 and top / len(tokens) >= 0.12:
        return best, top
    return None, 0


def title_language(title: str):
    """A language whose job words (or gender mark) the title has, with no English job word beside them."""
    folded = fold(title)
    tokens = set(re.findall(r"[a-z]+", folded))
    if tokens & ENGLISH_TITLE:
        return None
    for code, words in TITLE_WORDS.items():
        if tokens & set(words) or (code in GENDER_MARKS and GENDER_MARKS[code].search(folded)
                                   and tokens & set(TITLE_WORDS[code])):
            return code
    return None


def screen(title: str, snippet: str, spoken: dict) -> dict:
    ok = business_languages(spoken)
    if not ok:
        return {"verdict": "unknown", "reason": "no_profile_languages"}
    text = "%s\n%s" % (title or "", snippet or "")
    missing = required_missing(text, ok)
    if missing:
        return {"verdict": "skip_language", "reason": "required_language", "languages": missing}
    written, hits = ad_language(snippet or "")
    if written and written != "en" and written not in ok:
        return {"verdict": "skip_language", "reason": "ad_language", "languages": [written]}
    if not (snippet or "").strip():
        guess = title_language(title)
        if guess and guess not in ok and "en" not in ok:
            return {"verdict": "skip_language", "reason": "title_language", "languages": [guess]}
        if guess and guess not in ok:
            # An English-speaking profile and a title in a language it does not speak: the title alone is weak
            # evidence (the ad may be in English), so it is only a `skip` when two job words agree.
            tokens = re.findall(r"[a-z]+", fold(title))
            if sum(1 for t in tokens if t in set(TITLE_WORDS[guess])) >= 2:
                return {"verdict": "skip_language", "reason": "title_language", "languages": [guess]}
    if written or (snippet or "").strip():
        return {"verdict": "ok" if written else "unknown", "reason": "readable" if written else "short_text"}
    return {"verdict": "unknown", "reason": "title_only"}


def _log(result: dict, args) -> None:
    """A dropped candidate leaves its line in the pass log: language, not opened."""
    if result["verdict"] != "skip_language" or not args.log:
        return
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("scout_pass_log_for_language", HERE / "scout_pass_log.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        argv = ["candidate", "--source", args.source or "unknown", "--country", args.country or "multi", "--outcome", "language"]
        mod.append(mod.build(mod.parser().parse_args(argv)))
    except Exception as exc:  # noqa: BLE001 — the measure never stops the Scout
        print("scout_language: could not write the pass log (%s)" % exc.__class__.__name__, file=sys.stderr)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="scout_language", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("plan", "screen", "portal"):
        p = sub.add_parser(name)
        p.add_argument("--profile", default=None, help="default: $JHT_HOME/profile/candidate_profile.yml")
    q = sub.choices["portal"]
    q.add_argument("--source", required=True)
    q.add_argument("--country", default="")
    s = sub.choices["screen"]
    s.add_argument("--title", required=True)
    s.add_argument("--snippet", default="")
    s.add_argument("--country", default="")
    s.add_argument("--source", default="")
    s.add_argument("--log", action="store_true", help="write a dropped candidate to the pass log")
    args = ap.parse_args(argv)
    spoken = read_languages(args.profile)
    if args.cmd == "plan":
        print(json.dumps(plan(spoken), sort_keys=True))
        return 0
    if args.cmd == "portal":
        verdict = portal_verdict(args.source, args.country, spoken)
        print(json.dumps(verdict, sort_keys=True))
        return 10 if verdict["verdict"] == "skip" else 0
    result = screen(args.title, args.snippet, spoken)
    _log(result, args)
    print(json.dumps(result, sort_keys=True))
    return 10 if result["verdict"] == "skip_language" else 0


if __name__ == "__main__":
    sys.exit(main())
