"""The Assistant's prompt asks for one mood tag at the start of each message in the app's chat, and the tags it
names are the ones the app turns into the avatar's expression (desktop/src/lib/assistant-emotion.ts)."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROMPTS = sorted((ROOT / "agents" / "assistente").glob("assistente*.md"))
APP_TAGS = set(
    re.findall(r'"([a-z]+)"', re.search(r"EMOTIONS = \[(.*?)\]", (ROOT / "desktop/src/lib/assistant-emotion.ts").read_text(encoding="utf-8"), re.S).group(1))
)
# The Assistant has a portrait for these five; «severo» is the game's and has none here.
ASKED = {"neutro", "caldo", "divertito", "pensieroso", "sorpreso"}


def _tag_line(path: Path) -> str:
    lines = [line for line in path.read_text(encoding="utf-8").splitlines() if "[neutro]" in line]
    assert len(lines) == 1, f"{path.name}: the line with the tags must be exactly one, found {len(lines)}"
    return lines[0]


def test_every_language_of_the_prompt_names_the_same_five_tags_once():
    assert len(PROMPTS) == 7
    for path in PROMPTS:
        line = _tag_line(path)
        assert set(re.findall(r"`\[([a-z]+)\]`", line)) == ASKED, path.name
        assert "[severo]" not in line, path.name


def test_the_tags_the_prompt_asks_for_are_ones_the_app_turns_into_an_expression():
    assert ASKED <= APP_TAGS
