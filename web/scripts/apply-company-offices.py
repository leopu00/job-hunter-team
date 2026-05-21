#!/usr/bin/env python3
"""Applica office addresses ai positions tramite mappa company -> address
caricata da file utente locale (mai versionata).

Il file contiene il dataset privato dell'utente (quali aziende compaiono
nella sua pipeline di ricerca) e va tenuto FUORI dal repo. Default path:
  ~/.jht/scripts-data/company-offices.json
Formato: oggetto { "Company Name": "indirizzo completo per Nominatim", ... }

Lo script geocodifica gli address via Nominatim (1 req/s) e aggiorna
positions.office_lat/lon + cache `location_geocode` con source='websearch'.

Run: python3 web/scripts/apply-company-offices.py [--data path.json]
"""
import os
import sqlite3
import time
import sys
import json
import argparse
import urllib.parse
import urllib.request

DB_PATH = os.path.expanduser("~/.jht/jobs.db")
DEFAULT_DATA = os.path.expanduser("~/.jht/scripts-data/company-offices.json")
NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "JobHunterTeam/0.1 - company HQ geocoding"


def geocode(query: str):
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
        print(f"  ! error: {e}", file=sys.stderr)
        return None
    if not data:
        return None
    first = data[0]
    addr = first.get("address", {})
    return {
        "lat": float(first["lat"]),
        "lon": float(first["lon"]),
        "city": addr.get("city") or addr.get("town") or addr.get("village") or None,
        "country": addr.get("country") or None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--data",
        default=DEFAULT_DATA,
        help=f"JSON file company->address (default: {DEFAULT_DATA})",
    )
    args = ap.parse_args()

    if not os.path.exists(args.data):
        print(
            f"! manca il file dati locale: {args.data}\n"
            f"  crea un JSON {{\"Company\": \"address\", ...}} con la tua mappa.",
            file=sys.stderr,
        )
        sys.exit(2)

    with open(args.data, "r", encoding="utf-8") as f:
        company_office = json.load(f)

    db = sqlite3.connect(DB_PATH)
    c = db.cursor()
    print(f"=== applying {len(company_office)} company HQ addresses ===")
    updated = 0
    geocoded = 0
    miss = 0

    for company, address in company_office.items():
        positions = c.execute(
            "SELECT id FROM positions WHERE company = ? AND status != 'excluded'",
            (company,),
        ).fetchall()
        if not positions:
            continue

        canonical = f"office:{company.lower()}"
        cached = c.execute(
            "SELECT lat, lon FROM location_geocode WHERE canonical = ?",
            (canonical,),
        ).fetchone()

        if cached and cached[0] is not None:
            lat, lon = cached[0], cached[1]
            tag = "cached"
        else:
            time.sleep(1.1)
            geo = geocode(address)
            if geo is None:
                print(f"  [miss]    {company}")
                miss += 1
                c.execute(
                    """INSERT OR REPLACE INTO location_geocode
                       (canonical, raw_text, lat, lon, city, country, source)
                       VALUES (?, ?, NULL, NULL, NULL, NULL, 'websearch-miss')""",
                    (canonical, address),
                )
                db.commit()
                continue
            lat, lon = geo["lat"], geo["lon"]
            c.execute(
                """INSERT OR REPLACE INTO location_geocode
                   (canonical, raw_text, lat, lon, city, country, source)
                   VALUES (?, ?, ?, ?, ?, ?, 'websearch')""",
                (canonical, address, lat, lon, geo["city"], geo["country"]),
            )
            geocoded += 1
            tag = "new"

        n = c.execute(
            """UPDATE positions
               SET office_lat = ?, office_lon = ?, office_geocoded = 1
               WHERE company = ? AND status != 'excluded'""",
            (lat, lon, company),
        ).rowcount
        updated += n
        print(f"  [{tag:6s}]  {company:30s} ({lat:.4f},{lon:.4f}) -> {n} positions")
        db.commit()

    print()
    print("=" * 50)
    print(f"  HQ geocoded:  {geocoded}")
    print(f"  HQ miss:      {miss}")
    print(f"  positions updated: {updated}")

    coded = c.execute(
        "SELECT COUNT(*) FROM positions WHERE office_lat IS NOT NULL AND status != 'excluded'"
    ).fetchone()[0]
    total = c.execute(
        "SELECT COUNT(*) FROM positions WHERE status != 'excluded'"
    ).fetchone()[0]
    distinct = c.execute(
        "SELECT COUNT(DISTINCT office_lat || ',' || office_lon) "
        "FROM positions WHERE office_lat IS NOT NULL AND status != 'excluded'"
    ).fetchone()[0]
    print(f"  active geocoded: {coded}/{total}  ({distinct} distinct coords)")


if __name__ == "__main__":
    main()
