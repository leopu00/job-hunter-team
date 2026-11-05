"""The Assistente welcomes the user in the chat of the app, and only then marks it done.

In a first run from the app, with no Telegram the kickoff said "skipped" and the agent
still created `welcomed.flag`, so the greeting never reached the chat the app
reads and nothing asked again; with Telegram, the container boot sent it there
and wrote the flag before the agent started. `assistant_welcome.py deliver` is
now the only thing that writes the flag, after the line is in
`agents/assistente/chat.jsonl` and has been read back.

`jht-send` is the real one (a temporary JHT_HOME); the Telegram sender is a
script of the test that records its arguments.
"""

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "shared" / "skills" / "assistant_welcome.py"
START_AGENT = ROOT / ".launcher" / "start-agent.sh"
WELCOME_SEND = ROOT / ".launcher" / "welcome-send.sh"
LANGS = ("en", "it", "hu", "es", "de", "fr", "pt")
COMMAND = "python3 /app/shared/skills/assistant_welcome.py deliver"

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the launcher and the container are Linux")


def _catalog(lang: str) -> dict:
    return json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))


EN = _catalog("en")


class Home:
    def __init__(self, path: Path):
        self.path = path
        self.chat = path / "agents" / "assistente" / "chat.jsonl"
        self.flag = path / "profile" / "welcomed.flag"
        self.ready = path / "profile" / "ready.flag"
        self.telegram_log = path / "telegram.calls"
        self.error_log = path / "agents" / "assistente" / "welcome-error.log"
        self.env_extra: dict[str, str] = {}

    def telegram(self, body: str = "exit 0", bot: bool = True) -> None:
        tool = self.path / "fake-telegram"
        tool.write_text(
            f'#!/bin/sh\nprintf "%s\\n" "$1 $2" >> "{self.telegram_log}"\nprintf "%s" "$3" > "{self.path}/telegram.text"\n{body}\n',
            encoding="utf-8",
        )
        tool.chmod(0o755)
        self.env_extra["JHT_WELCOME_TELEGRAM"] = str(tool)
        if bot:
            config = {"channels": {"telegram": {"bots": {"assistente": {"bot_token": "123:abc"}}}}}
            (self.path / "jht.config.json").write_text(json.dumps(config), encoding="utf-8")

    def sender(self, body: str) -> None:
        tool = self.path / "fake-send"
        tool.write_text(f"#!/usr/bin/env python3\nimport sys\n{body}\n", encoding="utf-8")
        tool.chmod(0o755)
        self.env_extra["JHT_WELCOME_SEND"] = str(tool)

    def env(self) -> dict:
        env = {k: v for k, v in os.environ.items() if not k.startswith(("JHT_", "FLEET"))}
        env.update(JHT_HOME=str(self.path), **self.env_extra)
        return env

    def deliver(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, "-I", str(SCRIPT), *(args or ("deliver",))],
            env=self.env(), capture_output=True, text=True, timeout=60,
        )

    def lines(self) -> list[dict]:
        if not self.chat.exists():
            return []
        return [json.loads(line) for line in self.chat.read_text(encoding="utf-8").splitlines() if line.strip()]

    def telegram_calls(self) -> list[str]:
        return self.telegram_log.read_text(encoding="utf-8").splitlines() if self.telegram_log.exists() else []


@pytest.fixture
def home(tmp_path) -> Home:
    return Home(tmp_path)


def test_with_no_telegram_the_welcome_is_in_the_chat_and_the_flag_is_written(home):
    done = home.deliver()
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == "WELCOME_DELIVERED chat=posted telegram=skipped flag=ok"
    [line] = home.lines()
    assert line["role"] == "assistant" and line["done"] is True
    assert line["text"].startswith(EN["welcome.assistente"])
    assert home.flag.exists()


def test_the_first_question_is_in_the_same_message_while_the_profile_is_not_ready(home):
    home.deliver()
    [line] = home.lines()
    assert line["text"] == EN["welcome.assistente"] + "\n\n" + EN["welcome.assistente_first"]
    assert "Telegram" not in line["text"]


def test_a_ready_profile_gets_the_welcome_without_the_question_and_without_the_request_for_the_cv(home):
    home.ready.parent.mkdir(parents=True)
    home.ready.write_text("2031-01-01T10:00:00Z\n", encoding="utf-8")
    home.deliver()
    [line] = home.lines()
    opening = "\n\n".join(EN["welcome.assistente"].split("\n\n")[:2])
    assert line["text"] == opening + "\n\n" + EN["welcome.assistente_ready"]
    # nothing is left to send: no CV, no upload command, no folder, no question
    for asked in ("CV", "jht artifact upload", "allegati", EN["welcome.assistente_first"]):
        assert asked not in line["text"], asked


def test_the_flag_is_written_after_the_line_is_in_the_chat_never_before(home):
    home.sender(
        f"import json, pathlib\n"
        f"flag = pathlib.Path({str(home.flag)!r})\n"
        f"chat = pathlib.Path({str(home.chat)!r}); chat.parent.mkdir(parents=True, exist_ok=True)\n"
        f"seen = flag.exists()\n"
        f"chat.write_text(json.dumps({{'role': 'assistant', 'text': sys.argv[-1], 'done': True}}) + '\\n', encoding='utf-8')\n"
        f"pathlib.Path({str(home.path / 'flag-seen-before')!r}).write_text(str(seen))\n"
    )
    assert home.deliver().returncode == 0
    assert (home.path / "flag-seen-before").read_text() == "False"
    assert home.flag.exists()


def test_a_chat_that_refuses_the_line_leaves_no_flag_and_says_so(home):
    home.sender("sys.exit(7)")
    done = home.deliver()
    assert done.returncode == 3
    assert done.stdout.startswith("WELCOME_NOT_DELIVERED chat_send_failed")
    assert not home.flag.exists()
    assert "chat_send_failed" in home.error_log.read_text(encoding="utf-8")


def test_a_send_that_says_ok_but_wrote_nothing_is_not_a_delivery(home):
    home.sender("sys.exit(0)")
    done = home.deliver()
    assert done.returncode == 3 and "chat_line_not_found_after_send" in done.stdout
    assert not home.flag.exists()


def test_a_stale_flag_does_not_stop_the_welcome(home):
    home.flag.parent.mkdir(parents=True)
    home.flag.write_text("", encoding="utf-8")
    old = time.time() - 40 * 86400
    os.utime(home.flag, (old, old))
    done = home.deliver()
    assert done.stdout.startswith("WELCOME_DELIVERED chat=posted")
    assert len(home.lines()) == 1
    assert home.flag.stat().st_mtime > old + 86400


def test_telegram_gets_the_same_text_in_addition_when_a_bot_is_configured(home):
    home.telegram()
    done = home.deliver()
    assert done.stdout.strip() == "WELCOME_DELIVERED chat=posted telegram=sent flag=ok"
    assert home.telegram_calls() == ["--from assistente"]
    assert (home.path / "telegram.text").read_text(encoding="utf-8") == home.lines()[0]["text"]
    assert len(home.lines()) == 1


def test_no_bot_configured_means_telegram_is_never_called(home):
    home.telegram(bot=False)
    done = home.deliver()
    assert "telegram=skipped" in done.stdout
    assert home.telegram_calls() == []


def test_a_bot_with_an_empty_token_is_not_a_bot(home):
    home.telegram(bot=False)
    config = {"channels": {"telegram": {"bots": {"assistente": {"bot_token": "  "}}}}}
    (home.path / "jht.config.json").write_text(json.dumps(config), encoding="utf-8")
    assert "telegram=skipped" in home.deliver().stdout
    assert home.telegram_calls() == []


def test_telegram_failing_does_not_take_the_app_welcome_or_the_flag_away(home):
    home.telegram("exit 1")
    done = home.deliver()
    assert done.returncode == 0
    assert done.stdout.strip() == "WELCOME_DELIVERED chat=posted telegram=failed flag=ok"
    assert len(home.lines()) == 1 and home.flag.exists()
    assert "telegram send failed" in home.error_log.read_text(encoding="utf-8")


def test_running_it_again_does_not_send_the_welcome_twice_anywhere(home):
    home.telegram()
    home.deliver()
    old = time.time() - 3600
    os.utime(home.flag, (old, old))
    again = home.deliver()
    assert again.stdout.strip() == "WELCOME_DELIVERED chat=already telegram=replay flag=ok"
    assert len(home.lines()) == 1
    assert len(home.telegram_calls()) == 1
    assert home.flag.stat().st_mtime > old + 1800


def test_a_welcome_posted_without_the_question_is_still_recognised_after_the_profile_is_ready(home):
    home.deliver()
    home.ready.parent.mkdir(parents=True, exist_ok=True)
    home.ready.write_text("x\n", encoding="utf-8")
    assert "chat=already" in home.deliver().stdout
    assert len(home.lines()) == 1


def test_the_container_boot_and_the_agent_asking_together_make_one_message(home):
    home.sender(
        "import json, pathlib, time\n"
        f"chat = pathlib.Path({str(home.chat)!r}); chat.parent.mkdir(parents=True, exist_ok=True)\n"
        "time.sleep(0.4)\n"
        "with chat.open('a', encoding='utf-8') as f:\n"
        "    f.write(json.dumps({'role': 'assistant', 'text': sys.argv[-1], 'done': True}) + '\\n')\n"
    )
    cmd = [sys.executable, "-I", str(SCRIPT), "deliver"]
    procs = [subprocess.Popen(cmd, env=home.env(), stdout=subprocess.PIPE, text=True) for _ in range(2)]
    outs = [p.communicate(timeout=60)[0] for p in procs]
    assert all(p.returncode == 0 for p in procs)
    assert sorted(re.search(r"chat=(\w+)", o).group(1) for o in outs) == ["already", "posted"]
    assert len(home.lines()) == 1


def test_a_chat_line_that_is_not_json_does_not_hide_the_welcome(home):
    home.chat.parent.mkdir(parents=True)
    home.chat.write_text("not json\n", encoding="utf-8")
    assert "chat=posted" in home.deliver().stdout
    assert len(home.chat.read_text(encoding="utf-8").splitlines()) == 2


def test_only_the_assistants_own_line_counts_as_already_welcomed(home):
    home.chat.parent.mkdir(parents=True)
    home.chat.write_text(json.dumps({"role": "user", "text": EN["welcome.assistente"]}) + "\n", encoding="utf-8")
    assert "chat=posted" in home.deliver().stdout


@pytest.mark.parametrize("args", [(), ("deliver", "now"), ("send",)])
def test_a_wrong_call_changes_nothing(home, args):
    done = home.deliver(*(args or ("",)))
    assert done.returncode == 2
    assert home.lines() == [] and not home.flag.exists()


# --- the words ------------------------------------------------------------------------------------


@pytest.mark.parametrize("lang", LANGS)
def test_the_welcome_names_the_upload_command_that_works_on_every_host_before_the_folder(lang):
    """P2-3 of the Linux CLI gate (02/11): on Linux the folder named by the welcome is the container's (1001:1001, 700)
    and the person cannot write in it; `jht artifact upload <file>` works there and on the Mac."""
    text = _catalog(lang)["welcome.assistente"]
    assert "jht artifact upload" in text
    assert text.index("jht artifact upload") < text.index("Job Hunter Team/allegati")


@pytest.mark.parametrize("lang", LANGS)
def test_the_catalog_welcome_does_not_send_the_user_to_telegram_and_asks_the_name(lang):
    catalog = _catalog(lang)
    assert "Telegram" not in catalog["welcome.assistente"]
    # the chat of the app takes text, not files: the welcome must not promise a format it cannot receive
    for promised in ("PDF", "DOC", "photo", "foto", "fénykép", "Foto"):
        assert promised not in catalog["welcome.assistente"], promised
    # the one other way in is the drop-zone the Assistente reads (skill onboarding-flow): named by its real folder
    assert "Job Hunter Team/allegati" in catalog["welcome.assistente"]
    assert catalog["welcome.assistente_first"].strip().endswith("?")
    assert "\n" not in catalog["welcome.assistente_first"]


# --- the places that call it ----------------------------------------------------------------------


def _kickoff(tmp_path: Path, role: str) -> str:
    source = START_AGENT.read_text(encoding="utf-8")
    start = source.index("_welcome_kickoff() {")
    function = source[start: source.index('\nif [ "$ROLE" = "assistente" ]', start)]
    out = tmp_path / "kickoff.txt"
    script = "\n".join(
        [
            "jht_daemon_log() { echo /dev/null; }",
            f'_kickoff() {{ printf "%s" "$2" > "{out}"; }}',
            "setsid() { :; }",
            "SESSION=S",
            function,
            f'_welcome_kickoff {role} {"welcomed.flag" if role == "assistente" else role + "-welcomed.flag"} "BODY-OF-THE-WELCOME"',
        ]
    )
    shell = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30,
                           env={**os.environ, "JHT_HOME": "/jht_home"})
    assert shell.returncode == 0, shell.stderr
    return out.read_text(encoding="utf-8")


def test_the_assistentes_kickoff_runs_the_command_and_never_makes_the_flag_by_hand(tmp_path):
    text = _kickoff(tmp_path, "assistente")
    assert text.startswith("[@system -> @assistente] [WELCOME-USER]")
    assert COMMAND in text
    assert "WELCOME_DELIVERED" in text and "WELCOME_NOT_DELIVERED" in text
    assert "ONLY THEN writes /jht_home/profile/welcomed.flag" in text
    assert "Never touch /jht_home/profile/welcomed.flag by hand" in text
    assert "jht-telegram-send" not in text and "skipped + flag created" not in text
    assert "&& touch" not in text and "Run touch" not in text
    assert "/jht_home/profile/ready.flag" in text and "onboarding-flow" in text
    assert "do not ask it again" in text


def test_the_captains_and_the_mentors_kickoff_are_left_as_they_were(tmp_path):
    for role in ("capitano", "mentor"):
        text = _kickoff(tmp_path, role)
        assert COMMAND not in text
        assert "BODY-OF-THE-WELCOME" in text
        assert f"touch /jht_home/profile/{role}-welcomed.flag" in text


def test_the_container_boot_welcomes_the_assistente_through_the_same_command():
    text = WELCOME_SEND.read_text(encoding="utf-8")
    assert COMMAND in text
    assert "send_one assistente" not in text
    assert "send_one capitano" in text and "send_one mentor" in text


@pytest.mark.parametrize("suffix", ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"])
def test_all_seven_prompts_say_the_same_protocol(suffix):
    text = (ROOT / "agents" / "assistente" / f"assistente{suffix}.md").read_text(encoding="utf-8")
    start = text.index("## 🚀 Welcome protocol")
    section = text[start: text.index("\n---\n", start)]
    assert COMMAND in section
    for token in ("WELCOME_DELIVERED", "WELCOME_NOT_DELIVERED", "welcomed.flag", "ready.flag", "onboarding-flow",
                  "profile_flag", "welcome-error.log", "[WELCOME-ACK]"):
        assert token in section, token
    # the drop-zone the welcome points to is one the prompt tells it to read
    assert "$JHT_USER_DIR/allegati/" in section and "Job Hunter Team/allegati" in section
    # the old way: Telegram alone, and the flag made by hand
    assert "mkdir -p $JHT_HOME/profile && touch" not in section
    assert "test -f $JHT_HOME/profile/welcomed.flag" not in section
    assert "sent + flag created" not in section


# --- the welcome that is already there, whatever its text (JHT-T179) -------------------------------

# The welcome of an earlier run: the catalog's text of that time (588 characters, the folder and no upload
# command) and the first question, as `jht-send` posted it. Today's catalog says something else after the second paragraph, so
# comparing the chat with today's whole text did not see it, and every start of the team posted the welcome again.
OLD_EN_WELCOME = (
    "Hi! \U0001F44B\n\nI'm the Job Hunter Team Assistant \u2014 your point of contact with the AI team that's about to start looking for jobs for you.\n\n"
    "To get going I need to know you. Paste the text of your CV here, or just tell me in a couple of lines who you are and what you're looking for "
    "\u2014 role, sector, city. If you'd rather give me the file, put it in the Documents/Job Hunter Team/allegati folder and tell me here. From that I build "
    "the profile and the rest of the team gets to work for you.\n\nA draft or rough notes are perfectly fine, no need to have anything polished. \U0001F4C4 "
    "I start from what you have."
)


def _chat_after_a_restart(home: Home, welcome: str) -> None:
    """The welcome of an earlier run, an exchange, and the profile ready since: the chat a team finds when it starts again."""
    home.chat.parent.mkdir(parents=True)
    rows = [
        {"role": "assistant", "text": welcome + "\n\n" + EN["welcome.assistente_first"], "done": True},
        {"role": "user", "text": "Mi chiamo Prova, cerco lavoro come analista dati a Milano.", "done": True},
        {"role": "assistant", "text": "Thanks! How many years of experience do you have?", "done": True},
        {"role": "assistant", "text": "I've read your CV and your profile is ready.", "done": True},
    ]
    home.chat.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    home.ready.parent.mkdir(parents=True, exist_ok=True)
    home.ready.write_text("2031-01-01T10:00:00Z\n", encoding="utf-8")


def test_the_welcome_of_an_older_text_is_still_the_welcome_and_the_team_restarting_posts_no_new_one(home):
    assert OLD_EN_WELCOME != EN["welcome.assistente"] and not EN["welcome.assistente"].startswith(OLD_EN_WELCOME)
    _chat_after_a_restart(home, OLD_EN_WELCOME)
    before = home.chat.read_text(encoding="utf-8")
    done = home.deliver()
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == "WELCOME_DELIVERED chat=already telegram=replay flag=ok"
    assert home.chat.read_text(encoding="utf-8") == before, "not a line more in the chat"
    assert home.flag.exists()


def test_a_start_after_another_start_still_posts_nothing(home):
    _chat_after_a_restart(home, OLD_EN_WELCOME)
    for _ in range(3):
        assert "chat=already" in home.deliver().stdout
    assert len(home.lines()) == 4


@pytest.mark.parametrize("lang", LANGS)
def test_a_welcome_posted_in_any_language_is_the_welcome_whatever_language_the_catalog_speaks_now(home, lang):
    # the chat holds the welcome in `lang`; the catalog in use is English
    _chat_after_a_restart(home, _catalog(lang)["welcome.assistente"])
    assert "chat=already" in home.deliver().stdout
    assert len(home.lines()) == 4


@pytest.mark.parametrize("lang", LANGS)
def test_the_welcome_is_still_the_welcome_with_the_first_question_or_the_ready_line_after_it(home, lang):
    catalog = _catalog(lang)
    for tail in (catalog["welcome.assistente_first"], catalog["welcome.assistente_ready"]):
        home.chat.parent.mkdir(parents=True, exist_ok=True)
        home.chat.write_text(json.dumps({"role": "assistant", "text": catalog["welcome.assistente"] + "\n\n" + tail}) + "\n", encoding="utf-8")
        assert "chat=already" in home.deliver().stdout


def test_a_line_that_only_starts_like_a_greeting_is_not_the_welcome(home):
    home.chat.parent.mkdir(parents=True)
    rows = [
        {"role": "assistant", "text": "Hi! \U0001F44B How can I help?"},
        {"role": "assistant", "text": "Ciao! \U0001F44B Ho trovato 3 posizioni nuove per te."},
        {"role": "user", "text": OLD_EN_WELCOME},
    ]
    home.chat.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
    assert "chat=posted" in home.deliver().stdout


def test_a_ready_profile_with_no_welcome_in_the_chat_is_welcomed_once_without_the_cv_and_never_again(home):
    home.ready.parent.mkdir(parents=True)
    home.ready.write_text("2031-01-01T10:00:00Z\n", encoding="utf-8")
    assert "chat=posted" in home.deliver().stdout
    assert "chat=already" in home.deliver().stdout
    [line] = home.lines()
    assert "CV" not in line["text"]


@pytest.mark.parametrize("lang", LANGS)
def test_the_ready_welcome_has_the_same_opening_in_every_language_and_asks_for_nothing(lang):
    catalog = _catalog(lang)
    ready = catalog["welcome.assistente_ready"]
    assert ready.strip() and "\n" not in ready
    # nothing it asks for: no upload command, no folder, no question mark
    assert "jht artifact upload" not in ready and "allegati" not in ready and "?" not in ready
    # the opening (greeting and who it is) is the one every welcome since the first has: that is how a welcome is known
    greeting = catalog["welcome.assistente"].split("\n", 1)[0]
    assert greeting.endswith("\U0001F44B") and "Job Hunter Team" in "\n\n".join(catalog["welcome.assistente"].split("\n\n")[:2])
