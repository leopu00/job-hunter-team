#!/usr/bin/env python3
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "..", ".."))

from shared.telegram_service.client import main  # noqa: E402

raise SystemExit(main(sys.argv[1:]))
