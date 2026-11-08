"""Delivery contract: enter; independent cases for file-based scheduling."""

import pytest

from test_tmux_send_delivery_proof import (
    MESSAGE,
    box,
    _enter,
    _stuck_signature,
)


def test_enter_is_closed_even_when_the_pending_signature_is_still_visible(box):
    signature = _stuck_signature(box)
    assert bytes.fromhex(signature).decode("utf-8") in MESSAGE[-40:], "the signature is the tail of that text"
    typed_before, enters_before = len(box.typed()), len(box.keys("Enter"))
    done = _enter(box, signature)
    assert done.returncode == 9 and "JHT_REASON retry_unattested" in done.stdout
    assert len(box.typed()) == typed_before, "the text is never typed again"
    assert len(box.keys("Enter")) == enters_before


def test_enter_with_a_draft_plus_the_pending_text_presses_nothing(box):
    signature = _stuck_signature(box)
    box.put("composer", "un testo che ha scritto qualcun altro" + MESSAGE)
    enters_before = len(box.keys("Enter"))
    done = _enter(box, signature)
    assert done.returncode == 9 and "JHT_REASON retry_unattested" in done.stdout
    assert len(box.keys("Enter")) == enters_before


def test_enter_presses_nothing_on_an_empty_composer(box):
    signature = _stuck_signature(box)
    box.put("composer", "")
    enters_before = len(box.keys("Enter"))
    done = _enter(box, signature)
    assert done.returncode == 9 and "JHT_REASON retry_unattested" in done.stdout
    assert len(box.keys("Enter")) == enters_before


def test_enter_presses_nothing_over_a_menu(box):
    signature = _stuck_signature(box)
    box.put("mode", "menu")
    enters_before = len(box.keys("Enter"))
    done = _enter(box, signature)
    assert done.returncode == 9 and "JHT_REASON retry_unattested" in done.stdout
    assert len(box.keys("Enter")) == enters_before


def test_enter_never_presses_when_the_pending_submit_was_swallowed(box):
    signature = _stuck_signature(box)
    box.put("enter_ignored")
    enters_before, spaces_before, typed_before = len(box.keys("Enter")), len(box.keys("Space")), len(box.typed())
    done = _enter(box, signature)
    assert done.returncode == 9 and "JHT_REASON retry_unattested" in done.stdout
    assert len(box.keys("Enter")) == enters_before
    assert len(box.keys("Space")) == spaces_before and len(box.typed()) == typed_before


@pytest.mark.parametrize("bad", ["", "zz", "abc", "41" * 65, "4141; rm -rf /"])
def test_enter_refuses_a_signature_that_is_not_hex_and_touches_nothing(box, bad):
    done = _enter(box, bad)
    assert done.returncode == 1
    assert [c for c in box.calls() if c.startswith("send-keys")] == []
