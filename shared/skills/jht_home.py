"""Resolve the current team's home and relative paths only when called."""
import os
from pathlib import Path

from delivery_context import Context


PATH_SPECS = {
    "agent_pause": {
        "JHT_HOME": "",
        "LOG": "logs/agent-pauses.jsonl",
    },
    "burn_intent": {
        "JHT_HOME": "",
        "INTENT_FLAG": ".burn-intent.flag",
        "AUDIT_LOG": "logs/burn-intent.jsonl",
        "NOTICES_FILE": ".burn-intent-notices.json",
    },
    "burst": {
        "JHT_HOME": "",
        "CONFIG_FILE": "jht.config.json",
        "STATE_FILE": ".burst.json",
        "AUDIT_LOG": "logs/burst.jsonl",
    },
    "captain_diary": {
        "JHT_HOME": "",
        "DIARY_DIR": "logs",
    },
    "first_run": {
        "JHT_HOME": "",
        "STATE_PATH": "state/first-run.json",
        "LAUNCHABLE_PATH": "state/first-run-launchable.json",
        "NUDGE_PATH": "state/first-run-nudge.json",
    },
    "host_vitals": {
        "DEFAULT_FILE": "logs/vitals.jsonl",
        "DISK_NOTICE_FILE": "logs/disk-notice.json",
    },
    "pace_guard": {
        "JHT_HOME": "",
        "DATA_JSONL": "logs/sentinel-data.jsonl",
    },
    "rate_budget": {
        "JHT_HOME": "",
        "DATA_JSONL": "logs/sentinel-data.jsonl",
    },
    "standby": {
        "JHT_HOME": "",
        "STANDBY_FLAG": ".team-standby.flag",
        "STANDBY_LOG": "logs/standby.jsonl",
        "HALTED_FLAG": ".team-halted.flag",
        "SENTINEL_JSONL": "logs/sentinel-data.jsonl",
    },
    "usage_record": {
        "JHT_HOME": "",
        "LOGS_DIR": "logs",
        "DATA_JSONL": ("LOGS_DIR", "sentinel-data.jsonl"),
    },
    "window_ratio_meter": {
        "JHT_HOME": "",
        "LOGS_DIR": "logs",
        "SENTINEL_JSONL": ("LOGS_DIR", "sentinel-data.jsonl"),
        "STATE_FILE": ("LOGS_DIR", "window-ratio-state.json"),
        "CONFIG_FILE": "jht.config.json",
        "LOCK_FILE": ("LOGS_DIR", "window-ratio-meter.lock"),
    },
    "sentinel-bridge": {
        "JHT_HOME": "",
        "CONFIG_PATH": "jht.config.json",
        "LOGS_DIR": "logs",
        "VITALS_FILE": ("LOGS_DIR", "vitals.jsonl"),
        "DATA_JSONL": ("LOGS_DIR", "sentinel-data.jsonl"),
        "LOG_TXT": ("LOGS_DIR", "sentinel-log.txt"),
        "PID_FILE": ("LOGS_DIR", "sentinel-bridge.pid"),
        "LOCK_FILE": ("LOGS_DIR", "sentinel-bridge.lock"),
        "STATE_FILE": ("LOGS_DIR", "sentinel-bridge-state.json"),
        "DAILY_HALT_FLAG": ("LOGS_DIR", "daily-halt.flag"),
        "PACING_STATE_FILE": ("LOGS_DIR", "pacing-bridge-state.json"),
        "HARDSTOP_OVERRIDE_STATE_FILE": ("LOGS_DIR", "daily-hardstop-override.json"),
        "CODEX_SESSIONS_DIR": ".codex/sessions",
        "CODEX_READING_FILE": ("LOGS_DIR", "codex-plan-reading.json"),
        "CLAUDE_CREDENTIALS": ".claude/.credentials.json",
        "CLAUDE_429_COOLDOWN_FILE": ("LOGS_DIR", "claude-429-cooldown"),
        "WEEKLY_RESET_CACHE_FILE": ("LOGS_DIR", "weekly-reset-cache.json"),
        "KIMI_CREDENTIALS": ".kimi/credentials/kimi-code.json",
        "LAST_TICK_FILE": ("LOGS_DIR", "last-tick.txt"),
        "ROLE_USAGE_FILE": ("LOGS_DIR", "role-usage.json"),
    },
}

def jht_home(env=None, *, fallback=None, empty_is_unset=True, paths=None, key=None):
    """Keep explicit empty mappings and each caller's existing fallback policy.

    Path specifications contain only relative strings or (parent_key, leaf)
    pairs. An explicit absolute path remains absolute, including test failures.
    No environment, home lookup or filesystem operation happens at import.
    """
    if (paths is None) != (key is None):
        raise ValueError("paths and key must be supplied together")
    parts, visited = [], set()
    while key is not None:
        if key in visited:
            raise ValueError("cyclic team path specification")
        visited.add(key)
        value = paths[key]
        if isinstance(value, tuple) and len(value) == 2:
            key, leaf = value
            parts.append(leaf)
        else:
            parts.append(value)
            break
    source = os.environ if env is None else env
    relative = Path().joinpath(*reversed(parts))
    if relative.is_absolute():
        return relative
    value = source.get("JHT_HOME")
    if value is None or (empty_is_unset and not value):
        base = Path.home() / ".jht" if fallback is None else Path(fallback)
    else:
        base = Path(value)
    return base / relative


class RuntimePathContext(Context):
    """Keep namespace writes live while resolving configured paths on access."""

    def __init__(self, namespace, paths, resolver):
        super().__init__(namespace)
        object.__setattr__(self, "_paths", paths)
        object.__setattr__(self, "_resolver", resolver)

    def __getattr__(self, name):
        return self._resolver(name) if name in self._paths else super().__getattr__(name)

    def __setattr__(self, name, value):
        if name in self._paths:
            self._paths[name] = value
        else:
            super().__setattr__(name, value)
