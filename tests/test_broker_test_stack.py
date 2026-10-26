"""The stack the broker's live test starts has everything the broker imports.

No container here: this reads the broker's sources and the pins, so it runs
(and goes red with a name) on any machine, where the live test itself needs an
engine.  See tests/broker_live_stack.py for the history.
"""

from broker_live_stack import DISTRIBUTIONS, IMPORTS, requirements_text, third_party_imports


def test_every_third_party_import_of_the_broker_is_in_the_live_test_stack():
    missing = {name: files for name, files in third_party_imports().items() if name not in IMPORTS}
    assert not missing, (
        "shared/broker imports modules the live test's container does not install: "
        + ", ".join(f"{name} (in {', '.join(sorted(set(files)))})" for name, files in missing.items())
        + ". Add them to IMPORTS and DISTRIBUTIONS in tests/broker_live_stack.py "
        "(with a pinned, hashed entry in tests/requirements-app-ci.txt)."
    )


def test_the_stack_does_not_list_an_import_the_broker_no_longer_makes():
    gone = [name for name in IMPORTS if name not in third_party_imports()]
    assert not gone, f"tests/broker_live_stack.py lists {', '.join(gone)}, which shared/broker does not import any more"


def test_every_distribution_of_the_stack_is_pinned_with_hashes():
    text = requirements_text()
    for name in DISTRIBUTIONS:
        assert f"\n{name}==" in "\n" + text, name
    assert text.count("--hash=sha256:") >= len(DISTRIBUTIONS)
    assert all(IMPORTS[name] in DISTRIBUTIONS for name in IMPORTS)
