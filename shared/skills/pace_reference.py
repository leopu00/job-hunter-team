#!/usr/bin/env python3
"""pace_reference.py — the ONE reference the weekly budget is paced against, for the Sentinella and for the PACE-GUARD.

On a real run (02/11, during a burn) the two gave opposite orders in the same minute and the Captain had to choose:

  - WEEKLY-PACE (Sentinella): "SLOW DOWN: 54 % remains across 21 active hours, vel_weekly 7.20 %/h vs sustainable 2.53 %/h",
    and "BURN-INTENT does not yield this weekly safeguard";
  - PACE-GUARD (the bridge): "BEHIND: usage 47 % vs curve 75 % (-28 pt), RECOMMENDED 300 s".

They measured against two different lines. The Sentinella counts the ACTIVE hours (the hours the team works: 13-00 here, about
21 left); the PACE-GUARD counted the calendar of the window (about 62 hours, nights included, of which the team works a third). On
a weekly window with working hours the calendar line is simply the wrong ruler: "behind" in calendar time is "ahead" in hours of work.

The reference is now the active hours, for both, and it lives here:

  ideal(t)      = the share of the cycle's active hours already gone, in % (the line the team should be on);
  sustainable   = what remains / the active hours that remain, in %/h (the speed that lands on the reset);
  the rate      = pace_rate.py (an integer counter, an interval [lo, hi], at least an hour);
  lockout risk  = the LOW end of the rate would exhaust what remains MORE than LOCKOUT_MARGIN_ACTIVE_H active hours before the
                  reset (the interval's low end: an uncertainty never brakes, as in pace_rate).

What a burn changes (the user's order, 02/11): while the user's burn intent is live, being ahead of the line (the level, the
cumulative debt, the ratio to the sustainable speed) is INFORMATION and brakes nothing. The only brake is the lockout risk,
the wall the burn cannot spend through: the provider stops answering before the reset. Without a burn everything is as it was:
the ratio (1.2x above / 0.8x below) and the debt brake, the line is the same one.

Pure: no I/O. `weekly_pace.weekly_pace_assessment` gives the numbers, `verdict()` reads them, and both the Sentinella's
`_pace_verdict_line` and `pace_guard.evaluate` call it, so the two cannot disagree: they are one verdict.
"""
from __future__ import annotations

LOCKOUT_MARGIN_ACTIVE_H = 2.0   # a burn brakes only when the wall is more than this many active hours before the reset
LOCKOUT_STEP_ACTIVE_H = 2.0     # one throttle step more for each this many active hours beyond the margin
WEEKLY_WINDOW_H = 24.0          # a window longer than a day is a weekly one: the line is the active hours, not the calendar
STEP_PCT = 6.0                  # one throttle step for each this many points off the line (pace_guard's, unchanged)
MAX_STEPS = 6


def is_weekly_window(window_h) -> bool:
    return isinstance(window_h, (int, float)) and window_h > WEEKLY_WINDOW_H


def lockout_risk(remaining_pct, active_h_to_reset, rate_lo_pct_h, margin_h=LOCKOUT_MARGIN_ACTIVE_H):
    """(risk, early_active_h): does the low end of the rate exhaust `remaining_pct` more than `margin_h` before the reset?

    `early_active_h` is how many active hours before the reset the budget would be gone at that rate (None when it would last)."""
    if not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in (remaining_pct, active_h_to_reset, rate_lo_pct_h)):
        return False, None
    if active_h_to_reset <= 0:
        return False, None
    if remaining_pct <= 0:
        return True, round(active_h_to_reset, 1)
    if rate_lo_pct_h <= 0:
        return False, None
    early = active_h_to_reset - remaining_pct / rate_lo_pct_h
    return early > margin_h, (round(early, 1) if early > 0 else None)


def _steps_for_lockout(early_h) -> int:
    over = max(0.0, float(early_h) - LOCKOUT_MARGIN_ACTIVE_H)
    return min(MAX_STEPS, 1 + int(over // LOCKOUT_STEP_ACTIVE_H))


def verdict(assessment, *, burn_intent_on=False, usage_pct=None, target_pct=100.0) -> dict:
    """The one verdict from a `weekly_pace_assessment` dict.

    Returns {verdict, brake, steps, basis, reason, ideal_pct, deviation_pts, early_lockout_h, sustainable_pct_h} where
    `steps` > 0 slows the team down (one throttle step each), < 0 speeds it up, 0 leaves it. The verdicts:
      LOCKOUT-RISK  the wall before the reset (the only brake under a burn);
      AVANTI        ahead of the line, a brake (never under a burn);
      INDIETRO      behind the line, room to go faster;
      IN-PARI       on the line, or ahead of it under a burn (information);
      ND            not enough data: no verdict, no brake.
    An assessment that is `too_early` (the first hours of the window: pace_rate.projection_rate) carries no verdict of the
    RATE (no lockout risk, no «behind», no spend-faster advice): what is left is the LEVEL on the active-hours line, which
    a counter's rounding does not move, so a team that is already ahead of the line is still braked and the line is still
    shown; reason `too_early` says why it never says «behind».
    """
    base = {"verdict": "ND", "brake": False, "steps": 0, "basis": "active_hours", "reason": "no_data",
            "ideal_pct": None, "deviation_pts": None, "early_lockout_h": None, "sustainable_pct_h": None,
            "burn_intent": bool(burn_intent_on)}
    too_early = bool(isinstance(assessment, dict) and assessment.get("too_early"))
    if not isinstance(assessment, dict) or (assessment.get("kind") in (None, "ND") and not too_early):
        return base
    ideal = assessment.get("ideal_used_pct")
    if isinstance(ideal, (int, float)) and isinstance(target_pct, (int, float)):
        ideal = ideal * target_pct / 100.0
    else:
        ideal = None
    deviation = None
    if ideal is not None and isinstance(usage_pct, (int, float)) and not isinstance(usage_pct, bool):
        deviation = round(float(usage_pct) - ideal, 2)
    out = {**base, "ideal_pct": round(ideal, 2) if ideal is not None else None, "deviation_pts": deviation,
           "early_lockout_h": assessment.get("lockout_early_active_h", assessment.get("early_lockout_h")),
           "sustainable_pct_h": assessment.get("sustainable_pct_h"),
           "reason": "too_early" if too_early else "on_line"}
    if assessment.get("burst_transient"):
        return {**out, "verdict": "IN-PARI", "reason": "spike_leaving"}
    if burn_intent_on:
        if assessment.get("lockout_risk"):
            return {**out, "verdict": "LOCKOUT-RISK", "brake": True, "reason": "lockout_before_reset",
                    "steps": _steps_for_lockout(assessment.get("lockout_early_active_h") or LOCKOUT_MARGIN_ACTIVE_H)}
        if deviation is not None and deviation < -STEP_PCT and not too_early:
            return {**out, "verdict": "INDIETRO", "steps": -int((-deviation) // STEP_PCT), "reason": "room_under_burn"}
        return {**out, "verdict": "IN-PARI", "reason": "burn_ahead_is_information" if (deviation or 0) > STEP_PCT else "on_line"}
    # no burn: the rule as it was (the ratio and the debt brake, on the same active-hours line)
    if assessment.get("binding"):
        steps = max(1, int(deviation // STEP_PCT)) if deviation is not None and deviation > STEP_PCT else 1
        return {**out, "verdict": "AVANTI", "brake": True, "steps": min(MAX_STEPS, steps), "reason": "above_pace_or_debt"}
    if deviation is not None and deviation > STEP_PCT:
        return {**out, "verdict": "AVANTI", "brake": True, "steps": min(MAX_STEPS, int(deviation // STEP_PCT)), "reason": "ahead_of_line"}
    if deviation is not None and deviation < -STEP_PCT and not too_early:
        return {**out, "verdict": "INDIETRO", "steps": -int((-deviation) // STEP_PCT), "reason": "behind_line"}
    return {**out, "verdict": "IN-PARI"}
