#!/usr/bin/env python3
"""geonames_reduce.py — the list of cities the team finds coordinates in, made at the BUILD of the image, never at run time.

GeoNames `cities5000` (every place with more than 5000 inhabitants, about 50 000 rows; https://www.geonames.org, licence
CC BY 4.0, attribution in NOTICE.md) is reduced to the fields a lookup needs: geonameid, name, ascii name, the alternate names
in Latin script (Milano/Milan, München/Munich), country code, admin1 code, latitude, longitude, population. The result is
`shared/data/cities.tsv.gz` (gzip with no timestamp: the same input gives the same bytes), with its sha256 in
`cities.tsv.gz.sha256` and what it came from in `cities.json` (the release snapshot reads these, JHT-T351).

The person's residence and the offices written with a city only are looked up in it (shared/skills/city_geo.py): no data of
the person leaves the container, and no coordinate ever comes from a model.

  python3 scripts/geonames_reduce.py --fetch --out shared/data          # the Dockerfile: download and reduce
  python3 scripts/geonames_reduce.py --zip cities5000.zip --out DIR     # from a file already here (tests)

A download or a file that does not look like cities5000 (too few or too many rows, a column out of range) fails the build.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import sys
import unicodedata
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

URL = "https://download.geonames.org/export/dump/cities5000.zip"
MEMBER = "cities5000.txt"
MAX_ZIP_BYTES = 40 * 1024 * 1024
MIN_ROWS, MAX_ROWS = 30_000, 120_000
MAX_ALTERNATES = 30
MAX_NAME = 60
FIELDS = ("id", "name", "ascii", "alternates", "country", "admin1", "lat", "lon", "population")


def _latin(name: str) -> bool:
    """A name a person writes in a Latin keyboard: letters of the Latin script, digits, spaces and a few marks."""
    for ch in name:
        if ch.isalpha():
            if not unicodedata.name(ch, "").startswith("LATIN"):
                return False
        elif not (ch.isdigit() or ch in " -'’.()"):
            return False
    return bool(name.strip())


def reduce_lines(lines) -> list[tuple]:
    """The rows of cities5000.txt (GeoNames «geoname» table, tab separated) as the reduced rows, sorted by geonameid."""
    rows = []
    for line in lines:
        cols = line.rstrip("\n").split("\t")
        if len(cols) < 15:
            raise ValueError(f"not a GeoNames row: {line[:80]!r}")
        gid, name, ascii_name, alternates, lat, lon, country, admin1, population = (
            cols[0], cols[1], cols[2], cols[3], cols[4], cols[5], cols[8], cols[10], cols[14])
        lat_f, lon_f = float(lat), float(lon)
        if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180) or not gid.isdigit() or len(country) != 2:
            raise ValueError(f"a row out of range: {gid} {name}")
        seen = {name.casefold(), ascii_name.casefold()}
        kept = []
        for alt in alternates.split(","):
            alt = alt.strip()
            if alt and len(alt) <= MAX_NAME and alt.casefold() not in seen and _latin(alt):
                seen.add(alt.casefold())
                kept.append(alt)
            if len(kept) >= MAX_ALTERNATES:
                break
        rows.append((int(gid), name, ascii_name, ",".join(kept), country.lower(), admin1, f"{lat_f:.5f}", f"{lon_f:.5f}",
                     str(int(population or 0))))
    rows.sort(key=lambda r: r[0])
    return rows


def write(rows: list[tuple], out: Path, source: str, min_rows: int = MIN_ROWS, max_rows: int = MAX_ROWS) -> dict:
    if not min_rows <= len(rows) <= max_rows:
        raise ValueError(f"{len(rows)} rows: not what cities5000 has ({min_rows}-{max_rows})")
    text = "\t".join(FIELDS) + "\n" + "".join("\t".join(str(c) for c in r) + "\n" for r in rows)
    buffer = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buffer, mtime=0, compresslevel=9) as handle:
        handle.write(text.encode("utf-8"))
    data = buffer.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    out.mkdir(parents=True, exist_ok=True)
    (out / "cities.tsv.gz").write_bytes(data)
    (out / "cities.tsv.gz.sha256").write_text(f"{digest}  cities.tsv.gz\n", encoding="utf-8")
    meta = {"source": source, "licence": "CC BY 4.0, GeoNames (https://www.geonames.org)", "rows": len(rows),
            "bytes": len(data), "sha256": digest, "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    (out / "cities.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return meta


def _fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "JobHunterTeam-build/1.0 (+https://github.com/leopu00/job-hunter-team)"})
    with urllib.request.urlopen(request, timeout=120) as answer:  # noqa: S310 — a fixed https URL of the build
        data = answer.read(MAX_ZIP_BYTES + 1)
    if len(data) > MAX_ZIP_BYTES:
        raise ValueError("the download is larger than cities5000 can be")
    return data


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--fetch", action="store_true", help=f"download {URL}")
    source.add_argument("--zip", type=Path, help="a cities5000.zip already on disk")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    raw = _fetch(URL) if args.fetch else args.zip.read_bytes()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        lines = archive.read(MEMBER).decode("utf-8").splitlines()
    meta = write(reduce_lines(lines), args.out, URL if args.fetch else args.zip.name)
    print(json.dumps(meta))
    return 0


if __name__ == "__main__":
    sys.exit(main())
