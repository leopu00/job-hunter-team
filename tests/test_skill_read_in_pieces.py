"""scout-coord and circles-and-sources are read in pieces: the lines to read are named in the skill's own description.

A skill read stays in the Scout's context for the whole session and is read again from the cache on every call. The two
biggest ones now carry the part the Scout needs first at the top and everything else under `## Reference`; the description
(which the Scout sees before it opens the file) and the note under the title both say how many lines to read. The number is
checked here in every language, so an edit that moves the heading cannot leave a wrong `limit`.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parent.parent / "agents" / "_skills"
LANGS = ("", ".it", ".de", ".es", ".fr", ".pt", ".hu")
# what must stay inside the part the Scout reads, in every language: the commands of the protocol
MUST_BE_IN_THE_FIRST_PART = {
    "scout-coord": ("scout_coord.py doctor", "scout_coord.py reset", "scout_coord.py assign", "scout_coord.py show", "jht-tmux-send"),
    "circles-and-sources": ("candidate_profile.yml", "work_mode", "relocation", "senior"),
}
# scout-coord: +100 for Step 1 of the first burst (`scout_coord.py auto`, the plan splits the work, no negotiation)
MAX_FIRST_PART_BYTES = {"scout-coord": 5400, "circles-and-sources": 10700}


def _parts(skill: str, suffix: str):
    text = (SKILLS / skill / ("SKILL%s.md" % suffix)).read_text(encoding="utf-8")
    lines = text.split("\n")
    assert lines.count("## Reference") == 1, "%s%s: exactly one `## Reference` heading" % (skill, suffix)
    at = lines.index("## Reference")                       # 0-based: the heading is line at + 1, the blank before it is line at
    assert lines[at - 1] == "", "a blank line before the heading"
    last = at - 1                                          # the last line of the first part (1-based)
    return text, lines, last


@pytest.mark.parametrize("skill", sorted(MUST_BE_IN_THE_FIRST_PART))
@pytest.mark.parametrize("suffix", LANGS)
def test_the_description_and_the_note_name_the_exact_number_of_lines_to_read(skill, suffix):
    text, lines, last = _parts(skill, suffix)
    description = next(l for l in lines[:12] if l.startswith("description:"))
    assert "(`limit` %d)" % last in description and "1-%d" % last in description, "%s%s: description" % (skill, suffix)
    note = next(l for l in lines[:12] if l.startswith("> "))
    assert note.count("`limit` %d" % last) == 1 and "1-%d" % last in note and "`offset` 1" in note, "%s%s: note" % (skill, suffix)
    assert "`## Reference`" in note


@pytest.mark.parametrize("skill", sorted(MUST_BE_IN_THE_FIRST_PART))
@pytest.mark.parametrize("suffix", LANGS)
def test_the_first_part_keeps_the_commands_and_stays_small(skill, suffix):
    text, lines, last = _parts(skill, suffix)
    first = "\n".join(lines[:last])
    for needle in MUST_BE_IN_THE_FIRST_PART[skill]:
        assert needle in first, "%s%s: %r moved below the line the Scout stops at" % (skill, suffix, needle)
    assert len(first.encode("utf-8")) <= MAX_FIRST_PART_BYTES[skill], "%s%s: the first part grew" % (skill, suffix)


@pytest.mark.parametrize("suffix", LANGS)
def test_nothing_was_lost_by_the_move(suffix):
    """The tool names the Scout is sent to by the prompt and by position-insert are still somewhere in the file."""
    coord = (SKILLS / "scout-coord" / ("SKILL%s.md" % suffix)).read_text(encoding="utf-8")
    circles = (SKILLS / "circles-and-sources" / ("SKILL%s.md" % suffix)).read_text(encoding="utf-8")
    assert re.search(r"Step 5|STEP 5|Schritt 5|Paso 5|Étape 5|Passo 5|Lépés 5|Step 5", coord) or "scout_coord.py show" in coord
    for closed in ("Umantis", "Climatebase", "JobSearch DK", "Jobware", "XING Jobs"):
        assert closed in circles, "%s%s: the list of closed sources" % (closed, suffix)
