#!/usr/bin/env python3
"""profile_apply.py — one turn of the onboarding in ONE command: write the profile, write the summaries, check, answer.

The Assistente used to spend about six model calls on each message of the user: an edit of `candidate_profile.yml`, a
write of a summary, a check that the YAML still loads, the answer in the chat, and the empty call that closes the turn.
Every call re-reads the whole conversation from the cache, so the calls cost far more than the words in them. This
command does the four steps in one go, in the order the skill `profile-yaml` asks for them:

  1. merge `set` / `append` into `$JHT_HOME/profile/candidate_profile.yml` (written whole, in one atomic replace: the
     app polls the file, a half-written one blanks the left panel),
  2. check it with `validate_profile.py`; a profile that does not load or is not an object is put back as it was,
  3. write the summaries (`about`, `preferences`, `goals`, `strengths`: the four fixed names, rewritten whole),
  4. only when 1-3 held, send `say` to the chat with `jht-send`.

  python3 /app/shared/skills/profile_apply.py <<'JSON'
  {"set": {"name": "Ada Example", "preferences.work_mode": "remote"},
   "append": {"skills.primary": ["SQL", "Python"]},
   "summaries": {"about": "I am a data analyst ..."},
   "say": "[caldo] Nice to meet you, Ada - ... Which city do you want to work in?",
   "kind": "info"}
  JSON

`set` takes dotted paths and replaces the value there (a list is replaced whole); `append` adds the items of a list that
are not in it yet. Every key is optional. The answer is one JSON object on stdout:

  {"ok": true, "written": [...], "missing": [...], "launch_missing": [...], "launch_ready": bool, "ready_flag": bool,
   "invalid": [...], "language_warnings": [...], "said": bool}

`missing` is what a complete profile still lacks (normal while it is being built); `invalid` is a field that IS there
and is wrong, to fix with the next call. Exit 0 = applied; 1 = nothing was applied (the reason is in `error`).
Closing the onboarding (ready.flag, the message to the Capitano, the plan card) stays a decision of the flow: this
command only says `launch_ready`.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

SKILLS = Path(__file__).resolve().parent
SUMMARIES = ("about", "preferences", "goals", "strengths")
KINDS = ("urgent", "blocked", "completed", "info")
MAX_SUMMARY = 4000
MAX_SAY = 16 * 1024


def _home() -> Path:
    return Path(os.environ.get("JHT_HOME") or Path.home() / ".jht")


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _dotted(path: str) -> list[str]:
    parts = path.split(".")
    if not path or any(not part.strip() for part in parts):
        raise ValueError(f"not a path: {path!r}")
    return parts


def _walk(doc: dict, parts: list[str]) -> dict:
    node = doc
    for part in parts[:-1]:
        child = node.get(part)
        if child is None:
            child = node[part] = {}
        if not isinstance(child, dict):
            raise ValueError(f"{'.'.join(parts)}: {part!r} is not an object in the profile")
        node = child
    return node


def merge(doc: dict, request: dict) -> list[str]:
    """Apply `set` and `append` to `doc` in place; return the dotted paths touched."""
    touched: list[str] = []
    for path, value in (request.get("set") or {}).items():
        parts = _dotted(path)
        _walk(doc, parts)[parts[-1]] = value
        touched.append(path)
    for path, items in (request.get("append") or {}).items():
        parts = _dotted(path)
        if not isinstance(items, list):
            raise ValueError(f"append {path}: a list is needed")
        node = _walk(doc, parts)
        current = node.get(parts[-1])
        if current is None:
            current = node[parts[-1]] = []
        if not isinstance(current, list):
            raise ValueError(f"append {path}: the profile has no list there")
        current.extend(item for item in items if item not in current)
        touched.append(path)
    return touched


def check(profile: Path) -> dict:
    """validate_profile.py in its two modes; what is only missing is not an error while the profile is built."""
    out: dict = {"missing": [], "launch_missing": [], "invalid": [], "language_warnings": []}
    for flag, key in (("--json", None), ("--json --launch", "launch")):
        done = subprocess.run([sys.executable, "-I", str(SKILLS / "validate_profile.py"), str(profile), *flag.split()],
                              capture_output=True, text=True, timeout=60, check=False)
        try:
            report = json.loads(done.stdout)
        except ValueError:
            return {**out, "invalid": [f"validate_profile gave no report (rc {done.returncode})"]}
        if key == "launch":
            out["launch_missing"] = report.get("launch_missing") or []
            continue
        for line in report.get("errors") or []:
            (out["missing"] if "required" in line else out["invalid"]).append(line)
        out["language_warnings"] = report.get("language_warnings") or []
    return out


def check_summaries(texts: dict) -> None:
    for name, text in texts.items():
        if name not in SUMMARIES:
            raise ValueError(f"summary {name!r}: the names are {', '.join(SUMMARIES)} (any other is ignored by the app)")
        if not isinstance(text, str) or not text.strip() or len(text) > MAX_SUMMARY:
            raise ValueError(f"summary {name!r}: a non-empty text of at most {MAX_SUMMARY} characters")


def write_summaries(texts: dict, profile_dir: Path) -> list[str]:
    written = []
    for name, text in texts.items():
        _atomic_write(profile_dir / "summaries" / f"{name}.md", text.strip() + "\n")
        written.append(f"summaries/{name}.md")
    return written


def check_say(request: dict) -> str:
    kind = request.get("kind") or "info"
    if request.get("say") is not None and (kind not in KINDS or not str(request["say"]).strip()
                                           or len(str(request["say"]).encode("utf-8")) > MAX_SAY):
        raise ValueError("say: a non-empty text, and kind one of " + ", ".join(KINDS))
    return kind


def say(text: str, kind: str) -> bool:
    send = os.environ.get("JHT_SEND_BIN") or "jht-send"
    cmd = [send, "--kind", kind, "-"] if kind != "info" else [send, "-"]
    return subprocess.run(cmd, input=text, text=True, timeout=60, check=False).returncode == 0


def apply(request: dict) -> tuple[int, dict]:
    import yaml  # the container has it; the app's own files are written with it too

    if not isinstance(request, dict):
        return 1, {"ok": False, "error": "the request must be a JSON object"}
    profile_dir = _home() / "profile"
    profile = profile_dir / "candidate_profile.yml"
    before = profile.read_text(encoding="utf-8") if profile.is_file() else None
    try:
        doc = yaml.safe_load(before) if before else {}
        if doc is None:
            doc = {}
        if not isinstance(doc, dict):
            raise ValueError("the profile on disk is not an object")
        touched = merge(doc, request)
        # a bad summary or message is refused BEFORE anything is written
        check_summaries(request.get("summaries") or {})
        kind = check_say(request)
        rendered = yaml.safe_dump(doc, sort_keys=False, allow_unicode=True, default_flow_style=False, width=1000)
        yaml.safe_load(rendered)
    except (ValueError, yaml.YAMLError) as exc:
        return 1, {"ok": False, "error": str(exc)}
    written: list[str] = []
    if touched:
        _atomic_write(profile, rendered)
        written.append("candidate_profile.yml")
    try:
        report = check(profile) if profile.is_file() else {"missing": [], "launch_missing": [], "invalid": [], "language_warnings": []}
        written += write_summaries(request.get("summaries") or {}, profile_dir)
    except (ValueError, OSError, subprocess.SubprocessError) as exc:
        if touched:  # nothing half-applied: the profile goes back as it was
            if before is None:
                profile.unlink(missing_ok=True)
            else:
                _atomic_write(profile, before)
        return 1, {"ok": False, "error": str(exc)}
    said = say(str(request["say"]), kind) if request.get("say") is not None else False
    launch_ready = profile.is_file() and not report["launch_missing"]
    return 0, {"ok": True, "written": written, **report, "launch_ready": launch_ready,
               "ready_flag": (profile_dir / "ready.flag").is_file(), "said": said}


def main() -> int:
    raw = sys.stdin.read()
    try:
        request = json.loads(raw)
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": f"the request is not JSON: {exc}"}))
        return 1
    code, answer = apply(request)
    print(json.dumps(answer, ensure_ascii=False))
    return code


if __name__ == "__main__":
    sys.exit(main())
