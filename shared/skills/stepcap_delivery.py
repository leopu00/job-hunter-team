"""Step-cap state transitions and delivery evidence, separated from process supervision."""

from delivery_status import report


from delivery_retry import attempt


def _resume_phase(wd, session, agent, entry, now, live_workers, current):
    phase = entry.get("phase", "idle")
    if phase == "resumed":
        if current == entry.get("resume_hash"):
            wd.emit(
                "resume_failed", agent=agent, ts=now, session=session, consecutive=entry.get("consecutive")
            )
        entry.update(phase="idle", hash=current, resume_hash=None, stall_hash=None, immobile=0)
        return
    if phase == "throttled":
        if now < (entry.get("until") or 0):
            return
        if current != entry.get("stall_hash"):
            wd.emit("recovered", agent=agent, ts=now, session=session, consecutive=entry.get("consecutive"))
            wd.clear_throttle(agent)
            entry.update(phase="idle", hash=current, until=None, stall_hash=None, immobile=0)
            return
        if entry.get("via") == "engine":
            engine = wd._throttle_engine()
            flag = engine.get_flag(agent) if engine is not None else {}
            if (
                isinstance(flag, dict)
                and flag.get("state") == getattr(engine, "IN_THROTTLE", "IN_THROTTLE")
                and (now < float(entry.get("until") or 0) + wd.ENGINE_WAKE_GRACE_SEC)
            ):
                return
        gate = wd.resume_gate(now, live_workers)
        if gate:
            wd.emit(
                "gated", agent=agent, ts=now, session=session, gate=gate, consecutive=entry.get("consecutive")
            )
            entry["until"] = now + wd.GATE_RETRY_SEC
            return
        wd.clear_throttle(agent)
        message = wd.RESUME_TEXT.format(AGENT=agent.upper())
        if wd.send_resume(session, agent, message):
            wd.emit(
                "resumed",
                agent=agent,
                ts=now,
                session=session,
                consecutive=entry.get("consecutive"),
                throttle_sec=entry.get("throttle_sec"),
            )
            entry.update(phase="resumed", resume_hash=current, hash=None, until=None, stall_hash=None)
        else:
            wd.emit(
                "resume_send_failed",
                agent=agent,
                ts=now,
                session=session,
                consecutive=entry.get("consecutive"),
            )
            entry.update(phase="idle", hash=None, until=None, stall_hash=None, immobile=0)
        return


def _detect(wd, session, agent, entry, now, live_workers, current, tail, marker):
    usage_line = wd.find_usage_limit(tail)
    previous = entry.get("hash")
    entry["hash"] = current
    if previous is None or previous != current:
        entry["immobile"] = 0
        entry["idle_noted"] = False
        return
    if marker:
        entry["immobile"] = 0
    else:
        rounds = int(entry.get("immobile") or 0) + 1
        entry["immobile"] = rounds
        if rounds < wd.IDLE_STALL_ROUNDS:
            return
        if wd.resume_gate(now, live_workers):
            return
        calm = wd._idle_by_design(agent, now)
        if calm:
            if not entry.get("idle_noted"):
                entry["idle_noted"] = True
                wd.emit("idle_by_design", agent=agent, ts=now, session=session, why=calm, rounds=rounds)
            return
        marker = f"no marker: pane unchanged for {rounds} cycles"
    stall_rounds = int(entry.get("immobile") or 0)
    observed = wd.describe_stall(marker, stall_rounds, usage_line)
    return marker, usage_line, observed


def _throttle(wd, session, agent, entry, now, marker, usage_line, observed, consecutive):
    seconds = wd.throttle_for(agent, consecutive)
    armed = {"via": "none", "applied_sec": 0, "until": now}
    try:
        armed = wd.arm_pause(agent, seconds, now, "stepcap: %s" % marker)
    except OSError as exc:
        wd._log("throttle was not written for %s: %s" % (agent, exc))
    seconds = armed["applied_sec"]
    entry.update(phase="throttled", until=armed["until"], throttle_sec=seconds, via=armed["via"])
    wd.emit(
        "throttled",
        agent=agent,
        ts=now,
        session=session,
        marker=marker,
        consecutive=consecutive,
        throttle_sec=seconds,
    )
    if consecutive == wd.ESCALATE_AT - 1:
        if usage_line:
            wd.notify_captain(
                "[FROM @SYSTEM TO @CAPITANO] %s %s, %d times in a row. I paused it for %d min, but a pause does not refill a quota: if it is still empty it will stop again. Do not inspect what is running — there is nothing wrong with it."
                % (agent, observed, consecutive, max(1, seconds // 60))
            )
        else:
            wd.notify_captain(
                "[FROM @SYSTEM TO @CAPITANO] %s %s, %d consecutive times without producing anything between attempts. I paused it for %d min and will then resume it; if it happens again, I will stop resuming and pass the decision to you. Inspect what is running."
                % (agent, observed, consecutive, max(1, seconds // 60))
            )


def _record(wd, session, agent, entry, now, current, marker):
    produced = wd.produced_count(agent)
    baseline = entry.get("produced")
    progressed = baseline is not None and produced is not None and (produced > baseline)
    consecutive = 1 if progressed or not entry.get("consecutive") else int(entry["consecutive"]) + 1
    entry["consecutive"] = consecutive
    entry["produced"] = produced
    entry["stall_hash"] = current
    wd.emit(
        "detected",
        agent=agent,
        ts=now,
        session=session,
        marker=marker,
        consecutive=consecutive,
        produced=produced,
    )
    return consecutive


def check_missing_acks(wd, state, now):
    mod = wd._throttle_engine()
    if mod is None:
        return []
    try:
        limit = float(wd.NOTIFIED_ACK_MAX_SEC) if wd.NOTIFIED_ACK_MAX_SEC else float(mod.NOTIFIED_ACK_MAX_SEC)
        stuck = mod.notified_without_ack(now=now, max_sec=limit)
    except Exception as exc:
        report("delivery_state_unavailable", home=wd._home())
        raise
    if not stuck:
        state.pop("ack_escalations", None)
        state.pop("ack_delivery_attempts", None)
        return []
    sent = state.setdefault("ack_escalations", {})
    if not isinstance(sent, dict):
        sent = {}
        state["ack_escalations"] = sent
    for row in stuck:
        agent = row["agent"]
        wd.emit(
            "notified_no_ack",
            agent=agent,
            ts=now,
            session=row.get("session"),
            waiting_sec=row.get("waiting_sec"),
            threshold_sec=int(limit),
        )
        last = sent.get(agent) or 0
        if now - float(last) < wd.ACK_ESCALATE_COOLDOWN_SEC:
            continue
        delivered = attempt(
            state.setdefault("ack_delivery_attempts", {}),
            agent,
            lambda: wd.notify_captain(
                "[FROM @SYSTEM TO @CAPITANO] %s received the throttle-engine wake-up %d min ago and still has not acknowledged it (flag remains NOTIFIED). This is not 'possibly idle': the wake-up arrived and got no response, so the agent is blocked. I will not send anything else — decide whether to use `/clear` or respawn. Evidence: state/throttle-flags.json; history: logs/throttle-engine.jsonl."
                % (agent, max(1, int(row.get("waiting_sec", 0) // 60)))
            ),
            now,
        )
        if delivered:
            sent[agent] = now
        else:
            report("message_not_delivered", home=wd._home())
    live = {row["agent"] for row in stuck}
    retries = state.get("ack_delivery_attempts", {})
    for gone in (set(sent) | set(retries)) - live:
        sent.pop(gone, None)
        retries.pop(gone, None)
    return stuck


def notify_captain(wd, message):
    for cand in ("jht-tmux-send", "/app/agents/_skills/tmux-send/jht-tmux-send"):
        try:
            res = wd._transport_run([cand, wd.CAPTAIN_SESSION, message], wd.TMUX_SEND_WAIT_S)
        except FileNotFoundError:
            continue
        except (OSError, wd.subprocess.SubprocessError):
            report("message_not_delivered", home=wd._home())
            return False
        if res.returncode != 0:
            report("message_not_delivered", home=wd._home(), rc=res.returncode)
        return res.returncode == 0
    report("message_not_delivered", home=wd._home())
    return False


def _escalation_message(agent, observed, consecutive, usage_line):
    if usage_line:
        return (
            "[FROM @SYSTEM TO @CAPITANO] %s %s, %d times in a row with no progress in between. "
            "Pausing and resuming will NOT help: it goes back to the same wall until the quota resets. "
            "Do not look for a rabbit hole — decide whether to wait for the reset or move its work elsewhere. "
            "History: logs/stepcap.jsonl." % (agent, observed, consecutive)
        )
    return (
        "[FROM @SYSTEM TO @CAPITANO] %s %s, %d consecutive times without producing anything between attempts: "
        "this looks like a rabbit hole, not an isolated incident. I will NOT resume it automatically again — "
        "decide whether to use `/clear` or respawn. History: logs/stepcap.jsonl."
        % (agent, observed, consecutive)
    )


def _deliver_escalation(wd, session, agent, entry, now):
    last = entry.get("last_escalate_ts")
    if last is not None and now - last < wd.ESCALATE_COOLDOWN_SEC:
        return
    if attempt(
        entry.setdefault("delivery_attempts", {}),
        "captain",
        lambda: wd.notify_captain(entry["pending_escalation"]),
        now,
    ):
        entry.update(phase="escalated", last_escalate_ts=now)
        entry.pop("pending_escalation", None)
        wd.emit("escalated", agent=agent, ts=now, session=session, consecutive=entry.get("consecutive"))
    else:
        wd.emit("escalation_not_delivered", agent=agent, ts=now, session=session)


def _handle_agent(wd, session, agent, entry, now, live_workers):
    if wd._agent_paused(session):
        return
    pane = wd.capture_pane(session)
    if pane is None:
        return
    tail = wd.pane_tail(pane)
    current = wd.pane_hash(tail)
    phase = entry.get("phase", "idle")
    if phase in ("resumed", "throttled"):
        return _resume_phase(wd, session, agent, entry, now, live_workers, current)
    if phase in ("escalated", "awaiting_captain"):
        if current != entry.get("stall_hash"):
            wd.emit("recovered", agent=agent, ts=now, session=session, consecutive=entry.get("consecutive"))
            entry.update(phase="idle", hash=current, stall_hash=None, immobile=0)
            entry.pop("pending_escalation", None)
            entry.pop("delivery_attempts", None)
        elif phase == "awaiting_captain":
            _deliver_escalation(wd, session, agent, entry, now)
        return
    found = _detect(wd, session, agent, entry, now, live_workers, current, tail, wd.find_marker(tail))
    if found is None:
        return
    marker, usage_line, observed = found
    consecutive = _record(wd, session, agent, entry, now, current, marker)
    if consecutive >= wd.ESCALATE_AT:
        entry.update(
            phase="awaiting_captain",
            until=None,
            pending_escalation=_escalation_message(agent, observed, consecutive, usage_line),
        )
        _deliver_escalation(wd, session, agent, entry, now)
        return
    _throttle(wd, session, agent, entry, now, marker, usage_line, observed, consecutive)
