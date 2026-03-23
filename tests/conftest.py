"""Configurazione pytest per la suite Job Hunter Team QA."""
import pytest


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "slow: test che creano risorse reali (venv, processi pesanti) — "
        "skippabili con pytest -m 'not slow'",
    )
