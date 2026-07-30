"""Test del bridge Telegram inbound (.launcher/tg-bridge.py).

Perché conta: è l'unico percorso che porta un messaggio dell'utente dentro
tmux, ed è fail-closed. Un difetto qui non produce un errore visibile ma
**silenzio**: l'utente scrive e nessuno risponde, e la diagnosi arriva solo
leggendo i log del container. Prima di questo file non c'era un solo test.

I test caricano il modulo con `JHT_HOME` in una tmp_path e sostituiscono i
due seam esterni — `urllib.request.urlopen` e `tmux_send` — quindi non
esiste traffico di rete né tmux. Sono coperti:

  • il gate di boot sul ruolo (env mancante o sbagliata = exit 2);
  • lettura config e persistenza dell'offset (incluso il reset del backlog);
  • le buste inviate a tmux per testo, documento, foto e vocale, che sono il
    contratto che gli agenti parsano;
  • il rifiuto di un documento oltre i 20 MB e il fallimento del download,
    che devono comunque avvisare l'agente invece di sparire;
  • il loop principale: whitelist sul chat_id, `/start` non inoltrato,
    avanzamento dell'offset, e sopravvivenza a un handler che solleva.

Eseguire:
    pytest tests/test_tg_bridge.py -v
"""

import importlib.util
import io
import json
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
    mod = _load_bridge(monkeypatch, tmp_path)
    sent = []
    monkeypatch.setattr(mod, "tmux_send", lambda text: sent.append(text))
    mod._sent = sent  # comodità per i test
    return mod


def _write_config(home, role="assistente", token="123:ABC", chat_id=999):
    (home / "jht.config.json").write_text(json.dumps({
        "channels": {"telegram": {"bots": {role: {
            "bot_token": token, "chat_id": chat_id,
        }}}}
    }))


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


# ── Buste verso tmux ────────────────────────────────────────────────────

def test_testo_produce_la_busta_attesa(bridge):
    bridge.handle_text({"text": "  ciao team  "})
    assert bridge._sent == ["[@utente -> @assistente] [TG] ciao team"]


def test_testo_vuoto_non_inoltra_nulla(bridge):
    bridge.handle_text({"text": "   "})
    bridge.handle_text({})
    assert bridge._sent == []


def test_documento_inoltra_path_nome_mime_e_size(bridge, monkeypatch, tmp_path):
    monkeypatch.setattr(bridge, "fetch_file", lambda t, fid, name: tmp_path / name)
    bridge.handle_document("tok", {"document": {
        "file_id": "AAA", "file_name": "cv.pdf",
        "mime_type": "application/pdf", "file_size": 1234,
    }})
    busta = bridge._sent[0]
    assert busta.startswith("[@utente -> @assistente] [TG-DOC] ")
    assert f"path={tmp_path / 'cv.pdf'}" in busta
    assert "name=cv.pdf" in busta
    assert "mime=application/pdf" in busta
    assert "size=1234" in busta


def test_documento_oltre_20mb_avvisa_e_non_scarica(bridge, monkeypatch):
    chiamate = []
    monkeypatch.setattr(bridge, "fetch_file", lambda *a: chiamate.append(a))
    bridge.handle_document("tok", {"document": {
        "file_id": "AAA", "file_name": "enorme.pdf", "file_size": 21 * 1024 * 1024,
    }})
    assert chiamate == []
    assert "[TG-DOC-REJECT]" in bridge._sent[0]
    assert "enorme.pdf" in bridge._sent[0]


def test_documento_al_limite_esatto_passa(bridge, monkeypatch, tmp_path):
    monkeypatch.setattr(bridge, "fetch_file", lambda t, fid, name: tmp_path / name)
    bridge.handle_document("tok", {"document": {
        "file_id": "AAA", "file_name": "borderline.pdf",
        "file_size": bridge.MAX_DOC_SIZE_BYTES,
    }})
    assert "[TG-DOC]" in bridge._sent[0]


def test_download_fallito_avvisa_l_agente(bridge, monkeypatch):
    """Il caso peggiore sarebbe il silenzio: l'utente ha mandato il CV e
    nessuno glielo dice."""
    monkeypatch.setattr(bridge, "fetch_file", lambda *a: None)
    bridge.handle_document("tok", {"document": {
        "file_id": "AAA", "file_name": "cv.pdf", "file_size": 10,
    }})
    assert "[TG-DOC-ERROR]" in bridge._sent[0]
    assert "cv.pdf" in bridge._sent[0]


def test_foto_prende_la_risoluzione_piu_grande(bridge, monkeypatch, tmp_path):
    scaricati = []

    def _fetch(token, file_id, name):
        scaricati.append(file_id)
        return tmp_path / name

    monkeypatch.setattr(bridge, "fetch_file", _fetch)
    bridge.handle_photo("tok", {"photo": [
        {"file_id": "small", "file_size": 100},
        {"file_id": "large", "file_size": 9000},
        {"file_id": "mid", "file_size": 4000},
    ]})
    assert scaricati == ["large"]
    assert "size=9000" in bridge._sent[0]
    assert "mime=image/jpeg" in bridge._sent[0]


def test_foto_senza_array_non_inoltra(bridge):
    bridge.handle_photo("tok", {"photo": []})
    assert bridge._sent == []


def test_vocale_include_la_durata(bridge, monkeypatch, tmp_path):
    monkeypatch.setattr(bridge, "fetch_file", lambda t, fid, name: tmp_path / name)
    bridge.handle_voice("tok", {"voice": {
        "file_id": "VOICE12345", "file_size": 500, "duration": 12,
    }})
    busta = bridge._sent[0]
    assert "mime=audio/ogg" in busta
    assert "duration=12s" in busta
    assert ".ogg" in busta


def test_allegato_non_scaricato_non_produce_busta(bridge, monkeypatch):
    monkeypatch.setattr(bridge, "fetch_file", lambda *a: None)
    bridge.handle_photo("tok", {"photo": [{"file_id": "x", "file_size": 1}]})
    bridge.handle_voice("tok", {"voice": {"file_id": "y"}})
    assert bridge._sent == []


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


def test_main_inoltra_il_messaggio_e_avanza_l_offset(bridge, monkeypatch):
    _run_main_con_updates(bridge, monkeypatch, [_msg(10, text="ciao")])
    assert bridge._sent == ["[@utente -> @assistente] [TG] ciao"]
    assert json.loads(bridge.STATE_PATH.read_text())["last_offset"] == 10


def test_main_scarta_le_chat_non_in_whitelist(bridge, monkeypatch):
    """Il canale è 1:1: un chat_id estraneo non deve mai raggiungere tmux."""
    _run_main_con_updates(bridge, monkeypatch, [
        _msg(1, chat=12345, text="sono un estraneo"),
        _msg(2, chat=999, text="sono l'utente"),
    ])
    assert bridge._sent == ["[@utente -> @assistente] [TG] sono l'utente"]
    # L'offset avanza comunque: l'update scartato non va riprocessato.
    assert json.loads(bridge.STATE_PATH.read_text())["last_offset"] == 2


def test_main_non_inoltra_lo_start(bridge, monkeypatch):
    _run_main_con_updates(bridge, monkeypatch, [
        _msg(1, text="/start"),
        _msg(2, text="  /start  "),
        _msg(3, text="/startup non e' /start"),
    ])
    assert bridge._sent == ["[@utente -> @assistente] [TG] /startup non e' /start"]


def test_main_gestisce_anche_i_messaggi_modificati(bridge, monkeypatch):
    monkeypatch.setattr(bridge, "read_config", lambda: ("tok", 999))
    _run_main_con_updates(bridge, monkeypatch, [
        {"update_id": 5, "edited_message": {"chat": {"id": 999}, "text": "corretto"}},
    ])
    assert bridge._sent == ["[@utente -> @assistente] [TG] corretto"]


def test_main_smista_per_tipo_di_allegato(bridge, monkeypatch, tmp_path):
    monkeypatch.setattr(bridge, "fetch_file", lambda t, fid, name: tmp_path / name)
    _run_main_con_updates(bridge, monkeypatch, [
        _msg(1, text="testo"),
        _msg(2, document={"file_id": "d", "file_name": "cv.pdf", "file_size": 1}),
        _msg(3, photo=[{"file_id": "p", "file_size": 2}]),
        _msg(4, voice={"file_id": "v", "file_size": 3, "duration": 1}),
        _msg(5, sticker={"file_id": "s"}),   # tipo sconosciuto: solo log
    ])
    assert len(bridge._sent) == 4
    assert "[TG] testo" in bridge._sent[0]
    assert "name=cv.pdf" in bridge._sent[1]
    assert "mime=image/jpeg" in bridge._sent[2]
    assert "mime=audio/ogg" in bridge._sent[3]


def test_main_ignora_gli_update_senza_messaggio(bridge, monkeypatch):
    _run_main_con_updates(bridge, monkeypatch, [
        {"update_id": 7, "channel_post": {"text": "non mio"}},
    ])
    assert bridge._sent == []


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
    assert bridge._sent == []
