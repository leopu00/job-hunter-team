#!/usr/bin/env python3
"""
validate_profile.py — gate runtime del candidate_profile.yml (schema canonico a 3 livelli).

Unico validatore runtime: lo usano sia gli agenti (skill profile-schema/profile-yaml,
post-write) sia il CLI (`jht profile validate`). La definizione tipizzata gemella per il
web e' shared/config/profile-schema.ts: tenere allineati (cross-check CI — follow-up).

Valida:
  - L1 core mandatori: name, target_role, location, experience_years, has_degree,
    seniority_target, skills.primary (>=1), languages (>=1, ognuna language+level)
  - blocks[] (L2/L3) se presenti: key, kind in vocabolario, title, content conforme al kind

Tollerante in transizione (pre-Fase 4): accetta varianti legacy note (languages[].name al
posto di .language; skills come lista piatta) emettendo WARNING non bloccanti. Gli ERROR
sono bloccanti.

Uso:
    python3 validate_profile.py <path/candidate_profile.yml> [--strict] [--json] [--minimum] [--lang XX]
Output:
    VALID_PROFILE   (exit 0)   eventuali "WARN: ..." su stderr
    INVALID_PROFILE (exit 1)   "ERROR: ..." su stderr
Con --strict anche i warning diventano errori (usato dopo la migrazione produttori).
Con --minimum si aggiunge cio' che serve al team per partire (nome, email, ruolo, citta', anni,
2+ competenze, 1+ lingua, 1+ esperienza, 1+ titolo di studio): i campi che mancano sono errori
e, con --json, sotto "missing". Lo usa `jht profile import`.

Lingua (RULE-T14): il testo libero che l'utente legge (narrative, key_points, timeline, summary)
deve essere nella lingua dell'utente (i18n-prefs.json, poi JHT_LANG; `--lang XX` la forza). Un testo
abbastanza lungo e chiaramente in un'altra lingua produce un AVVISO "LANGUAGE: ..." su stderr (e in
--json sotto "language_warnings"): non rende il profilo invalido e non conta in --strict.
"""
import os
import sys
import json

BLOCK_KINDS = {"key_value", "tag_list", "timeline", "narrative", "key_points", "distribution"}
TARGET_ROLE_CATEGORY_IDS = {"software", "data", "product", "design", "business", "security", "other"}
TARGET_ROLE_SPECIALTIES = {
    "software": {"backend", "frontend", "fullstack", "platform", "embedded", "open"},
    "data": {"data_science", "ml", "genai", "data_engineering", "research", "open"},
    "product": {"product", "project", "technical_pm", "delivery", "founder"},
    "design": {"specialist", "generalist", "leadership", "individual", "explore"},
    "business": {"specialist", "generalist", "leadership", "individual", "explore"},
    "security": {"specialist", "generalist", "leadership", "individual", "explore"},
    "other": {"specialist", "generalist", "leadership", "individual", "explore"},
}

errors: list[str] = []
warnings: list[str] = []
language_warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


# Chiavi delle voci di timeline che portano prosa; le altre (date, ruoli, nomi di aziende) non si giudicano.
_TIMELINE_PROSE_KEYS = ("description", "summary", "text", "detail")


def _prose(profile):
    """(dove, testo) per il testo libero che l'utente legge nel profilo."""
    if _is_str(profile.get("summary")):
        yield "summary", profile["summary"]
    blocks = profile.get("blocks")
    if not isinstance(blocks, list):
        return
    for i, b in enumerate(blocks):
        if not isinstance(b, dict):
            continue
        where = f"blocks[{i}]" + (f" ({b['key']})" if _is_str(b.get("key")) else "")
        content = b.get("content")
        if b.get("kind") == "narrative" and _is_str(content):
            yield where, content
        elif b.get("kind") == "key_points" and isinstance(content, list):
            for j, it in enumerate(content):
                if isinstance(it, dict) and _is_str(it.get("text")):
                    yield f"{where}.content[{j}]", it["text"]
        elif b.get("kind") == "timeline" and isinstance(content, list):
            for j, it in enumerate(content):
                if isinstance(it, dict):
                    for k in _TIMELINE_PROSE_KEYS:
                        if _is_str(it.get(k)):
                            yield f"{where}.content[{j}].{k}", it[k]


def check_language(profile, expected=None) -> None:
    """Avvisa (mai rifiuta) sul testo libero che è chiaramente in una lingua diversa da quella dell'utente."""
    # `python3 -I` (and an import from elsewhere) leaves the script's folder off sys.path.
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    try:
        import text_language
    except ImportError:
        return
    expected = expected or text_language.user_language()
    for where, text in _prose(profile):
        found = text_language.wrong_language(text, expected)
        if found:
            language_warnings.append(
                f"LANGUAGE: {where} looks {found}, the user's language is {expected}: rewrite it in {expected}"
            )


def _is_str(v) -> bool:
    return isinstance(v, str) and v.strip() != ""


def _require_str(obj, key, where):
    if not _is_str(obj.get(key)):
        err(f"{where}.{key}: non-empty string required")


def validate_languages(langs):
    if not isinstance(langs, list) or len(langs) == 0:
        err("languages: list with at least one entry required")
        return
    for i, l in enumerate(langs):
        if not isinstance(l, dict):
            err(f"languages[{i}]: object required")
            continue
        name = l.get("language")
        if not _is_str(name):
            if _is_str(l.get("name")):
                warn(f"languages[{i}]: use 'language' (not 'name') — canonical key")
            else:
                err(f"languages[{i}].language: required")
        if not _is_str(l.get("level")):
            err(f"languages[{i}].level: required")


def validate_skills(skills):
    if isinstance(skills, dict):
        prim = skills.get("primary")
        if not isinstance(prim, list) or len([s for s in prim if _is_str(s)]) < 1:
            err("skills.primary: at least one skill required")
    elif isinstance(skills, list):
        warn("skills: legacy flat list — use { primary: [...], secondary: [...] }")
        if len([s for s in skills if _is_str(s)]) < 1:
            err("skills: at least one skill required")
    else:
        err("skills: {primary, secondary} object required")


def validate_block_content(kind, content, where):
    if kind == "narrative":
        if not _is_str(content):
            err(f"{where}.content: non-empty text required for kind=narrative")
    elif kind == "tag_list":
        if not isinstance(content, list) or any(not _is_str(x) for x in content):
            err(f"{where}.content: list of strings required for kind=tag_list")
    elif kind == "key_value":
        if not isinstance(content, list):
            err(f"{where}.content: list of {{label,value}} required")
        else:
            for j, it in enumerate(content):
                if not isinstance(it, dict) or not _is_str(it.get("label")):
                    err(f"{where}.content[{j}]: 'label' required")
    elif kind == "key_points":
        if not isinstance(content, list):
            err(f"{where}.content: list of {{heading,text}} required")
        else:
            for j, it in enumerate(content):
                if not isinstance(it, dict) or not _is_str(it.get("heading")):
                    err(f"{where}.content[{j}]: 'heading' required")
    elif kind == "timeline":
        if not isinstance(content, list):
            err(f"{where}.content: list of entries required for kind=timeline")
        else:
            for j, it in enumerate(content):
                if not isinstance(it, dict) or not _is_str(it.get("title")):
                    err(f"{where}.content[{j}]: 'title' required")
    elif kind == "distribution":
        if not isinstance(content, list):
            err(f"{where}.content: list of {{label,value}} required")
        else:
            for j, it in enumerate(content):
                if not isinstance(it, dict) or not _is_str(it.get("label")) or not isinstance(it.get("value"), (int, float)):
                    err(f"{where}.content[{j}]: 'label' (str) + 'value' (num) required")


def validate_blocks(blocks):
    if blocks is None:
        return
    if not isinstance(blocks, list):
        err("blocks: list required")
        return
    seen = set()
    for i, b in enumerate(blocks):
        where = f"blocks[{i}]"
        if not isinstance(b, dict):
            err(f"{where}: object required")
            continue
        _require_str(b, "key", where)
        _require_str(b, "title", where)
        key = b.get("key")
        if _is_str(key):
            if key in seen:
                err(f"{where}.key: duplicate '{key}'")
            seen.add(key)
        kind = b.get("kind")
        if kind not in BLOCK_KINDS:
            err(f"{where}.kind: invalid '{kind}' (allowed: {', '.join(sorted(BLOCK_KINDS))})")
        else:
            validate_block_content(kind, b.get("content"), where)


def validate_target_role_choice(profile):
    category = profile.get("target_role_category_id")
    specialty = profile.get("target_specialty")
    if category is None:
        if specialty is not None:
            err("target_specialty: requires target_role_category_id")
        return
    if category not in TARGET_ROLE_CATEGORY_IDS:
        err("target_role_category_id: invalid canonical ID")
        return
    if specialty is not None and specialty not in TARGET_ROLE_SPECIALTIES[category]:
        err("target_specialty: invalid for target_role_category_id")


def validate(profile) -> None:
    if not isinstance(profile, dict):
        err("(root): profile must be a top-level YAML object")
        return
    for k in ("name", "target_role", "location", "seniority_target"):
        _require_str(profile, k, "(root)")
    ey = profile.get("experience_years")
    if not isinstance(ey, int) or isinstance(ey, bool) or ey < 0:
        err("experience_years: integer >= 0 required")
    if not isinstance(profile.get("has_degree"), bool):
        err("has_degree: boolean required")
    validate_skills(profile.get("skills"))
    validate_languages(profile.get("languages"))
    validate_blocks(profile.get("blocks"))
    validate_target_role_choice(profile)
    check_language(profile, _expected_language)


def _items(*values) -> int:
    """How many entries the first value that is a list has (0 for none)."""
    for v in values:
        if isinstance(v, list):
            return len([x for x in v if x])
    return 0


def _skill_count(skills) -> int:
    if isinstance(skills, dict):
        return len([s for v in skills.values() if isinstance(v, list) for s in v if _is_str(s)])
    if isinstance(skills, list):
        return len([s for s in skills if _is_str(s)])
    return 0


def team_minimum_missing(profile) -> list:
    """What the team needs before it can start, by the names the app uses.

    The floor the Assistant checks before it creates ready.flag (skill profile-yaml) and
    the app's required fields (web/lib/profile-completion.ts, PROFILE_REQUIREMENTS) both
    read these places of the YAML: root, `candidate`, `personal`. Reading the same ones
    here keeps a profile that passes this check from being "not ready" for the app.
    """
    if not isinstance(profile, dict):
        return ["name"]
    cand = profile.get("candidate") if isinstance(profile.get("candidate"), dict) else {}
    pers = profile.get("personal") if isinstance(profile.get("personal"), dict) else {}
    contacts = cand.get("contacts") if isinstance(cand.get("contacts"), dict) else {}
    roles = profile.get("target_roles")
    ey = profile.get("experience_years")
    checks = (
        ("name", _is_str(cand.get("name")) or _is_str(pers.get("name")) or _is_str(profile.get("name"))),
        ("email", _is_str(contacts.get("email")) or _is_str(pers.get("email"))),
        ("target_role", _is_str(cand.get("target_role")) or _is_str(profile.get("target_role"))
            or (isinstance(roles, list) and bool(roles) and _is_str(roles[0]))),
        ("location", _is_str(profile.get("location")) or _is_str(pers.get("location"))),
        ("experience_years", ey is not None and not isinstance(ey, bool)),
        ("skills", _skill_count(cand.get("skills") if cand.get("skills") is not None else profile.get("skills")) >= 2),
        ("languages", _items(cand.get("languages"), profile.get("languages")) >= 1),
        ("experience", _items(cand.get("experience"), profile.get("experience")) >= 1),
        ("education", _items(cand.get("education"), profile.get("education")) >= 1),
    )
    return [key for key, ok in checks if not ok]


_expected_language = None


def main() -> int:
    global _expected_language
    args = [a for a in sys.argv[1:]]
    if "--lang" in args:
        i = args.index("--lang")
        if i + 1 >= len(args):
            print("usage: --lang needs a language code", file=sys.stderr)
            return 2
        _expected_language = args[i + 1]
        del args[i:i + 2]
    strict = "--strict" in args
    as_json = "--json" in args
    minimum = "--minimum" in args
    paths = [a for a in args if not a.startswith("--")]
    if not paths:
        print("usage: validate_profile.py <candidate_profile.yml> [--strict] [--json]", file=sys.stderr)
        return 2
    try:
        import yaml
    except ImportError:
        print("ERROR: pyyaml is not available (import yaml)", file=sys.stderr)
        return 2
    try:
        with open(paths[0], "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except FileNotFoundError:
        print(f"ERROR: file not found: {paths[0]}", file=sys.stderr)
        return 1
    except yaml.YAMLError as e:
        print(f"INVALID_PROFILE\nERROR: YAML could not be parsed: {e}", file=sys.stderr)
        return 1

    validate(data)
    missing = team_minimum_missing(data) if minimum else []
    for key in missing:
        err(f"missing for the team to start: {key}")
    blocking = errors + (warnings if strict else [])

    if as_json:
        out = {"ok": not blocking, "errors": errors, "warnings": warnings,
               "language_warnings": language_warnings}
        if minimum:
            out["missing"] = missing
        print(json.dumps(out))
    else:
        for w in warnings:
            print(f"WARN: {w}", file=sys.stderr)
        for w in language_warnings:
            print(f"WARN: {w}", file=sys.stderr)
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        print("VALID_PROFILE" if not blocking else "INVALID_PROFILE")
    return 0 if not blocking else 1


if __name__ == "__main__":
    sys.exit(main())
