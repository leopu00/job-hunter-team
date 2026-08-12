"""Test del bridge Telegram inbound (.launcher/tg-bridge.py).

Perché conta: è l'ingresso Telegram della conversazione unificata, ed è
fail-closed. Un difetto qui non produce un errore visibile ma
**silenzio**: l'utente scrive e nessuno risponde, e la diagnosi arriva solo
leggendo i log del container. Prima di questo file non c'era un solo test.

I test caricano il modulo con `JHT_HOME` in una tmp_path e sostituiscono la
rete Telegram. Il bridge non invia più direttamente a tmux: journalizza e
trasferisce in `pending_user_messages`, da cui parte l'unico consumer
`chat-sync.js`. Sono coperti:

  • il gate di boot sul ruolo (env mancante o sbagliata = exit 2);
  • lettura config e persistenza dell'offset (incluso il reset del backlog);
  • i turni durevoli per testo, documento, foto e vocale;
  • il rifiuto di un documento oltre i 20 MB e il fallimento del download,
    che devono comunque avvisare l'agente invece di sparire;
  • il loop principale: whitelist sul chat_id, `/start` non inoltrato,
    avanzamento dell'offset, e sopravvivenza a un handler che solleva;
  • il confine crash/restart: journal prima dell'offset, identità stabile,
    trasferimento SQLite idempotente e permessi minimi.

Eseguire:
    pytest tests/test_tg_bridge.py -v
"""

import importlib.util
import io
import json
import re
import sqlite3
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
BRIDGE_PATH = REPO_ROOT / ".launcher" / "tg-bridge.py"


def _load_bridge(monkeypatch, home, role="assistente", **env):
    """Carica tg-bridge.py con env controllata.

    Il modulo calcola JHT_HOME, STATE_PATH e TARGET_SESSION al momento
    dell'import: va ricaricato per ogni scenario, mai riusato fra test.
    """
    monkeypatch.setenv("JHT_TG_BOT_ROLE", role)
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.delenv("JHT_TG_OFFSET_RESET", raising=False)
    monkeypatch.delenv("JHT_TG_TARGET_SESSION", raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    spec = importlib.util.spec_from_file_location("tg_bridge_under_test", BRIDGE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def bridge(monkeypatch, tmp_path):
    return _load_bridge(monkeypatch, tmp_path)


def _write_config(home, role="assistente", token="123:ABC", chat_id=999):
    (home / "jht.config.json").write_text(json.dumps({
        "channels": {"telegram": {"bots": {role: {
            "bot_token": token, "chat_id": chat_id,
        }}}}
    }))


def _journal(mod):
    return [
        json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(mod.INBOUND_QUEUE_DIR.glob("update-*.json"))
    ]


def _create_chat_db(path, *, legacy=False):
    conn = sqlite3.connect(path)
    extra = "" if legacy else "author TEXT NOT NULL DEFAULT 'agent', chat_ts REAL, source_id TEXT,"
    conn.executescript(f"""
        CREATE TABLE pending_user_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent TEXT NOT NULL, body TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'notification',
            {extra}
            delivered_via TEXT, delivered_at TEXT, created_at TEXT
        );
    """)
    conn.close()


def _chat_rows(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(row) for row in conn.execute(
            "SELECT * FROM pending_user_messages ORDER BY id"
        )]
    finally:
        conn.close()


# ── Gate di boot ────────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ["", "   ", "sentinella", "Assistant"])
def test_ruolo_non_valido_esce_subito(monkeypatch, tmp_path, role):
    """Un bridge avviato senza ruolo valido deve morire con exit 2, non
    restare vivo a poll-are il bot sbagliato."""
    with pytest.raises(SystemExit) as exc:
        _load_bridge(monkeypatch, tmp_path, role=role)
    assert exc.value.code == 2


@pytest.mark.parametrize("role", ["assistente", "capitano", "mentor"])
def test_i_tre_ruoli_previsti_si_avviano(monkeypatch, tmp_path, role):
    mod = _load_bridge(monkeypatch, tmp_path, role=role)
    assert mod.BOT_ROLE == role
    # Sessione tmux di default = ruolo maiuscolo.
    assert mod.TARGET_SESSION == role.upper()


def test_il_ruolo_e_normalizzato_e_ogni_bridge_ha_il_suo_state(monkeypatch, tmp_path):
    """Tre bridge in parallelo non devono pestarsi l'offset a vicenda."""
    a = _load_bridge(monkeypatch, tmp_path, role="  Capitano  ")
    assert a.BOT_ROLE == "capitano"
    b = _load_bridge(monkeypatch, tmp_path, role="mentor")
    assert a.STATE_PATH != b.STATE_PATH
    assert a.STATE_PATH.parent == tmp_path


def test_target_session_override_da_env(monkeypatch, tmp_path):
    mod = _load_bridge(monkeypatch, tmp_path, JHT_TG_TARGET_SESSION="ASSISTENTE-2")
    assert mod.TARGET_SESSION == "ASSISTENTE-2"


# ── read_config ─────────────────────────────────────────────────────────

def test_read_config_legge_token_e_chat_del_ruolo(monkeypatch, tmp_path):
    mod = _load_bridge(monkeypatch, tmp_path)
    _write_config(tmp_path, token="42:XYZ", chat_id=777)
    assert mod.read_config() == ("42:XYZ", 777)


def test_read_config_accetta_chat_id_come_stringa(monkeypatch, tmp_path):
    mod = _load_bridge(monkeypatch, tmp_path)
    _write_config(tmp_path, chat_id="777")
    assert mod.read_config()[1] == 777


def test_read_config_isola_i_bot_per_ruolo(monkeypatch, tmp_path):
    """La config del capitano non deve essere usata dall'assistente."""
    mod = _load_bridge(monkeypatch, tmp_path, role="assistente")
    _write_config(tmp_path, role="capitano", token="cap:TOKEN", chat_id=111)
    with pytest.raises(SystemExit) as exc:
        mod.read_config()
    assert exc.value.code == 2


@pytest.mark.parametrize("bot", [
    {},                                        # nessun campo
    {"bot_token": "", "chat_id": 1},           # token vuoto
    {"bot_token": "t", "chat_id": ""},         # chat_id vuoto
    {"bot_token": "t", "chat_id": 0},          # chat_id nullo
    {"bot_token": "   ", "chat_id": 1},        # token di soli spazi
])
def test_read_config_incompleta_esce_2(monkeypatch, tmp_path, bot):
    mod = _load_bridge(monkeypatch, tmp_path)
    (tmp_path / "jht.config.json").write_text(json.dumps({
        "channels": {"telegram": {"bots": {"assistente": bot}}}
    }))
    with pytest.raises(SystemExit) as exc:
        mod.read_config()
    assert exc.value.code == 2


def test_read_config_senza_file_o_illeggibile_esce_2(monkeypatch, tmp_path):
    mod = _load_bridge(monkeypatch, tmp_path)
    with pytest.raises(SystemExit) as exc:
        mod.read_config()
    assert exc.value.code == 2

    (tmp_path / "jht.config.json").write_text("{ non json")
    with pytest.raises(SystemExit) as exc:
        mod.read_config()
    assert exc.value.code == 2


# ── Offset ──────────────────────────────────────────────────────────────

def test_offset_round_trip(monkeypatch, tmp_path):
    mod = _load_bridge(monkeypatch, tmp_path)
    assert mod.load_offset() == 0          # nessuno stato = si parte da zero
    mod.save_offset(4242)
    assert mod.load_offset() == 4242


def test_offset_reset_salta_il_backlog(monkeypatch, tmp_path):
    """Con JHT_TG_OFFSET_RESET=1 il valore su disco viene ignorato e si
    ritorna la sentinella -1 (ricalcolo al primo poll)."""
    mod = _load_bridge(monkeypatch, tmp_path)
    mod.save_offset(500)
    mod = _load_bridge(monkeypatch, tmp_path, JHT_TG_OFFSET_RESET="1")
    assert mod.load_offset() == -1


def test_offset_state_corrotto_riparte_da_zero(monkeypatch, tmp_path):
    mod = _load_bridge(monkeypatch, tmp_path)
    mod.STATE_PATH.write_text("{ rotto")
    assert mod.load_offset() == 0


def test_save_offset_non_solleva_se_il_path_non_e_scrivibile(monkeypatch, tmp_path):
    """Un errore di scrittura non deve abbattere il bridge: si perde
    l'offset, non il canale."""
    mod = _load_bridge(monkeypatch, tmp_path)
    monkeypatch.setattr(mod, "STATE_PATH", tmp_path / "inesistente" / "s.json")
    mod.save_offset(7)  # nessuna eccezione


# ── Journal durevole → cronologia unificata ─────────────────────────────

def test_journal_nasce_atomico_con_identita_stabile_e_permessi_minimi(bridge):
    update = _msg(41, text="domanda sintetica", date=1_723_480_000)
    bridge.dispatch_update("tok", 999, update)

    rows = _journal(bridge)
    assert rows == [{
        "version": 1,
        "source_id": "telegram:assistente:41",
        "update_id": 41,
        "agent": "assistente",
        "body": "domanda sintetica",
        "author": "user",
        "delivered_via": "telegram",
        "created_at": "2024-08-12 16:26:40",
        "edited": False,
    }]
    queue_file = next(bridge.INBOUND_QUEUE_DIR.iterdir())
    assert bridge.INBOUND_QUEUE_DIR.stat().st_mode & 0o777 == 0o700
    assert queue_file.stat().st_mode & 0o777 == 0o600
    assert not list(bridge.INBOUND_QUEUE_DIR.glob("*.tmp"))


def test_flush_entra_nella_cronologia_legacy_e_rimuove_subito_il_journal(
    bridge, tmp_path,
):
    db_path = tmp_path / "jobs.db"
    _create_chat_db(db_path, legacy=True)
    bridge.dispatch_update("tok", 999, _msg(9, text="testo persistito"))

    assert bridge.flush_inbound_queue(db_path) == 1
    rows = _chat_rows(db_path)
    assert len(rows) == 1
    assert rows[0]["body"] == "testo persistito"
    assert rows[0]["author"] == "user"
    assert rows[0]["delivered_via"] == "telegram"
    assert rows[0]["delivered_at"] is None
    assert rows[0]["chat_ts"] is None  # il mirror chat-sync e' l'unico consumer
    assert rows[0]["source_id"] == "telegram:assistente:9"
    assert _journal(bridge) == []  # retention minima: solo fino al COMMIT


def test_restart_fra_journal_offset_commit_e_cleanup_non_perde_ne_duplica(
    monkeypatch, tmp_path,
):
    db_path = tmp_path / "jobs.db"
    _create_chat_db(db_path)
    update = _msg(77, text="una volta sola")

    first = _load_bridge(monkeypatch, tmp_path)
    first.dispatch_update("tok", 999, update)
    # Crash prima dell'offset: Telegram ripropone lo stesso update.
    second = _load_bridge(monkeypatch, tmp_path)
    second.dispatch_update("tok", 999, update)
    assert len(_journal(second)) == 1

    assert second.flush_inbound_queue(db_path) == 1
    # Crash dopo COMMIT ma prima che l'offset sia sicuramente persistito:
    # il replay ricrea il journal, source_id rende l'INSERT idempotente.
    third = _load_bridge(monkeypatch, tmp_path)
    third.dispatch_update("tok", 999, update)
    assert third.flush_inbound_queue(db_path) == 1
    assert [r["body"] for r in _chat_rows(db_path)] == ["una volta sola"]
    assert _journal(third) == []


def test_due_testi_uguali_con_update_diversi_restano_due_turni(bridge, tmp_path):
    db_path = tmp_path / "jobs.db"
    _create_chat_db(db_path)
    bridge.dispatch_update("tok", 999, _msg(1, text="ok"))
    bridge.dispatch_update("tok", 999, _msg(2, text="ok"))
    bridge.flush_inbound_queue(db_path)
    rows = _chat_rows(db_path)
    assert [r["body"] for r in rows] == ["ok", "ok"]
    assert {r["source_id"] for r in rows} == {
        "telegram:assistente:1", "telegram:assistente:2",
    }


# ── Contenuto dei turni Telegram ────────────────────────────────────────

def test_testo_produce_il_turno_atteso(bridge):
    assert bridge.handle_text({"text": "  ciao team  "}) == "ciao team"


def test_testo_vuoto_non_inoltra_nulla(bridge):
    assert bridge.handle_text({"text": "   "}) is None
    assert bridge.handle_text({}) is None


def test_documento_inoltra_path_nome_mime_e_size(bridge, monkeypatch, tmp_path):
    monkeypatch.setattr(bridge, "fetch_file", lambda t, fid, name: tmp_path / name)
    body = bridge.handle_document("tok", {"document": {
        "file_id": "AAA", "file_name": "cv.pdf",
        "mime_type": "application/pdf", "file_size": 1234,
    }})
    assert body.startswith("[TG-DOC] ")
    assert f"path={tmp_path / 'cv.pdf'}" in body
    assert "name=cv.pdf" in body
    assert "mime=application/pdf" in body
    assert "size=1234" in body


def test_documento_oltre_20mb_avvisa_e_non_scarica(bridge, monkeypatch):
    chiamate = []
    monkeypatch.setattr(bridge, "fetch_file", lambda *a: chiamate.append(a))
    body = bridge.handle_document("tok", {"document": {
        "file_id": "AAA", "file_name": "enorme.pdf", "file_size": 21 * 1024 * 1024,
    }})
    assert chiamate == []
    assert "[TG-DOC-REJECT]" in body
    assert "enorme.pdf" in body


def test_documento_al_limite_esatto_passa(bridge, monkeypatch, tmp_path):
    monkeypatch.setattr(bridge, "fetch_file", lambda t, fid, name: tmp_path / name)
    body = bridge.handle_document("tok", {"document": {
        "file_id": "AAA", "file_name": "borderline.pdf",
        "file_size": bridge.MAX_DOC_SIZE_BYTES,
    }})
    assert "[TG-DOC]" in body


def test_download_fallito_avvisa_l_agente(bridge, monkeypatch):
    """Il caso peggiore sarebbe il silenzio: l'utente ha mandato il CV e
    nessuno glielo dice."""
    monkeypatch.setattr(bridge, "fetch_file", lambda *a: None)
    body = bridge.handle_document("tok", {"document": {
        "file_id": "AAA", "file_name": "cv.pdf", "file_size": 10,
    }})
    assert "[TG-DOC-ERROR]" in body
    assert "cv.pdf" in body


def test_foto_prende_la_risoluzione_piu_grande(bridge, monkeypatch, tmp_path):
    scaricati = []

    def _fetch(token, file_id, name):
        scaricati.append(file_id)
        return tmp_path / name

    monkeypatch.setattr(bridge, "fetch_file", _fetch)
    body = bridge.handle_photo("tok", {"photo": [
        {"file_id": "small", "file_size": 100},
        {"file_id": "large", "file_size": 9000},
        {"file_id": "mid", "file_size": 4000},
    ]})
    assert scaricati == ["large"]
    assert "size=9000" in body
    assert "mime=image/jpeg" in body


def test_foto_senza_array_non_inoltra(bridge):
    assert bridge.handle_photo("tok", {"photo": []}) is None


def test_vocale_include_la_durata(bridge, monkeypatch, tmp_path):
    monkeypatch.setattr(bridge, "fetch_file", lambda t, fid, name: tmp_path / name)
    body = bridge.handle_voice("tok", {"voice": {
        "file_id": "VOICE12345", "file_size": 500, "duration": 12,
    }})
    assert "mime=audio/ogg" in body
    assert "duration=12s" in body
    assert ".ogg" in body


def test_allegato_non_scaricato_produce_un_errore_durevole(bridge, monkeypatch):
    monkeypatch.setattr(bridge, "fetch_file", lambda *a: None)
    photo = bridge.handle_photo("tok", {"photo": [{"file_id": "x", "file_size": 1}]})
    voice = bridge.handle_voice("tok", {"voice": {"file_id": "y"}})
    assert "[TG-DOC-ERROR]" in photo
    assert "[TG-DOC-ERROR]" in voice


# ── setMyCommands ───────────────────────────────────────────────────────

class _FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_setup_bot_commands_registra_i_comandi_del_ruolo(monkeypatch, tmp_path):
    mod = _load_bridge(monkeypatch, tmp_path, role="mentor")
    visti = {}

    def _urlopen(req, timeout=None):
        visti["url"] = req.full_url
        visti["payload"] = json.loads(req.data.decode())
        return _FakeResp(b'{"ok": true}')

    monkeypatch.setattr(mod.urllib.request, "urlopen", _urlopen)
    mod.setup_bot_commands("tok-123")

    assert visti["url"].endswith("/bottok-123/setMyCommands")
    comandi = [c["command"] for c in visti["payload"]["commands"]]
    assert comandi == [c for c, _k in mod.BOT_COMMANDS["mentor"]]
    # Ogni comando ha una descrizione non vuota (i18n risolta o key di fallback).
    assert all(c["description"] for c in visti["payload"]["commands"])


def test_setup_bot_commands_non_blocca_il_boot_se_la_rete_e_giu(monkeypatch, tmp_path):
    mod = _load_bridge(monkeypatch, tmp_path)

    def _boom(req, timeout=None):
        raise OSError("network unreachable")

    monkeypatch.setattr(mod.urllib.request, "urlopen", _boom)
    mod.setup_bot_commands("tok")  # nessuna eccezione: il long-poll parte comunque


# ── Loop principale ─────────────────────────────────────────────────────

def _run_main_con_updates(mod, monkeypatch, updates, giri=1):
    """Fa girare main() su `giri` poll finti, poi lo interrompe.

    KeyboardInterrupt non è catturata dal loop (è BaseException), quindi è il
    modo pulito per uscire da un while True.
    """
    monkeypatch.setattr(mod, "read_config", lambda: ("tok", 999))
    monkeypatch.setattr(mod, "load_offset", lambda: 0)
    monkeypatch.setattr(mod, "setup_bot_commands", lambda token: None)
    monkeypatch.setattr(mod.time, "sleep", lambda _s: None)

    stato = {"giri": 0}

    def _urlopen(url, timeout=None):
        stato["giri"] += 1
        if stato["giri"] > giri:
            raise KeyboardInterrupt
        return _FakeResp(json.dumps({"result": updates}).encode())

    monkeypatch.setattr(mod.urllib.request, "urlopen", _urlopen)
    with pytest.raises(KeyboardInterrupt):
        mod.main()


def _msg(uid, chat=999, **campi):
    return {"update_id": uid, "message": {"chat": {"id": chat}, **campi}}


def test_main_journalizza_il_messaggio_prima_di_avanzare_l_offset(bridge, monkeypatch):
    _run_main_con_updates(bridge, monkeypatch, [_msg(10, text="ciao")])
    assert [row["body"] for row in _journal(bridge)] == ["ciao"]
    assert json.loads(bridge.STATE_PATH.read_text())["last_offset"] == 10


def test_main_non_avanza_se_il_journal_durevole_fallisce(bridge, monkeypatch):
    def _fail(*_args, **_kwargs):
        raise bridge.DurableQueueError("disco non scrivibile")

    monkeypatch.setattr(bridge, "enqueue_inbound_turn", _fail)
    _run_main_con_updates(bridge, monkeypatch, [_msg(10, text="non perdermi")])
    state = json.loads(bridge.STATE_PATH.read_text())
    assert state["last_offset"] == 0
    assert state["attempts"] == {"10": 1}


def test_main_flusha_la_coda_ad_ogni_poll(bridge, monkeypatch):
    calls = []
    monkeypatch.setattr(bridge, "flush_inbound_queue", lambda: calls.append("flush"))
    _run_main_con_updates(bridge, monkeypatch, [], giri=1)
    assert len(calls) >= 2


def test_main_scarta_le_chat_non_in_whitelist(bridge, monkeypatch):
    """Il canale è 1:1: un chat_id estraneo non deve mai raggiungere tmux."""
    _run_main_con_updates(bridge, monkeypatch, [
        _msg(1, chat=12345, text="sono un estraneo"),
        _msg(2, chat=999, text="sono l'utente"),
    ])
    assert [row["body"] for row in _journal(bridge)] == ["sono l'utente"]
    # L'offset avanza comunque: l'update scartato non va riprocessato.
    assert json.loads(bridge.STATE_PATH.read_text())["last_offset"] == 2


def test_main_non_inoltra_lo_start(bridge, monkeypatch):
    _run_main_con_updates(bridge, monkeypatch, [
        _msg(1, text="/start"),
        _msg(2, text="  /start  "),
        _msg(3, text="/startup non e' /start"),
    ])
    assert [row["body"] for row in _journal(bridge)] == ["/startup non e' /start"]


def test_main_gestisce_anche_i_messaggi_modificati(bridge, monkeypatch):
    monkeypatch.setattr(bridge, "read_config", lambda: ("tok", 999))
    _run_main_con_updates(bridge, monkeypatch, [
        {"update_id": 5, "edited_message": {"chat": {"id": 999}, "text": "corretto"}},
    ])
    assert [row["body"] for row in _journal(bridge)] == ["[TG-EDITED] corretto"]
    assert _journal(bridge)[0]["edited"] is True


def test_main_smista_per_tipo_di_allegato(bridge, monkeypatch, tmp_path):
    monkeypatch.setattr(bridge, "fetch_file", lambda t, fid, name: tmp_path / name)
    _run_main_con_updates(bridge, monkeypatch, [
        _msg(1, text="testo"),
        _msg(2, document={"file_id": "d", "file_name": "cv.pdf", "file_size": 1}),
        _msg(3, photo=[{"file_id": "p", "file_size": 2}]),
        _msg(4, voice={"file_id": "v", "file_size": 3, "duration": 1}),
        _msg(5, sticker={"file_id": "s"}),   # tipo sconosciuto: solo log
    ])
    turns = [row["body"] for row in _journal(bridge)]
    assert len(turns) == 4
    assert turns[0] == "testo"
    assert "name=cv.pdf" in turns[1]
    assert "mime=image/jpeg" in turns[2]
    assert "mime=audio/ogg" in turns[3]


def test_main_ignora_gli_update_senza_messaggio(bridge, monkeypatch):
    _run_main_con_updates(bridge, monkeypatch, [
        {"update_id": 7, "channel_post": {"text": "non mio"}},
    ])
    assert _journal(bridge) == []


def test_main_sopravvive_a_un_handler_che_solleva(bridge, monkeypatch):
    """Il bridge non deve morire per un singolo update malformato: continua
    a poll-are (con il costo, noto, che quell'update non viene ritentato)."""
    def _boom(msg):
        raise KeyError("text")

    monkeypatch.setattr(bridge, "handle_text", _boom)
    _run_main_con_updates(bridge, monkeypatch, [_msg(1, text="boom")], giri=3)
    # Nessuna eccezione propagata oltre KeyboardInterrupt: il loop ha retto.


def test_main_sopravvive_a_una_risposta_non_json(bridge, monkeypatch):
    monkeypatch.setattr(bridge, "read_config", lambda: ("tok", 999))
    monkeypatch.setattr(bridge, "load_offset", lambda: 0)
    monkeypatch.setattr(bridge, "setup_bot_commands", lambda token: None)
    monkeypatch.setattr(bridge.time, "sleep", lambda _s: None)

    stato = {"giri": 0}

    def _urlopen(url, timeout=None):
        stato["giri"] += 1
        if stato["giri"] > 2:
            raise KeyboardInterrupt
        return _FakeResp(b"<html>502 Bad Gateway</html>")

    monkeypatch.setattr(bridge.urllib.request, "urlopen", _urlopen)
    with pytest.raises(KeyboardInterrupt):
        bridge.main()
    assert _journal(bridge) == []


# ── Consegna at-least-once: ritentativi e dead-letter ───────────────────
#
# Il difetto che questi test presidiano: l'offset avanzava PRIMA del dispatch,
# quindi un handler che sollevava faceva sparire l'update per sempre — già
# confermato a Telegram, mai riprocessato, nessun errore visibile all'utente.
# Il rimedio non può però essere il solo "avanza dopo": un update che solleva
# *sempre* diventerebbe un blocco permanente per tutta la coda dietro di lui.
# Servono entrambe le proprietà, ed è quello che si verifica qui.

class _FakeTelegram:
    """Un getUpdates finto che rispetta l'offset, come il server vero.

    È il punto chiave: se il bridge non avanza l'offset, l'update torna al
    poll successivo. Un fake che ignorasse `offset=` renderebbe questi test
    incapaci di distinguere un ritentativo da una perdita.
    """

    def __init__(self, updates, max_polls=10):
        self.updates = updates
        self.max_polls = max_polls
        self.polls = 0
        self.serviti = []   # update_id restituiti a ogni poll

    def urlopen(self, url, timeout=None):
        self.polls += 1
        if self.polls > self.max_polls:
            raise KeyboardInterrupt
        target = url if isinstance(url, str) else url.full_url
        m = re.search(r"[?&]offset=(-?\d+)", target)
        off = int(m.group(1)) if m else 0
        batch = [u for u in self.updates if u.get("update_id", off) >= off]
        self.serviti.append([u.get("update_id") for u in batch])
        return _FakeResp(json.dumps({"result": batch}).encode())


def _run_main(mod, monkeypatch, fake):
    """main() contro un fake Telegram, con lo stato su disco davvero attivo."""
    monkeypatch.setattr(mod, "read_config", lambda: ("tok", 999))
    monkeypatch.setattr(mod, "setup_bot_commands", lambda token: None)
    monkeypatch.setattr(mod.time, "sleep", lambda _s: None)
    monkeypatch.setattr(mod.urllib.request, "urlopen", fake.urlopen)
    with pytest.raises(KeyboardInterrupt):
        mod.main()


def _stato(mod):
    return json.loads(mod.STATE_PATH.read_text())


def _solleva(exc):
    def _f(*_a, **_k):
        raise exc
    return _f


def _handler_che_fallisce_le_prime(bridge, monkeypatch, volte):
    """handle_text che solleva le prime `volte` chiamate, poi funziona."""
    reale = bridge.handle_text
    conteggio = {"n": 0}

    def _flaky(msg):
        conteggio["n"] += 1
        if conteggio["n"] <= volte:
            raise RuntimeError("tmux non ancora pronto")
        return reale(msg)

    monkeypatch.setattr(bridge, "handle_text", _flaky)
    return conteggio


def test_un_errore_transitorio_non_perde_il_messaggio(bridge, monkeypatch):
    """Il cuore del ticket: prima, questo messaggio spariva in silenzio."""
    _handler_che_fallisce_le_prime(bridge, monkeypatch, volte=1)
    fake = _FakeTelegram([_msg(10, text="il mio CV e' pronto")], max_polls=3)
    _run_main(bridge, monkeypatch, fake)

    assert [row["body"] for row in _journal(bridge)] == ["il mio CV e' pronto"]
    assert _stato(bridge)["last_offset"] == 10
    # Il secondo poll ha davvero richiesto di nuovo lo stesso update.
    assert fake.serviti[0] == [10] and fake.serviti[1] == [10]
    assert not bridge.DEADLETTER_PATH.exists()


def test_offset_fermo_dietro_l_update_fallito(bridge, monkeypatch):
    """Finché non è consegnato, l'offset non deve superarlo: è l'unica cosa
    che impedisce a Telegram di considerarlo confermato."""
    monkeypatch.setattr(bridge, "handle_text", _solleva(RuntimeError("boom")))
    fake = _FakeTelegram([_msg(42, text="ciao")], max_polls=1)
    _run_main(bridge, monkeypatch, fake)

    stato = _stato(bridge)
    assert stato["last_offset"] == 0
    assert stato["attempts"] == {"42": 1}
    assert _journal(bridge) == []


def test_i_messaggi_dietro_non_vengono_ne_persi_ne_riordinati(bridge, monkeypatch):
    """Fermare il batch sul primo errore costa un poll, ma preserva l'ordine:
    un agente che legge le buste fuori sequenza risponde alla domanda sbagliata."""
    _handler_che_fallisce_le_prime(bridge, monkeypatch, volte=1)
    fake = _FakeTelegram([
        _msg(1, text="primo"),
        _msg(2, text="secondo"),
        _msg(3, text="terzo"),
    ], max_polls=3)
    _run_main(bridge, monkeypatch, fake)

    assert [row["body"] for row in _journal(bridge)] == [
        "primo", "secondo", "terzo",
    ]
    assert _stato(bridge)["last_offset"] == 3


def test_un_update_velenoso_non_blocca_la_coda(bridge, monkeypatch):
    """Il rischio introdotto dal fix: un update che solleva sempre potrebbe
    diventare un ritentativo infinito, cioè un guasto peggiore di quello
    corretto. Dopo MAX_UPDATE_ATTEMPTS deve essere scartato e la coda ripartire."""
    reale = bridge.handle_text

    def _handler(msg):
        if msg.get("text") == "veleno":
            raise KeyError("payload malformato")
        return reale(msg)

    monkeypatch.setattr(bridge, "handle_text", _handler)

    fake = _FakeTelegram([
        _msg(1, text="veleno"),
        _msg(2, text="messaggio buono in coda"),
    ], max_polls=6)
    _run_main(bridge, monkeypatch, fake)

    # Il messaggio dietro è arrivato, e l'offset è oltre entrambi.
    assert "messaggio buono in coda" in [row["body"] for row in _journal(bridge)]
    assert _stato(bridge)["last_offset"] == 2
    assert _stato(bridge).get("attempts") in (None, {})
    # Esattamente MAX_UPDATE_ATTEMPTS tentativi, non uno di più.
    assert fake.serviti[:3] == [[1, 2], [1, 2], [1, 2]]
    assert fake.serviti[3] == []


def test_l_update_scartato_finisce_su_file_e_l_agente_lo_sa(bridge, monkeypatch):
    """Regola di progetto: l'utente non apre un terminale. Un messaggio non
    consegnabile va annunciato, non lasciato dedurre dal silenzio."""
    monkeypatch.setattr(bridge, "handle_text", _solleva(ValueError("rotto")))
    fake = _FakeTelegram([_msg(7, text="qualcosa")], max_polls=4)
    _run_main(bridge, monkeypatch, fake)

    avvisi = [r["body"] for r in _journal(bridge) if "[TG-UNDELIVERED]" in r["body"]]
    assert len(avvisi) == 1
    assert "update_id=7" in avvisi[0]
    assert f"attempts={bridge.MAX_UPDATE_ATTEMPTS}" in avvisi[0]
    assert "ValueError" in avvisi[0]

    righe = bridge.DEADLETTER_PATH.read_text().strip().splitlines()
    assert len(righe) == 1
    rec = json.loads(righe[0])
    assert rec["update_id"] == 7
    assert rec["attempts"] == bridge.MAX_UPDATE_ATTEMPTS
    assert rec["error"] == "ValueError: rotto"
    # L'update intero è conservato: senza il payload il dead-letter è inutile.
    assert rec["update"]["message"]["text"] == "qualcosa"
    assert rec["role"] == "assistente"


def test_i_tentativi_sopravvivono_al_riavvio_del_bridge(monkeypatch, tmp_path):
    """Se il contatore vivesse in memoria, un respawn (start-agent.sh lo fa)
    lo azzererebbe e l'update velenoso bloccherebbe la coda per sempre, un
    riavvio alla volta."""
    def _avvia(max_polls):
        mod = _load_bridge(monkeypatch, tmp_path)
        monkeypatch.setattr(mod, "handle_text", _solleva(RuntimeError("veleno")))
        _run_main(mod, monkeypatch, _FakeTelegram([_msg(3, text="x")], max_polls=max_polls))
        return mod

    primo = _avvia(max_polls=2)
    assert json.loads(primo.STATE_PATH.read_text())["attempts"] == {"3": 2}
    assert not any("[TG-UNDELIVERED]" in r["body"] for r in _journal(primo))

    # Riavvio: modulo ricaricato da zero, stesso JHT_HOME.
    secondo = _avvia(max_polls=1)
    assert any("[TG-UNDELIVERED]" in r["body"] for r in _journal(secondo))
    assert secondo.DEADLETTER_PATH.exists()


def test_lo_scarto_legittimo_non_conta_come_fallimento(bridge, monkeypatch):
    """Chat estranea, /start e tipi sconosciuti sono update *gestiti*: non
    devono lasciare tentativi appesi nello stato né finire in dead-letter."""
    fake = _FakeTelegram([
        _msg(1, chat=12345, text="estraneo"),
        _msg(2, text="/start"),
        _msg(3, sticker={"file_id": "s"}),
        {"update_id": 4, "channel_post": {"text": "non mio"}},
    ], max_polls=2)
    _run_main(bridge, monkeypatch, fake)

    assert _journal(bridge) == []
    assert _stato(bridge)["last_offset"] == 4
    assert _stato(bridge).get("attempts") in (None, {})
    assert not bridge.DEADLETTER_PATH.exists()


def test_update_senza_id_non_ferma_il_loop(bridge, monkeypatch):
    fake = _FakeTelegram([
        {"message": {"chat": {"id": 999}, "text": "senza id"}},
        _msg(5, text="con id"),
    ], max_polls=1)
    _run_main(bridge, monkeypatch, fake)
    assert [row["body"] for row in _journal(bridge)] == ["con id"]


# ── Guard dimensione: campo assente ≠ file piccolo ──────────────────────

@pytest.mark.parametrize("valore,atteso", [
    (1234, 1234),
    (0, 0),
    (None, None),        # campo assente: sconosciuto, non zero
    ("1234", None),      # stringa: non è un intero
    (True, None),        # bool è int in Python: non deve passare per 1
])
def test_declared_size_riconosce_solo_interi_veri(bridge, valore, atteso):
    doc = {} if valore is None else {"file_size": valore}
    assert bridge.declared_size(doc) == atteso


def _fake_download(mod, monkeypatch, corpo: bytes, meta_size=None):
    """getFile + download finti. Ritorna la lista degli URL aperti."""
    aperti = []

    def _urlopen(url, timeout=None):
        target = url if isinstance(url, str) else url.full_url
        aperti.append(target)
        if "/getFile" in target:
            result = {"file_path": "documents/file.bin"}
            if meta_size is not None:
                result["file_size"] = meta_size
            return _FakeResp(json.dumps({"ok": True, "result": result}).encode())
        return _FakeResp(corpo)

    monkeypatch.setattr(mod.urllib.request, "urlopen", _urlopen)
    return aperti


def test_file_size_assente_non_e_un_file_piccolo(bridge, monkeypatch):
    """Il difetto: `doc.get("file_size", 0)` faceva passare il guard e il
    download procedeva senza limite. Ora il tetto è applicato sullo stream."""
    monkeypatch.setattr(bridge, "MAX_DOC_SIZE_BYTES", 100)
    monkeypatch.setattr(bridge, "DOWNLOAD_CHUNK_BYTES", 16)
    _fake_download(bridge, monkeypatch, b"x" * 5000)

    body = bridge.handle_document("tok", {"document": {
        "file_id": "AAA", "file_name": "senza-size.pdf",
    }})

    assert "[TG-DOC-REJECT]" in body
    assert "senza-size.pdf" in body
    assert "[TG-DOC]" not in body
    # Nessun parziale abbandonato nella inbox: un agente lo leggerebbe come buono.
    assert list(bridge.INBOX_DIR.glob("*")) == []


@pytest.mark.parametrize("size", ["9999", True, None, [1]])
def test_file_size_non_intero_non_bypassa_il_guard(bridge, monkeypatch, size):
    monkeypatch.setattr(bridge, "MAX_DOC_SIZE_BYTES", 100)
    monkeypatch.setattr(bridge, "DOWNLOAD_CHUNK_BYTES", 16)
    _fake_download(bridge, monkeypatch, b"y" * 1000)

    doc = {"file_id": "AAA", "file_name": "sospetto.pdf"}
    if size is not None:
        doc["file_size"] = size
    body = bridge.handle_document("tok", {"document": doc})

    assert "[TG-DOC-REJECT]" in body


def test_file_size_assente_ma_file_piccolo_viene_consegnato(bridge, monkeypatch):
    """Il fix non deve diventare un rifiuto a tappeto: senza `file_size` un CV
    da 50 byte passa, e la size della busta viene dal file su disco."""
    monkeypatch.setattr(bridge, "MAX_DOC_SIZE_BYTES", 100)
    monkeypatch.setattr(bridge, "DOWNLOAD_CHUNK_BYTES", 16)
    _fake_download(bridge, monkeypatch, b"z" * 50)

    body = bridge.handle_document("tok", {"document": {
        "file_id": "AAA", "file_name": "cv.pdf", "mime_type": "application/pdf",
    }})

    assert "[TG-DOC]" in body
    assert "size=50" in body
    assert (bridge.INBOX_DIR / "cv.pdf").read_bytes() == b"z" * 50


def test_size_dichiarata_da_getfile_evita_il_download(bridge, monkeypatch):
    """Se è l'API a dire quanto pesa, si risparmia il traffico: il file
    non viene mai richiesto."""
    monkeypatch.setattr(bridge, "MAX_DOC_SIZE_BYTES", 100)
    aperti = _fake_download(bridge, monkeypatch, b"w" * 5000, meta_size=999_999)

    body = bridge.handle_document("tok", {"document": {
        "file_id": "AAA", "file_name": "grosso.pdf",
    }})

    assert "[TG-DOC-REJECT]" in body
    assert all("/getFile" in u for u in aperti)


def test_foto_e_vocale_oltre_limite_avvisano_invece_di_sparire(bridge, monkeypatch):
    monkeypatch.setattr(bridge, "MAX_DOC_SIZE_BYTES", 100)
    monkeypatch.setattr(bridge, "DOWNLOAD_CHUNK_BYTES", 16)
    _fake_download(bridge, monkeypatch, b"p" * 5000)

    photo = bridge.handle_photo("tok", {"photo": [{"file_id": "pppppppppp"}]})
    voice = bridge.handle_voice("tok", {"voice": {"file_id": "vvvvvvvvvv"}})

    assert "[TG-DOC-REJECT]" in photo
    assert "[TG-DOC-REJECT]" in voice


def test_download_fallito_non_lascia_parziali(bridge, monkeypatch):
    def _urlopen(url, timeout=None):
        target = url if isinstance(url, str) else url.full_url
        if "/getFile" in target:
            return _FakeResp(json.dumps({
                "ok": True, "result": {"file_path": "documents/file.bin"}
            }).encode())
        raise OSError("connessione interrotta")

    monkeypatch.setattr(bridge.urllib.request, "urlopen", _urlopen)
    assert bridge.fetch_file("tok", "AAA", "meta.pdf") is None
    assert list(bridge.INBOX_DIR.glob("*")) == []
