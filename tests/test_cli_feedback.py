"""Contratto di ``jht feedback``: leggere il giudizio dell'utente, e registrarlo.

Il comando è nato di sola lettura il 2026-08-10 perché la route rifiutava con
403 i token di dispositivo, e ha guadagnato la scrittura lo stesso giorno,
quando l'operatore ha autorizzato il caso: *«deve poterlo fare se lo chiede
l'utente»*. Le due metà hanno contratti DIVERSI, ed è il punto di questo file:

- **lettura** (`check`, `recent`, `themes`): senza cloud risponde *no-signal*
  ed esce 0. Un agente che chiede cosa pensa l'utente di una posizione e
  riceve un errore duro si ferma; deve poter proseguire sapendo che non c'è
  segnale.
- **scrittura** (`set`): senza cloud FALLISCE. Un comando che esce 0 senza
  aver registrato niente lascia l'utente convinto di aver espresso un
  giudizio che non esiste — il peggiore dei due mondi, peggio del comando che
  non c'era.

Il test sul confine dei verbi non è stato rimosso ma aggiornato: consente
esattamente la scrittura autorizzata e continua a bloccare le altre.
"""

import json
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
JHT = ROOT / "cli" / "bin" / "jht.js"


def run_jht(*args, env=None):
    return subprocess.run(
        ["node", str(JHT), *args],
        cwd=str(ROOT),
        env={**os.environ, **(env or {})},
        capture_output=True,
        text=True,
        timeout=30,
    )


def offline_env(tmp_path):
    # JHT_HOME vuota = nessun cloud.json, JHT_CONTAINER_NAME inesistente =
    # sempre il percorso host, anche su una macchina col container acceso.
    return {"JHT_HOME": str(tmp_path), "JHT_CONTAINER_NAME": "jht-test-absent"}


def test_check_senza_cloud_dice_nessun_segnale_ed_esce_zero(tmp_path):
    r = run_jht("feedback", "check", "42", env=offline_env(tmp_path))
    assert r.returncode == 0, r.stderr
    payload = json.loads(r.stdout.strip().splitlines()[-1])
    assert payload["ok"] and payload["latest_action"] is None
    assert payload["legacy_id"] == "42"


def test_recent_senza_cloud_non_e_un_errore(tmp_path):
    r = run_jht("feedback", "recent", "--days", "7", env=offline_env(tmp_path))
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout.strip().splitlines()[-1])["ok"]


def test_themes_senza_cloud_non_e_un_errore(tmp_path):
    r = run_jht("feedback", "themes", "--days", "30", env=offline_env(tmp_path))
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout.strip().splitlines()[-1])["ok"]


def test_la_scrittura_e_un_verbo_solo_e_autorizzato(tmp_path):
    """Il confine, aggiornato invece che rimosso.

    Nato per impedire che un verbo di scrittura comparisse per sbaglio finché
    la route rifiutava i token di dispositivo. Il 2026-08-10 l'operatore ha
    autorizzato ESATTAMENTE una scrittura — registrare il giudizio richiesto
    dall'utente — e il test ora la consente e continua a bloccare tutto il
    resto. Vale più del comando: è la differenza fra «non l'abbiamo fatto» e
    «non si può fare senza accorgersene».

    like/dislike/hide/star/clear restano fuori come SOTTOCOMANDI: sono valori
    di `set <id> <action>`, e averli anche come verbi propri moltiplicherebbe
    le superfici da autorizzare senza aggiungere niente.
    """
    out = run_jht("feedback", "--help", env=offline_env(tmp_path)).stdout
    assert "\n  set " in out, "il verbo autorizzato deve esserci"
    for verb in ("rate", "like", "dislike", "star", "hide", "clear", "delete"):
        assert f"\n  {verb}" not in out, (
            f"`jht feedback {verb}` è comparso: la scrittura autorizzata è "
            "`set`, e una superficie in più va decisa, non aggiunta"
        )


def test_set_senza_cloud_fallisce_invece_di_fingere(tmp_path):
    """La differenza che conta rispetto a `check`: la lettura degrada a
    «nessun segnale» ed esce 0 perché lo Scorer deve poter proseguire; la
    scrittura no. Un `set` che esce 0 senza aver registrato niente lascia
    l'utente convinto di aver espresso un giudizio che non esiste."""
    r = run_jht("feedback", "set", "42", "like", env=offline_env(tmp_path))
    assert r.returncode != 0
    payload = json.loads(r.stdout.strip().splitlines()[-1])
    assert payload["ok"] is False and payload["recorded"] is False


@pytest.mark.parametrize("action", ["like", "dislike", "hide", "star", "clear"])
def test_set_accetta_le_cinque_azioni_della_route(tmp_path, action):
    """L'elenco deve restare quello di VALID_ACTIONS nella route: un'azione in
    più qui sarebbe un 400 scoperto solo dopo una chiamata di rete."""
    r = run_jht("feedback", "set", "42", action, env=offline_env(tmp_path))
    # Senza cloud fallisce, ma deve fallire per il cloud spento — non perché
    # l'azione non è stata riconosciuta.
    assert json.loads(r.stdout.strip().splitlines()[-1])["error"] == "cloud-disabled"


def test_set_rifiuta_un_punteggio_fuori_scala_senza_chiamare_la_rete(tmp_path):
    r = run_jht("feedback", "set", "42", "star", "--score", "7",
                env=offline_env(tmp_path))
    assert r.returncode != 0
    assert "1 and 5" in json.loads(r.stdout.strip().splitlines()[-1])["error"]
