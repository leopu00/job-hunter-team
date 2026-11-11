"""Pi (`@earendil-works/pi-coding-agent`) session logs, reduced to the events agent_state folds.

  Pi  $JHT_HOME/.pi/agent/sessions/--<cwd, leading / dropped, / \\ : as ->--/<time>_<id>.jsonl
      (PI_CODING_AGENT_DIR is $JHT_HOME/.pi/agent, .launcher/spawn-lib.sh jht_pi_agent_dir)

The file is a tree of entries, one JSON object per line, `timestamp` ISO on every
entry but the header (docs/session-format.md of the pinned Pi). Pi writes NO turn
markers: a turn is read from the messages themselves.

  user message                       turn_start (a prompt, or one queued during a turn)
  assistant, stopReason toolUse      activity   (the turn goes on with the tool results)
  toolResult                         activity
  assistant, stopReason stop|length  activity + turn_end   (no tool call left: the model is done)
  assistant, any other stopReason    activity
  assistant, stopReason aborted      turn_end   (the user pressed Esc)
  assistant, stopReason error        blocked + turn_end  (Pi retries a transient error: the next
                                     message of the same turn lifts the block, see agent_state.fold)
                                     reason: rete | limite_fornitore | accesso_scaduto (401, «No API key»
                                     inside a run) | errore_fornitore
Before a run starts Pi refuses a prompt without a key or a login ON THE SCREEN only (agent_session.prompt throws
before the user message is written): such an agent has no event and stays «avviato_mai_partito».

Header, model_change, thinking_level_change, usage, compaction, labels and the
entries of extensions say nothing about work and give no event. Pi has no
approval prompt, so there is no approval event.

How full the context is: the tokens of the last call that answered (`usage.totalTokens`).
Pi does not write the model's window in the session, so the share is not known (None),
as for Claude.
"""
import re
from pathlib import Path

PI_TYPES = frozenset({
    "session", "message", "model_change", "thinking_level_change", "usage", "compaction",
    "context_edit", "branch_summary", "custom", "custom_message", "label", "session_info",
})
# The credentials, not the quota: Pi records the provider's 401 (or its own «No API key» / «Authentication failed»
# when a call inside a run cannot get its key); before a run starts the same errors are only on the screen.
_AUTH = re.compile(r"No API key|Authentication fail|\b401\b|invalid[_ ]authentication|invalid[_ ]api[_ ]key|"
                   r"api key appears to be invalid|incorrect api key|unauthori[sz]ed|"
                   r"credentials? (?:may have )?expired|token (?:has )?expired|token expired or incorrect", re.I)
_LIMIT = re.compile(r"usage limit|rate.?limit|\b429\b|quota|too many requests|hit your limit", re.I)
_NETWORK = re.compile(
    r"connection error|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|socket|network|timed out|reach the API", re.I)
HEADER_BYTES = 65536


def sessions_root(src) -> Path:
    """Same folder as jht_pi_agent_dir in .launcher/spawn-lib.sh, plus Pi's own `sessions`."""
    return src.home / ".pi" / "agent" / "sessions"


def pi_slug(cwd: str) -> str:
    """Pi's name for the folder of a cwd (getDefaultSessionDirPath in session-manager.js)."""
    return "--" + re.sub(r"[/\\:]", "-", re.sub(r"^[/\\]", "", cwd)) + "--"


def session_cwd(state, path: Path):
    """The cwd the header of a session file records, None when there is no readable header."""
    with path.open(encoding="utf-8", errors="replace") as handle:
        head = next(state._objects([handle.readline(HEADER_BYTES)]), {})
    cwd = head.get("cwd") if head.get("type") == "session" else None
    return cwd if isinstance(cwd, str) else None


def session_files(state, src, cwd: str, since: float):
    """The newest session files of this cwd, by what their header says and not only by the folder's name
    (`/a/b-c` and `/a/b/c` share a name)."""
    root = sessions_root(src) / pi_slug(cwd)
    if not root.is_dir():
        return []
    # a header that cannot be read does not exclude the file (a future format is then "not understood", not "never started")
    return [p for p in state._newer(root.glob("*.jsonl"), since)[:4] if session_cwd(state, p) in (None, cwd)][:2]


def block_reason(text) -> str:
    text = text if isinstance(text, str) else ""
    if _AUTH.search(text):
        return "accesso_scaduto"
    if _LIMIT.search(text):
        return "limite_fornitore"
    return "rete" if _NETWORK.search(text) else "errore_fornitore"


def parse_pi(state, lines):
    out = state.Parsed()
    for e in state._objects(lines):
        out.lines += 1
        kind = e.get("type")
        if kind in PI_TYPES:
            out.recognised += 1
        ts = state._iso(e.get("timestamp"))
        msg = e.get("message") if isinstance(e.get("message"), dict) else {}
        if ts is None or kind != "message":
            continue
        role = msg.get("role")
        if role == "user":
            out.events.append(state.Ev(ts, "turn_start"))
        elif role == "toolResult":
            out.events.append(state.Ev(ts, "activity"))
        elif role == "assistant":
            stop = msg.get("stopReason")
            if stop == "error":
                out.events.append(state.Ev(ts, "blocked", reason=block_reason(msg.get("errorMessage"))))
                out.events.append(state.Ev(ts, "turn_end"))
                continue
            # an answer is work too: after a retried error it is what lifts the block
            if stop != "aborted":
                out.events.append(state.Ev(ts, "activity"))
            if stop in ("stop", "length", "aborted"):
                out.events.append(state.Ev(ts, "turn_end"))
            usage = msg.get("usage")
            if stop != "aborted" and isinstance(usage, dict):
                # a call that answered with no count (0) is no reading
                out.context = state._context(ts, usage.get("totalTokens") or None) or out.context
    return out
