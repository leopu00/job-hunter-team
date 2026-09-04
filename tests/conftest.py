"""Configurazione pytest per la suite Job Hunter Team QA."""
import os
import shutil
import subprocess
import tempfile

import pytest


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "slow: test che creano risorse reali (venv, processi pesanti) — "
        "skippabili con pytest -m 'not slow'",
    )


# ── Un bash che ESEGUE davvero, non solo che esiste ─────────────────────
#
# Perché serve: su un host Windows con WSL installato, il primo `bash` del PATH
# è `C:\WINDOWS\system32\bash.EXE`, cioè il launcher di WSL. Avviato da un
# processo Windows quel bash parte, stampa, e supera qualunque controllo di
# presenza — ma non riesce a forkare: la command substitution torna vuota, le
# redirezioni su file non creano niente, e i binari esterni non vengono
# eseguiti restituendo comunque rc 0. Un test comportamentale che ci gira
# sopra non fallisce perché il codice è rotto: fallisce perché l'interprete
# non ha eseguito niente. Osservato dal vivo: `jht_timeout 1 sleep 5` che
# risponde `rc=0` dopo 0 secondi e fa concludere che il tetto non scatta,
# mentre con git-bash gli stessi test sono verdi.
#
# È la stessa lezione già pagata da questo repo due volte — la fixture
# `isolated_jht_home` qui sotto, e la nota nel `.gitattributes` sui `.tsx`:
# «un gate che sembra rosso qui e verde in CI è il modo migliore per imparare
# a non fidarsi del gate». Un rosso fantasma vale meno di zero.
#
# La sonda quindi non chiede "esiste un bash?" ma "questo bash esegue?", e lo
# chiede in un modo che il launcher WSL non può superare per sbaglio: un
# marker su stdout non basterebbe (`echo` è un builtin e funziona anche là).
# Servono tre cose insieme, tutte rotte nel caso WSL: una command
# substitution che sopravvive al fork, un file scritto e riletto, e un binario
# esterno il cui exit code arriva indietro.
_BASH_PROBE = r"""
d="$(mktemp -d)" || exit 1
[ -n "$d" ] || exit 1
printf ok >"$d/probe" || exit 1
[ "$(cat "$d/probe")" = ok ] || exit 1
/bin/sh -c 'exit 7'
[ "$?" -eq 7 ] || exit 1
rm -rf "$d" 2>/dev/null || true
echo JHT-BASH-CAPABLE
"""

_BASH_CACHE = {}


def _bash_candidates():
    """I bash da provare, in ordine di preferenza e senza duplicati.

    `JHT_TEST_BASH` è la via di fuga: chi sa quale interprete vuole lo impone
    senza dipendere dall'ordine del PATH.
    """
    seen = set()
    for candidate in _raw_bash_candidates():
        if not candidate:
            continue
        key = os.path.normcase(os.path.abspath(candidate))
        if key in seen or not os.path.isfile(candidate):
            continue
        seen.add(key)
        yield candidate


def _raw_bash_candidates():
    yield os.environ.get("JHT_TEST_BASH")
    yield shutil.which("bash")
    # Ogni altro bash del PATH: il primo può essere il launcher WSL e il
    # secondo quello buono.
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if not entry:
            continue
        for name in ("bash.exe", "bash"):
            yield os.path.join(entry, name)
    # Git for Windows porta il suo bash ma non sempre lo mette in PATH.
    # Derivato dall'installazione di git invece che scritto a mano: un path
    # assoluto hardcoded sarebbe specifico di una macchina.
    git = shutil.which("git")
    if git:
        git_root = os.path.dirname(os.path.dirname(git))
        for relative in (("bin", "bash.exe"), ("usr", "bin", "bash.exe")):
            yield os.path.join(git_root, *relative)


def _is_capable(bash: str) -> bool:
    if bash in _BASH_CACHE:
        return _BASH_CACHE[bash]
    try:
        result = subprocess.run(
            [bash, "-c", _BASH_PROBE],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=30,
        )
        capable = "JHT-BASH-CAPABLE" in (result.stdout or "")
    except (OSError, subprocess.SubprocessError):
        capable = False
    _BASH_CACHE[bash] = capable
    return capable


@pytest.fixture(scope="session")
def any_bash():
    """Un bash qualsiasi, per ciò che NON richiede il fork (`bash -n`).

    La verifica sintattica legge un file e non esegue niente, quindi funziona
    anche col launcher WSL: gatarla sulla capacità di eseguire farebbe perdere
    copertura reale dove copertura ce n'è.
    """
    for candidate in _bash_candidates():
        return candidate
    pytest.skip("nessun bash trovato su questo host")


@pytest.fixture(scope="session")
def capable_bash():
    """Un bash che esegue davvero, per i test comportamentali.

    Skip esplicito — non fallimento — se nessun candidato passa la sonda: un
    host senza un interprete utilizzabile non è una regressione del codice
    sotto test.
    """
    # Un override che punta a un path inesistente non deve essere ignorato in
    # silenzio: chi lo ha impostato crederebbe di stare testando con quello.
    override = os.environ.get("JHT_TEST_BASH")
    if override and not os.path.isfile(override):
        pytest.skip(f"JHT_TEST_BASH punta a un path inesistente: {override}")
    tried = []
    for candidate in _bash_candidates():
        if _is_capable(candidate):
            return candidate
        tried.append(candidate)
    pytest.skip(
        "nessun bash in grado di eseguire comandi esterni "
        f"(provati: {tried or 'nessuno'}); su Windows il `bash` del PATH puo' "
        "essere il launcher WSL, che non forka se avviato da un processo "
        "Windows. Imponi un interprete con JHT_TEST_BASH=<path>."
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
