"""Telegram: only the ☰ command menu, no persistent reply keyboard.

Origin. The operator's JHT ASSISTENTE chat on the phone: the persistent
6-button keyboard (Budget/Pipeline/Mappa/Top CV/Reset/Help) covered half of the
chat, exactly while the CLOSER's questions were arriving. Order: like the
master bot, only the ☰ menu (setMyCommands) for assistente, capitano and mentor.

A reply keyboard stays on the phone until a message removes it, so "stop
sending it" is not enough. This suite reads the REQUEST that would reach
api.telegram.org (a stub curl records every call) and holds:

  1. no call ever carries a keyboard layout (`"keyboard":[[`);
  2. the legacy `--keyboard <role>` still works and sends `remove_keyboard`;
  3. without the flag, each bot/chat sends `remove_keyboard` ONCE, on the first
     successful send, then never again — a failed send does not count;
  4. on a chunked message the markup rides only on the last chunk; photos
     follow the same rule;
  5. auto_report.py no longer passes `--keyboard`;
  6. every button of the old keyboards has a ☰ command, with its description
     in all seven locales.
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SENDER = ROOT / "agents" / "_tools" / "jht-telegram-send"
LOCALES = ("en", "it", "es", "fr", "de", "pt", "hu")
REMOVE = {"remove_keyboard": True}

# The buttons of the three removed keyboards, and the ☰ command that replaces each.
OLD_BUTTONS = {
    "assistente": {
        "📊 Budget": "budget", "📈 Pipeline": "pipeline", "🗺️ Mappa": "mappa",
        "⭐ Top CV": "top_cv", "📅 Reset": "reset", "❓ Help": "help",
    },
    "capitano": {
        "📈 Pipeline": "pipeline", "📊 Budget": "budget", "👥 Team": "team",
        "⭐ Ready": "ready", "🛠 Triage": "triage", "❓ Help": "help",
    },
    "mentor": {
        "📋 Digest": "digest", "🔁 Patterns": "patterns", "⭐ Top": "top",
        "💰 Salary": "salary", "❓ Help": "help",
    },
}


@pytest.fixture()
def box(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    calls = tmp_path / "calls"
    calls.mkdir()
    stub = bin_dir / "curl"
    # One file per call; arguments separated by RS (0x1e) because message
    # text contains newlines. HTTP code and ok flag are driven by env.
    stub.write_text(
        "#!/bin/sh\n"
        f'n=$(ls "{calls}" | wc -l | tr -d " ")\n'
        f'f="{calls}/$n"\n'
        'for a in "$@"; do printf "%s\\036" "$a" >> "$f"; done\n'
        'out=""\n'
        'while [ $# -gt 0 ]; do [ "$1" = "--output" ] && out="$2"; shift; done\n'
        '[ -n "$out" ] && printf \'{"ok":true,"result":{"message_id":1}}\' > "$out"\n'
        'printf "%s" "${FAKE_HTTP:-200}"\n',
        encoding="utf-8",
    )
    stub.chmod(0o755)
    env = {
        "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}",
        "HOME": str(tmp_path),
        "JHT_HOME": str(tmp_path),
        "TELEGRAM_BOT_TOKEN": "1234567890:" + "B" * 35,
        "TELEGRAM_CHAT_ID": "42",
    }
    return {"calls": calls, "env": env, "home": tmp_path}


def _send(box, *args, env=None):
    return subprocess.run(
        [str(SENDER), *args], env={**box["env"], **(env or {})}, capture_output=True, text=True,
    )


def _calls(box) -> list[list[str]]:
    files = sorted(box["calls"].iterdir(), key=lambda p: int(p.name))
    return [p.read_text(encoding="utf-8").split("\x1e")[:-1] for p in files]


def _markup(call: list[str]):
    """The reply_markup of one call, decoded, or None."""
    for arg in call:
        if arg.startswith("reply_markup="):
            return json.loads(arg[len("reply_markup="):])
    return None


def _no_keyboard_layout(box) -> None:
    for call in _calls(box):
        assert not any('"keyboard":[[' in arg or "is_persistent" in arg for arg in call), call


def _mark_already_removed(box, role="assistente", chat="42"):
    state = box["home"] / "state"
    state.mkdir(exist_ok=True)
    (state / f"telegram-keyboard-removed-{role}-{chat}").write_text("")


# ── 1-2. legacy flag ─────────────────────────────────────────────────────────


@pytest.mark.parametrize("role", ["assistente", "capitano", "mentor"])
def test_legacy_keyboard_flag_removes_the_keyboard(box, role):
    _mark_already_removed(box, role)
    done = _send(box, "--from", role, "--keyboard", role, "Pipeline: 3 ready")
    assert done.returncode == 0, done.stderr
    (call,) = _calls(box)
    assert _markup(call) == REMOVE
    _no_keyboard_layout(box)


# ── 3. one-time removal without the flag ─────────────────────────────────────


def test_without_flag_the_old_keyboard_is_removed_once_then_never(box):
    first = _send(box, "hello")
    second = _send(box, "hello again")
    assert first.returncode == 0 and second.returncode == 0, (first.stderr, second.stderr)
    one, two = _calls(box)
    assert _markup(one) == REMOVE
    assert _markup(two) is None
    _no_keyboard_layout(box)


def test_without_flag_after_removal_no_reply_markup(box):
    _mark_already_removed(box)
    assert _send(box, "plain").returncode == 0
    (call,) = _calls(box)
    assert _markup(call) is None


def test_a_failed_send_does_not_count_as_removed(box):
    failed = _send(box, "hello", env={"FAKE_HTTP": "500"})
    assert failed.returncode == 4
    assert _send(box, "hello").returncode == 0
    _failed_call, retry = _calls(box)
    assert _markup(retry) == REMOVE


def test_removal_is_tracked_per_bot(box):
    _mark_already_removed(box, "assistente")
    assert _send(box, "--from", "capitano", "hi").returncode == 0
    (call,) = _calls(box)
    assert _markup(call) == REMOVE


# ── 4. chunks and photos ─────────────────────────────────────────────────────


def test_markup_rides_only_on_the_last_chunk(box):
    long_text = "\n".join(["line %04d %s" % (i, "x" * 60) for i in range(160)])
    assert _send(box, "--keyboard", "assistente", long_text).returncode == 0
    calls = _calls(box)
    assert len(calls) >= 2
    assert [_markup(c) for c in calls[:-1]] == [None] * (len(calls) - 1)
    assert _markup(calls[-1]) == REMOVE


def test_photo_follows_the_same_rule(box, tmp_path):
    photo = tmp_path / "chart.png"
    photo.write_bytes(b"\x89PNG synthetic")
    assert _send(box, "--from", "capitano", "--photo", str(photo), "caption").returncode == 0
    assert _send(box, "--from", "capitano", "--photo", str(photo), "caption").returncode == 0
    one, two = _calls(box)
    assert 'reply_markup={"remove_keyboard":true}' in one
    assert not any(arg.startswith("reply_markup=") for arg in two)
    _no_keyboard_layout(box)


def test_sender_has_no_keyboard_layout_left():
    source = SENDER.read_text(encoding="utf-8")
    assert "keyboard_json_for" not in source
    assert '"keyboard":[[' not in source


# ── 5. auto_report ───────────────────────────────────────────────────────────


def test_auto_report_no_longer_asks_for_a_keyboard(monkeypatch, tmp_path):
    spec = importlib.util.spec_from_file_location("auto_report_menu", ROOT / "shared" / "skills" / "auto_report.py")
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(ROOT / "shared" / "skills"))
    spec.loader.exec_module(module)
    seen = []

    def fake_run(args, **_kwargs):
        seen.append(list(args))
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(module.subprocess, "run", fake_run)
    photo = tmp_path / "overview.png"
    photo.write_bytes(b"\x89PNG")
    module.send_to_telegram("<b>overview</b>", photo)
    assert seen, "auto_report did not call the sender"
    assert "--keyboard" not in seen[0]
    assert seen[0][seen[0].index("--from") + 1] == "capitano"


# ── 6. the ☰ menu covers every old button ───────────────────────────────────


def _bot_commands():
    source = (ROOT / ".launcher" / "tg-bridge.py").read_text(encoding="utf-8")
    start = source.index("BOT_COMMANDS = {")
    end = source.index("\n}\n", start) + 2
    namespace: dict = {}
    exec(source[start:end], namespace)  # the literal only: importing the bridge needs a live config
    return namespace["BOT_COMMANDS"]


@pytest.mark.parametrize("role", sorted(OLD_BUTTONS))
def test_every_old_button_has_a_menu_command(role):
    commands = {command for command, _key in _bot_commands()[role]}
    missing = {label: cmd for label, cmd in OLD_BUTTONS[role].items() if cmd not in commands}
    assert not missing, f"{role}: buttons without a ☰ command: {missing}"


@pytest.mark.parametrize("lang", LOCALES)
def test_every_menu_command_is_described_in_every_locale(lang):
    catalog = json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))
    for role, entries in _bot_commands().items():
        for command, key in entries:
            value = catalog.get(key)
            assert isinstance(value, str) and value.strip(), f"{lang}: {role} /{command} has no description ({key})"
            assert len(value) <= 256
