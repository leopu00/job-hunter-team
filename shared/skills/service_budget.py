#!/usr/bin/env python3
"""service_budget.py — the share of the budget the service roles may use, so that the money goes to finding and scoring positions.

Dottore, Mantenitore and Mentor look after the team; they find and score nothing. Each of their rounds rereads its whole context
on every call, so a round that does nothing still costs: on a measured run (47 minutes, 1.97 $ of a 3 $ budget of 24 hours) the
three spent 0.85 $, 43 % of it, and the budget was over before the six new positions were scored.

With a budget in the configuration (`team.budget`), a service role does not start a new round once the three of them have spent
SHARE (15 %) of that budget since it counts. The decision is taken where the rounds are started and nowhere else:

  doctor_schedule.py   `claim` (the Dottore) and `check-maintainer` (the Mantenitore) answer WAIT instead of a slot
  agent-watchdog.sh    the Mentor is not due
  start-agent.sh       the Mentor gate (exit 75, «not now», as for a Mentor with nothing to read)

A round already running is not cut (that would be a brake inside the spending gate); with the light model of the service roles one
round costs about 0.1 $. Nothing is lost by skipping: the round comes again when a new budget starts. The person is told once a day,
in their language, why a service role skips its round.

  service_budget.py allow <dottore|mantenitore|mentor>   exit 0 allowed, exit 3 skipped (prints one JSON line)

No budget, an unreadable configuration or a sessions folder that cannot be read: allowed (a reading that fails is no brake; the
spending gate and the brake of the Sentinella stand behind).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

SKILLS = Path(__file__).resolve().parent
if str(SKILLS) not in sys.path:
    sys.path.insert(0, str(SKILLS))

SERVICE_ROLES = ("dottore", "mantenitore", "mentor")
SHARE = 0.15
SKIPPED = 3
NOTICE_KEY = "service_budget.skipped"


def share() -> float:
    """The share of the budget; JHT_SERVICE_BUDGET_SHARE (0 to 1) is for tests and for an operator who needs another."""
    try:
        value = float(os.environ.get("JHT_SERVICE_BUDGET_SHARE", ""))
        if 0 <= value <= 1:
            return value
    except ValueError:
        pass
    return SHARE


def _home() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home")


def _config(home: Path) -> dict:
    try:
        data = json.loads((home / "jht.config.json").read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def spent_by_service(home: Path, since: float) -> float:
    """What the service roles spent since `since`, in dollars: pi's cost of each call of an agent whose role is one of theirs."""
    import pi_sessions

    total = 0.0
    for event in pi_sessions.usage_events(home, since):
        if pi_sessions.role_of(event.get("agent")) in SERVICE_ROLES:
            total += event["cost"]
    return round(total, 6)


def verdict(role: str, now: float | None = None, home: Path | None = None) -> dict:
    """{"allowed": bool, "role", "spent", "limit", "budget", "share"}: `allowed` is False only with a budget and the share used."""
    home = home or _home()
    now = time.time() if now is None else now
    out = {"allowed": True, "role": role, "spent": None, "limit": None, "budget": None, "share": share()}
    try:
        import team_budget

        budget = team_budget.read(_config(home), home)
        if budget is None or role not in SERVICE_ROLES:
            return out
        spent = spent_by_service(home, float(budget["counts_from"]))
        limit = round(float(budget["usd"]) * out["share"], 6)
        out.update(spent=spent, limit=limit, budget=float(budget["usd"]), allowed=spent < limit)
    except Exception:  # noqa: BLE001 - no reading, no skipped round
        out["allowed"] = True
    return out


def _state_file(home: Path) -> Path:
    return home / "state" / "service-budget.json"


def _told_today(home: Path, day: str) -> bool:
    try:
        return json.loads(_state_file(home).read_text(encoding="utf-8")).get("told") == day
    except (OSError, ValueError, AttributeError):
        return False


def _remember(home: Path, day: str) -> None:
    try:
        _state_file(home).parent.mkdir(parents=True, exist_ok=True)
        _state_file(home).write_text(json.dumps({"told": day}), encoding="utf-8")
    except OSError:
        pass


def _money(value: float) -> str:
    return ("%.2f" % value).rstrip("0").rstrip(".") if value % 1 else "%d" % value


def notice_text(result: dict) -> str:
    """What the person reads, in their language (shared/i18n.py: i18n-prefs.json, then JHT_LANG, host.env, English)."""
    import i18n

    import role_names

    return i18n.tf(NOTICE_KEY, role_names.name(result["role"], i18n.current_lang()), "%s USD" % _money(result["spent"]), "%s USD" % _money(result["budget"]),
                   "%d%%" % round(result["share"] * 100))


def _notify_user(text: str, source_id: str) -> None:
    candidates = ["/app/agents/_tools/jht-notify-user", str(SKILLS.parents[1] / "agents" / "_tools" / "jht-notify-user")]
    executable = next((c for c in candidates if Path(c).is_file()), None)
    if not executable:
        raise RuntimeError("jht-notify-user is unavailable")
    done = subprocess.run([executable, "--agent", "capitano", "--kind", "notification", "--source-id", source_id,
                           "--source-action", "service_budget_skip", "--source-payload", json.dumps({"reason": "service_share"}), text],
                          check=False, capture_output=True, text=True, timeout=60)
    if done.returncode != 0:
        raise RuntimeError("jht-notify-user failed with exit %d" % done.returncode)


def allow(role: str, now: float | None = None, home: Path | None = None, notify=None) -> dict:
    """The verdict, and when the round is skipped the person told once a day. A notice that does not go is tried again next time."""
    home = home or _home()
    result = verdict(role, now, home)
    if result["allowed"]:
        return result
    day = datetime.fromtimestamp(time.time() if now is None else now).strftime("%Y-%m-%d")
    if not _told_today(home, day):
        try:
            (notify or _notify_user)(notice_text(result), "service-budget-%s" % day)
            _remember(home, day)
        except Exception as error:  # noqa: BLE001 - not a reason to start the round
            print("service_budget: the person could not be told: %s" % error, file=sys.stderr)
    return result


def blocked(role: str) -> bool:
    """True when `role` must skip its round: the helper the schedulers call. Never raises."""
    try:
        return not allow(role)["allowed"]
    except Exception:  # noqa: BLE001
        return False


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 2 or argv[0] != "allow" or argv[1] not in SERVICE_ROLES:
        print("usage: service_budget.py allow <dottore|mantenitore|mentor>", file=sys.stderr)
        return 2
    result = allow(argv[1])
    print(json.dumps(result))
    return 0 if result["allowed"] else SKIPPED


if __name__ == "__main__":
    sys.exit(main())
