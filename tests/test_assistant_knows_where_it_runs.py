"""JHT-T354: the Assistente says the true state of the team and knows where it runs, in the seven languages.

Without this the Assistente could say the team was active while the budget brake had paused it (the tmux sessions stay open in
a pause), give the Windows and Finder paths on a Linux server, and ask for the paperclip of an app the terminal does not have.

The prompt now has one source for the state (`jht team status --json`, with the pause), only `$JHT_HOME/...` paths, a section
on where it runs (kind of host, system, channel) with the ways that work from a terminal on a VPS, and the onboarding skill and
the end of the setup no longer send the person to an app.

Run:
    pytest tests/test_assistant_knows_where_it_runs.py -v
"""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
LANGS = ("en", "it", "de", "es", "fr", "pt", "hu")
WHERE_HEADING = {"en": "Where you run", "it": "Dove giri", "de": "Wo du läufst", "es": "Dónde funcionas",
                 "fr": "Où tu tournes", "pt": "Onde corres", "hu": "Hol futsz"}


def _prompt(lang):
    name = "assistente.md" if lang == "en" else f"assistente.{lang}.md"
    return (ROOT / "agents" / "assistente" / name).read_text(encoding="utf-8")


def _skill(lang):
    name = "SKILL.md" if lang == "en" else f"SKILL.{lang}.md"
    return (ROOT / "agents" / "_skills" / "onboarding-flow" / name).read_text(encoding="utf-8")


def _section(text, heading):
    start = text.index(heading)
    return text[start:text.index("\n## ", start)]


@pytest.mark.parametrize("lang", LANGS)
def test_the_state_of_the_team_has_one_source_with_the_pause_never_the_tmux_sessions(lang):
    text = _prompt(lang)
    a04 = next(p for p in text.split("\n\n") if p.startswith("**A-04**"))
    assert "`jht team status --json`" in a04
    for field in ("`pause`", "`spent`", "`ceiling`", "`why`", "`spend_now`", "`spentUsd`"):
        assert field in a04, field
    # a team paused on the budget is said paused, with the dollars: never «active»
    assert "`spent` $" in a04 and "`ceiling` $" in a04
    # the sessions are named only as what does NOT tell the state, after the one source
    assert a04.index("`jht team status --json`") < a04.index("`tmux list-sessions`")
    assert not re.search(r"`tmux list-sessions` (for live agents|per agenti vivi)", text)
    # the row of the skill index points to the same source
    assert re.search(r"^\|[^\n]*\| `jht team status --json` \(A-04\)", text, re.M)


@pytest.mark.parametrize("lang", LANGS)
def test_the_paths_are_only_jht_home_ones_never_the_home_of_the_host(lang):
    text = _prompt(lang)
    for var in ("$JHT_HOME", "$JHT_DB", "$JHT_AGENT_DIR"):
        row = next(line for line in text.splitlines() if line.startswith(f"| `{var}` |"))
        assert "`~/.jht" not in row.split("|")[3].split("(")[0], row
    assert "`$JHT_HOME/agents/assistente`" in text and "`$JHT_HOME/jobs.db`" in text
    # the canonical sources are written from $JHT_HOME too
    assert "`$JHT_HOME/logs/sentinel-bridge-state.json`" in text
    assert "/jht_home/jobs.db" not in text


@pytest.mark.parametrize("lang", LANGS)
def test_the_assistente_reads_where_it_runs_and_gives_only_the_ways_of_that_place(lang):
    text = _prompt(lang)
    where = _section(text, f"## 🧭 {WHERE_HEADING[lang]}")
    for token in ("`jht team status --json`", "`where.host_type`", "`where.host_os`", "`vps`", "`null`",
                  "`$JHT_HOME`", "`$JHT_USER_DIR`", "`[CHAT]`", "`[TG]`"):
        assert token in where, token
    # scenario CLI + VPS: the file in the home of the server goes into the mounted folder, or through the upload
    assert "`mv ~/<" in where and "~/Documents/Job\\ Hunter\\ Team/<where.folders.allegati.name>/`" in where
    assert "`jht artifact upload ~/<" in where
    # from the terminal: no paperclip, no dragging, nowhere «on the left»
    assert "📎" in where
    # the folder of the person is named only with the path of the person's own system
    docs = next(line for line in text.splitlines() if line.startswith("> 📁 "))
    assert "where.folders" in docs


@pytest.mark.parametrize("lang", LANGS)
def test_the_channels_are_the_terminal_and_telegram_the_app_only_where_there_is_one(lang):
    text = _prompt(lang)
    identity = text[text.index("## 🆔"):text.index("\n---", text.index("## 🆔"))]
    assert "`jht team chat assistente`" in identity
    assert not re.search(r"^- \*\*Web UI\*\*", identity, re.M), "the app is no channel of its own any more"
    assert "/onboarding" not in identity


@pytest.mark.parametrize("lang", LANGS)
def test_the_onboarding_never_asks_for_the_paperclip_of_an_app_that_is_not_there(lang):
    text = _skill(lang)
    first = next(line for line in text.splitlines() if line.startswith("> ") and "allegati" in line)
    assert "📎" not in first
    assert "`<where.folders.allegati.path>`" in first, "the real folder, from team status (JHT-T360)"
    intro = next(line for line in text.splitlines() if "`/onboarding`" in line and "candidate_profile.yml" in line)
    assert intro.index("`jht team chat assistente`") < intro.index("`/onboarding`")
    assert "`jht artifact upload <" in intro


@pytest.mark.parametrize("lang", LANGS)
def test_the_end_of_the_setup_does_not_send_the_person_to_an_app(lang):
    catalog = json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))
    for key in ("wizard.outro_done", "wizard.outro_no_credit"):
        line = next(l for l in catalog[key].split("\n") if "jht team chat assistente" in l)
        assert "(" not in line, (key, line)
    texts = (ROOT / "cli" / "src" / "lib" / "texts" / f"{lang}.js").read_text(encoding="utf-8")
    waits = next(l for l in texts.splitlines() if "team.captain_waits" in l)
    assert "jht team chat assistente" in waits and "(" not in waits.split("jht team chat assistente")[1]
