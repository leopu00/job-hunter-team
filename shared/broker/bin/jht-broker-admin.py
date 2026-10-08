#!/usr/bin/env python3
"""jht-broker-admin — host-only commands of the broker, reached by exec."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", ".."))

from broker.admin import main  # noqa: E402

sys.exit(main(sys.argv[1:]))
