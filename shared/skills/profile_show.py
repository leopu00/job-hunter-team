#!/usr/bin/env python3
"""Decode the CLI's bounded profile snapshot; never open or change the profile."""

import datetime
import json
import sys
from pathlib import Path


def json_default(value):
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    raise TypeError("unsupported profile value")


def encode(value, limit):
    parts, size = [], 0
    encoder = json.JSONEncoder(ensure_ascii=False, allow_nan=False, default=json_default)
    for part in encoder.iterencode(value):
        size += len(part.encode("utf-8"))
        if size > limit:
            raise ValueError("expanded profile exceeds output limit")
        parts.append(part)
    return "".join(parts)


def require_string_keys(value, seen):
    if not isinstance(value, (dict, list)) or id(value) in seen:
        return
    seen.add(id(value))
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise ValueError("profile mapping keys must be strings")
        children = value.values()
    else:
        children = value
    for child in children:
        require_string_keys(child, seen)


def main():
    try:
        import yaml
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from validate_profile import team_minimum_missing
    except ImportError:
        print(json.dumps({"code": "profile_reader_unavailable"}))
        return 2
    try:
        maximum = int(sys.argv[1])
        output_limit = int(sys.argv[2])
        if maximum < 1 or output_limit < 1:
            raise ValueError("invalid profile bounds")
        raw = sys.stdin.buffer.read(maximum + 1)
        if len(raw) > maximum:
            raise ValueError("profile too large")
        text = raw.decode("utf-8")
        profile = yaml.safe_load(text) if text.strip() else {}
        if not isinstance(profile, dict):
            raise ValueError("profile must be a mapping")
        require_string_keys(profile, set())
        missing = team_minimum_missing(profile)
        packet = {"code": "profile_incomplete" if missing else "profile_complete",
                  "profile": profile, "missing": missing}
        answer = encode(packet, output_limit)
    except (UnicodeError, yaml.YAMLError, ValueError, TypeError, RecursionError):
        print(json.dumps({"code": "profile_unreadable"}))
        return 2
    print(answer)
    return 0


if __name__ == "__main__":
    sys.exit(main())
