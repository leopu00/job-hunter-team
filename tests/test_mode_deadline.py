"""
Una modalità può finire da sola: `mode_until` e il ritorno a `search`.

Perché esiste ([SAVING-MODE-HAS-NO-DEADLINE]): il budget settimanale è una
FINESTRA, non un saldo — quello che non si spende al reset viene distrutto.
Un `saving` messo lunedì e dimenticato non conserva niente: butta via l'intero
ciclo, mentre `burn_mode` segnala uno spreco che quella stessa modalità
gli vieta di evitare. È la stessa lezione dei 18 giorni di modalità cura che
nessuno aveva notato: nessuna modalità deve durare per inerzia.

Cosa proteggono questi test:
  1. la scadenza si valuta in LETTURA e vale per tutti i lettori — il freno di
     spesa (`enrichment_policy`) e il banner devono concludere la stessa cosa
     nello stesso istante, o il Capitano riceve due modalità diverse;
  2. alla scadenza cadono anche gli `orders` di quella modalità: un `saving`
     scaduto che lasciasse `stop_search: true` tornerebbe a `search` senza
     cercare, cioè non tornerebbe;
  3. una scadenza illeggibile NON scade e NON invalida la modalità (direzione
     sicura per un freno di spesa), ma si dichiara;
  4. senza scadenza il comportamento storico resta identico.

Eseguire con: pytest tests/test_mode_deadline.py -v
"""

import importlib.util
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')

sys.path.insert(0, SKILLS_DIR)
import mode_deadline  # noqa: E402

NOW = datetime(2026, 8, 8, 12, 0, tzinfo=timezone.utc)


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _write_mode(home, mode, until=None, orders=None):
    profile = home / 'profile'
    profile.mkdir(parents=True, exist_ok=True)
    data = {'mode': mode}
    if until is not None:
        data['mode_until'] = until
    if orders is not None:
        data['orders'] = orders
    (profile / 'capitano-maintenance.json').write_text(
        json.dumps(data), encoding='utf-8')


@pytest.fixture
def home(tmp_path, monkeypatch):
    h = tmp_path / 'jht_home'
    h.mkdir()
    monkeypatch.setenv('JHT_HOME', str(h))
    monkeypatch.setenv('JHT_DB', str(h / 'jobs.db'))
    return h


@pytest.fixture
def banner(home):
    return _load('mode_banner_deadline', os.path.join(SKILLS_DIR, 'mode_banner.py'))


@pytest.fixture
def policy(home):
    # `_db.DB_PATH` è risolto all'import e `enrichment_policy` lo importa:
    # senza buttare via il modulo, il secondo test della sessione leggerebbe
    # ancora la home del primo.
    sys.modules.pop('_db', None)
    return _load('enrichment_policy_deadline',
                 os.path.join(SKILLS_DIR, 'enrichment_policy.py'))


# ── Il calcolo nudo ─────────────────────────────────────────────────────

def test_a_deadline_in_the_future_keeps_the_mode():
    d = mode_deadline.parse_deadline('2026-08-10T18:00:00Z')
    assert mode_deadline.effective_mode('saving', d, NOW) == ('saving', False)


def test_a_passed_deadline_falls_back_to_search():
    d = mode_deadline.parse_deadline('2026-08-07T18:00:00Z')
    assert mode_deadline.effective_mode('saving', d, NOW) == ('search', True)


def test_a_bare_date_and_a_z_suffix_are_both_understood():
    assert mode_deadline.parse_deadline('2026-08-10') is not None
    assert mode_deadline.parse_deadline('2026-08-10T18:00:00Z') is not None
    assert mode_deadline.parse_deadline('2026-08-10T18:00:00+02:00') is not None


def test_a_naive_timestamp_is_read_as_utc():
    """Indovinare il fuso del container darebbe una scadenza diversa da
    quella che l'utente ha scritto."""
    d = mode_deadline.parse_deadline('2026-08-10T18:00:00')
    assert d.tzinfo is not None and d.utcoffset() == timedelta(0)


def test_an_unreadable_deadline_does_not_expire_anything():
    """Direzione sicura per un freno di spesa: l'ignoto resta ordine attivo."""
    for junk in ('venerdì', '', None, 42, '10/08/2026'):
        assert mode_deadline.parse_deadline(junk) is None
    assert mode_deadline.effective_mode('saving', None, NOW) == ('saving', False)


def test_how_long_is_left_as_a_number():
    """Le interfacce che presentano la scadenza come un campo modificabile
    hanno bisogno del delta, non della data: un numero di secondi non richiede
    che host e container concordino sul fuso."""
    d = mode_deadline.parse_deadline('2026-08-10T18:00:00Z')
    assert mode_deadline.remaining_seconds(d, NOW) == int(
        timedelta(days=2, hours=6).total_seconds())


def test_a_deadline_already_passed_has_nothing_left():
    """0 e non un negativo: «quanto manca» a una fine passata è niente, e un
    campo precompilato con un numero negativo non vuol dire nulla."""
    past = mode_deadline.parse_deadline('2026-08-07T18:00:00Z')
    assert mode_deadline.remaining_seconds(past, NOW) == 0
    assert mode_deadline.remaining_seconds(None, NOW) == 0


# ── Il freno di spesa ───────────────────────────────────────────────────

def test_the_policy_lets_enrichment_back_in_after_the_deadline(home, policy):
    _write_mode(home, 'saving', until='2026-01-01T00:00:00Z')
    assert policy.current_mode() == 'search'
    assert policy.is_enabled('recheck_weekly') is True


def test_the_policy_still_brakes_before_the_deadline(home, policy):
    _write_mode(home, 'saving', until='2099-01-01T00:00:00Z')
    assert policy.current_mode() == 'saving'
    assert policy.is_enabled('recheck_weekly') is False


def test_without_a_deadline_nothing_changes(home, policy):
    _write_mode(home, 'saving')
    assert policy.current_mode() == 'saving'
    assert policy.is_enabled('logo') is False


def test_an_unreadable_deadline_keeps_the_mode_in_force(home, policy):
    _write_mode(home, 'saving', until='venerdì sera')
    assert policy.current_mode() == 'saving'
    assert policy.is_enabled('logo') is False


# ── Il banner orario ────────────────────────────────────────────────────

def test_the_banner_declares_the_expiry_and_drops_the_orders(home, banner):
    _write_mode(home, 'saving', until='2026-01-01T00:00:00Z',
                orders={'stop_search': True})
    snap = banner.snapshot()
    assert snap['mode'] == banner.MODE_SEARCH
    assert snap['mode_expired'] is True
    # Gli ordini scadono con la modalità: altrimenti si torna a `search` e
    # non si cerca comunque.
    assert snap['orders'] == {}
    assert banner.sourcing_stopped(snap) is False
    text = banner.banner(snap=snap)
    assert 'EXPIRED' in text
    assert 'saving' in text          # il file dice ancora la sua: si dichiara
    assert 'the deadline wins' in text


def test_the_banner_announces_a_pending_deadline(home, banner):
    _write_mode(home, 'saving', until='2099-01-01T00:00:00Z')
    snap = banner.snapshot()
    assert snap['mode'] == banner.MODE_SAVING
    assert snap['mode_expired'] is False
    text = banner.banner(snap=snap)
    assert 'ENDS: `mode_until`' in text
    assert 'falls back to' in text


def test_a_saving_without_deadline_says_what_it_costs(home, banner):
    """La modalità che non finisce mai deve almeno dire che il weekly non si
    riporta: è l'informazione che rende la scelta consapevole."""
    _write_mode(home, 'saving')
    text = banner.banner(snap=banner.snapshot())
    assert 'WINDOW, not a balance' in text
    assert 'mode_until' in text


def test_an_unreadable_deadline_is_reported_not_ignored(home, banner):
    _write_mode(home, 'saving', until='venerdì sera')
    snap = banner.snapshot()
    assert snap['mode'] == banner.MODE_SAVING
    text = banner.banner(snap=snap)
    assert 'NOT a readable date' in text


def test_the_deadline_ends_any_mode_not_just_saving(home, banner):
    _write_mode(home, 'care', until='2026-01-01T00:00:00Z',
                orders={'stop_search': True})
    snap = banner.snapshot()
    assert snap['mode'] == banner.MODE_SEARCH
    assert snap['mode_expired'] is True


def test_the_two_readers_agree(home, banner, policy):
    """Se il banner e il freno di spesa concludessero diversamente, il
    Capitano riceverebbe due modalità nello stesso minuto."""
    for until, expected in (('2026-01-01T00:00:00Z', 'search'),
                            ('2099-01-01T00:00:00Z', 'saving'),
                            ('venerdì', 'saving')):
        _write_mode(home, 'saving', until=until)
        assert banner.snapshot()['mode'] == policy.current_mode() == expected
