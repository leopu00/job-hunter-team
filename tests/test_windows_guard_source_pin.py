"""L'impronta del sidecar della guardia e' incisa a mano in piu' posti.

La guardia single-instance Windows rifiuta di partire se il `.ps1` che trova
nel PCK non ha l'hash che si aspetta: e' l'attestazione che il sidecar sia
quello firmato e non un file sostituito. Quell'hash pero' **non e' calcolato**,
e' scritto a mano — in `SOURCE_SHA256` dentro il `.gd`, e di nuovo nel test
PowerShell che pretende la riga di censimento alla lettera.

Un dato duplicato diverge, e qui diverge in silenzio: chi cambia il `.ps1`
aggiorna il punto che ha davanti e non l'altro, e nessun conflitto glielo
mette davanti — nel merge del 17/08 uno dei due punti viveva in un file che
esisteva su un solo ramo, quindi non era conteso affatto. Il risultato e' il
peggiore possibile: il merge sembra pulito e il gate cade dopo, lontano dalla
causa.

Questo test non elenca i posti: **li cerca**, e li cerca in tutti i file che
spediamo, non in alcune cartelle. Se domani l'impronta viene incisa in un
terzo file — ovunque nel repo — la copertura arriva da sola invece di
aspettare un altro audit; elencarli sarebbe stato aggiungere una terza copia
dello stesso dato, e limitare le cartelle avrebbe reso questa frase vera solo
dentro quelle.

⚠️ Il limite, detto qui perche' non si scopra da soli: `argv_utf16` viaggia
accanto a `bytes` e `sha256` nella riga di censimento, ma dipende dal path
dell'eseguibile PowerShell della macchina, non dal file. Da qui non e'
calcolabile, e resta a carico del gate Windows.

Eseguire:
    pytest tests/test_windows_guard_source_pin.py -v
"""

import hashlib
import re
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
GUARD_PS1 = ROOT / "game/scripts/support/windows_instance_guard.ps1"

# Un hash di 64 esadecimali su una riga che parla della guardia. Il contesto
# serve: negli stessi file vive anche il fingerprint della chiave di firma
# release, che e' un'altra impronta e non va confusa con questa.
HASH = re.compile(r"\b[0-9a-f]{64}\b")
ABOUT_THE_GUARD = ("SOURCE_SHA256", "instance_guard", "INSTANCE-GUARD")

# Dove cercare: TUTTI i file tracciati. Limitare la ricerca ad alcune cartelle
# avrebbe reso la promessa qui sopra vera solo dentro quelle — un'impronta
# incisa in `cli/`, `shared/` o `web/` non sarebbe stata vista e il test
# sarebbe passato verde, cioe' la forma esatta che questo file esiste per
# impedire. `git ls-files` da' il perimetro giusto senza elencare niente:
# scandisce quello che spediamo e ignora build, cache e dipendenze.
# Costo misurato: ~0,2 s per ~3800 file, il filtro sotto fa la parte grossa.
SKIP_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".webp", ".ico", ".svg", ".pck", ".exe", ".zip",
    ".pem", ".ttf", ".otf", ".wav", ".ogg", ".mp3", ".lock",
}
# Un'impronta incisa a mano vive in un sorgente, non in un file da mezzo mega:
# quelli sono lockfile e dati generati, e leggerli e' il costo, non la resa.
MAX_SEARCHED_BYTES = 512_000

# Se la ricerca non trova niente, il test passerebbe senza aver guardato
# niente. I punti noti oggi sono due; il minimo tiene il test onesto se un
# giorno il pattern smette di combaciare.
MINIMUM_KNOWN_SITES = 2


def _candidate_files():
    listed = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, text=True
    )
    # Se qui non esce niente la ricerca e' vuota, e il test lo dichiara invece
    # di passare: vedi MINIMUM_KNOWN_SITES.
    for name in listed.stdout.split("\0"):
        if not name:
            continue
        path = ROOT / name
        if path.suffix.lower() in SKIP_SUFFIXES or not path.is_file():
            continue
        try:
            if path.stat().st_size > MAX_SEARCHED_BYTES:
                continue
        except OSError:
            continue
        yield path


def _lines_pinning_the_guard():
    """Ogni riga che incide un'impronta parlando della guardia."""
    found = []
    for path in _candidate_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            if HASH.search(line) and any(word in line for word in ABOUT_THE_GUARD):
                found.append((path.relative_to(ROOT), number, line.strip()))
    return found


@pytest.fixture(scope="module")
def guard_digest():
    assert GUARD_PS1.exists(), f"{GUARD_PS1} non esiste piu': il pin non ha soggetto"
    return hashlib.sha256(GUARD_PS1.read_bytes()).hexdigest()


def test_every_pinned_digest_matches_the_sidecar_on_disk(guard_digest):
    sites = _lines_pinning_the_guard()

    assert len(sites) >= MINIMUM_KNOWN_SITES, (
        "nessun punto trovato che incida l'impronta della guardia: il test "
        "sta guardando nel posto sbagliato e passerebbe per finta"
    )
    wrong = [
        f"{path}:{number} incide {HASH.search(line).group(0)[:16]}… — {line[:70]}"
        for path, number, line in sites
        if guard_digest not in line
    ]
    assert not wrong, (
        f"il sidecar su disco vale {guard_digest[:16]}…, ma questi punti "
        "ne incidono un altro:\n  " + "\n  ".join(wrong)
    )


def test_every_declared_byte_count_matches_the_sidecar_on_disk():
    """`bytes=` viaggia con l'impronta e cade con la stessa mano.

    Sta in un test suo perche' fallisce per una ragione diversa: qui il file e'
    cambiato di dimensione, e chi legge deve sapere subito se e' l'hash o la
    lunghezza a non tornare.
    """
    size = GUARD_PS1.stat().st_size
    wrong = []
    for path, number, line in _lines_pinning_the_guard():
        for declared in re.findall(r"bytes=(\d+)", line):
            if int(declared) != size:
                wrong.append(f"{path}:{number} dichiara bytes={declared}")

    assert not wrong, (
        f"il sidecar su disco e' di {size} byte, ma:\n  " + "\n  ".join(wrong)
    )


def test_the_sidecar_stays_within_the_limit_the_guard_will_accept():
    """`SOURCE_MAX_BYTES` nel `.gd` e' il tetto oltre il quale la guardia
    rifiuta il file: superarlo non rompe un test, fa fallire il bootstrap sul
    PC dell'utente."""
    guard_gd = (ROOT / "game/scripts/support/windows_instance_guard.gd").read_text(
        encoding="utf-8"
    )
    declared = re.search(r"SOURCE_MAX_BYTES\s*:=\s*([\d_]+)", guard_gd)
    assert declared, "SOURCE_MAX_BYTES non e' piu' dichiarato nella guardia"

    assert GUARD_PS1.stat().st_size <= int(declared.group(1).replace("_", ""))
