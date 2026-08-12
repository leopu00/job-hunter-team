"""Test della deroga sul freno di spesa giornaliero: avviso e scadenza.

[DAILY-SPEND-HARDSTOP-DISABLED-BY-A-LINE-NOBODY-WROTE] — il freno FISICO è
rimasto giù due settimane in silenzio: a deroga attiva il bridge non diceva
niente. Da lì l'avviso ripetuto.

[HARDSTOP-DEROGATION-EXPIRES-AFTER-ONE-WINDOW] — e la deroga di configurazione
era l'unica SENZA scadenza: il BURN-INTENT dell'utente è a termine, mentre
`JHT_DAILY_HARDSTOP=0` lasciata nell'ambiente valeva per sempre, contro
l'intento dichiarato dalla commit che l'ha creata («meant for one window, not
forever»). Ora vale UNA finestra e poi il freno torna da sé, fail-closed: il
rinnovo è esplicito (togliere la variabile e rimetterla), e uno stato corrotto
vale «scaduta», non «per sempre».

Eseguire con:
    pytest tests/test_daily_hardstop_notice.py -v
"""

import importlib.util
import json
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

WINDOW = 5 * 3600.0


@pytest.fixture()
def state():
    return {"since": None, "announced": None, "phase": None}


def notice(phase, now_ts, state, every_sec=900):
    return bridge.daily_hardstop_notice(phase, now_ts, state, every_sec)


def phase_of(disabled, now_ts, started_ts, window_sec=WINDOW):
    return bridge.hardstop_override_phase(disabled, now_ts, started_ts, window_sec)


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
    """Un'istanza nuova nasce col freno ON, non OFF."""
    monkeypatch.delenv('JHT_DAILY_HARDSTOP', raising=False)
    assert bridge._daily_hardstop_disabled() is False


# ── la fase: la deroga vale una finestra ──────────────────────────────────


def test_variabile_assente_fase_off():
    assert phase_of(False, 1000.0, None) == (bridge.HARDSTOP_OFF, None)
    # e azzera anche un inizio-finestra rimasto da prima
    assert phase_of(False, 1000.0, 500.0) == (bridge.HARDSTOP_OFF, None)


def test_la_prima_lettura_apre_la_finestra():
    phase, started = phase_of(True, 1000.0, None)
    assert phase == bridge.HARDSTOP_RUNNING
    assert started == 1000.0


def test_dentro_la_finestra_la_deroga_e_onorata():
    phase, started = phase_of(True, 1000.0 + WINDOW - 1, 1000.0)
    assert phase == bridge.HARDSTOP_RUNNING
    assert started == 1000.0


def test_alla_fine_della_finestra_il_freno_torna_da_se():
    """Il cuore del ticket: la variabile è ancora a 0, ma non conta più."""
    phase, _ = phase_of(True, 1000.0 + WINDOW, 1000.0)
    assert phase == bridge.HARDSTOP_EXPIRED


def test_scaduta_resta_scaduta_finche_non_si_rinnova():
    """`JHT_DAILY_HARDSTOP=0` lasciata li' per giorni non riapre niente."""
    giorni_dopo = 1000.0 + WINDOW + 6 * 24 * 3600
    assert phase_of(True, giorni_dopo, 1000.0)[0] == bridge.HARDSTOP_EXPIRED


def test_il_rinnovo_e_esplicito_togliere_e_rimettere():
    # finestra scaduta
    assert phase_of(True, WINDOW + 1, 0.0)[0] == bridge.HARDSTOP_EXPIRED
    # l'operatore toglie la variabile: off, inizio azzerato
    phase, started = phase_of(False, WINDOW + 2, 0.0)
    assert (phase, started) == (bridge.HARDSTOP_OFF, None)
    # e la rimette: nuova finestra da adesso
    phase, started = phase_of(True, WINDOW + 3, None)
    assert phase == bridge.HARDSTOP_RUNNING
    assert started == WINDOW + 3


@pytest.mark.parametrize('broken', [
    float('nan'), float('inf'), float('-inf'), 'garbage', object(),
])
def test_uno_stato_corrotto_vale_scaduta_non_per_sempre(broken):
    """Fail-closed: se non so quando è iniziata, il freno torna."""
    phase, started = phase_of(True, 1000.0, broken)
    assert phase == bridge.HARDSTOP_EXPIRED
    assert started is None


def test_un_orologio_tornato_indietro_non_uccide_la_deroga():
    """now < started (clock skew): la finestra è comunque in corso."""
    assert phase_of(True, 900.0, 1000.0)[0] == bridge.HARDSTOP_RUNNING


# ── lo stato su file ──────────────────────────────────────────────────────


def test_lo_stato_persiste_e_si_rilegge(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge, 'HARDSTOP_OVERRIDE_STATE_FILE',
                        tmp_path / 'override.json')
    monkeypatch.setattr(bridge, 'LOGS_DIR', tmp_path)
    bridge._persist_hardstop_override(bridge.HARDSTOP_RUNNING, 1234.5)
    assert bridge._read_hardstop_override_started() == 1234.5


def test_la_fase_off_cancella_lo_stato(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge, 'HARDSTOP_OVERRIDE_STATE_FILE',
                        tmp_path / 'override.json')
    monkeypatch.setattr(bridge, 'LOGS_DIR', tmp_path)
    bridge._persist_hardstop_override(bridge.HARDSTOP_RUNNING, 1234.5)
    bridge._persist_hardstop_override(bridge.HARDSTOP_OFF, None)
    assert bridge._read_hardstop_override_started() is None


def test_file_mai_scritto_vuol_dire_mai_partita(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge, 'HARDSTOP_OVERRIDE_STATE_FILE',
                        tmp_path / 'assente.json')
    assert bridge._read_hardstop_override_started() is None


@pytest.mark.parametrize('content', ['non-json', '{"started_ts": "boh"}', '{}', '[]'])
def test_un_file_malformato_produce_nan_quindi_scaduta(tmp_path, monkeypatch, content):
    target = tmp_path / 'override.json'
    target.write_text(content, encoding='utf-8')
    monkeypatch.setattr(bridge, 'HARDSTOP_OVERRIDE_STATE_FILE', target)
    started = bridge._read_hardstop_override_started()
    assert started != started  # NaN
    assert phase_of(True, 1000.0, started)[0] == bridge.HARDSTOP_EXPIRED


def test_il_riavvio_del_bridge_non_riapre_la_finestra(tmp_path, monkeypatch):
    """Il motivo per cui lo stato sta su file e non in memoria."""
    monkeypatch.setattr(bridge, 'HARDSTOP_OVERRIDE_STATE_FILE',
                        tmp_path / 'override.json')
    monkeypatch.setattr(bridge, 'LOGS_DIR', tmp_path)
    # prima vita del bridge: la finestra si apre a t=0
    phase, started = phase_of(True, 0.0, bridge._read_hardstop_override_started())
    bridge._persist_hardstop_override(phase, started)
    # "riavvio": lo stato in RAM sparisce, il file no. Ore dopo:
    riletto = bridge._read_hardstop_override_started()
    assert riletto == 0.0
    assert phase_of(True, WINDOW + 60, riletto)[0] == bridge.HARDSTOP_EXPIRED


# ── l'avviso ──────────────────────────────────────────────────────────────


def test_a_freno_inserito_non_dice_niente(state):
    assert notice(bridge.HARDSTOP_OFF, 1000.0, state) is None
    assert state == {"since": None, "announced": None, "phase": None}


def test_la_deroga_si_dichiara_subito(state):
    msg = notice(bridge.HARDSTOP_RUNNING, 1000.0, state)
    assert msg is not None
    assert 'DAILY-HARDSTOP DISABLED' in msg
    assert 'JHT_DAILY_HARDSTOP=0' in msg


def test_l_avviso_dice_cosa_manca_e_che_scade(state):
    msg = notice(bridge.HARDSTOP_RUNNING, 0.0, state)
    assert 'AUTOMATIC stop on daily spend is OFF' in msg
    assert 'pace_guard' in msg               # cosa resta: misura e consiglia
    assert 'ONE window' in msg               # e ora ha una scadenza vera
    assert 'returns by itself' in msg


def test_non_inonda_il_log_a_ogni_tick(state):
    said = [notice(bridge.HARDSTOP_RUNNING, t * 5.0, state) for t in range(0, 100)]
    assert [m for m in said if m] == [said[0]]


def test_ma_torna_a_dirlo_dopo_la_finestra_dell_annuncio(state):
    primo = notice(bridge.HARDSTOP_RUNNING, 0.0, state)
    assert primo is not None
    assert notice(bridge.HARDSTOP_RUNNING, 899.0, state) is None
    assert notice(bridge.HARDSTOP_RUNNING, 900.0, state) is not None


def test_la_scadenza_parla_subito_senza_aspettare_il_prossimo_annuncio(state):
    """«La deroga è scaduta» detto 14 minuti dopo è un freno tornato in
    silenzio — il cambio di fase buca la finestra dell'annuncio."""
    notice(bridge.HARDSTOP_RUNNING, 0.0, state)
    msg = notice(bridge.HARDSTOP_EXPIRED, 10.0, state)
    assert msg is not None
    assert 'EXPIRED' in msg
    assert 'brake is back on' in msg
    assert 'renew' in msg                    # come rinnovarla, esplicito


def test_anche_da_scaduta_continua_a_ripeterlo(state):
    """La variabile è ancora a 0: chi la crede attiva deve poterlo leggere."""
    notice(bridge.HARDSTOP_EXPIRED, 0.0, state)
    assert notice(bridge.HARDSTOP_EXPIRED, 899.0, state) is None
    assert notice(bridge.HARDSTOP_EXPIRED, 900.0, state) is not None


def test_il_ritorno_del_freno_ha_la_sua_riga(state):
    notice(bridge.HARDSTOP_RUNNING, 0.0, state)
    msg = notice(bridge.HARDSTOP_OFF, 10.0, state)
    assert msg is not None
    assert 're-enabled' in msg
    assert 'back on' in msg


def test_il_ritorno_si_annuncia_una_volta_sola(state):
    notice(bridge.HARDSTOP_RUNNING, 0.0, state)
    assert notice(bridge.HARDSTOP_OFF, 10.0, state) is not None
    assert notice(bridge.HARDSTOP_OFF, 20.0, state) is None


def test_una_deroga_nuova_riparla_subito_dopo_un_rientro(state):
    notice(bridge.HARDSTOP_RUNNING, 0.0, state)
    notice(bridge.HARDSTOP_OFF, 10.0, state)
    assert notice(bridge.HARDSTOP_RUNNING, 11.0, state) is not None


def test_in_due_settimane_lo_ripete_migliaia_di_volte(state):
    """Controprova numerica del difetto originale: prima erano ZERO righe."""
    due_settimane = 14 * 24 * 3600
    detti = sum(
        1 for t in range(0, due_settimane, 60)
        if notice(bridge.HARDSTOP_EXPIRED, float(t), state)
    )
    assert detti >= 14 * 24 * 4 - 1     # ~una ogni 15 min


def test_lo_stato_non_si_sporca_a_freno_sempre_inserito(state):
    for t in range(0, 50):
        notice(bridge.HARDSTOP_OFF, float(t), state)
    assert state == {"since": None, "announced": None, "phase": None}


# ── il cablaggio nel loop ─────────────────────────────────────────────────


def test_il_loop_applica_la_deroga_tramite_la_fase_non_la_variabile():
    """La mutazione che i test unitari non vedono: il call-site che torna a
    `if _daily_hardstop_disabled() or _bi_on:` reintroduce la deroga eterna
    con tutte le funzioni pure ancora verdi. Il loop non è testabile
    direttamente (gira per sempre), quindi la proprietà si tiene ferma sul
    sorgente — come fa test_host_env_security per i suoi invarianti.
    """
    with open(BRIDGE, encoding='utf-8') as handle:
        src = handle.read()
    # il cancello consulta la FASE...
    assert 'if _hs_phase == HARDSTOP_RUNNING or _bi_on:' in src
    # ...e il difetto originale non ricompare come cancello
    assert 'if _daily_hardstop_disabled() or _bi_on:' not in src
    # la fase è calcolata dallo stato persistito, non da un orologio in RAM
    assert '_read_hardstop_override_started()' in src
    assert '_persist_hardstop_override(_hs_phase, _hs_started)' in src


# ── fase + avviso insieme: la storia del ticket ───────────────────────────


def test_la_storia_intera_burst_scadenza_rinnovo(state):
    """Il percorso che la commit originale immaginava, ora con la rete."""
    log = []

    def tick(disabled, now, started):
        phase, new_started = phase_of(disabled, now, started)
        msg = notice(phase, now, state)
        if msg:
            log.append((now, msg.split(' — ')[0]))
        return phase, new_started

    # burst dimostrativo: la deroga si apre e si dichiara
    _, started = tick(True, 0.0, None)
    # a metà finestra è ancora onorata, senza spam
    phase, started = tick(True, WINDOW / 2, started)
    assert phase == bridge.HARDSTOP_RUNNING
    # la finestra finisce: il freno torna DA SÉ e lo dice subito
    phase, started = tick(True, WINDOW + 1, started)
    assert phase == bridge.HARDSTOP_EXPIRED
    # l'operatore toglie la variabile: rientro annunciato
    phase, started = tick(False, WINDOW + 100, started)
    assert phase == bridge.HARDSTOP_OFF
    # e la rimette per un secondo burst: nuova finestra
    phase, _ = tick(True, WINDOW + 200, None)
    assert phase == bridge.HARDSTOP_RUNNING

    assert [tag for _, tag in log] == [
        'DAILY-HARDSTOP DISABLED (JHT_DAILY_HARDSTOP=0)',
        # metà finestra: 2h30 dopo, ben oltre i 15 min → il promemoria si
        # ripete. È il comportamento del ticket precedente, non rumore.
        'DAILY-HARDSTOP DISABLED (JHT_DAILY_HARDSTOP=0)',
        'DAILY-HARDSTOP derogation EXPIRED',
        'DAILY-HARDSTOP re-enabled',
        'DAILY-HARDSTOP DISABLED (JHT_DAILY_HARDSTOP=0)',
    ]
