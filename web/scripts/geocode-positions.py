#!/usr/bin/env python3
"""Backfill geocoding per positions.location -> office_lat/lon.

MVP locale, scrive solo su ~/.jht/jobs.db (SQLite). Niente Supabase.

Workflow per ogni location distinct con count desc:
  1. se matcha remote_kw -> marca tutte le positions come is_remote=1
  2. altrimenti:
     - canonical = normalizza (lowercase, no parens, collapse ws)
     - check location_geocode cache; hit -> riusa
     - miss -> chiama Nominatim (1 req/s, User-Agent obbligatorio)
              -> salva in cache
     - UPDATE positions SET office_lat, office_lon, office_geocoded=1
       WHERE location = original_text AND office_lat IS NULL

Rate limit Nominatim: 1 req/s. Su ~50 location distinte: ~1 min.

Run: python3 web/scripts/geocode-positions.py
"""
import os
import sqlite3
import re
import time
import sys
import urllib.parse
import urllib.request
import json

DB_PATH = os.path.expanduser("~/.jht/jobs.db")
NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "JobHunterTeam/0.1 (leone.puglisi@gmail.com) - local MVP geocoding"

REMOTE_KW = re.compile(
    r"\b(remote|worldwide|anywhere|teleworking|wfh|home[\s-]?based|smart\s*work|"
    r"remoto|distance|hybrid\s*-?\s*remote)\b",
    re.I,
)

# Locations che da sole non hanno senso geografico ("Advice", "European Union")
SKIP_NON_PLACE = {"advice", "european union", "europe", "eu"}


def canonicalize(loc: str) -> str:
    """Normalizza una location per dedup cache.

    "Rome, Latium, Italy" -> "rome, latium, italy"
    "Rome, Italy (also Milan, London or remote)" -> "rome, italy"
    "Hybrid - Bristol - UK" -> "bristol, uk"
    """
    s = loc.strip()
    # Rimuovi parentesi (e contenuto) per liberare la primaria
    s = re.sub(r"\([^)]*\)", "", s)
    # Rimuovi prefissi "Hybrid - " / "Onsite - " / etc.
    s = re.sub(r"^(hybrid|onsite|on-site|in-?office)\s*[-:]\s*", "", s, flags=re.I)
    # Collassa whitespace + sostituisci " - " con ", "
    s = re.sub(r"\s*-\s*", ", ", s)
    s = re.sub(r"\s+", " ", s).strip(" ,.;")
    # Tagli su ";" o " or " — teniamo la prima alternativa
    s = re.split(r"\s*(?:;| or )\s*", s, maxsplit=1)[0]
    return s.lower()


def geocode(query: str):
    """Chiama Nominatim. Ritorna {lat, lon, city, country} o None."""
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
    db = sqlite3.connect(DB_PATH)
    c = db.cursor()

    rows = c.execute(
        """SELECT location, COUNT(*)
           FROM positions
           WHERE location IS NOT NULL AND status != 'excluded'
           GROUP BY location
           ORDER BY COUNT(*) DESC"""
    ).fetchall()
    print(f"distinct locations to process: {len(rows)}")

    cache_hits = 0
    api_calls = 0
    remote_marked = 0
    skipped = 0
    geocoded = 0

    for raw, cnt in rows:
        # 1) Remote?
        if REMOTE_KW.search(raw):
            n = c.execute(
                "UPDATE positions SET is_remote = 1 WHERE location = ?",
                (raw,),
            ).rowcount
            remote_marked += n
            print(f"  [remote] {raw!r} -> {n} positions")
            continue

        canonical = canonicalize(raw)
        if canonical in SKIP_NON_PLACE or len(canonical) < 3:
            skipped += 1
            print(f"  [skip]   {raw!r} (canonical={canonical!r})")
            continue

        # 2) Cache?
        row = c.execute(
            "SELECT lat, lon FROM location_geocode WHERE canonical = ?",
            (canonical,),
        ).fetchone()

        if row and row[0] is not None:
            lat, lon = row
            cache_hits += 1
            print(f"  [cache]  {raw!r} -> ({lat}, {lon})")
        else:
            # 3) Nominatim (rate-limited)
            time.sleep(1.1)
            r = geocode(canonical)
            api_calls += 1
            if r is None:
                # negative cache: scrivo NULL per evitare retry continui
                c.execute(
                    """INSERT OR REPLACE INTO location_geocode
                       (canonical, raw_text, lat, lon, city, country, source)
                       VALUES (?, ?, NULL, NULL, NULL, NULL, 'nominatim-miss')""",
                    (canonical, raw),
                )
                print(f"  [miss]   {raw!r} (canonical={canonical!r})")
                continue
            lat, lon = r["lat"], r["lon"]
            c.execute(
                """INSERT OR REPLACE INTO location_geocode
                   (canonical, raw_text, lat, lon, city, country, source)
                   VALUES (?, ?, ?, ?, ?, ?, 'nominatim')""",
                (canonical, raw, lat, lon, r["city"], r["country"]),
            )
            geocoded += 1
            print(
                f"  [api]    {raw!r} -> ({lat}, {lon}) {r.get('city','')}/{r.get('country','')}"
            )

        # Update positions
        c.execute(
            """UPDATE positions
               SET office_lat = ?, office_lon = ?, office_geocoded = 1
               WHERE location = ? AND office_lat IS NULL""",
            (lat, lon, raw),
        )

    db.commit()
    print()
    print("=" * 50)
    print(f"  remote marked:   {remote_marked} positions")
    print(f"  skipped:         {skipped} locations")
    print(f"  cache hits:      {cache_hits} locations")
    print(f"  API calls:       {api_calls}")
    print(f"  geocoded:        {geocoded} locations")

    # Final stats
    total = c.execute("SELECT COUNT(*) FROM positions").fetchone()[0]
    coded = c.execute(
        "SELECT COUNT(*) FROM positions WHERE office_lat IS NOT NULL"
    ).fetchone()[0]
    remote = c.execute(
        "SELECT COUNT(*) FROM positions WHERE is_remote = 1"
    ).fetchone()[0]
    print(f"  positions with coords: {coded}/{total}")
    print(f"  positions remote:      {remote}/{total}")


if __name__ == "__main__":
    main()
