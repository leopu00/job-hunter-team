"""The credit of a provider is gone: told from what the provider answered, not guessed from a missing reply.

An API account that runs out of balance does not stop the agents: every call comes back as an error, the agent
retries, and the team looks alive while it does nothing. pi writes the answer of a failed call in its session
(`pi_sessions.error_events`); here the answers that mean «no more credit» are told from the rest:

  Kimi (Moonshot)  HTTP 429, «... suspended due to insufficient balance ...»
  GLM (Z.ai)       HTTP 429, business code 1113 written as `"code": "1113"` («Insufficient balance or no resource package. Please recharge.»)
  OpenAI           HTTP 429, `insufficient_quota` («You exceeded your current quota»)

A plain rate limit is a 429 too, and is NOT this: only these words count. The brake of the spending
(`pi_spend_cap.py`) uses `exhausted` to pause the team in a declared way, and lifts the pause when a call passes again;
the state of an agent (`agent_pi_log.py`) calls it «credito_esaurito» instead of a limit that frees itself.

Run as a script it prints, as JSON, what `exhausted` sees (or null): `jht doctor`, `jht team start` and `jht team send`
read it (cli/src/lib/provider-credit.js), so the person reads «top up the credit» where the team looks merely silent.

The refusal is the one of the service the team runs on: an answer of another provider than `active_provider` is not read.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time

# (provider as pi names it, the words). The first that matches names the provider; the provider pi wrote in the call
# wins when it is there (a proxy may answer with another vendor's words).
SIGNS = (
    ("moonshotai", re.compile(r"suspended due to insufficient balance", re.IGNORECASE)),
    ("zai", re.compile(r"""["']?code["']?\s*[:=]\s*["']?1113\b|insufficient balance or no resource package""", re.IGNORECASE)),
    ("openai", re.compile(r"insufficient_quota|exceeded your current quota", re.IGNORECASE)),
)
WINDOW_S = 30 * 60  # an answer older than this no longer says the credit is gone: the person may have topped it up
# The provider as the person knows it, by the name pi gives it.
PROVIDER_NAMES = {"moonshotai": "Kimi (Moonshot)", "zai": "GLM (Z.ai)", "openai": "OpenAI"}


def credit_gone(message: str) -> str | None:
    """The provider (as pi names it) whose «no credit» answer this is, or None for any other error."""
    text = message if isinstance(message, str) else ""
    for provider, pattern in SIGNS:
        if pattern.search(text):
            return provider
    return None


def _config_written(jht_home) -> float:
    """When jht.config.json was last written, or 0: a «no credit» answer older than that came before the person changed the service
    or the key (`jht setup`), so it is no verdict on the one the team runs on now. If the new one refuses too, its own answer is newer."""
    try:
        return os.stat(os.path.join(str(jht_home), "jht.config.json")).st_mtime
    except OSError:
        return 0.0


# The service the person chose (`active_provider` of jht.config.json) as pi names it; one that is not here (or no config) filters nothing.
ACTIVE_AS_PI = {"glm": "zai", "zai": "zai", "kimi": "moonshotai", "moonshot": "moonshotai", "moonshotai": "moonshotai",
                "openai": "openai", "codex": "openai", "claude": "anthropic", "anthropic": "anthropic"}


def _active_provider(jht_home) -> str | None:
    try:
        with open(os.path.join(str(jht_home), "jht.config.json"), encoding="utf-8") as handle:
            name = json.load(handle).get("active_provider")
        return ACTIVE_AS_PI.get(name.strip().lower()) if isinstance(name, str) else None
    except Exception:  # noqa: BLE001 - no readable config: no filter
        return None


def exhausted(jht_home, now_ts: float, window_s: float = WINDOW_S) -> dict | None:
    """`{provider, agent, ts}` of the newest «no credit» answer in the last `window_s` seconds that no call has passed
    since (a call that went through proves the credit is back), else None. Never raises: no reading is None."""
    try:
        import pi_sessions  # here, not at the top: agent_pi_log imports credit_gone also as shared.skills.provider_credit

        since = max(now_ts - window_s, _config_written(jht_home))
        active = _active_provider(jht_home)
        newest = None
        for event in pi_sessions.error_events(jht_home, since):
            provider = credit_gone(event["message"])
            if not provider:
                continue
            # an agent still on the old service (stopped late, or restarted by hand) can refuse AFTER the setup: that is the old
            # service's answer, not a verdict on the one the person chose, so it never pauses the team on the new one
            if active and (event["provider"] or provider) != active:
                continue
            newest = {"provider": event["provider"] or provider, "agent": event["agent"], "ts": event["ts"]}
        if newest is None:
            return None
        if any(call["ts"] > newest["ts"] and call["input"] + call["output"] + call["cache_read"] > 0
               for call in pi_sessions.usage_events(jht_home, newest["ts"])):
            return None
        return newest
    except Exception:  # noqa: BLE001 - a reading that fails is no verdict
        return None


def main(argv) -> int:
    """`provider_credit.py [--window SECONDS]`: the JSON of `exhausted` for $JHT_HOME, with `label`, or null."""
    window = WINDOW_S
    if len(argv) == 2 and argv[0] == "--window":
        try:
            window = max(60.0, float(argv[1]))
        except ValueError:
            return 2
    elif argv:
        return 2
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    home = os.environ.get("JHT_HOME") or os.path.expanduser("~/.jht")
    found = exhausted(home, time.time(), window)
    if found:
        found["label"] = PROVIDER_NAMES.get(found["provider"], found["provider"] or "the provider")
    print(json.dumps(found))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
