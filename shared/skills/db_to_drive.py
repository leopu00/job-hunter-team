#!/usr/bin/env python3
"""Upload PDF delle candidature su Google Drive.

Uso:
  python3 db_to_drive.py auth            # autorizza con Google (una volta sola, apre browser)
  python3 db_to_drive.py upload          # carica tutti i PDF mancanti su Drive
  python3 db_to_drive.py upload --force  # ricarica tutti, anche quelli gia' su Drive
  python3 db_to_drive.py upload --id 42  # carica solo application ID 42
  python3 db_to_drive.py status          # mostra stato upload (quanti su Drive, quanti mancanti)
  python3 db_to_drive.py list            # lista file nella cartella Drive

Setup iniziale:
  1. Vai su https://console.cloud.google.com/apis/credentials
  2. Crea "ID client OAuth 2.0" → Tipo "App desktop"
  3. Scarica JSON → salva come shared/secrets/google-oauth-client.json
  4. python3 db_to_drive.py auth
"""

import sys
import os
import json
sys.path.insert(0, os.path.dirname(__file__))

from _db import get_db, ensure_schema

# Cartella root su Drive — configura JH_DRIVE_FOLDER_ID nel tuo .env
DRIVE_FOLDER_ID = os.environ.get("JH_DRIVE_FOLDER_ID", "")


def _require_drive_folder():
    """Verifica che JH_DRIVE_FOLDER_ID sia configurato."""
    if not DRIVE_FOLDER_ID:
        print("Errore: JH_DRIVE_FOLDER_ID non configurato. Aggiungi al tuo .env.")
        sys.exit(1)

SECRETS_DIR = os.path.join(os.path.dirname(__file__), '..', 'secrets')
OAUTH_CLIENT_PATH = os.path.join(SECRETS_DIR, 'google-oauth-client.json')
OAUTH_TOKEN_PATH = os.path.join(SECRETS_DIR, 'google-oauth-token.json')

SCOPES = ['https://www.googleapis.com/auth/drive']

# Radice del repo (per risolvere path relativi dei PDF)
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# Worktrees in cui cercare i PDF (ordine di priorita')
WORKTREES = [
    'scrittore-1', 'scrittore-2', 'scrittore-3',
    'critico',
    'alfa',
    'scorer',
    'analista-1', 'analista-2',
    'scout-1', 'scout-2',
]


def get_oauth_creds():
    """Carica credenziali OAuth2, refreshando il token se necessario."""
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request

    if not os.path.exists(OAUTH_TOKEN_PATH):
        print("Token non trovato. Esegui prima: python3 db_to_drive.py auth")
        sys.exit(1)

    creds = Credentials.from_authorized_user_file(OAUTH_TOKEN_PATH, SCOPES)

    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        # Salva token aggiornato
        with open(OAUTH_TOKEN_PATH, 'w') as f:
            f.write(creds.to_json())

    return creds


def get_drive_service():
    """Crea il servizio Google Drive API con OAuth2."""
    from googleapiclient.discovery import build
    creds = get_oauth_creds()
    return build('drive', 'v3', credentials=creds)


def cmd_auth():
    """Esegue il flusso OAuth2: apre il browser per autorizzare."""
    from google_auth_oauthlib.flow import InstalledAppFlow

    if not os.path.exists(OAUTH_CLIENT_PATH):
        print(f"File client OAuth non trovato: {OAUTH_CLIENT_PATH}")
        print()
        print("Setup:")
        print("  1. Vai su https://console.cloud.google.com/apis/credentials")
        print("  2. Crea 'ID client OAuth 2.0' -> Tipo 'App desktop'")
        print("  3. Scarica JSON -> salva come shared/secrets/google-oauth-client.json")
        sys.exit(1)

    flow = InstalledAppFlow.from_client_secrets_file(OAUTH_CLIENT_PATH, SCOPES)
    creds = flow.run_local_server(port=0)

    with open(OAUTH_TOKEN_PATH, 'w') as f:
        f.write(creds.to_json())

    print("Autorizzazione completata! Token salvato.")
    print(f"Token: {OAUTH_TOKEN_PATH}")


def find_pdf(relative_path):
    """Cerca un PDF nelle worktree, ritorna il path assoluto o None."""
    for wt in WORKTREES:
        full_path = os.path.join(REPO_ROOT, wt, relative_path)
        if os.path.isfile(full_path):
            return full_path
    return None


def get_or_create_subfolder(service, parent_id, folder_name):
    """Trova o crea una sottocartella su Drive."""
    query = (
        f"'{parent_id}' in parents "
        f"and name = '{folder_name}' "
        f"and mimeType = 'application/vnd.google-apps.folder' "
        f"and trashed = false"
    )
    results = service.files().list(q=query, fields='files(id)').execute()
    files = results.get('files', [])

    if files:
        return files[0]['id']

    metadata = {
        'name': folder_name,
        'mimeType': 'application/vnd.google-apps.folder',
        'parents': [parent_id]
    }
    folder = service.files().create(body=metadata, fields='id').execute()
    return folder['id']


def upload_file(service, local_path, parent_folder_id, filename=None):
    """Carica un file su Drive, ritorna file ID."""
    from googleapiclient.http import MediaFileUpload

    if filename is None:
        filename = os.path.basename(local_path)

    # Controlla se esiste gia' un file con lo stesso nome nella cartella
    query = (
        f"'{parent_folder_id}' in parents "
        f"and name = '{filename}' "
        f"and trashed = false"
    )
    existing = service.files().list(q=query, fields='files(id)').execute().get('files', [])

    if existing:
        # Aggiorna il file esistente
        file_id = existing[0]['id']
        media = MediaFileUpload(local_path, mimetype='application/pdf')
        service.files().update(
            fileId=file_id,
            media_body=media
        ).execute()
        return file_id

    # Carica nuovo file
    metadata = {
        'name': filename,
        'parents': [parent_folder_id]
    }
    media = MediaFileUpload(local_path, mimetype='application/pdf')
    uploaded = service.files().create(
        body=metadata,
        media_body=media,
        fields='id'
    ).execute()
    return uploaded['id']


def drive_link(file_id):
    """Genera link diretto per visualizzare il PDF."""
    return f"https://drive.google.com/file/d/{file_id}/view"


def cmd_upload(force=False, app_id=None):
    """Carica PDF su Drive per tutte le application."""
    _require_drive_folder()
    conn = get_db()
    ensure_schema(conn)

    if app_id:
        rows = conn.execute(
            "SELECT a.*, p.company FROM applications a "
            "JOIN positions p ON p.id = a.position_id "
            "WHERE a.id = ?", (app_id,)
        ).fetchall()
    else:
        if force:
            rows = conn.execute(
                "SELECT a.*, p.company FROM applications a "
                "JOIN positions p ON p.id = a.position_id "
                "WHERE a.cv_pdf_path IS NOT NULL"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT a.*, p.company FROM applications a "
                "JOIN positions p ON p.id = a.position_id "
                "WHERE a.cv_pdf_path IS NOT NULL "
                "AND (a.cv_drive_id IS NULL OR a.cl_drive_id IS NULL)"
            ).fetchall()

    if not rows:
        print("Nessun PDF da caricare.")
        conn.close()
        return

    print(f"Application da processare: {len(rows)}")

    service = get_drive_service()
    uploaded = 0
    errors = 0

    for r in rows:
        company = r['company'] or 'unknown'
        folder_name = company.lower().replace(' ', '-').replace('/', '-')
        app_id_current = r['id']

        print(f"\n[App #{app_id_current}] {company}")

        subfolder_id = get_or_create_subfolder(service, DRIVE_FOLDER_ID, folder_name)

        cv_drive_id = r['cv_drive_id']
        cl_drive_id = r['cl_drive_id']

        # Upload CV
        if r['cv_pdf_path'] and (force or not cv_drive_id):
            local = find_pdf(r['cv_pdf_path'])
            if local:
                try:
                    cv_drive_id = upload_file(service, local, subfolder_id)
                    print(f"  CV: {drive_link(cv_drive_id)}")
                    uploaded += 1
                except Exception as e:
                    print(f"  CV ERRORE: {e}")
                    errors += 1
            else:
                print(f"  CV non trovato: {r['cv_pdf_path']}")
                errors += 1

        # Upload CL
        if r['cl_pdf_path'] and (force or not cl_drive_id):
            local = find_pdf(r['cl_pdf_path'])
            if local:
                try:
                    cl_drive_id = upload_file(service, local, subfolder_id)
                    print(f"  CL: {drive_link(cl_drive_id)}")
                    uploaded += 1
                except Exception as e:
                    print(f"  CL ERRORE: {e}")
                    errors += 1
            else:
                print(f"  CL non trovato: {r['cl_pdf_path']}")
                errors += 1

        # Aggiorna DB
        conn.execute(
            "UPDATE applications SET cv_drive_id = ?, cl_drive_id = ? WHERE id = ?",
            (cv_drive_id, cl_drive_id, app_id_current)
        )
        conn.commit()

    conn.close()
    print(f"\nCompletato: {uploaded} file caricati, {errors} errori")
    print(f"Cartella Drive: https://drive.google.com/drive/folders/{DRIVE_FOLDER_ID}")


def cmd_status():
    """Mostra stato degli upload."""
    conn = get_db()
    ensure_schema(conn)

    total = conn.execute("SELECT COUNT(*) FROM applications WHERE cv_pdf_path IS NOT NULL").fetchone()[0]
    on_drive = conn.execute("SELECT COUNT(*) FROM applications WHERE cv_drive_id IS NOT NULL").fetchone()[0]
    missing = total - on_drive

    print(f"Totale application con PDF: {total}")
    print(f"Gia' su Drive: {on_drive}")
    print(f"Da caricare: {missing}")

    conn.close()


def cmd_list():
    """Lista file nella cartella Drive."""
    _require_drive_folder()
    service = get_drive_service()

    query = (
        f"'{DRIVE_FOLDER_ID}' in parents "
        f"and mimeType = 'application/vnd.google-apps.folder' "
        f"and trashed = false"
    )
    folders = service.files().list(
        q=query, fields='files(id, name)', orderBy='name'
    ).execute().get('files', [])

    print(f"Sottocartelle: {len(folders)}")
    for f in folders:
        q2 = f"'{f['id']}' in parents and trashed = false"
        count = len(service.files().list(q=q2, fields='files(id)').execute().get('files', []))
        print(f"  {f['name']}/  ({count} file)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "auth":
        cmd_auth()
    elif cmd == "upload":
        force = "--force" in sys.argv
        app_id = None
        if "--id" in sys.argv:
            idx = sys.argv.index("--id")
            if idx + 1 < len(sys.argv):
                app_id = int(sys.argv[idx + 1])
        cmd_upload(force=force, app_id=app_id)
    elif cmd == "status":
        cmd_status()
    elif cmd == "list":
        cmd_list()
    else:
        print(f"Comando sconosciuto: {cmd}")
        print(__doc__)
        sys.exit(1)
