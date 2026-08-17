"""La locale di SISTEMA del container è dichiarata, e nello stesso modo ovunque.

Origine: 2026-08-10 (O-38). Nel container `LANG` era vuota, glibc derivava
`LC_CTYPE=POSIX` e chi si attaccava a un pane da fuori
(`docker exec -it jht tmux attach`) vedeva `_` al posto di ogni lettera
accentata. I dati erano sani — nel buffer la «è» era 0xC3 0xA8 — ma un pane
illeggibile è un pane che nessuno legge.

Perché un test e non solo la riga nel compose:

1. **Il nome inganna.** Nel compose esisteva già `JHT_LANG`, che è la lingua del
   PRODOTTO (en|it) scelta al wizard. Chi legge di fretta trova «LANG» dentro
   «JHT_LANG» e conclude che la locale c'è. Qui le due variabili sono asserite
   separatamente: cancellare `LANG` lasciando `JHT_LANG` fa fallire il test.

2. **I compose sono DUE.** Quello del repo (scaricato da `install.sh` e
   riscaricato da `jht upgrade`, quindi vale per la flotta VPS e per le
   installazioni CLI) e il payload che il GIOCO scrive sul disco dell'utente
   desktop (`game/scripts/backend/payloads/runtime_compose.yml`, copia
   funzionale del primo). Correggerne uno solo lascia metà utenti col difetto:
   il test li tiene allineati sullo STESSO valore.

Eseguire:
    pytest tests/test_container_locale.py -v
"""

import os
import re

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

COMPOSES = {
    'docker-compose.yml': os.path.join(REPO_ROOT, 'docker-compose.yml'),
    'runtime_compose.yml (payload del gioco)': os.path.join(
        REPO_ROOT, 'game', 'scripts', 'backend', 'payloads', 'runtime_compose.yml'),
}

# `- LANG=...` nella lista environment. Il `-\s*` e il confine iniziale sono ciò
# che impedisce a `JHT_LANG=it` di passare per la locale di sistema.
LANG_RE = re.compile(r'^\s*-\s*LANG=(\S+)\s*$', re.MULTILINE)
JHT_LANG_RE = re.compile(r'^\s*-\s*JHT_LANG=(\S+)\s*$', re.MULTILINE)


def _read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def test_ogni_compose_dichiara_una_locale_utf8():
    for name, path in COMPOSES.items():
        found = LANG_RE.findall(_read(path))
        assert found, (
            f"{name}: manca `- LANG=...` nella sezione environment. Senza, "
            "LC_CTYPE resta POSIX e i pane si vedono con `_` al posto delle accentate."
        )
        assert len(found) == 1, f"{name}: LANG dichiarata {len(found)} volte"
        assert 'utf-8' in found[0].lower() or 'utf8' in found[0].lower(), (
            f"{name}: LANG={found[0]} non è una locale UTF-8"
        )


def test_lang_e_jht_lang_restano_due_variabili_distinte():
    """`JHT_LANG` (lingua del prodotto) non sostituisce `LANG` (locale di sistema).

    La trappola del ticket: chi «vede LANG» dentro `JHT_LANG` potrebbe rinominare
    l'una nell'altra credendo di semplificare. Sono due cose diverse — una la
    sceglie l'utente al wizard fra en|it, l'altra è neutra e vale per tutte e 7
    le lingue del prodotto.
    """
    for name, path in COMPOSES.items():
        text = _read(path)
        assert JHT_LANG_RE.search(text), f"{name}: sparita JHT_LANG (lingua del prodotto)"
        assert LANG_RE.search(text), f"{name}: sparita LANG (locale di sistema)"


def test_i_due_compose_dichiarano_la_stessa_locale():
    """Il payload del gioco è una copia funzionale del compose del repo: una locale
    diversa fra i due significherebbe desktop e VPS che rendono i pane in modo
    diverso, cioè il difetto risolto per metà degli utenti."""
    valori = {name: LANG_RE.findall(_read(path))[0] for name, path in COMPOSES.items()}
    assert len(set(valori.values())) == 1, f"locale divergenti fra i compose: {valori}"
