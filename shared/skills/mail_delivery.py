"""Mailbox nudges are receipted only after the transport acknowledges delivery."""

from __future__ import annotations

import os
import subprocess
import sys

from delivery_retry import WakeBudget
from delivery_status import checked, report


def nudge(ctx, session, message_id, *, now=None, capture=None, record=True):
    agent = ctx.agent_id(session)
    if not ctx.MESSAGE_ID.match(str(message_id)) or not ctx.session_ready(session, capture):
        return False
    if record:
        ctx.record_nudge(agent, [message_id], now=now)
    return True


def nudge_through(ctx, binary, session, message_id, *, timeout=100):
    if not nudge(ctx, session, message_id, record=False):
        return "held"
    if checked(
        lambda: subprocess.run(
            [binary, session, ctx.nudge_text(1)], capture_output=True, timeout=timeout, check=False
        ).returncode
        == 0
    ):
        ctx.record_nudge(ctx.agent_id(session), [message_id])
        return "nudged"
    return "held"


def _due(ctx, agent, moment):
    waiting = []
    for item in ctx.pending(agent, now=moment):
        sent = ctx._nudges(agent, item["id"])
        if not sent or (
            len(sent) <= len(ctx.RENEWAL_AFTER)
            and (moment - sent[-1]).total_seconds() >= ctx.RENEWAL_AFTER[len(sent) - 1]
        ):
            waiting.append((item["id"], len(sent)))
    return waiting


def _reserve(ctx, agent, waiting, moment):
    budget = WakeBudget(ctx.home(), filename="mail-nudge-retries.json")
    reserved = []
    for message_id, count in waiting:
        try:
            if budget.reserve(f"{agent}:{message_id}:{count}", moment.timestamp()):
                reserved.append(message_id)
        except (OSError, ValueError, TypeError, KeyError):
            report("delivery_state_unavailable", home=ctx.home())
    return reserved


def remind(ctx, receivers, now=None, ready=None, sender=None):
    moment = ctx._utc(now)
    due = []
    gate = ready or ctx.session_ready
    for agent in sorted(receivers):
        if not ctx.box_dir(agent).is_dir():
            continue
        waiting = _due(ctx, agent, moment)
        session = ctx.session_of(agent)
        if not waiting or not gate(session):
            continue
        ids = _reserve(ctx, agent, waiting, moment) if sender else [item[0] for item in waiting]
        if not ids:
            continue
        line = {"session": session, "text": ctx.nudge_text(len(ctx.pending(agent, now=moment)))}
        if sender is None:
            due.append(line)
        elif checked(lambda: sender(session, line["text"]), home=ctx.home()):
            ctx.record_nudge(agent, ids, now=moment)
            due.append(line)
    return due


def tick(ctx, receivers, now=None, ready=None, sender=None, allowed=None):
    moment = ctx._utc(now)
    lines = []
    for agent in sorted(receivers):
        if not ctx.box_dir(agent).is_dir():
            continue
        for line in ctx.sweep(agent, now=moment, receivers=receivers)["typed"]:
            if allowed is not None and not allowed(line["session"]):
                continue
            if sender is None or checked(lambda: sender(line["session"], line["text"]), home=ctx.home()):
                lines.append(line)
    lines.extend(remind(ctx, receivers, now=moment, ready=ready, sender=sender))
    return lines


def deliver_tick(ctx):
    from agent_pause import is_paused
    from tmux_send_run import run

    binary = os.environ.get("JHT_TMUX_SENDER") or "jht-tmux-send"

    def send(session, text):
        return run([binary, session, text], 120).returncode == 0

    def allowed(session):
        return not is_paused(session, home=ctx.home())

    tick(
        ctx,
        ctx.load_receivers(),
        ready=lambda session: allowed(session) and ctx.session_ready(session),
        sender=send,
        allowed=allowed,
    )
    return ctx.EXIT["ok"]


def transport_exit(ctx, session, message_id, rc, held):
    if held:
        print(f"jht-tmux-send: queued {message_id}; nudge held, it will be repeated")
        return 0
    if rc == 0:
        ctx.record_nudge(ctx.agent_id(session), [message_id])
        print(f"jht-tmux-send: queued {message_id} in the mailbox of {session} (nudge delivered)")
        return 0
    report("message_not_delivered", home=ctx.home(), rc=rc)
    print(f"jht-tmux-send: queued {message_id}; nudge unconfirmed (rc={rc}), it will be repeated", file=sys.stderr)
    # Zero acknowledges safe queuing, not a delivered nudge. The unresponsive
    # terminal keeps its existing rc=3 contract; other held nudges stay queued.
    return 3 if rc == 3 else 0


def command(ctx, args):
    if args.command == "transport-exit":
        return transport_exit(ctx, args.session, args.message_id, args.rc, args.held)
    if args.deliver:
        return deliver_tick(ctx)
    for line in tick(ctx, ctx.load_receivers()):
        text = " ".join(ctx._LINE_BREAK.split(line["text"])).replace("\t", " ")
        print(f"{line['session']}\t{text}")
    return ctx.EXIT["ok"]
