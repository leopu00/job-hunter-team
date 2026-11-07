"""Claim and deliver application wake events; failures keep their durable retry budget."""

from __future__ import annotations

import os
import time
from pathlib import Path

from delivery_retry import WakeBudget
from delivery_status import checked, report


def wake_message(wake):
    if wake.reason == "essentials_complete":
        what = "the user answered the essential application facts"
    elif wake.reason == "position_authorised":
        return (
            f"[BRIDGE INFO] the user authorised position #{wake.position_id}. "
            "Re-read the queue (apply_gate.py queue) and continue from STEP 1."
        )
    else:
        what = f"the user answered the CLOSER questions for position #{wake.position_id}"
    return (
        f"[BRIDGE INFO] {what}; the answers are saved in jobs.db. "
        "Re-read the queue (apply_gate.py queue) and continue: what was waiting for these answers can run now."
    )


def authorisations_message(wakes):
    ids = ", ".join(f"#{wake.position_id}" for wake in wakes)
    return (
        f"[BRIDGE INFO] the user authorised positions {ids}. "
        "Re-read the queue (apply_gate.py queue) and continue from STEP 1."
    )


def _claim(conn, wakes, ready, budget, now):
    claimed = []
    for wake in wakes:
        if wake.position_id is not None and wake.position_id not in ready:
            continue
        # The DB claim remains the deduplication authority; another bridge's
        # in-flight claim must not consume a retry reservation.
        if conn.execute("SELECT 1 FROM closer_wakes WHERE wake_key = ?", (wake.key,)).fetchone():
            continue
        try:
            if not budget.reserve(wake.key, now):
                continue
        except (OSError, ValueError, TypeError, KeyError):
            report("wake_retry_state_unavailable")
            continue
        owned = conn.execute(
            "INSERT OR IGNORE INTO closer_wakes (wake_key, position_id) VALUES (?, ?)",
            (wake.key, wake.position_id),
        ).rowcount
        conn.commit()
        if owned == 1:
            claimed.append(wake)
    return claimed


def _batches(wakes):
    batches = [[wake] for wake in wakes if wake.reason != "position_authorised"]
    by_position = {batch[0].position_id: batch for batch in batches if batch[0].position_id is not None}
    authorised = []
    for wake in wakes:
        if wake.reason == "position_authorised":
            if wake.position_id in by_position:
                by_position[wake.position_id].append(wake)
            else:
                authorised.append(wake)
    if authorised:
        batches.append(authorised)
    return batches


def _deliver(conn, batch, live, sender, budget):
    text = (
        authorisations_message(batch)
        if batch[0].reason == "position_authorised" and len(batch) > 1
        else wake_message(batch[0])
    )
    delivered = False
    for session in live:
        delivered = checked(lambda: sender(session, text)) or delivered
    params = [(wake.key,) for wake in batch]
    if delivered:
        conn.executemany("UPDATE closer_wakes SET delivered = 1 WHERE wake_key = ?", params)
    else:
        conn.executemany("DELETE FROM closer_wakes WHERE wake_key = ? AND delivered = 0", params)
    conn.commit()
    if not delivered:
        for wake in batch:
            try:
                if budget.exhausted(wake.key):
                    report("wake_retry_exhausted")
            except (OSError, ValueError, TypeError, KeyError):
                report("wake_retry_state_unavailable")
    return delivered


def deliver_wakes(conn, wakes, *, sessions, sender, queue, now=None):
    if not wakes:
        return []
    current = queue(conn)
    if not current.get("ready"):
        return []
    live = sessions()
    if not live:
        return []
    ready = {int(item["position_id"]) for item in current.get("positions") or []}
    budget = WakeBudget(os.environ.get("JHT_HOME") or Path.home() / ".jht")
    claimed = _claim(conn, wakes, ready, budget, time.time() if now is None else now)
    sent = []
    for batch in _batches(claimed):
        if _deliver(conn, batch, live, sender, budget):
            sent.extend(batch)
    return sent
