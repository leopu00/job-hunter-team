"""The box tells the user, once per token, that the website refuses its sync token.

An expired or revoked token makes every push answer 401 and the website cannot say so, because it is
the box that no longer reaches it (16 days unseen on 23/10). shared/skills/cloud_sync_notice.py
writes a closed code with a fixed sentence in the user's language through jht-notify-user, keyed by
the token's public prefix. Synthetic tokens only.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "shared" / "skills"))

import cloud_sync_notice as csn  # noqa: E402


class Done:
    def __init__(self, code=0, out="notified 12\n", err=""):
        self.returncode, self.stdout, self.stderr = code, out, err


def test_the_sentence_is_in_every_language_and_says_what_to_do():
    locales = REPO / "shared" / "locales"
    english = json.loads((locales / "en.json").read_text(encoding="utf-8"))["cloud_sync_notice.token_rejected"]
    for lang in csn.LANGUAGES:
        own = json.loads((locales / f"{lang}.json").read_text(encoding="utf-8"))
        text = own.get("cloud_sync_notice.token_rejected")
        assert isinstance(text, str) and text.strip(), lang
        assert lang == "en" or text != english, lang
        # no slot to fill, and the way back is named in every language
        assert "{" not in text and "jht cloud enable --token" in text, lang
        assert csn.text_for("token_rejected", lang) == text


@pytest.mark.parametrize("code,key,reason", [
    ("anything_else", "jht_sync_AbCd", "code_unknown"),
    ("token_rejected", "jht_sync_AbCdEf", "key_invalid"),
    ("token_rejected", "jht_sync_Ab", "key_invalid"),
    ("token_rejected", "jht_sync_AbCdsynthetic-whole-token", "key_invalid"),
    ("token_rejected", "jht_sync_A;cd", "key_invalid"),
    ("token_rejected", "", "key_invalid"),
])
def test_what_is_not_a_notice_is_refused_before_anything_runs(code, key, reason):
    ran = []
    assert csn.notify(code, key, lang="en", run=lambda *a, **k: ran.append(a)) == {"notified": False, "reason": reason}
    assert ran == []


def test_one_row_per_token_through_the_notify_tool(monkeypatch, tmp_path):
    tool = tmp_path / "jht-notify-user"
    tool.write_text("#!/bin/sh\n")
    monkeypatch.setattr(csn._shared, "notify_tool", lambda: tool)
    calls = []

    def run(cmd, **kwargs):
        calls.append(cmd)
        return Done()

    assert csn.notify("token_rejected", "jht_sync_AbCd", lang="it", run=run) == {
        "notified": True, "code": "token_rejected", "row_id": 12,
    }
    cmd = calls[0]
    assert cmd[1] == str(tool)
    assert cmd[cmd.index("--agent") + 1] == "assistente"
    assert cmd[cmd.index("--kind") + 1] == "alert"
    # the key of the row is the token's public prefix: the same token is one row, a new one another
    assert cmd[cmd.index("--source-id") + 1] == "cloud-sync:token_rejected:jht_sync_AbCd"
    assert cmd[cmd.index("--source-action") + 1] == "cloud_sync_notice"
    assert json.loads(cmd[cmd.index("--source-payload") + 1]) == {"code": "token_rejected"}
    assert cmd[-1] == csn.text_for("token_rejected", "it")
    # the whole token never goes in the command
    assert not any("synthetic" in part for part in cmd)


def test_a_notice_that_cannot_go_out_says_why_and_never_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(csn._shared, "notify_tool", lambda: None)
    assert csn.notify("token_rejected", "jht_sync_AbCd", lang="en") == {"notified": False, "reason": "notify_tool_missing"}
    tool = tmp_path / "jht-notify-user"
    tool.write_text("#!/bin/sh\n")
    monkeypatch.setattr(csn._shared, "notify_tool", lambda: tool)
    out = csn.notify("token_rejected", "jht_sync_AbCd", lang="en", run=lambda *a, **k: Done(code=1, out="", err="db locked"))
    assert out == {"notified": False, "reason": "notify_failed", "detail": "db locked"}

    def boom(*a, **k):
        raise OSError("no python")

    assert csn.notify("token_rejected", "jht_sync_AbCd", lang="en", run=boom)["reason"] == "notify_failed"


# ── the real path: jht-notify-user and the box's database ─────────────────────
def _box(tmp_path: Path) -> Path:
    import sqlite3

    import _db  # noqa: E402

    home = tmp_path / "home"
    home.mkdir()
    conn = sqlite3.connect(home / "jobs.db")
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.commit()
    conn.close()
    return home


def _cli(home: Path, *args, bin_dir: Path | None = None) -> dict:
    import os
    import subprocess

    env = {k: v for k, v in os.environ.items() if not k.startswith("JHT_")}
    env.update({"JHT_HOME": str(home), "JHT_DB": str(home / "jobs.db"), "PYTHONDONTWRITEBYTECODE": "1"})
    env["PATH"] = (str(bin_dir) + os.pathsep if bin_dir else "") + "/usr/bin:/bin"
    r = subprocess.run([sys.executable, str(REPO / "shared" / "skills" / "cloud_sync_notice.py"), *args],
                       capture_output=True, text=True, env=env, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


def _rows(home: Path) -> list[dict]:
    import sqlite3

    conn = sqlite3.connect(home / "jobs.db")
    conn.row_factory = sqlite3.Row
    rows = [dict(r) for r in conn.execute(
        "SELECT agent, kind, body, source_id, source_action, delivered_via FROM pending_user_messages ORDER BY id")]
    conn.close()
    return rows


def test_one_token_is_one_row_in_the_users_language(tmp_path):
    home = _box(tmp_path)
    (home / "i18n-prefs.json").write_text(json.dumps({"locale": "it"}))
    first = _cli(home, "token_rejected", "jht_sync_AbCd")
    again = _cli(home, "token_rejected", "jht_sync_AbCd")
    assert first["notified"] and again["notified"] and first["row_id"] == again["row_id"]
    rows = _rows(home)
    assert len(rows) == 1
    assert rows[0]["source_action"] == "cloud_sync_notice" and rows[0]["kind"] == "alert"
    assert rows[0]["body"] == csn.text_for("token_rejected", "it")
    # a new token refused in its turn is a new notice
    _cli(home, "token_rejected", "jht_sync_WxYz")
    assert len(_rows(home)) == 2


def test_off_hours_it_still_goes_to_telegram(tmp_path):
    # the website is exactly what does not sync: a row held for it would never be seen
    home = _box(tmp_path)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    sent = tmp_path / "sent.txt"
    fake = bin_dir / "jht-telegram-send"
    fake.write_text(f"#!/bin/sh\nprintf '%s\\n' \"$@\" >> {sent}\nexit 0\n")
    fake.chmod(0o755)
    (home / "jht.config.json").write_text(json.dumps({"team": {"working_hours": {"windows": [{"start": "00:00", "end": "00:01", "days": []}]}}}))
    assert _cli(home, "token_rejected", "jht_sync_AbCd", bin_dir=bin_dir)["notified"]
    assert sent.exists()
    assert _rows(home)[0]["delivered_via"] == "telegram"


def test_a_lost_session_has_its_sentence_in_every_language_and_says_what_to_do():
    locales = REPO / "shared" / "locales"
    english = json.loads((locales / "en.json").read_text(encoding="utf-8"))["cloud_sync_notice.session_lost"]
    seen = set()
    for lang in csn.LANGUAGES:
        own = json.loads((locales / f"{lang}.json").read_text(encoding="utf-8"))
        text = own.get("cloud_sync_notice.session_lost")
        assert isinstance(text, str) and text.strip(), lang
        assert lang == "en" or text != english, lang
        assert "{" not in text, lang
        assert csn.text_for("session_lost", lang) == text
        seen.add(text)
    assert len(seen) == len(csn.LANGUAGES)


def test_a_lost_session_goes_through_the_notify_tool_keyed_by_the_sync_token(monkeypatch, tmp_path):
    tool = tmp_path / "jht-notify-user"
    tool.write_text("#!/bin/sh\n")
    monkeypatch.setattr(csn._shared, "notify_tool", lambda: tool)
    calls = []

    def run(cmd, **kwargs):
        calls.append(cmd)
        return Done()

    assert csn.notify("session_lost", "jht_sync_AbCd", lang="it", run=run) == {
        "notified": True, "code": "session_lost", "row_id": 12,
    }
    cmd = calls[0]
    # one row per sync token, apart from the row of a refused token
    assert cmd[cmd.index("--source-id") + 1] == "cloud-sync:session_lost:jht_sync_AbCd"
    assert json.loads(cmd[cmd.index("--source-payload") + 1]) == {"code": "session_lost"}
    assert cmd[-1] == csn.text_for("session_lost", "it")
