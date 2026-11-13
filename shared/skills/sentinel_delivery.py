"""Notification outcomes and their cooldowns, kept separate from monitoring."""

from delivery_retry import attempt
from delivery_status import checked, report


def _burn_intent_announce(api, state, bi):
    now_on = bool(bi.get("active"))
    if state.get("burn_target") != now_on:
        reset(state, "burn:")
        state["burn_target"] = now_on
    delivered = state.setdefault("burn_notified", {})
    sessions = (api.CAPITANO_SESSION, api.SENTINELLA_SESSION)
    pending = [session for session in sessions if bool(delivered.get(session)) != now_on]
    if not pending:
        state["burn_intent_on"] = now_on
        return
    if now_on:
        msg = (
            "[BRIDGE INFO] 🔥 "
            + (api._BURN_INTENT_MOD.banner() if api._BURN_INTENT_MOD else "")
            + " Spending controls (daily-halt, schedule gate, WORKER_FLOOR, ladder) will NOT stop you while it lasts: YOU are responsible for preventing waste (C-23). They resume automatically when it expires."
        )
    else:
        msg = "[BRIDGE INFO] ⏱️ BURN-INTENT EXPIRED/REVOKED — spending controls are active again: daily-halt, schedule gate, the 5-minute WORKER_FLOOR, and the ladder now apply. Return the team to normal pacing (C-02/C-07)."
    for session in pending:
        if notice(api, state, "burn:" + session, session, msg):
            delivered[session] = now_on
    if all(bool(delivered.get(session)) == now_on for session in sessions):
        state["burn_intent_on"] = now_on
        print("[bridge V6] BURN-INTENT; agents notified")


def _warn_if_vitals_silent(api, tick_min):
    silence = api._sampler_silence(tick_min)
    if not silence:
        _state(api).get("delivery_attempts", {}).pop("vitals_silent", None)
        return
    now = api.time.time()
    if now - api._LAST_VITALS_SILENT_AT < api.VITALS_SILENT_COOLDOWN_MIN * 60:
        return
    since = silence.get("last") or "the bridge start"
    if notice(
        api,
        _state(api),
        "vitals_silent",
        api.SENTINELLA_SESSION,
        "[BRIDGE VITALS SILENT] The vitals sampler has written nothing for {0:g} min (last sample: {1}); a retry in the same tick failed too. This is NOT a CPU/RAM alarm and says nothing about the machine: resources are simply not being measured, so do not retire workers because of it. Tell the user or the Mantenitore; history in {2}.".format(
            silence["minutes"], since, api.VITALS_FILE
        ),
    ):
        api._LAST_VITALS_SILENT_AT = now


def _sample_vitals_and_maybe_alert(api, tick_min):
    v = api._take_vitals_sample()
    if v is None:
        try:
            api._warn_if_vitals_silent(tick_min)
        except Exception:
            report("delivery_state_unavailable")
        return
    try:
        api.subprocess.run(
            [api.sys.executable, api.VITALS_SKILL, "notify-disk"], capture_output=True, text=True, timeout=30
        )
    except Exception:
        report("delivery_state_unavailable")
    mem = (v.get("mem") or {}).get("pct")
    over = []
    cpu = api._sustained_cpu()
    if cpu:
        over.append(api.cpu_alert_phrase(cpu))
    if isinstance(mem, (int, float)) and mem >= api.VITALS_ALERT_PCT:
        over.append("RAM {0}%".format(mem))
    if not over:
        _state(api).get("delivery_attempts", {}).pop("vitals_alert", None)
        return
    now = api.time.time()
    if now - api._LAST_VITALS_ALERT_AT < api.VITALS_ALERT_COOLDOWN_MIN * 60:
        return
    if notice(
        api,
        _state(api),
        "vitals_alert",
        api.SENTINELLA_SESSION,
        "[BRIDGE VITALS ALERT] Container resources above threshold: {0} (>={1:.0f}%). This is real resource pressure (OOM/saturation risk), separate from the token quota: a single CPU spike never arrives here. Consider escalating to Capitano: reduce the roster or stop one worker. Diagnostic history: {2} (Mantenitore once per day).".format(
            "; ".join(over), api.VITALS_ALERT_PCT, api.VITALS_FILE
        ),
    ):
        api._LAST_VITALS_ALERT_AT = now


def _state(api):
    if not hasattr(api, "_delivery_notice_state"):
        api._delivery_notice_state = {}
    return api._delivery_notice_state


def notice(api, state, key, session, text):
    # A session that is not there (the team not started yet, or stopped) is nobody to deliver to, not a message lost: no attempt
    # is spent and no message_not_delivered line is written (it came every five minutes before the start). The notice goes out
    # at the first tick that finds the session.
    if not api.session_exists(session):
        return False

    def send():
        return checked(lambda: api.jht_tmux_send(session, text))

    return attempt(state.setdefault("delivery_attempts", {}), key, send, api.time.time())


def reset(state, prefix):
    attempts = state.get("delivery_attempts", {})
    for key in list(attempts):
        if key.startswith(prefix):
            attempts.pop(key)
