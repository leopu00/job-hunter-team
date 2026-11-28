#!/usr/bin/env python3
"""score_place_pay.py — the distance from the person's home and the pay the offer does not declare, applied by the CODE to a score.

An onsite job in a country far from where the person lives could reach the top of the ranking, and offers with no pay were
scored as if the pay did not matter to a person who had set a target. The Scorer measured them as usual; nothing in the
score said where the person lives or that the pay was missing. Like the exclusions the person accepted (profile_exclusions.py), the
penalty is the code's, from the structured columns of the position and two facts of the profile, so it is the same every time:

  DISTANCE   the work is onsite or hybrid, and the office is farther from `residence` than `commute_max_km`:
             by the coordinates when both are known (great-circle km), else by the country when the office is in another
             country than the residence (and the radius is under BORDER_KM).                                   -DISTANCE_POINTS
  SALARY     the person declared a pay target (`preferences.salary_annual_eur`) and the offer declares no pay
             (`salary_declared_min` and `salary_declared_max` both empty: an estimate is not the offer's).    -SALARY_POINTS

Nothing is invented: with no residence or no radius in the profile, or an office whose place is not known, there is no distance
penalty, and the score says so in one line («DISTANCE not checked: …»). A remote position is never penalized for distance.
The lines go at the top of the breakdown, fixed phrases and figures only, like the EXCLUSION line.
"""
from __future__ import annotations

import math
import os
import re
from pathlib import Path

DISTANCE_POINTS = 25   # the whole weight of remote_fit: an office the person cannot reach is no fit of place at all
SALARY_POINTS = 10
BORDER_KM = 1500       # a radius this large reaches across borders: the country alone says nothing then
EARTH_KM = 6371.0
MAX_PROFILE_BYTES = 64 * 1024
# The seven languages of the product. Read in this order: hybrid first (some days at the place: the distance counts), then remote, then on site. «Home office»
# (German «Homeoffice») is remote, and «office» alone counts only as a whole word that no «home» comes before.
HYBRID_RE = re.compile(r"hybrid|ibrido|hibrid|híbrido")
REMOTE_RE = re.compile(r"remote|remoto|telelavoro|lavoro da casa|home[\s-]*office|smart[\s-]*working|telework|work from home|"
                       r"fernarbeit|mobiles? arbeiten|télétravail|teletravail|à distance|distanciel|teletrabajo|trabajo desde casa|"
                       r"teletrabalho|trabalho a partir de casa|távmunka|otthoni munka")
ONSITE_RE = re.compile(r"onsite|on-site|on site|in sede|presenza|\boffice\b")


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value)


def read_profile(path=None) -> dict:
    """The profile as a dict; {} when it cannot be read (no penalty is ever made from a guess)."""
    try:
        import yaml
        target = Path(path) if path else Path(os.environ.get("JHT_HOME") or "/jht_home") / "profile" / "candidate_profile.yml"
        if target.is_symlink() or not target.is_file() or target.stat().st_size > MAX_PROFILE_BYTES:
            return {}
        data = yaml.safe_load(target.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def residence_of(profile: dict):
    """(place, lat, lon, radius_km) from the profile; each None when it is not there."""
    residence = profile.get("residence")
    place = lat = lon = None
    if isinstance(residence, dict):
        place = residence.get("place") if isinstance(residence.get("place"), str) and residence.get("place").strip() else None
        lat, lon = _number(residence.get("lat")), _number(residence.get("lon"))
        if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            lat = lon = None
    radius = _number(profile.get("commute_max_km"))
    if radius is not None and radius <= 0:
        radius = None
    return place, lat, lon, radius


def pay_matters(profile: dict) -> bool:
    prefs = profile.get("preferences")
    value = prefs.get("salary_annual_eur") if isinstance(prefs, dict) else None
    if isinstance(value, bool) or value is None:
        return False
    return bool(str(value).strip())


def km_between(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_KM * math.asin(min(1.0, math.sqrt(a)))


def _onsite(row) -> bool:
    text = " ".join(str(row.get(k) or "") for k in ("work_mode", "remote_type")).lower()
    if not text.strip():
        return False
    if HYBRID_RE.search(text):
        return True
    if REMOTE_RE.search(text):
        return False
    return True  # on site, or a mode that says neither: the distance counts


def _country_of(place):
    try:
        import scout_area
        return scout_area.country_of(place)
    except Exception:  # noqa: BLE001
        return None


def assess(row: dict, profile: dict):
    """(points to take off, [lines for the breakdown]) for one position (a dict of its columns) and the profile."""
    points, lines = 0, []
    if _onsite(row):
        place, lat, lon, radius = residence_of(profile)
        mode = str(row.get("work_mode") or row.get("remote_type") or "onsite").strip().lower()
        if place is None or radius is None:
            missing = " and ".join(n for n, v in (("residence", place), ("radius (commute_max_km)", radius)) if v is None)
            lines.append(f"DISTANCE not checked: the profile has no {missing}, so no penalty for the place of a {mode} job")
        else:
            office_lat, office_lon = _number(row.get("office_lat")), _number(row.get("office_lon"))
            if lat is not None and office_lat is not None and office_lon is not None:
                km = km_between(lat, lon, office_lat, office_lon)
                if km > radius:
                    points += DISTANCE_POINTS
                    lines.append(f"DISTANCE -{DISTANCE_POINTS}: {mode} job {km:.0f} km from the residence, beyond {radius:.0f} km")
            else:
                home = _country_of(place)
                where = str(row.get("work_country_code") or row.get("loc_country_code") or "").strip().lower() or None
                if home and where and where != "remote" and where != home and radius < BORDER_KM:
                    points += DISTANCE_POINTS
                    lines.append(f"DISTANCE -{DISTANCE_POINTS}: {mode} job in {where.upper()}, the residence is in "
                                 f"{home.upper()}, beyond {radius:.0f} km")
                elif not (home and where):
                    lines.append(f"DISTANCE not checked: the place of the office is not known, so no penalty for a {mode} job")
                else:
                    lines.append(f"DISTANCE not checked: a {mode} job in the country of the residence, the km are not known")
    if pay_matters(profile) and row.get("salary_declared_min") is None and row.get("salary_declared_max") is None:
        points += SALARY_POINTS
        lines.append(f"SALARY -{SALARY_POINTS}: the offer declares no pay, and the person set a pay target")
    return points, lines


COLUMNS = ("work_mode", "remote_type", "office_lat", "office_lon", "work_country_code", "loc_country_code",
           "salary_declared_min", "salary_declared_max")


def for_position(conn, position_id, profile=None):
    """`assess` for a position of the database; (0, []) when it is not there."""
    names = [c for c in COLUMNS if c in {r[1] for r in conn.execute("PRAGMA table_info(positions)").fetchall()}]
    if not names:
        return 0, []
    found = conn.execute(f"SELECT {', '.join(names)} FROM positions WHERE id = ?", (position_id,)).fetchone()
    if found is None:
        return 0, []
    return assess(dict(zip(names, found)), read_profile() if profile is None else profile)
