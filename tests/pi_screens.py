"""Screens of Pi's TUI (`--tui-mode regular`, 120 columns) as tmux captures them, for the tests of F6.

Shaped like the live captures of Pi 1.5.0 in tmux (09/11/2026): the rules, the
composer between them, the folder row and the totals row. Folder, model and numbers are made up.
"""
RULE = "─" * 120
WORKING = "── ⠹ Working " + "─" * 105
FOLDER = "/jht_home/agents/scout-1"
TOTALS = "↑827 ↓5 $0.002 0.3%/272k (auto)" + " " * 69 + "gpt-5.6-terra • low"
STARTUP = [
    " ▀▀█  v1.5.0",
    " █▀ █ escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more",
    " Press ctrl+o to show full startup help and loaded resources.",
    "",
    " Warning: tmux extended-keys is off. Modified Enter keys may not work.",
    "",
]


def screen(draft=(), *, busy=False, above=STARTUP, folder=(FOLDER,), totals=TOTALS, top=None):
    """The pane: what is above, the top rule (with the label while a turn runs), the draft rows, the bottom rule,
    the folder row(s) and the totals row."""
    rows = list(above) + [top or (WORKING if busy else RULE)] + (list(draft) or [""]) + [RULE] + list(folder) + [totals]
    return "\n".join(rows) + "\n"


def selector(rows, *, above=STARTUP):
    """A selector in place of the composer (/login, /model, the trust dialog): the choices, the keys line, then the
    bottom rule, the folder and the totals; no top rule of its own."""
    return "\n".join(list(above) + list(rows) + [" ↑↓ navigate  enter select  escape/ctrl+c cancel", RULE, FOLDER, TOTALS]) + "\n"


LOGIN = [" → Sign in with an account", "   Sign in with an API key", "   Sign in with Radius • not configured"]
TRUST = [" Trust project folder?", " This allows pi to load .pi settings and resources, install missing project packages, and execute"
         " project extensions.", " → Trust", "   Trust parent folder", "   Do not trust"]
NO_KEY = [" Error: No API key found for openai.", " Use /login to log into a provider via OAuth or API key. See:"]
RETRYING = "── ⠼ Retrying (1/3) in 1s... (escape to cancel) " + "─" * 70
