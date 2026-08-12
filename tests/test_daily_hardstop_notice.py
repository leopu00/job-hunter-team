"""Test dell'avviso di deroga sul freno di spesa giornaliero.

[DAILY-SPEND-HARDSTOP-DISABLED-BY-A-LINE-NOBODY-WROTE] — su un'istanza il
freno FISICO sulla spesa giornaliera è rimasto disattivato due settimane, dal
giorno in cui la variabile è nata, e se n'è accorto un rilettore invece del
prodotto. L'indagine ha stabilito che la riga non nasce da noi: nel repo
`JHT_DAILY_HARDSTOP` compare solo dentro `sentinel-bridge.py` e solo in
lettura, con default `"1"`. Il difetto che resta nostro è il SILENZIO: a
deroga attiva il bridge stampava qualcosa **solo** se c'era un halt da
rimuovere, quindi nello stato normale non diceva niente.

Cosa proteggono questi test: la deroga si dichiara da sé, si ripete abbastanza
da non poter passare inosservata per settimane, non inonda il log a ogni tick,
e il ritorno del freno ha la sua riga.

Eseguire con:
    pytest tests/test_daily_hardstop_notice.py -v
"""

import importlib.util
import os

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BRIDGE = os.path.join(REPO_ROOT, '.launcher', 'sentinel-bridge.py')


def _load_bridge():
    spec = importlib.util.spec_from_file_location('sentinel_bridge_hardstop', BRIDGE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


bridge = _load_bridge()


@pytest.fixture()
def state():
    return {"since": None, "announced": None}


def notice(disabled, now_ts, state, every_sec=900):
    return bridge.daily_hardstop_notice(disabled, now_ts, state, every_sec)


# ── il predicato che legge la variabile ───────────────────────────────────


@pytest.mark.parametrize('value,expected', [
    (None, False),      # variabile assente = freno INSERITO
    ('1', False),
    ('', False),
    ('0', True),
    ('false', True),
    ('no', True),
    (' 0 ', True),      # gli spazi non salvano il freno
    ('2', False),       # un valore non previsto non disattiva
])
def test_solo_i_valori_previsti_disattivano_il_freno(monkeypatch, value, expected):
    if value is None:
        monkeypatch.delenv('JHT_DAILY_HARDSTOP', raising=False)
    else:
        monkeypatch.setenv('JHT_DAILY_HARDSTOP', value)
    assert bridge._daily_hardstop_disabled() is expected


def test_il_default_e_freno_inserito(monkeypatch):
    """Il default è la proprietà che rende «non è un difetto di processo»:
    un'istanza nuova nasce col freno ON, non OFF."""
    monkeypatch.delenv('JHT_DAILY_HARDSTOP', raising=False)
    assert bridge._daily_hardstop_disabled() is False


# ── l'avviso ──────────────────────────────────────────────────────────────


def test_a_freno_inserito_non_dice_niente(state):
    assert notice(False, 1000.0, state) is None
    assert state == {"since": None, "announced": None}


def test_la_deroga_si_dichiara_subito(state):
    msg = notice(True, 1000.0, state)
    assert msg is not None
    assert 'DAILY-HARDSTOP DISABLED' in msg
    assert 'JHT_DAILY_HARDSTOP=0' in msg


def test_l_avviso_dice_cosa_manca_e_come_rimetterlo(state):
    """Un avviso che non dice cosa fare si legge e si dimentica."""
    msg = notice(True, 0.0, state)
    assert 'AUTOMATIC stop on daily spend is OFF' in msg
    assert 'pace_guard' in msg          # cosa resta: misura e consiglia
    assert 'not forever' in msg          # l'intento della commit che l'ha creata
    assert 'restore' in msg              # come rimetterlo


def test_non_inonda_il_log_a_ogni_tick(state):
    """Il bridge gira ogni ~5 s: senza limite sarebbero ~17k righe al giorno."""
    said = [notice(True, t * 5.0, state) for t in range(0, 100)]
    assert [m for m in said if m] == [said[0]]


def test_ma_torna_a_dirlo_dopo_la_finestra(state):
    """È la proprietà che conta: due settimane di deroga non possono essere
    silenziose, altrimenti si riscopre leggendo un backlog."""
    primo = notice(True, 0.0, state)
    assert primo is not None
    assert notice(True, 899.0, state) is None
    assert notice(True, 900.0, state) is not None


def test_in_due_settimane_lo_ripete_migliaia_di_volte(state):
    """Controprova numerica del difetto: prima erano ZERO righe."""
    due_settimane = 14 * 24 * 3600
    detti = sum(
        1 for t in range(0, due_settimane, 60)
        if notice(True, float(t), state)
    )
    assert detti >= 14 * 24 * 4 - 1     # ~una ogni 15 min


def test_il_ritorno_del_freno_ha_la_sua_riga(state):
    notice(True, 0.0, state)
    msg = notice(False, 10.0, state)
    assert msg is not None
    assert 're-enabled' in msg
    assert 'back on' in msg


def test_il_ritorno_si_annuncia_una_volta_sola(state):
    notice(True, 0.0, state)
    assert notice(False, 10.0, state) is not None
    assert notice(False, 20.0, state) is None


def test_una_deroga_nuova_riparla_subito_dopo_un_rientro(state):
    notice(True, 0.0, state)
    notice(False, 10.0, state)
    assert notice(True, 11.0, state) is not None


def test_lo_stato_non_si_sporca_a_freno_sempre_inserito(state):
    for t in range(0, 50):
        notice(False, float(t), state)
    assert state == {"since": None, "announced": None}
