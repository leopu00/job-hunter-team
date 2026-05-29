#!/usr/bin/env python3
"""Reverse-geocoding del backlog Supabase per positions con office_lat
non NULL ma office_address NULL.

Usage:
    SUPABASE_URL=https://...supabase.co \
    SUPABASE_SERVICE_ROLE_KEY=eyJ... \
    python3 web/scripts/reverse-geocode-supabase.py [--limit N] [--dry-run]

Note:
- Service role key richiesta perché anon non puo' fare UPDATE su
  `positions` (RLS). Recuperala dal Supabase dashboard → Settings → API.
- Rate limit Nominatim: 1 req/s. Lo script aspetta tra le chiamate.
- Idempotente: chi ha gia' office_address viene saltato.
- Cache locale opzionale su location_geocode? No: i centroidi delle
  citta' tendono a ritornare lo stesso indirizzo, e il nostro 'reverse'
  e' su lat/lon discreti (city-center fallback). Niente cache locale.
"""
import os
import sys
import time
import json
import argparse
import urllib.parse
import urllib.request

NOMINATIM = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "JobHunterTeam/0.1 (backlog-reverse-geocode)"


def http_json(method: str, url: str, headers: dict, body=None):
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers = {**headers, "Content-Type": "application/json"}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8")) if resp.length else None


def reverse_geocode(lat: float, lon: float) -> str | None:
    url = NOMINATIM + "?" + urllib.parse.urlencode({
        "lat": lat, "lon": lon, "format": "json", "zoom": 18, "addressdetails": 1,
    })
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT, "Accept": "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  ! nominatim error: {e}", file=sys.stderr)
        return None
    addr = data.get("address", {}) if isinstance(data, dict) else {}
    street_bits = [s for s in [addr.get("road"), addr.get("house_number")] if s]
    street = " ".join(street_bits).strip()
    suburb = addr.get("suburb")
    city = addr.get("city") or addr.get("town") or addr.get("village")
    compact = ", ".join([s for s in [street, suburb, city] if s])
    return compact or data.get("display_name") or None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="Max positions to update (0 = no limit)")
    parser.add_argument("--dry-run", action="store_true", help="Print only, no DB writes")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.", file=sys.stderr)
        sys.exit(2)

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Prefer": "return=minimal",
    }

    # Fetch backlog
    select = "id,title,company,office_lat,office_lon"
    query = (
        f"{url}/rest/v1/positions"
        f"?select={select}"
        f"&status=neq.excluded"
        f"&office_lat=not.is.null"
        f"&office_address=is.null"
        f"&order=id.asc"
    )
    if args.limit > 0:
        query += f"&limit={args.limit}"

    rows = http_json("GET", query, headers) or []
    print(f"backlog: {len(rows)} positions to reverse-geocode")
    if not rows:
        return

    stats = {"ok": 0, "miss": 0, "err": 0}
    for i, p in enumerate(rows, 1):
        pid = p["id"]
        lat = p["office_lat"]
        lon = p["office_lon"]
        short = (p.get("title") or "")[:40]
        print(f"  [{i:3d}/{len(rows)}] {pid} ({lat:.4f},{lon:.4f}) {short}")
        addr = reverse_geocode(float(lat), float(lon))
        if not addr:
            stats["miss"] += 1
            print(f"          → miss")
            time.sleep(1.1)
            continue
        print(f"          → {addr}")
        if not args.dry_run:
            try:
                http_json(
                    "PATCH",
                    f"{url}/rest/v1/positions?id=eq.{pid}",
                    headers,
                    {"office_address": addr},
                )
                stats["ok"] += 1
            except Exception as e:
                print(f"          ! update error: {e}", file=sys.stderr)
                stats["err"] += 1
        else:
            stats["ok"] += 1
        time.sleep(1.1)  # Nominatim rate limit

    print(f"\ndone: {stats}")


if __name__ == "__main__":
    main()
