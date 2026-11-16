"""An alert for the person (kind=alert) reaches the chat with the Assistente too, not only the web.

The Capitano's notice «no spending ceiling, how to set one» was written to pending_user_messages and delivered on the web
(via=web): whoever follows the team from the terminal never saw it (collaudo Linux, 15/11). The alert now also goes into
the Assistente's chat, the one `jht team chat` reads, as an urgent line; other kinds and the Assistente's own alerts do not.
"""

from __future__ import annotations

import json
import subprocess

from test_agent_questions import NOTIFY, box, sql  # noqa: F401  (box is a fixture)

ALERT = "No spending ceiling is set for this key: set one with jht setup (a budget) or on the site of the provider. $5 is enough to try."


def _notify(box, *argv, text=ALERT):
    return subprocess.run([str(NOTIFY), *argv, "-"], input=text + "\n", capture_output=True, text=True, env=box.env, timeout=30)


def _chat(box):
    path = box.home / "agents" / "assistente" / "chat.jsonl"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def test_an_alert_of_the_capitano_is_in_the_chat_of_the_assistente_once_with_every_dollar(box):
    done = _notify(box, "--agent", "capitano", "--kind", "alert", "--no-telegram", "--source-id", "no-quota-mode-x", "--source-action", "no_quota_mode_notice", "--source-payload", "{}")
    assert done.returncode == 0, done.stderr
    assert sql(box, "SELECT kind, body FROM pending_user_messages") == [("alert", ALERT)]
    [line] = _chat(box)
    assert (line["role"], line["kind"], line["text"], line["done"]) == ("assistant", "urgent", ALERT, True)
    # the same source again is the same row: no second line in the chat
    again = _notify(box, "--agent", "capitano", "--kind", "alert", "--no-telegram", "--source-id", "no-quota-mode-x", "--source-action", "no_quota_mode_notice", "--source-payload", "{}")
    assert again.returncode == 0, again.stderr
    assert len(_chat(box)) == 1


def test_a_notification_or_an_alert_of_the_assistente_itself_is_not_copied(box):
    assert _notify(box, "--agent", "capitano", "--no-telegram", text="ten positions above 75").returncode == 0
    assert _notify(box, "--agent", "assistente", "--kind", "alert", "--no-telegram").returncode == 0
    assert _chat(box) == []
