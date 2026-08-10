"""Contratto di ``jht feedback``: leggere il giudizio dell'utente, e solo quello.

``feedback_query.py`` era l'ultima delle quattro skill citate in
[JHT-CLI-AGENT-PARITY] senza un verbo `jht` davanti. È di sola LETTURA, e non
per dimenticanza: registrare un like/dislike passa da
``web/app/api/positions/[legacyId]/feedback/route.ts``, che rifiuta con 403
chiunque non arrivi da una sessione browser — un token di dispositivo, quello
che hanno container e CLI, è escluso per scelta. Il test qui sotto blocca quel
confine: se un giorno comparisse un verbo di scrittura, deve essere una
decisione presa, non una svista.

Il contratto che conta per un agente è il degrado: senza cloud configurato la
skill risponde *no-signal* ed esce 0. Un agente che chiede "cosa ne pensa
l'utente di questa posizione" e riceve un errore duro si ferma; deve invece
poter proseguire sapendo che non c'è segnale.
"""

import json
import os
import subprocess
from pathlib import Path

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


def test_feedback_resta_di_sola_lettura(tmp_path):
    """Il confine, scritto come test. Registrare un voto richiede di cambiare
    chi è autorizzato a scriverlo — è una decisione dell'operatore, non un
    wrapper in più."""
    out = run_jht("feedback", "--help", env=offline_env(tmp_path)).stdout
    for verb in ("rate", "like", "dislike", "star", "hide", "clear"):
        assert f"\n  {verb}" not in out, (
            f"`jht feedback {verb}` è comparso: la scrittura passa da una "
            "route che rifiuta i token di dispositivo, non da qui"
        )
