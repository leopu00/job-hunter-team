"""Providers that report no usage limits: «there is no quota data» is not «the reading failed».

The Sentinella paces the team on the rate-limit windows the provider reports. Some accesses report none and
never will: an API key (billed by the token, no window), a Codex pointed at another model provider (its status
says «Limits: data not available»). The bridge used to treat that like an outage, and an outage ends in the
FATAL cascade (L4 soft pause of the whole team). Here the two are told apart:

  structural  -> `no_quota_reason()` gives a reason; the loop declares the NO-QUOTA mode once, to the Captain and
                 to the person, and sends no `[BRIDGE FAILURE]`: nothing falls back, nothing pauses.
  transient   -> None; the failure path stays exactly as it was (fallback, FATAL if it lasts).

The mode only declares. It does not measure or stop spending: the ceiling is the one set with the provider for
the key, plus the guards that never depended on quota (host cap, SC-09, burn-intent). A user-declared ceiling
can be written in the config as `no_quota_cap` ({"eur": 10, "tokens_per_hour": 500000}) and is repeated in the
notice, so the person and the Captain read the same number.
"""

import json
import re
import subprocess
import time
from pathlib import Path

NO_QUOTA_PREFIX = "no_quota_data:"
RECENT_ROLLOUT_SEC = 30 * 60
ROLLOUT_TAIL_BYTES = 200_000
CODEX_PROVIDERS = ("openai", "codex")
_MODEL_PROVIDER = re.compile(r'^\s*model_provider\s*=\s*"([^"]*)"', re.MULTILINE)


def _auth_method(config, provider):
    providers = config.get("providers") if isinstance(config, dict) else None
    entry = providers.get(str(provider).lower()) if isinstance(providers, dict) else None
    return entry.get("auth_method") if isinstance(entry, dict) else None


def _custom_model_provider(sessions_dir):
    """Codex's config.toml names a model provider that is not OpenAI (GLM, Kimi...): no ChatGPT rate limits there."""
    try:
        text = (Path(sessions_dir).parent / "config.toml").read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False
    found = _MODEL_PROVIDER.search(text)
    return bool(found) and found.group(1).strip().lower() not in ("", "openai")


def _day_dirs(sessions_dir, now):
    """Codex writes sessions/YYYY/MM/DD: only today's and yesterday's folders (UTC and local) are looked at, never the whole history."""
    days = set()
    for moment in (now, now - 86400):
        for convert in (time.gmtime, time.localtime):
            t = convert(moment)
            days.add(Path(sessions_dir) / ("%04d" % t.tm_year) / ("%02d" % t.tm_mon) / ("%02d" % t.tm_mday))
    return sorted(days)


def _limits_of(payload):
    """True when the event carries a rate_limits of ANY non-empty shape. The shape is Codex's to change, so it is not
    parsed: a reading we cannot understand is still data that exists, and a failed fetch then stays an outage."""
    return bool(payload.get("rate_limits") or (payload.get("info") or {}).get("rate_limits"))


def _recent_rollout_without_limits(sessions_dir, now):
    """The newest rollout is alive and reports token counts, and NONE of its recent events carries a (non-empty) rate_limits:
    Codex works and reports no limits. One event with a reading is enough to say the data exists, so a failed fetch stays an outage."""
    newest = None
    try:
        for day in _day_dirs(sessions_dir, now):
            for path in day.glob("rollout-*.jsonl"):
                try:
                    mtime = path.stat().st_mtime
                except OSError:
                    continue
                if newest is None or mtime > newest[0]:
                    newest = (mtime, path)
        if newest is None or now - newest[0] > RECENT_ROLLOUT_SEC:
            return False
        with newest[1].open("rb") as handle:
            handle.seek(0, 2)
            handle.seek(max(0, handle.tell() - ROLLOUT_TAIL_BYTES))
            tail = handle.read().decode("utf-8", errors="replace")
    except OSError:
        return False
    counted = False
    for line in tail.splitlines():
        if '"token_count"' not in line and '"rate_limits"' not in line:
            continue
        try:
            payload = (json.loads(line) or {}).get("payload") or {}
        except ValueError:
            continue
        if not isinstance(payload, dict):
            continue
        if _limits_of(payload):
            return False
        counted = counted or payload.get("type") == "token_count"
    return counted


def no_quota_reason(provider, config, sessions_dir, now):
    """Why this access has no quota data, or None when the missing reading may be an outage."""
    if _auth_method(config, provider) == "api_key":
        return "api_key"
    if str(provider).lower() in CODEX_PROVIDERS and sessions_dir is not None:
        if _custom_model_provider(sessions_dir):
            return "custom_model_provider"
        if _recent_rollout_without_limits(sessions_dir, now):
            return "no_rate_limits_in_rollouts"
    return None


def classify_failure(api, provider, fail_reason):
    """`fail_reason` of a failed fetch, replaced by a NO_QUOTA_PREFIX reason when the data cannot exist.
    Never raises: when the config or the rollouts cannot be read the old reason stays (the outage path)."""
    try:
        config = api._read_config_json()
        sessions = api._path("CODEX_SESSIONS_DIR")
        why = no_quota_reason(provider, config, sessions, api.time.time())
    except Exception:  # noqa: BLE001 - unreadable evidence is not proof of a structural gap
        return fail_reason
    return NO_QUOTA_PREFIX + why if why else fail_reason


def _declared_ceiling(config):
    cap = config.get("no_quota_cap") if isinstance(config, dict) else None
    if not isinstance(cap, dict):
        return ""
    parts = []
    if isinstance(cap.get("eur"), (int, float)) and not isinstance(cap.get("eur"), bool) and cap["eur"] > 0:
        parts.append("%g EUR" % cap["eur"])
    tph = cap.get("tokens_per_hour")
    if isinstance(tph, (int, float)) and not isinstance(tph, bool) and tph > 0:
        parts.append("%d tokens/hour" % int(tph))
    return "; ".join(parts)


def captain_text(reason, ceiling=""):
    """What the Captain reads: a state, not a request. English, like the other [BRIDGE ...] lines."""
    text = (
        "[BRIDGE INFO] NO-QUOTA MODE (reason=%s): this provider reports no rate-limit data. This is NOT an outage: "
        "the Sentinella will not run the fallback, declare FATAL, soft-pause or freeze the team for missing data, and "
        "a burn-intent in force is not cancelled by it. Pacing by quota is off; the host cap, SC-09 and the daily halt "
        "still apply. Spending is bounded only by the ceiling set with the provider for this key"
        % reason
    )
    text += " (declared: %s)." % ceiling if ceiling else " (no ceiling declared in the configuration)."
    return text + " Tell the person once, in their language, if they have not been told."


def user_text(ceiling=""):
    import i18n  # shared/i18n.py: same language as the shell, the CLI and the bridges

    return i18n.tf("quota_mode.noquota", ceiling or i18n.t("quota_mode.no_ceiling"))


def _notify_user(text, reason):
    candidates = ["/app/agents/_tools/jht-notify-user",
                  str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user")]
    executable = next((c for c in candidates if Path(c).is_file()), None)
    if not executable:
        raise RuntimeError("jht-notify-user is unavailable")
    done = subprocess.run(
        [executable, "--agent", "capitano", "--kind", "alert", "--source-id", "no-quota-mode-" + reason,
         "--source-action", "no_quota_mode_notice", "--source-payload", json.dumps({"reason": reason}), text],
        check=False, capture_output=True, text=True, timeout=60)
    if done.returncode != 0:
        raise RuntimeError("jht-notify-user failed with exit %d" % done.returncode)


def declare(api, run, notify_user=None):
    """Declares the mode once per reason, to the Captain and to the person. A notice that does not go is retried next tick."""
    from sentinel_delivery import notice

    notify_user = notify_user or _notify_user  # resolved at call time, so a test can replace it
    reason = str(run.fail_reason)[len(NO_QUOTA_PREFIX):]
    state = run.state
    try:
        ceiling = _declared_ceiling(api._read_config_json())
    except Exception:  # noqa: BLE001
        ceiling = ""
    done = state.setdefault("no_quota_declared", {})
    if reason != done.get("reason"):
        done.clear()
        done["reason"] = reason
        print("[bridge V6] NO-QUOTA MODE: %s; no failure cascade" % reason)
    if not done.get("captain"):
        done["captain"] = bool(notice(api, state, "no_quota:captain", api.CAPITANO_SESSION,
                                      captain_text(reason, ceiling)))
    if not done.get("user"):
        try:
            notify_user(user_text(ceiling), reason)
            done["user"] = True
        except Exception as error:  # noqa: BLE001 - not a reason to stop the tick
            print("[bridge V6] WARN no-quota user notice: %s" % error)


def clear(state):
    """Real data is back: the next structural gap is declared again."""
    state.pop("no_quota_declared", None)
