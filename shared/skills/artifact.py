#!/usr/bin/env python3
"""artifact.py — read a document produced by the team, or hand one to it.

Two directions across the same boundary, the user's data area:

    fetch   the team wrote a CV, a cover letter, a critique → give me the bytes
    upload  this is my CV → put it where the agents can read it

Both existed only inside the Godot office and the web dashboard, so an agent
driving `jht` could read every field of a position but not the document
attached to it. See [JHT-CLI-AGENT-PARITY] in BACKLOG.md.

    python3 artifact.py fetch /jht_user/cv/cv_42.pdf --kind pdf
    python3 artifact.py upload --name cv.pdf   # bytes as base64 on stdin

Output: one JSON row on stdout; exit 0 on success, 1 on refusal or failure.
  {"ok": true, "path": "/jht_user/cv/cv_42.pdf", "kind": "pdf",
   "bytes": 20841, "b64": "JVBERi0..."}
  {"ok": false, "error": "invalid document"}

WHY THE PATH IS NOT TRUSTED. `path` comes from `cv_path`/`cl_path` in jobs.db,
written by agents from data scraped off the internet. It is an untrusted string
that names a file, so it gets the same treatment as the desktop client gives it
(`game/scripts/backend/payloads/artifact.py`): only the four data roots, no
traversal, the declared kind must match the suffix, no double extension, and
every path component is opened with openat + O_NOFOLLOW — no window between
checking a path and opening it in which a component can become a symlink.
`tests/test_artifact_skill.py` runs the adversarial table against BOTH
implementations and fails when they disagree, because two copies of a security
rule that drift are worse than one.
"""
import argparse
import base64
import json
import os
import stat
import sys

# La zona visibile dell'utente. Nel container è /jht_user (bind mount di
# ~/Documents/Job Hunter Team); i test la spostano in una cartella temporanea.
DEFAULT_ROOT = "/jht_user"
CONTAINER_ROOT = "/jht_user"

# Le stesse quattro aree del client desktop, nello stesso ordine.
SUBDIRS = ("cv", "allegati", "output", "critiche")
UPLOAD_SUBDIR = "allegati"

EXTS = {"markdown": ".md", "pdf": ".pdf"}
MAX_BYTES = 10 * 1024 * 1024

# Stesso elenco di VpsBackend.UPLOAD_EXTS e della route web di upload: quello
# che il team sa leggere, non "qualunque file".
UPLOAD_EXTS = (
    "pdf", "doc", "docx", "txt", "md", "png", "jpg", "jpeg",
    "csv", "xlsx", "xls", "json", "yaml", "yml",
)


def user_root() -> str:
    """La radice dell'area dati. `JHT_ARTIFACT_ROOT` esiste per i test e per
    il fallback host: fuori dal container /jht_user non c'è, e senza override
    ogni fetch fallirebbe con "file non trovato" invece di dire dove ha
    guardato."""
    return (os.environ.get("JHT_ARTIFACT_ROOT")
            or os.environ.get("JHT_USER_DIR")
            or DEFAULT_ROOT).rstrip("/") or "/"


def roots() -> tuple[str, ...]:
    base = user_root()
    return tuple(base + "/" + name for name in SUBDIRS)


def remap(path: str) -> str:
    """I path nel jobs.db sono scritti dal container (/jht_user/...). Quando la
    skill gira con un'altra radice — host o test — vanno riportati lì, ma solo
    riscrivendo il PREFISSO: tutto il resto del path resta l'input non fidato
    che era, e passa comunque dai controlli sotto."""
    base = user_root()
    if base != CONTAINER_ROOT and path.startswith(CONTAINER_ROOT + "/"):
        return base + path[len(CONTAINER_ROOT):]
    return path


def emit(payload: dict) -> int:
    print(json.dumps(payload))
    return 0 if payload.get("ok") else 1


def _open_beneath(root: str, relative: str) -> int:
    """openat + O_NOFOLLOW su ogni componente. Copia fedele di
    `open_beneath` nel payload del client desktop: qualunque componente sia (o
    diventi) un symlink fa fallire l'apertura, invece di seguire il link fuori
    dalla radice."""
    dflags = os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW
    fd = os.open(root, dflags)
    try:
        parts = relative.split("/")
        for part in parts[:-1]:
            child = os.open(part, dflags, dir_fd=fd)
            os.close(fd)
            fd = child
        return os.open(parts[-1],
                       os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK,
                       dir_fd=fd)
    finally:
        os.close(fd)


def is_allowed_request(path: str, kind: str) -> bool:
    """Il path è canonico, dentro una radice nota e coerente col tipo
    dichiarato? Nessuna normalizzazione permissiva: traversal, slash doppi,
    spazi ai bordi e separatori Windows sono input non canonico, non modi
    alternativi di scrivere lo stesso path."""
    if not path or path != path.strip() or not path.startswith("/") \
            or "\\" in path or "\0" in path:
        return False
    parts = path.split("/")
    if "." in parts or ".." in parts or "//" in path:
        return False
    if not any(path.startswith(root + "/") for root in roots()):
        return False
    suffix = EXTS.get(kind, "")
    if not suffix:
        return False
    name = os.path.basename(path)
    if not name.lower().endswith(suffix):
        return False
    stem = name[:-len(suffix)]
    # Doppia estensione: payload.pdf.exe e payload.exe.pdf sono entrambi "no".
    return bool(stem) and "." not in stem


def is_pdf_bytes(data: bytes) -> bool:
    """Header al byte zero e EOF vicino alla coda: un prefisso MZ/HTML seguito
    da %PDF è polimorfo, e il solo magic non basta a dire "è un PDF"."""
    return (len(data) >= 10 and data.startswith(b"%PDF-")
            and b"%%EOF" in data[-1024:])


def fetch(path: str, kind: str) -> dict:
    requested = path
    path = remap(path)
    if not is_allowed_request(path, kind):
        return {"ok": False, "error": "invalid document", "path": requested}
    root = next(r for r in roots() if path.startswith(r + "/"))
    try:
        fd = _open_beneath(root, path[len(root) + 1:])
    except FileNotFoundError:
        return {"ok": False, "error": "file not found", "path": requested}
    except OSError:
        return {"ok": False, "error": "invalid document", "path": requested}
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            return {"ok": False, "error": "invalid document", "path": requested}
        if info.st_size > MAX_BYTES:
            return {"ok": False, "error": "file over 10 MB", "path": requested}
        with os.fdopen(fd, "rb", closefd=False) as fh:
            data = fh.read(MAX_BYTES + 1)
    finally:
        os.close(fd)
    if len(data) > MAX_BYTES:
        return {"ok": False, "error": "file over 10 MB", "path": requested}
    if kind == "pdf" and not is_pdf_bytes(data):
        return {"ok": False, "error": "invalid document", "path": requested}
    return {"ok": True, "path": requested, "kind": kind, "bytes": len(data),
            "b64": base64.b64encode(data).decode()}


def safe_filename(name: str) -> str:
    """Solo [A-Za-z0-9._-], il resto diventa `_`. Stessa igiene di
    `VpsBackend._safe_filename` e della route web: il nome arriva dall'utente e
    finisce in un path e nel payload di un agente, quindi deve essere stabile e
    indipendente dalla lingua."""
    keep = []
    for ch in os.path.basename(name):
        keep.append(ch if (ch.isascii() and (ch.isalnum() or ch in "._-")) else "_")
    cleaned = "".join(keep).lstrip(".")
    return cleaned or "document"


def is_uploaded_document_path(path: str) -> bool:
    """È un riferimento canonico alla drop-zone condivisa?

    Il ticket non riceve i byte: riceve il path già restituito da ``upload``.
    Validarlo qui evita che le tre superfici inventino ciascuna una propria
    idea di path allegato e, soprattutto, che un valore scritto dall'utente
    trasformi il ticket in un riferimento arbitrario sul filesystem.
    """
    prefix = CONTAINER_ROOT + "/" + UPLOAD_SUBDIR + "/"
    if not isinstance(path, str) or path != path.strip() \
            or not path.startswith(prefix) or "\\" in path or "\0" in path:
        return False
    name = path[len(prefix):]
    if not name or "/" in name or name != safe_filename(name):
        return False
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    return ext in UPLOAD_EXTS


def upload(name: str, data: bytes) -> dict:
    safe = safe_filename(name)
    ext = safe.rsplit(".", 1)[-1].lower() if "." in safe else ""
    if ext not in UPLOAD_EXTS:
        return {"ok": False,
                "error": f"extension not allowed: {ext or '(none)'}",
                "allowed": list(UPLOAD_EXTS)}
    if not data:
        return {"ok": False, "error": "empty file"}
    if len(data) > MAX_BYTES:
        return {"ok": False, "error": "file over 10 MB"}
    target_dir = user_root() + "/" + UPLOAD_SUBDIR
    try:
        os.makedirs(target_dir, exist_ok=True)
    except OSError as exc:
        return {"ok": False, "error": f"drop-zone unavailable: {exc.strerror}"}
    # O_NOFOLLOW: ricaricare un documento SOVRASCRIVE quello con lo stesso nome
    # (è il gesto che l'utente si aspetta), ma mai attraverso un symlink piazzato
    # lì da qualcun altro — quello scriverebbe fuori dall'area dati.
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW | os.O_CLOEXEC
    try:
        fd = os.open(target_dir + "/" + safe, flags, 0o644)
    except OSError as exc:
        return {"ok": False, "error": f"cannot write the document: {exc.strerror}"}
    try:
        with os.fdopen(fd, "wb", closefd=False) as fh:
            fh.write(data)
    finally:
        os.close(fd)
    # Il path tornato è quello che il team userà: sempre in forma container,
    # perché è quella che finisce nel jobs.db e nei prompt degli agenti.
    container_path = CONTAINER_ROOT + "/" + UPLOAD_SUBDIR + "/" + safe
    return {"ok": True, "path": container_path, "name": safe, "bytes": len(data)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser("fetch", help="read a document produced by the team")
    p_fetch.add_argument("path", help="absolute path inside the user data area")
    p_fetch.add_argument("--kind", choices=sorted(EXTS), required=True,
                         help="declared type; must match the suffix")

    p_upload = sub.add_parser("upload", help="hand a document to the team")
    p_upload.add_argument("--name", required=True,
                          help="file name (the bytes arrive base64 on stdin)")

    p_roots = sub.add_parser("roots", help="the data areas this skill can read")

    args = parser.parse_args()
    if args.command == "fetch":
        return emit(fetch(args.path, args.kind))
    if args.command == "roots":
        return emit({"ok": True, "root": user_root(), "roots": list(roots()),
                     "upload_dir": user_root() + "/" + UPLOAD_SUBDIR})
    raw = sys.stdin.buffer.read()
    try:
        data = base64.b64decode(raw, validate=True)
    except Exception:
        return emit({"ok": False, "error": "stdin is not valid base64"})
    return emit(upload(args.name, data))


if __name__ == "__main__":
    sys.exit(main())
