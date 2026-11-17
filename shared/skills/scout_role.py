#!/usr/bin/env python3
"""scout_role.py — is a position PROVABLY outside the trade of the profile?

Measured on two real runs (16/11): a bricklayer in Bari got 32 positions from the Scouts and 22 were another trade (cashier,
counter clerk, steward, sales, office), a lorry driver in Brescia got 19 and 2 were his trade. The Scout read a whole category of
an agency portal and inserted what it found; every one of them cost an INSERT, an analysis and a score, and the Analista excluded it.

The rule (SC-04, fifth mechanical reject, verifiable without judgement): a position whose TITLE AND REQUIREMENTS (and whatever text
the caller has: a list snippet) hold no word of the profile's trade family is refused. The family is declared ONCE by the Scout, in
the words ads use (the trade and its synonyms in the portal's language, the adjacent trades it accepts), because a program cannot
know that «operaio edile» is a «muratore». Everything the Scout declares passes; the Scorer still applies the gap penalty.

  * any doubt is «ok»: no profile, a profile with no `target_role`/`target_roles`, an unreadable profile, no text to compare;
  * the family is declared against a profile's roles: when the roles change the declaration is stale and the Scout declares again;
  * a profile that HAS a role and has no declaration yet: `check` says terms_missing (exit 6) with the command to run; the INSERT goes
    through and prints the same command after it (a position is never refused for a step the Scout has not done yet).

    python3 scout_role.py declare --term muratore --term "operaio edile" --term carpentiere [--agent scout-1]
    python3 scout_role.py show
    python3 scout_role.py reset
    python3 scout_role.py check --title "Cassiere" [--snippet "..."] [--requirements "..."]

`check` prints one JSON line: {"verdict": "ok"|"mismatch"|"terms_missing", ...}. Exit 0 ok, 5 mismatch, 6 terms_missing, 2 usage.
Nothing goes out on the network; the declaration lives in `$JHT_HOME/agents/_team/scout_role_terms.json`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import unicodedata
from pathlib import Path

MISMATCH_EXIT = 5
MISSING_EXIT = 6
MAX_TERMS = 80
MAX_TERM_WORDS = 4
# One word that names no trade: declaring it would let a whole category in (the very defect). A phrase containing it is fine
# («operaio edile»); the word alone is not.
_GENERIC_RAW = """
job jobs work worker workers employee employees staff assistant helper operator officer agent clerk specialist manager
junior senior intern trainee apprentice
lavoro addetto addetta addetti operatore operatrice operatori operaio operai impiegato impiegata collaboratore collaboratrice
assistente aiutante responsabile specialista tecnico tirocinante stagista apprendista
arbeiter mitarbeiter angestellter helfer praktikant
employe employee ouvrier ouvriere agent assistante stagiaire
empleado empleada trabajador operario ayudante becario
trabalhador funcionario ajudante estagiario
munkatars dolgozo segéd
"""


def _plain(text) -> str:
    text = "".join(c for c in unicodedata.normalize("NFKD", str(text).casefold()) if not unicodedata.combining(c))
    return " ".join(re.findall(r"[^\W_]+", text, re.UNICODE))


GENERIC = frozenset(_plain(w) for w in _GENERIC_RAW.split())


def _tokens(text) -> list:
    """The words of a text, one-letter ones left out: «Addetto/a magazzino» is «addetto magazzino» (the gender ending is no word)."""
    return [w for w in _plain(text).split() if len(w) > 1] if isinstance(text, str) and text.strip() else []


def _home() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home")


def terms_path() -> Path:
    return _home() / "agents" / "_team" / "scout_role_terms.json"


def _profile_path(profile=None) -> Path:
    return Path(profile) if profile else _home() / "profile" / "candidate_profile.yml"


def _strings(value) -> list:
    if isinstance(value, str):
        return [value] if value.strip() else []
    if isinstance(value, list):
        return [s for item in value for s in _strings(item)]
    if isinstance(value, dict):
        return [s for item in value.values() for s in _strings(item)]
    return []


def read_roles(profile=None):
    """The role texts of the profile (`target_role`, `target_roles`, `target_roles_priority`, also under `candidate`), or None when
    the profile cannot be read or names no role: then there is nothing to compare with and nothing is refused."""
    try:
        import yaml
        data = yaml.safe_load(_profile_path(profile).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — no profile, no yaml, a half-written file: no answer, never a guess
        return None
    if not isinstance(data, dict):
        return None
    cand = data.get("candidate") if isinstance(data.get("candidate"), dict) else {}
    roles = []
    for source in (data, cand):
        for key in ("target_role", "target_roles", "target_roles_priority"):
            for text in _strings(source.get(key)):
                if text not in roles:
                    roles.append(text)
    return roles or None


def roles_key(roles) -> str:
    plain = sorted({_plain(r) for r in roles if _plain(r)})
    return hashlib.sha256(json.dumps(plain, ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def read_declaration():
    try:
        value = json.loads(terms_path().read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def _write_declaration(value: dict) -> None:
    path = terms_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, sort_keys=True, ensure_ascii=False)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _word_match(term: str, word: str) -> bool:
    """A word of the family against a word of the text. Short words (OSS, IT) must be equal; longer ones share their first letters
    (all but the last two, at least four), so «infermiere» finds «infermiera», «infermieri» and «infermieristica»."""
    if term == word:
        return True
    if len(term) <= 3:
        return False
    k = min(len(term), max(4, len(term) - 2))
    return len(word) >= k and word[:k] == term[:k]


def term_in(term: str, tokens: list) -> bool:
    """A term (one to four words) found in the text as consecutive words."""
    words = [w for w in term.split() if len(w) > 1]
    if not words:
        return False
    for i in range(len(tokens) - len(words) + 1):
        if all(_word_match(w, tokens[i + j]) for j, w in enumerate(words)):
            return True
    # the same trade written joined or apart: «capo cantiere» / «capocantiere», «Maurer meister» / «Maurermeister»
    if len(words) > 1:
        joined = "".join(words)
        if any(_word_match(joined, token) for token in tokens):
            return True
    elif len(words[0]) >= 6:
        if any(_word_match(words[0], tokens[i] + tokens[i + 1]) for i in range(len(tokens) - 1)):
            return True
    return False


def clean_terms(raw) -> tuple:
    """(terms, refused): each term plain, one to four words, never a single generic word."""
    terms, refused = [], []
    for item in raw:
        term = _plain(item)
        words = term.split()
        if not words or len(words) > MAX_TERM_WORDS:
            refused.append({"term": str(item), "why": "empty or longer than %d words" % MAX_TERM_WORDS})
        elif len(words) == 1 and words[0] in GENERIC:
            refused.append({"term": str(item), "why": "names no trade (a whole category would pass): use the trade or a phrase"})
        elif term not in terms:
            terms.append(term)
    return terms, refused


def declare(raw_terms, agent=None, profile=None) -> dict:
    roles = read_roles(profile)
    terms, refused = clean_terms(raw_terms)
    if not roles:
        return {"declared": False, "reason": "the profile names no role: nothing to declare, nothing is refused", "refused": refused}
    key = roles_key(roles)
    current = read_declaration()
    kept = list(current["terms"]) if current and current.get("roles_key") == key and isinstance(current.get("terms"), list) else []
    merged = kept + [t for t in terms if t not in kept]
    if len(merged) > MAX_TERMS:
        return {"declared": False, "reason": "at most %d terms: a family of that size is a category" % MAX_TERMS, "refused": refused}
    if not merged:
        return {"declared": False, "reason": "no usable term", "refused": refused}
    by = set(current.get("by", []) if kept and current else [])
    if agent:
        by.add(agent)
    _write_declaration({"roles_key": key, "terms": merged, "by": sorted(by)})
    return {"declared": True, "terms": merged, "refused": refused}


def verdict(title, requirements=None, snippet=None, profile=None) -> dict:
    roles = read_roles(profile)
    if not roles:
        return {"verdict": "ok", "reason": "the profile names no role to compare with"}
    declaration = read_declaration()
    if not declaration or declaration.get("roles_key") != roles_key(roles) or not declaration.get("terms"):
        return {"verdict": "terms_missing", "roles": roles,
                "reason": "the family of the trade is not declared for these roles (never declared, or the profile's roles changed)"}
    for label, text in (("title", title), ("snippet", snippet), ("requirements", requirements)):
        words = _tokens(text)
        if not words:
            continue
        for term in declaration["terms"]:
            if term_in(term, words):
                return {"verdict": "ok", "term": term, "where": label}
    if not (_tokens(title) or _tokens(requirements) or _tokens(snippet)):
        return {"verdict": "ok", "reason": "no text to compare"}
    return {"verdict": "mismatch", "roles": roles, "reason": "no word of the trade family in the %s" % (
        "title" if not (_tokens(requirements) or _tokens(snippet)) else "title and the text read")}


def check_position(title, requirements=None, snippet=None, profile=None) -> dict:
    """The verdict for one position against the profile. Never raises: a doubt is «ok»."""
    try:
        return verdict(title, requirements, snippet, profile)
    except Exception as exc:  # noqa: BLE001
        return {"verdict": "ok", "reason": "could not compare (%s)" % type(exc).__name__}


def family_state(profile=None) -> dict | None:
    """{"roles", "declared", "terms"} for a profile that names a role, None when it names none (nothing to declare). Never raises."""
    try:
        roles = read_roles(profile)
        if not roles:
            return None
        declaration = read_declaration()
        fresh = bool(declaration and declaration.get("roles_key") == roles_key(roles) and declaration.get("terms"))
        return {"roles": roles, "declared": fresh, "terms": list(declaration["terms"]) if fresh else []}
    except Exception:  # noqa: BLE001
        return None


def declare_hint(roles) -> str:
    return ("python3 /app/shared/skills/scout_role.py declare --term \"<the trade, as ads write it>\" --term \"<a synonym>\" "
            "--term \"<an adjacent trade you accept>\" ...  (roles of the profile: %s)" % "; ".join(roles))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="scout_role", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    d = sub.add_parser("declare")
    d.add_argument("--term", action="append", default=[], required=True)
    d.add_argument("--agent", default=None)
    d.add_argument("--profile", default=None)
    s = sub.add_parser("show")
    s.add_argument("--profile", default=None)
    sub.add_parser("reset")
    c = sub.add_parser("check")
    c.add_argument("--title", required=True)
    c.add_argument("--snippet", default=None)
    c.add_argument("--requirements", default=None)
    c.add_argument("--profile", default=None)
    args = ap.parse_args(argv)

    if args.cmd == "declare":
        out = declare(args.term, args.agent, args.profile)
        print(json.dumps(out, sort_keys=True, ensure_ascii=False))
        return 0 if out["declared"] else 2
    if args.cmd == "show":
        roles = read_roles(args.profile)
        declaration = read_declaration()
        fresh = bool(roles and declaration and declaration.get("roles_key") == roles_key(roles))
        print(json.dumps({"roles": roles, "fresh": fresh, "terms": (declaration or {}).get("terms", []) if fresh else []},
                         sort_keys=True, ensure_ascii=False))
        return 0
    if args.cmd == "reset":
        try:
            terms_path().unlink()
        except FileNotFoundError:
            pass
        print(json.dumps({"reset": True}))
        return 0
    result = check_position(args.title, args.requirements, args.snippet, args.profile)
    if result["verdict"] == "terms_missing":
        result["do"] = declare_hint(result["roles"])
    print(json.dumps(result, sort_keys=True, ensure_ascii=False))
    return {"mismatch": MISMATCH_EXIT, "terms_missing": MISSING_EXIT}.get(result["verdict"], 0)


if __name__ == "__main__":
    sys.exit(main())
