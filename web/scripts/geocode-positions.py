#!/usr/bin/env python3
"""Geocoding office-level per positions.

MVP locale: scrive solo su ~/.jht/jobs.db (SQLite). Niente Supabase.

Strategia office-level (priority chain per ogni position):
  1. extracted address dal jd_text (regex indirizzi italiani / europei)
  2. company name + location  (es. "Avanade Roma" -> ufficio specifico)
  3. location text                (city-center fallback)
  4. marca is_remote=1 se location ha keyword remote

Cache `location_geocode` deduplicata su `canonical`. Una stessa
stringa risolve 1 volta sola.

Rate limit Nominatim: 1 req/s. User-Agent obbligatorio.

Run: python3 web/scripts/geocode-positions.py [--reset]
  --reset: cancella office_lat/lon esistenti prima di rifare.
"""
import os
import sqlite3
import re
import time
import sys
import argparse
import urllib.parse
import urllib.request
import json

DB_PATH = os.path.expanduser("~/.jht/jobs.db")
NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "JobHunterTeam/0.1 (leone.puglisi@gmail.com) - office-level geocoding"

REMOTE_KW = re.compile(
    r"\b(remote|worldwide|anywhere|teleworking|wfh|home[\s-]?based|smart\s*work|"
    r"remoto|distance|hybrid\s*-?\s*remote)\b",
    re.I,
)

SKIP_NON_PLACE = {"advice", "european union", "europe", "eu"}

# Regex indirizzi: "Via Roma 12, 00100 Roma" / "Via X N. Y" / etc.
ADDRESS_RX = re.compile(
    r"\b("
    r"(?:via|viale|piazza|corso|largo|vicolo|strada)\s+"
    r"[A-ZÀÈÉÌÒÓÙa-zàèéìòóù'\s\.]{2,40}"
    r"(?:\s*,?\s*n?\.?\s*\d+[a-z]?)?"  # numero civico opzionale
    r"(?:\s*,\s*\d{5})?"               # CAP opzionale
    r")",
    re.I,
)


def canonicalize(loc: str) -> str:
    s = loc.strip()
    s = re.sub(r"\([^)]*\)", "", s)
    s = re.sub(r"^(hybrid|onsite|on-site|in-?office)\s*[-:]\s*", "", s, flags=re.I)
    s = re.sub(r"\s*-\s*", ", ", s)
    s = re.sub(r"\s+", " ", s).strip(" ,.;")
    s = re.split(r"\s*(?:;| or )\s*", s, maxsplit=1)[0]
    return s.lower()


def geocode(query: str):
    """Nominatim search. Restituisce dict o None."""
    url = (
        NOMINATIM
        + "?"
        + urllib.parse.urlencode(
            {"q": query, "format": "json", "limit": 1, "addressdetails": 1}
        )
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  ! error querying {query!r}: {e}", file=sys.stderr)
        return None
    if not data:
        return None
    first = data[0]
    addr = first.get("address", {})
    # Address string: preferiamo "Road N, Suburb, City" — più utile del
    # display_name verboso. Fallback al display_name se mancano parti.
    street_bits = [s for s in [addr.get("road"), addr.get("house_number")] if s]
    street = " ".join(street_bits).strip()
    suburb = addr.get("suburb")
    city = addr.get("city") or addr.get("town") or addr.get("village")
    address_compact = ", ".join([s for s in [street, suburb, city] if s])
    return {
        "lat": float(first["lat"]),
        "lon": float(first["lon"]),
        "city": city,
        "country": addr.get("country") or None,
        "address": address_compact or first.get("display_name") or None,
    }


def cache_lookup(c: sqlite3.Cursor, canonical: str):
    # raw_text è usato come carrier dell'address compatto cached: nel
    # write salviamo "address|raw" e nel read separiamo. Compat back:
    # se non c'è '|', raw_text = solo raw.
    row = c.execute(
        "SELECT lat, lon, source, raw_text FROM location_geocode WHERE canonical = ?",
        (canonical,),
    ).fetchone()
    if row and row[0] is not None:
        lat, lon, source, raw_text = row
        addr = None
        if raw_text and "|" in raw_text:
            addr = raw_text.split("|", 1)[0] or None
        return lat, lon, source, addr
    return None


def cache_write(c: sqlite3.Cursor, canonical: str, raw: str, geo, source: str):
    if geo is None:
        c.execute(
            """INSERT OR REPLACE INTO location_geocode
               (canonical, raw_text, lat, lon, city, country, source)
               VALUES (?, ?, NULL, NULL, NULL, NULL, ?)""",
            (canonical, raw, f"{source}-miss"),
        )
        return None
    # raw_text = "<address>|<raw>" così cache_lookup può recuperare
    # l'indirizzo. Schema invariato (no migration).
    address = geo.get("address") or ""
    raw_combined = f"{address}|{raw}"
    c.execute(
        """INSERT OR REPLACE INTO location_geocode
           (canonical, raw_text, lat, lon, city, country, source)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (canonical, raw_combined, geo["lat"], geo["lon"], geo["city"], geo["country"], source),
    )
    return geo["lat"], geo["lon"], address or None


def extract_address(jd_text):
    if not jd_text:
        return None
    m = ADDRESS_RX.search(jd_text)
    if not m:
        return None
    addr = m.group(1).strip(" ,.")
    if len(addr) < 8:
        return None
    return addr


def extract_city(loc: str) -> str:
    """Estrae il primo segmento di location come citta'.

    "Rome, Latium, Italy"     -> "Rome"
    "Milano, Italy (Remote)"  -> "Milano"
    "London, UK"              -> "London"
    """
    s = re.sub(r"\([^)]*\)", "", loc)
    s = re.sub(r"^(hybrid|onsite|on-site|in-?office)\s*[-:]\s*", "", s, flags=re.I)
    s = s.strip()
    first = s.split(",")[0].strip()
    return first or s


def process_position(c, pid, title, company, location, jd_text):
    """Restituisce (lat, lon, address, source) o (None, None, None, 'remote'|'skip').

    Strategia office-level aggressiva: cerca SEMPRE company quando
    disponibile, anche se la location e' nota. Cache dedup su
    (company, city) tuple per evitare API hammering ma lasciando
    coord distinte per company diverse stessa citta'.
    """

    # 1. Address dal jd_text (se preciso)
    addr = extract_address(jd_text)
    if addr:
        city = extract_city(location) if location else ""
        q = f"{addr}, {city}" if city else addr
        canonical = canonicalize(q)
        cached = cache_lookup(c, canonical)
        if cached:
            return cached[0], cached[1], cached[3], "address-cached"
        time.sleep(1.1)
        geo = geocode(q)
        cache_write(c, canonical, q, geo, "address")
        if geo:
            return geo["lat"], geo["lon"], geo.get("address"), "address"

    # 2. Remote shortcut
    if location and REMOTE_KW.search(location):
        return None, None, None, "remote"

    # 3. Company + city — SEMPRE tentato, anche se cache location esiste.
    #    Le 30+ positions a Roma di company diverse NON devono finire
    #    sullo stesso centro citta'.
    if company and location:
        city = extract_city(location)
        if city:
            q = f"{company} {city}"
            canonical = canonicalize(q)
            cached = cache_lookup(c, canonical)
            if cached:
                return cached[0], cached[1], cached[3], "company-cached"
            time.sleep(1.1)
            geo = geocode(q)
            cache_write(c, canonical, q, geo, "company")
            if geo:
                return geo["lat"], geo["lon"], geo.get("address"), "company"

    # 4. Fallback location-only (per positions senza company o miss)
    if location:
        canonical = canonicalize(location)
        if canonical in SKIP_NON_PLACE or len(canonical) < 3:
            return None, None, None, "skip"
        cached = cache_lookup(c, canonical)
        if cached:
            return cached[0], cached[1], cached[3], "location-cached"
        time.sleep(1.1)
        geo = geocode(canonical)
        cache_write(c, canonical, location, geo, "location")
        if geo:
            return geo["lat"], geo["lon"], geo.get("address"), "location"

    return None, None, None, "skip"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="reset existing coords")
    args = parser.parse_args()

    db = sqlite3.connect(DB_PATH)
    c = db.cursor()

    if args.reset:
        c.execute(
            "UPDATE positions SET office_lat = NULL, office_lon = NULL, office_address = NULL, office_geocoded = 0, is_remote = 0"
        )
        print("=== reset office_lat/lon/address/geocoded/is_remote ===")

    rows = c.execute(
        """SELECT id, title, company, location, jd_text
           FROM positions
           WHERE status != 'excluded' AND office_lat IS NULL AND is_remote = 0
           ORDER BY id"""
    ).fetchall()
    print(f"positions to process: {len(rows)}")

    stats = {"address": 0, "company": 0, "location": 0, "remote": 0, "skip": 0, "cache": 0}

    for pid, title, company, location, jd_text in rows:
        lat, lon, address, source = process_position(c, pid, title, company, location, jd_text)
        short_t = (title or "")[:40]
        if source == "remote":
            c.execute("UPDATE positions SET is_remote = 1 WHERE id = ?", (pid,))
            stats["remote"] += 1
            print(f"  [#{pid:3d}] remote   | {short_t}")
        elif source == "skip":
            stats["skip"] += 1
            print(f"  [#{pid:3d}] skip     | {short_t} (loc={location!r})")
        elif lat is not None:
            c.execute(
                "UPDATE positions SET office_lat = ?, office_lon = ?, office_address = ?, office_geocoded = 1 WHERE id = ?",
                (lat, lon, address, pid),
            )
            if "cached" in source:
                stats["cache"] += 1
            else:
                stats[source.split("-")[0]] += 1
            print(f"  [#{pid:3d}] {source:18s} ({lat:.4f},{lon:.4f}) | {short_t}")
            db.commit()
        else:
            stats["skip"] += 1
            print(f"  [#{pid:3d}] miss     | {short_t}")

    db.commit()

    total = c.execute("SELECT COUNT(*) FROM positions WHERE status != 'excluded'").fetchone()[0]
    coded = c.execute("SELECT COUNT(*) FROM positions WHERE office_lat IS NOT NULL AND status != 'excluded'").fetchone()[0]
    remote = c.execute("SELECT COUNT(*) FROM positions WHERE is_remote = 1 AND status != 'excluded'").fetchone()[0]

    print()
    print("=" * 50)
    print(f"  address:  {stats['address']:3d}")
    print(f"  company:  {stats['company']:3d}")
    print(f"  location: {stats['location']:3d}")
    print(f"  remote:   {stats['remote']:3d}")
    print(f"  skip:     {stats['skip']:3d}")
    print(f"  cache hits: {stats['cache']:3d}")
    print(f"  active geocoded: {coded}/{total}")
    print(f"  active remote:   {remote}/{total}")


if __name__ == "__main__":
    main()
