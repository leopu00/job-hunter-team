#!/usr/bin/env python3
"""Sync sim 5 SQLite (~/.jht-sim-d2/jobs.db nel container jht-sim-d2)
verso Supabase prod, scope `user_id = <email>`.

Match key: `url` (unique nel dataset). Per ogni position sim con
enrichment popolato, PATCH solo i campi enrichment+office sul record
Supabase corrispondente. NON tocca status, notes, scores, salary.

Usage (preflight):
    SUPABASE_URL=https://...supabase.co \\
    SUPABASE_SERVICE_ROLE_KEY=eyJ... \\
    python3 scripts/sim/sync-sim-to-supabase.py [--email <e>] [--dry-run]

Default email: beta-user@example.com
"""
import os
import sys
import json
import argparse
import urllib.parse
import urllib.request
import subprocess


# Campi che il sync sovrascrive su Supabase. NON includere status/notes/
# scores/etc.
SYNC_FIELDS = [
    "role_family",
    "loc_city", "loc_region", "loc_country", "loc_country_code", "loc_continent",
    "work_mode", "work_country", "work_country_code",
    "is_multi_location", "location_notes",
    "office_lat", "office_lon", "office_address",
    "office_geocoded", "office_verified",
]


def http_json(method, url, headers, body=None):
    data = None
    h = dict(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else None


def resolve_user_id(base_url, headers, email):
    url = f"{base_url}/auth/v1/admin/users?email={urllib.parse.quote(email)}"
    data = http_json("GET", url, headers)
    users = data.get("users") if isinstance(data, dict) else data
    if not users:
        print(f"✗ no user with email {email}", file=sys.stderr)
        sys.exit(3)
    for u in users:
        if u.get("email") == email:
            return u["id"]
    print(f"✗ no exact match for {email}", file=sys.stderr)
    sys.exit(3)


def fetch_sim_rows():
    """Estrae le righe sim dal container via docker exec."""
    script = """
import sqlite3, json, sys
c = sqlite3.connect('/jht_home_sim/jobs.db').cursor()
fields = ['url',{}]
sql = 'SELECT ' + ','.join(fields) + " FROM positions WHERE url IS NOT NULL AND role_family IS NOT NULL"
rows = c.execute(sql).fetchall()
out = []
for r in rows:
    d = dict(zip(fields, r))
    # SQLite booleans → bool
    for k in ('is_multi_location','office_geocoded','office_verified'):
        if d.get(k) is not None:
            d[k] = bool(d[k])
    out.append(d)
print(json.dumps(out, ensure_ascii=False))
""".format(
        ",".join(f"'{f}'" for f in SYNC_FIELDS),
    )
    # Bypass MSYS path translation on Windows Git Bash
    env = {**os.environ, "MSYS_NO_PATHCONV": "1"}
    proc = subprocess.run(
        ["docker", "exec", "jht-sim-d2", "python3", "-c", script],
        capture_output=True, text=True, env=env, encoding="utf-8",
    )
    if proc.returncode != 0:
        print(f"✗ docker exec failed: {proc.stderr}", file=sys.stderr)
        sys.exit(4)
    return json.loads(proc.stdout)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", default="beta-user@example.com")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    url = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
    ).rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("Set SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY.", file=sys.stderr)
        sys.exit(2)

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }

    print(f"→ resolving user_id for {args.email}…", file=sys.stderr)
    user_id = resolve_user_id(url, headers, args.email)
    print(f"  user_id = {user_id}", file=sys.stderr)

    print(f"→ fetching sim rows from container…", file=sys.stderr)
    sim_rows = fetch_sim_rows()
    print(f"  retrieved {len(sim_rows)} rows with enrichment", file=sys.stderr)

    if args.limit > 0:
        sim_rows = sim_rows[: args.limit]
        print(f"  limited to {len(sim_rows)} rows (--limit)", file=sys.stderr)

    # Company 140-check pre-sync: counts su Supabase prima del sync
    pre_q = f"{url}/rest/v1/positions?select=id&user_id=eq.{user_id}&office_address=not.is.null"
    pre = http_json("GET", pre_q, headers) or []
    print(f"\n  pre-sync: {len(pre)} positions di {args.email} hanno office_address su Supabase", file=sys.stderr)

    stats = {"matched": 0, "updated": 0, "no_match": 0, "err": 0}
    misses = []
    for i, row in enumerate(sim_rows, 1):
        sim_url = row.pop("url")
        if not sim_url:
            stats["no_match"] += 1
            continue
        # Match per url + user_id
        q = (
            f"{url}/rest/v1/positions"
            f"?select=id&user_id=eq.{user_id}"
            f"&url=eq.{urllib.parse.quote(sim_url, safe='')}"
        )
        try:
            found = http_json("GET", q, headers) or []
        except Exception as e:
            print(f"  ! lookup error: {e}", file=sys.stderr)
            stats["err"] += 1
            continue
        if not found:
            stats["no_match"] += 1
            misses.append(sim_url[:80])
            continue
        pid = found[0]["id"]
        stats["matched"] += 1

        if args.dry_run:
            print(f"  [{i:3d}/{len(sim_rows)}] would PATCH id={pid}")
            continue

        # PATCH solo i SYNC_FIELDS — tutti gli altri restano intatti.
        patch_body = {k: row.get(k) for k in SYNC_FIELDS}
        try:
            http_json(
                "PATCH",
                f"{url}/rest/v1/positions?id=eq.{pid}",
                {**headers, "Prefer": "return=minimal"},
                patch_body,
            )
            stats["updated"] += 1
            if i % 20 == 0:
                print(f"  …{i}/{len(sim_rows)} updated", file=sys.stderr)
        except Exception as e:
            print(f"  ! PATCH error id={pid}: {e}", file=sys.stderr)
            stats["err"] += 1

    print(f"\n  stats: {stats}")
    if misses:
        print(f"\n  first 10 no_match url (sim rows con url non trovato in Supabase):")
        for u in misses[:10]:
            print(f"    {u}")

    if not args.dry_run:
        # Post-sync sanity
        post = http_json("GET", pre_q, headers) or []
        print(f"\n  post-sync: {len(post)} positions hanno office_address (was {len(pre)})")
        # Verifica zero contaminazione su altri user
        other_q = f"{url}/rest/v1/positions?select=id&user_id=neq.{user_id}&office_address=not.is.null"
        try:
            other = http_json("GET", other_q, headers) or []
            print(f"  other users office_address count: {len(other)} (sanity)")
        except Exception:
            pass


if __name__ == "__main__":
    main()
