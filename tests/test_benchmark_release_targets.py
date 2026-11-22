"""The release targets of the 0.4.0 benchmark page: the data hold together and every word is there in the seven languages.

The page (web/app/case-studies/benchmark-0-4-0/page.tsx, its words in benchmarkShared.tsx) reads web/data/benchmark/benchmark-0-4-0.json: the targets, the
rounds of each build, the rounds themselves. The JSON is updated at every build, so a target that points at a round that is
not there, a status the page cannot draw or a word missing in one language would only show on the live page.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "web" / "data" / "benchmark" / "benchmark-0-4-0.json").read_text(encoding="utf-8"))
HERE = ROOT / "web" / "app" / "case-studies" / "benchmark-0-4-0"
# the words of the seven languages and the sections of the targets live in benchmarkShared.tsx; every file of the page is scanned
PAGE = (HERE / "benchmarkShared.tsx").read_text(encoding="utf-8")
ALL_FILES = "".join(p.read_text(encoding="utf-8") for p in sorted(HERE.rglob("*.ts*")))
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
    assert len(DATA["targets"]) == 25
    assert len({t["id"] for t in DATA["targets"]}) == 25
    sections = re.findall(r'^  \["(\w+)", "', PAGE, re.M)
    for target in DATA["targets"]:
        assert target["status"] in STATUSES, target
        # every target sits in a section the table draws; one that differs by system says which, once per row
        assert target["section"] in sections, target
        assert ("row" in target) == ("os" in target), target
        if "os" in target:
            assert target["os"] in {"windows", "linux", "macos"}, target
        assert set(target["proof"]) <= rounds, target
        # a target met says on which build; one still to try has no build to name
        if target["status"] in {"pass", "fail", "blocked"}:
            assert isinstance(target["build"], int), target
        else:
            assert target["build"] is None, target
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
    sections = {t["section"] for t in DATA["targets"]}
    rows = {t["row"] for t in DATA["targets"] if "row" in t}
    profiles = {r["profile"] for r in DATA["rounds"]}
    round_notes = {r["note"] for r in DATA["rounds"]}
    outcomes = {r["outcome"] for r in DATA["rounds"]}
    fields = ["targetsTitle", "targetsLead", "targetsCount", "targetsCols", "targetStatus", "targetSections", "targetRows", "buildsTitle", "buildLabel", "previousBuild", "paceNote", "noRound"]
    for lang, block in BLOCKS.items():
        missing = [k for k in sorted(keys | notes | sections | rows | profiles | round_notes | outcomes | set(fields) | STATUSES) if not _has_key(block, k)]
        assert missing == [], f"{lang}: {missing}"
        assert "{g}" in re.search(r'targetsCount: "([^"]*)"', block).group(1), lang
        assert "{n}" in re.search(r'buildLabel: "([^"]*)"', block).group(1), lang


# Generic forms only: a list of the real words would publish them here. A file outside the repo may add words.
PRIVATE_FORMS = {
    "an IP address": r"\b\d{1,3}(\.\d{1,3}){3}\b",
    "an e-mail address": r"[\w.+-]+@[\w-]+\.[\w.-]+",
    "an account of the test machines": r"\bjht[a-z]+\b",
    "a numbered server": r"\b(VPS|server|host)[\s-]*\d+\b",
    "a host of a private network": r"\b[\w-]+\.(local|lan|internal|home|ts\.net)\b",
    "a home folder": r"/home/\w+|/Users/\w+|[A-Z]:\\\\Users",
    "an API key": r"\b(sk|ghp|gho|xox[bp])[-_][A-Za-z0-9]|\bAKIA[0-9A-Z]{8,}|\beyJ[A-Za-z0-9_-]{10,}",
}


def test_the_page_holds_no_name_of_a_test_person_and_no_machine():
    text = json.dumps(DATA, ensure_ascii=False) + ALL_FILES
    for what, form in PRIVATE_FORMS.items():
        assert re.search(form, text, re.I) is None, what
    # a test person is a job, never a name: the profile of a round is a key the page translates
    for r in DATA["rounds"]:
        assert re.fullmatch(r"[a-z][A-Za-z]*", r["profile"]), r["id"]
    extra = os.environ.get("JHT_PRIVATE_WORDS_FILE")
    if extra and Path(extra).is_file():
        for word in Path(extra).read_text(encoding="utf-8").split("\n"):
            word = word.strip()
            assert not word or re.search(rf"\b{re.escape(word)}\b", text, re.I) is None, "a word of the private list"


def test_a_round_before_the_numbered_builds_says_so_and_no_figure_of_the_page_is_only_an_estimate():
    # r1-r8 ran before the numbered builds: the table and the page of the round write «earlier build», never a build number
    assert {r["id"] for r in DATA["rounds"] if r.get("buildNo") is None} == {f"r{i}" for i in range(1, 9)}
    # the services table shows what the rounds measured: an estimate of the kit is not a measure and is not kept
    for service in DATA["services"]:
        assert "kitEstimate30min" not in service, service["id"]
    assert "kitEstimate30min" not in ALL_FILES


def test_the_criteria_of_a_target_say_what_their_numbers_say_and_come_from_a_round_of_the_page():
    rounds = {r["id"]: r for r in DATA["rounds"]}
    for target in DATA["targets"]:
        for c in target.get("criteria", []):
            # the criteria of the Scout bench come from the bench, not from a round
            if "round" in c:
                assert c["round"] in rounds, (target["id"], c)
            if c["k"] == "relevantOf":
                # the numbers are the ones of the round, and the mark follows them
                assert (c["v"], c["of"]) == (rounds[c["round"]]["relevant"], rounds[c["round"]]["found"]), (target["id"], c)
                assert c["ok"] == (c["v"] * 100 >= c["min"] * c["of"]), (target["id"], c)
            if c["k"] == "underCeiling":
                assert c["ok"] == (c["v"] <= c["max"]), (target["id"], c)


def test_the_sentence_on_the_pace_is_drawn_above_the_table_and_on_the_page_of_every_round():
    # the rounds are short and do not say how long a budget lasts: the page says it where the rounds are read
    assert "{t.paceNote}" in (HERE / "page.tsx").read_text(encoding="utf-8")
    assert "{t.paceNote}" in (HERE / "[round]" / "page.tsx").read_text(encoding="utf-8")
