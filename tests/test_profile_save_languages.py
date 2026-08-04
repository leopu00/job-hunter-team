"""Regressioni del salvataggio profilo usato dalla UI desktop."""

from __future__ import annotations

import base64
import json
import sys
import types
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
PAYLOAD = ROOT / "game/scripts/backend/payloads/profile_save.py"


def _run_payload(tmp_path: Path, fields: dict, initial: dict) -> dict:
    profile = tmp_path / "candidate_profile.yml"
    # JSON è un sottoinsieme valido di YAML. Un modulo minimo evita di
    # rendere PyYAML una dipendenza della suite host: nel container reale il
    # payload continua a usare la libreria vera.
    profile.write_text(json.dumps(initial, ensure_ascii=False), encoding="utf-8")
    fake_yaml = types.ModuleType("yaml")
    fake_yaml.safe_load = lambda stream: json.load(stream)

    def safe_dump(data, stream, **_kwargs):
        json.dump(data, stream, ensure_ascii=False)

    fake_yaml.safe_dump = safe_dump
    encoded = base64.b64encode(json.dumps(fields).encode()).decode()
    source = PAYLOAD.read_text(encoding="utf-8") % encoded
    source = source.replace(
        "path = '/jht_home/profile/candidate_profile.yml'",
        f"path = {str(profile)!r}",
    )
    with patch.dict(sys.modules, {"yaml": fake_yaml}):
        exec(compile(source, str(PAYLOAD), "exec"), {})
    return json.loads(profile.read_text(encoding="utf-8"))


def test_languages_round_trip_keeps_names_and_levels(tmp_path: Path) -> None:
    initial = {
        "name": "Giulia Collaudo",
        "languages": [
            {"language": "Italiano", "level": "madrelingua"},
            {"language": "Inglese", "level": "C1"},
        ],
    }

    saved = _run_payload(
        tmp_path,
        {"languages": "Italiano (madrelingua), Inglese (C1)"},
        initial,
    )

    assert saved["languages"] == initial["languages"]


def test_plain_language_keeps_existing_structured_level(tmp_path: Path) -> None:
    initial = {"languages": [{"language": "Italiano", "level": "madrelingua"}]}

    saved = _run_payload(tmp_path, {"languages": "Italiano, Francese"}, initial)

    assert saved["languages"] == [
        {"language": "Italiano", "level": "madrelingua"},
        "Francese",
    ]
