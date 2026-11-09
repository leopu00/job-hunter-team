#!/usr/bin/env python3
"""The candidate's own salary preference, without parsing amounts or currencies."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
import stat
import sys

import yaml


class SalaryPreferenceError(ValueError):
    pass


@dataclass(frozen=True)
class ScoringProfile:
    yaml_text: str
    salary_preference: dict


def read_text(path: Path, limit: int) -> str | None:
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return None
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size > limit:
            raise SalaryPreferenceError("salary_preference_unreadable")
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise SalaryPreferenceError("salary_preference_unreadable")
    return raw.decode("utf-8")


def salary_context(profile_text: str, profile_dir: Path) -> dict:
    try:
        profile = yaml.safe_load(profile_text)
    except yaml.YAMLError as exc:
        raise SalaryPreferenceError("candidate_profile_invalid") from exc
    if not isinstance(profile, dict):
        raise SalaryPreferenceError("candidate_profile_invalid")
    preferences = profile.get("preferences")
    if preferences is not None and not isinstance(preferences, dict):
        raise SalaryPreferenceError("salary_preference_invalid")
    value = (preferences or {}).get("salary_annual_eur")
    if value is not None and not isinstance(value, str):
        raise SalaryPreferenceError("salary_preference_invalid")
    if isinstance(value, str) and len(value.encode("utf-8")) > 8192:
        raise SalaryPreferenceError("salary_preference_invalid")
    if isinstance(value, str) and value.strip():
        return {"source": "preferences.salary_annual_eur", "salary_annual_eur": value,
                "preferences_summary": None}
    summary = read_text(profile_dir / "summaries/preferences.md", 8192)
    summary = summary if summary and summary.strip() else None
    return {"source": "summaries/preferences.md" if summary else None,
            "salary_annual_eur": None, "preferences_summary": summary}


def main() -> int:
    try:
        folder = Path(os.environ.get("JHT_HOME", "/jht_home")) / "profile"
        profile = read_text(folder / "candidate_profile.yml", 64 * 1024)
        if not profile or not profile.strip():
            raise SalaryPreferenceError("candidate_profile_missing")
        context = salary_context(profile, folder)
    except (OSError, ValueError, yaml.YAMLError):
        print("salary_preference_unreadable", file=sys.stderr)
        return 1
    print(json.dumps(context, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
