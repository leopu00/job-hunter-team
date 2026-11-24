"""sync_switch.py — one answer to «is the website sync on?», the twin of shared/cloud/sync-switch.js.

The Node helper and this one answer the same question on the same inputs, with the same reasons;
tests/fixtures/sync-switch-cases.json holds the cases both read. The checks of the box that read
cloud.json (sync_health, process_health, cloud_token, cloud_sync_notice) ask here instead of
copying the rule, which is how cloud_token.py once missed it.

Inputs: `config` is cloud.json already read (a dict, or None when the file is absent, unreadable
or not an object); `env` is a mapping holding JHT_CLOUD_SYNC.

Precedence, in this order:
  1. JHT_CLOUD_SYNC == "0" (trimmed)  → off, reason "env-off" (wins over everything)
  2. JHT_CLOUD_SYNC == "1" (trimmed)  → on only with a token: "env-on", else "env-no-token"
     (it never turns the sync on without a token, and does not look at `enabled`)
  3. any other value (absent, empty, "true", "off", "2"…) is ignored and the file decides:
     - not an object                          → off, "absent"
     - `enabled` is the boolean true          → on, "file-enabled" (the token is not required
                                                here: the token checks stay with the callers)
     - else with a non-empty string paused_at → off, "paused"
     - else                                   → off, "disabled"

This module only reads: it never writes cloud.json.
"""
from __future__ import annotations

import json
import os

ENV_NAME = "JHT_CLOUD_SYNC"
REASONS = frozenset({"env-off", "env-on", "env-no-token", "file-enabled", "paused", "disabled", "absent"})


def has_token(config) -> bool:
    return isinstance(config, dict) and isinstance(config.get("token"), str) and config["token"].strip() != ""


def sync_switch(config, env=None) -> dict:
    """{"active": bool, "reason": str} for a cloud.json already read and an environment."""
    env = os.environ if env is None else env
    raw = env.get(ENV_NAME)
    choice = raw.strip() if isinstance(raw, str) else None
    if choice == "0":
        return {"active": False, "reason": "env-off"}
    if choice == "1":
        return {"active": True, "reason": "env-on"} if has_token(config) else {"active": False, "reason": "env-no-token"}
    if not isinstance(config, dict):
        return {"active": False, "reason": "absent"}
    if config.get("enabled") is True:
        return {"active": True, "reason": "file-enabled"}
    paused_at = config.get("paused_at")
    if isinstance(paused_at, str) and paused_at != "":
        return {"active": False, "reason": "paused"}
    return {"active": False, "reason": "disabled"}


def read_config(home: str):
    """cloud.json of `home` as a dict, or None for a file that is absent, odd or unreadable."""
    try:
        with open(os.path.join(home, "cloud.json"), encoding="utf-8") as handle:
            config = json.load(handle)
    except (OSError, ValueError):
        return None
    return config if isinstance(config, dict) else None
