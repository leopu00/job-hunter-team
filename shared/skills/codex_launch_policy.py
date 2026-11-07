"""Arguments for managed Codex TUIs; the pinned CLI supports both notice overrides."""
from __future__ import annotations

import argparse
import shlex

OVERRIDES = ("notice.hide_rate_limit_model_nudge=true", "check_for_update_on_startup=false")


def launch_args(model: str, effort: str, doc_max_bytes: int, *, repl=False) -> list[str]:
    args = ["--yolo"]
    if model:
        args += ["-m" if repl else "--model", model]
    args += ["-c", f"model_reasoning_effort={effort}", "-c", f"project_doc_max_bytes={doc_max_bytes}"]
    for override in OVERRIDES:
        args += ["-c", override]
    return args


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="")
    parser.add_argument("--effort", default="high")
    parser.add_argument("--doc-max-bytes", type=int, required=True)
    parser.add_argument("--command", action="store_true")
    args = parser.parse_args(argv)
    if args.doc_max_bytes <= 0:
        parser.error("doc-max-bytes must be positive")
    command = launch_args(args.model, args.effort, args.doc_max_bytes, repl=args.command)
    print(shlex.join((["codex"] if args.command else []) + command))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
