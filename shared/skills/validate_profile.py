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
    python3 validate_profile.py <path/candidate_profile.yml> [--strict] [--json]
Output:
    VALID_PROFILE   (exit 0)   eventuali "WARN: ..." su stderr
    INVALID_PROFILE (exit 1)   "ERROR: ..." su stderr
Con --strict anche i warning diventano errori (usato dopo la migrazione produttori).
"""
import sys
import json

BLOCK_KINDS = {"key_value", "tag_list", "timeline", "narrative", "key_points", "distribution"}

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def _is_str(v) -> bool:
    return isinstance(v, str) and v.strip() != ""


def _require_str(obj, key, where):
    if not _is_str(obj.get(key)):
        err(f"{where}.{key}: stringa non vuota richiesta")


def validate_languages(langs):
    if not isinstance(langs, list) or len(langs) == 0:
        err("languages: lista con almeno 1 voce richiesta")
        return
    for i, l in enumerate(langs):
        if not isinstance(l, dict):
            err(f"languages[{i}]: oggetto richiesto")
            continue
        name = l.get("language")
        if not _is_str(name):
            if _is_str(l.get("name")):
                warn(f"languages[{i}]: usa 'language' (non 'name') — chiave canonica")
            else:
                err(f"languages[{i}].language: richiesto")
        if not _is_str(l.get("level")):
            err(f"languages[{i}].level: richiesto")


def validate_skills(skills):
    if isinstance(skills, dict):
        prim = skills.get("primary")
        if not isinstance(prim, list) or len([s for s in prim if _is_str(s)]) < 1:
            err("skills.primary: almeno 1 competenza richiesta")
    elif isinstance(skills, list):
        warn("skills: lista piatta legacy — usa { primary: [...], secondary: [...] }")
        if len([s for s in skills if _is_str(s)]) < 1:
            err("skills: almeno 1 competenza richiesta")
    else:
        err("skills: oggetto {primary, secondary} richiesto")


def validate_block_content(kind, content, where):
    if kind == "narrative":
        if not _is_str(content):
            err(f"{where}.content: testo non vuoto richiesto per kind=narrative")
    elif kind == "tag_list":
        if not isinstance(content, list) or any(not _is_str(x) for x in content):
            err(f"{where}.content: lista di stringhe richiesta per kind=tag_list")
    elif kind == "key_value":
        if not isinstance(content, list):
            err(f"{where}.content: lista di {{label,value}} richiesta")
        else:
            for j, it in enumerate(content):
                if not isinstance(it, dict) or not _is_str(it.get("label")):
                    err(f"{where}.content[{j}]: 'label' richiesto")
    elif kind == "key_points":
        if not isinstance(content, list):
            err(f"{where}.content: lista di {{heading,text}} richiesta")
        else:
            for j, it in enumerate(content):
                if not isinstance(it, dict) or not _is_str(it.get("heading")):
                    err(f"{where}.content[{j}]: 'heading' richiesto")
    elif kind == "timeline":
        if not isinstance(content, list):
            err(f"{where}.content: lista di voci richiesta per kind=timeline")
        else:
            for j, it in enumerate(content):
                if not isinstance(it, dict) or not _is_str(it.get("title")):
                    err(f"{where}.content[{j}]: 'title' richiesto")
    elif kind == "distribution":
        if not isinstance(content, list):
            err(f"{where}.content: lista di {{label,value}} richiesta")
        else:
            for j, it in enumerate(content):
                if not isinstance(it, dict) or not _is_str(it.get("label")) or not isinstance(it.get("value"), (int, float)):
                    err(f"{where}.content[{j}]: 'label' (str) + 'value' (num) richiesti")


def validate_blocks(blocks):
    if blocks is None:
        return
    if not isinstance(blocks, list):
        err("blocks: lista richiesta")
        return
    seen = set()
    for i, b in enumerate(blocks):
        where = f"blocks[{i}]"
        if not isinstance(b, dict):
            err(f"{where}: oggetto richiesto")
            continue
        _require_str(b, "key", where)
        _require_str(b, "title", where)
        key = b.get("key")
        if _is_str(key):
            if key in seen:
                err(f"{where}.key: '{key}' duplicato")
            seen.add(key)
        kind = b.get("kind")
        if kind not in BLOCK_KINDS:
            err(f"{where}.kind: '{kind}' non valido (ammessi: {', '.join(sorted(BLOCK_KINDS))})")
        else:
            validate_block_content(kind, b.get("content"), where)


def validate(profile) -> None:
    if not isinstance(profile, dict):
        err("(root): il profilo deve essere un oggetto YAML top-level")
        return
    for k in ("name", "target_role", "location", "seniority_target"):
        _require_str(profile, k, "(root)")
    ey = profile.get("experience_years")
    if not isinstance(ey, int) or isinstance(ey, bool) or ey < 0:
        err("experience_years: intero >= 0 richiesto")
    if not isinstance(profile.get("has_degree"), bool):
        err("has_degree: booleano richiesto")
    validate_skills(profile.get("skills"))
    validate_languages(profile.get("languages"))
    validate_blocks(profile.get("blocks"))


def main() -> int:
    args = [a for a in sys.argv[1:]]
    strict = "--strict" in args
    as_json = "--json" in args
    paths = [a for a in args if not a.startswith("--")]
    if not paths:
        print("uso: validate_profile.py <candidate_profile.yml> [--strict] [--json]", file=sys.stderr)
        return 2
    try:
        import yaml
    except ImportError:
        print("ERROR: pyyaml non disponibile (import yaml)", file=sys.stderr)
        return 2
    try:
        with open(paths[0], "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except FileNotFoundError:
        print(f"ERROR: file non trovato: {paths[0]}", file=sys.stderr)
        return 1
    except yaml.YAMLError as e:
        print(f"INVALID_PROFILE\nERROR: YAML non parsabile: {e}", file=sys.stderr)
        return 1

    validate(data)
    blocking = errors + (warnings if strict else [])

    if as_json:
        print(json.dumps({"ok": not blocking, "errors": errors, "warnings": warnings}))
    else:
        for w in warnings:
            print(f"WARN: {w}", file=sys.stderr)
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        print("VALID_PROFILE" if not blocking else "INVALID_PROFILE")
    return 0 if not blocking else 1


if __name__ == "__main__":
    sys.exit(main())
