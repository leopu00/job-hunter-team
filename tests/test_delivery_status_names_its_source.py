"""A `message_not_delivered` line of runtime.log says which function of the product asked for it (`from`), so that a line that comes alone,
before the team has started, can be traced: the code and the fixed sentence alone say nothing of who tried to reach whom."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import delivery_status  # noqa: E402


def _rows(home: Path) -> list[dict]:
    return [json.loads(line) for line in (home / "logs" / "runtime.log").read_text().splitlines()]


def a_sender_that_finds_no_session():
    return False


def ask_for_a_delivery(home: Path) -> bool:
    return delivery_status.checked(a_sender_that_finds_no_session, home=home)


def test_a_line_from_checked_names_the_function_that_asked(tmp_path, capsys):
    assert ask_for_a_delivery(tmp_path) is False
    (row,) = _rows(tmp_path)
    assert row["code"] == "message_not_delivered"
    assert row["from"] == "test_delivery_status_names_its_source.ask_for_a_delivery"
    capsys.readouterr()


def test_a_direct_report_names_its_caller_and_keeps_the_rc(tmp_path, capsys):
    def stepcap_like():
        delivery_status.report("message_not_delivered", home=tmp_path, rc=2)

    stepcap_like()
    (row,) = _rows(tmp_path)
    assert row["rc"] == 2 and row["from"].endswith(".stepcap_like")
    assert set(row) == {"at", "code", "message", "rc", "from"}, "nothing else is added: no recipient text, no message"
    capsys.readouterr()
