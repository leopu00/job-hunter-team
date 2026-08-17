"""O-175 — si redige quando il testo ESCE, non solo quando arriva a noi.

Il repository aveva già un ripulitore, applicato al canale che porta i dati
verso di NOI (feedback, diagnostica). Il canale che porta testo a un TERZO —
Telegram, dove ciò che esce resta — non lo attraversava. Non è una via
d'attacco: è perdita accidentale, un traceback incollato da un agente che
contiene una chiave.

Il test guarda il BODY DELLA RICHIESTA, non il codice: `curl` viene sostituito
da uno stub che scrive su file gli argomenti ricevuti, così si legge davvero
ciò che sarebbe partito verso api.telegram.org. Asserire sul sorgente direbbe
soltanto che una riga esiste; qui si vede il testo uscire ripulito.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SENDER = ROOT / "agents" / "_tools" / "jht-telegram-send"
REDACTOR = ROOT / "shared" / "redact-cli.mjs"

# Finti, e costruiti per somigliare al vero quel tanto che basta a far scattare
# le regole. Nessuno di questi valori esiste da nessuna parte.
FAKE_GITHUB = "ghp_" + "A" * 24
FAKE_BEARER = "Authorization: Bearer " + "z" * 32
FAKE_TELEGRAM = "1234567890:" + "B" * 35


@pytest.fixture()
def box(tmp_path):
    """PATH con uno stub di `curl` che registra e non chiama nessuno."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    richiesta = tmp_path / "curl-args.txt"
    stub = bin_dir / "curl"
    stub.write_text(
        "#!/bin/sh\n"
        # Separatore RS (0x1e) e non newline: il testo dei messaggi contiene
        # newline, e spezzarlo lì renderebbe illeggibile proprio il campo che
        # questo test deve guardare.
        f'for a in "$@"; do printf "%s\\036" "$a" >> "{richiesta}"; done\n'
        # Il sender legge il corpo della risposta da --output: gli diamo un
        # ok:true così prosegue come in un invio riuscito.
        'out=""\n'
        'while [ $# -gt 0 ]; do [ "$1" = "--output" ] && out="$2"; shift; done\n'
        '[ -n "$out" ] && printf \'{"ok":true,"result":{"message_id":1}}\' > "$out"\n'
        "printf '200'\n",
        encoding="utf-8",
    )
    stub.chmod(0o755)
    return {
        "richiesta": richiesta,
        "env": {
            "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}",
            "HOME": str(tmp_path),
            "JHT_HOME": str(tmp_path),
            "TELEGRAM_BOT_TOKEN": FAKE_TELEGRAM,
            "TELEGRAM_CHAT_ID": "42",
        },
    }


def _send(box, text, *extra):
    return subprocess.run(
        [str(SENDER), *extra, text],
        env=box["env"], capture_output=True, text=True,
    )


def _sent_text(box) -> str:
    """Il valore di `text=` come sarebbe arrivato a Telegram."""
    argomenti = box["richiesta"].read_text(encoding="utf-8").split("\x1e")
    valori = [a[len("text="):] for a in argomenti if a.startswith("text=")]
    assert valori, f"nessun campo text inviato: {argomenti}"
    return "\n".join(valori)


def test_un_segreto_non_esce_verso_telegram(box):
    done = _send(box, f"il push è fallito: {FAKE_GITHUB} — riprovo")

    assert done.returncode == 0, done.stderr
    uscito = _sent_text(box)
    assert FAKE_GITHUB not in uscito, uscito
    assert "[github-token]" in uscito
    # Il resto del messaggio arriva intero: un filtro che mangia la frase
    # verrebbe disattivato dal primo che se ne accorge.
    assert "il push è fallito" in uscito
    assert "riprovo" in uscito


@pytest.mark.parametrize(
    "segreto,marcatore",
    [
        (FAKE_BEARER, "[secret]"),
        ("-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----",
         "[private-key]"),
        ("sk-" + "c" * 32, "[provider-key]"),
    ],
)
def test_le_altre_famiglie_di_credenziali_valgono_uguale(box, segreto, marcatore):
    done = _send(box, f"traceback:\n{segreto}\nfine")
    assert done.returncode == 0, done.stderr
    uscito = _sent_text(box)
    assert marcatore in uscito
    for riga in segreto.splitlines():
        if len(riga) > 8:
            assert riga not in uscito, uscito


def test_i_dati_dell_utente_restano_leggibili(box):
    """Scelta dichiarata: sul canale verso l'utente si redigono i SEGRETI.

    I dati personali che passano di qui sono suoi — il CV si chiama col suo
    nome, l'annuncio porta l'email dell'azienda a cui candidarsi. Redigerli
    mutilerebbe messaggi legittimi su un canale che è già suo, e la prima
    persona a lamentarsene sarebbe l'utente.
    """
    done = _send(box, "manda Mario_Rossi_CV.pdf a hr@example.com")
    assert done.returncode == 0, done.stderr
    uscito = _sent_text(box)
    assert "hr@example.com" in uscito
    assert "Mario_Rossi_CV.pdf" in uscito


def test_senza_il_filtro_non_si_invia_niente(box, tmp_path):
    """Fail-closed: il difetto che questo lavoro evita non deve poter tornare
    per la porta di servizio di un filtro mancante."""
    # Una copia del sender in un albero dove `shared/` non esiste: è il caso
    # di un'immagine costruita male o di un tool copiato via da solo.
    finto_tools = tmp_path / "tools" / "_tools"
    finto_tools.mkdir(parents=True)
    copia = finto_tools / "jht-telegram-send"
    copia.write_bytes(SENDER.read_bytes())
    copia.chmod(0o755)

    done = subprocess.run(
        [str(copia), f"chiave {FAKE_GITHUB}"],
        env=box["env"], capture_output=True, text=True,
    )

    assert done.returncode == 6, (done.returncode, done.stdout, done.stderr)
    assert "non invio testo non ripulito" in done.stderr
    assert not box["richiesta"].exists(), "ha chiamato curl lo stesso"


def test_il_filtro_non_stampa_niente_se_le_regole_non_si_caricano(tmp_path):
    """Stessa regola un livello più in basso: un filtro che in caso di guasto
    lascia passare l'originale è peggio di nessun filtro, perché chi lo ha
    messo in mezzo smette di guardare."""
    isolato = tmp_path / "redact-cli.mjs"
    isolato.write_bytes(REDACTOR.read_bytes())
    isolato.chmod(0o755)

    done = subprocess.run(
        ["node", str(isolato)], input=f"chiave {FAKE_GITHUB}",
        capture_output=True, text=True,
    )

    assert done.returncode == 1
    assert FAKE_GITHUB not in done.stdout
    assert "rules not found" in done.stderr


def test_le_regole_sono_quelle_del_web_non_una_seconda_copia():
    """L'accettazione chiede che i pattern stiano in un posto solo.

    Non un confronto fra due elenchi scritti a mano — quello tacerebbe proprio
    quando divergono: si legge il file che il web importa e si verifica che sia
    lo stesso che il filtro carica.
    """
    condivise = ROOT / "shared" / "redaction-rules.js"
    assert condivise.exists()
    assert "REDACTION_RULES" in (ROOT / "web" / "lib" / "redact.ts").read_text(
        encoding="utf-8"
    )
    assert "redaction-rules.js" in REDACTOR.read_text(encoding="utf-8")

    quante = subprocess.run(
        ["node", str(REDACTOR), "--selftest"], capture_output=True, text=True,
    )
    assert quante.returncode == 0, quante.stderr
    dichiarate = condivise.read_text(encoding="utf-8").count('key: "')
    assert f"{dichiarate} rules" in quante.stdout, quante.stdout


def test_lo_stub_di_curl_registra_davvero(box):
    """Se lo stub non scrivesse niente, ogni asserzione sopra passerebbe a
    vuoto: qui si verifica che il banco di prova funzioni."""
    _send(box, "messaggio senza segreti")
    argomenti = box["richiesta"].read_text(encoding="utf-8")
    assert "chat_id=42" in argomenti
    assert "messaggio senza segreti" in argomenti
