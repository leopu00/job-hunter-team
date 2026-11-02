#!/usr/bin/env python3
"""budget_view — how the team's weekly budget is going, as numbers for the app's Budget page. Read only.

It computes nothing of its own: the week is `weekly_pace.weekly_pace_assessment` (the integer counter's rate, the active
hours), the verdict is `pace_reference.verdict` (the ONE line the Sentinella and the PACE-GUARD measure on), the
spending override is `burn_intent.status`, the share per role is `role-usage.json`. This file only gathers them in
one closed answer; a test compares its numbers with the ones the sentinel's bridge computes for the same samples.

The answer is a closed list of numbers, booleans, timestamps and CODES (never a sentence the team wrote): the page
turns each code into a plain sentence in the person's language.  A number the team does not have is `null`, never 0.

The files it reads are written where the team's agents can write, so it trusts none of them: each one is opened
without following a link and without waiting (`working_hours.read_plain`), within a size, and each value is checked
(type, finite, range) before it is used; what fails is dropped, and the answer says `null` for it.

Uso:
  python3 budget_view.py read      JSON on stdout, for the app
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import burn_intent  # noqa: E402
import freeze_marker  # noqa: E402
import pace_rate  # noqa: E402
import pace_reference  # noqa: E402
import plain_file  # noqa: E402
import weekly_pace  # noqa: E402
import work_hours_target as wht  # noqa: E402
from working_hours import NotPlain, read_plain  # noqa: E402  (the one way the team reads a file its agents can write)

DATA_TAIL_BYTES = 1536 * 1024       # ~12 h of 5-minute rows; the burn's cost needs the grant inside it, else it says null
ROLE_USAGE_MAX_BYTES = 256 * 1024
ROLE_USAGE_STALE_MIN = 15
PACE_GUARD_TAIL_BYTES = 64 * 1024
FREEZE_RECOVERY_SEC = 2 * 3600       # as throttle pause-rules.json: «keep_captains_pause.after_freeze_sec»
ROLES = ("capitano", "sentinella", "assistente", "mentor", "dottore", "mantenitore", "scout", "analista", "scorer",
         "scrittore", "critico", "tesoriere", "closer")
VERDICTS = {"AVANTI": "ahead", "LOCKOUT-RISK": "lockout_risk", "IN-PARI": "on_pace", "INDIETRO": "behind", "ND": "no_data"}
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")


def jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))


# ── small checks: nothing from a file is used before it passes one ───────────────────────────────────────────────

def _num(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return None
    return float(value) if low <= value <= high else None


def _round(value, digits=1):
    return None if value is None else round(float(value), digits)


def _epoch(text):
    if not isinstance(text, str) or not _ISO.match(text):
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _iso(epoch):
    return None if epoch is None else datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="seconds")


# ── the sentinel's samples ───────────────────────────────────────────────────────────────────────────────────────

def read_samples(home: Path, now_ts: float) -> list:
    """The checked rows of the tail of `sentinel-data.jsonl`, oldest first: {t, used, remaining, reset} (each may be None)."""
    try:
        raw = read_plain(home / "logs" / "sentinel-data.jsonl", tail=DATA_TAIL_BYTES)
    except (OSError, NotPlain):
        return []
    lines = raw.decode("utf-8", errors="replace").splitlines()
    if raw and len(raw) >= DATA_TAIL_BYTES and lines:
        lines = lines[1:]            # the first line of a tail is cut in the middle
    rows = []
    for line in lines:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if not isinstance(entry, dict):
            continue
        t = _epoch(entry.get("ts"))
        used = _num(entry.get("weekly_usage"), 0, 10_000)
        if t is None or t > now_ts + 60 or used is None:
            continue
        rows.append({"t": t, "used": used,
                     "remaining": _num(entry.get("weekly_remaining_pct"), 0, 10_000),
                     "reset": _num(entry.get("weekly_reset_at_unix"), 1, 99_999_999_999)})
    rows.sort(key=lambda r: r["t"])
    return rows


# ── the pieces ───────────────────────────────────────────────────────────────────────────────────────────────────

def _config(home: Path):
    try:
        return plain_file.read_json(home / "jht.config.json")
    except (OSError, NotPlain, ValueError):
        return None


def _active_hours(now_ts: float, reset_ts: float, cfg):
    """(active hours until the reset, active hours of the whole cycle), or (None, None) when the hours cannot be read."""
    try:
        now = datetime.fromtimestamp(now_ts, timezone.utc)
        reset = datetime.fromtimestamp(reset_ts, timezone.utc)
        # cfg None (no file, not ours, unreadable) is what the bridge passes too: the hours module then reads its own and,
        # when there are none, the team works 24/7.
        return (wht.active_hours_in_range(now, reset, cfg),
                wht.active_hours_in_range(reset - timedelta(days=7), reset, cfg))
    except Exception:  # noqa: BLE001 — a page that cannot say is better than a failed read
        return None, None


def _burn(now_ts: float, rows: list, rate_now):
    """The user's spending override: its state, and what it has cost since it was granted (points of the week)."""
    out = {"state": "off", "grantedAt": None, "expiresAt": None, "remainingMin": None, "spentPts": None,
           "paceBeforePctH": None, "paceNowPctH": _round(rate_now, 2)}
    try:
        status = burn_intent.status(datetime.fromtimestamp(now_ts, timezone.utc))
    except Exception:  # noqa: BLE001
        out["state"] = "unknown"
        return out
    state = status.get("state")
    out["state"] = state if state in ("off", "active", "expired") else "unknown"
    granted, expires = _epoch(status.get("granted_at")), _epoch(status.get("expires_at"))
    out["grantedAt"], out["expiresAt"] = _iso(granted), _iso(expires)
    remaining = _num(status.get("remaining_min"), 0, 24 * 60)
    out["remainingMin"] = int(remaining) if remaining is not None and out["state"] == "active" else None
    if out["state"] == "active" and granted is not None and rows:
        before = [r for r in rows if r["t"] <= granted + 60]
        # The grant must be inside the samples we hold: else the cost is not known, which is not 0.
        if before and granted - before[-1]["t"] <= 20 * 60:
            out["spentPts"] = _round(max(0.0, rows[-1]["used"] - before[-1]["used"]), 1)
            try:
                past = pace_rate.counter_rate([(r["t"], r["used"]) for r in before], granted, max_span_h=8.0)
                out["paceBeforePctH"] = _round(past["rate"], 2) if past else None
            except Exception:  # noqa: BLE001
                pass
    return out


def _roles(home: Path, now_ts: float):
    """Share per role on the week (or the only window the plan has), from role-usage.json; None when it cannot be trusted."""
    try:
        data = json.loads(read_plain(home / "logs" / "role-usage.json", max_size=ROLE_USAGE_MAX_BYTES).decode("utf-8"))
    except (OSError, NotPlain, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("windows"), dict):
        return None
    generated = _epoch(data.get("generated_at"))
    for name in ("week", "5h"):
        window = data["windows"].get(name)
        if isinstance(window, dict) and isinstance(window.get("roles"), dict):
            break
    else:
        return None
    roles = []
    for role, item in window["roles"].items():
        share = _num(item.get("share_pct") if isinstance(item, dict) else None, 0, 100)
        kt = _num(item.get("kt") if isinstance(item, dict) else None, 0, 1e9)
        agents = item.get("agents") if isinstance(item, dict) else None
        if role in ROLES and share is not None and kt is not None:
            roles.append({"role": role, "sharePct": _round(share, 1), "kt": _round(kt, 1),
                          "agents": len(agents) if isinstance(agents, list) and len(agents) <= 200 else None})
    roles.sort(key=lambda r: -r["sharePct"])
    return {"window": name, "roles": roles[:20], "unattributedPct": _round(_num(window.get("unattributed_pct"), 0, 100), 1),
            "totalKt": _round(_num(window.get("total_kt"), 0, 1e9), 1),
            "ageMin": int((now_ts - generated) // 60) if generated is not None and generated <= now_ts + 60 else None}


def _brakes(verdict: dict, burn_state: str, home: Path, now_ts: float):
    """The brakes that are on, as CLOSED codes the page puts in plain words; and the pause between jobs in seconds."""
    codes = []
    if verdict["brake"]:
        codes.append("pace_ahead" if verdict["verdict"] == "AVANTI" else "lockout_risk")
    try:
        flag = home / "logs" / "daily-halt.flag"
        if flag.is_file() and not flag.is_symlink():
            codes.append("daily_cap_stop")
    except OSError:
        pass
    try:
        since = freeze_marker.seconds_since(now_ts)
        if since is not None and 0 <= since <= FREEZE_RECOVERY_SEC:
            codes.append("recovering_after_freeze")
    except Exception:  # noqa: BLE001
        pass
    pause = None
    try:
        import pace_guard
        workers = pace_guard.active_workers()
        if workers:
            pause = _num(pace_guard.current_worker_throttle(workers), 0, 3600)
    except Exception:  # noqa: BLE001
        pass
    if pause is not None and pause > getattr(sys.modules.get("pace_guard"), "WORKER_FLOOR", 300):
        codes.append("pause_between_jobs")
    return codes, (int(pause) if pause is not None else None)


# ── the answer ───────────────────────────────────────────────────────────────────────────────────────────────────

def read(now_ts: float | None = None, home: Path | None = None) -> dict:
    now_ts = float(now_ts if now_ts is not None else datetime.now(timezone.utc).timestamp())
    home = home or jht_home()
    rows = read_samples(home, now_ts)
    answer = {"ok": True, "generatedAt": _iso(now_ts), "sampleAt": None, "sampleAgeMin": None, "week": None, "rate": None,
              "verdict": {"code": "no_data", "brake": False, "steps": 0}, "brakes": [], "pauseSec": None,
              "burn": _burn(now_ts, [], None), "roles": _roles(home, now_ts)}
    if not rows:
        return answer
    last = rows[-1]
    answer["sampleAt"] = _iso(last["t"])
    answer["sampleAgeMin"] = max(0, int((now_ts - last["t"]) // 60))
    remaining = last["remaining"] if last["remaining"] is not None else max(0.0, 100.0 - last["used"])
    reset = last["reset"]
    active_to_reset = total_active = None
    if reset is not None and reset > now_ts:
        active_to_reset, total_active = _active_hours(now_ts, reset, _config(home))
    burn_on = _burn(now_ts, [], None)["state"] == "active"
    assessment = None
    if active_to_reset is not None and active_to_reset > 0:
        try:
            assessment = weekly_pace.weekly_pace_assessment(
                None, now_ts, remaining, active_to_reset, weekly_total_active_hours=total_active,
                burn_intent_on=burn_on, samples=[(r["t"], r["used"]) for r in rows])
        except Exception:  # noqa: BLE001
            assessment = None
    try:
        verdict = pace_reference.verdict(assessment, burn_intent_on=burn_on, usage_pct=last["used"])
    except Exception:  # noqa: BLE001
        verdict = {"verdict": "ND", "brake": False, "steps": 0, "ideal_pct": None, "deviation_pts": None}
    deviation = verdict.get("deviation_pts")
    answer["week"] = {
        "usedPct": _round(last["used"], 1), "remainingPct": _round(remaining, 1),
        "resetAtUnix": int(reset) if reset is not None else None,
        "activeHoursToReset": _round(active_to_reset, 1),
        "idealUsedPct": _round(verdict.get("ideal_pct"), 1), "deviationPts": _round(deviation, 1),
        "line": (None if deviation is None else "ahead" if deviation > 2 else "behind" if deviation < -2 else "on"),
    }
    if assessment:
        answer["rate"] = {
            "loPctH": _round(_num(assessment.get("vel_lo_pct_h"), 0, 10_000), 2),
            "hiPctH": _round(_num(assessment.get("vel_hi_pct_h"), 0, 10_000), 2),
            "nowPctH": _round(_num(assessment.get("vel_weekly_pct_h"), 0, 10_000), 2),
            "sustainablePctH": _round(_num(assessment.get("sustainable_pct_h"), 0, 10_000), 2),
            "projectedFinalPct": _round(_num(assessment.get("projected_final_pct"), 0, 10_000), 0),
            "wastedPct": _round(_num(assessment.get("wasted_pct"), 0, 100), 0),
            "lockoutEarlyActiveH": _round(_num(assessment.get("lockout_early_active_h", assessment.get("early_lockout_h")), 0, 1000), 1),
            "marginActiveH": float(pace_reference.LOCKOUT_MARGIN_ACTIVE_H),
        }
    answer["verdict"] = {"code": VERDICTS.get(verdict["verdict"], "no_data"), "brake": bool(verdict["brake"]),
                         "steps": int(max(-6, min(6, verdict["steps"])))}
    answer["burn"] = _burn(now_ts, rows, (assessment or {}).get("vel_weekly_pct_h"))
    answer["brakes"], answer["pauseSec"] = _brakes(verdict, answer["burn"]["state"], home, now_ts)
    return answer


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] != "read":
        print(__doc__, file=sys.stderr)
        return 2
    try:
        out = read()
    except Exception:  # noqa: BLE001 — the app is told «unavailable», never a trace
        out = {"ok": False, "error": "budget_unavailable"}
    print(json.dumps(out, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
