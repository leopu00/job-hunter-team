"""A spending brake for the agents on the pi harness: the cost pi measures, against the ceiling the person declared.

An access with no quota data (an API key, or a team made only of pi agents: see quota_data.py) has no 5h or weekly
window to pace by, so nothing stopped the spending but the ceiling set with the provider. pi writes the cost of every
call in its session files (pi_sessions.py), so the spending is now measured. Here it is compared, on every tick of the
Sentinella, with the ceiling the config declares:

  "no_quota_cap": {"eur": 10, "tokens_per_hour": 500000}

  eur               what pi spent TODAY (local day). pi prices in dollars and the figure is compared as it is, one to
                    one. It is pi's own cost per call plus the web search fee. pi's price for a cache write is the
                    provider's (1.25x the input for the default 30 minutes), so the figure follows the invoice; it
                    falls BELOW it only for a call above 272k input tokens (the long-context tier is not in pi's cost),
                    so the brake can come late by that surcharge, never by the cache.
  tokens_per_hour   what pi's agents processed or produced in the last hour: input, cache writes, output (a cache
                    read is a tenth of the price and is left out).

  below the ceiling    nothing.
  at the ceiling       a DECLARED pause: the Captain and the person are told, the daily-halt flag is raised (ESC to
                       every session, no forced kill, the same brake the daily cap uses), tagged with its reason. It is
                       lifted by the same tick that sees the spending back under the ceiling (the next day for `eur`,
                       less than an hour later for `tokens_per_hour`) or when a burn-intent is in force. Not a FATAL.
  no ceiling declared  the person is told once a day how much pi spent and that nothing stops it.

The budget of the setup (team_budget.py: `team.budget`, dollars over a period, spread over the working hours) is read
before `no_quota_cap` and counts from its own start, not from midnight. Three pauses come from it:

  budget     spent >= usd - max(2 %, 0.10 $). The brake looks every ~5 minutes and a call in flight is still paid, so it
             stops a little before. It does not lift by itself: a new budget (jht setup) lifts it.
  period     the period is over. It does not lift by itself either.
  pace       spent above the share of the budget of the worked time gone by (one working hour ahead): it lifts by itself
             when the worked time catches up, and the person is told when.

It runs only in the NO-QUOTA mode (the ceiling is called `no_quota_cap` for that reason): with quota data the windows and
the daily cap pace the team, and they would lift this pause as if it were theirs.

Nothing here raises into the tick: a reading that fails is a warning in the log and the tick goes on.
"""

from __future__ import annotations

import json
import math
import re
import sqlite3
from pathlib import Path
from datetime import datetime

import pi_sessions
import provider_credit
import quota_data
import team_budget

REASON = "pi_spend_cap"
# How often the brake looks at the spending: between two ticks of the Sentinella too (sentinel_loop._sleep_watching_the_spending).
CHECK_EVERY_SEC = 60
# The spending of the last minutes, as a pace: what the team will have spent by the next look is that pace times CHECK_EVERY_SEC.
RATE_WINDOW_SEC = 300
PROVIDER_NAMES = provider_credit.PROVIDER_NAMES


def _positive(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        return None
    return float(value)


def ceilings(config):
    """(eur, tokens_per_hour) as declared in `no_quota_cap`; None for each that is absent or not a positive number."""
    cap = config.get("no_quota_cap") if isinstance(config, dict) else None
    if not isinstance(cap, dict):
        return None, None
    return _positive(cap.get("eur")), _positive(cap.get("tokens_per_hour"))


def day_start(now_ts):
    """The epoch second of the local midnight that starts the day of `now_ts`."""
    return datetime.fromtimestamp(now_ts).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()


WORKER_ROLES = ("scout", "analista", "scorer")  # the first call of one of them starts a budget of a duration


def _is_worker(agent):
    return isinstance(agent, str) and agent.split("-", 1)[0] in WORKER_ROLES


def spend(home, now_ts, budget_start=None, split_at=None):
    """What pi spent: `cost` today (dollars: pi's estimate plus the fee of the web searches), `hour_tokens` in the last hour,
    `calls` today, `budget_cost` since `budget_start` when a budget is declared (else None), and `first_worker`, the
    moment of the first call of a worker since `budget_start` (None without one). `before_start` is what was spent from
    `budget_start` to `split_at` (the start of the period), or to that first call when `split_at` is None: the onboarding."""
    start, hour = day_start(now_ts), now_ts - 3600
    out = {"cost": 0.0, "hour_tokens": 0, "calls": 0, "credit": provider_credit.exhausted(home, now_ts),
           "budget_cost": None if budget_start is None else 0.0, "first_worker": None,
           "recent_cost": 0.0, "before_start": 0.0}
    budget_events = []
    since = min(start, hour) if budget_start is None else min(start, hour, budget_start)
    for event in pi_sessions.usage_events(home, since):
        if event["ts"] >= start:
            out["cost"] += event["cost"]
            out["calls"] += 1
        if event["ts"] >= hour:
            out["hour_tokens"] += event["input"] + event["cache_write"] + event["output"]
        if budget_start is not None and event["ts"] >= budget_start:
            out["budget_cost"] += event["cost"]
            budget_events.append((event["ts"], event["cost"]))
            if event["ts"] >= now_ts - RATE_WINDOW_SEC:
                out["recent_cost"] += event["cost"]
            if out["first_worker"] is None and _is_worker(event.get("agent")):
                out["first_worker"] = event["ts"]  # the events come oldest first
    for event in pi_sessions.search_events(home, since):  # the fee of a search call, which pi does not price
        if event["ts"] >= start:
            out["cost"] += event["cost"]
        if budget_start is not None and event["ts"] >= budget_start:
            out["budget_cost"] += event["cost"]
            budget_events.append((event["ts"], event["cost"]))
            if event["ts"] >= now_ts - RATE_WINDOW_SEC:
                out["recent_cost"] += event["cost"]
    split = split_at if split_at is not None else out["first_worker"]
    if split is not None:
        out["before_start"] = round(sum(cost for moment, cost in budget_events if moment < split), 6)
    out["cost"] = round(out["cost"], 6)
    if budget_start is not None:
        out["budget_cost"] = round(out["budget_cost"], 6)
    return out


RESTART_RESERVE_SHARE = 0.10   # a team stopped by the pace comes back only with this share of the budget of room under the pace


def _budget_verdict(config, budget, spent, now, held_by_pace=False):
    """The pause the budget asks for, or None. `held_by_pace`: the team is paused by the pace right now; it then stays paused until
    the pace leaves the room a restart costs (seven sessions starting together rewrite their cache: 0.85 $ in 86 s, giro Linux
    18/11, with the pace lifted at the very dollar it had stopped on)."""
    used = spent.get("budget_cost") or 0.0
    # What the team will have spent by the next look, at the pace of the last minutes: the brake stops BEFORE the budget, not
    # one look after it (with Claude ~0.5 $ a minute, a look a minute late is half a dollar over).
    ahead = (spent.get("recent_cost") or 0.0) / RATE_WINDOW_SEC * CHECK_EVERY_SEC
    common = {"action": "halt", "spent": used, "usd": budget["usd"], "ends": budget["ends"], "starts": budget["starts"],
              "counts_from": budget["counts_from"]}
    if used + ahead >= budget["usd"] - team_budget.margin(budget["usd"]):
        return dict(common, why="budget", ceiling=budget["usd"], resumes=None)
    if budget["starts"] is None:
        return None  # a budget of a duration that has not started: no period and no pace yet, only the dollars
    if now + CHECK_EVERY_SEC > budget["ends"]:  # the end falls before the next look: now, not a look late
        return dict(common, why="period", ceiling=budget["usd"], resumes=None)
    # The pace is the period's: what the onboarding spent before the first worker counts against the budget (above), not
    # against the pace, which spreads what was LEFT at the start over the period (giro Mac 21: 2 $ for a day on Claude, 1.71 $
    # of onboarding, and the pace paused the team the minute the Scouts started).
    before = min(spent.get("before_start") or 0.0, used)
    common["before"] = before
    period = dict(budget, usd=budget["usd"] - before)
    if period["usd"] <= 0:
        return None
    allowance = team_budget.allowed(config, period, now)
    reserve = RESTART_RESERVE_SHARE * period["usd"] if held_by_pace else 0.0
    # the pace looks AHEAD like the budget does: a team that restarts spends in the first minute what the next look would only see
    if used - before + ahead + reserve >= allowance:
        return dict(common, why="pace", ceiling=round(before + allowance, 6),
                    resumes=team_budget.resumes_at(config, period, used - before + RESTART_RESERVE_SHARE * period["usd"]) or budget["ends"])
    return None


def decide(config, spent, no_quota_mode, now=None, budget=None, held_by_pace=False):
    """{"action": "none" | "halt" | "warn", ...}. Pure: a config, a measure and a moment in, a verdict out. `budget` is
    the one team_budget.read gave with the start of a duration resolved; None reads it from the config alone."""
    # Before the mode: the bridge declares the no-quota mode at the END of its first tick, so a team that found the
    # credit already gone never got past here (collaudo Linux, 12/11), and a Codex team whose pi agents answer «no
    # credit» has quota data and would never pause either. Every call would fail: the team waits, whatever the mode.
    if spent.get("credit"):
        return {"action": "halt", "why": "credit", "provider": spent["credit"]["provider"], "spent": 0.0, "ceiling": 0.0}
    # The budget of the setup before the mode, as the credit: it is the person's own dollars, and the bridge declares the
    # no-quota mode only at the END of its first tick. A bridge started again (the container made again by the switch onto
    # the full image) read «no mode yet» as «nothing to stop» and lifted a pause of a spent budget (giro Windows 16/11:
    # «cleared» at 2.05 $ of 2, then 2.81 $).
    budget = budget if budget is not None else team_budget.read(config)
    if budget is not None and now is not None:
        verdict = _budget_verdict(config, budget, spent, now, held_by_pace)
        if verdict:
            return verdict
    if not no_quota_mode:
        return {"action": "none"}  # with quota data the Sentinella paces by the windows and the daily cap
    eur, tokens = ceilings(config)
    if eur is None and tokens is None:
        return {"action": "none" if budget is not None else ("warn" if spent["calls"] else "none")}
    if eur is not None and spent["cost"] >= eur:
        return {"action": "halt", "why": "eur", "spent": spent["cost"], "ceiling": eur}
    if tokens is not None and spent["hour_tokens"] >= tokens:
        return {"action": "halt", "why": "tokens", "spent": spent["hour_tokens"], "ceiling": tokens}
    return {"action": "none"}


def _money(value):
    return ("%.2f" % value).rstrip("0").rstrip(".") if value < 100 else "%d" % value


def clock(moment, config, today=None):
    """HH:MM (zone name) in the person's zone; with the date in front when it is not today."""
    local = datetime.fromtimestamp(moment, team_budget.timezone_of(config))
    day = datetime.fromtimestamp(today, team_budget.timezone_of(config)).date() if today is not None else local.date()
    when = local.strftime("%H:%M") if local.date() == day else local.strftime("%Y-%m-%d %H:%M")
    zone = team_budget.timezone_of(config)
    return "%s (%s)" % (when, getattr(zone, "key", None) or local.tzname() or "UTC") if zone is not None else when


def user_text(verdict, spent, config=None, now=None):
    i18n = quota_data.shared_i18n()  # shared/i18n.py, found from the skills folder too

    if verdict["action"] == "warn":
        return i18n.tf("pi_cap.no_ceiling", "%s USD" % _money(spent["cost"]))
    if verdict["why"] == "credit":
        return i18n.tf("pi_cap.halt_credit", PROVIDER_NAMES.get(verdict["provider"], verdict["provider"] or "the provider"))
    if verdict["why"] == "budget":
        return i18n.tf("pi_cap.halt_budget", "%s USD" % _money(verdict["spent"]), "%s USD" % _money(verdict["usd"]))
    if verdict["why"] == "period":
        return i18n.tf("pi_cap.halt_period", clock(verdict["ends"], config, now), "%s USD" % _money(verdict["spent"]),
                       "%s USD" % _money(verdict["usd"]))
    if verdict["why"] == "pace":
        return i18n.tf("pi_cap.halt_pace", "%s USD" % _money(verdict["spent"]), "%s USD" % _money(verdict["usd"]),
                       clock(verdict["resumes"], config, now))
    if verdict["why"] == "eur":
        return i18n.tf("pi_cap.halt_eur", "%s USD" % _money(verdict["spent"]), "%s EUR" % _money(verdict["ceiling"]))
    return i18n.tf("pi_cap.halt_tokens", "%d" % verdict["spent"], "%d" % verdict["ceiling"])


def first_burst_progress(home):
    """(scored so far in the first burst, its target) while the burst is open and short of its target, else None.
    Read from the burst's own state file and the scores table, writing nothing; any reading that fails is None."""
    try:
        state = json.loads((Path(home) / "state" / "first-run.json").read_text(encoding="utf-8"))
        target = state.get("target_scored")
        if state.get("phase") != "burst" or isinstance(target, bool) or not isinstance(target, int) or target <= 0:
            return None
        conn = sqlite3.connect("file:%s?mode=ro" % (Path(home) / "jobs.db"), uri=True, timeout=5)
        try:
            scored = int(conn.execute("SELECT COUNT(DISTINCT position_id) FROM scores").fetchone()[0])
        finally:
            conn.close()
        produced = scored - int(state.get("scored_at_start") or 0)
        return (max(produced, 0), target) if produced < target else None
    except Exception:  # noqa: BLE001 - no reading, no sentence: the alert goes without it
        return None


def _budget_captain_text(verdict, config, now):
    if verdict["why"] == "budget":
        head, what, lift = ("BUDGET SPENT", "%s USD spent of the %s USD the person declared for the period"
                            % (_money(verdict["spent"]), _money(verdict["usd"])),
                            "It does NOT lift by itself: it lifts when the person sets a new budget (jht setup).")
    elif verdict["why"] == "period":
        head, what, lift = ("BUDGET PERIOD OVER", "the period the person declared ended at %s (%s USD spent of %s USD)"
                            % (clock(verdict["ends"], config, now), _money(verdict["spent"]), _money(verdict["usd"])),
                            "It does NOT lift by itself: it lifts when the person sets a new period (jht setup).")
    else:
        head = "BUDGET PACE"
        what = ("%s USD spent of %s USD, ahead of the pace (the share of the budget of the worked time gone by, one working "
                "hour ahead, allows %s USD by now)" % (_money(verdict["spent"]), _money(verdict["usd"]),
                                                        _money(verdict["ceiling"])))
        lift = "It lifts by itself at %s, when the worked time catches up." % clock(verdict["resumes"], config, now)
    return head, what, lift


def captain_text(verdict, spent, burst=None, config=None, now=None):
    if verdict["action"] == "warn":
        return ("[BRIDGE INFO] pi spent %s USD today (its own estimate) and no spending ceiling is declared "
                "(no_quota_cap in the configuration): this access has no quota data, so nothing else stops the "
                "spending. Tell the person once, in their language, if they have not been told." % _money(spent["cost"]))
    if verdict["why"] == "credit":
        return ("[BRIDGE ALERT] PROVIDER CREDIT GONE (pi harness): %s answered that the credit of the account is exhausted. "
                "The team is PAUSED: ESC to every session, no forced kill. This is a declared pause, not an outage and not "
                "FATAL. It lifts by itself when a call goes through again (the person tops up the account with the provider). "
                "Tell the person once, in their language." % PROVIDER_NAMES.get(verdict["provider"], verdict["provider"]))
    if verdict["why"] in ("budget", "period", "pace"):
        head, what, lift = _budget_captain_text(verdict, config, now)
        raise_it = "a new budget (jht setup)"
    else:
        head = "SPENDING CEILING REACHED"
        what = ("%s USD today against a ceiling of %s EUR" % (_money(verdict["spent"]), _money(verdict["ceiling"]))
                if verdict["why"] == "eur" else
                "%d tokens in the last hour against a ceiling of %d per hour" % (verdict["spent"], verdict["ceiling"]))
        lift = "It lifts by itself when the spending is back under the ceiling, or if the person raises it."
        raise_it = "raising the ceiling (no_quota_cap in the configuration)"
    return ("[BRIDGE ALERT] %s (pi harness): %s. The team is PAUSED: ESC to every session, no forced kill. This is a "
            "declared pause, not an outage and not FATAL. %s Tell the person once, in their language.%s" % (head, what, lift, (
                " The FIRST BURST is open and stops on this ceiling at %d of %d scored positions: say so in the chat, in "
                "their language: how many scored positions they have, and that %s lets the burst go on to %d."
                % (burst[0], burst[1], raise_it, burst[1])) if burst else ""))


def _flag(api):
    try:
        payload = json.loads(api._path("DAILY_HALT_FLAG").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _flag_reason(api):
    payload = _flag(api)
    return payload.get("reason") if payload else None


def _tell(api, run, key, text, user, notify_user):
    """The Captain and the Sentinella through the delivery notice, the person through the notifier. Each goes once per
    `key`: what did not go (a session absent, a notifier down) is tried again on the next tick, what went is not repeated."""
    from sentinel_delivery import notice

    done = run.state.setdefault("pi_spend_cap", {})
    for session in (api.CAPITANO_SESSION, api.SENTINELLA_SESSION):
        if not done.get("%s:%s" % (key, session)):
            done["%s:%s" % (key, session)] = bool(notice(api, run.state, "pi_cap:%s:%s" % (key, session), session, text))
    if not done.get(key):
        try:
            # one source id per notice: the tool refuses a second notice under the same id with another text (exit 2), so only
            # the first pause of a team was ever told to the person (giro Windows 16/11: «jht-notify-user failed with exit 2»)
            notify_user(user, "%s-%s" % (REASON, re.sub(r"[^A-Za-z0-9_.-]+", "-", key)))
            done[key] = True
        except Exception as error:  # noqa: BLE001 - not a reason to stop the tick
            print("[bridge V6] WARN pi spend cap user notice: %s" % error)


def _iso(moment, config):
    if moment is None:
        return None
    zone = team_budget.timezone_of(config)
    local = datetime.fromtimestamp(moment, zone) if zone is not None else datetime.fromtimestamp(moment).astimezone()
    return local.isoformat(timespec="seconds")


def _record(verdict, config):
    """What the flag says of the pause, for `jht team status`, `jht team start` and `jht doctor`."""
    record = {"why": verdict["why"], "spent": verdict["spent"], "ceiling": verdict["ceiling"]}
    if verdict["why"] in ("budget", "period", "pace"):
        record.update(budget_usd=verdict["usd"], starts_at=_iso(verdict["starts"], config),
                      ends_at=_iso(verdict["ends"], config), resumes_at=_iso(verdict["resumes"], config),
                      counts_from=int(verdict["counts_from"]))
        if verdict.get("before"):
            record["before_work"] = {"spent": verdict["before"], "budget_usd": verdict["usd"]}
    return record


def _halt_key(verdict, day):
    if verdict["why"] == "budget":
        return "halt:budget:%d" % int(verdict["counts_from"])
    if verdict["why"] == "period":
        return "halt:period:%d" % int(verdict["ends"])
    if verdict["why"] == "pace":
        return "halt:pace:%d" % int(verdict["resumes"] // 60)
    return "halt:%s:%s" % (day, verdict["why"])


def _halt(api, run, verdict, spent, day, notify_user, config=None, now=None, escape=True):
    """The gate first, then the ESC, then the words. The gate of the agents (spend-gate.js) reads the flag with this reason:
    written after the notices to the Captain and the Sentinella, which wait for the sessions, it came 23 s after the
    «reached» line, and the Captain made four more calls in between (giro Windows 16/11: 0.16 $). A Captain held by the gate
    does not read its notice; the person is told by the notifier, and the Captain by the notice of the resume."""
    record = _record(verdict, config)
    if escape:
        api._activate_daily_halt(100.0 * verdict["spent"] / verdict["ceiling"] if verdict["ceiling"] else 100.0, 100.0,
                                 100.0, extra={"reason": REASON, "pi_spend_cap": record})
    try:
        payload = json.loads(api._path("DAILY_HALT_FLAG").read_text(encoding="utf-8"))
        payload["reason"] = REASON
        payload["pi_spend_cap"] = record
        api._write_daily_halt_payload(payload)
    except (OSError, ValueError):
        pass
    print("[bridge V6] %s PI-SPEND-CEILING reached (%s: %s of %s): team paused"
          % (run.now_h, verdict["why"], verdict["spent"], verdict["ceiling"]))
    burst = first_burst_progress(api._path("JHT_HOME"))
    _tell(api, run, _halt_key(verdict, day), captain_text(verdict, spent, burst, config, now),
          user_text(verdict, spent, config, now), notify_user)


# A resume time that moves (spending after the pause: a turn already running, a welcome at `jht up`) is written in the flag
# at once, for `jht team status` and the chat; the person is told again when it moved by this much or the time they were told
# is already gone (giro Windows 16/11: «resumes at 14:58», still paused at 16:11, the brake reckoning 16:53).
RESUME_MOVED_SEC = 300


def _resume_moved(api, run, verdict, spent, day, notify_user, config, now, flag):
    """The flag says the resume time the brake reckons now; the person is told again when it moved RESUME_MOVED_SEC from the
    time they were told (`resumes_told_at`: small moves add up), or that time is gone. Never a second ESC."""
    record = flag.get("pi_spend_cap") or {}

    def moment(text):
        try:
            return datetime.fromisoformat(text).timestamp() if text else None
        except (TypeError, ValueError):
            return None

    new = verdict.get("resumes")
    if new is None:
        return
    written = moment(record.get("resumes_at"))
    told = moment(record.get("resumes_told_at") or record.get("resumes_at"))
    tell = told is None or abs(new - told) >= RESUME_MOVED_SEC or (told <= now and int(told // 60) != int(new // 60))
    if written is not None and int(written // 60) == int(new // 60) and not tell:
        return
    fresh = _record(verdict, config)
    fresh["resumes_told_at"] = fresh["resumes_at"] if tell else record.get("resumes_told_at") or record.get("resumes_at")
    flag["pi_spend_cap"] = fresh
    api._write_daily_halt_payload(flag)
    if tell:
        print("[bridge V6] %s PI-SPEND-CEILING pause moved: resumes %s (was %s)"
              % (run.now_h, fresh["resumes_at"], record.get("resumes_at")))
        _tell(api, run, _halt_key(verdict, day), captain_text(verdict, spent, None, config, now),
              user_text(verdict, spent, config, now), notify_user)


def _held_by_the_budget(flag, budget):
    """True when the flag is the pause of a spent budget or an ended period of THIS budget: it does not lift by itself, only a new
    budget (jht setup) lifts it. The verdict that raised it can stop being one with no new budget at all: the stop looks AHEAD
    at the pace of the last minutes, and a team that has stopped has no pace, so the next look finds 4.77 $ of 5 under the line
    and would clear it, the team would work again and stop a second time at 4.93 $ (giro Windows 16/11: 13:00 stop, 13:02 «cleared»,
    14 more calls). The budget is the same when the flag names the moment its dollars count from (`counts_from`); a flag written
    before that field is the same when it names the same dollars and the same start."""
    record = (flag or {}).get("pi_spend_cap") or {}
    if record.get("why") not in ("budget", "period") or budget is None:
        return False
    if record.get("counts_from") is not None:
        return int(record["counts_from"]) == int(budget["counts_from"])
    try:
        started = datetime.fromisoformat(record["starts_at"]).timestamp() if record.get("starts_at") else None
    except (TypeError, ValueError):
        return False
    return (started is not None and budget.get("starts") is not None and int(started) == int(budget["starts"])
            and record.get("budget_usd") == budget["usd"])


def _wake_the_team(api, sessions, why, seen=()):
    """[RIPRENDI] to every session the pause stopped, the moment the pause is lifted: they were ESC'd, and left to wait for the
    Sentinella's next cycle they stayed silent for a quarter of an hour (a VPS round: «allows work again» 18:31, the Scouts back at
    18:46). The Captain and the Sentinella have their own notice; a team the person stopped, a standby, and an agent the person
    paused alone are not woken here. Best effort: a session that does not answer is left to that next cycle, as before.

    A session BORN during the pause is not in the list the ESC wrote: its first message was held by the gate (`input` handled,
    nothing sent to the model, never delivered again), so it sat with nothing to do while the budget was back (an Analyst started
    by an update during the pause: 14 minutes, 0 calls, 13 positions waiting). The live agent sessions are asked too (`seen`: the
    sessions the bridge saw talking during the pause, and what tmux lists now), and those that were not in the list get a text
    that says their first message never reached them."""
    home = api._path("JHT_HOME")
    try:
        if (Path(home) / ".team-halted.flag").exists() or (Path(home) / ".team-standby.flag").exists():
            return []
        alone = set()
        try:
            import agent_pause
            alone = set(agent_pause.paused_sessions(home=home))
        except Exception:  # noqa: BLE001 - without the list nobody is held back by it
            pass
        text = ("[RIPRENDI] The pause is over (%s). Your session and context were never closed: pick up EXACTLY where you were, "
                "with the step you had in hand, and do not start over." % why)
        newcomer_text = ("[RIPRENDI] The pause is over (%s). The message that started you arrived DURING the pause and was held back: "
                         "it never reached you. If you have not started your work yet, start it now from your role instructions; "
                         "if you were in the middle of a step, pick up exactly there." % why)
        known = list(sessions or [])
        live = []
        try:
            lister = getattr(api, "list_tmux_sessions", None)
            live = [s for s in (lister() if lister else []) if _AGENT_SESSION.match(s or "")]
        except Exception:  # noqa: BLE001 - without the list only the sessions the ESC reached are woken, as before
            live = []
        extra = [s for s in list(seen or ()) + live if s not in known and _WORKER_SESSION.match(s or "")]
        woken = []
        for session in known + list(dict.fromkeys(extra)):
            if session in (api.CAPITANO_SESSION, api.SENTINELLA_SESSION) or session in alone or session in NEVER_WAKE:
                continue
            try:
                if api.jht_tmux_send(session, text if session in known else newcomer_text):
                    woken.append(session)
            except Exception as error:  # noqa: BLE001
                print("[bridge V6] WARN pi spend cap wake of %s: %s" % (session, error))
        return woken
    except Exception as error:  # noqa: BLE001 - a wake that fails must not stop the tick
        print("[bridge V6] WARN pi spend cap wake: %s" % error)
        return []


NEVER_WAKE = {"SENTINELLA-WORKER", "DOCTOR-WATCHDOG"}
_AGENT_SESSION = re.compile(r"^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$")   # the sessions of the team: CAPITANO, SCOUT-1, ANALISTA-5
# Born during the pause and not woken by the ESC list: only the workers (the fixed agents were there when it started)
_WORKER_SESSION = re.compile(r"^(SCOUT|ANALISTA|SCORER|SCRITTORE|CRITICO|CLOSER)(-S?\d+)?$")


def _resume(api, run, day, notify_user):
    i18n = quota_data.shared_i18n()

    flag = _flag(api) or {}
    was = (flag.get("pi_spend_cap") or {}).get("why")
    try:
        api._path("DAILY_HALT_FLAG").unlink()
    except OSError:
        return
    if was in ("budget", "period", "pace"):
        text = "[BRIDGE INFO] The budget the person declared allows work again: the team can resume; ticks are restarting."
        user = i18n.t("pi_cap.resume_budget")
    else:
        text = "[BRIDGE INFO] The pi spending ceiling allows work again: the team can resume; ticks are restarting."
        user = i18n.t("pi_cap.resume")
    # the gate is open (the flag is gone) BEFORE anyone is told to work: the order of the standby too
    woken = _wake_the_team(api, flag.get("sessions"), "the budget allows work again" if was in ("budget", "period", "pace") else "spending is back under the ceiling",
                        seen=list((flag.get("pane_signatures") or {}).keys()))
    _tell(api, run, "resume:%s:%d" % (day, int(api.time.time())), text, user, notify_user)
    print("[bridge V6] %s PI-SPEND-CEILING cleared: spending back under the ceiling%s" % (run.now_h, " · [RIPRENDI] to %s" % ", ".join(woken) if woken else ""))


def _start(home, budget, moment, run, api=None, spent_before=0.0):
    """The team started working: the period of a budget of a duration starts at that first call, and is written down so
    the next tick, `jht team status` and a restarted bridge find it. A write that fails is a warning: this tick still
    counts from it, the next one tries again. When the onboarding spent more than half the budget the Captain is told, to
    say it to the person: they gave the money for the search."""
    if api is not None and spent_before > budget["usd"] / 2:
        _tell_onboarding(api, run, budget, spent_before)
    try:
        starts, ends = team_budget.record_start(home, budget, moment, spent_before)
    except OSError as error:
        print("[bridge V6] WARN pi spend cap: the start of the budget is not written: %s" % error)
        starts, ends = moment, moment + budget["duration"]
    print("[bridge V6] %s BUDGET started by the first work of the team: %s to %s"
          % (run.now_h, datetime.fromtimestamp(starts).isoformat(timespec="seconds"),
             datetime.fromtimestamp(ends).isoformat(timespec="seconds")))
    return dict(budget, starts=starts, ends=ends)


def _tell_onboarding(api, run, budget, spent_before):
    from sentinel_delivery import notice

    left = max(budget["usd"] - spent_before, 0.0)
    text = ("[BRIDGE INFO] MOST OF THE BUDGET WENT TO THE ONBOARDING: %s USD of the %s USD budget were spent before the first "
            "Scout worked, %s USD are left for the search, spread over the period. Not a fault. Tell the person once, in their "
            "language, in plain words: how much the setup and the first talk cost, how much is left for the search, and that a "
            "larger budget (jht setup) gives the search more." % (_money(spent_before), _money(budget["usd"]), _money(left)))
    done = run.state.setdefault("pi_spend_cap", {})
    key = "onboarding:%s" % budget.get("saved_at")
    if not done.get(key):
        done[key] = bool(notice(api, run.state, "pi_cap:%s" % key, api.CAPITANO_SESSION, text))


def step(api, run, notify_user=None):
    """One tick of the brake. Never raises."""
    try:
        notify_user = notify_user or quota_data._notify_user  # resolved at call time, so a test can replace it
        now = api.time.time()
        home = api._path("JHT_HOME")
        config = api._read_config_json()
        budget = team_budget.read(config, home)
        spent = spend(home, now, budget["counts_from"] if budget else None, budget["starts"] if budget else None)
        if budget is not None and budget["starts"] is None and spent["first_worker"] is not None:
            budget = _start(home, budget, spent["first_worker"], run, api, spent.get("before_start") or 0.0)
        day = datetime.fromtimestamp(now).strftime("%Y-%m-%d")
        flag = _flag(api)
        mine = bool(flag) and flag.get("reason") == REASON
        held_by_pace = mine and (flag.get("pi_spend_cap") or {}).get("why") == "pace" and api._daily_halt_active()
        verdict = decide(config, spent, bool(run.state.get("no_quota_declared")), now, budget, held_by_pace)
        if verdict["action"] == "halt":
            if run._bi_on:
                print("[bridge V6] %s BURN-INTENT: pi spending ceiling reached, the team stays active (user override)"
                      % run.now_h)
                if mine:  # the gate of the agents (spend-gate.js) reads this flag: the person's override opens it
                    _resume(api, run, day, notify_user)
            elif not api._daily_halt_active():
                _halt(api, run, verdict, spent, day, notify_user, config, now)
            elif mine and (flag.get("pi_spend_cap") or {}).get("why") != verdict["why"]:
                # Already paused by this brake for another reason (the pace, and now the budget or the period is over):
                # the person and the Captain are told the new one, the flag says it; no second ESC.
                _halt(api, run, verdict, spent, day, notify_user, config, now, escape=False)
            elif mine and verdict["why"] == "pace":
                _resume_moved(api, run, verdict, spent, day, notify_user, config, now, flag)
        elif mine and (budget is not None or run.state.get("no_quota_declared")) and not _held_by_the_budget(flag, budget):
            # Lifted only by a tick that looked: without a budget and before the no-quota mode is declared (the first tick
            # of a bridge started again) the ceilings were not read, and «nothing to stop» is not «back under».
            _resume(api, run, day, notify_user)
        if verdict["action"] == "warn":
            _tell(api, run, "warn:%s" % day, captain_text(verdict, spent), user_text(verdict, spent), notify_user)
    except Exception as error:  # noqa: BLE001 - a brake that fails to read must not stop the Sentinella
        print("[bridge V6] WARN pi spend cap: %s" % error)
