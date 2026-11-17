"""The release targets of the 0.4.0 benchmark page: the data hold together and every word is there in the seven languages.

The page (web/app/case-studies/benchmark-0-4-0/page.tsx) reads web/data/benchmark/benchmark-0-4-0.json: the targets, the
rounds of each build, the rounds themselves. The JSON is updated at every build, so a target that points at a round that is
not there, a status the page cannot draw or a word missing in one language would only show on the live page.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "web" / "data" / "benchmark" / "benchmark-0-4-0.json").read_text(encoding="utf-8"))
PAGE = (ROOT / "web" / "app" / "case-studies" / "benchmark-0-4-0" / "page.tsx").read_text(encoding="utf-8")
LANGUAGES = ("en", "it", "de", "es", "fr", "pt", "hu")
STATUSES = {"pass", "fail", "pending", "blocked"}


def _blocks() -> dict[str, str]:
    """The copy of each language in the page, from `  <lang>: {` to the next one."""
    starts = sorted((PAGE.index(f"\n  {lang}: {{\n"), lang) for lang in LANGUAGES)
    end = PAGE.index("\n};\n", starts[-1][0])
    out = {}
    for i, (at, lang) in enumerate(starts):
        out[lang] = PAGE[at : starts[i + 1][0] if i + 1 < len(starts) else end]
    return out


BLOCKS = _blocks()


def _has_key(block: str, key: str) -> bool:
    return re.search(rf'^\s+"?{re.escape(key)}"?:\s', block, re.M) is not None


def test_every_target_has_a_status_the_page_draws_and_a_proof_that_exists():
    rounds = {r["id"] for r in DATA["rounds"]}
    assert len(DATA["targets"]) == 17
    assert len({t["id"] for t in DATA["targets"]}) == 17
    for target in DATA["targets"]:
        assert target["status"] in STATUSES, target
        assert set(target["proof"]) <= rounds, target
        # a target met says on which build
        if target["status"] in {"pass", "fail", "blocked"}:
            assert isinstance(target["build"], int), target
        # a target without a round below says why, met or not
        assert target["proof"] or target["note"], target


def test_the_builds_list_their_rounds_and_a_build_without_rounds_says_so():
    rounds = {r["id"]: r for r in DATA["rounds"]}
    numbers = [b["n"] for b in DATA["builds"]]
    assert numbers == sorted(numbers) and {6, 7, 8} <= set(numbers)
    for build in DATA["builds"]:
        for rid in build["rounds"]:
            assert rounds[rid].get("buildNo") == build["n"], rid
    assert next(b for b in DATA["builds"] if b["n"] == 7)["rounds"] == []


def test_every_word_of_the_targets_and_of_the_rounds_is_there_in_the_seven_languages():
    keys = {t["id"] for t in DATA["targets"]}
    notes = {t["note"] for t in DATA["targets"] if t["note"]}
    profiles = {r["profile"] for r in DATA["rounds"]}
    round_notes = {r["note"] for r in DATA["rounds"]}
    fields = ["targetsTitle", "targetsLead", "targetsCount", "targetsCols", "targetStatus", "buildsTitle", "buildLabel", "noRound"]
    for lang, block in BLOCKS.items():
        missing = [k for k in sorted(keys | notes | profiles | round_notes | set(fields) | STATUSES) if not _has_key(block, k)]
        assert missing == [], f"{lang}: {missing}"
        assert "{g}" in re.search(r'targetsCount: "([^"]*)"', block).group(1), lang
        assert "{n}" in re.search(r'buildLabel: "([^"]*)"', block).group(1), lang


def test_the_page_holds_no_name_of_a_test_person_and_no_machine():
    text = json.dumps(DATA, ensure_ascii=False) + PAGE
    for word in ("Antonio", "Esposito", "Franca", "Bellini", "Giovanni", "Pellegrini", "Lena", "Brandt", "jhtgiro", "VPS 42", "thinkpad"):
        assert word not in text, word
    assert re.search(r"\b\d{1,3}(\.\d{1,3}){3}\b", text) is None, "an IP address"
    assert "sk-" not in text
