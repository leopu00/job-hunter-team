"""Test-only: placeholder PDFs pass the CV layout check in subprocess CLIs, and the broker's
register of authorisations answers as tests/fixtures/pdf_layout_pass/suite_notary.py says.

tests/conftest.py puts this directory on PYTHONPATH for the run, so a CLI the
suite spawns (`apply_gate.py queue`, `apply_request.py`) sees the same pass as
the in-process stub. Production code reads no variable for this: the switch
lives only in the test tree.
"""
import os
import sys

_SKILLS = os.path.join(os.path.dirname(__file__), "..", "..", "..", "shared", "skills")
sys.path.insert(0, os.path.abspath(_SKILLS))
try:
    import pdf_layout_check

    pdf_layout_check.analyze = lambda _path, **_kw: {"ok": True, "reasons": []}
except ImportError:
    pass
try:
    import apply_notary
    import suite_notary

    apply_notary.call = suite_notary.call
except ImportError:
    pass
finally:
    sys.path.remove(os.path.abspath(_SKILLS))
