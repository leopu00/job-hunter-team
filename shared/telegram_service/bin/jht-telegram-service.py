#!/usr/bin/env python3
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "..", ".."))

from shared.telegram_service.server import serve  # noqa: E402

raise SystemExit(serve())
