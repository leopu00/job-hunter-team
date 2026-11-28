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

  UNVERIFIED the profile has a residence and a radius, but the distance of this office cannot be checked (no coordinates and the
             country is not enough): «DISTANCE not verified». A position that cannot be checked never ranks above one that was
             checked and is within reach only because nothing was known about it.                                 -UNVERIFIED_POINTS
  SMALL PLACE the person works on site or hybrid «only in big cities» (`preferences.only_big_cities`), and the city of the office
             is not in the declared list (shared/data/big-cities.json).                                            -SMALL_PLACE_POINTS

The country of the residence is the one its place names; a place that is a city alone names none, and then the country the person
named in their places (`location`, `location_preferences`: «it» counts) stands for it, when exactly one is named (JHT-T351 F-02).
The radius comes from the person's own words when they are a duration (`commute_said`, «20 min in auto»): KM_PER_MINUTE turns it into
km, a declared speed for each way to travel, and the line says which; `commute_max_km` counts when the words are no duration.

Nothing is invented: with no residence or no radius in the profile there is no distance penalty, and the score says so in one line
(«DISTANCE not checked: …»). A remote position is never penalized for distance or size of place.
The lines go at the top of the breakdown, fixed phrases and figures only, like the EXCLUSION line.
"""
from __future__ import annotations

import json
import math
import os
import re
import unicodedata
from pathlib import Path

DISTANCE_POINTS = 25   # the whole weight of remote_fit: an office the person cannot reach is no fit of place at all
SALARY_POINTS = 10
UNVERIFIED_POINTS = 10  # under DISTANCE_POINTS: an office maybe within reach, but below every one that was checked and is
SMALL_PLACE_POINTS = 10
# Declared speeds, km per minute of the way, door to door: by car about 48 km/h, public transport 30, bike 15, on foot 5.
KM_PER_MINUTE = {"car": 0.8, "transit": 0.5, "bike": 0.25, "foot": 0.08}
BIG_CITIES = Path(__file__).resolve().parent.parent / "data" / "big-cities.json"
_MINUTES_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(minuti|minuto|minutes?|minuten|minutos?|perc|mins?|min|['′])(?![a-z])")
_HALF_HOUR_RE = re.compile(r"mezz'? ?ora|mezzora|half an hour|halbe stunde|media hora|demi-heure|demi heure|meia hora|meia-hora|fél óra")
_HOURS_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(ore|ora|hours?|hrs?|stunden?|std|horas?|heures?|óra|h)(?![a-z])")
# How the person said they travel, in the seven languages; a duration with no way said counts as by car.
_WAYS = (
    ("foot", re.compile(r"a piedi|on foot|walk|zu fu(ß|ss)|a pie|à pied|a pé|gyalog")),
    ("bike", re.compile(r"\bbici|bicicletta|bike|bicycle|cycl|fahrrad|rad\b|bicicleta|vélo|velo\b|bicikli|biciklivel")),
    ("transit", re.compile(r"treno|metro|bus\b|autobus|tram|mezzi|trasporti? pubblic|train|public transport|transit|bahn|öffentlich|"
                           r"öpnv|transporte público|tren\b|transports? en commun|transportes? públicos?|comboio|tömegközlekedés|"
                           r"vonat|busz|villamos")),
)
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


def radius_from_words(said):
    """(km, way, minutes) from the person's own words when they hold a duration («20 min in auto» → (16.0, "car", 20.0)); None
    when they say no duration (a distance in km, or nothing the code can read)."""
    if not isinstance(said, str) or not said.strip():
        return None
    text = said.lower()
    minutes = sum(float(n.replace(",", ".")) for n, _ in _MINUTES_RE.findall(text))
    minutes += sum(float(n.replace(",", ".")) * 60 for n, _ in _HOURS_RE.findall(text))
    minutes += 30 * len(_HALF_HOUR_RE.findall(text))
    if minutes <= 0:
        return None
    way = next((name for name, pattern in _WAYS if pattern.search(text)), "car")
    return round(minutes * KM_PER_MINUTE[way], 1), way, minutes


def residence_of(profile: dict):
    """(place, lat, lon, radius_km) from the profile; each None when it is not there. The radius is the one the person's words
    give when they are a duration (`radius_from_words`), else `commute_max_km`."""
    residence = profile.get("residence")
    place = lat = lon = None
    if isinstance(residence, dict):
        place = residence.get("place") if isinstance(residence.get("place"), str) and residence.get("place").strip() else None
        lat, lon = _number(residence.get("lat")), _number(residence.get("lon"))
        if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
            lat = lon = None
    said = radius_from_words(profile.get("commute_said"))
    radius = said[0] if said else _number(profile.get("commute_max_km"))
    if radius is not None and radius <= 0:
        radius = None
    return place, lat, lon, radius


def _radius_said(profile: dict) -> str:
    """« (20 min by car, 0.8 km a minute)» when the radius came from the person's words, else ""."""
    said = radius_from_words(profile.get("commute_said"))
    if not said:
        return ""
    return f" ({said[2]:g} min {'by car' if said[1] == 'car' else 'by ' + said[1] if said[1] != 'foot' else 'on foot'}, " \
           f"{KM_PER_MINUTE[said[1]]:g} km a minute)"


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


def home_country(profile: dict, place=None):
    """The country of the residence: the one its place names, else the single country the person named in their places
    (`location`, `location_preferences`, an entry «it» included). None when none is named, or more than one."""
    found = _country_of(place) if place else None
    if found:
        return found
    try:
        import scout_area
        entries = [profile.get("location")]
        if isinstance(profile.get("location_preferences"), list):
            entries += profile["location_preferences"]
        named = {c for c in (scout_area.country_of_entry(e) for e in entries if isinstance(e, str) and e.strip()) if c}
    except Exception:  # noqa: BLE001
        return None
    return next(iter(named)) if len(named) == 1 else None


def _fold(text) -> str:
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


_BIG = None


def big_cities() -> dict:
    """{country code: {folded name}} from the declared list; {} when it cannot be read (then nothing is lowered for size)."""
    global _BIG
    if _BIG is None:
        try:
            raw = json.loads(BIG_CITIES.read_text(encoding="utf-8"))["cities"]
            _BIG = {code: {_fold(name) for name in names} for code, names in raw.items()}
        except Exception:  # noqa: BLE001
            _BIG = {}
    return _BIG


def big_city(city, country=None):
    """True when `city` is in the declared list (of `country` when it is known), False when not, None when no city is given."""
    name = _fold(city)
    if not name:
        return None
    table = big_cities()
    if country and str(country).lower() in table:
        return name in table[str(country).lower()]
    return any(name in names for names in table.values())


def only_big_cities(profile: dict) -> bool:
    prefs = profile.get("preferences")
    return isinstance(prefs, dict) and prefs.get("only_big_cities") is True


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
            said = _radius_said(profile)
            office_lat, office_lon = _number(row.get("office_lat")), _number(row.get("office_lon"))
            if lat is not None and office_lat is not None and office_lon is not None:
                km = km_between(lat, lon, office_lat, office_lon)
                if km > radius:
                    points += DISTANCE_POINTS
                    lines.append(f"DISTANCE -{DISTANCE_POINTS}: {mode} job {km:.0f} km from the residence, beyond {radius:.0f} km{said}")
            else:
                home = home_country(profile, place)
                where = str(row.get("work_country_code") or row.get("loc_country_code") or "").strip().lower() or None
                if home and where and where != "remote" and where != home and radius < BORDER_KM:
                    points += DISTANCE_POINTS
                    lines.append(f"DISTANCE -{DISTANCE_POINTS}: {mode} job in {where.upper()}, the residence is in "
                                 f"{home.upper()}, beyond {radius:.0f} km{said}")
                else:
                    points += UNVERIFIED_POINTS
                    if not where:
                        why = "the place of the office is not known"
                    elif not home:
                        why = "the country of the residence is not known (a place without its country)"
                    else:
                        why = "a job in the country of the residence, the km are not known"
                    lines.append(f"DISTANCE not verified -{UNVERIFIED_POINTS}: {why}, so this {mode} job stays below the "
                                 f"ones checked within {radius:.0f} km")
        if only_big_cities(profile):
            city = str(row.get("loc_city") or "").strip()
            country = str(row.get("work_country_code") or row.get("loc_country_code") or "").strip().lower() or None
            big = big_city(city, country)
            if big is False:
                points += SMALL_PLACE_POINTS
                lines.append(f"SMALL PLACE -{SMALL_PLACE_POINTS}: {mode} job in a city that is not a big one, and the person "
                             f"works on site only in big cities")
            elif big is None:
                lines.append(f"SMALL PLACE not checked: the city of the office is not known, so no penalty for a {mode} job")
    if pay_matters(profile) and row.get("salary_declared_min") is None and row.get("salary_declared_max") is None:
        points += SALARY_POINTS
        lines.append(f"SALARY -{SALARY_POINTS}: the offer declares no pay, and the person set a pay target")
    return points, lines


COLUMNS = ("work_mode", "remote_type", "office_lat", "office_lon", "work_country_code", "loc_country_code", "loc_city",
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
