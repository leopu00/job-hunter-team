#!/usr/bin/env python3
"""jht-broker — the agents' client of the portal-secrets broker; `serve` runs it."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", ".."))

from broker.client import main  # noqa: E402

sys.exit(main(sys.argv[1:]))
