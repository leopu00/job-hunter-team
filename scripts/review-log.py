#!/usr/bin/env python3
"""
review-log.py — manage docs/REVIEW-LOG.md from docs/review-log.json

Source of truth: docs/review-log.json (path, description, last_review).
Generated:       docs/REVIEW-LOG.md (DO NOT EDIT BY HAND).

Commands
--------
  sync (default)   Scan repo, reconcile JSON (add new files, drop deleted),
                   regenerate MD with fresh git update dates + review flags.
  check            Read-only. Exit 1 if the index has drifted from the repo.
                   Writes nothing — in particular it never touches
                   `last_review`. Meant for CI (see .github/workflows/lint.yml).
  mark <path>      Set last_review = today for <path>, then sync.
  bootstrap        One-shot: parse current MD, seed JSON with descriptions
                   and last_review values found there.

Why `check` ignores two of the five columns
-------------------------------------------
`🔄 Update` and `❗ Rivedi` are derived from `git log -1 --format=%cs`, i.e.
from the date of the last commit that touched the file. Neither the author
nor CI can commit a correct value for them: at the moment you generate the
table, the commit that is about to change the file does not exist yet, so
every `.md` you are committing still carries its *previous* update date.
The file is stale the instant it lands.

Comparing those two columns would therefore fail on every PR that touches
any `.md` — a gate that is red for a reason nobody can fix is a gate that
gets switched off. `check` compares only what a human controls: the set of
files, and the columns that come from the JSON (description, last_review).
The git dates drift silently and the next `sync` fixes them for free.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

REPO_ROOT = Path(__file__).resolve().parent.parent
JSON_PATH = REPO_ROOT / "docs" / "review-log.json"
MD_PATH = REPO_ROOT / "docs" / "REVIEW-LOG.md"

EXCLUDE_DIR_PARTS = {
    "node_modules", ".git", ".next", "dist", "build", ".venv", ".venv_uv",
    "__pycache__", ".pytest_cache",
    # Storia congelata: si conserva, non si rilegge.
    "_archive", "archive",
    # Payload vendorizzato dell'app Electron, eliminata il 2026-07-19: sono
    # copie di file i cui originali (`agents/alfa/`, `shared/docs/`) non
    # esistono più. Indicizzarle chiederebbe di rileggere periodicamente
    # documentazione che descrive un'applicazione che non spediamo, e ogni
    # riga sarebbe un invito a "aggiornarla" — cioè a curare un fossile.
    # Se un giorno la cartella esce dal repo, questa riga cade da sé.
    "app-payload",
}

# Le traduzioni dei prompt/skill (`<nome>.<locale>.md`) NON entrano nel
# registro: si rivede il file base, le altre 6 lingue lo seguono. Senza
# questo filtro l'indice passerebbe da ~250 a ~680 righe, per due terzi
# traduzioni — e diventerebbe inutile da leggere.
LOCALE_SUFFIX_RE = re.compile(r"\.(it|en|es|fr|de|hu|pt)\.md$")

SECTIONS: list[tuple[str, str]] = [
    ("root",            "🏠 Root"),
    ("github",          "🐙 .github"),
    ("agent_prompts",   "🤖 Agent prompts"),
    ("team_arch",       "📐 Team architecture & manuals"),
    ("skills_global",   "🛠️ Skill globali"),
    ("skills_sentinel", "💂 Skill Sentinella"),
    ("game",            "🎮 game (applicazione desktop)"),
    ("about",           "📖 docs/about"),
    ("adr",             "📜 docs/adr (Architecture Decision Records)"),
    ("guides",          "🧭 docs/guides"),
    ("internal",        "🛰️ docs/internal"),
    ("security",        "🔒 docs/security"),
    ("sessions",        "🧪 docs/sessions"),
    ("supabase",        "🗄️ supabase"),
    ("other",           "❓ Altri"),
]


def classify(path: str) -> str:
    if path.startswith(".github/"):                    return "github"
    if path.startswith("agents/_team/"):               return "team_arch"
    if path.startswith("agents/_manual/"):             return "team_arch"
    if path.startswith("agents/_skills/"):             return "skills_global"
    if path.startswith("agents/sentinella/_skills/"):  return "skills_sentinel"
    if path.startswith("agents/"):                     return "agent_prompts"
    if path.startswith("game/"):                       return "game"
    if path.startswith("docs/about/"):                 return "about"
    if path.startswith("docs/adr/"):                   return "adr"
    if path.startswith("docs/guides/"):                return "guides"
    if path.startswith("docs/internal/"):              return "internal"
    if path.startswith("docs/security/"):              return "security"
    if path.startswith("docs/sessions/"):              return "sessions"
    if path.startswith("supabase/"):                   return "supabase"
    if "/" not in path:                                return "root"
    return "other"


def md_link(path: str) -> str:
    """Path repo-relative → link relative to docs/REVIEW-LOG.md."""
    if path.startswith("docs/"):
        return "./" + path[len("docs/"):]
    return "../" + path


def scan_repo() -> list[str]:
    paths: list[str] = []
    for p in REPO_ROOT.rglob("*.md"):
        rel = p.relative_to(REPO_ROOT)
        if any(part in EXCLUDE_DIR_PARTS for part in rel.parts):
            continue
        if rel.name == "REVIEW-LOG.md":
            continue
        if LOCALE_SUFFIX_RE.search(rel.name):
            continue
        paths.append(str(rel).replace("\\", "/"))
    return sorted(paths)


_git_cache: dict[str, str | None] = {}


def git_last_update(path: str) -> str | None:
    if path in _git_cache:
        return _git_cache[path]
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cs", "--", path],
            capture_output=True, text=True, cwd=REPO_ROOT, check=True,
        ).stdout.strip()
        _git_cache[path] = out or None
    except (subprocess.CalledProcessError, FileNotFoundError):
        _git_cache[path] = None
    return _git_cache[path]


def needs_review(last_review: str | None, last_update: str | None) -> str:
    if last_review is None:
        return "✅"
    if last_update is None:
        return "🟢"
    return "✅" if last_review < last_update else "🟢"


# ---------- JSON I/O ----------

def load_json() -> dict:
    if not JSON_PATH.exists():
        return {"files": []}
    return json.loads(JSON_PATH.read_text(encoding="utf-8"))


def save_json(data: dict) -> None:
    JSON_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


# ---------- Bootstrap (parse existing MD) ----------

ROW_RE = re.compile(
    r"^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*"     # [label](link)
    r"\|\s*(.+?)\s*"                         # description
    r"\|\s*(—|\d{4}-\d{2}-\d{2})\s*"        # last review
    r"\|\s*(\d{4}-\d{2}-\d{2}|—)\s*"        # last update (ignored, recomputed)
    r"\|\s*[^|]+\|\s*$"                      # flag
)


def md_link_to_repo_path(link: str) -> str:
    if link.startswith("./"):
        return "docs/" + link[2:]
    if link.startswith("../"):
        return link[3:]
    return link


def bootstrap_from_md() -> dict:
    if not MD_PATH.exists():
        print("[bootstrap] no existing MD found, starting fresh")
        return {"files": []}
    files: list[dict] = []
    for line in MD_PATH.read_text(encoding="utf-8").splitlines():
        m = ROW_RE.match(line)
        if not m:
            continue
        _label, link, desc, last_review_raw, _update = m.groups()
        path = md_link_to_repo_path(link)
        last_review = None if last_review_raw == "—" else last_review_raw
        files.append({
            "path": path,
            "description": desc.strip(),
            "last_review": last_review,
        })
    print(f"[bootstrap] extracted {len(files)} entries from {MD_PATH.name}")
    return {"files": files}


# ---------- Sync (reconcile JSON with disk) ----------

def reconcile(data: dict) -> dict:
    on_disk = set(scan_repo())
    in_json = {e["path"]: e for e in data["files"]}

    added = sorted(on_disk - in_json.keys())
    removed = sorted(in_json.keys() - on_disk)

    for path in added:
        data["files"].append({
            "path": path,
            "description": "",
            "last_review": None,
        })
        print(f"[sync] + added {path}  (description vuota — riempila nel JSON)")

    if removed:
        data["files"] = [e for e in data["files"] if e["path"] not in removed]
        for path in removed:
            print(f"[sync] - removed {path}  (file non più nel repo)")

    if not added and not removed:
        print("[sync] no file additions or removals")

    return data


# ---------- Render ----------

HEADER = """# 📚 Review Log — JHT Documents

> ⚠️ **GENERATED FILE — DO NOT EDIT BY HAND.**
> Source of truth: [`review-log.json`](./review-log.json).
> Rigenera con: `python scripts/review-log.py sync`.

Indice di tutti i documenti markdown del repo, con stato di revisione personale.
Serve a tenere traccia di cosa hai già letto e cosa è cambiato dopo l'ultima lettura.

## 🧭 Come si usa

- **👀 Rev** = data in cui *tu* hai letto/validato il file. Vuota (`—`) se non l'hai mai letto.
- **🔄 Update** = data dell'ultimo commit che ha toccato il file (auto, da `git log`).
- **❗ Rivedi** = ✅ se `Rev` è `—` oppure `Rev < Update`. 🟢 se sei in pari.
- Marcare come letto oggi:    `python scripts/review-log.py mark <repo-relative-path>`
- Riallineare dopo nuovi file: `python scripts/review-log.py sync`
- Editare descrizione:         apri [`review-log.json`](./review-log.json) e modifica `description`, poi `sync`.

## 🗂️ Legenda emoji aree

- 🏠 root · 🐙 .github · 🤖 agenti · 📐 architettura/manuali · 🛠️ skill globali · 💂 skill Sentinella
- 📖 about · 📜 ADR · 🧭 guide · 🔒 security · 🛰️ internal · 🧪 sessions · 🗄️ supabase

---
"""

FOOTER = """
---

## 🔧 Manutenzione del file

- File generato da [`scripts/review-log.py`](../scripts/review-log.py).
- Source of truth: [`review-log.json`](./review-log.json) — qui editi descrizioni e date di revisione.
- `sync` aggiorna automaticamente `🔄 Update` (da `git log`) e `❗ Rivedi`, e aggiunge file nuovi (descrizione vuota).
- `mark <path>` setta `last_review` a oggi nel JSON e rigenera l'MD.
"""
# NOTA: HEADER e FOOTER finiscono dentro il file generato, e `check` li
# confronta. Toccarli richiede un `sync` + commit di docs/REVIEW-LOG.md nello
# stesso changeset, altrimenti il gate CI diventa rosso. `check` è
# documentato nel docstring del modulo e in .github/workflows/lint.yml.


def render_md(data: dict, *, git_dates: bool = True) -> str:
    """Render the MD table.

    `git_dates=False` skips the `git log` lookups and emits a placeholder in
    the two derived columns. Used by `check`, which strips those columns
    before comparing anyway — see the module docstring.
    """
    by_section: dict[str, list[dict]] = {sid: [] for sid, _ in SECTIONS}
    for entry in data["files"]:
        sid = classify(entry["path"])
        by_section.setdefault(sid, []).append(entry)

    parts: list[str] = [HEADER]

    for sid, label in SECTIONS:
        rows = by_section.get(sid, [])
        if not rows:
            continue
        parts.append(f"\n## {label}\n")
        parts.append("| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |")
        parts.append("|---|---|---|---|---|")
        for entry in rows:
            link = md_link(entry["path"])
            desc = (entry.get("description") or "").strip() or "_(da compilare nel JSON)_"
            last_review = entry.get("last_review") or "—"
            if git_dates:
                last_update = git_last_update(entry["path"]) or "—"
                flag = needs_review(entry.get("last_review"), git_last_update(entry["path"]))
            else:
                last_update = flag = "—"
            parts.append(f"| [{entry['path']}]({link}) | {desc} | {last_review} | {last_update} | {flag} |")
        parts.append("")

    parts.append(FOOTER)
    return "\n".join(parts)


def write_md(data: dict) -> None:
    MD_PATH.write_text(render_md(data), encoding="utf-8")
    print(f"[render] wrote {MD_PATH.relative_to(REPO_ROOT)}  ({len(data['files'])} entries)")


# ---------- Commands ----------

def cmd_sync(_args: argparse.Namespace) -> int:
    data = load_json()
    if not data["files"] and MD_PATH.exists():
        print("[sync] JSON empty — bootstrapping from existing MD")
        data = bootstrap_from_md()
    data = reconcile(data)
    save_json(data)
    write_md(data)
    return 0


def _strip_git_columns(line: str) -> str:
    """Drop the last two cells (`🔄 Update`, `❗ Rivedi`) from a data row."""
    if not line.startswith("| ["):
        return line
    return "|".join(line.split("|")[:-3])


def _comparable(md: str) -> list[str]:
    return [_strip_git_columns(l) for l in md.splitlines()]


def cmd_check(_args: argparse.Namespace) -> int:
    """Read-only drift gate. Never writes, never marks anything as reviewed."""
    failures: list[str] = []

    data = load_json()
    if not data["files"]:
        print(f"[check] ✗ {JSON_PATH.relative_to(REPO_ROOT)} is missing or empty.")
        print("        Run: python scripts/review-log.py sync")
        return 1

    on_disk = set(scan_repo())
    in_json = {e["path"] for e in data["files"]}

    missing = sorted(on_disk - in_json)
    stale = sorted(in_json - on_disk)

    if missing:
        failures.append(f"{len(missing)} markdown file(s) in the repo are absent from the index")
        for path in missing:
            print(f"[check] ✗ not indexed: {path}")
    if stale:
        failures.append(f"{len(stale)} indexed entr(y/ies) no longer exist on disk")
        for path in stale:
            print(f"[check] ✗ indexed but gone: {path}")

    if not MD_PATH.exists():
        failures.append(f"{MD_PATH.relative_to(REPO_ROOT)} does not exist")
        print(f"[check] ✗ missing generated file: {MD_PATH.relative_to(REPO_ROOT)}")
    else:
        expected = _comparable(render_md(data, git_dates=False))
        actual = _comparable(MD_PATH.read_text(encoding="utf-8"))
        if expected != actual:
            failures.append(
                f"{MD_PATH.relative_to(REPO_ROOT)} does not match "
                f"{JSON_PATH.relative_to(REPO_ROOT)} (ignoring the git-derived columns)"
            )
            print(f"[check] ✗ {MD_PATH.relative_to(REPO_ROOT)} is out of date w.r.t. the JSON.")
            for line in difflib.unified_diff(
                actual, expected,
                fromfile=f"{MD_PATH.name} (committed)",
                tofile=f"{MD_PATH.name} (from JSON)",
                lineterm="", n=0,
            ):
                print(f"        {line}")

    # Not a failure: an empty description is a gap in the content, not drift,
    # and `sync` cannot fill it. Surfacing it keeps the index from quietly
    # degrading into a list of paths.
    blank = [e["path"] for e in data["files"] if not (e.get("description") or "").strip()]
    if blank:
        print(f"[check] ⚠ {len(blank)} entr(y/ies) still have an empty description:")
        for path in blank:
            print(f"        - {path}")

    if failures:
        print()
        for f in failures:
            print(f"[check] FAIL: {f}")
        print()
        print("        Fix: python scripts/review-log.py sync")
        print("        then commit docs/review-log.json and docs/REVIEW-LOG.md.")
        print("        Fill in the description of any newly added file in the JSON.")
        return 1

    print(f"[check] ✓ index in sync ({len(data['files'])} entries).")
    return 0


def cmd_mark(args: argparse.Namespace) -> int:
    target = args.path.replace("\\", "/").lstrip("./")
    data = load_json()
    if not data["files"]:
        print("[mark] JSON empty — run `sync` first to seed it.", file=sys.stderr)
        return 1
    found = False
    for entry in data["files"]:
        if entry["path"] == target:
            entry["last_review"] = date.today().isoformat()
            found = True
            print(f"[mark] {target} → last_review={entry['last_review']}")
            break
    if not found:
        print(f"[mark] path not in JSON: {target}", file=sys.stderr)
        print("       (controlla il path repo-relative, es. 'docs/about/STORY.md')", file=sys.stderr)
        return 1
    save_json(data)
    write_md(data)
    return 0


def cmd_bootstrap(_args: argparse.Namespace) -> int:
    data = bootstrap_from_md()
    data = reconcile(data)
    save_json(data)
    write_md(data)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("sync", help="reconcile JSON with disk + regenerate MD")

    sub.add_parser("check", help="read-only: exit 1 if the index has drifted (CI gate)")

    p_mark = sub.add_parser("mark", help="set last_review=today for a file")
    p_mark.add_argument("path", help="repo-relative path (e.g. docs/about/STORY.md)")

    sub.add_parser("bootstrap", help="seed JSON from existing MD (one-shot)")

    args = parser.parse_args()
    cmd = args.cmd or "sync"

    if cmd == "sync":      return cmd_sync(args)
    if cmd == "check":     return cmd_check(args)
    if cmd == "mark":      return cmd_mark(args)
    if cmd == "bootstrap": return cmd_bootstrap(args)
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
