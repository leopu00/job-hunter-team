"""Configurazione pytest per la suite Job Hunter Team QA."""
import os
import tempfile

import pytest


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "slow: test che creano risorse reali (venv, processi pesanti) — "
        "skippabili con pytest -m 'not slow'",
    )


# ── JHT_HOME isolato per l'intera sessione ──────────────────────────────
#
# Perché serve: le skill risolvono i loro path da `$JHT_HOME` con fallback su
# `~/.jht`, cioè sull'installazione REALE di chi lancia i test. Due conseguenze
# spiacevoli, entrambe viste dal vivo:
#
#   1. I test leggevano il profilo candidato vero della macchina. Da quando lo
#      Scorer ha il gate "niente profilo → niente score" (2026-07-24),
#      `db_insert.py score` passava in locale (profilo presente) e falliva in
#      CI (profilo assente): sei test rossi che non dicevano niente sul codice,
#      solo su chi li stava eseguendo. Emerso al primo giro del job pytest in
#      CI, il 2026-07-25.
#   2. Un test distratto potrebbe scrivere dentro `~/.jht` dell'utente.
#
# La fixture punta `JHT_HOME` a una directory temporanea che contiene un
# profilo candidato **minimo ma valido** (target_role + un secondo segnale: i
# due requisiti di shared/skills/profile_gate.py). Chi vuole testare il gate
# con un profilo assente o rotto sovrascrive `JHT_HOME` per conto suo — è
# quello che fa già tests/test_score_profile_gate.py.
_MINIMAL_PROFILE = """\
# Profilo minimo generato dalla suite di test (tests/conftest.py).
# Non è un profilo reale: serve solo a superare il gate minimo dello Scorer.
target_role: Backend Engineer
name: Test Candidate
location: Remote
skills:
  - python
  - sql
experience_years: 5
"""


@pytest.fixture(scope="session", autouse=True)
def isolated_jht_home():
    if os.environ.get("JHT_TESTS_KEEP_HOME") == "1":
        # Via di fuga per chi vuole deliberatamente girare contro la propria
        # installazione (debug di un caso reale).
        yield os.environ.get("JHT_HOME")
        return

    previous = os.environ.get("JHT_HOME")
    with tempfile.TemporaryDirectory(prefix="jht-tests-home-") as home:
        profile_dir = os.path.join(home, "profile")
        os.makedirs(profile_dir, exist_ok=True)
        with open(
            os.path.join(profile_dir, "candidate_profile.yml"),
            "w",
            encoding="utf-8",
        ) as f:
            f.write(_MINIMAL_PROFILE)
        os.environ["JHT_HOME"] = home
        try:
            yield home
        finally:
            if previous is None:
                os.environ.pop("JHT_HOME", None)
            else:
                os.environ["JHT_HOME"] = previous
