"""Closed search-error catalog, private runtime logging and pass-log outcomes."""
from __future__ import annotations

import os
import stat
import sys
from urllib.parse import urlparse
from datetime import datetime, timezone
from pathlib import Path

# One catalog for the command's JSON, stderr and runtime.log; never exception text.
ERRORS = {
    "scout_search_timeout": ("blocked", "The job source did not answer in time."),
    "scout_search_network": ("blocked", "The job source could not be reached."),
    "scout_search_forbidden": ("closed", "The job source refused access."),
    "scout_search_gone": ("gone", "The job search endpoint is no longer available."),
    "scout_search_server": ("blocked", "The job source answered with a server error."),
    "scout_search_challenge": ("closed", "The job source requires a human access check."),
    "scout_search_unrecognized": ("blocked", "The job source returned an unrecognized search page."),
    "scout_search_http": ("blocked", "The job source answered with an unexpected HTTP status."),
    "scout_search_log_unavailable": ("blocked", "The search outcome could not be recorded."),
}
ERROR_EXIT = 4


class SearchSourceError(RuntimeError):
    def __init__(self, results: list, outcome: dict):
        super().__init__(outcome["code"])
        self.results = results
        self.outcome = outcome


def _runtime_line(code: str, message: str) -> None:
    path = Path(os.environ.get("JHT_HOME", "/jht_home")) / "logs" / "runtime.log"
    line = f"{datetime.now(timezone.utc).isoformat()} {code}: {message}\n".encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK
    fd = os.open(path, flags, 0o600)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise OSError("not a regular log")
        if os.write(fd, line) != len(line):
            raise OSError("short log write")
    finally:
        os.close(fd)


def failure(code: str, http_status: int | None = None) -> dict:
    status, message = ERRORS[code]
    print(f"{code}: {message}", file=sys.stderr)
    try:
        _runtime_line(code, message)
    except OSError:
        log_code = "scout_search_log_unavailable"
        print(f"{log_code}: {ERRORS[log_code][1]}", file=sys.stderr)
    result = {"search_outcome": True, "source": "linkedin", "status": status,
              "code": code, "message": message}
    if http_status is not None:
        result["http_status"] = http_status
    return result


def exception_outcome(exc: Exception) -> dict:
    from requests.exceptions import Timeout
    return failure("scout_search_timeout" if isinstance(exc, Timeout) else "scout_search_network")


def response_outcome(response) -> dict | None:
    status = response.status_code
    if status == 200:
        body = response.text.casefold()
        path = urlparse(getattr(response, "url", "")).path
        challenges = ("<title>sign in", "<title>security verification",
                      "g-recaptcha", "cf-chl-", "verify you are human", "just a moment...")
        if path.startswith(("/authwall", "/checkpoint", "/login")) or any(marker in body for marker in challenges):
            return failure("scout_search_challenge", status)
        return None
    code = {403: "forbidden", 410: "gone"}.get(status, "server" if 500 <= status < 600 else "http")
    return failure(f"scout_search_{code}", status)


def record_pass(args, results: list, outcome: dict | None) -> dict | None:
    """Called only for --log; the command, not the model, maps errors to coverage."""
    import scout_pass_log as log
    status = outcome["status"] if outcome and outcome.get("search_outcome") else "ok" if results else "empty"
    if outcome and outcome.get("rate_limited"):
        status = "blocked"
    argv = ["pass", "--source", "linkedin", "--country", args.country,
            "--query-kind", args.query_kind, "--query", args.keywords,
            "--returned", str(len(results)), "--status", status]
    if args.agent:
        argv += ["--agent", args.agent]
    try:
        row = log.build(log.parser().parse_args(argv))
        if not log.append(row):
            return failure("scout_search_log_unavailable")
    except (OSError, ValueError):
        return failure("scout_search_log_unavailable")
    return None
