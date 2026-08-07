#!/usr/bin/env python3
"""log_archive.py — archiviazione a freddo degli storici di monitoraggio.

Flow ordinato da Leone (19/07): gli storici append-only crescono per
sempre → le settimane più vecchie di RETAIN_DAYS vengono TAGLIATE dal
file vivo, zippate in `logs/archive/logs-<YYYY>-W<ww>.zip` (lo zip della
settimana si amplia a ogni giro: un member per sorgente+run) e, SOLO se
lo spazio si riempie, gli archivi più vecchi vengono eliminati.

Garanzie:
  - il taglio è atomico (tmp → replace) e conserva le righe appese dai
    daemon durante il giro (tail-merge sul byte-offset letto);
  - una riga entra nello zip PRIMA di sparire dal file vivo: mai perdita
    senza archiviazione, salvo il prune-spazio esplicito (riportato);
  - righe con timestamp illeggibile restano nel file vivo (fail-safe);
  - jobs.db NON viene mai toccato: solo i log elencati in SOURCES.

RETAIN_DAYS default 30: la finestra 30G del gioco continua a leggere
tutto dal file vivo; oltre, si va di zip.

CLI:
    python3 log_archive.py run [--dry-run] [--retain-days 30]
                               [--max-archive-mb 500] [--min-free-gb 1]
    python3 log_archive.py status
Output: UNA riga JSON di summary su stdout (parsabile dal Mantenitore).
"""
import argparse
import json
import os
import shutil
import sys
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
LOGS = JHT_HOME / "logs"
ARCHIVE_DIR = LOGS / "archive"
LOCK = LOGS / "log-archive.lock"

# Gli storici che crescono. csv_header: la prima riga resta nel vivo.
SOURCES = [
    {"file": "sentinel-data.jsonl", "kind": "jsonl"},
    {"file": "token-meter.csv", "kind": "csv"},
    {"file": "throttle-events.jsonl", "kind": "jsonl"},
    {"file": "agent-vitals.jsonl", "kind": "jsonl"},
    {"file": "vitals.jsonl", "kind": "jsonl"},
]


def row_ts(line: str, kind: str) -> float:
    """Unix ts della riga, 0.0 se illeggibile (→ resta nel vivo)."""
    try:
        if kind == "jsonl":
            raw = json.loads(line).get("ts")
        else:
            raw = line.split(",", 1)[0]
        d = datetime.fromisoformat(str(raw).replace(" ", "T").replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d.timestamp()
    except Exception:
        return 0.0


def week_of(ts: float) -> str:
    iso = datetime.fromtimestamp(ts, tz=timezone.utc).isocalendar()
    return "%d-W%02d" % (iso.year, iso.week)


def archive_source(src: dict, cutoff: float, stamp: str, dry: bool) -> dict:
    path = LOGS / src["file"]
    res = {"file": src["file"], "archived": 0, "kept": 0, "weeks": []}
    if not path.exists():
        res["missing"] = True
        return res
    size_at_read = path.stat().st_size
    with path.open("rb") as f:
        raw = f.read(size_at_read)
    lines = raw.decode(errors="replace").splitlines(keepends=True)
    header = ""
    if src["kind"] == "csv" and lines and row_ts(lines[0], "csv") == 0.0:
        header = lines.pop(0)
    old: dict = {}  # settimana → [righe]
    keep: list = []
    for line in lines:
        ts = row_ts(line, src["kind"])
        if ts > 0.0 and ts < cutoff:
            old.setdefault(week_of(ts), []).append(line)
        else:
            keep.append(line)
    res["archived"] = sum(len(v) for v in old.values())
    res["kept"] = len(keep)
    res["weeks"] = sorted(old)
    if dry or not old:
        return res
    # 1) PRIMA nello zip (member nuovo per run: lo zip si amplia)
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    for week, rows in sorted(old.items()):
        zpath = ARCHIVE_DIR / ("logs-%s.zip" % week)
        member = "%s.%s" % (src["file"], stamp)
        payload = (header + "".join(rows)).encode()
        with zipfile.ZipFile(zpath, "a", zipfile.ZIP_DEFLATED) as z:
            z.writestr(member, payload)
    # 2) POI il taglio atomico, riappendendo ciò che i daemon hanno
    #    scritto durante il giro (tail oltre il byte-offset letto)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("wb") as f:
        f.write((header + "".join(keep)).encode())
        with path.open("rb") as live:
            live.seek(size_at_read)
            f.write(live.read())
    tmp.replace(path)
    return res


def prune_archives(max_mb: float, min_free_gb: float, dry: bool) -> list:
    """Elimina gli zip PIÙ VECCHI solo sotto pressione di spazio."""
    removed = []
    zips = sorted(ARCHIVE_DIR.glob("logs-*.zip"))  # nome = ordine cronologico
    def total_mb():
        return sum(z.stat().st_size for z in ARCHIVE_DIR.glob("logs-*.zip")) / 1048576.0
    def free_gb():
        return shutil.disk_usage(str(LOGS)).free / 1073741824.0
    for z in zips[:-1]:  # mai l'ultimo: la settimana appena archiviata
        if total_mb() <= max_mb and free_gb() >= min_free_gb:
            break
        removed.append({"zip": z.name, "mb": round(z.stat().st_size / 1048576.0, 1)})
        if not dry:
            z.unlink()
    return removed


def status() -> dict:
    out = {"retain_target": "vedi run --retain-days", "sources": [], "archive": []}
    for src in SOURCES:
        p = LOGS / src["file"]
        if not p.exists():
            out["sources"].append({"file": src["file"], "missing": True})
            continue
        first = last = 0.0
        with p.open(errors="replace") as f:
            for line in f:
                ts = row_ts(line, src["kind"])
                if ts > 0.0:
                    first = first or ts
                    last = ts
        out["sources"].append({
            "file": src["file"], "mb": round(p.stat().st_size / 1048576.0, 2),
            "oldest": datetime.fromtimestamp(first, tz=timezone.utc).isoformat() if first else None,
            "newest": datetime.fromtimestamp(last, tz=timezone.utc).isoformat() if last else None})
    for z in sorted(ARCHIVE_DIR.glob("logs-*.zip")):
        out["archive"].append({"zip": z.name,
                               "mb": round(z.stat().st_size / 1048576.0, 2)})
    out["free_gb"] = round(shutil.disk_usage(str(LOGS)).free / 1073741824.0, 1)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", nargs="?", default="run", choices=["run", "status"])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--retain-days", type=float, default=30.0)
    ap.add_argument("--max-archive-mb", type=float, default=500.0)
    ap.add_argument("--min-free-gb", type=float, default=1.0)
    args = ap.parse_args()

    if args.cmd == "status":
        print(json.dumps(status(), separators=(",", ":")))
        return

    # lock anti-concorrenza (due sweep sovrapposti = taglio doppio)
    if LOCK.exists() and time.time() - LOCK.stat().st_mtime < 3600:
        print(json.dumps({"ok": False, "error": "lock active (another run is in progress)"}))
        sys.exit(1)
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    LOCK.write_text(str(os.getpid()))
    try:
        cutoff = time.time() - args.retain_days * 86400.0
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        summary = {"ok": True, "dry_run": args.dry_run,
                   "retain_days": args.retain_days,
                   "cutoff": datetime.fromtimestamp(cutoff, tz=timezone.utc).isoformat(),
                   "sources": [], "pruned": []}
        for src in SOURCES:
            summary["sources"].append(archive_source(src, cutoff, stamp, args.dry_run))
        if ARCHIVE_DIR.exists():
            summary["pruned"] = prune_archives(args.max_archive_mb,
                                               args.min_free_gb, args.dry_run)
        print(json.dumps(summary, separators=(",", ":")))
    finally:
        LOCK.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
