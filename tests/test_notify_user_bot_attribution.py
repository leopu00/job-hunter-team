"""O-96 — la notifica esce dal bot dell'agente che l'ha scritta.

`jht-notify-user` costruiva `['jht-telegram-send', body]` e passava il ruolo in
`JHT_NOTIFY_AGENT`, che il mittente non leggeva: sceglieva il bot da `--from` o
da `JHT_TG_BOT_ROLE`, e senza nessuno dei due restava `assistente`. Risultato
misurato: `pending_user_messages` dice `agent='mentor'` e
`telegram-sent.jsonl`, allo stesso secondo, dice `from='assistente'`. L'utente
ha risposto tre volte al Mentor sul canale sbagliato, convinto che non
rispondesse.

I test guardano gli ARGOMENTI che partono e il TOKEN a cui la richiesta va,
non il sorgente: qui la domanda è «in quale conversazione finisce il
messaggio», e a quella risponde solo l'invio.
"""

from __future__ import annotations

import json
import os
import subprocess
import sqlite3
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
NOTIFY = ROOT / "agents" / "_tools" / "jht-notify-user"
SENDER = ROOT / "agents" / "_tools" / "jht-telegram-send"
SKILLS = ROOT / "shared" / "skills"

SEPARATORE = "\x1e"  # il body contiene a capo: separarli su newline è illeggibile


@pytest.fixture()
def box(tmp_path):
    """Un jobs.db vero e uno stub di `jht-telegram-send` che registra e basta."""
    home = tmp_path / "home"
    home.mkdir()
    db_path = home / "jobs.db"
    seed = subprocess.run(
        [
            "python3",
            "-c",
            "from _db import get_db, ensure_schema; c=get_db(); "
            "ensure_schema(c); c.commit(); c.close()",
        ],
        cwd=SKILLS,
        env={**os.environ, "JHT_DB": str(db_path), "JHT_HOME": str(home)},
        capture_output=True,
        text=True,
    )
    assert seed.returncode == 0, seed.stdout + seed.stderr

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    argomenti = tmp_path / "sender-args.txt"
    stub = bin_dir / "jht-telegram-send"
    stub.write_text(
        "#!/bin/sh\n"
        f'for a in "$@"; do printf "%s{SEPARATORE}" "$a" >> "{argomenti}"; done\n'
        "exit 0\n",
        encoding="utf-8",
    )
    stub.chmod(0o755)
    return {
        "db": db_path,
        "argomenti": argomenti,
        "env": {
            "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}",
            "HOME": str(home),
            "JHT_HOME": str(home),
            "JHT_DB": str(db_path),
        },
    }


def notifica(box, agent, body="Ci sono novità sul tuo percorso."):
    done = subprocess.run(
        [str(NOTIFY), "--agent", agent, body],
        env=box["env"],
        capture_output=True,
        text=True,
    )
    assert done.returncode == 0, done.stdout + done.stderr
    return done


def argomenti_inviati(box):
    testo = box["argomenti"].read_text(encoding="utf-8")
    return [a for a in testo.split(SEPARATORE) if a]


def bot_scelto(box):
    args = argomenti_inviati(box)
    assert "--from" in args, f"nessun --from negli argomenti: {args}"
    return args[args.index("--from") + 1]


@pytest.mark.parametrize("agente", ["mentor", "capitano", "assistente"])
def test_chi_ha_un_bot_scrive_dal_suo(box, agente):
    notifica(box, agente)

    assert bot_scelto(box) == agente


def test_chi_non_ha_un_bot_passa_dall_assistente_e_il_messaggio_parte(box):
    """Il costo di un fix affrettato sarebbe stato il messaggio perso.

    `--from scout` non esiste: `jht-telegram-send` esce 1 e la consegna
    fallisce. Scout, Analista e Scorer notificano l'utente e un bot loro non ce
    l'hanno, quindi restano sull'Assistente — che è quello che gia' succedeva,
    ma adesso per scelta scritta invece che per omissione.
    """
    notifica(box, "scout")

    assert bot_scelto(box) == "assistente"
    riga = sqlite3.connect(box["db"]).execute(
        "SELECT agent, delivered_via FROM pending_user_messages"
    ).fetchone()
    # L'attribuzione nel DB resta quella vera: il bot è il canale, non l'autore.
    assert riga == ("scout", "telegram")


def test_il_ruolo_arriva_al_bot_giusto_anche_dalla_variabile(tmp_path):
    """`JHT_NOTIFY_AGENT` era passata e mai letta: una trappola per il prossimo.

    Il test non guarda il sorgente del mittente: guarda a quale TOKEN va la
    richiesta, cioè in quale conversazione Telegram finisce il messaggio.
    """
    home = tmp_path / "home"
    (home / "logs").mkdir(parents=True)
    tokens = {ruolo: f"11111{i}:AAA{ruolo}" for i, ruolo in enumerate(
        ("assistente", "capitano", "mentor")
    )}
    (home / "jht.config.json").write_text(
        json.dumps(
            {
                "channels": {
                    "telegram": {
                        "bots": {
                            ruolo: {"bot_token": token, "chat_id": 42}
                            for ruolo, token in tokens.items()
                        }
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    richiesta = tmp_path / "curl-args.txt"
    stub = bin_dir / "curl"
    stub.write_text(
        "#!/bin/sh\n"
        f'for a in "$@"; do printf "%s{SEPARATORE}" "$a" >> "{richiesta}"; done\n'
        'out=""\n'
        'while [ $# -gt 0 ]; do [ "$1" = "--output" ] && out="$2"; shift; done\n'
        '[ -n "$out" ] && printf \'{"ok":true,"result":{"message_id":1}}\' > "$out"\n'
        "printf '200'\n",
        encoding="utf-8",
    )
    stub.chmod(0o755)

    done = subprocess.run(
        [str(SENDER), "Ci sono novità sul tuo percorso."],
        env={
            "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}",
            "HOME": str(home),
            "JHT_HOME": str(home),
            "JHT_NOTIFY_AGENT": "mentor",
        },
        capture_output=True,
        text=True,
    )

    assert done.returncode == 0, done.stderr
    inviati = richiesta.read_text(encoding="utf-8")
    assert tokens["mentor"] in inviati
    assert tokens["assistente"] not in inviati


def test_un_from_esplicito_sbagliato_resta_un_errore(tmp_path):
    """L'indulgenza vale per l'ambiente ereditato, non per una richiesta.

    Un `--from scout` scritto da qualcuno è un errore da vedere subito; un
    `JHT_NOTIFY_AGENT` ereditato non deve poter far fallire un invio.
    """
    done = subprocess.run(
        [str(SENDER), "--from", "scout", "testo"],
        env={"PATH": os.environ.get("PATH", ""), "HOME": str(tmp_path),
             "JHT_HOME": str(tmp_path)},
        capture_output=True,
        text=True,
    )

    assert done.returncode == 1
    assert "assistente|capitano|mentor" in done.stderr
