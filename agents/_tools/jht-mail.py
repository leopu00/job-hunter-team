#!/usr/bin/env python3
"""jht-mail: the mailbox of an agent (JHT-T09). Messages are files, and every one has a receipt.

    jht-mail send <agent> [--kind URG] [--wait N]    (the text on stdin)
    jht-mail drain                                    (what an agent runs first in every turn)
    jht-mail recent [N]   jht-mail ack <id>   jht-mail status <agent> <id>   jht-mail pending

The logic lives in shared/skills/jht_mail.py; this is the command that lands on the agents' PATH.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def load_mail():
    candidates = (
        Path("/app/shared/skills/jht_mail.py"),
        Path(__file__).resolve().parents[2] / "shared" / "skills" / "jht_mail.py",
    )
    for candidate in candidates:
        if not candidate.exists():
            continue
        spec = importlib.util.spec_from_file_location("jht_mail_lib", candidate)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    raise RuntimeError("jht_mail.py not found")


if __name__ == "__main__":
    sys.exit(load_mail().main())
