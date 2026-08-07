#!/usr/bin/env python3
"""Supabase ↔ Google Sheets synchronization.

Usage:
  python3 db_to_sheets.py sync           # sync Supabase → Sheet
  python3 db_to_sheets.py sync --dry-run # show what would be written
  python3 db_to_sheets.py read           # read the current sheet contents
  python3 db_to_sheets.py pull           # read checkmarks from the sheet → update Supabase

Required environment variables:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or read from .env.local)
  GOOGLE_SERVICE_ACCOUNT_PATH (optional, default: shared/secrets)
"""

import sys
import os
import json
import urllib.request
import urllib.error
import urllib.parse
from datetime import datetime

# Google Sheets config
SPREADSHEET_ID = os.environ.get("GOOGLE_SHEETS_ID", "")
SHEET_NAME = "Job Applications"

# Service account path (legacy location)
SERVICE_ACCOUNT_PATH = os.environ.get(
    "GOOGLE_SERVICE_ACCOUNT_PATH",
    os.path.join(os.path.dirname(__file__), '..', 'secrets', 'google-service-account.json')
)

HEADERS = [
    "#", "Status", "Company", "Title", "Link", "Location",
    "Remote", "Salary", "Score", "Critic", "Verdict",
    "CV Drive", "CL Drive", "Applied", "Application Date"
]


def load_env():
    """Carica credenziali Supabase da .env.local o variabili d'ambiente."""
    sb_url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not sb_url or not sb_key:
        env_file = os.path.join(os.path.dirname(__file__), '..', '..', 'web', '.env.local')
        if os.path.exists(env_file):
            with open(env_file) as f:
                for line in f:
                    line = line.strip()
                    if "=" in line and not line.startswith("#"):
                        k, v = line.split("=", 1)
                        if k == "NEXT_PUBLIC_SUPABASE_URL":
                            sb_url = sb_url or v
                        elif k == "SUPABASE_SERVICE_ROLE_KEY":
                            sb_key = sb_key or v

    if not sb_url or not sb_key:
        print("ERROR: Supabase credentials not found")
        sys.exit(1)

    return sb_url, sb_key


def supabase_get(url, key, path):
    """GET request a Supabase REST API."""
    endpoint = f"{url}/rest/v1/{path}"
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    req = urllib.request.Request(endpoint, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def supabase_patch(url, key, table, filters, data):
    """PATCH request a Supabase REST API."""
    endpoint = f"{url}/rest/v1/{table}?{filters}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    body = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(endpoint, data=body, headers=headers, method="PATCH")
    urllib.request.urlopen(req)


def get_sheet():
    """Connette a Google Sheets e ritorna il worksheet."""
    try:
        import gspread
    except ImportError:
        print("ERROR: gspread is not installed. Run: pip3 install gspread")
        sys.exit(1)

    gc = gspread.service_account(filename=SERVICE_ACCOUNT_PATH)
    sh = gc.open_by_key(SPREADSHEET_ID)
    try:
        return sh.worksheet(SHEET_NAME)
    except gspread.exceptions.WorksheetNotFound:
        ws = sh.add_worksheet(title=SHEET_NAME, rows=500, cols=len(HEADERS))
        ws.append_row(HEADERS)
        return ws


def drive_url(drive_id):
    """Costruisce URL Google Drive da un drive_id."""
    if not drive_id:
        return ""
    return f"https://drive.google.com/file/d/{drive_id}/view"


def format_salary(pos):
    """Formatta lo stipendio."""
    parts = []
    if pos.get('salary_declared_min') or pos.get('salary_declared_max'):
        lo = pos.get('salary_declared_min') or '?'
        hi = pos.get('salary_declared_max') or '?'
        cur = pos.get('salary_declared_currency') or 'EUR'
        parts.append(f"{lo}-{hi} {cur}")
    if pos.get('salary_estimated_min') or pos.get('salary_estimated_max'):
        lo = pos.get('salary_estimated_min') or '?'
        hi = pos.get('salary_estimated_max') or '?'
        parts.append(f"~{lo}-{hi}")
    return ' | '.join(parts) if parts else ""


def cmd_sync(dry_run=False):
    """Sync Supabase → Google Sheets."""
    sb_url, sb_key = load_env()

    print("Loading data from Supabase...")
    positions = supabase_get(sb_url, sb_key,
        "positions?select=*,scores(*),applications(*)&order=created_at.desc&limit=500")

    rows_data = []
    for i, pos in enumerate(positions, 1):
        score = pos.get("scores") or {}
        if isinstance(score, list):
            score = score[0] if score else {}
        app = pos.get("applications") or {}
        if isinstance(app, list):
            app = app[0] if app else {}

        rows_data.append([
            str(i),
            pos.get("status", ""),
            pos.get("company", ""),
            pos.get("title", ""),
            pos.get("url", ""),
            pos.get("location", ""),
            pos.get("remote_type", ""),
            format_salary(pos),
            str(score.get("total_score", "")) if score else "",
            str(app.get("critic_score", "")) if app.get("critic_score") else "",
            app.get("critic_verdict", ""),
            drive_url(app.get("cv_drive_id")),
            drive_url(app.get("cl_drive_id")),
            "TRUE" if app.get("applied") else "FALSE",
            app.get("applied_at", ""),
        ])

    print(f"Prepared {len(rows_data)} rows")

    if dry_run:
        for row in rows_data[:5]:
            print(f"  {row[2]} | {row[3]} | {row[1]} | Score: {row[8]}")
        print(f"  ... and {len(rows_data) - 5} more rows")
        return

    print("Writing to Google Sheets...")
    ws = get_sheet()
    ws.clear()
    ws.append_row(HEADERS)
    if rows_data:
        ws.append_rows(rows_data)
    print(f"Sync complete: {len(rows_data)} rows written to '{SHEET_NAME}'")


def cmd_read():
    """Leggi contenuto attuale del foglio."""
    ws = get_sheet()
    data = ws.get_all_values()
    for row in data[:10]:
        print(" | ".join(row[:8]))
    if len(data) > 10:
        print(f"... and {len(data) - 10} more rows")


def cmd_pull():
    """Leggi spunte 'Applicato' dal foglio e aggiorna Supabase."""
    sb_url, sb_key = load_env()

    print("Reading Google Sheets...")
    ws = get_sheet()
    data = ws.get_all_values()

    if len(data) < 2:
        print("Empty sheet")
        return

    headers = data[0]
    # New sheets use English headers. Accept the old Italian names while
    # reading so existing user-managed sheets keep working unchanged.
    def header_index(*names):
        return next((headers.index(name) for name in names if name in headers), -1)

    applicato_col = header_index("Applied", "Applicato")
    azienda_col = header_index("Company", "Azienda")
    titolo_col = header_index("Title", "Titolo")

    if applicato_col == -1:
        print("Column 'Applied' not found")
        return

    updates = 0
    for row in data[1:]:
        if len(row) <= applicato_col:
            continue

        applicato = row[applicato_col].strip().upper()
        if applicato in ("TRUE", "SÌ", "SI", "YES", "1", "✓"):
            company = row[azienda_col] if azienda_col >= 0 else ""
            title = row[titolo_col] if titolo_col >= 0 else ""

            if company and title:
                # Cerca position in Supabase
                positions = supabase_get(sb_url, sb_key,
                    f"positions?company=eq.{urllib.parse.quote(company)}&title=eq.{urllib.parse.quote(title)}&select=id,status")

                for pos in positions:
                    if pos["status"] not in ("applied", "response"):
                        supabase_patch(sb_url, sb_key, "applications",
                            f"position_id=eq.{pos['id']}",
                            {"applied": True, "applied_at": datetime.utcnow().isoformat()})
                        supabase_patch(sb_url, sb_key, "positions",
                            f"id=eq.{pos['id']}",
                            {"status": "applied"})
                        updates += 1
                        print(f"  ✓ {company} — {title} → applied")

    print(f"\nUpdated: {updates} records")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == "sync":
        dry_run = "--dry-run" in sys.argv
        cmd_sync(dry_run)
    elif cmd == "read":
        cmd_read()
    elif cmd == "pull":
        cmd_pull()
    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
