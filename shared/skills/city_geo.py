#!/usr/bin/env python3
"""city_geo.py — the coordinates of a town, from the GeoNames list built into the image, never from a model (JHT-T351).

The Scorer measures the distance from the person's residence to an onsite or hybrid office (score_place_pay.py) only when it has
the coordinates of both. A model writes plausible coordinates from memory; this looks them up in `shared/data/cities.tsv.gz`
(GeoNames cities5000, CC BY 4.0, made at the build by scripts/geonames_reduce.py). Nothing leaves the container.

  found       one town: {"status": "found", "lat", "lon", "name", "country", "population"}
  ambiguous   several towns of that name and nothing to choose between them (no country written, or two in the
              country of near size): {"status": "ambiguous", "candidates": [...]} — the Assistente asks which one
  not_found   no town of that name (a place under 5000 inhabitants, a region, a typo): {"status": "not_found"} — the
              Assistente asks for the nearest town; the office keeps the country check
  no_data     the list is not in this image (a development checkout): {"status": "no_data"}

A name matches the GeoNames name, its ascii form or a Latin alternate name, compared without case and accents: never a nearest
match by spelling (that makes false namesakes). With a country written («Valencia, Spain») only that country counts; within it the
largest town wins when it is at least DOMINANT times the next one (Paris, FR, not a hamlet called Paris), else it is ambiguous.

  python3 /app/shared/skills/city_geo.py "Milano, Italy"
"""
from __future__ import annotations

import functools
import gzip
import importlib.util
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / "data" / "cities.tsv.gz"
DOMINANT = 5
MAX_CANDIDATES = 5


def fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", str(text or "")).replace("ß", "ss")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).casefold()
    return re.sub(r"\s+", " ", text.replace("’", "'")).strip(" .")


def _data_path() -> Path:
    return Path(os.environ.get("JHT_CITIES_FILE") or DATA)


@functools.lru_cache(maxsize=2)
def _index(path: str) -> dict:
    index: dict[str, list[dict]] = {}
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        header = handle.readline().rstrip("\n").split("\t")
        for line in handle:
            row = dict(zip(header, line.rstrip("\n").split("\t")))
            town = {"name": row["name"], "country": row["country"], "admin1": row["admin1"], "lat": float(row["lat"]),
                    "lon": float(row["lon"]), "population": int(row["population"] or 0)}
            names = {fold(row["name"]), fold(row["ascii"])} | {fold(a) for a in row["alternates"].split(",") if a}
            for name in names:
                if name:
                    index.setdefault(name, []).append(town)
    return index


def _country_of(text: str):
    try:
        spec = importlib.util.spec_from_file_location("jht_scout_area", HERE / "scout_area.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        code = module.country_of(text)
    except Exception:  # noqa: BLE001 — no country is a lookup without one, never an error
        return None
    return code.lower() if isinstance(code, str) and len(code) == 2 else None


def locate(place: str) -> dict:
    """The town written in `place` («Town», «Town, Country», «Town, Region, Country»), as the docstring says."""
    if not isinstance(place, str) or not place.strip():
        return {"status": "not_found"}
    path = _data_path()
    if not path.is_file():
        return {"status": "no_data"}
    town = place.split(",")[0]
    town = re.sub(r"\s*\([^)]*\)\s*$", "", town)          # «Bra (CN)»: the province in brackets is not the name
    rest = place[len(place.split(",")[0]):]
    country = _country_of(rest) if rest.strip(" ,") else None
    found = _index(str(path)).get(fold(town), [])
    if country:
        found = [t for t in found if t["country"] == country]
    if not found:
        return {"status": "not_found"}
    found = sorted(found, key=lambda t: -t["population"])
    unique = []
    for t in found:                                          # the same town under two names is one town
        if not any(u["country"] == t["country"] and abs(u["lat"] - t["lat"]) < 0.01 and abs(u["lon"] - t["lon"]) < 0.01 for u in unique):
            unique.append(t)
    first = unique[0]
    countries = {t["country"] for t in unique}
    if len(unique) == 1 or (len(countries) == 1 and first["population"] >= DOMINANT * max(unique[1]["population"], 1)):
        return {"status": "found", "lat": first["lat"], "lon": first["lon"], "name": first["name"], "country": first["country"],
                "population": first["population"]}
    return {"status": "ambiguous", "candidates": [
        {"name": t["name"], "country": t["country"], "admin1": t["admin1"], "population": t["population"]}
        for t in unique[:MAX_CANDIDATES]]}


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if not argv or argv[0] in ("-h", "--help"):
        print((__doc__ or "").strip())
        return 0
    print(json.dumps(locate(" ".join(argv)), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
