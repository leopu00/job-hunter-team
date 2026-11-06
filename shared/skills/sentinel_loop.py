"""One usage-monitoring tick, split by phase; dependencies remain late-bound."""

from types import SimpleNamespace
from sentinel_delivery import notice, reset
from delivery_status import checked, report


def _before_tick(api, run):
    run.now_h = api.datetime.now().strftime("%H:%M:%S")
    run.override_min, run.provider = api.read_config()
    run.parsed, run.fail_reason = api._do_fetch(run.provider)
    run.dyn_target, run.work_phase = api._read_dynamic_target()
    run.within_hours = api._within_working_hours(run.work_phase)
    api._burn_intent_notify_user()
    api._burn_intent_sweep()
    api._burst_sweep()
    run._bi = api._burn_intent_status()
    run._bi_on = bool(run._bi.get("active"))
    api._burn_intent_announce(run.state, run._bi)
    if run._bi_on and (not run.within_hours):
        run.within_hours = True
        print(
            "[bridge V6] {0} BURN-INTENT: working-hours gate overridden (work_phase={1}, expires in {2} min)".format(
                run.now_h, run.work_phase, run._bi.get("remaining_min")
            )
        )
    api._standby_step(run.parsed)
    api._agent_pause_step()
    if not run._bi_on:
        api._enforce_daily_halt()


def _sample(api, run):
    run.parsed["provider"] = run.provider
    if run.provider in ("anthropic", "claude"):
        run.parsed = api._apply_sticky_weekly_reset(run.parsed)
        run.parsed = api._ensure_reset_unix(run.parsed)
    if run.is_first_tick:
        run.last = None
        run.history = []
        run.is_first_tick = False
    else:
        run.last = api.load_last_sample()
        if run.last and run.last.get("provider") != run.provider:
            run.last = None
            run.history = []
        else:
            run.history = api.load_recent_samples(6000, since_h=50)
    run._wk_axis = None
    run._wu = run.parsed.get("weekly_usage")
    if isinstance(run._wu, (int, float)) and isinstance(run.parsed.get("weekly_reset_at_unix"), (int, float)):
        run._nts = api.time.time()
        run._ndt = api.datetime.fromtimestamp(run._nts, tz=api.timezone.utc)
        run._pre = {
            "weekly_remaining_pct": max(0.0, 100.0 - run._wu),
            "weekly_reset_at_unix": run.parsed.get("weekly_reset_at_unix"),
        }
        run._wk_axis = api._weekly_pace_via_skill(run._pre, run._ndt, run._nts)
    run.entry = api._compute_metrics_via_skill(run.parsed, run.last, run.history, weekly_axis=run._wk_axis)
    run.entry["source"] = "bridge"
    if isinstance(run.parsed, dict) and run.parsed.get("usage_is_weekly") is True:
        run.entry["usage_is_weekly"] = True
    api.write_jsonl(run.entry)
    api.write_log(run.entry)
    api._write_role_usage(run.entry, api.time.time())
    api._record_work_stats()
    api._pace_guard_step(run.entry, within_hours=run.within_hours, burn_intent_on=run._bi_on)
    api._sample_vitals_and_maybe_alert(api.ANCHOR_TICK_MIN if run.override_min is None else run.override_min)


def _status(api, run):
    run.usage = run.entry.get("usage")
    run.proj = run.entry.get("projection")
    run.status = run.entry.get("status")
    run.wk_remaining_now = run.entry.get("weekly_remaining_pct")
    run.weekly_locked = isinstance(run.wk_remaining_now, (int, float)) and run.wk_remaining_now <= 0
    if run.weekly_locked:
        run.status = "LOCKED"
    run.reset = api._fmt_reset(run.entry.get("reset_at_unix"), run.entry.get("reset_at")) or "?"
    run.vel_team_s, run.vel_target_s = api._read_pacing_pace()
    run.on_pace = api._is_on_pace(run.vel_team_s, run.vel_target_s, run.proj, run.dyn_target)
    run.now_ts = api.time.time()
    run.now_local = api.datetime.now().astimezone()
    run.is_quarter = api._is_quarter(run.now_local)
    run.weekly_binding = bool(run.entry.get("weekly_binding"))
    run.weekly_pace = None
    if run.within_hours and (not run.weekly_locked):
        run.weekly_pace = api._weekly_pace_via_skill(
            run.entry,
            api.datetime.fromtimestamp(run.now_ts, tz=api.timezone.utc),
            run.now_ts,
            burn_intent_on=run._bi_on,
        )
        if isinstance(run.weekly_pace, dict) and run.weekly_pace.get("binding"):
            run.weekly_binding = True


def _daily(api, run):
    run.daily_halted = False
    run._dp = api._daily_pacing_via_skill(
        run.entry, api.datetime.fromtimestamp(run.now_ts, tz=api.timezone.utc), run.now_ts
    )
    run._hb = run._dp.get("budget") if isinstance(run._dp, dict) else None
    run._hc = run._dp.get("consumed") if isinstance(run._dp, dict) else None
    run._hs_phase, run._hs_started = api.hardstop_override_phase(
        api._daily_hardstop_disabled(), run.now_ts, api._read_hardstop_override_started()
    )
    api._persist_hardstop_override(run._hs_phase, run._hs_started)
    run._hs_msg = api.daily_hardstop_notice(run._hs_phase, run.now_ts, api._HARDSTOP_NOTICE_STATE)
    if run._hs_msg:
        print("[bridge V6] {0} {1}".format(run.now_h, run._hs_msg))
    if run._hs_phase == api.HARDSTOP_RUNNING or run._bi_on:
        _daily_override(api, run)
    elif isinstance(run._hb, (int, float)) and isinstance(run._hc, (int, float)):
        _daily_cap(api, run)


def _daily_override(api, run):
    if api._daily_halt_active():
        try:
            api.DAILY_HALT_FLAG.unlink()
        except OSError:
            report("delivery_state_unavailable")
            raise
        run._why = "BURN-INTENT (user override)" if run._bi_on else "DAILY-HARDSTOP disabled"
        print("[bridge V6] {0} {1} → daily-halt flag removed".format(run.now_h, run._why))
    elif (
        run._bi_on
        and isinstance(run._hc, (int, float))
        and isinstance(run._hb, (int, float))
        and (run._hc > run._hb + 5.0)
    ):
        print(
            "[bridge V6] {0} BURN-INTENT: daily cap exceeded (today={1:.1f}% > cap={2:.1f}%), but the team remains active — user override expires in {3} min".format(
                run.now_h, run._hc, run._hb + 5.0, run._bi.get("remaining_min")
            )
        )


def _daily_cap(api, run):
    run._hcap = run._hb + 5.0
    run._over_cap = run._hc > run._hcap
    if api._daily_halt_active():
        if not run._over_cap:
            try:
                api.DAILY_HALT_FLAG.unlink()
            except OSError:
                report("delivery_state_unavailable")
                raise
            if run.within_hours:
                for run._s in (api.SENTINELLA_SESSION, api.CAPITANO_SESSION):
                    if api.session_exists(run._s):
                        checked(
                            lambda: api.jht_tmux_send(
                                run._s,
                                "[BRIDGE INFO] ▶️ Daily usage is back within budget (today={0:.1f}% ≤ cap={1:.1f}%): the team can resume; ticks are restarting.".format(
                                    run._hc, run._hcap
                                ),
                            )
                        )
            print(
                "[bridge V6] {0} DAILY-HALT cleared (today={1:.1f}% ≤ cap={2:.1f}%)".format(
                    run.now_h, run._hc, run._hcap
                )
            )
        else:
            run.daily_halted = True
    elif run.within_hours and run._over_cap:
        run.daily_halted = True
        run._alert = "⛔ DAILY CAP EXCEEDED: today={0:.1f}% > cap={1:.1f}% (budget={2:.1f}%). FINAL message before standby: THE TEAM WILL ENTER STANDBY in 30s — ESC to every session, NO forced kill. Work resumes in the next working-hours window.".format(
            run._hc, run._hcap, run._hb
        )
        for run._s in (api.SENTINELLA_SESSION, api.CAPITANO_SESSION):
            if api.session_exists(run._s):
                checked(lambda: api.jht_tmux_send(run._s, "[BRIDGE ALERT] {0}".format(run._alert)))
        print(
            "[bridge V6] {0} DAILY-CAP HIT today={1:.1f}% cap={2:.1f}% → ESC to the entire team in 30s".format(
                run.now_h, run._hc, run._hcap
            )
        )
        api.time.sleep(30)
        run._paused = api._activate_daily_halt(run._hc, run._hcap, run._hb)
        print(
            "[bridge V6] {0} DAILY-HALT active: ESC sent to {1} sessions; bridge silent until the next day".format(
                run.now_h, len(run._paused)
            )
        )


def _decide(api, run):
    if not run.within_hours:
        run.effective_on_pace = True
        api._advance_tick_phase(run.state, run.effective_on_pace)
        run.state["last_sent_ts"] = None
        run.state["last_status"] = None
        run.should_notify = False
        api._maybe_offhours_stop(run.state, run.now_ts, run.vel_team_s)
    elif run.weekly_locked:
        run.effective_on_pace = True
        api._advance_tick_phase(run.state, run.effective_on_pace)
        run.should_notify = run.state.get("last_sent_status") != "LOCKED"
        run.state["last_status"] = run.status
    else:
        run.effective_on_pace = run.on_pace and (not run.weekly_binding)
        api._advance_tick_phase(run.state, run.effective_on_pace)
        run.should_notify = api._should_notify_sentinella(
            run.effective_on_pace, run.state, run.now_ts, run.is_quarter, status=run.status
        )
        run.state["last_status"] = run.status
    if run.effective_on_pace and (not run.weekly_locked):
        reset(run.state, "tick:")
    if run.within_hours:
        run.state["offhours_stop_ts"] = 0
    run.state["last_within_hours"] = run.within_hours
    run.target_dbg = "target={0:.0f}%".format(run.dyn_target) if run.dyn_target else "target=band"
    run.phase_dbg = " phase={0}".format(run.work_phase) if run.work_phase else ""
    run.vel_dbg = (
        " vel={0:.2f}/{1:.2f}".format(run.vel_team_s, run.vel_target_s)
        if isinstance(run.vel_team_s, (int, float)) and isinstance(run.vel_target_s, (int, float))
        else ""
    )
    print(
        "[bridge V6] {0} OK usage={1}% proj={2} status={3} phase={4} on_pace={5}{6} {7}{8} notify={9}".format(
            run.now_h,
            run.usage,
            run.proj,
            run.status,
            run.state["tick_phase"],
            run.on_pace,
            run.vel_dbg,
            run.target_dbg,
            run.phase_dbg,
            run.should_notify,
        )
    )


def _notify(api, run):
    if run.weekly_pace is None and (not run.weekly_locked):
        run.weekly_pace = api._weekly_pace_via_skill(
            run.entry,
            api.datetime.fromtimestamp(run.now_ts, tz=api.timezone.utc),
            run.now_ts,
            burn_intent_on=run._bi_on,
        )
    run.tick_msg = api._build_tick_message(
        run.entry,
        run.parsed,
        run.status,
        run.proj,
        run.usage,
        run.reset,
        run.dyn_target,
        run.work_phase,
        run.weekly_pace,
        run.weekly_locked,
        run.now_h,
        run.now_ts,
    )
    api._write_last_tick(run.tick_msg)
    if run.should_notify and (not run.daily_halted) and api.session_exists(api.SENTINELLA_SESSION):
        if notice(api, run.state, "tick:" + str(run.status), api.SENTINELLA_SESSION, run.tick_msg):
            run.state["last_sent_ts"] = run.now_ts
            run.state["last_sent_status"] = run.status
    if run.fail_streak >= api.FETCH_FAIL_THRESHOLD or run.capitano_alerted:
        run.recovery_pending = True
    if getattr(run, "recovery_pending", False) and run.within_hours:
        if notice(
            api,
            run.state,
            "fetch_recovery",
            api.CAPITANO_SESSION,
            "[BRIDGE INFO] usage source is responsive again; monitoring is normal.",
        ):
            run.capitano_alerted = False
            run.recovery_pending = False
    run.fail_streak = 0
    run.sentinel_alerted = False
    reset(run.state, "fetch_failure:")


def _failure(api, run):
    if run.fail_streak == 0:
        reset(run.state, "fetch_recovery")
        run.recovery_pending = False
    run.fail_streak += 1
    print("[bridge V6] fetch failed #{0}; reason={1}".format(run.fail_streak, run.fail_reason))
    if not run.within_hours:
        return
    if not getattr(run, "sentinel_alerted", False):
        run.sentinel_alerted = notice(
            api,
            run.state,
            "fetch_failure:sentinel",
            api.SENTINELLA_SESSION,
            "[BRIDGE FAILURE] fetch failed. Follow the fallback in your prompt.",
        )
    if run.fail_streak >= api.FETCH_FAIL_THRESHOLD and (not run.capitano_alerted):
        interval = api.ANCHOR_TICK_MIN if run.override_min is None else run.override_min
        run.capitano_alerted = notice(
            api,
            run.state,
            "fetch_failure:captain",
            api.CAPITANO_SESSION,
            "[BRIDGE ALERT] usage source degraded for %d ticks (~%.0f min). The Sentinella is using fallback data. Proceed cautiously."
            % (api.FETCH_FAIL_THRESHOLD, api.FETCH_FAIL_THRESHOLD * interval),
        )


def _publish(api, run):
    run.sleep_sec = api._next_tick_sleep_sec(api.datetime.now().astimezone(), run.override_min)
    run.next_tick_min = run.sleep_sec / 60.0
    run.last_tick_iso = api.datetime.now(api.timezone.utc).isoformat()
    run.next_tick_iso = (
        api.datetime.now(api.timezone.utc) + api.timedelta(seconds=run.sleep_sec)
    ).isoformat()
    if run.parsed:
        api._write_state_file(
            run.state,
            run.last_tick_iso,
            run.next_tick_iso,
            run.next_tick_min,
            last_status=run.status,
            last_projection=run.proj,
            last_usage=run.usage,
            last_reset_at=run.entry.get("reset_at"),
            last_reset_at_unix=run.parsed.get("reset_at_unix"),
            last_provider=run.provider,
        )
    else:
        api._write_state_file(
            run.state, run.last_tick_iso, run.next_tick_iso, run.next_tick_min, last_provider=run.provider
        )
    api.time.sleep(run.sleep_sec)


def _start(api):
    run = SimpleNamespace()
    api.acquire_singleton_lock()
    run.override_min, run._ = api.read_config()
    print(
        "[bridge V6] pid={0} sentinella={1} capitano={2}".format(
            api.os.getpid(), api.SENTINELLA_SESSION, api.CAPITANO_SESSION
        )
    )
    if run.override_min is not None:
        print("[bridge V7] tick interval: {0} min (configuration override)".format(run.override_min))
    else:
        print(
            "[bridge V7] clock-anchored tick every {0} min (x:00/05/10/...); Sentinella wakes every quarter hour (x:00/15/30/45) only on actionable edges and inside the schedule gate".format(
                api.ANCHOR_TICK_MIN
            )
        )
        print("[bridge V7] sentinella cooldown={0}min, edge-driven".format(api.SENTINELLA_COOLDOWN_MIN))
    run.fail_streak = 0
    run.capitano_alerted = False
    run.is_first_tick = True
    run.state = {
        "tick_phase": "DEFAULT",
        "gspot_consecutive": 0,
        "last_sent_ts": None,
        "last_sent_status": None,
    }
    return run


def main(api):
    run = _start(api)
    while True:
        _before_tick(api, run)
        if run.parsed:
            _sample(api, run)
            _status(api, run)
            _daily(api, run)
            _decide(api, run)
            _notify(api, run)
        else:
            _failure(api, run)
        _publish(api, run)
