"""websockify for the broker's login view, with the token kept out of its log.

websockify logs, at its default level, `Path: '/websockify?token=…'` for
every WebSocket connection, and a refused lookup as `Token '…' not found`.
view.py already sends its output to /dev/null; this launcher also makes the
log itself carry no token, so a redirect changed by mistake, or a version of
websockify that logs more, still writes none (review note on the login view).

Every log record is rewritten when it is created: a query string becomes
`?[redacted]` and a quoted token `Token '[redacted]'`. Then websockify's own
entry point runs with the same arguments:

    python3 -m broker.view_ws --token-plugin broker.view_token.OneShot \
        --token-source <run dir> 0.0.0.0:6081
"""

from __future__ import annotations

import logging
import re
import sys

_QUERY = re.compile(r"\?[^\s'\"]*")
_QUOTED_TOKEN = re.compile(r"(?i)(token\s*)'[^']*'")


def redact(text: str) -> str:
    return _QUOTED_TOKEN.sub(r"\1'[redacted]'", _QUERY.sub("?[redacted]", text))


def install() -> None:
    """Rewrite every log record at creation, whatever handler gets it.
    Idempotent."""
    previous = logging.getLogRecordFactory()
    if getattr(previous, "_jht_redacting", False):
        return

    def factory(*args, **kwargs):
        record = previous(*args, **kwargs)
        try:
            text = record.getMessage()
        except Exception:  # a malformed record: drop its arguments, keep the format
            text = str(record.msg)
        clean = redact(text)
        if clean != text or record.args:
            record.msg, record.args = clean, None
        return record

    factory._jht_redacting = True
    logging.setLogRecordFactory(factory)


# At import too, but only as websockify's own program: it serves each
# connection in a multiprocessing child, and where the start method is not
# fork (macOS; Linux from Python 3.14) the child imports this module again,
# as `__mp_main__`, instead of inheriting what `main()` did. Any other
# importer (a test, a tool) keeps its logging untouched.
if __name__ in ("__main__", "__mp_main__"):
    install()


def main() -> None:
    install()
    from websockify.websocketproxy import websockify_init

    sys.argv[0] = "websockify"
    websockify_init()


if __name__ == "__main__":
    main()
