#!/usr/bin/env python3
"""cover_letter_check.py — the deterministic half of a cover letter's quality control.

A cover letter has no second reader unless something makes one. This script is the part of the review that
needs no judgement and no model: it checks the letter's text against what the team knows (the candidate's
profile, summaries and sources, and the job description) and says, with stable codes, whether the letter may
go to the Critic and, after the Critic, to the person.

HARD — one of these and the letter is redone (zero tolerance: a letter that claims what the profile does not
say is a product failure, rule T10 / S-03):
  unsupported_number   a number in the letter that is neither in the profile (summaries and sources included)
                       nor in the job description
  unsupported_term     a tool or technology named in the letter that the profile does not have, in a sentence
                       that does not say the person lacks it ("I have no experience with dbt" is a declared gap
                       and passes; "I built dbt models" does not)
  placeholder          `<...>`, `[Your name]`, `{{...}}`, TODO, XXX, lorem ipsum: something left to fill in
  wrong_language       the text is clearly written in a language other than the user's (RULE-T14)
  length               fewer than 150 or more than 500 words
  no_company           the letter never names the company
  opening_cliche       an opening the cv-structure skill bans ("I am writing to express my interest", "Please
                       find attached my CV", "I would be honoured"), in the seven languages
SOFT — signals, they do not fail the letter: words outside 250-400, buzzwords the skill bans, the gaps the letter
declares (`gaps_declared`: a letter that admits a missing requirement is more honest, and the Critic is told).

What it cannot check (the Critic does, from the CV): an employer, a project, a degree or a role that is not in
the profile and has no number or tool in its name. The profile is read here, by this script, and never by the
Critic (CR-01: the review stays blind).

    python3 cover_letter_check.py --letter FILE --company NAME [--jd FILE] [--profile-dir DIR] [--lang xx] [--json]

Exit codes:  0 → no HARD finding  ·  1 → at least one HARD finding (the codes are in the output)
             2 → cannot check (no letter, no profile, unreadable): NOT a pass.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

MIN_WORDS_HARD = 150
MAX_WORDS_HARD = 500
MIN_WORDS_SOFT = 250
MAX_WORDS_SOFT = 400
LANGUAGES = ("en", "it", "hu", "es", "de", "fr", "pt")

# Numbers the cover-letter schema of cv-structure itself uses ("what I would do in the first 90 days").
SCHEMA_NUMBERS = frozenset({"30", "60", "90"})

# Tools and technologies that are named the same in every language. Matching is on whole tokens.
TOOLS = (
    "SQL", "Python", "Power BI", "PowerBI", "DAX", "Excel", "Power Query", "pandas", "dbt", "Snowflake", "Airflow", "Spark",
    "PySpark", "Scala", "Tableau", "Looker", "Metabase", "Qlik", "Docker", "Kubernetes", "AWS", "Azure", "GCP", "Databricks",
    "BigQuery", "Redshift", "TensorFlow", "Keras", "Scikit-Learn", "scikit-learn", "PyTorch", "Pentaho", "Git", "Bash",
    "PowerShell", "CI/CD", "Salesforce", "SAP", "Jira", "Hadoop", "Kafka", "MongoDB", "PostgreSQL", "MySQL", "Oracle", "Java",
    "JavaScript", "TypeScript", "Node.js", "Django", "Terraform", "Ansible", "Jenkins", "Data Vault", "MLflow", "Alteryx",
    "HubSpot", "CRM", "ERP", "Figma", "Photoshop", "Illustrator", "PHP", "Kotlin", "C++", "C#", ".NET", "MATLAB", "SPSS",
    "Stata", "Elasticsearch", "Redis", "GraphQL",
)
# Words that are also a tool's name (Go, R, Spring, Swift, React, Vue...) are left out on purpose: in a letter they are
# ordinary words far more often than tools, and a false HARD costs a rewrite. The shape check below still catches C++, C#.
# A token that looks like a technology without being on the list: C++, C#, Node.js, CamelCase.
TECH_SHAPE = re.compile(r"(?<![\w])(?:[A-Za-z]{1,12}(?:\+\+|#)|\.NET|[A-Za-z]+\.js|[A-Za-z]{2,}/[A-Za-z]{2,}|[A-Z]?[a-z]+[A-Z][A-Za-z]+)(?![\w])")
NOT_TECH = frozenset({"LinkedIn", "YouTube", "PhD", "McDonald", "iPhone", "WhatsApp", "PayPal", "GitHub's"})

# Words that say the person LACKS something (a declared gap), by language, as whole words.
NEGATION = {
    "en": r"not|no|never|without|lack|lacking|yet|haven't|don't|didn't|none",
    "it": r"non|senza|mai|ancora|manc\w+|nessun\w*|purtroppo|però",
    "es": r"no|sin|nunca|todavía|aún|ningun\w*|carezco|falta",
    "fr": r"ne|pas|sans|jamais|aucun\w*|manque|n'ai",
    "de": r"nicht|kein\w*|ohne|nie|fehlt|leider",
    "pt": r"não|sem|nunca|ainda|nenhum\w*|falta",
    "hu": r"nem|nincs|nélkül|soha|hiányzik|sajnos|még",
}
NEGATION_RE = {lang: re.compile(r"(?<![\w'])(?:" + words + r")(?![\w'])", re.I) for lang, words in NEGATION.items()}

# Openings cv-structure bans in a cover letter ("effort that ends with nothing"), lowercase, per language.
CLICHES = {
    "en": ("i am writing to express", "i'm writing to express", "please find attached", "i would be honoured", "i would be honored"),
    "it": ("scrivo per esprimere", "in allegato troverà", "in allegato il mio cv", "sarebbe un onore", "sarei onorat"),
    "es": ("escribo para expresar", "adjunto encontrará", "sería un honor"),
    "fr": ("je vous écris pour exprimer", "veuillez trouver ci-joint", "ci-joint mon cv", "ce serait un honneur"),
    "de": ("hiermit möchte ich", "bitte finden sie anbei", "anbei mein lebenslauf", "es wäre mir eine ehre"),
    "pt": ("escrevo para expressar", "por favor encontre em anexo", "teria a honra"),
    "hu": ("azért írok, hogy kifejezzem", "mellékelten", "megtiszteltetés lenne"),
}
# The English forms are also refused in every language: the skill's examples are in English.
BUZZWORDS = (
    "passionate about", "results-driven", "dynamic professional", "team player", "appassionato di", "appassionata di",
    "orientato ai risultati", "orientata ai risultati", "apasionado por", "orientado a resultados", "passionné par",
    "orienté résultats", "leidenschaftlich", "ergebnisorientiert", "apaixonado por",
)
# TODO is case-sensitive on purpose: "todo" is Portuguese and Spanish for "all".
PLACEHOLDER = re.compile(r"<[^>\n]{1,60}>|\{\{[^}\n]{1,60}\}\}|\[[^\]\n]{2,40}\](?!\()|\bTODO\b|\bXXX+\b|(?i:lorem ipsum)")
EMAIL_OR_URL = re.compile(r"\S{1,200}@\S{1,200}|https?://\S{1,300}|www\.\S{1,300}")
PHONE = re.compile(r"\+?\d[\d ()./-]{7,20}\d")
DATE_LINE = re.compile(r"^\W*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\W*$")
NUMBER = re.compile(r"\d+(?:[.,]\d+)?")


# Nothing here is a letter or a profile that long: a bigger file is refused (exit 2) instead of fed to the regexes.
MAX_BYTES = 512 * 1024


class CannotCheck(Exception):
    """The check could not run: that is an exit 2, never a pass."""


def _read(path: Path) -> str:
    try:
        if path.stat().st_size > MAX_BYTES:
            raise CannotCheck(f"{path}: larger than {MAX_BYTES} bytes")
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise CannotCheck(f"{path}: {exc}") from exc


def profile_text(profile_dir: Path) -> str:
    """The facts the team has about the person: the profile file, the summaries and the sources (text only)."""
    main = profile_dir / "candidate_profile.yml"
    if not main.is_file():
        raise CannotCheck(f"{main}: no profile to check the letter against")
    parts = [_read(main)]
    for sub in ("summaries", "sources"):
        folder = profile_dir / sub
        if not folder.is_dir():
            continue
        for item in sorted(folder.iterdir()):
            if item.is_file() and item.suffix.lower() in (".md", ".txt", ".yml", ".yaml", ".json"):
                try:
                    if item.stat().st_size <= MAX_BYTES:
                        parts.append(item.read_text(encoding="utf-8"))
                except (OSError, UnicodeDecodeError):
                    continue  # a binary, oversized or unreadable source is not a fact the check can use
    # A YAML comment is not a fact about the person.
    return "\n".join(line for line in "\n".join(parts).splitlines() if not line.lstrip().startswith("#"))


def _words(text: str) -> list[str]:
    return re.findall(r"[\w'’-]+", text, re.UNICODE)


def _normalise_number(raw: str) -> str:
    return raw.replace(",", ".").rstrip(".")


def numbers_in(text: str, *, today: datetime.date | None = None) -> set[str]:
    """The numbers a text carries, without the ones that are not claims: contacts, dates and this year."""
    year = str((today or datetime.date.today()).year)
    kept = []
    for line in text.splitlines():
        if DATE_LINE.match(line):
            continue
        line = EMAIL_OR_URL.sub(" ", line)
        line = PHONE.sub(" ", line)
        kept.append(line)
    found = {_normalise_number(n) for n in NUMBER.findall("\n".join(kept))}
    found.discard(year)
    return found


def _has_term(text: str, term: str) -> bool:
    """`term` as a whole token: SQL is not in MySQL, C is not in C++, and short names are case-sensitive."""
    flags = 0 if len(term) <= 3 else re.I
    # A hyphen after the name is fine ("dbt-vel", "Snowflake-Data-Warehouse"); a letter, digit, + # or / is another name.
    tail = r"(?!\w)" if term[-1] in "+#" else r"(?![\w+#/])"
    return re.search(r"(?<![\w-])" + re.escape(term) + tail, text, flags) is not None


def _squash(text: str) -> str:
    return re.sub(r"[\s.\-]", "", text.lower())


def _in_profile(profile: str, squashed_profile: str, term: str) -> bool:
    """The profile has the term as written, or (for names of 4 letters or more) as Power BI / PowerBI, Node.js / nodejs."""
    return _has_term(profile, term) or (len(term) >= 4 and _squash(term) in squashed_profile)


def _tech_tokens(sentence: str, company: str) -> set[str]:
    """The technology-looking tokens of a sentence: the ones on the list and the ones shaped like a tool."""
    found = {t for t in TOOLS if _has_term(sentence, t)}
    company_words = {w.lower() for w in _words(company)}
    for match in TECH_SHAPE.findall(sentence):
        if match in NOT_TECH or match.lower() in company_words:
            continue
        found.add(match)
    return found


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def analyze(
    letter: str,
    *,
    profile: str,
    jd: str = "",
    company: str = "",
    lang: str | None = None,
    today: datetime.date | None = None,
) -> dict:
    """The check, on texts: the letter, the profile's facts, the job description, the company and the user's language."""
    import text_language

    expected = lang if lang in LANGUAGES else text_language.user_language()
    hard: list[dict] = []
    soft: list[dict] = []
    info: dict = {}

    body = "\n".join(line for line in letter.splitlines() if not line.startswith("#")).strip()
    words = _words(body)
    info["words"] = len(words)
    info["expected_language"] = expected
    if len(words) < MIN_WORDS_HARD or len(words) > MAX_WORDS_HARD:
        hard.append({"code": "length", "detail": f"{len(words)} words (allowed {MIN_WORDS_HARD}-{MAX_WORDS_HARD}, aim {MIN_WORDS_SOFT}-{MAX_WORDS_SOFT})"})
    elif not MIN_WORDS_SOFT <= len(words) <= MAX_WORDS_SOFT:
        soft.append({"code": "words_out_of_range", "detail": f"{len(words)} words (aim {MIN_WORDS_SOFT}-{MAX_WORDS_SOFT})"})

    guessed = text_language.guess_language(body)
    info["language"] = guessed
    if guessed is not None and guessed != expected:
        hard.append({"code": "wrong_language", "detail": f"the letter reads as {guessed}, the user's language is {expected}"})

    if PLACEHOLDER.search(body):
        hard.append({"code": "placeholder", "detail": PLACEHOLDER.search(body).group(0)[:60]})

    first_name = (company.split() or [""])[0]
    if first_name and first_name.lower() not in letter.lower():
        hard.append({"code": "no_company", "detail": f"the letter never names {company}"})

    opening = body[:200].lower()
    refused = [c for lang_code in LANGUAGES for c in CLICHES[lang_code] if c in opening]
    if refused:
        hard.append({"code": "opening_cliche", "detail": refused[0]})

    allowed = numbers_in(profile, today=today) | numbers_in(jd, today=today) | SCHEMA_NUMBERS
    extra = sorted(numbers_in(body, today=today) - allowed)
    if extra:
        hard.append({"code": "unsupported_number", "detail": ", ".join(extra)})

    negation = NEGATION_RE[expected]
    squashed = _squash(profile)
    invented: list[str] = []
    gaps: list[str] = []
    for sentence in _sentences(body):
        for term in sorted(_tech_tokens(sentence, company)):
            if _in_profile(profile, squashed, term):
                continue
            if negation.search(sentence):
                if term not in gaps:
                    gaps.append(term)
            elif term not in invented:
                invented.append(term)
    if invented:
        hard.append({"code": "unsupported_term", "detail": ", ".join(invented)})
    info["gaps_declared"] = gaps

    lowered = body.lower()
    for phrase in BUZZWORDS:
        if phrase in lowered:
            soft.append({"code": "buzzword", "detail": phrase})
    return {"ok": not hard, "hard": hard, "soft": soft, "info": info}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic quality check of a cover letter against the profile.")
    parser.add_argument("--letter", required=True, help="the letter, markdown or text")
    parser.add_argument("--company", default="", help="the company of the position")
    parser.add_argument("--jd", default="", help="a text file with the job description")
    parser.add_argument("--profile-dir", default="", help="default: $JHT_HOME/profile")
    parser.add_argument("--lang", default="", help="the letter's language, default: the user's")
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    args = parser.parse_args(argv)
    try:
        folder = Path(args.profile_dir) if args.profile_dir else Path(os.environ.get("JHT_HOME", "/jht_home")) / "profile"
        letter = _read(Path(args.letter))
        if not letter.strip():
            raise CannotCheck(f"{args.letter}: the letter is empty")
        jd = _read(Path(args.jd)) if args.jd else ""
        report = analyze(letter, profile=profile_text(folder), jd=jd, company=args.company, lang=args.lang or None)
    except CannotCheck as exc:
        sys.stderr.write(f"cover_letter_check: cannot check: {exc}\n")
        return 2
    if args.json:
        print(json.dumps(report, ensure_ascii=False))
    else:
        status = "OK" if report["ok"] else "HARD"
        print(f"{status} words={report['info']['words']} language={report['info']['language']}")
        for finding in report["hard"]:
            print(f"  HARD {finding['code']}: {finding['detail']}")
        for finding in report["soft"]:
            print(f"  soft {finding['code']}: {finding['detail']}")
        if report["info"]["gaps_declared"]:
            print("  gaps declared: " + ", ".join(report["info"]["gaps_declared"]))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
