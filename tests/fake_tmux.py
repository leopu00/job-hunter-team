"""The one fake `tmux` for the tests that run a real script against a terminal.

The transport (`jht-tmux-send`), the mail nudge, the chat bridge and the
watchdog all talk to tmux through the same public commands: `load-buffer` and
`paste-buffer` to type text, `send-keys Enter` to submit it, `capture-pane` to
read the screen back.  Five test files used to carry their own copy of that
contract, and a change to the transport (the move from `send-keys -l` to a
buffered paste) had to be made five times.  This module keeps it in one place.

A test builds a `FakeTmux`, puts its `bin` first in the PATH of the process
under test (`env()`), and reads back what happened:

    tmux = FakeTmux(tmp_path / "fake", {"SCOUT-1": {"submit": "ok"}})
    run(..., env=tmux.env(home))
    tmux.typed("SCOUT-1")        # every text pasted into the pane, in order
    tmux.draft("SCOUT-1")        # what is still in the composer
    tmux.calls("send-keys")      # every call, as its argument list

Sessions are plain dicts, kept in `state.json`; a test can change one while
the process under test runs (`configure`).  The fields of a session:

    created      what `#{session_created}` answers
    cmd          what `#{pane_current_command}` answers (default "claude")
    pane_pid     what `#{pane_pid}` answers
    draft        the text waiting in the composer
    transcript   the lines the conversation already holds
    submit       how the CLI treats Enter:
                   "ok"          it submits the draft at the first Enter
                   "needs_space" it ignores Enter until a Space has been sent
                   "needs_retry" it ignores the first Enter and takes the second
                   "frozen"      it takes nothing while a draft is waiting
    lost_paste   True: `paste-buffer` answers 0 but the text never appears
    busy         True: the screen shows a working CLI, with no composer at all
    screen       a line shown above the composer (a banner, a menu question)
    composer_extra  text shown after the draft inside the composer row
    prompt       the glyph of the composer row (default "❯")
    style        "claude" (a framed composer) or "codex" (a bare `›` row
                 that wraps after `width` columns, with the model line below)
    width        the codex wrap column (default 200)
    tail         if set, capture-pane returns only the last `tail` characters
    options      the session options `show-options` answers (`@jht_harness`)

`any_session=True` makes every target exist: an unknown name is created on
first use as an empty, idle pane.  Without it, an unknown target is what real
tmux says it is: an error.  `panes` is the process table `list-panes -a`
prints, as `(pid, session)` pairs.

`send-keys -l` is refused with exit 86: the inline path is retired, and a fake
that accepted it would let a test pass while the transport went back to it.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# The executable.  It is run by `#!/usr/bin/env python3`, with the standard
# library only, and keeps its whole state in $FAKE_TMUX_STATE/state.json under
# a lock, so two tmux calls from different processes never lose an update.
SCRIPT = r'''#!/usr/bin/env python3
import fcntl, json, os, sys

DIR = os.environ["FAKE_TMUX_STATE"]
STATE = os.path.join(DIR, "state.json")


def load():
    with open(STATE) as f:
        return json.load(f)


def save(s):
    tmp = STATE + ".%d" % os.getpid()
    with open(tmp, "w") as f:
        json.dump(s, f)
    os.replace(tmp, STATE)


def target(a):
    # Like tmux: `=NAME` and `=NAME:` are the EXACT name.  A bare name would
    # prefix-match in the real tmux; this fake does not reproduce that.
    t = a[a.index("-t") + 1] if "-t" in a else ""
    if t.startswith("="):
        t = t[1:].split(":", 1)[0]
    return t


def flat(text):
    # The visible row is soft-wrapped by the TUI: the line breaks of the draft
    # are not drawn.  `typed` keeps the original bytes.
    return text.replace("\n", "")


def render(sess):
    transcript = list(sess.get("transcript", []))
    if sess.get("busy"):
        return "Working… (esc to interrupt)\n" + "\n".join(transcript)
    lines = ([sess["screen"]] if sess.get("screen") else []) + transcript
    draft = flat(sess.get("draft", ""))
    if sess.get("style") == "codex":
        # OpenAI Codex: the composer is opened by "›"; past `width` columns the
        # text wraps onto an indented row, so the tail of the message (the
        # sender's probe) stays far from the marker whatever its length.  The
        # model line closes the pane.
        width = sess.get("width", 200)
        lines += ["› " + draft[:width]] + (["  " + draft[width:]] if len(draft) > width else [])
        lines += ["", "  gpt-5.6-sol high · ~/agents/capitano"]
        return "\n".join(lines)
    row = "│ %s %s%s │" % (sess.get("prompt", "❯"), draft, sess.get("composer_extra", ""))
    lines += ["╭" + "─" * 46 + "╮", row, "╰" + "─" * 46 + "╯", "  ? for shortcuts"]
    return "\n".join(lines)


def fmt(text, name, sess):
    return (text.replace("#{session_name}", name)
                .replace("#{session_created}", str(sess.get("created", 0)))
                .replace("#{pane_pid}", str(sess.get("pane_pid", 0)))
                .replace("#{pane_current_command}", sess.get("cmd", "claude")))


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else ""
    stdin = sys.stdin.buffer.read().decode("utf-8", "surrogateescape") if cmd == "load-buffer" else ""
    with open(os.path.join(DIR, "lock"), "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        s = load()
        s.setdefault("calls", []).append(args)
        rc, out = run(s, cmd, args, stdin)
        save(s)
    if out:
        sys.stdout.buffer.write((out if out.endswith("\n") else out + "\n").encode("utf-8", "surrogateescape"))
        sys.stdout.buffer.flush()
    sys.exit(rc)


def run(s, cmd, args, stdin):
    t = target(args)
    sess = s["sessions"].get(t)
    if sess is None and s.get("any_session") and t and cmd != "kill-session":
        sess = s["sessions"][t] = {}

    if cmd == "has-session":
        return (0 if sess is not None else 1), ""

    if cmd == "list-sessions":
        f = args[args.index("-F") + 1] if "-F" in args else "#{session_name}"
        return 0, "\n".join(fmt(f, n, v) for n, v in s["sessions"].items())

    if cmd == "list-panes":
        f = args[args.index("-F") + 1] if "-F" in args else ""
        if "-a" in args:
            # The process table: which pane belongs to which pid.
            return 0, "\n".join(f.replace("#{pane_pid}", str(pid)).replace("#{session_name}", name)
                                for pid, name in s.get("panes", []))
        if sess is None:
            return 1, ""
        return 0, fmt(f, t, sess)

    if cmd == "display-message":
        if sess is None:
            return 1, ""
        return 0, fmt(args[-1], t, sess)

    if cmd == "show-options":
        if sess is None:
            return 1, ""
        return 0, sess.get("options", {}).get(args[-1], "")

    if cmd == "capture-pane":
        if sess is None:
            return 1, ""
        shown = render(sess)
        return 0, shown[-sess["tail"]:] if sess.get("tail") else shown

    if cmd == "load-buffer":
        # The transport pastes through a tmux buffer, so a message is never
        # exposed in send-keys' argv.
        name = args[args.index("-b") + 1] if "-b" in args else ""
        s.setdefault("buffers", {})[name] = stdin
        return 0, ""

    if cmd == "paste-buffer":
        if sess is None:
            return 1, ""
        name = args[args.index("-b") + 1] if "-b" in args else ""
        buffers = s.setdefault("buffers", {})
        if name not in buffers:
            return 1, ""
        content = buffers[name]
        if "-d" in args:
            del buffers[name]
        if not sess.get("lost_paste"):
            sess["draft"] = sess.get("draft", "") + content
            s.setdefault("typed", []).append([t, content])
        return 0, ""

    if cmd == "kill-session":
        s["sessions"].pop(t, None)
        return 0, ""

    if cmd == "send-keys":
        if sess is None:
            return 1, ""
        # The buffered path is the contract: no inline text counts as a
        # delivery, or this fake would hide a return to `send-keys -l`.
        if "-l" in args:
            return 86, ""
        if sess.get("submit") == "frozen" and sess.get("draft"):
            return 0, ""   # takes nothing: no Enter, no Space, no text
        key = args[-1]
        if key == "Space":
            sess["draft"] = sess.get("draft", "") + " "
            sess["last_key"] = "Space"
        elif key == "Enter":
            mode = sess.get("submit", "ok")
            sess["enter_count"] = sess.get("enter_count", 0) + 1
            taken = (mode == "ok"
                     or (mode == "needs_space" and sess.get("last_key") == "Space")
                     or (mode == "needs_retry" and sess["enter_count"] >= 2))
            if taken and sess.get("draft"):
                prefix = "› " if sess.get("style") == "codex" else "> "
                sess.setdefault("transcript", []).append(prefix + sess["draft"])
                sess["draft"] = ""
            sess["last_key"] = "Enter"
        elif key == "C-u":
            sess["draft"] = ""
            sess["last_key"] = "C-u"
        else:
            sess["last_key"] = key
        return 0, ""

    return 0, ""


main()
'''


class FakeTmux:
    """The handle a test keeps on a fake tmux: its sessions, its calls, its PATH."""

    def __init__(self, root: Path, sessions: dict | None = None, *,
                 any_session: bool = False, panes: list | None = None):
        self.root = Path(root)
        self.bin = self.root / "bin"
        self.bin.mkdir(parents=True, exist_ok=True)
        self.state_dir = self.root / "tmuxstate"
        self.state_dir.mkdir(parents=True, exist_ok=True)
        self.exe = self.bin / "tmux"
        self.exe.write_text(SCRIPT, encoding="utf-8")
        self.exe.chmod(0o755)
        self.write({"sessions": sessions or {}, "calls": [], "buffers": {}, "typed": [],
                    "any_session": any_session, "panes": [list(p) for p in (panes or [])]})

    @property
    def state_file(self) -> Path:
        return self.state_dir / "state.json"

    def write(self, state: dict) -> None:
        self.state_file.write_text(json.dumps(state), encoding="utf-8")

    def read(self) -> dict:
        return json.loads(self.state_file.read_text(encoding="utf-8"))

    def sessions(self) -> dict:
        return self.read()["sessions"]

    def draft(self, name: str) -> str:
        return self.read()["sessions"][name].get("draft", "")

    def set_panes(self, panes: list) -> None:
        """The process table `list-panes -a` prints: `(pid, session)` pairs."""
        state = self.read()
        state["panes"] = [list(p) for p in panes]
        self.write(state)

    def configure(self, name: str, **fields) -> None:
        """Change a session between two runs, creating it when it is not there."""
        state = self.read()
        state["sessions"].setdefault(name, {}).update(fields)
        self.write(state)

    def typed(self, session: str | None = None) -> list:
        """Every text pasted into a pane, in order; None for all the panes."""
        return [text for name, text in self.read()["typed"] if session is None or name == session]

    def calls(self, cmd: str | None = None, session: str | None = None) -> list:
        out = []
        for call in self.read()["calls"]:
            if cmd and (not call or call[0] != cmd):
                continue
            if session and ("-t" not in call or call[call.index("-t") + 1] != session):
                continue
            out.append(call)
        return out

    def calls_text(self) -> str:
        """The calls as one line each, the way `echo "$@"` in a shell fake logged them."""
        return "\n".join(" ".join(call) for call in self.read()["calls"])

    def env(self, home: Path, *, restricted_path: bool = False, **extra) -> dict:
        """The environment of a process that must find this tmux first.

        `restricted_path` leaves no PATH but the interpreter's folder and the
        system's: for a script that must never reach another tmux on the machine.
        """
        env = os.environ.copy()
        if restricted_path:
            env["PATH"] = f"{self.bin}:{Path(sys.executable).parent}:/usr/bin:/bin"
        else:
            env["PATH"] = f"{self.bin}:{env['PATH']}"
        env["FAKE_TMUX_STATE"] = str(self.state_dir)
        env["JHT_HOME"] = str(home)
        env.update({k: str(v) for k, v in extra.items()})
        return env
