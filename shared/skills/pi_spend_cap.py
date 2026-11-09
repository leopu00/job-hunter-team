"""A spending brake for the agents on the pi harness: the cost pi measures, against the ceiling the person declared.

An access with no quota data (an API key, or a team made only of pi agents: see quota_data.py) has no 5h or weekly
window to pace by, so nothing stopped the spending but the ceiling set with the provider. pi writes the cost of every
call in its session files (pi_sessions.py), so the spending is now measured. Here it is compared, on every tick of the
Sentinella, with the ceiling the config declares:

  "no_quota_cap": {"eur": 10, "tokens_per_hour": 500000}

  eur               what pi spent TODAY (local day). pi prices in dollars and the figure is compared as it is, one to
                    one: a little early, never late. It is pi's own cost per call (its prices are OpenAI's, the long-context tier is not in it) plus the web search fee.
  tokens_per_hour   what pi's agents processed or produced in the last hour: input, cache writes, output (a cache
                    read is a tenth of the price and is left out).

  below the ceiling    nothing.
  at the ceiling       a DECLARED pause: the Captain and the person are told, the daily-halt flag is raised (ESC to
                       every session, no forced kill, the same brake the daily cap uses), tagged with its reason. It is
                       lifted by the same tick that sees the spending back under the ceiling (the next day for `eur`,
                       less than an hour later for `tokens_per_hour`) or when a burn-intent is in force. Not a FATAL.
  no ceiling declared  the person is told once a day how much pi spent and that nothing stops it.

It runs only in the NO-QUOTA mode (the ceiling is called `no_quota_cap` for that reason): with quota data the windows and
the daily cap pace the team, and they would lift this pause as if it were theirs.

Nothing here raises into the tick: a reading that fails is a warning in the log and the tick goes on.
"""

from __future__ import annotations

import json
import math
from datetime import datetime

import pi_sessions
import quota_data

REASON = "pi_spend_cap"


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


def spend(home, now_ts):
    """What pi spent: `cost` today (dollars: pi's estimate plus the fee of the web searches), `hour_tokens` in the last hour,
    `calls` today."""
    start, hour = day_start(now_ts), now_ts - 3600
    out = {"cost": 0.0, "hour_tokens": 0, "calls": 0}
    since = min(start, hour)
    for event in pi_sessions.usage_events(home, since):
        if event["ts"] >= start:
            out["cost"] += event["cost"]
            out["calls"] += 1
        if event["ts"] >= hour:
            out["hour_tokens"] += event["input"] + event["cache_write"] + event["output"]
    for event in pi_sessions.search_events(home, since):  # the fee of a search call, which pi does not price
        if event["ts"] >= start:
            out["cost"] += event["cost"]
    out["cost"] = round(out["cost"], 6)
    return out


def decide(config, spent, no_quota_mode):
    """{"action": "none" | "halt" | "warn", ...}. Pure: a config and a measure in, a verdict out."""
    if not no_quota_mode:
        return {"action": "none"}  # with quota data the Sentinella paces by the windows and the daily cap
    eur, tokens = ceilings(config)
    if eur is None and tokens is None:
        return {"action": "warn" if spent["calls"] else "none"}
    if eur is not None and spent["cost"] >= eur:
        return {"action": "halt", "why": "eur", "spent": spent["cost"], "ceiling": eur}
    if tokens is not None and spent["hour_tokens"] >= tokens:
        return {"action": "halt", "why": "tokens", "spent": spent["hour_tokens"], "ceiling": tokens}
    return {"action": "none"}


def _money(value):
    return ("%.2f" % value).rstrip("0").rstrip(".") if value < 100 else "%d" % value


def user_text(verdict, spent):
    import i18n  # shared/i18n.py: the language of the shell, the CLI and the other bridges

    if verdict["action"] == "warn":
        return i18n.tf("pi_cap.no_ceiling", "%s USD" % _money(spent["cost"]))
    if verdict["why"] == "eur":
        return i18n.tf("pi_cap.halt_eur", "%s USD" % _money(verdict["spent"]), "%s EUR" % _money(verdict["ceiling"]))
    return i18n.tf("pi_cap.halt_tokens", "%d" % verdict["spent"], "%d" % verdict["ceiling"])


def captain_text(verdict, spent):
    if verdict["action"] == "warn":
        return ("[BRIDGE INFO] pi spent %s USD today (its own estimate) and no spending ceiling is declared "
                "(no_quota_cap in the configuration): this access has no quota data, so nothing else stops the "
                "spending. Tell the person once, in their language, if they have not been told." % _money(spent["cost"]))
    what = ("%s USD today against a ceiling of %s EUR" % (_money(verdict["spent"]), _money(verdict["ceiling"]))
            if verdict["why"] == "eur" else
            "%d tokens in the last hour against a ceiling of %d per hour" % (verdict["spent"], verdict["ceiling"]))
    return ("[BRIDGE ALERT] SPENDING CEILING REACHED (pi harness): %s. The team is PAUSED: ESC to every session, no "
            "forced kill. This is a declared pause, not an outage and not FATAL. It lifts by itself when the spending "
            "is back under the ceiling, or if the person raises it. Tell the person once, in their language." % what)


def _flag_reason(api):
    try:
        payload = json.loads(api._path("DAILY_HALT_FLAG").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload.get("reason") if isinstance(payload, dict) else None


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
            notify_user(user, REASON)
            done[key] = True
        except Exception as error:  # noqa: BLE001 - not a reason to stop the tick
            print("[bridge V6] WARN pi spend cap user notice: %s" % error)


def _halt(api, run, verdict, spent, day, notify_user):
    _tell(api, run, "halt:%s:%s" % (day, verdict["why"]), captain_text(verdict, spent), user_text(verdict, spent),
          notify_user)
    api._activate_daily_halt(100.0 * verdict["spent"] / verdict["ceiling"], 100.0, 100.0)
    try:
        payload = json.loads(api._path("DAILY_HALT_FLAG").read_text(encoding="utf-8"))
        payload["reason"] = REASON
        payload["pi_spend_cap"] = {"why": verdict["why"], "spent": verdict["spent"], "ceiling": verdict["ceiling"]}
        api._write_daily_halt_payload(payload)
    except (OSError, ValueError):
        pass
    print("[bridge V6] %s PI-SPEND-CEILING reached (%s: %s of %s): team paused"
          % (run.now_h, verdict["why"], verdict["spent"], verdict["ceiling"]))


def _resume(api, run, day, notify_user):
    import i18n

    try:
        api._path("DAILY_HALT_FLAG").unlink()
    except OSError:
        return
    text = "[BRIDGE INFO] The pi spending ceiling allows work again: the team can resume; ticks are restarting."
    _tell(api, run, "resume:%s:%d" % (day, int(api.time.time())), text, i18n.t("pi_cap.resume"), notify_user)
    print("[bridge V6] %s PI-SPEND-CEILING cleared: spending back under the ceiling" % run.now_h)


def step(api, run, notify_user=None):
    """One tick of the brake. Never raises."""
    try:
        notify_user = notify_user or quota_data._notify_user  # resolved at call time, so a test can replace it
        now = api.time.time()
        spent = spend(api._path("JHT_HOME"), now)
        verdict = decide(api._read_config_json(), spent, bool(run.state.get("no_quota_declared")))
        day = datetime.fromtimestamp(now).strftime("%Y-%m-%d")
        mine = _flag_reason(api) == REASON
        if verdict["action"] == "halt":
            if run._bi_on:
                print("[bridge V6] %s BURN-INTENT: pi spending ceiling reached, the team stays active (user override)"
                      % run.now_h)
            elif not api._daily_halt_active():
                _halt(api, run, verdict, spent, day, notify_user)
        elif mine:
            _resume(api, run, day, notify_user)
        if verdict["action"] == "warn":
            _tell(api, run, "warn:%s" % day, captain_text(verdict, spent), user_text(verdict, spent), notify_user)
    except Exception as error:  # noqa: BLE001 - a brake that fails to read must not stop the Sentinella
        print("[bridge V6] WARN pi spend cap: %s" % error)
