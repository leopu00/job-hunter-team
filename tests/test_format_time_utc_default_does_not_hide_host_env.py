"""A UTC in the container's environment does not hide the zone host.env says.

Giro Windows 16/11: the installer starts the team before it writes host.env, so the container got JHT_USER_TZ=UTC (the
default) while host.env said Europe/Berlin, and kept it until it was made again. The agents' times then said UTC.
"""

from __future__ import annotations

import importlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "shared"))


def _zone(tmp_path: Path, env_tz: str, host_env: str | None) -> str:
    format_time = importlib.import_module("format_time")
    case = tmp_path / str(len(list(tmp_path.iterdir())))
    case.mkdir()
    host = case / "host.env"
    if host_env is not None:
        host.write_text(host_env, encoding="utf-8")
    format_time._read_timezone_candidates.cache_clear()
    try:
        return format_time._read_timezone_candidates(env_tz, (host,), ())
    finally:
        format_time._read_timezone_candidates.cache_clear()


def test_a_utc_default_in_the_environment_gives_way_to_host_env(tmp_path):
    assert _zone(tmp_path, "UTC", "JHT_LANG=it\nJHT_USER_TZ=Europe/Berlin\n") == "Europe/Berlin"
    assert _zone(tmp_path, "Etc/UTC", "JHT_USER_TZ=Europe/Berlin\n") == "Europe/Berlin"


def test_a_real_zone_in_the_environment_still_wins_and_utc_stays_utc_without_another(tmp_path):
    assert _zone(tmp_path, "America/Sao_Paulo", "JHT_USER_TZ=Europe/Berlin\n") == "America/Sao_Paulo"
    assert _zone(tmp_path, "UTC", None) == "UTC"
    assert _zone(tmp_path, "UTC", "JHT_LANG=it\n") == "UTC"
    assert _zone(tmp_path, "", "JHT_USER_TZ=Europe/Rome\n") == "Europe/Rome"
